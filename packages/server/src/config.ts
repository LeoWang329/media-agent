import os from 'node:os';
import path from 'node:path';
import { API_KEY_MASK, type Config, type ModelConfig, type ModelConfigWithKey } from '@media-agent/shared';
import { HttpError } from './httpError';
import { readJson, writeJsonAtomic } from './store/jsonFile';
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

async function readLocalConfig(configDir: string): Promise<LocalConfig> {
  const saved = await readJson<Partial<LocalConfig>>(path.join(configDir, 'config.json'));
  return { workFolder: null, apiKeys: {}, assetFolders: [], lastCollageFolder: null, ...saved };
}

const modelConfigsFile = (workFolder: string) => path.join(workFolder, 'model-configs.json');

async function readModelConfigs(workFolder: string | null): Promise<ModelConfig[]> {
  return workFolder ? ((await readJson<ModelConfig[]>(modelConfigsFile(workFolder))) ?? []) : [];
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

// PUT /config 只改请求里带了的 workFolder、modelConfigs
export async function updateConfig(configDir: string, body: unknown): Promise<Config> {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, '请求内容格式不对');
  const input = body as Record<string, unknown>;
  const local = await readLocalConfig(configDir);

  if ('workFolder' in input) {
    const value = typeof input.workFolder === 'string' ? input.workFolder.trim() : '';
    if (!path.isAbsolute(value)) throw new HttpError(400, '工作文件夹要填完整路径，例如 D:\\同步盘\\提示词画布');
    const workFolder = path.resolve(value);
    try {
      await initWorkFolder(workFolder);
    } catch (err) {
      throw new HttpError(400, `工作文件夹初始化失败：${(err as Error).message}`);
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

  await writeJsonAtomic(path.join(configDir, 'config.json'), local);
  return readConfig(configDir);
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
  return { id, name: text('name'), baseUrl: text('baseUrl'), apiKey: text('apiKey'), model: text('model'), imageLongSide };
}
