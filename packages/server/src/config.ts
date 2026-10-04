import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  API_KEY_MASK,
  DEFAULT_MODEL_THINKING,
  DEFAULT_PRICING,
  THINKING_STYLES,
  type ComfyTarget,
  type Config,
  type ModelConfig,
  type ModelConfigWithKey,
  type ModelPricing,
  type ThinkingStyle,
} from '@media-agent/shared';
import { HttpError } from './httpError';
import fs from 'node:fs/promises';
import { readJson, writeJsonAtomic } from './store/jsonFile';
import { withLock } from './store/locks';
import { initWorkFolder } from './store/workFolder';

// 本机 config.json；模型配置本身存在工作文件夹，这里只按 id 存 key。
// comfyClientId 是连 ComfyUI 时用的固定身份，程序重启后用同一个，ComfyUI 才会把没跑完的任务的进度接着推过来。
// 出图用哪台 ComfyUI、AutoDL 的开发者 Token 也只存本机，见 docs/dev-plan.md 5.17
type LocalConfig = {
  workFolder: string | null;
  apiKeys: Record<string, string>;
  assetFolders: string[];
  lastCollageFolder: string | null;
  lastDownloadFolder: string | null;
  comfyTarget: ComfyTarget;
  autodlToken: string | null;
  comfyClientId?: string;
};

export function defaultConfigDir(): string {
  return process.platform === 'win32'
    ? path.join(process.env.APPDATA!, 'media-agent')
    : path.join(os.homedir(), '.media-agent');
}

async function readLocalConfig(configDir: string): Promise<LocalConfig> {
  const saved = await readJson<Partial<LocalConfig>>(path.join(configDir, 'config.json'));
  return { workFolder: null, apiKeys: {}, assetFolders: [], lastCollageFolder: null, lastDownloadFolder: null, comfyTarget: 'lan', autodlToken: null, ...saved };
}

// 出图那边用：工作文件夹、出图用哪台、AutoDL 的 Token，不用读模型配置
export async function readComfyConfig(configDir: string): Promise<Pick<LocalConfig, 'workFolder' | 'comfyTarget' | 'autodlToken'>> {
  const { workFolder, comfyTarget, autodlToken } = await readLocalConfig(configDir);
  return { workFolder, comfyTarget, autodlToken };
}

const modelConfigsFile = (workFolder: string) => path.join(workFolder, 'model-configs.json');

async function readModelConfigs(workFolder: string | null): Promise<ModelConfig[]> {
  const saved = workFolder ? ((await readJson<ModelConfig[]>(modelConfigsFile(workFolder))) ?? []) : [];
  // 以前存的没有价格、没有思考写法
  return saved.map((m) => ({ ...DEFAULT_MODEL_THINKING, ...m, pricing: { ...DEFAULT_PRICING, ...m.pricing } }));
}

export async function readConfig(configDir: string): Promise<Config> {
  const local = await readLocalConfig(configDir);
  const modelConfigs = (await readModelConfigs(local.workFolder)).map((m) => ({ ...m, apiKey: local.apiKeys[m.id] ?? '' }));
  return {
    workFolder: local.workFolder,
    modelConfigs,
    assetFolders: local.assetFolders,
    lastCollageFolder: local.lastCollageFolder,
    lastDownloadFolder: local.lastDownloadFolder,
    comfyTarget: local.comfyTarget,
    autodlToken: local.autodlToken,
  };
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
    autodlToken: config.autodlToken ? API_KEY_MASK : null,
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

// PUT /config 只改请求里带了的 workFolder、modelConfigs、comfyTarget、autodlToken
export async function updateConfig(configDir: string, body: unknown): Promise<Config> {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, '请求内容格式不对');
  const input = body as Record<string, unknown>;
  return changeLocalConfig(configDir, async (local) => {
    if ('workFolder' in input) {
      const value = typeof input.workFolder === 'string' ? input.workFolder.trim() : '';
      if (!path.isAbsolute(value)) throw new HttpError(400, '要填完整路径，比如 D:\\同步盘\\提示词画布');
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
      const saved = await readModelConfigs(local.workFolder);
      const items = input.modelConfigs.map((item) => parseModelConfig(item, saved));
      for (const previous of saved) {
        if (!items.some((m) => m.id === previous.id)) delete local.apiKeys[previous.id];
      }
      for (const { id, apiKey } of items) {
        if (apiKey === API_KEY_MASK) continue;
        if (apiKey) local.apiKeys[id] = apiKey;
        else delete local.apiKeys[id];
      }
      await writeJsonAtomic(modelConfigsFile(local.workFolder), items.map(({ apiKey: _, ...rest }) => rest));
    }

    if ('comfyTarget' in input) {
      if (input.comfyTarget !== 'lan' && input.comfyTarget !== 'autodl') throw new HttpError(400, '出图用哪台只能是 lan 或 autodl');
      local.comfyTarget = input.comfyTarget;
    }

    // 和模型密钥一样：打码的那串是没改，空着是清掉
    if ('autodlToken' in input) {
      const token = input.autodlToken === null ? '' : input.autodlToken;
      if (typeof token !== 'string') throw new HttpError(400, 'AutoDL 的 Token 要是文字');
      if (token !== API_KEY_MASK) local.autodlToken = token.trim() || null;
    }
  });
}

// 拼图存过一次就记住那个文件夹，下次弹窗从这里开始
export async function setLastCollageFolder(configDir: string, folder: string): Promise<void> {
  await changeLocalConfig(configDir, async (local) => {
    local.lastCollageFolder = folder;
  });
}

// 出的图下载过一次也记住，和拼图分开记
export async function setLastDownloadFolder(configDir: string, folder: string): Promise<void> {
  await changeLocalConfig(configDir, async (local) => {
    local.lastDownloadFolder = folder;
  });
}

export async function comfyClientId(configDir: string): Promise<string> {
  const saved = (await readLocalConfig(configDir)).comfyClientId;
  if (saved) return saved;
  let id = '';
  await changeLocalConfig(configDir, async (local) => {
    local.comfyClientId ??= randomUUID();
    id = local.comfyClientId;
  });
  return id;
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

// 请求里没带思考写法的（界面上还没有这两项时存的），沿用原来存的
function parseThinking(fields: Record<string, unknown>, previous: ModelConfig | undefined): Pick<ModelConfig, 'thinkingStyle' | 'thinkingModel'> {
  const { thinkingStyle, thinkingModel } = fields;
  if (thinkingStyle !== undefined && !THINKING_STYLES.includes(thinkingStyle as ThinkingStyle)) throw new HttpError(400, '思考写法不对');
  if (thinkingModel !== undefined && typeof thinkingModel !== 'string') throw new HttpError(400, '开思考用的模型名要是文字');
  const fallback = previous ?? DEFAULT_MODEL_THINKING;
  return {
    thinkingStyle: (thinkingStyle as ThinkingStyle | undefined) ?? fallback.thinkingStyle,
    thinkingModel: typeof thinkingModel === 'string' ? thinkingModel.trim() : fallback.thinkingModel,
  };
}

function parseModelConfig(item: unknown, saved: ModelConfig[]): ModelConfigWithKey {
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
  return {
    id,
    name: text('name'),
    baseUrl: text('baseUrl'),
    apiKey: text('apiKey'),
    model: text('model'),
    imageLongSide,
    pricing: parsePricing(fields.pricing),
    ...parseThinking(fields, saved.find((m) => m.id === id)),
  };
}
