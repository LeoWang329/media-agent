import type { AspectRatio, ComfyGraph, VideoJob, VideoJobParams, VideoLatents, VideoMedia, VideoSettings, VideoSpeed, VideoStage, VideoTiming } from './types';

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

// 默认的主模型：DaSiWa Hybrid Turbo V2，不加加速 LoRA。能选的是生成视频那台 minimax/ 下的
export const VIDEO_MODEL = 'minimax/DasiwaMinimaxH3_dasiwaHybridTurboV2_int8.safetensors';
export const isVideoModel = (name: string) => name.startsWith('minimax/');

// 加速、不加速：切的时候主模型跟着换，一采、二采每段几步照这个；都不开 CFG，采样器、调度器、放大一样，见 docs/dev-plan.md 5.27
export const VIDEO_SPEEDS: Record<VideoSpeed, { model: string; steps: { pass1: number; pass2: number } }> = {
  fast: { model: VIDEO_MODEL, steps: { pass1: 10, pass2: 3 } },
  full: { model: 'minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors', steps: { pass1: 20, pass2: 6 } },
};

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { megapixels: 0.4, upscale: 2, seed: null, model: VIDEO_MODEL, loras: [], speed: 'fast' };

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

// 槽位的图怎么用，跟着写这条回复的那套提示词，见 docs/dev-plan.md 5.26：参考模式的都当参考图（refs）；图当首帧的用第一张当开头（first）；
// 纯文字的不带图（none）；首尾帧、尾帧的还不支持。自己建的按名字开头认，比如「i2v-慢节奏」算图当首帧；认不出的按参考模式
export type VideoImageUse = 'refs' | 'first' | 'none' | 'unsupported';
const IMAGE_USE: [string, VideoImageUse][] = [
  ['t2v', 'none'],
  ['i2v', 'first'],
  ['fl2va', 'unsupported'],
  ['l2va', 'unsupported'],
];
export function videoImageUse(promptName: string | undefined): VideoImageUse {
  const name = promptName ?? '';
  return IMAGE_USE.find(([prefix]) => name === prefix || name.startsWith(`${prefix}-`))?.[1] ?? 'refs';
}

type Size = { width: number; height: number };

// 宽高按哪个比例算：图当首帧、比例自动的按那张图，别的按回复的比例（自动的按 16:9）
export function videoRatioOf(ratio: AspectRatio, use: VideoImageUse, firstImage: Size | null | undefined): AspectRatio | Size {
  return ratio === 'auto' && use === 'first' && firstImage ? firstImage : ratio;
}

const round32 = (side: number) => Math.round(side / 32) * 32;

// 一采宽高照 ComfyUI 自带的 ResolutionSelector：按比例和百万像素算，各取最近的 32 的倍数；出片是一采乘放大倍数，也取 32 的倍数
export function videoSizes(megapixels: number, upscale: number, ratio: AspectRatio | Size): Pick<VideoJobParams, 'width' | 'height' | 'finalWidth' | 'finalHeight'> {
  const [a, b] = typeof ratio === 'string' ? RATIOS[videoAspect(ratio)] : [ratio.width, ratio.height];
  const pixels = megapixels * 1024 * 1024;
  const width = round32(Math.sqrt((pixels * a) / b));
  const height = round32(Math.sqrt((pixels * b) / a));
  return { width, height, finalWidth: round32(width * upscale), finalHeight: round32(height * upscale) };
}

// 带的图：refs 是当参考图的槽位图 id；firstFrame 是钉在第 0 帧的那张，带上宽高，比例自动的按它算
export type VideoImages = { refs: string[]; firstFrame?: { id: string } & Size };

// 拼参数：几段提示词、写这条回复时的时长和比例、节点的生成设置、带的图、带的视频和音频（按接进流程的顺序）
export function videoParams(
  segments: string[],
  seconds: number,
  ratio: AspectRatio,
  settings: VideoSettings,
  images: VideoImages = { refs: [] },
  media: VideoMedia[] = [],
): VideoJobParams {
  const first = images.firstFrame;
  const sized = videoRatioOf(ratio, first ? 'first' : 'refs', first);
  return {
    segments,
    seconds,
    frames: videoFrames(seconds, segments.length),
    aspectRatio: typeof sized === 'string' ? videoAspect(sized) : 'image',
    ...(images.refs.length && { refs: images.refs }),
    ...(first && { firstFrame: first.id }),
    megapixels: settings.megapixels,
    upscale: settings.upscale,
    ...videoSizes(settings.megapixels, settings.upscale, sized),
    model: settings.model,
    ...(settings.loras.length && { loras: settings.loras }),
    steps: VIDEO_SPEEDS[settings.speed].steps,
    ...(media.length && { media }),
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

// 一采、二采每段几步：加速的；这一条记了的照它记的
export const PASS_STEPS = VIDEO_SPEEDS.fast.steps;
export const stepsOf = (params: Pick<VideoJobParams, 'steps'>) => params.steps ?? PASS_STEPS;

// 带的图传给 ComfyUI 以后的名字（LoadImage 填的），顺序和 params.refs 一样；firstFrame 是首帧那张的；media 是视频和音频的，顺序和 params.media 一样
export type VideoFiles = { refs: string[]; firstFrame?: string; media?: string[] };

// 参考图的 LoadImage 从 30 号起，接成一串的 ImageTensorList 从 40 号起；首帧图不在参考图里时单独一个 39 号
const REF_LOAD = 30;
const REF_LIST = 40;
const FIRST_LOAD = '39';
// 挂的 LoRA 从 70 号起，照 U37「8 步加速」那个的位置接在主模型和注意力节点之间
const LORA_FIRST = 70;
// 视频和音频从 200 号起（重拍加的节点从 80 号起，最多到一百零几）
const MEDIA_FIRST = 200;
// 带的视频和音频怎么接，见 docs/dev-plan.md 5.31：用画面的视频用 VHS_LoadVideo 按每秒 24 帧读、跳过开头、读够秒数，
// 接 ref_videos，画面和声音都用的它的声音接 ref_video_audios；只用声音的视频和声音参考用 LoadAudio 加 TrimAudioDuration 接 ref_audios；
// 配音接 audio，打开 use_input_audio。返回新加的节点和要填进编码提示词那个节点的输入
function mediaNodes(params: VideoJobParams, files: VideoFiles): { nodes: ComfyGraph; inputs: Record<string, unknown> } {
  const link = (node: string, slot = 0) => [node, slot];
  const nodes: ComfyGraph = {};
  const inputs: Record<string, unknown> = {};
  let next = MEDIA_FIRST;
  let videos = 0;
  let audios = 0;
  for (const [i, item] of (params.media ?? []).entries()) {
    const name = files.media?.[i] ?? item.mediaId;
    if (item.kind === 'video' && item.use !== 'sound') {
      const id = String(next++);
      // 比一采的画面大的，读的时候缩到和画面一样大（和参考图的 match 一样）。H3 节点只会把参考视频放到短边 768，
      // 不缩到画面大小，按 768 读进去每一步要慢好几倍
      const w = item.width ?? 0;
      const h = item.height ?? 0;
      const scale = w * h > params.width * params.height ? Math.sqrt((params.width * params.height) / (w * h)) : 0;
      const side = (length: number) => Math.round((length * scale) / 8) * 8;
      nodes[id] = {
        class_type: 'VHS_LoadVideo',
        inputs: {
          video: name,
          force_rate: VIDEO_FPS,
          custom_width: scale && w < h ? side(w) : 0,
          custom_height: scale && w >= h ? side(h) : 0,
          frame_load_cap: Math.round(item.take * VIDEO_FPS),
          skip_first_frames: Math.round(item.start * VIDEO_FPS),
          select_every_nth: 1,
          format: 'None',
        },
        _meta: { title: `参考视频 ${videos + 1}` },
      };
      inputs[`ref_videos.ref_video_${videos}`] = link(id);
      if (item.use === 'both') inputs[`ref_video_audios.ref_video_audio_${videos}`] = link(id, 2);
      videos += 1;
      continue;
    }
    const dub = item.use === 'dub';
    const load = String(next++);
    const trim = String(next++);
    nodes[load] = { class_type: 'LoadAudio', inputs: { audio: name }, _meta: { title: dub ? '配音' : `参考音频 ${audios + 1}` } };
    // 配音取到视频结束，多留一秒，节点自己再按视频的长度截
    const seconds = Math.ceil(params.frames.total / VIDEO_FPS) + 1;
    const take = dub ? Math.min(item.take, seconds) : item.take;
    nodes[trim] = { class_type: 'TrimAudioDuration', inputs: { audio: link(load), start_index: item.start, duration: take } };
    if (dub) {
      // 配音比视频短的，后面接一段静音：节点自己补的是全 0 的潜变量，解出来是一段底噪，不是没声音。
      // 静音的采样率比配音的低，接的时候只把静音那段重采样
      let audio = trim;
      if (take < seconds) {
        const empty = String(next++);
        audio = String(next++);
        nodes[empty] = { class_type: 'EmptyAudio', inputs: { duration: Math.round((seconds - take) * 100) / 100, sample_rate: 8000, channels: 2 }, _meta: { title: '配音后面的静音' } };
        nodes[audio] = { class_type: 'AudioConcat', inputs: { audio1: link(trim), audio2: link(empty), direction: 'after' } };
      }
      inputs.audio = link(audio);
      inputs.use_input_audio = true;
    } else {
      inputs[`ref_audios.ref_audio_${audios}`] = link(trim);
      audios += 1;
    }
  }
  return { nodes, inputs };
}

// 一采、二采的结果存在生成视频那台的 output/MiniMaxH3/latent_checkpoints/ 下，文件名 media_agent_<jobId>_pass1_<哈希>.h3latent.safetensors。
// 存档节点的第 3 个输出是存下的文件名，接一个 PreviewAny 才会写进 /history，见 docs/dev-plan.md 5.30
export const LATENT_DIR = '/root/ComfyUI/output/MiniMaxH3/latent_checkpoints';
// 有配音的，存之前先接一个 RemoveNoiseMask（64、65 号），见 videoGraph
export const LATENT_SAVE = { pass1: '60', pass2: '61', pass1Path: '62', pass2Path: '63', pass1Bare: '64', pass2Bare: '65' };

// 照 docs/workflows/h3-long-video.json 的两遍生成拼 API 格式，见 docs/dev-plan.md 5.26。一采、二采用同一个种子。
// 参考图接进编码提示词的 ref_images，每段都带：一张直接接，几张用 KJNodes 的 ImageTensorList 一张张接成一串，各自保持原来的比例；
// 首帧图照 U37 接在一采的 keyframes，钉在第 0 帧。jobId 给了的，一采、二采的结果按它的名字存下来
export function videoGraph(params: VideoJobParams, seed: number, files: VideoFiles = { refs: [] }, jobId?: string): ComfyGraph {
  const link = (node: string, slot = 0) => [node, slot];
  const images: ComfyGraph = {};
  const loads = files.refs.map((name, i) => {
    const id = String(REF_LOAD + i);
    images[id] = { class_type: 'LoadImage', inputs: { image: name }, _meta: { title: `参考图 ${i + 1}` } };
    return id;
  });
  let refs = loads[0];
  for (const [i, id] of loads.slice(1).entries()) {
    const list = String(REF_LIST + i);
    images[list] = { class_type: 'ImageTensorList', inputs: { image1: link(refs), image2: link(id) } };
    refs = list;
  }
  let first: string | undefined;
  if (files.firstFrame) {
    const index = files.refs.indexOf(files.firstFrame);
    first = index >= 0 ? loads[index] : FIRST_LOAD;
    if (index < 0) images[FIRST_LOAD] = { class_type: 'LoadImage', inputs: { image: files.firstFrame }, _meta: { title: '首帧图' } };
  }
  const looping = (sigmas: string, latent: unknown, title: string, keyframes?: string) => ({
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
      ...(keyframes && { keyframes: link(keyframes) }),
      vae: link(NODE.videoVae),
      denoise_mask_mode: 'max',
    },
    _meta: { title },
  });
  const media = mediaNodes(params, files);
  Object.assign(images, media.nodes);
  let model = NODE.model;
  for (const [i, lora] of (params.loras ?? []).entries()) {
    const id = String(LORA_FIRST + i);
    images[id] = { class_type: 'LoraLoaderModelOnly', inputs: { model: link(model), lora_name: lora.name, strength_model: lora.strength }, _meta: { title: `LoRA ${i + 1}` } };
    model = id;
  }
  const graph: ComfyGraph = {
    ...images,
    [NODE.model]: { class_type: 'UNETLoader', inputs: { unet_name: params.model, weight_dtype: 'default' }, _meta: { title: '主模型' } },
    [NODE.attention]: { class_type: 'ModelAttentionBackend', inputs: { model: link(model), attention: 'comfy kitchen attention' } },
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
        ...(refs && { ref_images: link(refs) }),
        use_input_audio: false,
        unload_text_encoder: true,
        window_ref_video: false,
        chunk_frames: 0,
        overlap_frames: 0,
        ...media.inputs,
      },
      _meta: { title: '编码每段提示词' },
    },
    [NODE.firstCond]: { class_type: 'MMH3CondSelect', inputs: { cond_set: link(NODE.prompts), index: 0 } },
    [NODE.guider]: { class_type: 'BasicGuider', inputs: { model: link(NODE.feedForward), conditioning: link(NODE.firstCond) } },
    [NODE.noise]: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    [NODE.sampler]: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    [NODE.sigmas1]: { class_type: 'BasicScheduler', inputs: { model: link(NODE.feedForward), scheduler: 'beta', steps: stepsOf(params).pass1, denoise: 1 } },
    [NODE.pass1]: looping(NODE.sigmas1, link(NODE.prompts, 1), '一采', first),
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
    [NODE.sigmas2]: { class_type: 'BasicScheduler', inputs: { model: link(NODE.feedForward), scheduler: 'beta', steps: stepsOf(params).pass2, denoise: 0.2 } },
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
  if (jobId) {
    const store = (latent: string, pass: 'pass1' | 'pass2') => ({
      class_type: 'MiniMaxH3NativeLatentCheckpointSaveT8Advanced',
      inputs: { av_latent: link(latent), filename_prefix: `media_agent_${jobId}_${pass}`, checkpoint_id: pass, confirm_save: true, verify_after_write: true, hash_chunk_megabytes: 8 },
      _meta: { title: pass === 'pass1' ? '存一采的结果' : '存二采的结果' },
    });
    // 有配音的，H3 节点给潜变量挂了「声音钉住」的遮罩，是单通道的，采样器出来原样带着；T8 存档要遮罩和数据一样形状，
    // 所以存之前去掉，二采照样拿带遮罩的。重拍时存档里读回来的不带遮罩，声音另用 audio_denoise_mask 钉住
    const bare = (latent: string, id: string) => {
      graph[id] = { class_type: 'RemoveNoiseMask', inputs: { samples: link(latent) }, _meta: { title: '存之前去掉遮罩' } };
      return id;
    };
    const dub = graph[NODE.prompts].inputs.use_input_audio === true;
    graph[LATENT_SAVE.pass1] = store(dub ? bare(NODE.pass1, LATENT_SAVE.pass1Bare) : NODE.pass1, 'pass1');
    graph[LATENT_SAVE.pass2] = store(dub ? bare(NODE.pass2, LATENT_SAVE.pass2Bare) : NODE.pass2, 'pass2');
    graph[LATENT_SAVE.pass1Path] = { class_type: 'PreviewAny', inputs: { source: link(LATENT_SAVE.pass1, 2) } };
    graph[LATENT_SAVE.pass2Path] = { class_type: 'PreviewAny', inputs: { source: link(LATENT_SAVE.pass2, 2) } };
  }
  return graph;
}

// ─── 重拍一截，见 docs/dev-plan.md 5.30 ───

// 潜空间第 l 帧从第几帧开始：每 5 个潜空间帧管 17 帧，按 1、4、4、4、4 分
export const latentFrame = (l: number) => 17 * Math.floor(l / 5) + [0, 1, 5, 9, 13][l % 5];

// 这么多帧有几个潜空间帧
export function latentCount(frames: number): number {
  let l = 0;
  while (latentFrame(l) < frames) l += 1;
  return l;
}

// 离这一帧最近的潜空间帧的开头
export function nearestLatent(frame: number): number {
  let l = 0;
  while (latentFrame(l + 1) <= frame) l += 1;
  return frame - latentFrame(l) <= latentFrame(l + 1) - frame ? l : l + 1;
}

// 重拍哪一截、要切出哪几窗来算。帧数都是整条里的；from、to 对齐到潜空间帧，to 不含。
// 每窗自己出的是从这一窗开头（第 1 窗以后去掉开头接着上一窗的重叠）到下一窗开头再加上重叠；这一截碰到哪几窗就切出哪几窗，从窗口开头切
export type ReshootPlan = {
  from: number;
  to: number;
  fromLatent: number;
  toLatent: number;
  firstWindow: number;
  lastWindow: number;
  startLatent: number;
  endLatent: number;
  startFrame: number;
  frames: number;
  totalLatents: number;
  overlapLatents: number;
  strideLatents: number;
};

export function reshootPlan(params: VideoJobParams, fromFrame: number, toFrame: number): ReshootPlan {
  const { chunk, overlap, total } = params.frames;
  const windows = params.segments.length;
  const windowLatents = latentCount(chunk);
  const overlapLatents = latentCount(overlap);
  const strideLatents = windowLatents - overlapLatents;
  const totalLatents = latentCount(total);
  const fromLatent = Math.min(Math.max(0, nearestLatent(Math.max(0, fromFrame))), totalLatents);
  const toLatent = Math.min(Math.max(0, nearestLatent(Math.max(0, toFrame))), totalLatents);
  const windowOf = (l: number) => (l < windowLatents ? 0 : Math.min(windows - 1, Math.floor((l - overlapLatents) / strideLatents)));
  const firstWindow = windowOf(fromLatent);
  const lastWindow = windowOf(Math.max(fromLatent, toLatent - 1));
  const startLatent = firstWindow * strideLatents;
  return {
    from: latentFrame(fromLatent),
    to: latentFrame(toLatent),
    fromLatent,
    toLatent,
    firstWindow,
    lastWindow,
    startLatent,
    endLatent: lastWindow * strideLatents + windowLatents,
    startFrame: latentFrame(startLatent),
    frames: (lastWindow - firstWindow) * (chunk - overlap) + chunk,
    totalLatents,
    overlapLatents,
    strideLatents,
  };
}

// 时间条上各段的分界：第 2 段起每段从哪一帧开始，和上面分窗的算法一样
export function videoWindowStarts(params: VideoJobParams): number[] {
  const overlapLatents = latentCount(params.frames.overlap);
  const strideLatents = latentCount(params.frames.chunk) - overlapLatents;
  return params.segments.slice(1).map((_, i) => latentFrame((i + 1) * strideLatents + overlapLatents));
}

// 界面上的说法：「重拍 8.0 到 11.0 秒」「在第 1 段」「跨第 1、2 段」
export const reshootText = (from: number, to: number) => `重拍 ${(from / VIDEO_FPS).toFixed(1)} 到 ${(to / VIDEO_FPS).toFixed(1)} 秒`;
export function reshootWhere(plan: Pick<ReshootPlan, 'firstWindow' | 'lastWindow'>): string {
  const [a, b] = [plan.firstWindow + 1, plan.lastWindow + 1];
  if (a === b) return `在第 ${a} 段`;
  return b === a + 1 ? `跨第 ${a}、${b} 段` : `跨第 ${a} 到 ${b} 段`;
}

// 遮罩、读回的存档、切开拼回去用的节点，从 80 号起
const RESHOOT_FIRST_ID = 80;

// 重拍一截的流程，见 docs/dev-plan.md 5.30。params 是新这一版的（整条的几段提示词，改过的段已经换上），base 是在哪一版上重拍的存档：
// 读回那一版的一采、二采存档，只把这几窗切出来算；遮罩这一截白（重画）、别的黑（保留），画面和声音同一个，两遍的 overlap_strength_audio 都是 1；
// 二采的输入是那一版二采切出来的同几窗，只把重画的潜空间帧换成新一采放大后的；算完前后没动的部分从存档接上，去掉重叠；新的整条一采、二采也存下来
export function reshootGraph(params: VideoJobParams, seed: number, files: VideoFiles, jobId: string, plan: ReshootPlan, base: Pick<VideoLatents, 'pass1' | 'pass2'>): ComfyGraph {
  const link = (node: string, slot = 0) => [node, slot];
  const part: VideoJobParams = {
    ...params,
    segments: params.segments.slice(plan.firstWindow, plan.lastWindow + 1),
    frames: { ...params.frames, total: plan.frames },
  };
  // 首帧图钉的是整条的第 0 帧，切出来的不是从第 1 窗开始的不能接
  const graph = videoGraph(part, seed, plan.firstWindow === 0 ? files : { refs: files.refs }, jobId);
  let next = RESHOOT_FIRST_ID;
  const add = (node: ComfyGraph[string]) => {
    const id = String(next++);
    graph[id] = node;
    return id;
  };
  const load = (path: string, title: string) =>
    add({ class_type: 'MiniMaxH3NativeLatentCheckpointLoadT8Advanced', inputs: { checkpoint_path: path, expected_manifest_json: '', expected_file_sha256: '', hash_chunk_megabytes: 8 }, _meta: { title } });
  const trim = (latent: string, head: number, tail: number) =>
    add({ class_type: 'MMH3TrimAV', inputs: { latent: link(latent), trim_head_latents: head, trim_tail_latents: tail, carry_masks: true } });
  const concat = (a: string, b: string) => add({ class_type: 'MMH3ConcatAV', inputs: { latent_a: link(a), latent_b: link(b), trim_b_latents: plan.overlapLatents, carry_masks: false } });

  const base1 = load(base.pass1, '读回一采的存档');
  const base2 = load(base.pass2, '读回二采的存档');
  const tail = plan.totalLatents - plan.endLatent;
  const part1 = trim(base1, plan.startLatent, tail);
  const part2 = trim(base2, plan.startLatent, tail);

  // 遮罩：每帧一张，只看时间，所以图很小；长度是 0 的那块不要
  const runs = [
    [0, plan.from - plan.startFrame],
    [1, plan.to - plan.from],
    [0, plan.startFrame + plan.frames - plan.to],
  ].filter(([, amount]) => amount > 0);
  const pieces = runs.map(([value, amount]) => {
    const solid = add({ class_type: 'SolidMask', inputs: { value, width: 128, height: 128 } });
    const image = add({ class_type: 'MaskToImage', inputs: { mask: link(solid) } });
    return add({ class_type: 'RepeatImageBatch', inputs: { image: link(image), amount } });
  });
  const strip = pieces.slice(1).reduce((joined, piece) => add({ class_type: 'ImageBatch', inputs: { image1: link(joined), image2: link(piece) } }), pieces[0]);
  const mask = add({ class_type: 'ImageToMask', inputs: { image: link(strip), channel: 'red' }, _meta: { title: '重画哪几帧' } });

  // 有配音的，声音整条钉住不重画：配音从存档里来，编码提示词那里不用再写进去
  const dub = graph[NODE.prompts].inputs.audio;
  let audioMask = mask;
  if (Array.isArray(dub)) {
    // 读配音、截、接静音这一串只给编码提示词用，整串删掉
    const drop = (id: string) => {
      const node = graph[id];
      delete graph[id];
      for (const value of Object.values(node.inputs)) if (Array.isArray(value)) drop(String(value[0]));
    };
    drop(String(dub[0]));
    delete graph[NODE.prompts].inputs.audio;
    graph[NODE.prompts].inputs.use_input_audio = false;
    delete graph[LATENT_SAVE.pass1Bare];
    delete graph[LATENT_SAVE.pass2Bare];
    const solid = add({ class_type: 'SolidMask', inputs: { value: 0, width: 128, height: 128 } });
    const image = add({ class_type: 'MaskToImage', inputs: { mask: link(solid) } });
    const strip = add({ class_type: 'RepeatImageBatch', inputs: { image: link(image), amount: plan.frames } });
    audioMask = add({ class_type: 'ImageToMask', inputs: { image: link(strip), channel: 'red' }, _meta: { title: '声音不重画' } });
  }
  const masked = { overlap_strength_audio: 1, denoise_mask: link(mask), audio_denoise_mask: link(audioMask) };
  Object.assign(graph[NODE.pass1].inputs, { latent: link(part1), ...masked });
  Object.assign(graph[NODE.pass2].inputs, masked);
  const at = plan.fromLatent - plan.startLatent;
  const redrawn = add({ class_type: 'LatentCut', inputs: { samples: link(NODE.upscale), dim: 't', index: at, amount: plan.toLatent - plan.fromLatent } });
  const old2 = add({ class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: link(part2) } });
  const replaced = add({ class_type: 'ReplaceVideoLatentFrames', inputs: { destination: link(old2), source: link(redrawn), index: at } });
  graph[NODE.concat].inputs.video_latent = link(replaced);

  // 拼回整条：前面从存档接上到这几窗开头的重叠为止，后面从下一窗开头接上，都去掉重叠
  const whole = (base: string, made: string) => {
    let joined = made;
    if (plan.firstWindow > 0) joined = concat(trim(base, 0, plan.totalLatents - plan.startLatent - plan.overlapLatents), joined);
    if (plan.endLatent < plan.totalLatents) joined = concat(joined, trim(base, plan.endLatent - plan.overlapLatents, 0));
    return joined;
  };
  const whole1 = whole(base1, NODE.pass1);
  const whole2 = whole(base2, NODE.pass2);
  graph[NODE.audio].inputs.samples = link(whole1);
  graph[NODE.save].inputs.latent = link(whole2);
  graph[LATENT_SAVE.pass1].inputs.av_latent = link(whole1);
  graph[LATENT_SAVE.pass2].inputs.av_latent = link(whole2);
  return graph;
}

// 还在排队或者正在跑
export const isLiveVideo = (job: VideoJob) => job.status === 'queued' || job.status === 'running';

// 记录只留同样出片大小、同样段数的最近 5 条，见 docs/dev-plan.md 5.29
export const TIMINGS_KEPT = 5;
const sameKind = (a: Pick<VideoTiming, 'finalWidth' | 'finalHeight' | 'segments'>, b: Pick<VideoTiming, 'finalWidth' | 'finalHeight' | 'segments'>) =>
  a.finalWidth === b.finalWidth && a.finalHeight === b.finalHeight && a.segments === b.segments;

// 新记一条：同样大小、同样段数的超过 5 条，丢掉最早的
export function addTiming(timings: VideoTiming[], timing: VideoTiming): VideoTiming[] {
  const all = [...timings, timing];
  const same = all.filter((t) => sameKind(t, timing));
  const drop = new Set(same.slice(0, Math.max(0, same.length - TIMINGS_KEPT)));
  return all.filter((t) => !drop.has(t));
}

export type VideoProgressNow = { stage: VideoStage; chunk: number; chunks: number; step: number; steps: number; since: number };

const STAGE_ORDER: VideoStage[] = ['encode', 'pass1', 'upscale', 'pass2', 'save'];

// 一条还要多久，见 docs/dev-plan.md 5.29：用最近一条同样出片大小、同样段数的记录；还没到的步照那条的用时，
// 正在做的一采、二采按剩下的步数乘那条每步的用时，正在做的别的步按那条的用时减去已经做了多久。没有能比的是 null；progress 是 null 的是还没开始跑
export function videoRemainingMs(params: VideoJobParams, progress: VideoProgressNow | null, timings: VideoTiming[], now: number): number | null {
  const kind = { finalWidth: params.finalWidth, finalHeight: params.finalHeight, segments: params.segments.length };
  const record = timings.filter((t) => sameKind(t, kind)).at(-1);
  if (!record) return null;
  const chunks = progress?.chunks || params.segments.length;
  // 每步多久加速、不加速一样，按这一条的步数算
  const steps = stepsOf(params);
  const stepMs = { pass1: record.pass1StepMs, pass2: record.pass2StepMs };
  const whole: Record<VideoStage, number> = {
    encode: record.encodeMs,
    pass1: stepMs.pass1 * steps.pass1 * chunks,
    upscale: record.upscaleMs,
    pass2: stepMs.pass2 * steps.pass2 * chunks,
    save: record.saveMs,
  };
  const at = progress ? STAGE_ORDER.indexOf(progress.stage) : 0;
  const later = STAGE_ORDER.slice(at + (progress ? 1 : 0)).reduce((sum, stage) => sum + whole[stage], 0);
  if (!progress) return later;
  const { stage } = progress;
  if (stage === 'pass1' || stage === 'pass2') {
    const perChunk = progress.steps || steps[stage];
    const done = progress.chunk ? (progress.chunk - 1) * perChunk + progress.step : 0;
    return later + Math.max(0, perChunk * progress.chunks - done) * stepMs[stage];
  }
  return later + Math.max(0, whole[stage] - (now - progress.since));
}

const pad = (n: number) => String(n).padStart(2, '0');

// 出的视频先放工作文件夹 video-temp/YYYY-MM-DD/HHmmss-<种子>.mp4，按本机时间，见 docs/dev-plan.md 5.27
export const videoTempFileName = (date: Date, seed: number) => `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${seed}.mp4`;

// 下载的文件名：<节点标题>-<种子>.mp4，文件名里不能用的字符换成 _
export const videoDownloadName = (title: string, seed: number) => `${title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}-${seed}.mp4`;

// 整条多少秒，界面上写一位小数
export const videoSecondsText = (frames: number) => `${(frames / VIDEO_FPS).toFixed(1)} 秒`;
