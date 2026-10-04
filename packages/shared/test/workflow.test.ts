import { describe, expect, it } from 'vitest';
import {
  fillProblem,
  guessFill,
  guessIsSure,
  importedGraph,
  missingNodeTypes,
  parseWorkflowFile,
  toFill,
  workflowSlots,
  type ComfyGraph,
  type ImageJobParams,
} from '../src';

// ComfyUI 自带的文生图导出（API）的样子：4 底模、6 正面、7 负面、5 空白画布、3 采样、8 解码、9 存图
const basic: ComfyGraph = {
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 156680208700286, steps: 20, cfg: 8, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    _meta: { title: 'KSampler' },
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'il-test.safetensors' }, _meta: { title: 'Load Checkpoint' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 }, _meta: { title: 'Empty Latent Image' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'beautiful scenery', clip: ['4', 1] }, _meta: { title: '正面' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'text, watermark', clip: ['4', 1] }, _meta: { title: '负面' } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['8', 0] } },
};

const params: ImageJobParams = {
  family: 'IL',
  positive: 'masterpiece, best quality, 1girl',
  negative: 'lowres, bad hands',
  workflow: { id: 'wf', name: '测试', hash: 'h' },
  width: 832,
  height: 1216,
};

describe('parseWorkflowFile', () => {
  it('API 格式的读出节点；普通工作流文件、不是 JSON 的、别的格式各说各的', () => {
    expect(parseWorkflowFile(JSON.stringify(basic))).toEqual({ graph: basic });
    expect(parseWorkflowFile(JSON.stringify({ last_node_id: 9, nodes: [{ id: 3, type: 'KSampler' }], links: [[1, 4, 0, 3, 0, 'MODEL']], version: 0.4 }))).toEqual({ problem: 'ui' });
    expect(parseWorkflowFile('{ 不是 JSON')).toEqual({ problem: 'json' });
    expect(parseWorkflowFile('[]')).toEqual({ problem: 'format' });
    expect(parseWorkflowFile('{}')).toEqual({ problem: 'format' });
    expect(parseWorkflowFile(JSON.stringify({ '1': { class_type: 'KSampler' } }))).toEqual({ problem: 'format' });
  });
});

describe('guessFill', () => {
  it('一个 KSampler：顺着连线认出正面、负面，种子是 seed，尺寸是空白画布', () => {
    const guess = guessFill(basic);
    expect(guess).toEqual({
      positive: [{ node: '6', input: 'text' }],
      negative: [{ node: '7', input: 'text' }],
      seed: [{ node: '3', input: 'seed' }],
      size: ['5'],
    });
    expect(guessIsSure(guess)).toBe(true);
  });

  it('KSamplerAdvanced 的种子是 noise_seed；中间隔着 ControlNet 时正面、负面各走各的', () => {
    const graph: ComfyGraph = {
      ...basic,
      '3': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 1, steps: 20, model: ['4', 0], positive: ['11', 0], negative: ['11', 1], latent_image: ['5', 0] } },
      '10': { class_type: 'ControlNetLoader', inputs: { control_net_name: 'openpose.safetensors' } },
      '11': { class_type: 'ControlNetApplyAdvanced', inputs: { strength: 1, positive: ['6', 0], negative: ['7', 0], control_net: ['10', 0], image: ['12', 0] } },
      '12': { class_type: 'LoadImage', inputs: { image: 'pose.png' } },
    };
    expect(guessFill(graph)).toEqual({
      positive: [{ node: '6', input: 'text' }],
      negative: [{ node: '7', input: 'text' }],
      seed: [{ node: '3', input: 'noise_seed' }],
      size: ['5'],
    });
  });

  it('两段式加区域提示词：正面合并了两个框、两个采样器，都列成候选让人挑', () => {
    const graph: ComfyGraph = {
      ...basic,
      '3': { ...basic['3'], inputs: { ...basic['3'].inputs, positive: ['13', 0] } },
      '12': { class_type: 'CLIPTextEncode', inputs: { text: 'background', clip: ['4', 1] }, _meta: { title: '正面 · 背景' } },
      '13': { class_type: 'ConditioningCombine', inputs: { conditioning_1: ['6', 0], conditioning_2: ['12', 0] } },
      '20': { class_type: 'LatentUpscale', inputs: { upscale_method: 'nearest-exact', width: 1536, height: 1536, crop: 'disabled', samples: ['3', 0] } },
      '21': { class_type: 'KSampler', inputs: { ...basic['3'].inputs, seed: 2, denoise: 0.5, positive: ['13', 0], latent_image: ['20', 0] } },
    };
    const guess = guessFill(graph);
    expect(guess.positive).toEqual([
      { node: '6', input: 'text' },
      { node: '12', input: 'text' },
    ]);
    expect(guess.negative).toEqual([{ node: '7', input: 'text' }]);
    expect(guess.seed).toEqual([
      { node: '3', input: 'seed' },
      { node: '21', input: 'seed' },
    ]);
    expect(guess.size).toEqual(['5']);
    expect(guessIsSure(guess)).toBe(false);
    // 挑的时候列出工作流里能填的全部地方
    expect(workflowSlots(graph)).toEqual({
      prompts: [
        { node: '6', input: 'text' },
        { node: '7', input: 'text' },
        { node: '12', input: 'text' },
      ],
      seeds: [
        { node: '3', input: 'seed' },
        { node: '21', input: 'seed' },
      ],
      sizes: ['5', '20'],
    });
  });

  it('文字从别的节点连进来的，认不出', () => {
    const graph: ComfyGraph = { ...basic, '6': { class_type: 'CLIPTextEncode', inputs: { text: ['30', 0], clip: ['4', 1] } }, '30': { class_type: 'StringLiteral', inputs: { string: '1girl' } } };
    expect(guessFill(graph).positive).toEqual([]);
    expect(workflowSlots(graph).prompts).toEqual([
      { node: '7', input: 'text' },
      { node: '30', input: 'string' },
    ]);
  });
});

describe('导入的工作流出图', () => {
  const fill = toFill({ positive: { node: '6', input: 'text' }, negative: { node: '7', input: 'text' }, seed: { node: '3', input: 'seed' }, size: '5' });

  it('只换正面、负面、种子、尺寸，别的照原样，存着的工作流不动', () => {
    const graph = importedGraph({ graph: basic, fill }, params, 42);
    expect(graph['6'].inputs.text).toBe('masterpiece, best quality, 1girl');
    expect(graph['7'].inputs.text).toBe('lowres, bad hands');
    expect(graph['3'].inputs).toEqual({ ...basic['3'].inputs, seed: 42 });
    expect(graph['5'].inputs).toEqual({ width: 832, height: 1216, batch_size: 1 });
    for (const id of ['4', '8', '9']) expect(graph[id]).toEqual(basic[id]);
    expect(basic['6'].inputs.text).toBe('beautiful scenery');
  });

  it('不填的项照工作流里原来的', () => {
    const graph = importedGraph({ graph: basic, fill: { ...fill, negative: null, seed: null, width: null, height: null } }, params, 42);
    expect(graph['7'].inputs.text).toBe('text, watermark');
    expect(graph['3'].inputs.seed).toBe(156680208700286);
    expect(graph['5'].inputs.width).toBe(512);
  });

  it('往哪填对不上工作流的说出是哪一项', () => {
    expect(fillProblem(basic, fill)).toBeNull();
    expect(fillProblem(basic, { ...fill, positive: { node: '99', input: 'text' } })).toBe('正面提示词要填的 99 号节点的 text 在工作流里不是文字');
    expect(fillProblem(basic, { ...fill, seed: { node: '6', input: 'text' } })).toBe('种子要填的 6 号节点的 text 在工作流里不是数');
  });

  it('列出这台 ComfyUI 上没装的节点类型', () => {
    const graph: ComfyGraph = { ...basic, '10': { class_type: 'FaceDetailer', inputs: {} }, '11': { class_type: 'FaceDetailer', inputs: {} } };
    expect(missingNodeTypes(graph, ['KSampler', 'CheckpointLoaderSimple', 'EmptyLatentImage', 'CLIPTextEncode', 'VAEDecode'])).toEqual(['SaveImage', 'FaceDetailer']);
    expect(missingNodeTypes(basic, Object.values(basic).map((node) => node.class_type))).toEqual([]);
  });
});
