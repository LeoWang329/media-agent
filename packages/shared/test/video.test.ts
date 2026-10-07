import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO_SETTINGS,
  missingNodeTypes,
  PLUGIN_OF,
  segmentCount,
  slotDiff,
  splitSegments,
  videoDownloadName,
  videoFrames,
  videoGraph,
  videoParams,
  videoSizes,
  videoStage,
  videoTempFileName,
  VIDEO_MODEL,
} from '../src';

const settings = (duration: number) => ({ slots: [], duration, aspectRatio: '16:9' as const });
const snapshot = (duration: number) => ({ slotSnapshot: [], duration, aspectRatio: '16:9' as const });

describe('长视频分几段', () => {
  it('15 秒以内 1 段，16 到 30 秒 2 段，31 到 45 秒 3 段，46 到 60 秒 4 段', () => {
    expect([4, 15, 16, 30, 31, 45, 46, 60].map(segmentCount)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('发给模型的说明：超过 15 秒写分几段、每段约几秒；改了时长写分几段', () => {
    expect(slotDiff(null, settings(60)).systemNote).toBe('本次没有参考图。视频时长 60 秒，分 4 段生成，每段约 15 秒，相邻两段重叠约 1 秒。画面比例 16:9。');
    expect(slotDiff(null, settings(20)).systemNote).toBe('本次没有参考图。视频时长 20 秒，分 2 段生成，每段约 10 秒，相邻两段重叠约 1 秒。画面比例 16:9。');
    expect(slotDiff(null, settings(15)).systemNote).toBe('本次没有参考图。视频时长 15 秒，画面比例 16:9。');
    expect(slotDiff(snapshot(8), settings(60)).systemNote).toBe('视频时长改为 60 秒，分 4 段生成。');
    expect(slotDiff(snapshot(60), settings(12)).systemNote).toBe('视频时长改为 12 秒。');
  });
});

describe('splitSegments', () => {
  it('单独一行只有 | 的地方切开，每段去掉首尾空行；没有这种行就是一段', () => {
    expect(splitSegments('第一段\n|\n第二段')).toEqual(['第一段', '第二段']);
    expect(splitSegments('第一段\r\n\r\n  |  \r\n\r\n第二段\n|\n第三段\n')).toEqual(['第一段', '第二段', '第三段']);
    expect(splitSegments('只有一段\n两行')).toEqual(['只有一段\n两行']);
  });

  it('行里夹着 | 的不切；空的段不算', () => {
    expect(splitSegments('a | b\n||\nc')).toEqual(['a | b\n||\nc']);
    expect(splitSegments('|\n第一段\n|\n\n|\n第二段\n|')).toEqual(['第一段', '第二段']);
    expect(splitSegments('  \n')).toEqual([]);
  });
});

describe('videoFrames', () => {
  it('帧数是 17 的倍数加 5，重叠 22 帧：60 秒 4 段 1382 帧，15 秒 1 段 362 帧', () => {
    expect(videoFrames(60, 4)).toEqual({ total: 1382, chunk: 362, overlap: 22 });
    expect(videoFrames(15, 1)).toEqual({ total: 362, chunk: 362, overlap: 22 });
  });

  it('20 秒 2 段每段 243 帧；4 秒按最少 107 帧；段数比时长该有的少时每段最多 362 帧，整条变短', () => {
    expect(videoFrames(20, 2)).toEqual({ total: 464, chunk: 243, overlap: 22 });
    expect(videoFrames(4, 1)).toEqual({ total: 107, chunk: 107, overlap: 22 });
    expect(videoFrames(60, 2)).toEqual({ total: 702, chunk: 362, overlap: 22 });
    for (const [seconds, segments] of [[60, 4], [20, 2], [33, 3], [4, 1]]) {
      const { chunk, total } = videoFrames(seconds, segments);
      expect((chunk - 5) % 17).toBe(0);
      expect((total - 5) % 17).toBe(0);
    }
  });
});

describe('videoSizes', () => {
  it('一采照 ResolutionSelector：16:9、0.4 是 864×480，乘 2 出 1728×960；0.3 是 736×416，出 1472×832', () => {
    expect(videoSizes(0.4, 2, '16:9')).toEqual({ width: 864, height: 480, finalWidth: 1728, finalHeight: 960 });
    expect(videoSizes(0.3, 2, '16:9')).toEqual({ width: 736, height: 416, finalWidth: 1472, finalHeight: 832 });
    expect(videoSizes(1, 2, '16:9')).toMatchObject({ width: 1376, height: 768 });
  });

  it('竖的宽高对调；比例自动按 16:9；放大 1.5 对齐到 32 的倍数', () => {
    expect(videoSizes(0.4, 2, '9:16')).toEqual({ width: 480, height: 864, finalWidth: 960, finalHeight: 1728 });
    expect(videoSizes(0.4, 2, 'auto')).toEqual(videoSizes(0.4, 2, '16:9'));
    expect(videoSizes(0.4, 1.5, '16:9')).toEqual({ width: 864, height: 480, finalWidth: 1312, finalHeight: 736 });
    expect(videoSizes(0.4, 2, '1:1')).toMatchObject({ width: 640, height: 640 });
  });
});

describe('videoGraph', () => {
  const params = videoParams(['第一段', '第二段 | 带竖线', '第三段', '第四段'], 60, '16:9', DEFAULT_VIDEO_SETTINGS);
  const graph = videoGraph(params, 123);
  const nodes = (type: string) => Object.values(graph).filter((node) => node.class_type === type);

  it('参数：几段提示词、写回复时的时长和比例、一采和出片大小、主模型', () => {
    expect(params).toMatchObject({ seconds: 60, aspectRatio: '16:9', megapixels: 0.4, upscale: 2, width: 864, height: 480, finalWidth: 1728, finalHeight: 960, model: VIDEO_MODEL });
    expect(params.frames).toEqual({ total: 1382, chunk: 362, overlap: 22 });
  });

  it('提示词用单独一行 | 连起来，段里本来有的 | 换掉；一采的宽高、整条帧数', () => {
    const [prompts] = nodes('MMH3ReferenceMultiPrompt');
    expect(prompts.inputs).toMatchObject({ width: 864, height: 480, length: 1382, unload_text_encoder: true });
    expect(prompts.inputs.prompts).toBe('第一段\n|\n第二段 / 带竖线\n|\n第三段\n|\n第四段');
  });

  it('两个 MMH3LoopingSampler 每段 362 帧、重叠 22 帧；一采 10 步、二采 3 步去噪 0.2；同一个种子', () => {
    const samplers = nodes('MMH3LoopingSampler');
    expect(samplers).toHaveLength(2);
    for (const sampler of samplers) expect(sampler.inputs).toMatchObject({ chunk_frames: 362, overlap_frames: 22, carry: 'mask', overlap_strength_video: 1, overlap_strength_audio: 0.9 });
    const sigmas = samplers.map((sampler) => graph[(sampler.inputs.sigmas as [string, number])[0]].inputs);
    expect(sigmas).toEqual([expect.objectContaining({ scheduler: 'beta', steps: 10, denoise: 1 }), expect.objectContaining({ scheduler: 'beta', steps: 3, denoise: 0.2 })]);
    expect(nodes('RandomNoise')).toEqual([expect.objectContaining({ inputs: { noise_seed: 123 } })]);
  });

  it('不解码放大到出片宽高；主模型；存到 media-agent/ 下；声音用一采的', () => {
    expect(nodes('MinimaxH3LatentUpscaler3D')[0].inputs).toMatchObject({ mode: 'target dimensions', 'mode.width': 1728, 'mode.height': 960, align: 32 });
    expect(nodes('UNETLoader')[0].inputs.unet_name).toBe(VIDEO_MODEL);
    expect(nodes('MMH3StreamingSave')[0].inputs).toMatchObject({ filename_prefix: 'media-agent/video', fps: 24 });
    const [pass1] = Object.entries(graph).find(([, node]) => node.class_type === 'MMH3LoopingSampler')!;
    expect(nodes('VAEDecodeAudio')[0].inputs.samples).toEqual([pass1, 0]);
  });

  it('插件节点都写了是哪个插件的；做到哪一步只认编码、一采、放大、二采、存文件这五个节点', () => {
    const core = ['UNETLoader', 'ModelAttentionBackend', 'CLIPLoader', 'VAELoader', 'BasicGuider', 'RandomNoise', 'KSamplerSelect', 'BasicScheduler', 'LTXVSeparateAVLatent', 'LTXVConcatAVLatent', 'VAEDecodeAudio'];
    expect(missingNodeTypes(graph, core).every((type) => PLUGIN_OF[type])).toBe(true);
    const stages = Object.entries(graph).flatMap(([id, node]) => (videoStage(id) ? [[node.class_type, videoStage(id)]] : []));
    expect(stages).toEqual([
      ['MMH3ReferenceMultiPrompt', 'encode'],
      ['MMH3LoopingSampler', 'pass1'],
      ['MinimaxH3LatentUpscaler3D', 'upscale'],
      ['MMH3LoopingSampler', 'pass2'],
      ['MMH3StreamingSave', 'save'],
    ]);
  });
});

describe('视频的文件名', () => {
  it('临时文件 HHmmss-种子.mp4；下载 节点标题-种子.mp4，不能用的字符换成 _', () => {
    expect(videoTempFileName(new Date(2026, 9, 7, 9, 5, 3), 42)).toBe('090503-42.mp4');
    expect(videoDownloadName(' 雨后/骑车 ', 7)).toBe('雨后_骑车-7.mp4');
  });
});
