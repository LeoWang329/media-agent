import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WORKFLOW,
  builtinGraph,
  checkpointFamily,
  composeChecked,
  controlChoices,
  controlModels,
  controlPreprocessors,
  defaultImageSettings,
  EDIT_LORA,
  editPresetOf,
  downloadFileName,
  FAMILY_DEFAULTS,
  imageErrorKind,
  IMAGE_SIZES,
  imageSettingsOf,
  INPAINT_CROP,
  inpaintGraph,
  jobSeeds,
  kreaDefaults,
  kreaGraph,
  KREA2_EDIT_PRESETS,
  negativePrompt,
  newControl,
  parsePromptMeta,
  positivePrompt,
  roundSize,
  splitTags,
  tempFileName,
  tempFolderName,
  unionType,
  type ControlSettings,
  type DetailPass,
  type ImageJobParams,
} from '../src';

describe('parsePromptMeta', () => {
  it('开头的说明段写着「用途: 生图」的是生图提示词，读出底模系列，发给模型的部分去掉这段', () => {
    expect(parsePromptMeta('---\n用途: 生图\n底模: IL\n---\n只写标签')).toEqual({ use: 'image', family: 'IL', fn: null, body: '只写标签' });
    expect(parsePromptMeta('---\r\n用途：生图\r\n底模：pony\r\n---\r\n正文')).toEqual({ use: 'image', family: 'Pony', fn: null, body: '正文' });
  });

  it('写着「用途: 编辑」的是图像编辑提示词，读出它管哪个功能', () => {
    const meta = parsePromptMeta('---\n用途: 编辑\n功能: 换装\n---\n只写衣服');
    expect(meta).toEqual({ use: 'edit', family: null, fn: '换装', body: '只写衣服' });
    // 功能名写成中文冒号也认；没写功能名是 null（编辑节点还要靠它挑提示词，见 docs/dev-plan.md 5.39）
    expect(parsePromptMeta('---\n用途：编辑\n功能：转真人\n---\n正文').fn).toBe('转真人');
    expect(parsePromptMeta('---\n用途: 编辑\n---\n正文')).toMatchObject({ use: 'edit', fn: null });
  });

  it('没有说明段、用途不是生图也不是编辑的都是视频提示词；底模写错是 null', () => {
    expect(parsePromptMeta('你是视频提示词助手')).toEqual({ use: 'video', family: null, fn: null, body: '你是视频提示词助手' });
    expect(parsePromptMeta('---\n用途: 视频\n---\n正文')).toMatchObject({ use: 'video', body: '正文' });
    expect(parsePromptMeta('---\n用途: 生图\n底模: SD1.5\n---\n正文')).toMatchObject({ use: 'image', family: null });
    expect(parsePromptMeta('正文\n---\n用途: 生图\n---').use).toBe('video');
  });
});

describe('拼正面和负面', () => {
  it('正面是固定开头、评级词（选了才加）、框里的标签；负面是默认负面词加额外的', () => {
    expect(positivePrompt(FAMILY_DEFAULTS.Pony, 'sensitive', '1girl, smile')).toBe('score_9, score_8_up, score_7_up, source_anime, rating_questionable, 1girl, smile');
    expect(positivePrompt(FAMILY_DEFAULTS.IL, 'none', '1girl')).toBe('masterpiece, best quality, 1girl');
    expect(negativePrompt(FAMILY_DEFAULTS.IL, ' nsfw ')).toBe(`${FAMILY_DEFAULTS.IL.negative}, nsfw`);
    expect(negativePrompt(FAMILY_DEFAULTS.IL, '')).toBe(FAMILY_DEFAULTS.IL.negative);
  });

  it('按校验结果拼：别名换成标准写法；不认识的和系列固定词（没有 tag）原样照写，权重留着', () => {
    const items = splitTags('blond hair, (golden hair:1.2), score_9, smile');
    const composed = composeChecked(items, [
      { input: 'blond hair', status: 'alias', tag: 'blonde_hair' },
      { input: 'golden hair', status: 'unknown', suggestions: [] },
      { input: 'score_9', status: 'ok' },
      { input: 'smile', status: 'ok', tag: 'smile' },
    ]);
    expect(composed).toBe('blonde hair, (golden hair:1.2), score_9, smile');
  });
});

describe('builtinGraph', () => {
  const params: ImageJobParams = {
    family: 'IL',
    positive: 'masterpiece, 1girl',
    negative: 'lowres',
    workflow: BUILTIN_WORKFLOW,
    width: 832,
    height: 1216,
    checkpoint: 'il-test.safetensors',
    loras: [],
    steps: 28,
    cfg: 5,
    sampler: 'euler_ancestral',
    scheduler: 'normal',
    clipSkip: 2,
  };

  it('只用自带节点：底模 → clip skip（取负）→ 正负面 → 空白画布 → 采样 → 解码 → 预览', () => {
    expect(builtinGraph(params, 7)).toEqual({
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'il-test.safetensors' } },
      '2': { class_type: 'CLIPSetLastLayer', inputs: { stop_at_clip_layer: -2, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece, 1girl', clip: ['2', 0] } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: 'lowres', clip: ['2', 0] } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
      '6': {
        class_type: 'KSampler',
        inputs: {
          seed: 7,
          steps: 28,
          cfg: 5,
          sampler_name: 'euler_ancestral',
          scheduler: 'normal',
          denoise: 1,
          model: ['1', 0],
          positive: ['3', 0],
          negative: ['4', 0],
          latent_image: ['5', 0],
        },
      },
      '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
      '8': { class_type: 'PreviewImage', inputs: { images: ['7', 0] } },
    });
  });

  it('LoRA 一个接一个串起来，采样用最后一个的模型，clip skip 接最后一个的 CLIP', () => {
    const graph = builtinGraph({ ...params, family: 'Pony', clipSkip: 1, loras: [{ name: 'a.safetensors', strength: 0.8 }, { name: 'b.safetensors', strength: 1 }] }, 1);
    expect(graph['2']).toEqual({ class_type: 'LoraLoader', inputs: { lora_name: 'a.safetensors', strength_model: 0.8, strength_clip: 0.8, model: ['1', 0], clip: ['1', 1] } });
    expect(graph['3']).toEqual({ class_type: 'LoraLoader', inputs: { lora_name: 'b.safetensors', strength_model: 1, strength_clip: 1, model: ['2', 0], clip: ['2', 1] } });
    expect(graph['4']).toEqual({ class_type: 'CLIPSetLastLayer', inputs: { stop_at_clip_layer: -1, clip: ['3', 1] } });
    expect(graph['8'].inputs.model).toEqual(['3', 0]);
  });

  const nodesOf = (graph: ReturnType<typeof builtinGraph>, type: string) => Object.entries(graph).filter(([, node]) => node.class_type === type);

  it('放大：放大模型放大后缩到出图尺寸乘倍数（取 8 的倍数）；重绘强度 0 不再画', () => {
    const graph = builtinGraph({ ...params, upscale: { on: true, model: '4x-test.pth', scale: 1.5, denoise: 0 } }, 7);
    expect(graph['8']).toEqual({ class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-test.pth' } });
    expect(graph['9']).toEqual({ class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['8', 0], image: ['7', 0] } });
    expect(graph['10']).toEqual({ class_type: 'ImageScale', inputs: { image: ['9', 0], upscale_method: 'lanczos', width: 1248, height: 1824, crop: 'disabled' } });
    expect(graph['11']).toEqual({ class_type: 'PreviewImage', inputs: { images: ['10', 0] } });
    expect(nodesOf(graph, 'KSampler')).toHaveLength(1);
  });

  it('放大：重绘强度大于 0 再用同样的底模、提示词、种子画一遍', () => {
    const graph = builtinGraph({ ...params, upscale: { on: true, model: '4x-test.pth', scale: 2, denoise: 0.35 } }, 7);
    expect(graph['10'].inputs).toMatchObject({ width: 1664, height: 2432 });
    expect(graph['11']).toEqual({ class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['1', 2] } });
    expect(graph['12']).toEqual({ class_type: 'KSampler', inputs: { ...graph['6'].inputs, denoise: 0.35, latent_image: ['11', 0] } });
    expect(graph['13']).toEqual({ class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['1', 2] } });
    expect(graph['14']).toEqual({ class_type: 'PreviewImage', inputs: { images: ['13', 0] } });
  });

  it('部位重绘：每道一个检测模型加一个 FaceDetailer，一道接一道；没写提示词的用原图的，写了的另编码；segm 的按轮廓', () => {
    const pass = { on: true, sam: '', threshold: 0.3, denoise: 0.4, guideSize: 1024, positive: '', negative: '' };
    const graph = builtinGraph(
      {
        ...params,
        details: [
          { ...pass, detector: 'bbox/face_yolov8m.pt' },
          { ...pass, detector: 'segm/person_yolov8m-seg.pt', guideSize: 512, positive: 'masterpiece, detailed body', negative: 'lowres, extra arms' },
        ],
      },
      7,
    );
    expect(graph['8']).toEqual({ class_type: 'UltralyticsDetectorProvider', inputs: { model_name: 'bbox/face_yolov8m.pt' } });
    expect(graph['9'].class_type).toBe('FaceDetailer');
    expect(graph['9'].inputs).toMatchObject({
      image: ['7', 0],
      model: ['1', 0],
      clip: ['2', 0],
      vae: ['1', 2],
      positive: ['3', 0],
      negative: ['4', 0],
      bbox_detector: ['8', 0],
      seed: 7,
      steps: 28,
      cfg: 5,
      sampler_name: 'euler_ancestral',
      scheduler: 'normal',
      denoise: 0.4,
      bbox_threshold: 0.3,
      guide_size: 1024,
      max_size: 1024,
      wildcard: '',
      cycle: 1,
    });
    expect(graph['9'].inputs).not.toHaveProperty('segm_detector_opt');
    expect(graph['9'].inputs).not.toHaveProperty('sam_model_opt');
    expect(graph['11']).toEqual({ class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece, detailed body', clip: ['2', 0] } });
    expect(graph['12']).toEqual({ class_type: 'CLIPTextEncode', inputs: { text: 'lowres, extra arms', clip: ['2', 0] } });
    expect(graph['13'].inputs).toMatchObject({ image: ['9', 0], positive: ['11', 0], negative: ['12', 0], bbox_detector: ['10', 0], segm_detector_opt: ['10', 1], guide_size: 512 });
    expect(graph['14']).toEqual({ class_type: 'PreviewImage', inputs: { images: ['13', 0] } });
  });

  it('出完的图上补做：从传上去的那张图开始，不出新图', () => {
    const graph = builtinGraph(
      { ...params, upscale: { on: true, model: '4x-test.pth', scale: 2, denoise: 0 }, details: [{ on: true, detector: 'bbox/face_yolov8m.pt', sam: '', threshold: 0.3, denoise: 0.4, guideSize: 1024, positive: '', negative: '' }] },
      7,
      { image: 'media-agent-1234.png' },
    );
    expect(graph['5']).toEqual({ class_type: 'LoadImage', inputs: { image: 'media-agent-1234.png' } });
    expect(nodesOf(graph, 'EmptyLatentImage')).toHaveLength(0);
    expect(nodesOf(graph, 'KSampler')).toHaveLength(0);
    expect(graph['7'].inputs.image).toEqual(['5', 0]);
    expect(graph['10'].inputs).toMatchObject({ image: ['8', 0] });
    expect(graph['11']).toEqual({ class_type: 'PreviewImage', inputs: { images: ['10', 0] } });
  });

  const depth: ControlSettings = {
    on: true,
    type: 'depth',
    image: { kind: 'slot', imageId: 'a' },
    preprocessor: 'MiDaS-DepthMapPreprocessor',
    model: 'depth-test.safetensors',
    strength: 1,
    start: 0,
    end: 1,
  };

  it('ControlNet：参考图提取成深度图（分辨率取短边），几个按顺序接在正负面后面，采样用接好的；不提取的直接用那张', () => {
    const pose: ControlSettings = {
      ...depth,
      type: 'pose',
      image: { kind: 'generated', messageId: 'm', jobId: 'j', seed: 3 },
      preprocessor: 'none',
      model: 'openpose-test.safetensors',
      strength: 0.8,
      start: 0.1,
      end: 0.9,
    };
    const graph = builtinGraph({ ...params, controls: [depth, pose] }, 7, { controls: ['media-agent-a.jpg', 'media-agent-b.png'] });
    expect(graph['5']).toEqual({ class_type: 'LoadImage', inputs: { image: 'media-agent-a.jpg' } });
    expect(graph['6']).toEqual({ class_type: 'AIO_Preprocessor', inputs: { image: ['5', 0], preprocessor: 'MiDaS-DepthMapPreprocessor', resolution: 832 } });
    expect(graph['7']).toEqual({ class_type: 'ControlNetLoader', inputs: { control_net_name: 'depth-test.safetensors' } });
    expect(graph['8']).toEqual({
      class_type: 'ControlNetApplyAdvanced',
      inputs: { positive: ['3', 0], negative: ['4', 0], control_net: ['7', 0], image: ['6', 0], strength: 1, start_percent: 0, end_percent: 1 },
    });
    expect(graph['9']).toEqual({ class_type: 'LoadImage', inputs: { image: 'media-agent-b.png' } });
    expect(graph['10']).toEqual({ class_type: 'ControlNetLoader', inputs: { control_net_name: 'openpose-test.safetensors' } });
    expect(graph['11']).toEqual({
      class_type: 'ControlNetApplyAdvanced',
      inputs: { positive: ['8', 0], negative: ['8', 1], control_net: ['10', 0], image: ['9', 0], strength: 0.8, start_percent: 0.1, end_percent: 0.9 },
    });
    expect(graph['12'].class_type).toBe('EmptyLatentImage');
    expect(graph['13']).toMatchObject({ class_type: 'KSampler', inputs: { positive: ['11', 0], negative: ['11', 1], latent_image: ['12', 0] } });
    expect(nodesOf(graph, 'AIO_Preprocessor')).toHaveLength(1);
  });

  it('ControlNet：名字带 union 的再告诉它是哪种；放大重画也用接好的正负面，部位重绘用原来的', () => {
    const face = { on: true, detector: 'bbox/face_yolov8m.pt', sam: '', threshold: 0.3, denoise: 0.4, guideSize: 1024, positive: '', negative: '' };
    const graph = builtinGraph(
      { ...params, controls: [{ ...depth, model: 'union-test.safetensors' }], upscale: { on: true, model: '4x-test.pth', scale: 2, denoise: 0.35 }, details: [face] },
      7,
      { controls: ['u.png'] },
    );
    expect(graph['8']).toEqual({ class_type: 'SetUnionControlNetType', inputs: { control_net: ['7', 0], type: 'depth' } });
    expect(graph['9'].inputs.control_net).toEqual(['8', 0]);
    const samplers = nodesOf(graph, 'KSampler');
    expect(samplers).toHaveLength(2);
    for (const [, sampler] of samplers) expect(sampler.inputs).toMatchObject({ positive: ['9', 0], negative: ['9', 1] });
    expect(nodesOf(graph, 'FaceDetailer')[0][1].inputs).toMatchObject({ positive: ['3', 0], negative: ['4', 0] });
  });

  it('E02 的几样：单独的 VAE 解码、放大重画、部位重绘都用它；LoRA 只作用在画图的模型上，文字理解用底模的；A1111 的权重算法；部位重绘用 SAM 收形状，segm 的也改用 SAM', () => {
    const face = { on: true, detector: 'bbox/face_yolov8m.pt', sam: 'sam_vit_b_01ec64.pth', threshold: 0.2, denoise: 0.5, guideSize: 1024, positive: '', negative: '' };
    const graph = builtinGraph(
      {
        ...params,
        vae: 'sdxl_vae.safetensors',
        loras: [
          { name: 'a.safetensors', strength: 1 },
          { name: 'b.safetensors', strength: 0.5 },
        ],
        loraTarget: 'model',
        weighting: 'a1111',
        upscale: { on: true, model: '4x-test.pth', scale: 2, denoise: 0.35 },
        details: [face, { ...face, detector: 'segm/person_yolov8m-seg.pt', positive: 'masterpiece, detailed body' }],
      },
      7,
    );
    expect(graph['2']).toEqual({ class_type: 'VAELoader', inputs: { vae_name: 'sdxl_vae.safetensors' } });
    expect(graph['3']).toEqual({ class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'a.safetensors', strength_model: 1, model: ['1', 0] } });
    expect(graph['4']).toEqual({ class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'b.safetensors', strength_model: 0.5, model: ['3', 0] } });
    expect(graph['5']).toEqual({ class_type: 'CLIPSetLastLayer', inputs: { stop_at_clip_layer: -2, clip: ['1', 1] } });
    expect(graph['6']).toEqual({
      class_type: 'BNK_CLIPTextEncodeAdvanced',
      inputs: { text: 'masterpiece, 1girl', clip: ['5', 0], token_normalization: 'none', weight_interpretation: 'A1111' },
    });
    expect(graph['7'].inputs).toMatchObject({ text: 'lowres', weight_interpretation: 'A1111' });
    expect(nodesOf(graph, 'CLIPTextEncode')).toHaveLength(0);
    expect(nodesOf(graph, 'BNK_CLIPTextEncodeAdvanced')).toHaveLength(3);
    expect(nodesOf(graph, 'LoraLoader')).toHaveLength(0);
    for (const [, sampler] of nodesOf(graph, 'KSampler')) expect(sampler.inputs.model).toEqual(['4', 0]);
    for (const type of ['VAEDecode', 'VAEEncode', 'FaceDetailer']) {
      for (const [, item] of nodesOf(graph, type)) expect(item.inputs.vae).toEqual(['2', 0]);
    }
    const sams = nodesOf(graph, 'SAMLoader');
    expect(sams.map(([, item]) => item.inputs)).toEqual([
      { model_name: 'sam_vit_b_01ec64.pth', device_mode: 'AUTO' },
      { model_name: 'sam_vit_b_01ec64.pth', device_mode: 'AUTO' },
    ]);
    const detailers = nodesOf(graph, 'FaceDetailer');
    expect(detailers.map(([, item]) => item.inputs.sam_model_opt)).toEqual(sams.map(([id]) => [id, 0]));
    expect(detailers[1][1].inputs).not.toHaveProperty('segm_detector_opt');
    expect(detailers[0][1].inputs).toMatchObject({ model: ['4', 0], clip: ['5', 0], bbox_threshold: 0.2, denoise: 0.5, sam_detection_hint: 'center-1', sam_threshold: 0.93 });
  });
});

describe('inpaintGraph', () => {
  const params: ImageJobParams = {
    family: 'IL',
    positive: 'masterpiece, best quality, 1girl',
    negative: 'lowres, bad hands',
    workflow: BUILTIN_WORKFLOW,
    width: 1024,
    height: 1024,
    checkpoint: 'il-test.safetensors',
    loras: [],
    steps: 28,
    cfg: 5.5,
    sampler: 'dpmpp_2m',
    scheduler: 'karras',
    clipSkip: 2,
    inpaint: { mask: 'image-temp/2026-02-18/101112-mask.png', denoise: 0.8 },
  };

  it('照 E05：底图和掩码同一张 PNG（alpha 通道），裁一块 → 条件 → 采样 → 解码 → 拼回原图 → 预览', () => {
    expect(inpaintGraph(params, 7, { mask: 'media-agent-mask.png' })).toEqual({
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'il-test.safetensors' } },
      '2': { class_type: 'CLIPSetLastLayer', inputs: { stop_at_clip_layer: -2, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece, best quality, 1girl', clip: ['2', 0] } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: 'lowres, bad hands', clip: ['2', 0] } },
      '5': { class_type: 'LoadImage', inputs: { image: 'media-agent-mask.png' } },
      '6': { class_type: 'InpaintCropImproved', inputs: { image: ['5', 0], mask: ['5', 1], ...INPAINT_CROP } },
      '7': { class_type: 'InpaintModelConditioning', inputs: { positive: ['3', 0], negative: ['4', 0], vae: ['1', 2], pixels: ['6', 1], mask: ['6', 2], noise_mask: true } },
      '8': {
        class_type: 'KSampler',
        inputs: {
          seed: 7,
          steps: 28,
          cfg: 5.5,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: 0.8,
          model: ['1', 0],
          positive: ['7', 0],
          negative: ['7', 1],
          latent_image: ['7', 2],
        },
      },
      '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['1', 2] } },
      '10': { class_type: 'InpaintStitchImproved', inputs: { stitcher: ['6', 0], inpainted_image: ['9', 0] } },
      '11': { class_type: 'PreviewImage', inputs: { images: ['10', 0] } },
    });
  });

  it('InpaintCropImproved 的参数照 E05：遮罩外扩 8 像素、重画那块按 1024、周边多留 20% 上下文；没写强度就是 1', () => {
    expect(INPAINT_CROP).toMatchObject({
      mask_expand_pixels: 8,
      output_target_width: 1024,
      output_target_height: 1024,
      context_from_mask_extend_factor: 1.2,
      mask_blend_pixels: 32,
      output_resize_to_target_size: true,
      output_padding: '32',
      device_mode: 'cpu (compatible)',
      preresize: false,
    });
    // 一共 25 个必填项：image 是接进来的那张，另外 24 个参数一个都不能少
    expect(Object.keys(INPAINT_CROP)).toHaveLength(24);
    const graph = inpaintGraph({ ...params, inpaint: undefined }, 7);
    expect(graph['8'].inputs.denoise).toBe(1);
  });

  it('单独的 VAE、LoRA、A1111 的权重算法和内置流程一样接', () => {
    const graph = inpaintGraph({ ...params, vae: 'sdxl_vae.safetensors', loras: [{ name: 'a.safetensors', strength: 0.8 }], weighting: 'a1111', loraTarget: 'model' }, 7);
    expect(graph['2']).toEqual({ class_type: 'VAELoader', inputs: { vae_name: 'sdxl_vae.safetensors' } });
    expect(graph['3']).toEqual({ class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'a.safetensors', strength_model: 0.8, model: ['1', 0] } });
    expect(graph['5'].class_type).toBe('BNK_CLIPTextEncodeAdvanced');
    expect(graph['10'].inputs).toMatchObject({ model: ['3', 0], positive: ['9', 0], negative: ['9', 1], latent_image: ['9', 2] });
    expect(graph['9'].inputs).toMatchObject({ vae: ['2', 0], pixels: ['8', 1], mask: ['8', 2] });
    expect(graph['11'].inputs.vae).toEqual(['2', 0]);
    expect(graph['8'].inputs.image).toEqual(['7', 0]);
  });
});

describe('编辑方案', () => {
  it('按 LoRA 名字认方案，强度改过也算；不是方案里的就是 null', () => {
    expect(editPresetOf(kreaDefaults('edit').loras)?.id).toBe('real-v3');
    expect(editPresetOf([{ name: 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', strength: 0.8 }])?.id).toBe('real-v3');
    expect(editPresetOf([{ name: 'krea2/krea2_identity_edit_v1_1.safetensors', strength: 0.6 }])?.id).toBe('identity-v1-1');
    expect(editPresetOf([])).toBeNull();
    expect(editPresetOf(undefined)).toBeNull();
    expect(editPresetOf([{ name: 'krea2/krea2_darkbrush.safetensors' }])).toBeNull();
  });

  it('每个方案都有一句说明和一个 LoRA；动漫转真人那两档带触发词和作者给的参数', () => {
    for (const preset of KREA2_EDIT_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.note).toBeTruthy();
      expect(preset.loras.length).toBeGreaterThan(0);
    }
    // 默认那个是检验过的：V3 + 10 步 + CFG 1（尺寸由参考图定，方案里不再管宽高）
    expect(KREA2_EDIT_PRESETS[0]).toMatchObject({
      id: 'real-v3',
      trigger: 'transform the image to realistic photograph',
      settings: { steps: 10, cfg: 1 },
    });
    expect(KREA2_EDIT_PRESETS.find((p) => p.id === 'real-v1')).toMatchObject({
      trigger: 'transform the image to realistic photograph',
      settings: { steps: 10, cfg: 1 },
    });
    // 换装和身份编辑没有触发词：它们吃的是自然语言指令
    expect(KREA2_EDIT_PRESETS.filter((p) => !p.trigger).map((p) => p.id)).toEqual(['identity-v1-1', 'identity-v1-2', 'outfit']);
    // 每个方案的 LoRA 组合都不一样，不然认不出来
    expect(new Set(KREA2_EDIT_PRESETS.map((p) => p.loras.map((l) => l.name).join('+'))).size).toBe(KREA2_EDIT_PRESETS.length);
  });

  it('编辑档默认：写实微调底模 + 去审查的文字理解 + 真人化 V3、10 步、CFG 1', () => {
    expect(kreaDefaults('edit')).toMatchObject({
      checkpoint: 'krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors',
      textEncoder: 'qwen3vl_4b_uncensored_int8_convrot.safetensors',
      loras: [{ name: 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', strength: 1 }],
      steps: 10,
      cfg: 1,
      sampler: 'euler',
      scheduler: 'simple',
    });
  });
});

describe('kreaGraph 的三个档', () => {
  const params: ImageJobParams = {
    family: 'Krea2',
    positive: 'transform the image to realistic photograph, a young woman',
    negative: '',
    workflow: BUILTIN_WORKFLOW,
    width: 1024,
    height: 1024,
    checkpoint: 'krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors',
    textEncoder: 'qwen3vl_4b_uncensored_int8_convrot.safetensors',
    vae: 'qwen_image_vae.safetensors',
    loras: [{ name: 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', strength: 1 }],
    steps: 10,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'simple',
    krea: { mode: 'edit', reference: { kind: 'slot', imageId: 'a' }, refBoost: 1, refBoostA: 1, extra: '' },
  };
  const nodesOf = (graph: ReturnType<typeof kreaGraph>, type: string) => Object.entries(graph).filter(([, node]) => node.class_type === type);

  it('编辑档走作者那套 Ostris：参考图按比例缩到长边 2048，尺寸跟着它走，再出图', () => {
    expect(kreaGraph(params, 7, 'scene.png')).toEqual({
      '1': { class_type: 'UNETLoader', inputs: { unet_name: 'krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors', weight_dtype: 'default' } },
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_4b_uncensored_int8_convrot.safetensors', type: 'krea2', device: 'default' } },
      '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
      '4': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', strength_model: 1 } },
      '5': { class_type: 'Krea2OstrisEditModelPatch', inputs: { model: ['4', 0], kv_cache: true } },
      '6': { class_type: 'LoadImage', inputs: { image: 'scene.png' } },
      '7': {
        class_type: 'LayerUtility: ImageScaleByAspectRatio V2',
        inputs: {
          image: ['6', 0],
          aspect_ratio: 'original',
          proportional_width: 1,
          proportional_height: 1,
          fit: 'crop',
          method: 'lanczos',
          round_to_multiple: '16',
          scale_to_side: 'longest',
          scale_to_length: 2048,
          background_color: '#000000',
        },
      },
      '8': { class_type: 'GetImageSize', inputs: { image: ['7', 0] } },
      '9': { class_type: 'EmptySD3LatentImage', inputs: { width: ['8', 0], height: ['8', 1], batch_size: 1 } },
      '10': { class_type: 'TextEncodeKrea2OstrisEdit', inputs: { clip: ['2', 0], prompt: params.positive, vae: ['3', 0], image1: ['7', 0] } },
      '11': { class_type: 'TextEncodeKrea2OstrisEdit', inputs: { clip: ['2', 0], prompt: '', vae: ['3', 0], image1: ['7', 0] } },
      '12': {
        class_type: 'KSampler',
        inputs: { model: ['5', 0], positive: ['10', 0], negative: ['11', 0], latent_image: ['9', 0], seed: 7, steps: 10, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 },
      },
      '13': { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['3', 0] } },
      '14': { class_type: 'PreviewImage', inputs: { images: ['13', 0] } },
    });
  });

  it('双图：图 1 是场景、图 2 是主体，两张各缩一遍，编码节点两路都接', () => {
    const graph = kreaGraph(params, 7, 'scene.png', 'subject.png');
    expect(nodesOf(graph, 'LoadImage').map(([, node]) => node.inputs.image)).toEqual(['scene.png', 'subject.png']);
    expect(nodesOf(graph, 'LayerUtility: ImageScaleByAspectRatio V2').map(([, node]) => node.inputs.image)).toEqual([['6', 0], ['8', 0]]);
    for (const [, node] of nodesOf(graph, 'TextEncodeKrea2OstrisEdit')) {
      expect(node.inputs).toMatchObject({ image1: ['7', 0], image2: ['9', 0] });
    }
    // 出图尺寸还是看图 1 的（场景定构图），潜变量从它的尺寸来
    expect(nodesOf(graph, 'GetImageSize')[0][1].inputs).toEqual({ image: ['7', 0] });
    expect(nodesOf(graph, 'EmptySD3LatentImage')[0][1].inputs).toMatchObject({ width: ['10', 0], height: ['10', 1] });
    expect(nodesOf(graph, 'KSampler')[0][1].inputs).toMatchObject({ denoise: 1 });
  });

  it('四视图不受影响：还是 Krea2Edit 那套、还是缩到 1024×1024、也不接 `_b`', () => {
    const graph = kreaGraph({ ...params, krea: { mode: 'four-view', reference: null, refBoost: 4, extra: '' } }, 7, 'ref.png');
    const patch = nodesOf(graph, 'Krea2EditModelPatch')[0][1];
    expect(patch.inputs).toMatchObject({ ref_boost: 4, ref_boost_a: 1, source_image: ['7', 0], target_latent: ['5', 0] });
    expect(patch.inputs).not.toHaveProperty('source_latent_b');
    expect(nodesOf(graph, 'ImageResizeKJv2')[0][1].inputs).toMatchObject({ width: 1024, height: 1024 });
    expect(nodesOf(graph, 'Krea2OstrisEditModelPatch')).toHaveLength(0);
    expect(nodesOf(graph, 'EmptySD3LatentImage')[0][1].inputs).toMatchObject({ width: 1024, height: 1024 });
  });

  it('文生图还是自带那套：EmptyLatentImage + CLIPTextEncode，不带参考图', () => {
    const graph = kreaGraph({ ...params, krea: { mode: 'text', reference: null, refBoost: 1, extra: '' } }, 7);
    expect(nodesOf(graph, 'EmptyLatentImage')[0][1].inputs).toMatchObject({ width: 1024, height: 1024 });
    expect(nodesOf(graph, 'CLIPTextEncode')[0][1].inputs).toMatchObject({ text: params.positive });
    expect(nodesOf(graph, 'LoadImage')).toHaveLength(0);
  });
});

describe('ControlNet 的下拉', () => {
  const preprocessors = [
    'none',
    'MiDaS-DepthMapPreprocessor',
    'DepthAnythingV2Preprocessor',
    'DWPreprocessor',
    'OpenposePreprocessor',
    'DensePosePreprocessor',
    'AnimeLineArtPreprocessor',
    'LineArtPreprocessor',
    'CannyEdgePreprocessor',
    'HEDPreprocessor',
    'M-LSDPreprocessor',
    'TilePreprocessor',
  ];
  const controlnets = ['FLUX.1-dev-ControlNet-Union-Pro-2.0.safetensors', 'noob-sdxl-controlnet-depth_midas-v1-1.safetensors', 'noob_openpose.safetensors', 'xinsir-union-promax.safetensors'];

  it('提取方式按类型挑，「其他」全列，都不含 none', () => {
    expect(controlPreprocessors('pose', preprocessors)).toEqual(['DWPreprocessor', 'OpenposePreprocessor', 'DensePosePreprocessor']);
    expect(controlPreprocessors('depth', preprocessors)).toEqual(['MiDaS-DepthMapPreprocessor', 'DepthAnythingV2Preprocessor']);
    expect(controlPreprocessors('lineart', preprocessors)).toEqual(['AnimeLineArtPreprocessor', 'LineArtPreprocessor']);
    expect(controlPreprocessors('edge', preprocessors)).toEqual(['CannyEdgePreprocessor', 'HEDPreprocessor', 'M-LSDPreprocessor']);
    expect(controlPreprocessors('other', preprocessors)).toEqual(preprocessors.slice(1));
  });

  it('模型：名字对得上的在前，再是带 union 的；一个都对不上全列，「其他」全列', () => {
    expect(controlModels('depth', controlnets)).toEqual([
      'noob-sdxl-controlnet-depth_midas-v1-1.safetensors',
      'FLUX.1-dev-ControlNet-Union-Pro-2.0.safetensors',
      'xinsir-union-promax.safetensors',
    ]);
    expect(controlModels('lineart', controlnets)).toEqual(['FLUX.1-dev-ControlNet-Union-Pro-2.0.safetensors', 'xinsir-union-promax.safetensors']);
    expect(controlModels('lineart', ['a.safetensors'])).toEqual(['a.safetensors']);
    expect(controlModels('other', controlnets)).toEqual(controlnets);
  });

  it('新加一个先选的：深度 MiDaS、姿势 DWPose，列表里没有就选这一类的第一个，一个都没有是不提取；模型选名字对得上的，没有就空着', () => {
    expect(newControl('depth', { preprocessors, controlnets })).toEqual({
      on: true,
      type: 'depth',
      image: null,
      preprocessor: 'MiDaS-DepthMapPreprocessor',
      model: 'noob-sdxl-controlnet-depth_midas-v1-1.safetensors',
      strength: 1,
      start: 0,
      end: 1,
    });
    expect(controlChoices('pose', { preprocessors, controlnets })).toEqual({ preprocessor: 'DWPreprocessor', model: 'noob_openpose.safetensors' });
    expect(controlChoices('pose', { preprocessors: ['none', 'OpenposePreprocessor'], controlnets: ['xinsir-union-promax.safetensors'] })).toEqual({ preprocessor: 'OpenposePreprocessor', model: '' });
    expect(controlChoices('edge', { preprocessors: ['none'], controlnets })).toEqual({ preprocessor: 'none', model: '' });
    expect(controlChoices('other', { preprocessors, controlnets })).toEqual({ preprocessor: 'none', model: '' });
  });

  it('union 的类型：姿势 openpose、深度 depth、线稿和 Canny 那类边缘一组、HED 那类边缘一组、其他 auto', () => {
    expect(unionType({ type: 'pose', preprocessor: 'DWPreprocessor' })).toBe('openpose');
    expect(unionType({ type: 'depth', preprocessor: 'none' })).toBe('depth');
    expect(unionType({ type: 'lineart', preprocessor: 'AnimeLineArtPreprocessor' })).toBe('canny/lineart/anime_lineart/mlsd');
    expect(unionType({ type: 'edge', preprocessor: 'CannyEdgePreprocessor' })).toBe('canny/lineart/anime_lineart/mlsd');
    expect(unionType({ type: 'edge', preprocessor: 'HEDPreprocessor' })).toBe('hed/pidi/scribble/ted');
    expect(unionType({ type: 'other', preprocessor: 'none' })).toBe('auto');
  });
});

describe('种子和文件名', () => {
  it('种子依次加 1', () => {
    expect(jobSeeds(100, 4)).toEqual([100, 101, 102, 103]);
  });

  it('临时文件夹按本机日期，文件名是时分秒加种子；下载的文件名是节点标题加种子，不能用的字符换成 _', () => {
    const when = new Date(2026, 9, 3, 9, 5, 7);
    expect(tempFolderName(when)).toBe('2026-10-03');
    expect(tempFileName(when, 42)).toBe('090507-42.png');
    expect(downloadFileName(' 窗边/读书: 下午? ', 42)).toBe('窗边_读书_ 下午_-42.png');
  });
});

describe('出图设置的默认值', () => {
  it('尺寸九档，正方形、竖的四档、横的四档；自己填的取最近的 8 的倍数', () => {
    expect(IMAGE_SIZES).toHaveLength(9);
    expect(IMAGE_SIZES).toContainEqual({ width: 1216, height: 832 });
    expect([870, 1283, 864].map(roundSize)).toEqual([872, 1280, 864]);
  });

  it('参数取系列的默认值；尺寸 832×1216、4 张、种子随机、底模没选（出图时用这台 ComfyUI 上这个系列的第一个），不开 ControlNet，E02 的几样照原来的', () => {
    expect(defaultImageSettings(FAMILY_DEFAULTS.Pony)).toMatchObject({
      width: 832,
      height: 1216,
      count: 4,
      steps: 25,
      cfg: 7,
      seed: null,
      checkpoint: '',
      rating: 'none',
      controls: [],
      vae: '',
      loraTarget: 'both',
      weighting: 'comfy',
    });
  });

  it('节点里 P16 之前加的部位重绘没有 SAM，读出来算不用', () => {
    const old = { on: true, detector: 'bbox/face_yolov8m.pt', threshold: 0.3, denoise: 0.4, guideSize: 1024, positive: '', negative: '' } as DetailPass;
    expect(imageSettingsOf({ details: [old] }, FAMILY_DEFAULTS.IL).details).toEqual([{ ...old, sam: '' }]);
  });

  it('底模属于哪个系列：标过的照标的；没标过的按名字猜，看不出是 IL 或 Pony 的两个都不是', () => {
    expect(checkpointFamily('ponyDiffusionV6.safetensors', {})).toEqual({ family: 'Pony', guessed: true });
    for (const name of ['SDXL/waiIllustriousSDXL_v150.safetensors', 'Illustrious/oneObsession_v7.safetensors', 'JANKUV5TrainedNoobai_v50.safetensors', 'SDXL/IL-Gembyte_20Emerald.safetensors', 'il-test.safetensors', 'waiNSFW.safetensors']) {
      expect(checkpointFamily(name, {})).toEqual({ family: 'IL', guessed: true });
    }
    for (const name of ['flux1-dev-fp8.safetensors', 'SDXL/sd_xl_base_1.0.safetensors', 'Amina-12steps-liuli-AIO-0_1.safetensors', 'pencil-sketch.safetensors', 'toString']) {
      expect(checkpointFamily(name, {})).toEqual({ family: null, guessed: true });
    }
    expect(checkpointFamily('ponyDiffusionV6.safetensors', { 'ponyDiffusionV6.safetensors': 'IL' })).toEqual({ family: 'IL', guessed: false });
    expect(checkpointFamily('SDXL/waiIllustriousSDXL_v150.safetensors', { 'SDXL/waiIllustriousSDXL_v150.safetensors': null })).toEqual({ family: null, guessed: false });
    expect(checkpointFamily('flux1-dev-fp8.safetensors', { 'flux1-dev-fp8.safetensors': 'IL' })).toEqual({ family: 'IL', guessed: false });
  });
});

describe('出图失败是哪一种', () => {
  it('按服务端写的原因分：连不上、底模文件不在、ComfyUI 不收、显存不够、程序重启时没出完、别的', () => {
    expect(imageErrorKind('连不上 ComfyUI（http://192.168.1.20:8188）：地址不对，或者 ComfyUI 没开。原话：fetch failed')).toBe('down');
    expect(imageErrorKind('连不上 ComfyUI 的进度推送（http://192.168.1.20:8188/ws）：地址不对，或者 ComfyUI 没开')).toBe('down');
    expect(imageErrorKind("ComfyUI 不收这个任务：CheckpointLoaderSimple（1 号节点）ckpt_name: 'gone.safetensors' not in ['a.safetensors']")).toBe('checkpoint');
    expect(imageErrorKind("ComfyUI 不收这个任务：LoraLoader（2 号节点）lora_name: 'x' not in []")).toBe('rejected');
    expect(imageErrorKind('这台 ComfyUI 缺插件：object_info 里没有 FaceDetailer')).toBe('missing');
    expect(imageErrorKind('显存不够：CUDA out of memory')).toBe('memory');
    expect(imageErrorKind('程序重启时这张还没出完')).toBe('restart');
    expect(imageErrorKind('出图出错（KSampler）：坏了')).toBe('other');
  });
});
