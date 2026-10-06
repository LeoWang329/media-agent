import path from 'node:path';
import {
  AUTODL_IDLE_MINUTES,
  DEFAULT_AUTODL,
  DEFAULT_THINKING,
  DEFAULT_TURN_LIMIT,
  FAMILIES,
  FAMILY_DEFAULTS,
  isTurnLimit,
  THINKING_LEVELS,
  THINKING_USES,
  TURN_LIMITS,
  type Family,
  type FamilyDefaults,
  type SharedSettings,
  type ThinkingLevel,
  type ThinkingSettings,
} from '@media-agent/shared';
import { HttpError } from '../httpError';
import { readJson, writeJsonAtomic } from './jsonFile';
import { withLock } from './locks';

// 两台机器共用的设置，存在工作文件夹
const settingsFile = (work: string) => path.join(work, 'settings.json');

// 没存过的项用默认值；不认识的项原样留着
export async function readSettings(work: string): Promise<SharedSettings> {
  const saved = await readJson<Partial<SharedSettings>>(settingsFile(work));
  return {
    ...saved,
    thinking: { ...DEFAULT_THINKING, ...saved?.thinking },
    turnLimit: saved?.turnLimit ?? DEFAULT_TURN_LIMIT,
    comfy: { lanUrl: null, ...saved?.comfy, autodl: { ...DEFAULT_AUTODL, ...saved?.comfy?.autodl } },
    checkpoints: { ...saved?.checkpoints },
    defaults: { IL: { ...FAMILY_DEFAULTS.IL, ...saved?.defaults?.IL }, Pony: { ...FAMILY_DEFAULTS.Pony, ...saved?.defaults?.Pony } },
  };
}

// PUT /settings 只改请求里带了的项
export function updateSettings(work: string, body: unknown): Promise<SharedSettings> {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, '请求内容格式不对');
  const input = body as Record<string, unknown>;
  return withLock(`settings:${work}`, async () => {
    const settings = await readSettings(work);
    if ('thinking' in input) settings.thinking = { ...settings.thinking, ...parseThinking(input.thinking) };
    if ('turnLimit' in input) {
      if (!isTurnLimit(input.turnLimit)) throw new HttpError(400, `最多带几轮只能是 all、${TURN_LIMITS.join('、')}`);
      settings.turnLimit = input.turnLimit;
    }
    if ('comfy' in input) settings.comfy = parseComfy(input.comfy, settings.comfy);
    if ('checkpoints' in input) settings.checkpoints = { ...settings.checkpoints, ...parseCheckpoints(input.checkpoints) };
    if ('defaults' in input) settings.defaults = parseDefaults(input.defaults, settings.defaults);
    await writeJsonAtomic(settingsFile(work), settings);
    return settings;
  });
}

const object = (value: unknown, what: string) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, `${what}格式不对`);
  return value as Record<string, unknown>;
};

function parseThinking(value: unknown): Partial<ThinkingSettings> {
  const fields = object(value, '思考设置');
  const result: Partial<ThinkingSettings> = {};
  if ('level' in fields) {
    if (!THINKING_LEVELS.includes(fields.level as ThinkingLevel)) throw new HttpError(400, '思考的总档位只能是 off、low、medium、high');
    result.level = fields.level as ThinkingLevel;
  }
  for (const use of THINKING_USES) {
    if (!(use in fields)) continue;
    const level = fields[use];
    if (level !== 'follow' && !THINKING_LEVELS.includes(level as ThinkingLevel)) throw new HttpError(400, `${use} 的思考档位只能是 follow、off、low、medium、high`);
    result[use] = level as ThinkingLevel | 'follow';
  }
  return result;
}

// 局域网那台的地址：空着就是没填；去掉末尾的斜杠。AutoDL 选的实例和空闲多久关机，只改带了的项
function parseComfy(value: unknown, current: SharedSettings['comfy']): SharedSettings['comfy'] {
  const fields = object(value, 'ComfyUI 设置');
  const result = { ...current };
  if ('lanUrl' in fields) {
    const url = fields.lanUrl === null ? '' : fields.lanUrl;
    if (typeof url !== 'string') throw new HttpError(400, 'ComfyUI 地址格式不对');
    const trimmed = url.trim().replace(/\/+$/, '');
    if (trimmed && !/^https?:\/\/[^\s/]+$/i.test(trimmed)) throw new HttpError(400, 'ComfyUI 地址要像 http://192.168.1.20:8188 这样，不带后面的路径');
    result.lanUrl = trimmed || null;
  }
  if ('autodl' in fields) {
    const autodl = object(fields.autodl, 'AutoDL 设置');
    const next = { ...current.autodl };
    if ('instanceUuid' in autodl) {
      if (autodl.instanceUuid !== null && typeof autodl.instanceUuid !== 'string') throw new HttpError(400, 'AutoDL 实例格式不对');
      next.instanceUuid = (autodl.instanceUuid as string | null)?.trim() || null;
    }
    if ('idleMinutes' in autodl) {
      const minutes = autodl.idleMinutes;
      const { min, max } = AUTODL_IDLE_MINUTES;
      if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < min || minutes > max) {
        throw new HttpError(400, `空闲多久自动关机要填 ${min} 到 ${max} 之间的整数分钟`);
      }
      next.idleMinutes = minutes;
    }
    result.autodl = next;
  }
  return result;
}

// 底模文件名 → 系列；null 是两个系列都不是
function parseCheckpoints(value: unknown): Record<string, Family | null> {
  const fields = object(value, '底模的系列');
  for (const family of Object.values(fields)) {
    if (family !== null && !FAMILIES.includes(family as Family)) throw new HttpError(400, '底模的系列只能是 IL、Pony，或者 null 表示两个都不是');
  }
  return fields as Record<string, Family | null>;
}

// 各系列的默认值，只改带了的项
function parseDefaults(value: unknown, current: Record<Family, FamilyDefaults>): Record<Family, FamilyDefaults> {
  const fields = object(value, '系列默认值');
  const result = { ...current };
  for (const family of FAMILIES) {
    if (!(family in fields)) continue;
    const item = object(fields[family], `${family} 的默认值`);
    const next = { ...current[family] };
    const text = (key: 'prefix' | 'negative' | 'sampler' | 'scheduler') => {
      if (typeof item[key] !== 'string') throw new HttpError(400, `${family} 的 ${key} 要是文字`);
      next[key] = (item[key] as string).trim();
    };
    const number = (key: 'steps' | 'cfg' | 'clipSkip', integer: boolean, min: number) => {
      const n = item[key];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
        throw new HttpError(400, `${family} 的 ${key} 要是${integer ? '整数' : '数字'}，不小于 ${min}`);
      }
      next[key] = n;
    };
    if ('prefix' in item) text('prefix');
    if ('negative' in item) text('negative');
    if ('sampler' in item) text('sampler');
    if ('scheduler' in item) text('scheduler');
    if ('steps' in item) number('steps', true, 1);
    if ('cfg' in item) number('cfg', false, 0);
    if ('clipSkip' in item) number('clipSkip', true, 1);
    if ('rating' in item) {
      const rating = object(item.rating, `${family} 的评级词`);
      if (!(['general', 'sensitive', 'explicit'] as const).every((key) => typeof rating[key] === 'string')) {
        throw new HttpError(400, `${family} 的评级词要写全年龄、擦边、成人三档`);
      }
      next.rating = { general: String(rating.general).trim(), sensitive: String(rating.sensitive).trim(), explicit: String(rating.explicit).trim() };
    }
    result[family] = next;
  }
  return result;
}
