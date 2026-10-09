import {
  CONTROL_TYPES,
  GUIDE_SIZES,
  SIZE_LIMITS,
  TRANSLATE_LANGUAGES,
  UPSCALE_SCALES,
  VIDEO_DENOISE,
  VIDEO_DURATION,
  VIDEO_MEGAPIXELS,
  VIDEO_SELFLIFT,
  VIDEO_STEPS,
  VIDEO_UPSCALES,
  VIDEO_WORKFLOWS,
  MAX_MEDIA,
  type AspectRatio,
  type CanvasNodeLayout,
  type ControlSettings,
  type ControlType,
  type DetailPass,
  type ImageRating,
  type ImageSettings,
  type LoraTarget,
  type MediaSlot,
  type NodeKind,
  type RefImage,
  type TagWeighting,
  type TranslateLanguage,
  type UpscaleSettings,
  type VideoSelfLift,
  type VideoSettings,
  type VideoSteps,
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

// 视频和音频槽位，见 docs/dev-plan.md 5.31：视频、音频各最多 3 个，排成视频在前、音频在后
export function mediaSlots(value: unknown): MediaSlot[] {
  if (!Array.isArray(value)) throw new HttpError(400, '视频和音频槽位格式不对');
  const slots = value.map((item): MediaSlot => {
    const fields = (item ?? {}) as Record<string, unknown>;
    const mediaId = uuid(fields.mediaId);
    const seconds = finiteNumber(fields.seconds, '视频、音频的长度');
    const start = finiteNumber(fields.start, '从第几秒开始');
    if (seconds <= 0 || start < 0 || start >= seconds) throw new HttpError(400, '从第几秒开始要在 0 到这段的长度之间');
    if (fields.kind === 'video') {
      const use = choice(fields.use, '视频怎么用', ['picture', 'both', 'sound'] as const);
      const end = fields.end === undefined ? undefined : finiteNumber(fields.end, '到第几秒');
      if (end !== undefined && (end <= start || end > seconds)) throw new HttpError(400, '到第几秒要比开始的秒数大，不超过这段的长度');
      return { kind: 'video', mediaId, seconds, start, ...(end !== undefined && { end }), use, ...(fields.frame !== undefined && { frame: uuid(fields.frame) }) };
    }
    if (fields.kind === 'audio') return { kind: 'audio', mediaId, seconds, start, use: choice(fields.use, '音频怎么用', ['voice', 'dub'] as const) };
    throw new HttpError(400, '视频和音频槽位格式不对');
  });
  const videos = slots.filter((slot) => slot.kind === 'video');
  const audios = slots.filter((slot) => slot.kind === 'audio');
  if (videos.length > MAX_MEDIA.video || audios.length > MAX_MEDIA.audio) throw new HttpError(400, `视频、音频各最多放 ${MAX_MEDIA.video} 个`);
  return [...videos, ...audios];
}

// 放进来的视频、音频多长、宽高、有没有声音，浏览器读的；从文件夹拖进来的走查询参数，是字符串
export function mediaMeta(fields: Record<string, unknown>): { seconds: number; width?: number; height?: number; hasAudio?: boolean } {
  const number = (value: unknown, what: string) => finiteNumber(typeof value === 'string' && value !== '' ? Number(value) : value, what);
  const seconds = number(fields.seconds, '长度');
  if (seconds <= 0) throw new HttpError(400, '长度格式不对');
  const size = (value: unknown, what: string) => {
    if (value === undefined || value === '') return undefined;
    const n = number(value, what);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${what}格式不对`);
    return n;
  };
  const width = size(fields.width, '宽');
  const height = size(fields.height, '高');
  const hasAudio = fields.hasAudio === undefined || fields.hasAudio === '' ? undefined : fields.hasAudio === true || fields.hasAudio === 'true' || fields.hasAudio === '1';
  return { seconds, ...(width && height && { width, height }), ...(hasAudio !== undefined && { hasAudio }) };
}

// 视频节点的时长，超过 15 秒的分段生成，见 docs/dev-plan.md 5.24
export function duration(value: unknown): number {
  const { min, max } = VIDEO_DURATION;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `时长要是 ${min} 到 ${max} 的整数`);
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
const LORA_TARGETS: LoraTarget[] = ['both', 'model'];
const WEIGHTINGS: TagWeighting[] = ['comfy', 'a1111'];

export function choice<T extends string>(value: unknown, what: string, choices: T[]): T {
  if (!choices.includes(value as T)) throw new HttpError(400, `${what}只能是 ${choices.join('、')}`);
  return value as T;
}

// 尺寸的宽或高：九档之一，或者自己填的，都是 8 的倍数，见 docs/dev-plan.md 5.21
function side(value: unknown, what: string, limits = SIZE_LIMITS): number {
  const { min, max } = limits;
  if (typeof value !== 'number' || !Number.isInteger(value) || value % 8 !== 0 || value < min || value > max) {
    throw new HttpError(400, `${what}要是 ${min} 到 ${max} 之间 8 的倍数`);
  }
  return value;
}

export function integer(value: unknown, what: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
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
  const limits = base.krea ? { min: SIZE_LIMITS.min, max: 4096 } : SIZE_LIMITS;
  if (fields.width !== undefined) next.width = side(fields.width, '宽', limits);
  if (fields.height !== undefined) next.height = side(fields.height, '高', limits);
  if (fields.count !== undefined) next.count = integer(fields.count, '张数', 1, 8);
  if (fields.workflowId !== undefined) next.workflowId = fields.workflowId === null ? null : uuid(fields.workflowId);
  if (fields.checkpoint !== undefined) next.checkpoint = text(fields.checkpoint, '底模');
  if (fields.vae !== undefined) next.vae = text(fields.vae, 'VAE');
  if (fields.textEncoder !== undefined) next.textEncoder = text(fields.textEncoder, '文字理解模型');
  if (fields.krea !== undefined) {
    if (typeof fields.krea !== 'object' || fields.krea === null || Array.isArray(fields.krea)) throw new HttpError(400, 'Krea2 设置格式不对');
    const krea = fields.krea as Record<string, unknown>;
    next.krea = {
      mode: choice(krea.mode, 'Krea2 起图', ['text', 'four-view'] as const),
      reference: refImage(krea.reference),
      refBoost: between(krea.refBoost, '参考图相似度', 0, 10),
      extra: text(krea.extra, '额外要求'),
    };
  }
  if (fields.loraTarget !== undefined) next.loraTarget = choice(fields.loraTarget, 'LoRA 作用在哪', LORA_TARGETS);
  if (fields.weighting !== undefined) next.weighting = choice(fields.weighting, '权重算法', WEIGHTINGS);
  if (fields.loras !== undefined) next.loras = loraList(fields.loras);
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
  if (fields.controls !== undefined) next.controls = controls(fields.controls);
  if (next.krea?.mode === 'four-view' && (next.width % 16 !== 0 || next.height % 16 !== 0)) throw new HttpError(400, '四视图的宽高要是 16 的倍数');
  return next;
}

function between(value: unknown, what: string, min: number, max: number): number {
  const n = finiteNumber(value, what);
  if (n < min || n > max) throw new HttpError(400, `${what}要在 ${min} 到 ${max} 之间`);
  return n;
}

// 挂的几个 LoRA，各带强度；出图、生成视频共用
function loraList(value: unknown): { name: string; strength: number }[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'LoRA 格式不对');
  return value.map((lora) => {
    const { name, strength } = (lora ?? {}) as Record<string, unknown>;
    return { name: nonEmptyText(name, 'LoRA 名字'), strength: finiteNumber(strength, 'LoRA 强度') };
  });
}

function oneOf(value: unknown, what: string, choices: number[]): number {
  if (!choices.includes(value as number)) throw new HttpError(400, `${what}只能是 ${choices.join('、')}`);
  return value as number;
}

// 视频节点的生成设置只改带了的项：一采大小、放大倍数、种子、走哪套流程、二采重画多少、SelfLift 的参数，见 docs/dev-plan.md 5.27、5.32
export function videoSettings(value: unknown, base: VideoSettings): VideoSettings {
  if (typeof value !== 'object' || value === null) throw new HttpError(400, '生成设置格式不对');
  const fields = value as Record<string, unknown>;
  const next = { ...base };
  if (fields.megapixels !== undefined) next.megapixels = oneOf(fields.megapixels, '一采大小', VIDEO_MEGAPIXELS);
  if (fields.upscale !== undefined) next.upscale = oneOf(fields.upscale, '放大倍数', VIDEO_UPSCALES);
  if (fields.seed !== undefined) next.seed = fields.seed === null ? null : integer(fields.seed, '种子', 0);
  if (fields.model !== undefined) next.model = nonEmptyText(fields.model, '主模型');
  if (fields.speed !== undefined) next.speed = choice(fields.speed, '加速还是不加速', ['fast', 'full'] as const);
  if (fields.steps !== undefined) next.steps = videoSteps(fields.steps);
  if (fields.loras !== undefined) next.loras = loraList(fields.loras);
  if (fields.workflow !== undefined) next.workflow = choice(fields.workflow, '走哪套流程', VIDEO_WORKFLOWS);
  if (fields.denoise !== undefined) next.denoise = between(fields.denoise, '二采重画多少', VIDEO_DENOISE.min, VIDEO_DENOISE.max);
  if (fields.selflift !== undefined) next.selflift = selfliftSettings(fields.selflift);
  return next;
}

// SelfLift 那套的参数：总共几步、前几步低分辨率、低分辨率缩到多少、提升用哪个放大器，见 docs/dev-plan.md 5.32
function selfliftSettings(value: unknown): VideoSelfLift {
  if (typeof value !== 'object' || value === null) throw new HttpError(400, 'SelfLift 的设置格式不对');
  const fields = value as Record<string, unknown>;
  const steps = integer(fields.steps, 'SelfLift 总步数', VIDEO_SELFLIFT.steps.min, VIDEO_SELFLIFT.steps.max);
  // 低分辨率那段至少要 1 步、最后留至少 1 步在高分辨率上跑，插件自己也是这么卡的
  const transitionStep = integer(fields.transitionStep, '低分辨率跑几步', VIDEO_SELFLIFT.transitionStep.min, Math.min(VIDEO_SELFLIFT.transitionStep.max, steps - 1));
  return {
    steps,
    transitionStep,
    lowresScale: between(fields.lowresScale, '低分辨率倍数', VIDEO_SELFLIFT.lowresScale.min, VIDEO_SELFLIFT.lowresScale.max),
    upscaler: nonEmptyText(fields.upscaler, '放大器'),
  };
}

// 自己改的一采、二采每段几步，见 docs/dev-plan.md 5.27
function videoSteps(value: unknown): VideoSteps {
  if (typeof value !== 'object' || value === null) throw new HttpError(400, '一采、二采的步数格式不对');
  const fields = value as Record<string, unknown>;
  return {
    pass1: integer(fields.pass1, '一采步数', VIDEO_STEPS.pass1.min, VIDEO_STEPS.pass1.max),
    pass2: integer(fields.pass2, '二采步数', VIDEO_STEPS.pass2.min, VIDEO_STEPS.pass2.max),
  };
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
    const { on, detector, sam, threshold, denoise, guideSize, positive, negative } = item as Record<string, unknown>;
    return {
      on: bool(on, '部位重绘开关'),
      detector: text(detector, '检测模型'),
      sam: text(sam, 'SAM 模型'),
      threshold: between(threshold, '检测阈值', 0, 1),
      denoise: between(denoise, '部位重绘的重绘强度', 0.01, 1),
      guideSize: oneOf(guideSize, '重画尺寸', GUIDE_SIZES),
      positive: text(positive, '这道的正面'),
      negative: text(negative, '这道的负面'),
    };
  });
}

// ControlNet 的列表，见 docs/dev-plan.md 5.21。强度 0 到 2，起止 0 到 1、起点不比终点大
export function controls(value: unknown): ControlSettings[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'ControlNet 的设置格式不对');
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new HttpError(400, 'ControlNet 的设置格式不对');
    const { on, type, image, preprocessor, model, strength, start, end } = item as Record<string, unknown>;
    if (!CONTROL_TYPES.includes(type as ControlType)) throw new HttpError(400, `ControlNet 的类型只能是 ${CONTROL_TYPES.join('、')}`);
    const from = between(start, 'ControlNet 的起点', 0, 1);
    const to = between(end, 'ControlNet 的终点', 0, 1);
    if (from > to) throw new HttpError(400, 'ControlNet 的起点不能比终点大');
    return {
      on: bool(on, 'ControlNet 开关'),
      type: type as ControlType,
      image: refImage(image),
      preprocessor: nonEmptyText(preprocessor, '提取方式'),
      model: text(model, 'ControlNet 模型'),
      strength: between(strength, 'ControlNet 的强度', 0, 2),
      start: from,
      end: to,
    };
  });
}

// 参考图：槽位里的图，或者这个节点出过的图；没选是 null
export function refImage(value: unknown): RefImage | null {
  if (value === null) return null;
  const fields = (value ?? {}) as Record<string, unknown>;
  if (fields.kind === 'slot') return { kind: 'slot', imageId: nonEmptyText(fields.imageId, '参考图') };
  if (fields.kind === 'generated') {
    return { kind: 'generated', messageId: nonEmptyText(fields.messageId, '参考图'), jobId: nonEmptyText(fields.jobId, '参考图'), seed: integer(fields.seed, '参考图的种子', 0) };
  }
  throw new HttpError(400, '参考图格式不对');
}
