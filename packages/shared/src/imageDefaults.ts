import { splitTags, tagKey } from './tags';
import type { Family, FamilyDefaults, ImageSettings } from './types';

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

// 这个系列固定开头和评级词里的词：不在 Danbooru 词库里，校验时也算认识
export function familyWords(defaults: FamilyDefaults): string[] {
  const text = [defaults.prefix, ...Object.values(defaults.rating)].join(', ');
  return splitTags(text).map((item) => tagKey(item.name));
}

// 节点还没改过出图设置时用的：参数取这个系列的默认值，竖的 832×1216，一次 4 张，底模等用户选
export function defaultImageSettings(defaults: FamilyDefaults): ImageSettings {
  return {
    width: 832,
    height: 1216,
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

// 底模属于哪个系列：设置里标过的照标的；没标过的按文件名猜，名字里有 pony 的当 Pony，其他当 IL
export function checkpointFamily(name: string, marked: Record<string, Family>): { family: Family; guessed: boolean } {
  if (Object.hasOwn(marked, name)) return { family: marked[name], guessed: false };
  return { family: /pony/i.test(name) ? 'Pony' : 'IL', guessed: true };
}
