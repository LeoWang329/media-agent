import { DEPTH_LORA, DEPTH_STRENGTH, REAL_VAE } from './edit';
import type { ImageJobParams } from './types';

// 「深度迁移」那张图，逐字照那台真机摸出来的 outputs/devcheck/w3-depth.json（14 个节点）。
// 见 docs/dev-plan.md 5.39 和 outputs/devcheck/w3-findings.md 第 1 节。
//
// 这条路跟转真人（krea2Real.ts）、指令编辑（krea2.ts 的 kreaEditGraph）都不是一条：
// 它是**控制类三节点一组**（facok/comfyui-krea2-controlnet）——
//   UNETLoader → Krea2ControlLoRALoader → Krea2ControlApply → KSampler.model
//   槽位那张图 → DepthAnythingV2Preprocessor → Krea2ControlImageEncode → Apply.control_latent
// 底模 / 文字理解 / VAE 由 kreaGraph 的头接好（model、clip、vae 就是它的输出）；
// 底模用 turbo fp8（不是 int8 —— int8 那条是 Remix / 转真人用的），8 步 / CFG 1 / euler / simple，
// 尺寸跟出图设置的宽高走（服务端 editParams 填的是 1024×1024，跟 JSON 一样）。

// 控制强度默认 1（照 JSON）。**不能填 0**：strength=0 时 loader 不注册采样 wrapper，
// Krea2ControlApply 会抛「must receive the MODEL output from Krea2 Control LoRA Loader.」（真机踩过，见 w3-depth0.json）
export const DEPTH_MIN_STRENGTH = 0.1;

// DepthAnythingV2Preprocessor 的 ckpt_name 和 resolution，照 JSON。
// ckpt_name 必须填下拉里的值，拼错会在提交阶段被拒
export const DEPTH_CKPT = 'depth_anything_v2_vitl.pth';
export const DEPTH_RESOLUTION = 1024;

// Krea2ControlImageEncode 上那几个别改的参数：resize 官方推荐保持默认（把控制图缩到跟 latent 对齐），
// channel_mode / normalize 是深度图官方给的起点，invert=false 是「深度图近处发白」那种
export const DEPTH_RESIZE = 'match_latent_size';
export const DEPTH_UPSCALE_METHOD = 'lanczos';
export const DEPTH_CROP = 'center';
export const DEPTH_CHANNEL_MODE = 'grayscale';
export const DEPTH_NORMALIZE = 'per_image_minmax';
export const DEPTH_BATCH_MODE = 'independent_images';

type Link = [string, number];
type Add = (class_type: string, inputs: Record<string, unknown>) => Link;

// 深度迁移那张图：image 是槽位里选中的那张（要迁移的图），params.remix.controlStrength 是控制强度。
// 控制强度缺了就用默认的 1（「同样参数再来」照 params 发，老任务里没有这一项）
export function kreaDepthGraph(add: Add, model: Link, clip: Link, vae: Link, params: ImageJobParams, seed: number, image: string) {
  // ① 控制类 LoRA：UNETLoader → Krea2ControlLoRALoader →（接上控制潜变量）Krea2ControlApply → KSampler.model
  const control = add('Krea2ControlLoRALoader', {
    model,
    lora_name: DEPTH_LORA,
    strength: params.remix?.controlStrength ?? DEPTH_STRENGTH,
  });
  // ② 控制图：槽位那张图提取深度 → 编码成控制潜变量
  const depth = add('DepthAnythingV2Preprocessor', {
    image: add('LoadImage', { image }),
    ckpt_name: DEPTH_CKPT,
    resolution: DEPTH_RESOLUTION,
  });
  // ③ 空白画布：★ 同一个 latent 必须同时喂 Krea2ControlImageEncode.latent 和 KSampler.latent_image，
  // 官方 README 明确写了；不接会按别的尺寸对齐（见 w3-findings.md 第 1 节的「参数要点」）
  const latent = add('EmptyLatentImage', { width: params.width, height: params.height, batch_size: 1 });
  const controlLatent = add('Krea2ControlImageEncode', {
    control_image: depth,
    vae,
    resize: DEPTH_RESIZE,
    upscale_method: DEPTH_UPSCALE_METHOD,
    crop: DEPTH_CROP,
    channel_mode: DEPTH_CHANNEL_MODE,
    normalize: DEPTH_NORMALIZE,
    invert: false,
    batch_mode: DEPTH_BATCH_MODE,
    latent,
  });
  const applied = add('Krea2ControlApply', { model: control, control_latent: controlLatent });
  // ④ 正负面走普通 CLIPTextEncode（不是 Ostris 那两个）：正面=框里那句话，负面=空
  const positive = add('CLIPTextEncode', { clip, text: params.positive });
  const negative = add('CLIPTextEncode', { clip, text: '' });
  const sampled = add('KSampler', {
    model: applied,
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
  add('PreviewImage', { images: add('VAEDecode', { samples: sampled, vae }) });
}

// 深度迁移这一档的 VAE：跟转真人共用 qwen_image_vae.safetensors（JSON 里就是它）
export const DEPTH_VAE = REAL_VAE;
