import {
  GUIDE_SIZES,
  IMAGE_SIZES,
  TRANSLATE_LANGUAGES,
  UPSCALE_SCALES,
  type AspectRatio,
  type CanvasNodeLayout,
  type DetailPass,
  type ImageRating,
  type ImageSettings,
  type NodeKind,
  type TranslateLanguage,
  type UpscaleSettings,
} from '@media-agent/shared';
import { HttpError } from '../httpError';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASPECT_RATIOS: AspectRatio[] = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

// 画布和节点 id 会拼进文件路径，只接受 UUID
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, 'id 格式不对');
  return value;
}

export function nonEmptyText(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${what}不能为空`);
  return value;
}

// 拖进来的文件名只当名字存着，不拼路径，不接受带斜杠的
export function fileName(value: unknown): string {
  const name = nonEmptyText(value, '文件名').trim();
  if (/[\\/]/.test(name)) throw new HttpError(400, '文件名不对');
  return name;
}

// 回收站里的文件夹名，只当名字用，不接受路径分隔符和上一级
export function trashName(value: unknown): string {
  const name = nonEmptyText(value, '回收站里的名字').trim();
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new HttpError(400, '回收站里的名字不对');
  return name;
}

export function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new HttpError(400, `${what}格式不对`);
  return value;
}

export function index(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new HttpError(400, `${what}序号不对`);
  return value;
}

export function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${what}格式不对`);
  return value;
}

export function finiteNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `${what}格式不对`);
  return value;
}

export function layouts(value: unknown): CanvasNodeLayout[] {
  if (!Array.isArray(value)) throw new HttpError(400, '节点位置格式不对');
  return value.map((item) => {
    const { id, x, y, collapsed } = (item ?? {}) as Record<string, unknown>;
    if (typeof collapsed !== 'boolean') throw new HttpError(400, '节点位置格式不对');
    return { id: uuid(id), x: finiteNumber(x, '节点位置'), y: finiteNumber(y, '节点位置'), collapsed };
  });
}

export function slots(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 9 || value.some((v) => typeof v !== 'string')) throw new HttpError(400, '槽位格式不对');
  return value;
}

export function duration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 4 || value > 15) throw new HttpError(400, '时长要是 4 到 15 的整数');
  return value;
}

export function language(value: unknown): TranslateLanguage {
  if (!TRANSLATE_LANGUAGES.includes(value as TranslateLanguage)) throw new HttpError(400, `翻译语言只能是${TRANSLATE_LANGUAGES.join('、')}`);
  return value as TranslateLanguage;
}

export function nodeKind(value: unknown): NodeKind {
  if (value !== 'video' && value !== 'image') throw new HttpError(400, '节点类型只能是 video 或 image');
  return value;
}

export function aspectRatio(value: unknown): AspectRatio {
  if (!ASPECT_RATIOS.includes(value as AspectRatio)) throw new HttpError(400, '画面比例格式不对');
  return value as AspectRatio;
}

const RATINGS: ImageRating[] = ['none', 'general', 'sensitive', 'explicit'];

function integer(value: unknown, what: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, max === Number.MAX_SAFE_INTEGER ? `${what}要是不小于 ${min} 的整数` : `${what}要是 ${min} 到 ${max} 的整数`);
  }
  return value;
}

// 出图设置只改带了的项，没带的用 base（节点原来的，或者系列的默认值）
export function imageSettings(value: unknown, base: ImageSettings): ImageSettings {
  if (typeof value !== 'object' || value === null) throw new HttpError(400, '出图设置格式不对');
  const fields = value as Record<string, unknown>;
  const next = { ...base };
  if (fields.width !== undefined || fields.height !== undefined) {
    const width = fields.width ?? base.width;
    const height = fields.height ?? base.height;
    if (!IMAGE_SIZES.some((size) => size.width === width && size.height === height)) {
      throw new HttpError(400, `尺寸只能是 ${IMAGE_SIZES.map((size) => `${size.width}×${size.height}`).join('、')}`);
    }
    next.width = width as number;
    next.height = height as number;
  }
  if (fields.count !== undefined) next.count = integer(fields.count, '张数', 1, 8);
  if (fields.workflowId !== undefined) next.workflowId = fields.workflowId === null ? null : uuid(fields.workflowId);
  if (fields.checkpoint !== undefined) next.checkpoint = text(fields.checkpoint, '底模');
  if (fields.loras !== undefined) {
    if (!Array.isArray(fields.loras)) throw new HttpError(400, 'LoRA 格式不对');
    next.loras = fields.loras.map((lora) => {
      const { name, strength } = (lora ?? {}) as Record<string, unknown>;
      return { name: nonEmptyText(name, 'LoRA 名字'), strength: finiteNumber(strength, 'LoRA 强度') };
    });
  }
  if (fields.steps !== undefined) next.steps = integer(fields.steps, '步数', 1);
  if (fields.cfg !== undefined) {
    next.cfg = finiteNumber(fields.cfg, 'CFG');
    if (next.cfg < 0) throw new HttpError(400, 'CFG 不能小于 0');
  }
  if (fields.sampler !== undefined) next.sampler = nonEmptyText(fields.sampler, '采样器');
  if (fields.scheduler !== undefined) next.scheduler = nonEmptyText(fields.scheduler, '调度器');
  if (fields.seed !== undefined) next.seed = fields.seed === null ? null : integer(fields.seed, '种子', 0);
  if (fields.rating !== undefined) {
    if (!RATINGS.includes(fields.rating as ImageRating)) throw new HttpError(400, '评级只能是 none、general、sensitive、explicit');
    next.rating = fields.rating as ImageRating;
  }
  if (fields.negativeExtra !== undefined) next.negativeExtra = text(fields.negativeExtra, '额外的负面词');
  if (fields.upscale !== undefined) next.upscale = upscaleSettings(fields.upscale);
  if (fields.details !== undefined) next.details = detailPasses(fields.details);
  return next;
}

function between(value: unknown, what: string, min: number, max: number): number {
  const n = finiteNumber(value, what);
  if (n < min || n > max) throw new HttpError(400, `${what}要在 ${min} 到 ${max} 之间`);
  return n;
}

function oneOf(value: unknown, what: string, choices: number[]): number {
  if (!choices.includes(value as number)) throw new HttpError(400, `${what}只能是 ${choices.join('、')}`);
  return value as number;
}

// 放大：开关、放大模型、倍数、重绘强度，见 docs/dev-plan.md 5.21
export function upscaleSettings(value: unknown): UpscaleSettings {
  if (typeof value !== 'object' || value === null) throw new HttpError(400, '放大的设置格式不对');
  const { on, model, scale, denoise } = value as Record<string, unknown>;
  return { on: bool(on, '放大开关'), model: text(model, '放大模型'), scale: oneOf(scale, '放大倍数', UPSCALE_SCALES), denoise: between(denoise, '放大的重绘强度', 0, 1) };
}

// 部位重绘的几道，见 docs/dev-plan.md 5.21
export function detailPasses(value: unknown): DetailPass[] {
  if (!Array.isArray(value)) throw new HttpError(400, '部位重绘的设置格式不对');
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new HttpError(400, '部位重绘的设置格式不对');
    const { on, detector, threshold, denoise, guideSize, positive, negative } = item as Record<string, unknown>;
    return {
      on: bool(on, '部位重绘开关'),
      detector: text(detector, '检测模型'),
      threshold: between(threshold, '检测阈值', 0, 1),
      denoise: between(denoise, '部位重绘的重绘强度', 0.01, 1),
      guideSize: oneOf(guideSize, '重画尺寸', GUIDE_SIZES),
      positive: text(positive, '这道的正面'),
      negative: text(negative, '这道的负面'),
    };
  });
}
