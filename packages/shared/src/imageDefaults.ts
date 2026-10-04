import { splitTags, tagKey } from './tags';
import type { CardImageInfo, ChatNode, Family, FamilyDefaults, ImageSettings, PromptMeta } from './types';

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
    upscaleModel: null,
    poseModel: null,
    styleModel: null,
    clipVision: null,
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
    upscaleModel: null,
    poseModel: null,
    styleModel: null,
    clipVision: null,
  },
};

// 这个系列固定开头和评级词里的词：不在 Danbooru 词库里，校验时也算认识。值是标签小块上中文那行写的
export function familyWords(defaults: FamilyDefaults): Map<string, string> {
  const words = new Map<string, string>();
  for (const item of splitTags(Object.values(defaults.rating).join(', '))) words.set(tagKey(item.name), '评级词');
  for (const item of splitTags(defaults.prefix)) words.set(tagKey(item.name), '质量词');
  return words;
}

// 节点还没改过出图设置时用的：参数取这个系列的默认值，竖的 832×1216，一次 4 张；
// 底模空着，出图时用这台 ComfyUI 上这个系列的第一个，见 docs/dev-plan.md 5.19
export function defaultImageSettings(defaults: FamilyDefaults): ImageSettings {
  return {
    ...DEFAULT_IMAGE_SIZE,
    count: 4,
    workflowId: null,
    checkpoint: '',
    loras: [],
    steps: defaults.steps,
    cfg: defaults.cfg,
    sampler: defaults.sampler,
    scheduler: defaults.scheduler,
    seed: null,
    rating: 'none',
    negativeExtra: '',
  };
}

// 底模属于哪个系列，null 是两个系列都不是：设置里标过的照标的；没标过的按文件名猜，
// 名字里有 pony 的当 Pony，有 illustrious、noob、wai 或者单独一个 IL（IL-xxx、xxx_IL）的当 IL，别的都不是
export function checkpointFamily(name: string, marked: Record<string, Family | null>): { family: Family | null; guessed: boolean } {
  if (Object.hasOwn(marked, name)) return { family: marked[name], guessed: false };
  if (/pony/i.test(name)) return { family: 'Pony', guessed: true };
  return { family: /illustrious|noob|wai|(^|[^a-z])il([^a-z]|$)/i.test(name) ? 'IL' : null, guessed: true };
}

// 卡片上生图节点那一行：系列和尺寸。meta 是节点现在选的系统提示词的说明段，找不到提示词时为 null，当视频节点
export function cardImageInfo(node: Pick<ChatNode, 'image'>, meta: Pick<PromptMeta, 'use' | 'family'> | null): CardImageInfo {
  if (meta?.use !== 'image') return null;
  return { family: meta.family, width: node.image?.width ?? DEFAULT_IMAGE_SIZE.width, height: node.image?.height ?? DEFAULT_IMAGE_SIZE.height };
}
