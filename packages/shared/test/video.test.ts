import { describe, expect, it } from 'vitest';
import {
  addTiming,
  DEFAULT_VIDEO_SETTINGS,
  latentCount,
  latentFrame,
  missingNodeTypes,
  nearestLatent,
  PLUGIN_OF,
  reshootGraph,
  reshootPlan,
  reshootText,
  reshootWhere,
  segmentCount,
  slotDiff,
  splitSegments,
  videoDownloadName,
  videoFrames,
  videoGraph,
  videoImageUse,
  videoParams,
  videoRatioOf,
  videoRemainingMs,
  videoSizes,
  videoStage,
  videoTempFileName,
  videoWindowStarts,
  VIDEO_SPEEDS,
  VIDEO_MODEL,
  type VideoTiming,
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

describe('加速和不加速', () => {
  it('参数记下每段几步，流程里一采、二采的步数照它；以前出的没记的按加速的', () => {
    const fast = videoParams(['一段'], 15, '16:9', DEFAULT_VIDEO_SETTINGS);
    const full = videoParams(['一段'], 15, '16:9', { ...DEFAULT_VIDEO_SETTINGS, speed: 'full', model: VIDEO_SPEEDS.full.model });
    expect([fast.steps, full.steps]).toEqual([
      { pass1: 10, pass2: 3 },
      { pass1: 20, pass2: 6 },
    ]);
    const scheduled = (graph: ReturnType<typeof videoGraph>) => Object.values(graph).filter((node) => node.class_type === 'BasicScheduler').map((node) => [node.inputs.steps, node.inputs.denoise]);
    expect(scheduled(videoGraph(full, 1))).toEqual([
      [20, 1],
      [6, 0.2],
    ]);
    expect(videoGraph(full, 1)['1'].inputs.unet_name).toBe('minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors');
    expect(scheduled(videoGraph({ ...fast, steps: undefined }, 1))).toEqual([
      [10, 1],
      [3, 0.2],
    ]);
  });
});

describe('带图的流程', () => {
  const nodes = (graph: ReturnType<typeof videoGraph>, type: string) => Object.values(graph).filter((node) => node.class_type === type);

  it('槽位的图怎么用跟着写回复的那套提示词：自己建的按名字开头认，认不出的按参考模式', () => {
    expect(['ref2va', 'i2v', 't2v', 'fl2va', 'l2va', 'i2v-慢节奏', 't2va', '我的参考', undefined].map(videoImageUse)).toEqual([
      'refs',
      'first',
      'none',
      'unsupported',
      'unsupported',
      'first',
      'refs',
      'refs',
      'refs',
    ]);
  });

  it('图当首帧、比例自动的宽高按这张图算；比例选了固定的照选的', () => {
    const first = { id: 'a', width: 600, height: 900 };
    expect(videoParams(['一段'], 15, 'auto', DEFAULT_VIDEO_SETTINGS, { refs: ['a'], firstFrame: first })).toMatchObject({
      aspectRatio: 'image',
      refs: ['a'],
      firstFrame: 'a',
      width: 544,
      height: 800,
      finalWidth: 1088,
      finalHeight: 1600,
    });
    expect(videoParams(['一段'], 15, '16:9', DEFAULT_VIDEO_SETTINGS, { refs: ['a'], firstFrame: first })).toMatchObject({ aspectRatio: '16:9', width: 864, height: 480 });
    expect(videoRatioOf('auto', 'refs', first)).toBe('auto');
  });

  it('一张参考图直接接；几张用 ImageTensorList 按顺序接成一串；首帧接在一采的 keyframes，二采不接', () => {
    const one = videoGraph(videoParams(['一段'], 15, '16:9', DEFAULT_VIDEO_SETTINGS, { refs: ['a'] }), 1, { refs: ['a.png'] });
    expect(nodes(one, 'MMH3ReferenceMultiPrompt')[0].inputs.ref_images).toEqual(['30', 0]);
    expect(nodes(one, 'ImageTensorList')).toEqual([]);

    const three = videoGraph(videoParams(['一段'], 15, '16:9', DEFAULT_VIDEO_SETTINGS, { refs: ['a', 'b', 'c'] }), 1, { refs: ['a.png', 'b.png', 'c.png'] });
    expect(nodes(three, 'LoadImage').map((node) => node.inputs.image)).toEqual(['a.png', 'b.png', 'c.png']);
    expect([three[40].inputs, three[41].inputs]).toEqual([
      { image1: ['30', 0], image2: ['31', 0] },
      { image1: ['40', 0], image2: ['32', 0] },
    ]);
    expect(nodes(three, 'MMH3ReferenceMultiPrompt')[0].inputs.ref_images).toEqual(['41', 0]);
    expect(nodes(three, 'MMH3LoopingSampler').map((node) => node.inputs.keyframes)).toEqual([undefined, undefined]);

    const params = videoParams(['一段'], 15, 'auto', DEFAULT_VIDEO_SETTINGS, { refs: ['a'], firstFrame: { id: 'a', width: 600, height: 900 } });
    const first = videoGraph(params, 1, { refs: ['a.png'], firstFrame: 'a.png' });
    expect(nodes(first, 'LoadImage')).toHaveLength(1);
    expect(nodes(first, 'MMH3LoopingSampler').map((node) => node.inputs.keyframes)).toEqual([['30', 0], undefined]);
    expect(missingNodeTypes(three, ['LoadImage']).filter((type) => !PLUGIN_OF[type])).toEqual([
      'UNETLoader',
      'ModelAttentionBackend',
      'CLIPLoader',
      'VAELoader',
      'BasicGuider',
      'RandomNoise',
      'KSamplerSelect',
      'BasicScheduler',
      'LTXVSeparateAVLatent',
      'LTXVConcatAVLatent',
      'VAEDecodeAudio',
    ]);
  });
});

describe('估还要多久', () => {
  const params = videoParams(['一', '二'], 30, '16:9', DEFAULT_VIDEO_SETTINGS);
  const timing = (at: string, pass1StepMs = 9000): VideoTiming => ({
    at,
    finalWidth: 1728,
    finalHeight: 960,
    segments: 2,
    encodeMs: 30_000,
    pass1StepMs,
    upscaleMs: 8000,
    pass2StepMs: 30_000,
    saveMs: 100_000,
  });
  const now = 1_000_000;

  it('同样大小、同样段数的只留最近 5 条；别的大小的不动', () => {
    const other = { ...timing('o'), segments: 1 };
    let all = [other];
    for (let i = 0; i < 7; i += 1) all = addTiming(all, timing(String(i)));
    expect(all.map((t) => t.at)).toEqual(['o', '2', '3', '4', '5', '6']);
  });

  it('没开始的：各步加起来，一采、二采按每步用时乘段数乘步数；用最近一条', () => {
    const timings = [timing('old', 1), timing('new')];
    // 30 + 9×10×2 + 8 + 30×3×2 + 100 = 498 秒
    expect(videoRemainingMs(params, null, timings, now)).toBe(498_000);
    expect(videoRemainingMs({ ...params, finalWidth: 1312 }, null, timings, now)).toBeNull();
    // 不加速的步数多一倍，每步用时一样：30 + 9×20×2 + 8 + 30×6×2 + 100 = 858 秒；以前出的没记步数，按加速的算
    const full = videoParams(['一', '二'], 30, '16:9', { ...DEFAULT_VIDEO_SETTINGS, speed: 'full' });
    expect(videoRemainingMs(full, null, timings, now)).toBe(858_000);
    expect(videoRemainingMs({ ...params, steps: undefined }, null, timings, now)).toBe(498_000);
  });

  it('一采第 2 段第 4 步：一采还剩 6 步，加上后面的；正在放大的按那条的用时减去已经做了的', () => {
    const timings = [timing('new')];
    expect(videoRemainingMs(params, { stage: 'pass1', chunk: 2, chunks: 2, step: 4, steps: 10, since: now }, timings, now)).toBe(6 * 9000 + 8000 + 180_000 + 100_000);
    expect(videoRemainingMs(params, { stage: 'upscale', chunk: 0, chunks: 2, step: 0, steps: 0, since: now - 3000 }, timings, now)).toBe(5000 + 180_000 + 100_000);
    expect(videoRemainingMs(params, { stage: 'save', chunk: 0, chunks: 2, step: 0, steps: 0, since: now - 200_000 }, timings, now)).toBe(0);
  });
});

describe('视频的文件名', () => {
  it('临时文件 HHmmss-种子.mp4；下载 节点标题-种子.mp4，不能用的字符换成 _', () => {
    expect(videoTempFileName(new Date(2026, 9, 7, 9, 5, 3), 42)).toBe('090503-42.mp4');
    expect(videoDownloadName(' 雨后/骑车 ', 7)).toBe('雨后_骑车-7.mp4');
  });
});

describe('重拍一截', () => {
  const nodes = (graph: ReturnType<typeof videoGraph>, type: string) => Object.values(graph).filter((node) => node.class_type === type);
  const thirty = videoParams(['第一段', '第二段'], 30, '16:9', DEFAULT_VIDEO_SETTINGS);
  const latents = { pass1: 'a_pass1.h3latent.safetensors', pass2: 'a_pass2.h3latent.safetensors' };

  it('潜空间帧：每 5 个管 17 帧；一窗 362 帧是 107 个，重叠 22 帧是 7 个，两段 30 秒是 207 个；选的地方对齐到最近的潜空间帧', () => {
    expect([0, 1, 2, 3, 4, 5].map(latentFrame)).toEqual([0, 1, 5, 9, 13, 17]);
    expect([362, 22, 702].map(latentCount)).toEqual([107, 7, 207]);
    expect([192, 480, 24, 48].map((frame) => latentFrame(nearestLatent(frame)))).toEqual([192, 481, 22, 47]);
  });

  it('只碰到一窗的切这一窗；跨两窗的两窗一起切；文字说重拍几秒到几秒、在第几段', () => {
    const plan = reshootPlan(thirty, 192, 264);
    expect(plan).toMatchObject({ from: 192, to: 264, fromLatent: 57, toLatent: 78, firstWindow: 0, lastWindow: 0, startLatent: 0, endLatent: 107, startFrame: 0, frames: 362, totalLatents: 207 });
    expect(`${reshootText(plan.from, plan.to)}，${reshootWhere(plan)}`).toBe('重拍 8.0 到 11.0 秒，在第 1 段');

    const across = reshootPlan(thirty, 336, 384);
    expect(across).toMatchObject({ firstWindow: 0, lastWindow: 1, startLatent: 0, endLatent: 207, frames: 702 });
    expect(reshootWhere(across)).toBe('跨第 1、2 段');
    expect(reshootWhere({ firstWindow: 0, lastWindow: 2 })).toBe('跨第 1 到 3 段');
    // 时间条上的分界和分窗对得上：分界那一帧算后一段
    expect(videoWindowStarts(thirty)).toEqual([362]);
    expect([reshootPlan(thirty, 358, 362).firstWindow, reshootPlan(thirty, 362, 366).firstWindow]).toEqual([0, 1]);

    const second = reshootPlan(thirty, 480, 528);
    expect(second).toMatchObject({ from: 481, to: 528, firstWindow: 1, lastWindow: 1, startLatent: 100, startFrame: 340, endLatent: 207, frames: 362 });
  });

  it('流程：读回两份存档切出这几窗，遮罩只白这一截；一采从存档出发，二采只换重画的潜空间帧；前后从存档接上；新的整条也存', () => {
    const plan = reshootPlan(thirty, 192, 264);
    const graph = reshootGraph(thirty, 5, { refs: [] }, 'job', plan, latents);
    expect(nodes(graph, 'MiniMaxH3NativeLatentCheckpointLoadT8Advanced').map((node) => node.inputs.checkpoint_path)).toEqual([latents.pass1, latents.pass2]);
    expect(nodes(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ prompts: '第一段', length: 362 });
    expect(nodes(graph, 'RepeatImageBatch').map((node) => node.inputs.amount)).toEqual([192, 72, 98]);
    expect(nodes(graph, 'SolidMask').map((node) => node.inputs.value)).toEqual([0, 1, 0]);
    const [pass1, pass2] = nodes(graph, 'MMH3LoopingSampler');
    expect(pass1.inputs).toMatchObject({ overlap_strength_audio: 1 });
    expect(graph[(pass1.inputs.latent as [string, number])[0]].inputs).toMatchObject({ trim_head_latents: 0, trim_tail_latents: 100 });
    expect(pass1.inputs.denoise_mask).toEqual(pass2.inputs.denoise_mask);
    expect(nodes(graph, 'LatentCut')[0].inputs).toMatchObject({ index: 57, amount: 21 });
    expect(nodes(graph, 'ReplaceVideoLatentFrames')[0].inputs.index).toBe(57);
    // 只有后面要接：从第 2 窗开头往前 7 个开始，拼的时候去掉这 7 个
    const concats = nodes(graph, 'MMH3ConcatAV');
    expect(concats.map((node) => [graph[(node.inputs.latent_b as [string, number])[0]].inputs.trim_head_latents, node.inputs.trim_b_latents])).toEqual([
      [100, 7],
      [100, 7],
    ]);
    expect(nodes(graph, 'MiniMaxH3NativeLatentCheckpointSaveT8Advanced').map((node) => node.inputs.filename_prefix)).toEqual(['media_agent_job_pass1', 'media_agent_job_pass2']);
    expect(['MMH3TrimAV', 'MMH3ConcatAV', 'MiniMaxH3NativeLatentCheckpointLoadT8Advanced', 'MiniMaxH3NativeLatentCheckpointSaveT8Advanced'].map((type) => PLUGIN_OF[type])).toEqual([
      'ComfyUI-MMH3Tools',
      'ComfyUI-MMH3Tools',
      'comfyui-minimax-h3-audio-T8',
      'comfyui-minimax-h3-audio-T8',
    ]);
  });

  it('首帧图只在切出的从第 1 窗开始时接；参考图都接', () => {
    const params = videoParams(['第一段', '第二段'], 30, 'auto', DEFAULT_VIDEO_SETTINGS, { refs: ['a'], firstFrame: { id: 'a', width: 600, height: 900 } });
    const files = { refs: ['a.png'], firstFrame: 'a.png' };
    const front = reshootGraph(params, 5, files, 'job', reshootPlan(params, 24, 48), latents);
    const back = reshootGraph(params, 5, files, 'job', reshootPlan(params, 480, 528), latents);
    expect(nodes(front, 'MMH3LoopingSampler')[0].inputs.keyframes).toBeDefined();
    expect(nodes(back, 'MMH3LoopingSampler')[0].inputs.keyframes).toBeUndefined();
    expect(nodes(back, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ prompts: '第二段', ref_images: expect.any(Array) });
  });
});
