import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WORKFLOW,
  DEPTH_CKPT,
  DEPTH_LORA,
  DEPTH_RESOLUTION,
  DEPTH_STRENGTH,
  kreaGraph,
  REAL_CFG,
  REAL_SAMPLER,
  REAL_STEPS,
  REAL_VAE,
  REMIX_KV_CACHE,
  REMIX_LORA,
  REMIX_MEGAPIXELS,
  REMIX_REFERENCE_METHOD,
  REMIX_RESOLUTION_STEPS,
  REMIX_STRENGTH,
  REMIX_UPSCALE_METHOD,
  type ComfyGraph,
  type ImageJobParams,
} from '../src';

// 深度迁移和风格 Remix / 换人那两张图，见 docs/dev-plan.md 5.36。
// 接线和参数逐字照那台真机摸出来的 outputs/devcheck/w3-depth.json / w3-reid2.json / w3-remix2.json，
// 结果图 outputs/real/shots/W3-深度-DepthAnything控制.png、W3-Remix-reid换人-T0人像.png、
// W3-Remix-RealCosplay风格-T0人像.png。记录在 outputs/devcheck/w3-findings.md 第 1、3 节

const SEED = 17072033;
const TEXT = 'a cinematic photograph of a rainy city train platform at night, wet asphalt reflecting neon signs';

type Link = [string, number];
const nodesOf = (graph: ComfyGraph, type: string) => Object.entries(graph).filter(([, n]) => n.class_type === type);
const only = (graph: ComfyGraph, type: string): [string, ComfyGraph[string]] => {
  const found = nodesOf(graph, type);
  expect(found, `图里应该有且只有一个 ${type}`).toHaveLength(1);
  return found[0];
};
const idOf = (graph: ComfyGraph, type: string) => only(graph, type)[0];
const linked = (graph: ComfyGraph, value: unknown) => graph[String((value as Link)[0])];
const linkedType = (graph: ComfyGraph, value: unknown) => linked(graph, value)?.class_type;

// 出一张深度迁移：底模 / 文字理解 / 步数这些就是服务端 editParams 里那套（照 krea2.ts 的 kreaDefaults('depth')）
function depthParams(remix: Partial<NonNullable<ImageJobParams['remix']>> = {}): ImageJobParams {
  return {
    family: 'Krea2',
    positive: TEXT,
    negative: '',
    workflow: BUILTIN_WORKFLOW,
    width: 1024,
    height: 1024,
    checkpoint: 'krea2/krea2_turbo_fp8_scaled.safetensors',
    textEncoder: 'qwen3vl_4b_fp8_scaled.safetensors',
    vae: REAL_VAE,
    loras: [],
    steps: REAL_STEPS,
    cfg: REAL_CFG,
    sampler: REAL_SAMPLER,
    scheduler: 'simple',
    krea: { mode: 'depth', reference: null, refBoost: 1, extra: '' },
    remix: { controlStrength: DEPTH_STRENGTH, lora: { name: REMIX_LORA, strength: REMIX_STRENGTH }, ...remix },
  };
}

// 出一张风格 Remix：底模是 turbo int8（不是深度那条的 fp8），其余同上
function remixParams(remix: Partial<NonNullable<ImageJobParams['remix']>> = {}): ImageJobParams {
  return {
    ...depthParams(remix),
    checkpoint: 'krea2/krea2_turbo_int8_convrot.safetensors',
    krea: { mode: 'remix', reference: null, refBoost: 1, extra: '' },
  };
}

describe('深度迁移那张图的接线', () => {
  it('节点类型齐全：控制类三节点一组 + 深度提取 + 两个 CLIPTextEncode，没有 Ostris 那两个', () => {
    const graph = kreaGraph(depthParams(), SEED, 'scene.png');
    const types = [...new Set(Object.values(graph).map((node) => node.class_type))].sort();
    expect(types).toEqual(
      [
        'CLIPLoader',
        'CLIPTextEncode',
        'DepthAnythingV2Preprocessor',
        'EmptyLatentImage',
        'KSampler',
        'Krea2ControlApply',
        'Krea2ControlImageEncode',
        'Krea2ControlLoRALoader',
        'LoadImage',
        'PreviewImage',
        'UNETLoader',
        'VAEDecode',
        'VAELoader',
      ].sort(),
    );
    // 控制类这条路跟 Ostris 那条不是一回事：一个 Ostris 节点都不该有，也不该挂普通 LoRA 加载器
    expect(nodesOf(graph, 'Krea2OstrisEditModelPatch')).toHaveLength(0);
    expect(nodesOf(graph, 'TextEncodeKrea2OstrisEdit')).toHaveLength(0);
    expect(nodesOf(graph, 'LoraLoaderModelOnly')).toHaveLength(0);
    expect(nodesOf(graph, 'Easy_QwenEdit2509')).toHaveLength(0);
  });

  it('底模 / 文字理解 / VAE 照跑通的那套（turbo fp8 + fp8 clip + qwen vae），不是无审查那套', () => {
    const graph = kreaGraph(depthParams(), SEED, 'scene.png');
    expect(only(graph, 'UNETLoader')[1].inputs).toEqual({ unet_name: 'krea2/krea2_turbo_fp8_scaled.safetensors', weight_dtype: 'default' });
    expect(only(graph, 'CLIPLoader')[1].inputs).toEqual({ clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default' });
    expect(only(graph, 'VAELoader')[1].inputs).toEqual({ vae_name: 'qwen_image_vae.safetensors' });
  });

  it('控制类 LoRA：名字带 krea2/ 前缀、强度就是面板上那个（默认 1），model 接的是 UNETLoader', () => {
    const graph = kreaGraph(depthParams(), SEED, 'scene.png');
    const loader = only(graph, 'Krea2ControlLoRALoader')[1];
    expect(loader.inputs).toEqual({ model: [idOf(graph, 'UNETLoader'), 0], lora_name: DEPTH_LORA, strength: 1 });
    expect(DEPTH_LORA.startsWith('krea2/')).toBe(true);

    // 调过强度就照调过的走（0.1 到 1.5；**0 不能用**：loader 不注册 wrapper，Apply 会抛错）
    const weaker = kreaGraph(depthParams({ controlStrength: 0.6 }), SEED, 'scene.png');
    expect(only(weaker, 'Krea2ControlLoRALoader')[1].inputs.strength).toBe(0.6);
  });

  it('★ Krea2ControlApply 收的是 Krea2ControlLoRALoader 的 MODEL，不是 UNETLoader 的', () => {
    const graph = kreaGraph(depthParams(), SEED, 'scene.png');
    const applied = only(graph, 'Krea2ControlApply')[1];
    expect(applied.inputs.model).toEqual([idOf(graph, 'Krea2ControlLoRALoader'), 0]);
    expect(applied.inputs.model).not.toEqual([idOf(graph, 'UNETLoader'), 0]);
    // 采样器接的是 Apply 的输出
    expect(only(graph, 'KSampler')[1].inputs.model).toEqual([idOf(graph, 'Krea2ControlApply'), 0]);
  });

  it('★ 同一个 latent 同时喂 Krea2ControlImageEncode.latent 和 KSampler.latent_image', () => {
    const graph = kreaGraph(depthParams(), SEED, 'scene.png');
    const latent = only(graph, 'EmptyLatentImage')[1];
    expect(latent.inputs).toEqual({ width: 1024, height: 1024, batch_size: 1 });
    const link: Link = [idOf(graph, 'EmptyLatentImage'), 0];
    expect(only(graph, 'Krea2ControlImageEncode')[1].inputs.latent).toEqual(link);
    expect(only(graph, 'KSampler')[1].inputs.latent_image).toEqual(link);
  });

  it('深度提取和编码的参数照 JSON：vitl / 1024，resize / channel_mode / normalize / invert / batch_mode 一个不改', () => {
    const graph = kreaGraph(depthParams(), SEED, 'scene.png');
    const load = only(graph, 'LoadImage')[1];
    expect(load.inputs.image).toBe('scene.png');
    expect(only(graph, 'DepthAnythingV2Preprocessor')[1].inputs).toEqual({
      image: [idOf(graph, 'LoadImage'), 0],
      ckpt_name: DEPTH_CKPT,
      resolution: DEPTH_RESOLUTION,
    });
    expect(only(graph, 'Krea2ControlImageEncode')[1].inputs).toEqual({
      control_image: [idOf(graph, 'DepthAnythingV2Preprocessor'), 0],
      vae: [idOf(graph, 'VAELoader'), 0],
      resize: 'match_latent_size',
      upscale_method: 'lanczos',
      crop: 'center',
      channel_mode: 'grayscale',
      normalize: 'per_image_minmax',
      invert: false,
      batch_mode: 'independent_images',
      latent: [idOf(graph, 'EmptyLatentImage'), 0],
    });
  });

  it('正负面走普通 CLIPTextEncode：正面是框里那句话、负面空；采样 8 步 / CFG 1 / euler / simple / denoise 1', () => {
    const graph = kreaGraph(depthParams(), SEED, 'scene.png');
    const encodes = nodesOf(graph, 'CLIPTextEncode');
    expect(encodes).toHaveLength(2);
    const texts = encodes.map(([, n]) => n.inputs.text);
    expect(texts).toEqual([TEXT, '']);
    for (const [, n] of encodes) expect(n.inputs.clip).toEqual([idOf(graph, 'CLIPLoader'), 0]);
    const sampler = only(graph, 'KSampler')[1];
    expect(sampler.inputs).toMatchObject({ seed: SEED, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 });
    expect(sampler.inputs.positive).toEqual([encodes[0][0], 0]);
    expect(sampler.inputs.negative).toEqual([encodes[1][0], 0]);
    // 出图走 VAEDecode → PreviewImage（不在那台机器上留文件）
    expect(only(graph, 'VAEDecode')[1].inputs).toEqual({ samples: [idOf(graph, 'KSampler'), 0], vae: [idOf(graph, 'VAELoader'), 0] });
    expect(only(graph, 'PreviewImage')[1].inputs.images).toEqual([idOf(graph, 'VAEDecode'), 0]);
  });
});

describe('风格 Remix / 换人那张图的接线', () => {
  it('节点类型齐全：LoraLoaderModelOnly 只喂 model、Ostris 补丁、两个参考接法、参考图缩放；没有 Easy_QwenEdit2509', () => {
    const graph = kreaGraph(remixParams(), SEED, 'ref.png');
    const types = [...new Set(Object.values(graph).map((node) => node.class_type))].sort();
    expect(types).toEqual(
      [
        'CLIPLoader',
        'EmptyLatentImage',
        'FluxKontextMultiReferenceLatentMethod',
        'ImageScaleToTotalPixels',
        'KSampler',
        'Krea2OstrisEditModelPatch',
        'LoadImage',
        'LoraLoaderModelOnly',
        'PreviewImage',
        'TextEncodeKrea2OstrisEdit',
        'UNETLoader',
        'VAEDecode',
        'VAELoader',
      ].sort(),
    );
    // 跟转真人不是一条路：那条用 Easy_QwenEdit2509 编码、LoraLoader 同时喂 clip，也没有控制类那三个节点
    expect(nodesOf(graph, 'Easy_QwenEdit2509')).toHaveLength(0);
    expect(nodesOf(graph, 'LoraLoader')).toHaveLength(0);
    expect(nodesOf(graph, 'Krea2ControlLoRALoader')).toHaveLength(0);
    expect(nodesOf(graph, 'Krea2ControlApply')).toHaveLength(0);
  });

  it('★ LoRA 只喂 model、名字带 krea2/ 前缀、默认强度 1；两个候选只换 lora_name', () => {
    const graph = kreaGraph(remixParams(), SEED, 'ref.png');
    const lora = only(graph, 'LoraLoaderModelOnly')[1];
    expect(lora.inputs).toEqual({ model: [idOf(graph, 'UNETLoader'), 0], lora_name: REMIX_LORA, strength_model: 1 });
    // 官方图的接法是 LoraLoaderModelOnly（只喂 model），**不能**顺手换成 LoraLoader 把 clip 也喂上
    expect(lora.inputs).not.toHaveProperty('clip');
    expect(lora.inputs).not.toHaveProperty('strength_clip');
    expect(REMIX_LORA.startsWith('krea2/')).toBe(true);
    expect(REMIX_LORA).toBe('krea2/krea2_reid_rank32.safetensors');

    // 换 RealCosplay 那条：同一张图，只换名字（这条也必须带前缀）
    const other = 'krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors';
    const remix = kreaGraph(remixParams({ lora: { name: other, strength: 0.8 } }), SEED, 'ref.png');
    expect(only(remix, 'LoraLoaderModelOnly')[1].inputs).toEqual({ model: [idOf(remix, 'UNETLoader'), 0], lora_name: other, strength_model: 0.8 });
    expect(other.startsWith('krea2/')).toBe(true);
    // 除了 lora_name 和强度，别的地方一模一样
    for (const [id, node] of Object.entries(remix)) {
      if (node.class_type === 'LoraLoaderModelOnly') continue;
      expect(graph[id], `${id} 号节点应该一样`).toEqual(node);
    }
  });

  it('★ Krea2OstrisEditModelPatch 的 kv_cache 是 true（模型契约，不是加速开关），model 接 LoRA 那条', () => {
    const graph = kreaGraph(remixParams(), SEED, 'ref.png');
    const patch = only(graph, 'Krea2OstrisEditModelPatch')[1];
    expect(patch.inputs).toEqual({ model: [idOf(graph, 'LoraLoaderModelOnly'), 0], kv_cache: REMIX_KV_CACHE });
    expect(REMIX_KV_CACHE).toBe(true);
    expect(only(graph, 'KSampler')[1].inputs.model).toEqual([idOf(graph, 'Krea2OstrisEditModelPatch'), 0]);
  });

  it('参考图先按总像素缩到 384×384 那个预算（area / 0.140625 MP / 16），两个编码节点共用同一张', () => {
    const graph = kreaGraph(remixParams(), SEED, 'ref.png');
    expect(only(graph, 'LoadImage')[1].inputs.image).toBe('ref.png');
    expect(only(graph, 'ImageScaleToTotalPixels')[1].inputs).toEqual({
      image: [idOf(graph, 'LoadImage'), 0],
      upscale_method: REMIX_UPSCALE_METHOD,
      megapixels: REMIX_MEGAPIXELS,
      resolution_steps: REMIX_RESOLUTION_STEPS,
    });
    // 0.140625 MP 就是 384×384
    expect(Math.sqrt(REMIX_MEGAPIXELS * 1024 * 1024)).toBeCloseTo(384, 6);

    const encodes = nodesOf(graph, 'TextEncodeKrea2OstrisEdit');
    expect(encodes).toHaveLength(2);
    for (const [, n] of encodes) {
      expect(n.inputs.image1).toEqual([idOf(graph, 'ImageScaleToTotalPixels'), 0]);
      // 单参考图：image2 / image3 明写 null（照 w3-reid2.json）
      expect(n.inputs.image2).toBeNull();
      expect(n.inputs.image3).toBeNull();
      expect(n.inputs.clip).toEqual([idOf(graph, 'CLIPLoader'), 0]);
      expect(n.inputs.vae).toEqual([idOf(graph, 'VAELoader'), 0]);
    }
    expect(encodes.map(([, n]) => n.inputs.prompt)).toEqual([TEXT, '']);
  });

  it('正负 conditioning 各接一个 FluxKontextMultiReferenceLatentMethod（index_timestep_zero），不是 ConditioningZeroOut', () => {
    const graph = kreaGraph(remixParams(), SEED, 'ref.png');
    const encodes = nodesOf(graph, 'TextEncodeKrea2OstrisEdit');
    const references = nodesOf(graph, 'FluxKontextMultiReferenceLatentMethod');
    expect(references).toHaveLength(2);
    expect(references.map(([, n]) => n.inputs)).toEqual([
      { conditioning: [encodes[0][0], 0], reference_latents_method: REMIX_REFERENCE_METHOD },
      { conditioning: [encodes[1][0], 0], reference_latents_method: REMIX_REFERENCE_METHOD },
    ]);
    expect(REMIX_REFERENCE_METHOD).toBe('index_timestep_zero');
    expect(nodesOf(graph, 'ConditioningZeroOut')).toHaveLength(0);
    const sampler = only(graph, 'KSampler')[1];
    expect(sampler.inputs.positive).toEqual([references[0][0], 0]);
    expect(sampler.inputs.negative).toEqual([references[1][0], 0]);
  });

  it('出图尺寸跟参考图无关：EmptyLatentImage 用的是出图设置的宽高；采样 8 步 / CFG 1 / euler / simple', () => {
    const graph = kreaGraph({ ...remixParams(), width: 1536, height: 1024 }, SEED, 'ref.png');
    expect(only(graph, 'EmptyLatentImage')[1].inputs).toEqual({ width: 1536, height: 1024, batch_size: 1 });
    expect(only(graph, 'KSampler')[1].inputs).toMatchObject({ latent_image: [idOf(graph, 'EmptyLatentImage'), 0], seed: SEED, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 });
  });

  it('params.remix 缺了也有兜底：LoRA 用默认那条、强度 1（老任务「同样参数再来」照 params 发）', () => {
    const { remix: _drop, ...without } = remixParams();
    const graph = kreaGraph(without as ImageJobParams, SEED, 'ref.png');
    expect(only(graph, 'LoraLoaderModelOnly')[1].inputs.lora_name).toBe(REMIX_LORA);
    expect(only(graph, 'LoraLoaderModelOnly')[1].inputs.strength_model).toBe(REMIX_STRENGTH);

    const depth = kreaGraph({ ...depthParams(), remix: undefined } as ImageJobParams, SEED, 'scene.png');
    expect(only(depth, 'Krea2ControlLoRALoader')[1].inputs.strength).toBe(DEPTH_STRENGTH);
  });
});
