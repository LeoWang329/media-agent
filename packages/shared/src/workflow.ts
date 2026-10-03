import type { ImageJobParams } from './types';

// ComfyUI 的 API 格式：节点号 → 节点类型和输入；连线写成 [节点号, 第几个输出]
export type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export const BUILTIN_WORKFLOW = { id: null, name: '内置流程', hash: '' };

// 内置流程，只用 ComfyUI 自带的节点，见 docs/dev-plan.md 5.18：
// 底模 → 每个 LoRA 一个、串起来 → clip skip → 正面、负面 → 空白画布 → 采样 → 解码 → 预览（不在 ComfyUI 那台机器上留文件）
export function builtinGraph(params: ImageJobParams, seed: number): ComfyGraph {
  const graph: ComfyGraph = {};
  const add = (class_type: string, inputs: Record<string, unknown>) => {
    const id = String(Object.keys(graph).length + 1);
    graph[id] = { class_type, inputs };
    return id;
  };
  const checkpoint = add('CheckpointLoaderSimple', { ckpt_name: params.checkpoint });
  let model = [checkpoint, 0];
  let clip = [checkpoint, 1];
  for (const lora of params.loras ?? []) {
    const id = add('LoraLoader', { lora_name: lora.name, strength_model: lora.strength, strength_clip: lora.strength, model, clip });
    model = [id, 0];
    clip = [id, 1];
  }
  const skip = add('CLIPSetLastLayer', { stop_at_clip_layer: -(params.clipSkip ?? 1), clip });
  const positive = add('CLIPTextEncode', { text: params.positive, clip: [skip, 0] });
  const negative = add('CLIPTextEncode', { text: params.negative, clip: [skip, 0] });
  const latent = add('EmptyLatentImage', { width: params.width, height: params.height, batch_size: 1 });
  const sampler = add('KSampler', {
    seed,
    steps: params.steps,
    cfg: params.cfg,
    sampler_name: params.sampler,
    scheduler: params.scheduler,
    denoise: 1,
    model,
    positive: [positive, 0],
    negative: [negative, 0],
    latent_image: [latent, 0],
  });
  const decode = add('VAEDecode', { samples: [sampler, 0], vae: [checkpoint, 2] });
  add('PreviewImage', { images: [decode, 0] });
  return graph;
}
