import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WORKFLOW,
  builtinGraph,
  checkpointFamily,
  composeChecked,
  defaultImageSettings,
  downloadFileName,
  FAMILY_DEFAULTS,
  IMAGE_SIZES,
  jobSeeds,
  negativePrompt,
  parsePromptMeta,
  positivePrompt,
  splitTags,
  tempFileName,
  tempFolderName,
  type ImageJobParams,
} from '../src';

describe('parsePromptMeta', () => {
  it('开头的说明段写着「用途: 生图」的是生图提示词，读出底模系列，发给模型的部分去掉这段', () => {
    expect(parsePromptMeta('---\n用途: 生图\n底模: IL\n---\n只写标签')).toEqual({ use: 'image', family: 'IL', body: '只写标签' });
    expect(parsePromptMeta('---\r\n用途：生图\r\n底模：pony\r\n---\r\n正文')).toEqual({ use: 'image', family: 'Pony', body: '正文' });
  });

  it('没有说明段、用途不是生图的都是视频提示词；底模写错是 null', () => {
    expect(parsePromptMeta('你是视频提示词助手')).toEqual({ use: 'video', family: null, body: '你是视频提示词助手' });
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
  it('尺寸九档，正方形、竖的四档、横的四档', () => {
    expect(IMAGE_SIZES).toHaveLength(9);
    expect(IMAGE_SIZES).toContainEqual({ width: 1216, height: 832 });
  });

  it('参数取系列的默认值；尺寸 832×1216、4 张、种子随机、底模等用户选', () => {
    expect(defaultImageSettings(FAMILY_DEFAULTS.Pony)).toMatchObject({ width: 832, height: 1216, count: 4, steps: 25, cfg: 7, seed: null, checkpoint: '', rating: 'none' });
  });

  it('底模属于哪个系列：标过的照标的，没标过的名字里有 pony 的当 Pony', () => {
    expect(checkpointFamily('ponyDiffusionV6.safetensors', {})).toEqual({ family: 'Pony', guessed: true });
    expect(checkpointFamily('waiNSFW.safetensors', {})).toEqual({ family: 'IL', guessed: true });
    expect(checkpointFamily('ponyDiffusionV6.safetensors', { 'ponyDiffusionV6.safetensors': 'IL' })).toEqual({ family: 'IL', guessed: false });
    expect(checkpointFamily('toString', {})).toEqual({ family: 'IL', guessed: true });
  });
});
