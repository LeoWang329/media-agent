import { checkpointFamily, type ComfyOptions, type Family } from '@media-agent/shared';
import { objectInfo, type ObjectInfo } from './client';

// object_info 按地址缓存，点「刷新」或换了地址才重读，见 docs/dev-plan.md 5.17
const cache = new Map<string, Promise<ObjectInfo>>();

export function loadObjectInfo(url: string, refresh = false): Promise<ObjectInfo> {
  if (refresh) cache.delete(url);
  let info = cache.get(url);
  if (!info) {
    info = objectInfo(url);
    info.catch(() => cache.delete(url));
    cache.set(url, info);
  }
  return info;
}

// 这台读过、缓存着：AutoDL 关机以后照样能给出读过的下拉选项
export const hasObjectInfo = (url: string) => cache.has(url);

// 下拉选项有两种写法：老的 [[选项…], {…}]，新的 ['COMBO', {options: […]}]
function comboOptions(info: ObjectInfo, nodeType: string, input: string): string[] {
  const inputs = info[nodeType]?.input;
  const spec = (inputs?.required?.[input] ?? inputs?.optional?.[input]) as unknown[] | undefined;
  if (!Array.isArray(spec)) return [];
  if (Array.isArray(spec[0])) return spec[0].map(String);
  const options = (spec[1] as { options?: unknown } | undefined)?.options;
  return spec[0] === 'COMBO' && Array.isArray(options) ? options.map(String) : [];
}

// 这台 ComfyUI 上的底模文件名
export const comfyCheckpoints = (info: ObjectInfo) => comboOptions(info, 'CheckpointLoaderSimple', 'ckpt_name');

export function comfyOptions(info: ObjectInfo, marked: Record<string, Family | null>): ComfyOptions {
  return {
    checkpoints: comfyCheckpoints(info).map((name) => ({ name, ...checkpointFamily(name, marked) })),
    loras: comboOptions(info, 'LoraLoader', 'lora_name'),
    samplers: comboOptions(info, 'KSampler', 'sampler_name'),
    schedulers: comboOptions(info, 'KSampler', 'scheduler'),
    upscaleModels: comboOptions(info, 'UpscaleModelLoader', 'model_name'),
    controlnets: comboOptions(info, 'ControlNetLoader', 'control_net_name'),
    ipadapters: comboOptions(info, 'IPAdapterModelLoader', 'ipadapter_file'),
    clipVisions: comboOptions(info, 'CLIPVisionLoader', 'clip_name'),
    taggers: comboOptions(info, 'WD14Tagger|pysssss', 'model'),
    nodeTypes: Object.keys(info),
  };
}
