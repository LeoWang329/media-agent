import {
  CONTROL_TYPES,
  DEFAULT_SELFLIFT,
  DEPTH_MIN_STRENGTH,
  EDIT_FNS,
  EDIT_UPSCALE_SCALES,
  GUIDE_SIZES,
  REAL_PEOPLE_STRENGTH,
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
  type EditFnId,
  type EditSettings,
  type ImageRating,
  type ImageSettings,
  type LoraTarget,
  type MediaSlot,
  type NodeKind,
  type RefImage,
  type TagWeighting,
  type TranslateLanguage,
  type UpscaleSettings,
  type VideoLead,
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

// 局部重绘的掩码：base64 的 PNG，认一下文件头，别把别的格式当图存下来，见 docs/dev-plan.md 5.38
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngBytes(value: unknown, what: string): Uint8Array {
  const base64 = typeof value === 'string' ? value.replace(/^data:image\/png;base64,/, '') : '';
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new HttpError(400, `${what}要是 base64 的 PNG`);
  const data = Buffer.from(base64, 'base64');
  if (!data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) throw new HttpError(400, `${what}要是 base64 的 PNG`);
  return data;
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
  if (value !== 'video' && value !== 'image' && value !== 'edit') throw new HttpError(400, '节点类型只能是 video、image 或 edit');
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

// 图像编辑节点记住的东西：只改带了的项，没带的用 base（节点原来的，或者默认的），见 docs/dev-plan.md 5.39。
// real（转真人那一套）/ inpaint / depth / remix / upscale 几层也各收半份、跟 base 深合并
export function editSettings(value: unknown, base: EditSettings): EditSettings {
  if (typeof value !== 'object' || value === null) throw new HttpError(400, '编辑设置格式不对');
  const fields = value as Record<string, unknown>;
  const next = { ...base };
  if (fields.fn !== undefined) {
    if (!EDIT_FNS.some((fn) => fn.id === fields.fn)) throw new HttpError(400, '不认识这个编辑功能');
    next.fn = fields.fn as EditFnId;
  }
  if (fields.slot !== undefined) next.slot = index(fields.slot, '槽位');
  if (fields.slotB !== undefined) next.slotB = index(fields.slotB, '槽位');
  if (fields.text !== undefined) next.text = text(fields.text, '要改什么');
  if (fields.seed !== undefined) next.seed = fields.seed === null ? null : integer(fields.seed, '出图种子', 0);
  if (fields.candidate !== undefined) {
    if (fields.candidate !== null && (typeof fields.candidate !== 'object' || Array.isArray(fields.candidate))) throw new HttpError(400, '候选格式不对');
    const candidate = fields.candidate as Record<string, unknown> | null;
    next.candidate = candidate === null ? null : { messageId: uuid(candidate.messageId), promptIndex: index(candidate.promptIndex, '候选') };
  }
  if (fields.source !== undefined) {
    if (fields.source !== null && (typeof fields.source !== 'object' || Array.isArray(fields.source))) throw new HttpError(400, '源图格式不对');
    const source = fields.source as Record<string, unknown> | null;
    next.source = source === null ? null : { kind: 'generated', jobId: uuid(source.jobId), seed: integer(source.seed, '源图种子', 0) };
  }
  if (fields.outfitLora !== undefined) next.outfitLora = text(fields.outfitLora, '换装 LoRA');
  if (fields.fourview !== undefined) {
    if (!fields.fourview || typeof fields.fourview !== 'object' || Array.isArray(fields.fourview)) throw new HttpError(400, '四视图尺寸格式不对');
    const size = fields.fourview as Record<string, unknown>;
    next.fourview = { width: side(size.width, '四视图宽度', { min: 256, max: 4096 }), height: side(size.height, '四视图高度', { min: 256, max: 4096 }) };
  }
  if (fields.maskShapes !== undefined) {
    if (fields.maskShapes === null) next.maskShapes = null;
    else {
      const mask = fields.maskShapes as NonNullable<EditSettings['maskShapes']>;
      if (!mask || typeof mask !== 'object' || !Array.isArray(mask.strokes)) throw new HttpError(400, '掩码形状格式不对');
      const point = (p: { x: number; y: number }) => ({ x: finiteNumber(p?.x, '掩码位置'), y: finiteNumber(p?.y, '掩码位置') });
      next.maskShapes = {
        imageId: uuid(mask.imageId),
        rect: mask.rect === null ? null : { ...point(mask.rect), width: between(mask.rect?.width, '掩码宽度', 0, 100000), height: between(mask.rect?.height, '掩码高度', 0, 100000) },
        strokes: mask.strokes.map((s) => {
          if (!s || !Array.isArray(s.points)) throw new HttpError(400, '掩码笔画格式不对');
          return { eraser: bool(s.eraser, '掩码擦除'), size: between(s.size, '画笔大小', 1, 100000), points: s.points.map(point) };
        }),
      };
    }
  }
  if (fields.refBoost !== undefined) {
    const refBoost = finiteNumber(fields.refBoost, '相似度');
    if (refBoost < 0 || refBoost > 10) throw new HttpError(400, '相似度要在 0 到 10 之间');
    next.refBoost = refBoost;
  }
  if (fields.real !== undefined) next.real = realSettings(fields.real, base.real);
  if (fields.inpaint !== undefined) next.inpaint = inpaintSettings(fields.inpaint, base.inpaint);
  if (fields.depth !== undefined) next.depth = depthSettings(fields.depth, base.depth);
  if (fields.remix !== undefined) next.remix = remixSettings(fields.remix, base.remix);
  if (fields.upscale !== undefined) next.upscale = upscaleEditSettings(fields.upscale, base.upscale);
  return next;
}

// 改图放大支持 2 / 4 倍，保留旧任务的 1.5 倍；放大模型和面部修复的检测模型
// 都是文件名（空着是「用这台 ComfyUI 上第一个」/「不开面部修复」），见 docs/plan-image-edit-node.md 第 3 节
function upscaleEditSettings(value: unknown, base: EditSettings['upscale']): EditSettings['upscale'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, '放大 / 高清的设置格式不对');
  const fields = value as Record<string, unknown>;
  return {
    scale: fields.scale === undefined ? base.scale : oneOf(fields.scale, '放大倍数', EDIT_UPSCALE_SCALES),
    model: fields.model === undefined ? base.model : text(fields.model, '放大模型'),
    face: fields.face === undefined ? base.face : text(fields.face, '面部修复的检测模型'),
  };
}

// 深度迁移的控制强度：0.1 到 2（0 不能用，见 krea2Depth.ts）。
function depthSettings(value: unknown, base: EditSettings['depth']): EditSettings['depth'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, '深度迁移的设置格式不对');
  const fields = value as Record<string, unknown>;
  return { strength: fields.strength === undefined ? base.strength : between(fields.strength, '控制强度', DEPTH_MIN_STRENGTH, 2) };
}

// 风格 Remix / 换人的 LoRA：名字 + 强度，见 docs/dev-plan.md 5.39
function remixSettings(value: unknown, base: EditSettings['remix']): EditSettings['remix'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, '风格 Remix 的设置格式不对');
  const fields = value as Record<string, unknown>;
  const next = { lora: { ...base.lora } };
  if (fields.lora !== undefined) next.lora = loraSetting(fields.lora, base.lora, '风格 Remix LoRA');
  return next;
}

// 转真人那一套（反推 / 双图 / 像图 2 多少 / 两组 LoRA / 无审查）：只改带了的项，范围照作者给的，
// 见 docs/krea2-real-usage.md 第 2、6、7 节
function realSettings(value: unknown, base: EditSettings['real']): EditSettings['real'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, '转真人的设置格式不对');
  const fields = value as Record<string, unknown>;
  const next = { ...base, lora: { ...base.lora } };
  if (fields.reverse !== undefined) next.reverse = bool(fields.reverse, '用不用反推');
  if (fields.reverseSeed !== undefined) next.reverseSeed = integer(fields.reverseSeed, '反推种子', 0);
  if (fields.dual !== undefined) next.dual = bool(fields.dual, '换不换脸');
  if (fields.image2Strength !== undefined) next.image2Strength = between(fields.image2Strength, '图 2 强度', 0, 10);
  // 名字空着就是不挂这条 LoRA（服务端 realLorasOf 会把没名字的滤掉）
  if (fields.lora !== undefined) next.lora = loraSetting(fields.lora, base.lora, '转真人 LoRA');
  if (fields.people !== undefined) {
    if (!Array.isArray(fields.people)) throw new HttpError(400, '人物 LoRA 格式不对');
    next.people = fields.people.map((one) => loraSetting(one, { name: '', strength: REAL_PEOPLE_STRENGTH }, '人物 LoRA'));
  }
  if (fields.uncensored !== undefined) next.uncensored = bool(fields.uncensored, '无审查');
  return next;
}

// 一条 LoRA：名字 + 强度。强度上限 1.5：两个 LoRA 一起挂时总强度别顶满，见 docs/krea2-real-usage.md 第 6 节
function loraSetting(value: unknown, base: { name: string; strength: number }, what: string): { name: string; strength: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, `${what}格式不对`);
  const fields = value as Record<string, unknown>;
  return {
    name: fields.name === undefined ? base.name : text(fields.name, `${what}名字`),
    strength: fields.strength === undefined ? base.strength : between(fields.strength, `${what}强度`, 0, 1.5),
  };
}

// 局部重绘的重绘强度：0–1，见 docs/dev-plan.md 5.38
function inpaintSettings(value: unknown, base: EditSettings['inpaint']): EditSettings['inpaint'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, '局部重绘的设置格式不对');
  const fields = value as Record<string, unknown>;
  return {
    denoise: fields.denoise === undefined ? base.denoise : between(fields.denoise, '重绘强度', 0, 1),
    ...(base.feather !== undefined && { feather: base.feather }),
    ...(fields.feather !== undefined && { feather: integer(fields.feather, '羽化范围', 0, 128) }),
  };
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
      // 起图那一排只有前三种；real / depth / remix 是编辑节点自己造的那几档（见 jobs.ts 的 editParams），
      // 一起收下来，免得老界面上存着这几种 mode 时 PATCH 直接报错
      mode: choice(krea.mode, 'Krea2 起图', ['text', 'four-view', 'edit', 'real', 'depth', 'remix'] as const),
      reference: refImage(krea.reference),
      referenceB: refImage(krea.referenceB ?? null),
      refBoost: between(krea.refBoost, '参考图相似度', 0, 10),
      // 第一张（场景）的相似度，只有双图时起作用；没带就是 1
      refBoostA: krea.refBoostA === undefined ? 1 : between(krea.refBoostA, '场景相似度', 0, 10),
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
  // 四视图、编辑、深度迁移、风格 Remix 都用 16 的倍数对齐的潜变量（转真人那条不出宽高）
  if (next.krea && next.krea.mode !== 'text' && (next.width % 16 !== 0 || next.height % 16 !== 0)) {
    throw new HttpError(400, `${next.krea.mode === 'four-view' ? '四视图' : '编辑'}的宽高要是 16 的倍数`);
  }
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

// SelfLift 接续那套的参数：总共几步、前几步低分辨率、低分辨率缩到多少、提升用哪个放大器、
// 接上一段带几帧、接缝加多少噪、偏色对齐强度、双 LoRA 双采两遍各挂哪套 LoRA、接缝声音羽化几个刻度，见 docs/dev-plan.md 5.32
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
    contextFrames: oneOf(fields.contextFrames, '接上一段带几帧', [...VIDEO_SELFLIFT.contextFrames]),
    noise: between(fields.noise, '接缝加多少噪', VIDEO_SELFLIFT.noise.min, VIDEO_SELFLIFT.noise.max),
    colorMatch: between(fields.colorMatch, '偏色对齐强度', VIDEO_SELFLIFT.colorMatch.min, VIDEO_SELFLIFT.colorMatch.max),
    lowresLora: phaseLora(fields.lowresLora, '低分辨率那遍的 LoRA'),
    hiresLora: phaseLora(fields.hiresLora, '高分辨率那遍的 LoRA'),
    // 羽化刻度没写就是照默认（老界面发的记录里没有这一项）；写了就照写的，0 是不接羽化那个节点
    audioFeather: fields.audioFeather === undefined ? DEFAULT_SELFLIFT.audioFeather : integer(fields.audioFeather, '接缝声音羽化', VIDEO_SELFLIFT.audioFeather.min, VIDEO_SELFLIFT.audioFeather.max),
    // 续写起点：没写或者 null 是重新生成；写了就是那段前一段视频从哪来，见 docs/dev-plan.md 5.38
    lead: leadSetting(fields.lead),
  };
}

// 续写起点从哪来：这个框下面已生成的一条、画布上的视频素材、本机传上来的前一段
function leadSetting(value: unknown): VideoLead | null {
  if (value === null || value === undefined) return null;
  const fields = (value ?? {}) as Record<string, unknown>;
  if (fields.kind === 'job') return { kind: 'job', jobId: nonEmptyText(fields.jobId, '当续写起点的那条视频') };
  if (fields.kind === 'media') return { kind: 'media', mediaId: uuid(fields.mediaId) };
  if (fields.kind === 'lead') return { kind: 'lead', leadId: uuid(fields.leadId) };
  throw new HttpError(400, '续写起点只能是这个框下面已生成的一条、画布上的视频素材，或者传上来的前一段视频');
}

// 双 LoRA 双采里的一遍挂的 LoRA：null（或者没写，老记录就是没写）是不挂
function phaseLora(value: unknown, what: string): { name: string; strength: number } | null {
  if (value === null || value === undefined) return null;
  const { name, strength } = (value ?? {}) as Record<string, unknown>;
  return { name: nonEmptyText(name, `${what} 名字`), strength: finiteNumber(strength, `${what} 强度`) };
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
