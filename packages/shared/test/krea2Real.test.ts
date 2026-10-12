import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WORKFLOW,
  EASY_QWEN_SYSTEM_PROMPT,
  kreaGraph,
  REVERSE_CUSTOM_PROMPT,
  REVERSE_FORCE_OFFLOAD,
  REVERSE_INFERENCE_MODE,
  REVERSE_LOADER,
  REVERSE_MAX_FRAMES,
  REVERSE_MAX_SIZE,
  REVERSE_PARAMETERS,
  REVERSE_PRESET_PROMPT,
  REVERSE_PROMPT,
  REVERSE_PROMPT_DUAL,
  REVERSE_SAVE_STATES,
  REAL_AUTHOR,
  REAL_CFG,
  REAL_LONG_SIDE,
  REAL_LORA,
  REAL_REVERSE_MODEL,
  REAL_SAMPLER,
  REAL_SATURATION,
  REAL_SCHEDULER,
  REAL_STEPS,
  REAL_TRIGGER,
  REAL_TRIGGER_DUAL,
  REAL_UNCENSORED,
  REAL_VAE,
  realModelsOf,
  reverseInstructionOf,
  type ComfyGraph,
  type ImageJobParams,
} from '../src';

// 转真人那张图，见 docs/krea2-real-usage.md（附录 A 单图 / B 双图 / C 开关）和 docs/dev-plan.md 5.36。
// 参数和接线都是照那台上的「Krea2转真人-全开关（反推+单双图+手输）」抄的，一字不改

const SEED = 892624666372231;
const TEXT = '她站在雨夜的站台上，穿深灰大衣。';

type Link = [string, number];
const nodesOf = (graph: ComfyGraph, type: string) => Object.entries(graph).filter(([, node]) => node.class_type === type);
const only = (graph: ComfyGraph, type: string): [string, ComfyGraph[string]] => {
  const found = nodesOf(graph, type);
  expect(found, `图里应该有且只有一个 ${type}`).toHaveLength(1);
  return found[0];
};
const linked = (graph: ComfyGraph, value: unknown) => graph[String((value as Link)[0])];
const linkedType = (graph: ComfyGraph, value: unknown) => linked(graph, value)?.class_type;

// 出一张转真人：反推 / 双图两个开关按参数来，LoRA 默认就挂 V3 那条。
// 底模 / 文字理解 / 步数这些就是服务端 editParams 里那套（这里直接照抄一份，免得测出别的东西）
function realParams(real: Partial<NonNullable<ImageJobParams['real']>> = {}): ImageJobParams {
  const models = realModelsOf(real.uncensored ?? true);
  return {
    family: 'Krea2',
    positive: TEXT,
    negative: '',
    workflow: BUILTIN_WORKFLOW,
    width: 1024,
    height: 1536,
    checkpoint: models.checkpoint,
    textEncoder: models.textEncoder,
    vae: REAL_VAE,
    loras: [],
    steps: REAL_STEPS,
    cfg: REAL_CFG,
    sampler: REAL_SAMPLER,
    scheduler: REAL_SCHEDULER,
    krea: { mode: 'real', reference: null, refBoost: 1, extra: '' },
    real: { reverse: false, dual: false, image2Strength: 1, loras: [{ name: REAL_LORA, strength: 1 }], uncensored: true, ...real },
  };
}

describe('转真人那张图的接线', () => {
  it('只转真人、手输提示词：节点类型齐全，一个反推节点都没有', () => {
    const graph = kreaGraph(realParams(), SEED, 'a.png', 'b.png');
    const types = [...new Set(Object.values(graph).map((node) => node.class_type))].sort();
    expect(types).toEqual(
      [
        'CLIPLoader',
        'ColorCorrect',
        'Easy_QwenEdit2509',
        'FluxKontextMultiReferenceLatentMethod',
        'KSampler',
        'Krea2OstrisEditModelPatch',
        'LayerUtility: ImageScaleByAspectRatio V2',
        'LoadImage',
        'LoraLoader',
        'PreviewImage',
        'UNETLoader',
        'VAEDecode',
        'VAELoader',
      ].sort(),
    );
    // 反推关着时那条链根本不生成（作者那份靠 LazySwitchKJ 惰性，我们干脆不生成）
    expect(Object.values(graph).some((node) => node.class_type.startsWith('llama_cpp'))).toBe(false);
    expect(Object.values(graph).some((node) => node.class_type === 'ConditioningZeroOut')).toBe(false);
    // 底模 / 文字理解 / VAE 用的就是这一档那几个文件
    expect(only(graph, 'UNETLoader')[1].inputs).toMatchObject({ unet_name: REAL_UNCENSORED.checkpoint, weight_dtype: 'default' });
    expect(only(graph, 'CLIPLoader')[1].inputs).toMatchObject({ clip_name: REAL_UNCENSORED.textEncoder, type: 'krea2', device: 'default' });
    expect(only(graph, 'VAELoader')[1].inputs).toMatchObject({ vae_name: REAL_VAE });
  });

  it('采样那一档是 8 步 / CFG 1 / euler / beta57 / denoise 1，kv_cache 开着，出图尺寸不填', () => {
    const graph = kreaGraph(realParams(), SEED, 'a.png');
    const sampler = only(graph, 'KSampler')[1];
    expect(sampler.inputs).toMatchObject({ seed: SEED, steps: REAL_STEPS, cfg: REAL_CFG, sampler_name: REAL_SAMPLER, scheduler: REAL_SCHEDULER, denoise: 1 });
    expect(sampler.inputs).toMatchObject({ scheduler: 'beta57', steps: 8, cfg: 1, sampler_name: 'euler', denoise: 1 });
    const patch = linked(graph, sampler.inputs.model);
    expect(patch.class_type).toBe('Krea2OstrisEditModelPatch');
    expect(patch.inputs.kv_cache).toBe(true);
    // 图里没有空白画布这类节点：出图尺寸跟着图 1 缩放后的那张走
    expect(Object.values(graph).some((node) => /Empty.*Latent/.test(node.class_type))).toBe(false);
    expect(Object.values(graph).some((node) => node.class_type === 'GetImageSize')).toBe(false);
  });

  it('图 1 先降饱和（−20）再按比例缩到长边 1536；image1 和 latent_image 都是它', () => {
    const graph = kreaGraph(realParams(), SEED, 'a.png');
    const [, load] = only(graph, 'LoadImage');
    expect(load.inputs.image).toBe('a.png');
    const [, correct] = only(graph, 'ColorCorrect');
    expect(correct.inputs).toMatchObject({ temperature: 0, hue: 0, brightness: 0, contrast: 0, saturation: REAL_SATURATION, gamma: 1 });
    expect(correct.inputs.image).toEqual([only(graph, 'LoadImage')[0], 0]);
    const [scaleId, scale] = only(graph, 'LayerUtility: ImageScaleByAspectRatio V2');
    expect(scale.inputs).toMatchObject({
      aspect_ratio: 'original',
      proportional_width: 1,
      proportional_height: 1,
      fit: 'crop',
      method: 'lanczos',
      round_to_multiple: 'None',
      scale_to_side: 'longest',
      scale_to_length: REAL_LONG_SIDE,
      background_color: '#000000',
    });
    expect(scale.inputs.image).toEqual([only(graph, 'ColorCorrect')[0], 0]);
    const easy = only(graph, 'Easy_QwenEdit2509')[1];
    expect(easy.inputs.image1).toEqual([scaleId, 0]);
    expect(easy.inputs.latent_image).toEqual([scaleId, 0]);
    expect(easy.inputs).toMatchObject({ auto_resize: 'crop', vl_size: 384, image1_strength: 1, image2_strength: 1, image3_strength: 1, system_prompt: EASY_QWEN_SYSTEM_PROMPT });
    // 正负面不是 ConditioningZeroOut：Easy 两个输出各接一个 FluxKontextMultiReferenceLatentMethod，再进 KSampler
    const [positive, negative] = nodesOf(graph, 'FluxKontextMultiReferenceLatentMethod');
    const sampler = only(graph, 'KSampler')[1];
    expect(sampler.inputs.positive).toEqual([positive[0], 0]);
    expect(sampler.inputs.negative).toEqual([negative[0], 0]);
    expect(positive[1].inputs).toMatchObject({ conditioning: [only(graph, 'Easy_QwenEdit2509')[0], 0], reference_latents_method: 'index_timestep_zero' });
    expect(negative[1].inputs).toMatchObject({ conditioning: [only(graph, 'Easy_QwenEdit2509')[0], 1], reference_latents_method: 'index_timestep_zero' });
    expect(sampler.inputs.latent_image).toEqual([only(graph, 'Easy_QwenEdit2509')[0], 2]);
    // 收尾是解码 + 预览（不在那台机器上留文件）
    expect(only(graph, 'PreviewImage')[1].inputs.images).toEqual([only(graph, 'VAEDecode')[0], 0]);
  });

  it('LoRA 链：转真人那条在前、人物那条依次，clip 和 model 一起喂，Easy 的 clip 接的是链尾', () => {
    const graph = kreaGraph(
      realParams({
        loras: [
          { name: REAL_LORA, strength: 1 },
          { name: 'krea2/Nick_baotunqun_Krea2.safetensors', strength: 0.6 },
        ],
      }),
      SEED,
      'a.png',
    );
    const loras = nodesOf(graph, 'LoraLoader');
    expect(loras).toHaveLength(2);
    // 链尾（接 Krea2OstrisEditModelPatch 的那个）是人物 LoRA
    const patch = linked(graph, only(graph, 'KSampler')[1].inputs.model);
    const [tailId, tail] = loras.find(([id]) => id === String((patch.inputs.model as Link)[0]))!;
    expect(tail.inputs).toMatchObject({ lora_name: 'krea2/Nick_baotunqun_Krea2.safetensors', strength_model: 0.6, strength_clip: 0.6 });
    // 它前面那条是转真人 LoRA，再前面是底模
    const [headId, head] = loras.find(([id]) => id !== tailId)!;
    expect(head.inputs).toMatchObject({ lora_name: REAL_LORA, strength_model: 1, strength_clip: 1 });
    expect(tail.inputs.model).toEqual([headId, 0]);
    expect(linkedType(graph, head.inputs.model)).toBe('UNETLoader');
    expect(head.inputs.clip).toEqual([only(graph, 'CLIPLoader')[0], 0]);
    // clip 这一路是串起来的，最后接 Easy —— 不是直接接 CLIPLoader
    expect(tail.inputs.clip).toEqual([headId, 1]);
    expect(only(graph, 'Easy_QwenEdit2509')[1].inputs.clip).toEqual([tailId, 1]);
    // 作者那份的 clip 输出就是接到 Easy 的，见调研第 6 节第 2 条
    expect(linkedType(graph, only(graph, 'Easy_QwenEdit2509')[1].inputs.clip)).toBe('LoraLoader');
  });

  it('双图关着时 image2 也用图 1 缩放那张（你选的图 2 一定不会被用到）', () => {
    const graph = kreaGraph(realParams({ dual: false }), SEED, 'a.png', 'b.png');
    expect(nodesOf(graph, 'LoadImage')).toHaveLength(1);
    expect(nodesOf(graph, 'ColorCorrect')).toHaveLength(1);
    const easy = only(graph, 'Easy_QwenEdit2509')[1];
    expect(easy.inputs.image2).toEqual(easy.inputs.image1);
  });

  it('双图开着：图 2 也过同一条链，image2_strength 进图；没给图 2 就退回图 1', () => {
    const graph = kreaGraph(realParams({ dual: true, image2Strength: 0.6 }), SEED, 'a.png', 'b.png');
    const loads = nodesOf(graph, 'LoadImage');
    expect(loads.map(([, node]) => node.inputs.image)).toEqual(['a.png', 'b.png']);
    const scales = nodesOf(graph, 'LayerUtility: ImageScaleByAspectRatio V2');
    expect(scales).toHaveLength(2);
    const easy = only(graph, 'Easy_QwenEdit2509')[1];
    expect(easy.inputs.image1).toEqual([scales[0][0], 0]);
    expect(easy.inputs.latent_image).toEqual([scales[0][0], 0]);
    expect(easy.inputs.image2).toEqual([scales[1][0], 0]);
    expect(easy.inputs.image2_strength).toBe(0.6);
    // 图 2 那条链上也有 ColorCorrect
    expect(nodesOf(graph, 'ColorCorrect')).toHaveLength(2);

    // 换脸开着但槽位里没放图 2：退回图 1，不报错（作者那份工作流就是这个行为）
    const fallback = kreaGraph(realParams({ dual: true }), SEED, 'a.png', '');
    expect(nodesOf(fallback, 'LoadImage')).toHaveLength(1);
    expect(only(fallback, 'Easy_QwenEdit2509')[1].inputs.image2).toEqual(only(fallback, 'Easy_QwenEdit2509')[1].inputs.image1);
  });

  it('反推关着时 ourselves 拼提示词：主触发词在前，双图多带 Figure 2 那句', () => {
    const single = kreaGraph(realParams(), SEED, 'a.png');
    expect(only(single, 'Easy_QwenEdit2509')[1].inputs.prompt).toBe(`${REAL_TRIGGER}\n\n${TEXT}`);
    const dual = kreaGraph(realParams({ dual: true }), SEED, 'a.png', 'b.png');
    expect(only(dual, 'Easy_QwenEdit2509')[1].inputs.prompt).toBe(`${REAL_TRIGGER_DUAL}\n\n${TEXT}`);
  });

  it('反推开着：三个反推节点按调研的参数接上，STRING 输出就是 Easy 的 prompt', () => {
    const graph = kreaGraph(realParams({ reverse: true }), SEED, 'a.png');
    const [instructId, instruct] = only(graph, 'llama_cpp_instruct_adv');
    const [loaderId, loader] = only(graph, 'llama_cpp_model_loader');
    const [parametersId, parameters] = only(graph, 'llama_cpp_parameters');
    expect(loader.inputs).toMatchObject({
      model: REAL_REVERSE_MODEL.model,
      mmproj: REAL_REVERSE_MODEL.mmproj,
      chat_handler: REAL_REVERSE_MODEL.chatHandler,
      n_ctx: 8192,
      vram_limit: -1,
      image_min_tokens: 0,
      image_max_tokens: 0,
      load_mtp: false,
    });
    expect(parameters.inputs).toEqual(REVERSE_PARAMETERS);
    // 反推看的是图 1 缩放那张；种子跟这次出图同一个
    expect(instruct.inputs).toMatchObject({
      llama_model: [loaderId, 0],
      parameters: [parametersId, 0],
      images: [only(graph, 'LayerUtility: ImageScaleByAspectRatio V2')[0], 0],
      system_prompt: REVERSE_PROMPT,
      preset_prompt: REVERSE_PRESET_PROMPT,
      custom_prompt: REVERSE_CUSTOM_PROMPT,
      inference_mode: REVERSE_INFERENCE_MODE,
      max_frames: REVERSE_MAX_FRAMES,
      max_size: REVERSE_MAX_SIZE,
      seed: SEED,
      force_offload: REVERSE_FORCE_OFFLOAD,
      save_states: REVERSE_SAVE_STATES,
    });
    // 它的 STRING 输出直接接 Easy_QwenEdit2509.prompt（不是我们自己拼的那句）
    expect(only(graph, 'Easy_QwenEdit2509')[1].inputs.prompt).toEqual([instructId, 0]);
    // 双图时换「反推-双图」那份指令
    const dual = only(kreaGraph(realParams({ reverse: true, dual: true }), SEED, 'a.png', 'b.png'), 'llama_cpp_instruct_adv')[1];
    expect(dual.inputs.system_prompt).toBe(REVERSE_PROMPT_DUAL);
    expect(dual.inputs.system_prompt).not.toBe(REVERSE_PROMPT);
  });

  it('反推的加载参数和采样参数就是调研里那一串（多一个少一个都不行）', () => {
    const graph = kreaGraph(realParams({ reverse: true }), SEED, 'a.png');
    expect(Object.keys(only(graph, 'llama_cpp_parameters')[1].inputs).sort()).toEqual(Object.keys(REVERSE_PARAMETERS).sort());
    expect(Object.keys(REVERSE_PARAMETERS)).toHaveLength(13);
    expect(only(graph, 'llama_cpp_model_loader')[1].inputs).toMatchObject(REVERSE_LOADER);
    // 常驻显存：照调研的 false（跑完不卸载）
    expect(only(graph, 'llama_cpp_instruct_adv')[1].inputs.force_offload).toBe(false);
  });

  it('底模 / 文字理解按「无审查」选：默认那一对是去审查的，作者原版是另外一对', () => {
    expect(realModelsOf(true)).toEqual(REAL_UNCENSORED);
    expect(realModelsOf(false)).toEqual(REAL_AUTHOR);
    expect(REAL_UNCENSORED.checkpoint).toBe('krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors');
    expect(REAL_AUTHOR.checkpoint).toBe('krea2/krea2_turbo_fp8_scaled.safetensors');
    const author = kreaGraph({ ...realParams({ uncensored: false }), checkpoint: realModelsOf(false).checkpoint, textEncoder: realModelsOf(false).textEncoder }, SEED, 'a.png');
    expect(only(author, 'UNETLoader')[1].inputs.unet_name).toBe(REAL_AUTHOR.checkpoint);
    expect(only(author, 'CLIPLoader')[1].inputs.clip_name).toBe(REAL_AUTHOR.textEncoder);
  });
});

// 反推那两份系统提示词：原文只维护 docs/krea2-real-reverse-prompt.md。
// 「跟文档那两个代码块一字不差」那条在 server 那边测（packages/server/test/krea2RealPrompt.test.ts）——
// shared 这个包 typecheck 时不带 node 类型（tsconfig 里 types: []），读不了文件
describe('反推的两份系统提示词', () => {
  it('两份只差三处：开头的受众 / 双图触发词 / 「图 2 不用你管」那一段；主触发词必须一模一样', () => {
    expect(REVERSE_PROMPT.startsWith('You write the prompt for Krea2')).toBe(true);
    expect(REVERSE_PROMPT_DUAL.startsWith('You write the prompt for Krea2')).toBe(true);
    expect(REVERSE_PROMPT).toContain('transform the image to realistic photograph\n');
    expect(REVERSE_PROMPT_DUAL).toContain(`${REAL_TRIGGER_DUAL}\n`);
    expect(REVERSE_PROMPT).not.toContain('TWO IMAGES');
    expect(REVERSE_PROMPT_DUAL).toContain('TWO IMAGES: Figure 1 is the drawing you are looking at');
    // 给的是风格 / 方向词，内容词一个都不给（给了它必照抄，见调研第 4 节）
    expect(REVERSE_PROMPT).toContain('looking at camera, look down, unfocused face, backlight, Film filter, hazy, photorealistic, highly detailed');
    expect(REVERSE_PROMPT).not.toMatch(/black stockings|pubic hair|labia/);
    expect(REVERSE_PROMPT).toContain('Never write a garment, a body part or an anatomical detail that you cannot see');
    expect(reverseInstructionOf(true)).toBe(REVERSE_PROMPT_DUAL);
    expect(reverseInstructionOf(false)).toBe(REVERSE_PROMPT);
  });
});
