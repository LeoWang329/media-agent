import type { AspectRatio, ComfyGraph, VideoJob, VideoJobParams, VideoSettings, VideoStage } from './types';

// 生成视频：分几段、每段多少帧、一采和出片多大、拼发给 ComfyUI 的流程，见 docs/dev-plan.md 5.24 到 5.26

// 视频节点的时长能选 4 到 60 秒；一段最长 15 秒，最多 4 段
export const VIDEO_DURATION = { min: 4, max: 60 };
const SEGMENT_SECONDS = 15;
export const MAX_SEGMENTS = 4;

// H3 每秒 24 帧，帧数只能是 17 的倍数加 5；相邻两段重叠 22 帧，一段最多 362 帧（15.08 秒）、最少 107 帧
export const VIDEO_FPS = 24;
const OVERLAP_FRAMES = 22;
const MAX_CHUNK = 362;
const MIN_CHUNK = 107;

// 一采大小（百万像素）和放大倍数能选的几档
export const VIDEO_MEGAPIXELS = [0.3, 0.4, 0.5, 0.6, 0.8, 1];
export const VIDEO_UPSCALES = [1.5, 2];
export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { megapixels: 0.4, upscale: 2, seed: null };

// 主模型：DaSiWa Hybrid Turbo V2，不加加速 LoRA
export const VIDEO_MODEL = 'minimax/DasiwaMinimaxH3_dasiwaHybridTurboV2_int8.safetensors';

export const videoSettingsOf = (saved: Partial<VideoSettings> | undefined): VideoSettings => ({ ...DEFAULT_VIDEO_SETTINGS, ...saved });

// 时长分几段：16 到 30 秒 2 段，31 到 45 秒 3 段，46 到 60 秒 4 段
export const segmentCount = (seconds: number) => Math.max(1, Math.ceil(seconds / SEGMENT_SECONDS));

// 框里单独一行只有 | 的地方切开，每段去掉首尾空行；空的段不算
export function splitSegments(text: string): string[] {
  const parts: string[][] = [[]];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '|') parts.push([]);
    else parts[parts.length - 1].push(line);
  }
  return parts.map((lines) => lines.join('\n').trim()).filter(Boolean);
}

const onGrid = (frames: number) => Math.round((frames - 5) / 17) * 17 + 5;

// 每段帧数 =（时长 × 24 + (段数 − 1) × 重叠）÷ 段数，取最近的 17 的倍数加 5，夹在 107 到 362 之间；整条 = 段数 × 每段 − (段数 − 1) × 重叠
export function videoFrames(seconds: number, segments: number): VideoJobParams['frames'] {
  const chunk = Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, onGrid((seconds * VIDEO_FPS + (segments - 1) * OVERLAP_FRAMES) / segments)));
  return { total: segments * chunk - (segments - 1) * OVERLAP_FRAMES, chunk, overlap: OVERLAP_FRAMES };
}

// 写进说明的每段大约几秒
export const segmentSeconds = (seconds: number) => Math.round(videoFrames(seconds, segmentCount(seconds)).chunk / VIDEO_FPS);

const RATIOS: Record<Exclude<AspectRatio, 'auto'>, [number, number]> = {
  '21:9': [21, 9],
  '16:9': [16, 9],
  '4:3': [4, 3],
  '1:1': [1, 1],
  '3:4': [3, 4],
  '9:16': [9, 16],
};

// 比例是「自动」的按 16:9
export const videoAspect = (ratio: AspectRatio): Exclude<AspectRatio, 'auto'> => (ratio === 'auto' ? '16:9' : ratio);

const round32 = (side: number) => Math.round(side / 32) * 32;

// 一采宽高照 ComfyUI 自带的 ResolutionSelector：按比例和百万像素算，各取最近的 32 的倍数；出片是一采乘放大倍数，也取 32 的倍数
export function videoSizes(megapixels: number, upscale: number, ratio: AspectRatio): Pick<VideoJobParams, 'width' | 'height' | 'finalWidth' | 'finalHeight'> {
  const [a, b] = RATIOS[videoAspect(ratio)];
  const pixels = megapixels * 1024 * 1024;
  const width = round32(Math.sqrt((pixels * a) / b));
  const height = round32(Math.sqrt((pixels * b) / a));
  return { width, height, finalWidth: round32(width * upscale), finalHeight: round32(height * upscale) };
}

// 拼参数：几段提示词、写这条回复时的时长和比例、节点的生成设置
export function videoParams(segments: string[], seconds: number, ratio: AspectRatio, settings: VideoSettings): VideoJobParams {
  return {
    segments,
    seconds,
    frames: videoFrames(seconds, segments.length),
    aspectRatio: videoAspect(ratio),
    megapixels: settings.megapixels,
    upscale: settings.upscale,
    ...videoSizes(settings.megapixels, settings.upscale, ratio),
    model: VIDEO_MODEL,
  };
}

// 流程里各个节点的编号；做到哪个节点就是在做哪一步
const NODE = {
  model: '1',
  attention: '2',
  lowVram: '3',
  feedForward: '4',
  clip: '5',
  videoVae: '6',
  audioVae: '7',
  prompts: '8',
  firstCond: '9',
  guider: '10',
  noise: '11',
  sampler: '12',
  sigmas1: '13',
  pass1: '14',
  separate: '15',
  upscale: '16',
  concat: '17',
  sigmas2: '18',
  pass2: '19',
  audio: '20',
  save: '21',
};

// ComfyUI 先跑编码提示词，再加载主模型、一采；一采完马上解码声音（不到 1 秒），再放大、二采、存文件。
// 只认这五个节点，别的节点跑的时候还算前一步
const STAGE_OF: Record<string, VideoStage> = {
  [NODE.prompts]: 'encode',
  [NODE.pass1]: 'pass1',
  [NODE.upscale]: 'upscale',
  [NODE.pass2]: 'pass2',
  [NODE.save]: 'save',
};

// 开始跑到哪个节点是到了哪一步；不是那五个的返回 null
export const videoStage = (node: string): VideoStage | null => STAGE_OF[node] ?? null;

// 一采、二采每段几步
export const PASS_STEPS = { pass1: 10, pass2: 3 };

// 照 docs/workflows/h3-long-video.json 的两遍生成拼 API 格式，见 docs/dev-plan.md 5.26。一采、二采用同一个种子
export function videoGraph(params: VideoJobParams, seed: number): ComfyGraph {
  const link = (node: string, slot = 0) => [node, slot];
  const looping = (sigmas: string, latent: unknown, title: string) => ({
    class_type: 'MMH3LoopingSampler',
    inputs: {
      noise: link(NODE.noise),
      guider: link(NODE.guider),
      sampler: link(NODE.sampler),
      sigmas: link(sigmas),
      cond_set: link(NODE.prompts),
      latent,
      chunk_frames: params.frames.chunk,
      overlap_frames: params.frames.overlap,
      carry: 'mask',
      overlap_strength_video: 1,
      overlap_strength_audio: 0.9,
      sampling_start_step: 0,
      sampling_end_step: 1000,
      phase2_start_step: 0,
      keyframe_indices: '0',
      vae: link(NODE.videoVae),
      denoise_mask_mode: 'max',
    },
    _meta: { title },
  });
  return {
    [NODE.model]: { class_type: 'UNETLoader', inputs: { unet_name: params.model, weight_dtype: 'default' }, _meta: { title: '主模型' } },
    [NODE.attention]: { class_type: 'ModelAttentionBackend', inputs: { model: link(NODE.model), attention: 'comfy kitchen attention' } },
    [NODE.lowVram]: { class_type: 'MiniMaxLowVRAMAttention', inputs: { model: link(NODE.attention), head_chunks: 8 } },
    [NODE.feedForward]: { class_type: 'MiniMaxChunkFeedForward', inputs: { model: link(NODE.lowVram), chunks: 8, seq_threshold: 4096 } },
    [NODE.clip]: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default' } },
    [NODE.videoVae]: { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' }, _meta: { title: '视频 VAE' } },
    [NODE.audioVae]: { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' }, _meta: { title: '音频 VAE' } },
    [NODE.prompts]: {
      class_type: 'MMH3ReferenceMultiPrompt',
      inputs: {
        clip: link(NODE.clip),
        vae: link(NODE.videoVae),
        audio_vae: link(NODE.audioVae),
        width: params.width,
        height: params.height,
        length: params.frames.total,
        ref_image_size: 'match',
        // 段与段用 | 隔开，段里本来有的 | 换掉，免得被当成分段
        prompts: params.segments.map((segment) => segment.replaceAll('|', '/')).join('\n|\n'),
        use_input_audio: false,
        unload_text_encoder: true,
        window_ref_video: false,
        chunk_frames: 0,
        overlap_frames: 0,
      },
      _meta: { title: '编码每段提示词' },
    },
    [NODE.firstCond]: { class_type: 'MMH3CondSelect', inputs: { cond_set: link(NODE.prompts), index: 0 } },
    [NODE.guider]: { class_type: 'BasicGuider', inputs: { model: link(NODE.feedForward), conditioning: link(NODE.firstCond) } },
    [NODE.noise]: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    [NODE.sampler]: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    [NODE.sigmas1]: { class_type: 'BasicScheduler', inputs: { model: link(NODE.feedForward), scheduler: 'beta', steps: PASS_STEPS.pass1, denoise: 1 } },
    [NODE.pass1]: looping(NODE.sigmas1, link(NODE.prompts, 1), '一采'),
    [NODE.separate]: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: link(NODE.pass1) } },
    [NODE.upscale]: {
      class_type: 'MinimaxH3LatentUpscaler3D',
      inputs: {
        latent: link(NODE.separate),
        model_name: 'minimax_h3_latent_upscaler_3d_bf16.safetensors',
        mode: 'target dimensions',
        'mode.width': params.finalWidth,
        'mode.height': params.finalHeight,
        align: 32,
        enable_temporal_chunking: true,
        force_unload: true,
        device: 'cuda',
        precision: 'bf16',
      },
      _meta: { title: '不解码放大' },
    },
    [NODE.concat]: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: link(NODE.upscale), audio_latent: link(NODE.separate, 1) } },
    [NODE.sigmas2]: { class_type: 'BasicScheduler', inputs: { model: link(NODE.feedForward), scheduler: 'beta', steps: PASS_STEPS.pass2, denoise: 0.2 } },
    [NODE.pass2]: looping(NODE.sigmas2, link(NODE.concat), '二采'),
    [NODE.audio]: { class_type: 'VAEDecodeAudio', inputs: { samples: link(NODE.pass1), vae: link(NODE.audioVae) }, _meta: { title: '声音用一采的' } },
    [NODE.save]: {
      class_type: 'MMH3StreamingSave',
      inputs: {
        latent: link(NODE.pass2),
        vae: link(NODE.videoVae),
        groups_per_chunk: 4,
        fps: VIDEO_FPS,
        filename_prefix: 'media-agent/video',
        crf: 19,
        audio: link(NODE.audio),
        video_encoder: 'auto',
        ffmpeg_path: '',
        save_metadata: true,
      },
      _meta: { title: '存成 mp4' },
    },
  };
}

// 还在排队或者正在跑
export const isLiveVideo = (job: VideoJob) => job.status === 'queued' || job.status === 'running';

const pad = (n: number) => String(n).padStart(2, '0');

// 出的视频先放工作文件夹 video-temp/YYYY-MM-DD/HHmmss-<种子>.mp4，按本机时间，见 docs/dev-plan.md 5.27
export const videoTempFileName = (date: Date, seed: number) => `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${seed}.mp4`;

// 下载的文件名：<节点标题>-<种子>.mp4，文件名里不能用的字符换成 _
export const videoDownloadName = (title: string, seed: number) => `${title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}-${seed}.mp4`;

// 整条多少秒，界面上写一位小数
export const videoSecondsText = (frames: number) => `${(frames / VIDEO_FPS).toFixed(1)} 秒`;
