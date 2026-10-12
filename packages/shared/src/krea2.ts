import { REAL_SCHEDULER } from './edit';
import { kreaDepthGraph } from './krea2Depth';
import { kreaRealGraph, REAL_STEPS, realModelsOf } from './krea2Real';
import { kreaRemixGraph } from './krea2Remix';
import type { ComfyGraph, ImageJobParams, ImageSettings, KreaSettings } from './types';

export const FOUR_VIEW_INSTRUCTION =
  'Convert the character in the image to a Character Sheet showing a face close-up, front full body, side full body and back full body views';

// 编辑档按参考图的比例缩放，长边缩到这么多再出图。V3 那个 LoRA 是 2048 训的：
// 原来照作者示例里的 FluxKontextImageScale 只有 1MP（880×1184），出图明显发糊，见 docs/reports/P23.md
export const KREA2_EDIT_LONG_SIDE = 2048;
// 参考图缩放的取整：SD3 那路潜变量要 16 的倍数
export const KREA2_EDIT_MULTIPLE = '16';
// 作者那张示例开的，实机对比也比关掉清楚（关掉那张脸更软）
export const OSTRIS_EDIT_KV_CACHE = true;

// 身份编辑 LoRA，T07 那个；只作为方案里的一个选项留着
export const EDIT_LORA = 'krea2/krea2_identity_edit_v1_1.safetensors';

// 「编辑」档的方案：一套 LoRA，可能带作者给的触发词和推荐参数，见 docs/dev-plan.md 5.37。
// 界面上选一个就把 LoRA 和参数填进去；之后手动改 LoRA 就不算这个方案了（服务端也是照 LoRA 反认方案，不另存字段）。
// 触发词和推荐值都是照作者在模型页上写的（动漫转真人那两档见 Civitai 2808492 和它的 V3 说明）。
export type KreaEditPreset = {
  id: string;
  label: string;
  loras: { name: string; strength: number }[];
  trigger?: string;
  settings?: Partial<Pick<ImageSettings, 'steps' | 'cfg'>>;
  note: string;
};

export const KREA2_EDIT_PRESETS: KreaEditPreset[] = [
  {
    id: 'real-v3',
    label: '动漫转真人 V3（默认）',
    loras: [{ name: 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', strength: 1 }],
    trigger: 'transform the image to realistic photograph',
    settings: { steps: 10, cfg: 1 },
    note: '放一张动漫/插画图转成真人照片。真机验过：写实、细节清楚、构图保住。触发词出图时自动加在框里那句话前面；作者建议强度 0.8–1.0。',
  },
  {
    id: 'real-v1',
    label: '动漫转真人 V1',
    loras: [{ name: 'krea2/Krea2_Anything2RealCharacters-V1.safetensors', strength: 1 }],
    trigger: 'transform the image to realistic photograph',
    settings: { steps: 10, cfg: 1 },
    note: '同作者的早期版本（V3 之前的），人物一致性比 V3 弱一点，换着对比用。',
  },
  {
    id: 'identity-v1-1',
    label: '身份编辑 v1.1（照 T07）',
    loras: [{ name: EDIT_LORA, strength: 1 }],
    note: '保住人物长相、改内容（换衣服这类）。这条路是给 Krea2Edit 插件那套训的，配 Ostris 这条没在真机上验过，试了再说。',
  },
  {
    id: 'identity-v1-2',
    label: '身份编辑 v1.2',
    loras: [{ name: 'krea2/krea2_identity_edit_v1_2.safetensors', strength: 1 }],
    note: '同上，v1.1 的新版，没在这条路上验过。',
  },
  {
    id: 'outfit',
    label: '换装（outfittransfer）',
    loras: [{ name: 'krea2/krea_outfittransfer.safetensors', strength: 1 }],
    note: '专门换衣服：框里写要换成什么（比如 a red leather jacket）。没在这条路上验过。',
  },
];

// 编辑档的默认就是第一个方案（动漫转真人 V3）
export const DEFAULT_EDIT_PRESET = KREA2_EDIT_PRESETS[0];

// 这一组 LoRA 是哪个方案（按名字比，强度自己改过也算）；都不是就是 null。服务端拿它决定要不要加触发词
export const editPresetOf = (loras: readonly { name: string; strength?: number }[] | undefined): KreaEditPreset | null => {
  const names = (loras ?? []).map((lora) => lora.name);
  return KREA2_EDIT_PRESETS.find((preset) => preset.loras.length === names.length && preset.loras.every((lora, i) => lora.name === names[i])) ?? null;
};

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

// 参数照生图实例上的 T01 / T10；四视图 T10。
// 编辑档走作者那套 Ostris（见 docs/dev-plan.md 5.37）：写实微调底模 + 去审查的文字理解 + 真人化 LoRA，
// 长边 2048、10 步、CFG 1。底模和编码器都能在出图设置里换。
// real 是转真人那一档（图像编辑节点的「转真人」功能，见 docs/krea2-real-usage.md）：标准 Moody Mix + FP8 文字理解，
// 8 步 / CFG 1 / euler / beta57、LoRA 不放这里（它要同时喂 CLIP，走 params.real.loras），宽高不起作用。
// depth / remix 是深度迁移和风格 Remix 那两档（见 krea2Depth.ts / krea2Remix.ts）：底模和文字理解都用跑通了的
// 那套（turbo fp8 / int8 + fp8 clip，不扩成「无审查」两档），8 步 / CFG 1 / euler / simple，LoRA 也不放这里
//（深度走控制类 LoRA、Remix 走 params.remix.lora）。**这两档的底模 / 文字理解由服务端 editParams 定死**，
// 这里的值只是兜底，好在 kreaDefaults('depth' | 'remix') 里显得出一个完整设置
export function kreaDefaults(mode: KreaSettings['mode']): Partial<ImageSettings> {
  const edit = mode === 'edit';
  const real = mode === 'real';
  const solid = mode === 'depth' || mode === 'remix';
  const preset = DEFAULT_EDIT_PRESET;
  const models = realModelsOf(true);
  return {
    // 深度迁移 / 风格 Remix 照真机那两张 JSON 都是 1024×1024（Remix 的出图尺寸跟参考图无关）
    ...(mode === 'text' ? KREA2_TEXT_SIZE : mode === 'four-view' ? { width: 1536, height: 1024 } : solid ? { width: 1024, height: 1024 } : { width: 1024, height: 1536 }),
    count: 1,
    checkpoint: real
      ? models.checkpoint
      : edit
        ? 'krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors'
        : solid
          ? mode === 'depth'
            ? 'krea2/krea2_turbo_fp8_scaled.safetensors'
            : 'krea2/krea2_turbo_int8_convrot.safetensors'
          : mode === 'text'
            ? 'krea2/darkBeastINT8Convrot2_krea211INT8Convrot.safetensors'
            : 'krea/krea2_turbo_int8_convrot.safetensors',
    textEncoder: real ? models.textEncoder : mode === 'four-view' || solid ? 'qwen3vl_4b_fp8_scaled.safetensors' : 'qwen3vl_4b_uncensored_int8_convrot.safetensors',
    vae: 'qwen_image_vae.safetensors',
    loras: real || solid ? [] : mode === 'text' ? [] : edit ? preset.loras.map((lora) => ({ ...lora })) : [{ name: 'krea2/krea2_4panel.safetensors', strength: 1 }],
    loraTarget: 'model',
    steps: mode === 'four-view' ? 10 : real || solid ? REAL_STEPS : edit ? (preset.settings?.steps ?? 10) : 8,
    cfg: 1,
    sampler: 'euler',
    scheduler: real ? REAL_SCHEDULER : 'simple',
    krea: { mode, reference: null, referenceB: null, refBoost: 1, refBoostA: 1, extra: '' },
  };
}

// 图像编辑节点上「指令编辑」用的那套：编辑档的接线（Ostris 那两个节点）+ 身份编辑 v1.1 的 LoRA，
// 底模 / 文字理解 / 步数照 5.37 那套编辑档的默认值。**不挂动漫转真人 V3**，所以不会自动加真人化触发词 ——
// 指令编辑是「改这张图」，不是转真人（转真人另开一条，见 docs/dev-plan.md 5.39）。
// 身份编辑那条照 T07，配 Ostris 这条路没在真机上验过，界面上要写一句「试了再说」。
export function kreaEditSetup(): Pick<ImageSettings, 'loras'> {
  const preset = KREA2_EDIT_PRESETS.find((item) => item.id === 'identity-v1-1')!;
  return { loras: preset.loras.map((lora) => ({ ...lora })) };
}

// 图像编辑节点上「换装」用的那套：接线跟指令编辑一模一样（编辑档那两个 Ostris 节点），只把 LoRA 换成换装那条。
// 挂在编辑档上就等于「只换衣服」，见 docs/dev-plan.md 5.39
export function kreaOutfitSetup(): Pick<ImageSettings, 'loras'> {
  const preset = KREA2_EDIT_PRESETS.find((item) => item.id === 'outfit')!;
  return { loras: preset.loras.map((lora) => ({ ...lora })) };
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

// 六个档六条路，见 docs/dev-plan.md 5.37、5.39：
// 文生图（T01）：自带节点；四视图（T10）：Krea2Edit 插件的两个节点；编辑：作者那套 Ostris 的两个节点；
// 转真人：照那台上的「Krea2转真人-全开关」，见 krea2Real.ts；
// 深度迁移：控制类三节点那一组，见 krea2Depth.ts；风格 Remix / 换人：Ostris 那条但只喂 model，见 krea2Remix.ts。
// 编辑档用 Ostris 是因为 Krea2Edit 那条路配写实/转真人 LoRA 会花（真机验过，见 docs/reports/P23.md）；
// 四视图没这个问题，保持不动。
type Link = [string, number];
type Add = (class_type: string, inputs: Record<string, unknown>) => Link;

// 底模 → LoRA（串起来）→ 文字理解、VAE：四条路共用的前半段。
// 转真人那条的 LoRA 不在这里（它要 model 和 clip 一起喂，走 params.real.loras，见 krea2Real.ts）
function kreaHead(add: Add, params: ImageJobParams) {
  let model = add('UNETLoader', { unet_name: params.checkpoint, weight_dtype: 'default' });
  const clip = add('CLIPLoader', { clip_name: params.textEncoder, type: 'krea2', device: 'default' });
  const vae = add('VAELoader', { vae_name: params.vae });
  for (const lora of params.loras ?? []) model = add('LoraLoaderModelOnly', { model, lora_name: lora.name, strength_model: lora.strength });
  return { model, clip, vae };
}

// 采样 → 解码 → 预览，三条路都这么收尾
function kreaTail(add: Add, model: Link, positive: Link, negative: Link, latent: Link, vae: Link, params: ImageJobParams, seed: number) {
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
  add('PreviewImage', { images: add('VAEDecode', { samples: sampled, vae }) });
}

// 编辑档：作者那套 Ostris（Krea2OstrisEditModelPatch + TextEncodeKrea2OstrisEdit），
// 给用 ai-toolkit 训的 edit LoRA 用（动漫转真人那类）。提示词和参考图一起过 Qwen3-VL 编码，
// 参考图先按比例缩到长边 2048（V3 是 2K 训的），出图尺寸跟着缩放后的参考图走 —— 面板上的尺寸这两档不用管。
// image 是图 1（场景）、imageB 是图 2（主体）；作者的双图触发词里 Figure 2 就是第二张
function kreaEditGraph(add: Add, model: Link, clip: Link, vae: Link, params: ImageJobParams, seed: number, image: string, imageB: string) {
  const patched = add('Krea2OstrisEditModelPatch', { model, kv_cache: OSTRIS_EDIT_KV_CACHE });
  const scale = (name: string) =>
    add('LayerUtility: ImageScaleByAspectRatio V2', {
      image: add('LoadImage', { image: name }),
      aspect_ratio: 'original',
      proportional_width: 1,
      proportional_height: 1,
      fit: 'crop',
      method: 'lanczos',
      round_to_multiple: KREA2_EDIT_MULTIPLE,
      scale_to_side: 'longest',
      scale_to_length: KREA2_EDIT_LONG_SIDE,
      background_color: '#000000',
    });
  const first = scale(image);
  const second = imageB ? scale(imageB) : null;
  const size = add('GetImageSize', { image: first });
  const latent = add('EmptySD3LatentImage', { width: size, height: [size[0], 1], batch_size: 1 });
  const encode = (prompt: string) => add('TextEncodeKrea2OstrisEdit', { clip, prompt, vae, image1: first, ...(second ? { image2: second } : {}) });
  kreaTail(add, patched, encode(params.positive), encode(''), latent, vae, params, seed);
}

// 四视图档：照 T10。参考图缩到 1024×1024，Krea2Edit 的两个节点把它当 source_latent，
// 从空潜变量重画（EmptySD3LatentImage），改哪儿由正面词决定。T10 的正面 grounding_px 是 0、负面 768
function kreaFourViewGraph(add: Add, model: Link, clip: Link, vae: Link, params: ImageJobParams, seed: number, image: string, imageB: string) {
  const latent = add('EmptySD3LatentImage', { width: params.width, height: params.height, batch_size: 1 });
  const resize = (name: string) =>
    add('ImageResizeKJv2', {
      image: add('LoadImage', { image: name }),
      width: 1024,
      height: 1024,
      upscale_method: 'lanczos',
      keep_proportion: 'resize',
      pad_color: '0, 0, 0',
      crop_position: 'center',
      divisible_by: 2,
      device: 'cpu',
    });
  const resized = resize(image);
  const second = imageB ? resize(imageB) : null;
  const patched = add('Krea2EditModelPatch', {
    model,
    source_latent: add('VAEEncode', { pixels: resized, vae }),
    ...(second ? { source_latent_b: add('VAEEncode', { pixels: second, vae }), source_image_b: second } : {}),
    ref_boost: params.krea!.refBoost,
    ref_boost_a: params.krea!.refBoostA ?? 1,
    fit_mode: 'fit',
    vae,
    source_image: resized,
    target_latent: latent,
  });
  const encode = (prompt: string, grounding_px: number) =>
    add('Krea2EditGroundedEncode', { clip, prompt, image: resized, ...(second ? { image_b: second } : {}), grounding_px, system_prompt: '' });
  kreaTail(add, patched, encode(params.positive, 0), encode('', 768), latent, vae, params, seed);
}

// 保留原流程的节点接口，见 docs/dev-plan.md 5.18、5.21
export function kreaGraph(params: ImageJobParams, seed: number, image = '', imageB = ''): ComfyGraph {
  const graph: ComfyGraph = {};
  let next = 0;
  const add: Add = (class_type, inputs) => {
    const id = String(++next);
    graph[id] = { class_type, inputs };
    return [id, 0];
  };
  const { model, clip, vae } = kreaHead(add, params);
  const mode = params.krea?.mode ?? 'text';
  if (mode === 'real') {
    kreaRealGraph(add, model, clip, vae, params, seed, image, imageB);
    return graph;
  }
  if (mode === 'depth') {
    kreaDepthGraph(add, model, clip, vae, params, seed, image);
    return graph;
  }
  if (mode === 'remix') {
    kreaRemixGraph(add, model, clip, vae, params, seed, image);
    return graph;
  }
  if (mode === 'edit') {
    kreaEditGraph(add, model, clip, vae, params, seed, image, imageB);
    return graph;
  }
  if (mode === 'four-view') {
    kreaFourViewGraph(add, model, clip, vae, params, seed, image, imageB);
    return graph;
  }
  const latent = add('EmptyLatentImage', { width: params.width, height: params.height, batch_size: 1 });
  const positive = add('CLIPTextEncode', { clip, text: params.positive });
  kreaTail(add, model, positive, add('ConditioningZeroOut', { conditioning: positive }), latent, vae, params, seed);
  return graph;
}
