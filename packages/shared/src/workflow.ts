import { NO_PREPROCESSOR, unionType } from './imageDefaults';
import type { ComfyGraph, FillTarget, ImageJobParams, ImportedWorkflow, WorkflowFill } from './types';

export const BUILTIN_WORKFLOW = { id: null, name: '内置流程', hash: '' };

// 内置流程用到的插件节点是哪个插件的：缺了告诉用户装哪个。部位重绘用前三个，ControlNet 的提取用 AIO_Preprocessor，A1111 的权重算法用 BNK_CLIPTextEncodeAdvanced；
// 后面的是长视频流程用的，见 docs/dev-plan.md 5.26
export const PLUGIN_OF: Record<string, string> = {
  Krea2EditModelPatch: 'ComfyUI-Krea2Edit',
  Krea2EditGroundedEncode: 'ComfyUI-Krea2Edit',
  // 编辑档走的那套（作者给 ai-toolkit 训的 edit LoRA 用的），见 docs/dev-plan.md 5.37
  Krea2OstrisEditModelPatch: 'ComfyUI-Krea2-Ostris-Edit（ostris/ComfyUI-Krea2-Ostris-Edit）',
  TextEncodeKrea2OstrisEdit: 'ComfyUI-Krea2-Ostris-Edit（ostris/ComfyUI-Krea2-Ostris-Edit）',
  'LayerUtility: ImageScaleByAspectRatio V2': 'ComfyUI_LayerStyle',
  ImageResizeKJv2: 'ComfyUI-KJNodes',
  FaceDetailer: 'ComfyUI-Impact-Pack',
  SAMLoader: 'ComfyUI-Impact-Pack',
  RemoveNoiseMask: 'ComfyUI-Impact-Pack',
  UltralyticsDetectorProvider: 'ComfyUI-Impact-Subpack',
  AIO_Preprocessor: 'comfyui_controlnet_aux',
  BNK_CLIPTextEncodeAdvanced: 'ComfyUI_ADV_CLIP_emb',
  MMH3ReferenceMultiPrompt: 'ComfyUI-MMH3Tools',
  MMH3CondSelect: 'ComfyUI-MMH3Tools',
  MMH3LoopingSampler: 'ComfyUI-MMH3Tools',
  MMH3StreamingSave: 'ComfyUI-MMH3Tools',
  MMH3TrimAV: 'ComfyUI-MMH3Tools',
  MMH3ConcatAV: 'ComfyUI-MMH3Tools',
  MiniMaxH3NativeLatentCheckpointSaveT8Advanced: 'comfyui-minimax-h3-audio-T8',
  MiniMaxH3NativeLatentCheckpointLoadT8Advanced: 'comfyui-minimax-h3-audio-T8',
  MiniMaxLowVRAMAttention: 'ComfyUI-KJNodes',
  MiniMaxChunkFeedForward: 'ComfyUI-KJNodes',
  ImageTensorList: 'ComfyUI-KJNodes',
  MinimaxH3LatentUpscaler3D: 'Comfyui_Minimax_h3_latent_Upscaler',
  VHS_LoadVideo: 'ComfyUI-VideoHelperSuite',
  // SelfLift 接续那套用的，见 docs/dev-plan.md 5.32：编码和上下文用 H3 官方的插件，采样器用 SelfLift 那个插件，
  // 接缝声音羽化用作者给的那个（刻度填 0 就不接、不装也能跑）
  MiniMaxH3ReferenceToVideo: 'ComfyUI-MiniMax-H3（H3 官方节点包）',
  MiniMaxH3AddGuide: 'ComfyUI-MiniMax-H3（H3 官方节点包）',
  SelfLiftH3Sampler: 'comfyui-SelfLift',
  MiniMaxH3AudioGuideFeather: 'ComfyUI-MiniMax-H3-Audio-Guide-Feather（wjc573/ComfyUI-MiniMax-H3-Audio-Guide-Feather）',
  // 局部重绘只裁一块、拼回去那对节点是插件带的，见 docs/dev-plan.md 5.38；InpaintModelConditioning 是 ComfyUI 自带的
  InpaintCropImproved: 'ComfyUI-Inpaint-CropAndStitch',
  InpaintStitchImproved: 'ComfyUI-Inpaint-CropAndStitch',
  // 转真人那一档（图像编辑节点的「转真人」功能）用的，见 docs/dev-plan.md 5.39、docs/krea2-real-usage.md：
  // 主图那个编码节点是作者的，反推那三个是 llama.cpp 那个插件；ColorCorrect 在 art-venture 里（跟 LayerStyle 不是一个包）。
  // FluxKontextMultiReferenceLatentMethod 是 ComfyUI 本体自带的（Comfy-Org/ComfyUI#9356 加的），报这句是让人升级本体。
  // 这几条 2026-10-11 照那台实例的 object_info 的 python_module 核过一遍
  Easy_QwenEdit2509: 'easy_qwenEdit_2509（cardenluo/easy_qwenEdit_2509）',
  'ShowText|pysssss': 'ComfyUI-Custom-Scripts',
  FluxKontextMultiReferenceLatentMethod: 'ComfyUI 本体（升级到带 Flux Kontext / Krea2 支持的那版）',
  llama_cpp_model_loader: 'llama-cpp_vllm（那台上装的这个；节点模块名 custom_nodes.llama-cpp_vllm）',
  llama_cpp_parameters: 'llama-cpp_vllm（那台上装的这个；节点模块名 custom_nodes.llama-cpp_vllm）',
  llama_cpp_instruct_adv: 'llama-cpp_vllm（那台上装的这个；节点模块名 custom_nodes.llama-cpp_vllm）',
  ColorCorrect: 'comfyui-art-venture（ArtVenture/Post Processing）',
  // 深度迁移那一档（图像编辑节点的「深度迁移」功能）用的，见 docs/dev-plan.md 5.39、krea2Depth.ts：
  // 控制类三节点是 facok 那个包，深度提取是 controlnet_aux（跟上面的 AIO_Preprocessor 同一个包）。
  // 这几条 2026-10-12 照那台实例 object_info 的 python_module 核过一遍：
  // comfyui-krea2-controlnet / comfyui_controlnet_aux。
  // 风格 Remix 那条图里没有新节点（LoraLoaderModelOnly、TextEncodeKrea2OstrisEdit 上面都有了）；
  // ImageScaleToTotalPixels 是 ComfyUI 本体（comfy_extras），缺了要升级本体，不是插件，所以不列
  Krea2ControlLoRALoader: 'comfyui-krea2-controlnet（facok/comfyui-krea2-controlnet）',
  Krea2ControlImageEncode: 'comfyui-krea2-controlnet（facok/comfyui-krea2-controlnet）',
  Krea2ControlApply: 'comfyui-krea2-controlnet（facok/comfyui-krea2-controlnet）',
  DepthAnythingV2Preprocessor: 'comfyui_controlnet_aux',
};
export const DETAILER_NODES = ['FaceDetailer', 'UltralyticsDetectorProvider'];

// 放大后的尺寸：取 8 的倍数
export const scaledSize = (size: { width: number; height: number }, scale: number) => ({
  width: Math.round((size.width * scale) / 8) * 8,
  height: Math.round((size.height * scale) / 8) * 8,
});

// 内置流程，见 docs/dev-plan.md 5.18、5.21：
// 底模（单独选了 VAE 的另外加载）→ 每个 LoRA 一个、串起来 → clip skip → 正面、负面 → ControlNet → 空白画布 → 采样 → 解码 → 放大 → 部位重绘 → 预览（不在 ComfyUI 那台机器上留文件）。
// 放大、部位重绘、ControlNet 开着才有。LoRA 只作用在画图的模型上时文字理解用底模原来的；A1111 的权重算法换一种编码节点。
// uploaded 是传上去的图在 ComfyUI 上的名字：
// image 是出完的图上补做的那张，从它开始、不出新图；controls 是各个 ControlNet 的参考图，和 params.controls 一一对应
export function builtinGraph(params: ImageJobParams, seed: number, uploaded: { image?: string; controls?: string[] } = {}): ComfyGraph {
  const graph: ComfyGraph = {};
  const add = (class_type: string, inputs: Record<string, unknown>): Link => {
    const id = String(Object.keys(graph).length + 1);
    graph[id] = { class_type, inputs };
    return [id, 0];
  };
  const out = ([id]: Link, index: number): Link => [id, index];
  const { model, clip: skip, vae, positive, negative } = encodeHead(add, out, params);

  // ControlNet：参考图提取成姿势图、深度图这些（不提取的直接用），按顺序接在正负面后面。采样和放大重画用接好的，部位重绘用原来的
  let guided = { positive, negative };
  for (const [i, control] of (params.controls ?? []).entries()) {
    const loaded = add('LoadImage', { image: uploaded.controls?.[i] ?? '' });
    const hint =
      control.preprocessor === NO_PREPROCESSOR
        ? loaded
        : add('AIO_Preprocessor', { image: loaded, preprocessor: control.preprocessor, resolution: Math.min(params.width, params.height) });
    let net = add('ControlNetLoader', { control_net_name: control.model });
    if (/union/i.test(control.model)) net = add('SetUnionControlNetType', { control_net: net, type: unionType(control) });
    const applied = add('ControlNetApplyAdvanced', {
      positive: guided.positive,
      negative: guided.negative,
      control_net: net,
      image: hint,
      strength: control.strength,
      start_percent: control.start,
      end_percent: control.end,
    });
    guided = { positive: applied, negative: out(applied, 1) };
  }

  const sampling = { seed, steps: params.steps, cfg: params.cfg, sampler_name: params.sampler, scheduler: params.scheduler };
  const sample = (latent: Link, denoise: number) =>
    add('VAEDecode', { samples: add('KSampler', { ...sampling, denoise, model, ...guided, latent_image: latent }), vae });

  let image =
    uploaded.image !== undefined
      ? add('LoadImage', { image: uploaded.image })
      : sample(add('EmptyLatentImage', { width: params.width, height: params.height, batch_size: 1 }), 1);

  // 放大：放大模型放大后缩到出图尺寸乘倍数；重绘强度大于 0 再用同样的底模、提示词和种子画一遍
  if (params.upscale) {
    const { model: name, scale, denoise } = params.upscale;
    const upscaled = add('ImageUpscaleWithModel', { upscale_model: add('UpscaleModelLoader', { model_name: name }), image });
    image = add('ImageScale', { image: upscaled, upscale_method: 'lanczos', ...scaledSize(params, scale), crop: 'disabled' });
    if (denoise > 0) image = sample(add('VAEEncode', { pixels: image, vae }), denoise);
  }

  // 部位重绘：每道一个检测模型加一个 FaceDetailer，没写提示词的用原图的。选了 SAM 的用它把框收成形状；
  // 没选的，segm/ 下的检测模型按轮廓重画（两个都给的话 FaceDetailer 只用 SAM）。别的参数照 E02
  for (const pass of params.details ?? []) {
    const detector = add('UltralyticsDetectorProvider', { model_name: pass.detector });
    image = add('FaceDetailer', {
      image,
      model,
      clip: skip,
      vae,
      guide_size: pass.guideSize,
      guide_size_for: true,
      max_size: 1024,
      ...sampling,
      positive: pass.positive ? encodeWith(add, skip, params, pass.positive) : positive,
      negative: pass.negative ? encodeWith(add, skip, params, pass.negative) : negative,
      denoise: pass.denoise,
      feather: 5,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: pass.threshold,
      bbox_dilation: 10,
      bbox_crop_factor: 3,
      sam_detection_hint: 'center-1',
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: 'False',
      drop_size: 10,
      bbox_detector: detector,
      wildcard: '',
      cycle: 1,
      noise_mask_feather: 20,
      ...(pass.sam
        ? { sam_model_opt: add('SAMLoader', { model_name: pass.sam, device_mode: 'AUTO' }) }
        : pass.detector.startsWith('segm/') && { segm_detector_opt: out(detector, 1) }),
    });
  }

  add('PreviewImage', { images: image });
  return graph;
}

// InpaintCropImproved 的参数，照实例上那个调好的 E05，见 docs/dev-plan.md 5.38。24 个必填项全给；
// 动过默认值的三处是 mask_expand_pixels（0→8）、output_target_width/height（512→1024）。
// context_from_mask_extend_factor 1.2 是「裁的时候在掩码外多留 20% 上下文」，接缝能接上靠它
export const INPAINT_CROP = {
  downscale_algorithm: 'bilinear',
  upscale_algorithm: 'bicubic',
  preresize: false,
  preresize_mode: 'ensure minimum resolution',
  preresize_min_width: 1024,
  preresize_min_height: 1024,
  preresize_max_width: 16384,
  preresize_max_height: 16384,
  mask_fill_holes: true,
  mask_expand_pixels: 8,
  mask_invert: false,
  mask_blend_pixels: 32,
  mask_hipass_filter: 0.1,
  extend_for_outpainting: false,
  extend_up_factor: 1,
  extend_down_factor: 1,
  extend_left_factor: 1,
  extend_right_factor: 1,
  context_from_mask_extend_factor: 1.2,
  output_resize_to_target_size: true,
  output_target_width: 1024,
  output_target_height: 1024,
  output_padding: '32',
  device_mode: 'cpu (compatible)',
};

// 局部重绘，见 docs/dev-plan.md 5.38：底图和掩码是同一张 PNG，掩码走它的 alpha 通道（只改了透明度，颜色照留）。
// 照 E05：只裁遮罩附近一块重画，再拼回原图 —— 「遮罩外一个像素不动」是这个算法保证的。
// uploaded.mask 是那张抠过透明的 PNG 在 ComfyUI 上的名字；denoise 是重绘强度（默认 1，调到 0.5 到 0.8 保留原来的轮廓）
// 局部重绘，见 docs/dev-plan.md 5.38。**底图和掩码分成两张传**（image 就是原图、mask 是
// 「要重画处 alpha=0」的那张 PNG）：ComfyUI 的 LoadImage 会把 RGBA 按 alpha 合成到黑底上，
// 所以「一张 PNG 同时当底图和掩码」时，要重画那块在底图里永远是黑的（2026-10-12 真机上验的）。
// 只给了掩码、没给底图时还照老路走（那时候底图就是那张掩码 PNG 本身）。
export function inpaintGraph(params: ImageJobParams, seed: number, uploaded: { mask?: string; image?: string } = {}): ComfyGraph {
  const graph: ComfyGraph = {};
  const add = (class_type: string, inputs: Record<string, unknown>): Link => {
    const id = String(Object.keys(graph).length + 1);
    graph[id] = { class_type, inputs };
    return [id, 0];
  };
  const out = ([id]: Link, index: number): Link => [id, index];
  const { model, clip: skip, vae, positive, negative } = encodeHead(add, out, params);
  const loaded = add('LoadImage', { image: uploaded.image ?? uploaded.mask ?? '' });
  // 分两张时：掩码那张 PNG 的 alpha 就是掩码，LoadImage 的 MASK 输出正好是「1 − alpha」——
  // 要重画的地方（alpha=0）是 1，正是 InpaintCropImproved 要的。IMAGE 输出只有三通道，取不了 alpha
  const mask = uploaded.image ? out(add('LoadImage', { image: uploaded.mask ?? '' }), 1) : out(loaded, 1);
  const crop = add('InpaintCropImproved', { image: loaded, mask, ...INPAINT_CROP });
  const conditioned = add('InpaintModelConditioning', {
    positive,
    negative,
    vae,
    pixels: out(crop, 1),
    mask: out(crop, 2),
    noise_mask: true,
  });
  const sampled = add('KSampler', {
    seed,
    steps: params.steps,
    cfg: params.cfg,
    sampler_name: params.sampler,
    scheduler: params.scheduler,
    denoise: params.inpaint?.denoise ?? 1,
    model,
    positive: out(conditioned, 0),
    negative: out(conditioned, 1),
    latent_image: out(conditioned, 2),
  });
  const stitched = add('InpaintStitchImproved', { stitcher: out(crop, 0), inpainted_image: add('VAEDecode', { samples: sampled, vae }) });
  add('PreviewImage', { images: stitched });
  return graph;
}

// 底模、LoRA、clip skip、正负面：内置流程和局部重绘共用的前半段
function encodeHead(add: (class_type: string, inputs: Record<string, unknown>) => Link, out: (link: Link, index: number) => Link, params: ImageJobParams) {
  const checkpoint = add('CheckpointLoaderSimple', { ckpt_name: params.checkpoint });
  let model = checkpoint;
  let clip = out(checkpoint, 1);
  const vae = params.vae ? add('VAELoader', { vae_name: params.vae }) : out(checkpoint, 2);
  for (const lora of params.loras ?? []) {
    if (params.loraTarget === 'model') {
      model = add('LoraLoaderModelOnly', { lora_name: lora.name, strength_model: lora.strength, model });
      continue;
    }
    const loaded = add('LoraLoader', { lora_name: lora.name, strength_model: lora.strength, strength_clip: lora.strength, model, clip });
    model = loaded;
    clip = out(loaded, 1);
  }
  const skip = add('CLIPSetLastLayer', { stop_at_clip_layer: -(params.clipSkip ?? 1), clip });
  return {
    model,
    clip: skip,
    vae,
    positive: encodeWith(add, skip, params, params.positive),
    negative: encodeWith(add, skip, params, params.negative),
  };
}

// A1111 的权重算法换一种编码节点，见 docs/dev-plan.md 5.21
function encodeWith(add: (class_type: string, inputs: Record<string, unknown>) => Link, clip: Link, params: ImageJobParams, text: string): Link {
  return params.weighting === 'a1111'
    ? add('BNK_CLIPTextEncodeAdvanced', { text, clip, token_normalization: 'none', weight_interpretation: 'A1111' })
    : add('CLIPTextEncode', { text, clip });
}

// ─── 导入的工作流，见 docs/dev-plan.md 5.18 ───

type Link = [string | number, number];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isLink = (value: unknown): value is Link =>
  Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number';
const byNodeId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const sortedNodes = (graph: ComfyGraph) => Object.entries(graph).sort(([a], [b]) => byNodeId(a, b));

// 文件导不进来的原因：不是 JSON、是普通的工作流文件（顶层有 nodes、links）、别的格式
export type WorkflowFileProblem = 'json' | 'ui' | 'format';

// 只认 API 格式，就是 ComfyUI 里「导出（API）」存下来的，顶层是「节点号 → {class_type, inputs}」
export function parseWorkflowGraph(data: unknown): { graph: ComfyGraph } | { problem: 'ui' | 'format' } {
  if (!isObject(data)) return { problem: 'format' };
  if (Array.isArray(data.nodes) && Array.isArray(data.links)) return { problem: 'ui' };
  const nodes = Object.values(data);
  if (!nodes.length || !nodes.every((node) => isObject(node) && typeof node.class_type === 'string' && isObject(node.inputs))) return { problem: 'format' };
  return { graph: data as ComfyGraph };
}

export function parseWorkflowFile(text: string): { graph: ComfyGraph } | { problem: WorkflowFileProblem } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { problem: 'json' };
  }
  return parseWorkflowGraph(data);
}

// 工作流里能填的地方，认不准时列出来让人挑：提示词是值为文字、名字带 text、prompt 或 string 的输入；
// 种子是值为数、名字带 seed 的输入；尺寸是 width、height 都是数的节点
export type WorkflowSlots = { prompts: FillTarget[]; seeds: FillTarget[]; sizes: string[] };

export function workflowSlots(graph: ComfyGraph): WorkflowSlots {
  const nodes = sortedNodes(graph);
  const inputs = (pick: (name: string, value: unknown) => boolean) =>
    nodes.flatMap(([node, { inputs }]) => Object.keys(inputs).flatMap((input) => (pick(input, inputs[input]) ? [{ node, input }] : [])));
  return {
    prompts: inputs((name, value) => typeof value === 'string' && /text|prompt|string/i.test(name)),
    seeds: inputs((name, value) => typeof value === 'number' && /seed/i.test(name)),
    sizes: nodes.filter(([, { inputs }]) => typeof inputs.width === 'number' && typeof inputs.height === 'number').map(([node]) => node),
  };
}

// 自动认出来的候选，每一项只有一个时就用它：
// 正面、负面顺着各节点的 positive、negative 连线往上找，找到写着文字的 text 为止；中间隔着 ControlNet、合并条件这类节点时，
// 有同名输入的走同名的，没有的走名字带 conditioning 的。种子是 KSampler 的 seed、KSamplerAdvanced 的 noise_seed；尺寸是 EmptyLatentImage 这类空白画布
export type FillGuess = { positive: FillTarget[]; negative: FillTarget[]; seed: FillTarget[]; size: string[] };

const SAMPLER_SEEDS: Record<string, string> = { KSampler: 'seed', KSamplerAdvanced: 'noise_seed' };

export function guessFill(graph: ComfyGraph): FillGuess {
  const nodes = sortedNodes(graph);
  const texts = (role: 'positive' | 'negative') => {
    const found = new Set<string>();
    for (const [, { inputs }] of nodes) {
      const link = inputs[role];
      if (isLink(link)) for (const id of textsAbove(graph, link, role, new Set())) found.add(id);
    }
    return [...found].sort(byNodeId).map((node) => ({ node, input: 'text' }));
  };
  return {
    positive: texts('positive'),
    negative: texts('negative'),
    seed: nodes.flatMap(([node, { class_type, inputs }]) => {
      const input = SAMPLER_SEEDS[class_type];
      return input && typeof inputs[input] === 'number' ? [{ node, input }] : [];
    }),
    size: nodes.filter(([, { class_type, inputs }]) => /^Empty.*Latent/.test(class_type) && typeof inputs.width === 'number' && typeof inputs.height === 'number').map(([node]) => node),
  };
}

function textsAbove(graph: ComfyGraph, link: Link, role: 'positive' | 'negative', seen: Set<string>): string[] {
  const id = String(link[0]);
  const node = graph[id];
  if (!node || seen.has(id)) return [];
  seen.add(id);
  if (typeof node.inputs.text === 'string') return [id];
  const links = Object.entries(node.inputs).filter((entry): entry is [string, Link] => isLink(entry[1]));
  const same = links.filter(([name]) => name === role);
  return (same.length ? same : links.filter(([name]) => /conditioning/i.test(name))).flatMap(([, next]) => textsAbove(graph, next, role, seen));
}

// 四项都只认出一个，导入窗口里直接列出来，不用挑
export const guessIsSure = (guess: FillGuess) => [guess.positive, guess.negative, guess.seed, guess.size].every((list) => list.length === 1);

// 挑好的往哪填：尺寸挑的是节点，填它的 width、height
export type FillChoice = { positive: FillTarget; negative: FillTarget | null; seed: FillTarget | null; size: string | null };

export function toFill({ size, ...rest }: FillChoice): WorkflowFill {
  return { ...rest, width: size ? { node: size, input: 'width' } : null, height: size ? { node: size, input: 'height' } : null };
}

// 往哪填和工作流对不对得上：节点要有这一项，提示词那几项原来是文字，种子和尺寸原来是数。对得上是 null
export function fillProblem(graph: ComfyGraph, fill: WorkflowFill): string | null {
  const checks: [string, FillTarget | null, 'string' | 'number'][] = [
    ['正面提示词', fill.positive, 'string'],
    ['负面提示词', fill.negative, 'string'],
    ['种子', fill.seed, 'number'],
    ['宽', fill.width, 'number'],
    ['高', fill.height, 'number'],
  ];
  for (const [what, target, type] of checks) {
    if (target && typeof graph[target.node]?.inputs[target.input] !== type) {
      return `${what}要填的 ${target.node} 号节点的 ${target.input} 在工作流里不是${type === 'string' ? '文字' : '数'}`;
    }
  }
  return null;
}

// 用导入的工作流出一张：只换正面、负面、种子、尺寸这几项，别的照原样
export function importedGraph(workflow: Pick<ImportedWorkflow, 'graph' | 'fill'>, params: ImageJobParams, seed: number): ComfyGraph {
  const graph = JSON.parse(JSON.stringify(workflow.graph)) as ComfyGraph;
  const set = (target: FillTarget | null, value: unknown) => {
    if (target) graph[target.node].inputs[target.input] = value;
  };
  set(workflow.fill.positive, params.positive);
  set(workflow.fill.negative, params.negative);
  set(workflow.fill.seed, seed);
  set(workflow.fill.width, params.width);
  set(workflow.fill.height, params.height);
  return graph;
}

// 工作流里有、这台 ComfyUI 上没装的节点类型，按节点号排
export function missingNodeTypes(graph: ComfyGraph, installed: Iterable<string>): string[] {
  const have = new Set(installed);
  return [...new Set(sortedNodes(graph).map(([, node]) => node.class_type))].filter((type) => !have.has(type));
}
