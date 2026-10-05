import { splitTags, tagKey } from './tags';
import type { AutodlSettings, CardImageInfo, ChatNode, ControlSettings, ControlType, DetailPass, Family, FamilyDefaults, ImageSettings, PromptMeta, UpscaleSettings } from './types';

export const FAMILIES: Family[] = ['IL', 'Pony'];

// 尺寸九档：正方形一档，竖的四档，横的是竖的宽高对调，见 docs/dev-plan.md 5.14
const PORTRAIT = [
  [896, 1152],
  [832, 1216],
  [768, 1344],
  [640, 1536],
];
export const IMAGE_SIZES: { width: number; height: number }[] = [
  { width: 1024, height: 1024 },
  ...PORTRAIT.map(([width, height]) => ({ width, height })),
  ...PORTRAIT.map(([height, width]) => ({ width, height })),
];

// 节点还没改过尺寸时用竖的 832×1216
export const DEFAULT_IMAGE_SIZE = { width: 832, height: 1216 };

// 尺寸自己填：宽高取 8 的倍数，照 WebUI 能填 64 到 2048，见 docs/dev-plan.md 5.21
export const SIZE_LIMITS = { min: 64, max: 2048 };
export const roundSize = (side: number) => Math.round(side / 8) * 8;

// AutoDL 还没设置过：没选实例，空闲 15 分钟自动关机；能填 5 到 240 分钟，见 docs/dev-plan.md 5.17
export const DEFAULT_AUTODL: AutodlSettings = { instanceUuid: null, idleMinutes: 15 };
export const AUTODL_IDLE_MINUTES = { min: 5, max: 240 };

// 两个系列的初始默认值，按常见用法填，见 docs/dev-plan.md 5.18；设置里能改
export const FAMILY_DEFAULTS: Record<Family, FamilyDefaults> = {
  IL: {
    prefix: 'masterpiece, best quality',
    negative: 'lowres, worst quality, bad quality, bad anatomy, bad hands, extra digits, jpeg artifacts, signature, watermark, username, text',
    rating: { general: 'general', sensitive: 'sensitive', explicit: 'explicit' },
    steps: 28,
    cfg: 5,
    sampler: 'euler_ancestral',
    scheduler: 'normal',
    clipSkip: 2,
  },
  Pony: {
    prefix: 'score_9, score_8_up, score_7_up, source_anime',
    negative: 'score_6, score_5, score_4, worst quality, low quality, watermark, signature, text',
    rating: { general: 'rating_safe', sensitive: 'rating_questionable', explicit: 'rating_explicit' },
    steps: 25,
    cfg: 7,
    sampler: 'euler_ancestral',
    scheduler: 'normal',
    clipSkip: 2,
  },
};

// 这个系列固定开头和评级词里的词：不在 Danbooru 词库里，校验时也算认识。值是标签小块上中文那行写的
export function familyWords(defaults: FamilyDefaults): Map<string, string> {
  const words = new Map<string, string>();
  for (const item of splitTags(Object.values(defaults.rating).join(', '))) words.set(tagKey(item.name), '评级词');
  for (const item of splitTags(defaults.prefix)) words.set(tagKey(item.name), '质量词');
  return words;
}

// 放大：打开时重绘强度默认 0.35，2 倍；部位重绘新加一道的默认值，见 docs/dev-plan.md 5.21
export const DEFAULT_UPSCALE: UpscaleSettings = { on: false, model: '', scale: 2, denoise: 0.35 };
export const UPSCALE_SCALES = [1.5, 2];
export const GUIDE_SIZES = [512, 768, 1024];
export const newDetailPass = (detectors: string[]): DetailPass => ({
  on: true,
  detector: detectors.find((name) => /face/i.test(name)) ?? detectors[0] ?? '',
  sam: '',
  threshold: 0.3,
  denoise: 0.4,
  guideSize: 1024,
  positive: '',
  negative: '',
});

// ControlNet，见 docs/dev-plan.md 5.21：类型决定提取方式和模型的下拉里列哪些、新加一个时先选哪个
export const CONTROL_LABELS: Record<ControlType, string> = { pose: '姿势', depth: '深度', lineart: '线稿', edge: '边缘', other: '其他' };
export const CONTROL_TYPES = Object.keys(CONTROL_LABELS) as ControlType[];
export const NO_PREPROCESSOR = 'none';
type Matched = Exclude<ControlType, 'other'>;
const PREPROCESSOR_NAMES: Record<Matched, RegExp> = { pose: /pose|^DWPreprocessor$/i, depth: /depth/i, lineart: /lineart/i, edge: /canny|hed|pidinet|teed|scribble|lsd/i };
const FIRST_PREPROCESSOR: Record<Matched, string> = { pose: 'DWPreprocessor', depth: 'MiDaS-DepthMapPreprocessor', lineart: 'AnimeLineArtPreprocessor', edge: 'CannyEdgePreprocessor' };
const MODEL_NAMES: Record<Matched, RegExp> = { pose: /pose/i, depth: /depth/i, lineart: /lineart/i, edge: /canny|hed|softedge|scribble/i };

// 这一类能选的提取方式，不含「不提取」；「其他」全列
export const controlPreprocessors = (type: ControlType, all: string[]) =>
  all.filter((name) => name !== NO_PREPROCESSOR && (type === 'other' || PREPROCESSOR_NAMES[type].test(name)));

// 这一类能选的模型：名字对得上的在前，再是名字带 union 的；一个都对不上时全列。「其他」全列
export function controlModels(type: ControlType, all: string[]): string[] {
  if (type === 'other') return all;
  const matched = all.filter((name) => MODEL_NAMES[type].test(name));
  const unions = all.filter((name) => /union/i.test(name) && !matched.includes(name));
  return matched.length || unions.length ? [...matched, ...unions] : all;
}

// 新加一个或者换了类型时先选的：提取方式选这一类常用的，列表里没有就选这一类的第一个；模型选名字对得上的第一个，没有就空着
export function controlChoices(type: ControlType, options: { preprocessors: string[]; controlnets: string[] }): Pick<ControlSettings, 'preprocessor' | 'model'> {
  if (type === 'other') return { preprocessor: NO_PREPROCESSOR, model: '' };
  const list = controlPreprocessors(type, options.preprocessors);
  return {
    preprocessor: list.includes(FIRST_PREPROCESSOR[type]) ? FIRST_PREPROCESSOR[type] : (list[0] ?? NO_PREPROCESSOR),
    model: options.controlnets.find((name) => MODEL_NAMES[type].test(name)) ?? '',
  };
}

export const newControl = (type: ControlType, options: { preprocessors: string[]; controlnets: string[] }): ControlSettings => ({
  on: true,
  type,
  image: null,
  ...controlChoices(type, options),
  strength: 1,
  start: 0,
  end: 1,
});

// union 模型一个文件管好几种，要告诉它这次是哪种
export function unionType({ type, preprocessor }: Pick<ControlSettings, 'type' | 'preprocessor'>): string {
  if (type === 'pose') return 'openpose';
  if (type === 'depth') return 'depth';
  if (type === 'lineart' || (type === 'edge' && /canny|lsd/i.test(preprocessor))) return 'canny/lineart/anime_lineart/mlsd';
  return type === 'edge' ? 'hed/pidi/scribble/ted' : 'auto';
}

// 节点还没改过出图设置时用的：参数取这个系列的默认值，竖的 832×1216，一次 4 张，放大、部位重绘、ControlNet 都不开；
// 底模空着，出图时用这台 ComfyUI 上这个系列的第一个，见 docs/dev-plan.md 5.19。E02 的几样照原来的：底模自带的 VAE、
// LoRA 两边都作用、ComfyUI 自带的权重算法
export function defaultImageSettings(defaults: FamilyDefaults): ImageSettings {
  return {
    ...DEFAULT_IMAGE_SIZE,
    count: 4,
    workflowId: null,
    checkpoint: '',
    vae: '',
    loras: [],
    loraTarget: 'both',
    weighting: 'comfy',
    steps: defaults.steps,
    cfg: defaults.cfg,
    sampler: defaults.sampler,
    scheduler: defaults.scheduler,
    seed: null,
    rating: 'none',
    negativeExtra: '',
    upscale: DEFAULT_UPSCALE,
    details: [],
    controls: [],
  };
}

// 节点的出图设置：改过的用节点自己的；没改过的项（比如放大、部位重绘是后来加的）用这个系列的默认值。
// 部位重绘的 SAM 是 P16 加的，之前加的那几道没有，算不用
export function imageSettingsOf(image: Partial<ImageSettings> | undefined, defaults: FamilyDefaults): ImageSettings {
  const settings = { ...defaultImageSettings(defaults), ...image };
  return { ...settings, details: settings.details.map((pass) => ({ ...pass, sam: pass.sam ?? '' })) };
}

// 底模属于哪个系列，null 是两个系列都不是：设置里标过的照标的；没标过的按文件名猜，
// 名字里有 pony 的当 Pony，有 illustrious、noob、wai 或者单独一个 IL（IL-xxx、xxx_IL）的当 IL，别的都不是
export function checkpointFamily(name: string, marked: Record<string, Family | null>): { family: Family | null; guessed: boolean } {
  if (Object.hasOwn(marked, name)) return { family: marked[name], guessed: false };
  if (/pony/i.test(name)) return { family: 'Pony', guessed: true };
  return { family: /illustrious|noob|wai|(^|[^a-z])il([^a-z]|$)/i.test(name) ? 'IL' : null, guessed: true };
}

// 卡片上生图节点那一行：系列和尺寸，视频节点是 null。meta 是节点现在选的系统提示词的说明段，
// 提示词不在了或者不是生图用的，看不出系列
export function cardImageInfo(node: Pick<ChatNode, 'kind' | 'image'>, meta: Pick<PromptMeta, 'use' | 'family'> | null): CardImageInfo {
  if (node.kind !== 'image') return null;
  return {
    family: meta?.use === 'image' ? meta.family : null,
    width: node.image?.width ?? DEFAULT_IMAGE_SIZE.width,
    height: node.image?.height ?? DEFAULT_IMAGE_SIZE.height,
  };
}
