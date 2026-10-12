import { REMIX_LORA, REMIX_STRENGTH } from './edit';
import type { ImageJobParams } from './types';

// 「风格 Remix / 换人」那张图，逐字照那台真机摸出来的 outputs/devcheck/w3-reid2.json 和 w3-remix2.json
//（两张图同一条接线，只换 lora_name）。见 docs/dev-plan.md 5.36 和 outputs/devcheck/w3-findings.md 第 3 节。
//
// 跟转真人（krea2Real.ts）同族，但不一条：
//   转真人   LoRA 同时喂 model 和 clip（LoraLoader）+ Easy_QwenEdit2509 编码，调度器 beta57，底模 int8 无审查
//   Remix   LoRA **只喂 model**（LoraLoaderModelOnly，照官方 krea2_reid_comfyui.json 的接法）
//           + TextEncodeKrea2OstrisEdit 编码，8 步 / CFG 1 / euler / **simple**，底模 turbo int8 convrot
//
// ★ 三处别改的契约（w3-findings.md 第 3 节「参数要点」，官方写明）：
//   1. LoraLoaderModelOnly 只喂 model，**不要**顺手换成 LoraLoader 把 clip 也喂上；
//   2. Krea2OstrisEditModelPatch.kv_cache 必须 true（这不是加速开关，是模型契约）；
//   3. 参考图先按总像素缩到 384×384 那个预算（0.140625 MP、16 的倍数）——出图尺寸跟参考图无关。

// 参考图的像素预算，照 JSON：384×384 总像素
export const REMIX_MEGAPIXELS = 0.140625;
export const REMIX_UPSCALE_METHOD = 'area';
export const REMIX_RESOLUTION_STEPS = 16;

// kv_cache：官方契约要求 true，别关
export const REMIX_KV_CACHE = true;
// 参考潜变量的接法，两个参考接法节点都是这个（跟转真人那份一样）
export const REMIX_REFERENCE_METHOD = 'index_timestep_zero';

type Link = [string, number];
type Add = (class_type: string, inputs: Record<string, unknown>) => Link;

// 风格 Remix / 换人那张图：image 是槽位里选中的那张（参考图），params.remix.lora 是挂哪条、多强。
// 两个候选（换人 / RealCosplay）接线一模一样，只换 lora_name
export function kreaRemixGraph(add: Add, model: Link, clip: Link, vae: Link, params: ImageJobParams, seed: number, image: string) {
  const lora = params.remix?.lora ?? { name: REMIX_LORA, strength: REMIX_STRENGTH };
  // ★ 名字必须带 `krea2/` 前缀，少了会在提交阶段被 value_not_in_list 拒掉（真机上踩过）
  const tuned = add('LoraLoaderModelOnly', { model, lora_name: lora.name, strength_model: lora.strength });
  const patched = add('Krea2OstrisEditModelPatch', { model: tuned, kv_cache: REMIX_KV_CACHE });
  // 参考图：按总像素缩到 384×384 那个预算，两个编码节点共用同一张
  const reference = add('ImageScaleToTotalPixels', {
    image: add('LoadImage', { image }),
    upscale_method: REMIX_UPSCALE_METHOD,
    megapixels: REMIX_MEGAPIXELS,
    resolution_steps: REMIX_RESOLUTION_STEPS,
  });
  // 正面 = 框里那句话，负面 = 空；两个都接参考图，再各接一个参考潜变量接法节点（不是 ConditioningZeroOut）
  const encode = (prompt: string) => add('TextEncodeKrea2OstrisEdit', { clip, vae, image1: reference, image2: null, image3: null, prompt });
  const condition = (conditioning: Link) => add('FluxKontextMultiReferenceLatentMethod', { conditioning, reference_latents_method: REMIX_REFERENCE_METHOD });
  // 出图尺寸是出图设置的宽高（服务端 editParams 填的是 1024×1024），**跟参考图无关**
  const latent = add('EmptyLatentImage', { width: params.width, height: params.height, batch_size: 1 });
  const sampled = add('KSampler', {
    model: patched,
    positive: condition(encode(params.positive)),
    negative: condition(encode('')),
    latent_image: latent,
    seed,
    steps: params.steps,
    cfg: params.cfg,
    sampler_name: params.sampler,
    scheduler: params.scheduler,
    denoise: 1,
  });
  add('PreviewImage', { images: add('VAEDecode', { samples: sampled, vae }) });
}
