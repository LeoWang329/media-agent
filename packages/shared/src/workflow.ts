import type { ComfyGraph, FillTarget, ImageJobParams, ImportedWorkflow, WorkflowFill } from './types';

export const BUILTIN_WORKFLOW = { id: null, name: '内置流程', hash: '' };

// 内置流程用到的插件节点是哪个插件的：缺了告诉用户装哪个
export const PLUGIN_OF: Record<string, string> = { FaceDetailer: 'ComfyUI-Impact-Pack', UltralyticsDetectorProvider: 'ComfyUI-Impact-Subpack' };

// 放大后的尺寸：取 8 的倍数
export const scaledSize = (size: { width: number; height: number }, scale: number) => ({
  width: Math.round((size.width * scale) / 8) * 8,
  height: Math.round((size.height * scale) / 8) * 8,
});

// 内置流程，见 docs/dev-plan.md 5.18、5.21：
// 底模 → 每个 LoRA 一个、串起来 → clip skip → 正面、负面 → 空白画布 → 采样 → 解码 → 放大 → 部位重绘 → 预览（不在 ComfyUI 那台机器上留文件）。
// 放大、部位重绘开着才有；出完的图上补做的，从 input 那张传上去的图开始，不出新图
export function builtinGraph(params: ImageJobParams, seed: number, input?: { image: string }): ComfyGraph {
  const graph: ComfyGraph = {};
  const add = (class_type: string, inputs: Record<string, unknown>): Link => {
    const id = String(Object.keys(graph).length + 1);
    graph[id] = { class_type, inputs };
    return [id, 0];
  };
  const out = ([id]: Link, index: number): Link => [id, index];
  const checkpoint = add('CheckpointLoaderSimple', { ckpt_name: params.checkpoint });
  let model = checkpoint;
  let clip = out(checkpoint, 1);
  const vae = out(checkpoint, 2);
  for (const lora of params.loras ?? []) {
    const loaded = add('LoraLoader', { lora_name: lora.name, strength_model: lora.strength, strength_clip: lora.strength, model, clip });
    model = loaded;
    clip = out(loaded, 1);
  }
  const skip = add('CLIPSetLastLayer', { stop_at_clip_layer: -(params.clipSkip ?? 1), clip });
  const encode = (text: string) => add('CLIPTextEncode', { text, clip: skip });
  const positive = encode(params.positive);
  const negative = encode(params.negative);
  const sampling = { seed, steps: params.steps, cfg: params.cfg, sampler_name: params.sampler, scheduler: params.scheduler };
  const sample = (latent: Link, denoise: number) => add('VAEDecode', { samples: add('KSampler', { ...sampling, denoise, model, positive, negative, latent_image: latent }), vae });

  let image = input ? add('LoadImage', { image: input.image }) : sample(add('EmptyLatentImage', { width: params.width, height: params.height, batch_size: 1 }), 1);

  // 放大：放大模型放大后缩到出图尺寸乘倍数；重绘强度大于 0 再用同样的底模、提示词和种子画一遍
  if (params.upscale) {
    const { model: name, scale, denoise } = params.upscale;
    const upscaled = add('ImageUpscaleWithModel', { upscale_model: add('UpscaleModelLoader', { model_name: name }), image });
    image = add('ImageScale', { image: upscaled, upscale_method: 'lanczos', ...scaledSize(params, scale), crop: 'disabled' });
    if (denoise > 0) image = sample(add('VAEEncode', { pixels: image, vae }), denoise);
  }

  // 部位重绘：每道一个检测模型加一个 FaceDetailer，没写提示词的用原图的。segm/ 下的检测模型按轮廓重画，不用 SAM；别的参数照 E02
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
      positive: pass.positive ? encode(pass.positive) : positive,
      negative: pass.negative ? encode(pass.negative) : negative,
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
      ...(pass.detector.startsWith('segm/') && { segm_detector_opt: out(detector, 1) }),
    });
  }

  add('PreviewImage', { images: image });
  return graph;
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
