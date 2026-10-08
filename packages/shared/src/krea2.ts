import type { ComfyGraph, ImageJobParams, ImageSettings, KreaSettings } from './types';

export const FOUR_VIEW_INSTRUCTION =
  'Convert the character in the image to a Character Sheet showing a face close-up, front full body, side full body and back full body views';
// T01：ResolutionSelector 的 9:16、4 MP、8 的倍数（MP 按 1024² 算）。
export const KREA2_TEXT_SIZE = { width: 1536, height: 2728 };
export const KREA2_SIZES = [
  KREA2_TEXT_SIZE,
  { width: 1024, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1024, height: 1536 },
  { width: 2048, height: 1152 },
  { width: 1152, height: 2048 },
  { width: 2048, height: 2048 },
];

// 参数照生图实例上的 T01 / T10；ref_boost 保留 T10 的 1，实机对比之前不改成 4。
export function kreaDefaults(mode: KreaSettings['mode']): Partial<ImageSettings> {
  return {
    ...(mode === 'text' ? KREA2_TEXT_SIZE : { width: 1536, height: 1024 }),
    count: 1,
    checkpoint: mode === 'text' ? 'krea2/darkBeastINT8Convrot2_krea211INT8Convrot.safetensors' : 'krea/krea2_turbo_int8_convrot.safetensors',
    textEncoder: mode === 'text' ? 'qwen3vl_4b_uncensored_int8_convrot.safetensors' : 'qwen3vl_4b_fp8_scaled.safetensors',
    vae: 'qwen_image_vae.safetensors',
    loras: mode === 'text' ? [] : [{ name: 'krea2/krea2_4panel.safetensors', strength: 1 }],
    loraTarget: 'model',
    steps: mode === 'text' ? 8 : 10,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'simple',
    krea: { mode, reference: null, refBoost: 1, extra: '' },
  };
}

export const fourViewPrompt = (...extra: string[]) =>
  [
    FOUR_VIEW_INSTRUCTION,
    ...extra
      .map((s) =>
        s
          .trim()
          .replace(new RegExp(`^${FOUR_VIEW_INSTRUCTION}`), '')
          .trim(),
      )
      .filter(Boolean),
  ].join('\n\n');

// 保留原流程的节点接口；LoRA 串接到模型，四视图接上 target_latent，避免采样中途才加载 VAE。
export function kreaGraph(params: ImageJobParams, seed: number, image = ''): ComfyGraph {
  const graph: ComfyGraph = {};
  let next = 0;
  const add = (class_type: string, inputs: Record<string, unknown>): [string, number] => {
    const id = String(++next);
    graph[id] = { class_type, inputs };
    return [id, 0];
  };
  let model = add('UNETLoader', { unet_name: params.checkpoint, weight_dtype: 'default' });
  const clip = add('CLIPLoader', { clip_name: params.textEncoder, type: 'krea2', device: 'default' });
  const vae = add('VAELoader', { vae_name: params.vae });
  for (const lora of params.loras ?? []) model = add('LoraLoaderModelOnly', { model, lora_name: lora.name, strength_model: lora.strength });
  const four = params.krea?.mode === 'four-view';
  const latent = add(four ? 'EmptySD3LatentImage' : 'EmptyLatentImage', { width: params.width, height: params.height, batch_size: 1 });
  let positive: [string, number];
  let negative: [string, number];
  if (four) {
    const loaded = add('LoadImage', { image });
    const resized = add('ImageResizeKJv2', {
      image: loaded,
      width: 1024,
      height: 1024,
      upscale_method: 'lanczos',
      keep_proportion: 'resize',
      pad_color: '0, 0, 0',
      crop_position: 'center',
      divisible_by: 2,
      device: 'cpu',
    });
    const source = add('VAEEncode', { pixels: resized, vae });
    model = add('Krea2EditModelPatch', {
      model,
      source_latent: source,
      ref_boost: params.krea!.refBoost,
      ref_boost_a: 1,
      fit_mode: 'fit',
      vae,
      source_image: resized,
      target_latent: latent,
    });
    positive = add('Krea2EditGroundedEncode', { clip, prompt: params.positive, image: resized, grounding_px: 0, system_prompt: '' });
    negative = add('Krea2EditGroundedEncode', { clip, prompt: '', image: resized, grounding_px: 768, system_prompt: '' });
  } else {
    positive = add('CLIPTextEncode', { clip, text: params.positive });
    negative = add('ConditioningZeroOut', { conditioning: positive });
  }
  const sampled = add('KSampler', {
    model,
    positive,
    negative,
    latent_image: latent,
    seed,
    steps: params.steps,
    cfg: params.cfg,
    sampler_name: params.sampler,
    scheduler: params.scheduler,
    denoise: 1,
  });
  const decoded = add('VAEDecode', { samples: sampled, vae });
  add('PreviewImage', { images: decoded });
  return graph;
}
