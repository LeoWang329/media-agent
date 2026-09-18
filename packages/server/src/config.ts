import os from 'node:os';
import path from 'node:path';
import { API_KEY_MASK, DEFAULT_PRICING, type Config, type ModelConfig, type ModelConfigWithKey, type ModelPricing } from '@media-agent/shared';
import { HttpError } from './httpError';
import fs from 'node:fs/promises';
import { readJson, writeJsonAtomic } from './store/jsonFile';
import { withLock } from './store/locks';
import { initWorkFolder } from './store/workFolder';

// 本机 config.json；模型配置本身存在工作文件夹，这里只按 id 存 key
type LocalConfig = {
  workFolder: string | null;
  apiKeys: Record<string, string>;
  assetFolders: string[];
  lastCollageFolder: string | null;
};

export function defaultConfigDir(): string {
  return process.platform === 'win32'
    ? path.join(process.env.APPDATA!, 'media-agent')
    : path.join(os.homedir(), '.media-agent');
}

// 工作文件夹要填绝对路径，示例跟着系统走：Windows 是盘符路径，macOS / Linux 是当前用户目录下
function workFolderExample(): string {
  return process.platform === 'win32' ? 'D:\\同步盘\\提示词画布' : path.join(os.homedir(), '提示词画布');
}

async function readLocalConfig(configDir: string): Promise<LocalConfig> {
  const saved = await readJson<Partial<LocalConfig>>(path.join(configDir, 'config.json'));
  return { workFolder: null, apiKeys: {}, assetFolders: [], lastCollageFolder: null, ...saved };
}

const modelConfigsFile = (workFolder: string) => path.join(workFolder, 'model-configs.json');

async function readModelConfigs(workFolder: string | null): Promise<ModelConfig[]> {
  const saved = workFolder ? ((await readJson<ModelConfig[]>(modelConfigsFile(workFolder))) ?? []) : [];
  // 以前存的没有价格
  return saved.map((m) => ({ ...m, pricing: { ...DEFAULT_PRICING, ...m.pricing } }));
}

export async function readConfig(configDir: string): Promise<Config> {
  const local = await readLocalConfig(configDir);
  const modelConfigs = (await readModelConfigs(local.workFolder)).map((m) => ({ ...m, apiKey: local.apiKeys[m.id] ?? '' }));
  return { workFolder: local.workFolder, modelConfigs, assetFolders: local.assetFolders, lastCollageFolder: local.lastCollageFolder };
}

export async function requireWorkFolder(configDir: string): Promise<string> {
  const { workFolder } = await readLocalConfig(configDir);
  if (!workFolder) throw new HttpError(400, '请先在设置里选择工作文件夹');
  return workFolder;
}

export function maskConfig(config: Config): Config {
  return {
    ...config,
    modelConfigs: config.modelConfigs.map((m) => ({ ...m, apiKey: m.apiKey ? API_KEY_MASK : '' })),
  };
}

// 本机配置的读改写排队，免得同时改工作文件夹和资产库文件夹时互相覆盖
function changeLocalConfig(configDir: string, change: (local: LocalConfig) => Promise<void>): Promise<Config> {
  return withLock(`config:${configDir}`, async () => {
    const local = await readLocalConfig(configDir);
    await change(local);
    await writeJsonAtomic(path.join(configDir, 'config.json'), local);
    return readConfig(configDir);
  });
}

// PUT /config 只改请求里带了的 workFolder、modelConfigs
export async function updateConfig(configDir: string, body: unknown): Promise<Config> {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, '请求内容格式不对');
  const input = body as Record<string, unknown>;
  return changeLocalConfig(configDir, async (local) => {
    if ('workFolder' in input) {
      const value = typeof input.workFolder === 'string' ? input.workFolder.trim() : '';
      if (!path.isAbsolute(value)) throw new HttpError(400, `要填完整路径，比如 ${workFolderExample()}`);
      const workFolder = path.resolve(value);
      try {
        await initWorkFolder(workFolder);
      } catch (err) {
        const { code, message } = err as NodeJS.ErrnoException;
        if (code === 'EPERM' || code === 'EACCES') throw new HttpError(400, '这个文件夹不让写入：拒绝访问。换一个自己的文件夹');
        throw new HttpError(400, `工作文件夹初始化失败：${message}`);
      }
      local.workFolder = workFolder;
    }

    if ('modelConfigs' in input) {
      if (!local.workFolder) throw new HttpError(400, '请先设置工作文件夹');
      if (!Array.isArray(input.modelConfigs)) throw new HttpError(400, '模型配置格式不对');
      const items = input.modelConfigs.map(parseModelConfig);
      for (const previous of await readModelConfigs(local.workFolder)) {
        if (!items.some((m) => m.id === previous.id)) delete local.apiKeys[previous.id];
      }
      for (const { id, apiKey } of items) {
        if (apiKey === API_KEY_MASK) continue;
        if (apiKey) local.apiKeys[id] = apiKey;
        else delete local.apiKeys[id];
      }
      await writeJsonAtomic(modelConfigsFile(local.workFolder), items.map(({ apiKey: _, ...rest }) => rest));
    }
  });
}

// 拼图存过一次就记住那个文件夹，下次弹窗从这里开始
export async function setLastCollageFolder(configDir: string, folder: string): Promise<void> {
  await changeLocalConfig(configDir, async (local) => {
    local.lastCollageFolder = folder;
  });
}

const samePath = (a: string, b: string) => path.relative(a, b) === '';

// 资产库导入文件夹：原地引用，只记下路径
export async function addAssetFolder(configDir: string, value: unknown): Promise<string[]> {
  if (typeof value !== 'string' || !path.isAbsolute(value.trim())) throw new HttpError(400, '文件夹要填完整路径');
  const folder = path.resolve(value.trim());
  const stat = await fs.stat(folder).catch(() => null);
  if (!stat?.isDirectory()) throw new HttpError(400, `找不到这个文件夹：${folder}`);
  const config = await changeLocalConfig(configDir, async (local) => {
    if (!local.assetFolders.some((f) => samePath(f, folder))) local.assetFolders.push(folder);
  });
  return config.assetFolders;
}

// 只从资产库里移除，不动文件
export async function removeAssetFolder(configDir: string, value: unknown): Promise<string[]> {
  if (typeof value !== 'string') throw new HttpError(400, '文件夹路径格式不对');
  const config = await changeLocalConfig(configDir, async (local) => {
    local.assetFolders = local.assetFolders.filter((f) => !samePath(f, value));
  });
  return config.assetFolders;
}

// 价格留空当 0；界面上空着的数字框送过来是 null
function parsePricing(value: unknown): ModelPricing {
  const fields = (value ?? {}) as Record<string, unknown>;
  const price = (key: keyof ModelPricing) => {
    const price = fields[key];
    if (price === undefined || price === null) return 0;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) throw new HttpError(400, '价格要填 0 或正数');
    return price;
  };
  return {
    currency: fields.currency === '$' ? '$' : DEFAULT_PRICING.currency,
    input: price('input'),
    output: price('output'),
    cached: price('cached'),
  };
}

function parseModelConfig(item: unknown): ModelConfigWithKey {
  const fields = (item ?? {}) as Record<string, unknown>;
  const text = (key: keyof ModelConfigWithKey) => {
    const value = fields[key];
    if (typeof value !== 'string') throw new HttpError(400, `模型配置缺少 ${key}`);
    return value.trim();
  };
  const id = text('id');
  if (!id) throw new HttpError(400, '模型配置缺少 id');
  const imageLongSide = fields.imageLongSide;
  if (typeof imageLongSide !== 'number' || !Number.isInteger(imageLongSide) || imageLongSide <= 0) {
    throw new HttpError(400, '发图长边要填正整数');
  }
  return { id, name: text('name'), baseUrl: text('baseUrl'), apiKey: text('apiKey'), model: text('model'), imageLongSide, pricing: parsePricing(fields.pricing) };
}
