import type { AspectRatio, ComfyGraph, VideoJob, VideoJobParams, VideoLatents, VideoLora, VideoMedia, VideoSelfLift, VideoSettings, VideoSpeed, VideoStage, VideoSteps, VideoTiming, VideoWorkflow } from './types';

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

// 加速、不加速：切的时候主模型和一采、二采每段几步一起换，换完两样都能在下面自己改；都不开 CFG，采样器、调度器、放大一样，见 docs/dev-plan.md 5.27
export const VIDEO_SPEEDS: Record<VideoSpeed, { model: string; steps: VideoSteps }> = {
  fast: { model: VIDEO_MODEL, steps: { pass1: 10, pass2: 3 } },
  full: { model: 'minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors', steps: { pass1: 20, pass2: 6 } },
};

// 这个节点现在用的一采、二采每段几步：自己改过就照改的，没改过照加速还是不加速那个预设
export const stepsOfSettings = (settings: VideoSettings): VideoSteps => settings.steps ?? VIDEO_SPEEDS[settings.speed].steps;

// 自己填一采、二采步数时的范围，见 docs/dev-plan.md 5.27
export const VIDEO_STEPS = { pass1: { min: 1, max: 50 }, pass2: { min: 1, max: 20 } } as const;

// 二采重画多少（denoise）：两遍生成里放大完那一遍只按 0.2 重画，留着原来的构图。这个数放开能自己改
export const VIDEO_DENOISE = { min: 0.05, max: 1, step: 0.05, default: 0.2 } as const;
export const denoiseOfSettings = (settings: VideoSettings) => settings.denoise ?? VIDEO_DENOISE.default;

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { megapixels: 0.4, upscale: 2, seed: null, model: VIDEO_MODEL, loras: [], speed: 'fast' };

// ─── 内置流程：两遍生成（默认）和 SelfLift 接续，见 docs/dev-plan.md 5.32 ───

export const VIDEO_WORKFLOWS: VideoWorkflow[] = ['two-pass', 'selflift'];

// SelfLift 接续（comfyui-SelfLift 的 SelfLiftH3Sampler + H3 的 AddGuide）：照实例上那份
// 「U37-真-上下文无缝无色差长视频-SelfLift双采-惊尘573」——
// 整条分成好几段，一段一个任务：一套调度里前 transitionStep 步在低分辨率跑，抬到全分辨率再跑完剩下的步；
// 第 2 段起把上一段结尾的几帧（和那几帧的声音）当上下文钉进提示词，模型接着往下长，出片时把这几个上下文帧剪掉；
// 出完一段把整段的颜色对齐到上一段的最后一帧（无色差），最后几段拼成一条。
// 默认值照 U37 开着上下文那档：8 步里前 4 步低分辨率、低分辨率缩到 0.65、lms 那个放大器、带 22 帧上下文、接缝加 0.1 的噪、偏色对齐 0.75。
// 双 LoRA 双采默认不另挂（这套里主模型本身多是加速模型），照 U37 填的两个值见 SELFLIFT_PRESET
export const VIDEO_SELFLIFT = {
  steps: { min: 2, max: 20 },
  transitionStep: { min: 1, max: 18 },
  lowresScale: { min: 0.25, max: 1, step: 0.05 },
  // 接上一段带几帧：U37 里那三个「上下文帧数 1/2/5」＝ 22、39、90 帧（17 的倍数加 5）
  contextFrames: [22, 39, 90],
  noise: { min: 0, max: 0.5, step: 0.05 },
  colorMatch: { min: 0, max: 1, step: 0.05 },
  // 接缝声音羽化几个刻度（MiniMaxH3AudioGuideFeather 的 audio_feather_ticks）：0 是不羽化。
  // 那个节点的 spec 是 INT 0 到 256（默认 8），运行期还会夹到这一段音频的 token 数
  audioFeather: { min: 0, max: 256, step: 1 },
  // 双 LoRA 双采：两遍各挂一套 LoRA 的强度范围
  loraStrength: { min: -2, max: 2, step: 0.05 },
  // 「不用放大器」：走插件的 SelfLift-zero，rho 0.6、修正强度 1（插件 README 给的 H3 起点）
  none: 'none',
  upscaler: 'h3_upscaler_lms_v0.1_fp32.safetensors',
  zero: { rho: 0.6, wMin: 1, wMax: 1 },
  // 用外部放大器：纯潜空间提升，不做 VAE 往返，rho 0（照那份工作流）
  external: { rho: 0, wMin: 0.5, wMax: 1 },
} as const;

// U37 那份工作流的双 LoRA：低分辨率那遍挂 8 步加速 LoRA（0.75），高分辨率那遍挂 4 步加速 LoRA（0.7）。
// 界面上「照 U37 填」用它一键把两边填上；这两个文件在那台 minimax/ 下有
export const SELFLIFT_U37_LORAS: { lowres: VideoLora; hires: VideoLora } = {
  lowres: { name: 'minimax/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors', strength: 0.75 },
  hires: { name: 'minimax/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors', strength: 0.7 },
};

export const DEFAULT_SELFLIFT: VideoSelfLift = {
  steps: 8,
  transitionStep: 4,
  lowresScale: 0.65,
  upscaler: VIDEO_SELFLIFT.upscaler,
  contextFrames: VIDEO_SELFLIFT.contextFrames[0],
  noise: 0.1,
  colorMatch: 0.75,
  lowresLora: null,
  hiresLora: null,
  // 照 U37：接缝那几帧的声音羽化 12 个刻度
  audioFeather: 12,
  // 空着就是重新生成；选了就从那段前一段视频接着往下出，见 docs/dev-plan.md 5.35
  lead: null,
};

export const workflowOfSettings = (settings: VideoSettings): VideoWorkflow => settings.workflow ?? 'two-pass';
export const selfliftOfSettings = (settings: VideoSettings): VideoSelfLift => ({ ...DEFAULT_SELFLIFT, ...settings.selflift });

export const workflowOf = (params: Pick<VideoJobParams, 'workflow'>): VideoWorkflow => params.workflow ?? 'two-pass';
export const denoiseOf = (params: Pick<VideoJobParams, 'denoise'>) => params.denoise ?? VIDEO_DENOISE.default;
export const selfliftOf = (params: Pick<VideoJobParams, 'selflift'>): VideoSelfLift => ({ ...DEFAULT_SELFLIFT, ...params.selflift });


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
// 往上取到 17 的倍数加 5（U37 那份工作流就是这么算每段帧数的：不够就多给几帧，不往下砍）
const gridUp = (frames: number) => Math.max(5, Math.ceil((frames - 5) / 17) * 17 + 5);
// SelfLift 接续那套一段最少 22 帧（0.9 秒）
export const MIN_CLIP = 22;

// 每段帧数 =（时长 × 24 + (段数 − 1) × 重叠）÷ 段数，取最近的 17 的倍数加 5，夹在 107 到 362 之间；整条 = 段数 × 每段 − (段数 − 1) × 重叠
export function videoFrames(seconds: number, segments: number): VideoJobParams['frames'] {
  const chunk = Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, onGrid((seconds * VIDEO_FPS + (segments - 1) * OVERLAP_FRAMES) / segments)));
  return { total: segments * chunk - (segments - 1) * OVERLAP_FRAMES, chunk, overlap: OVERLAP_FRAMES };
}

// SelfLift 接续那套怎么分段，见 docs/dev-plan.md 5.32：一段一条片子，一段最长也是 362 帧（15 秒）、最短 22 帧。
// 第 2 段起开头带 context 帧上一段的尾巴、出片时剪掉，所以一段真正新出的画面是「每段帧数 − context 帧」。
// 历史任务用均分计划；新任务前段跑满，最后一段补余量并把计划存进 params.clipPlan。
export type SelfLiftPlan = {
  context: number; // 每段开头带几帧上一段的尾巴
  lengths: number[]; // 每段多少帧
  from: number[]; // 每段用框里第几段提示词（从 0 数）
  total: number; // 拼起来整条多少帧
};

function legacySelfliftPlan(seconds: number, segments: number, context: number): SelfLiftPlan {
  const target = Math.round(seconds * VIDEO_FPS);
  const most = MAX_CHUNK - context;
  const count = Math.max(segments, Math.ceil(Math.max(0, target - context) / most));
  const each = Math.min(MAX_CHUNK, Math.max(MIN_CLIP, gridUp((target + (count - 1) * context) / count)));
  return {
    context,
    lengths: Array.from({ length: count }, () => each),
    from: Array.from({ length: count }, (_, i) => Math.min(segments - 1, Math.floor((i * segments) / count))),
    total: count * each - (count - 1) * context,
  };
}

// 前段尽量用满 362 帧，尾段补余量；后续每段的上下文不计入新出的时长。
export function selfliftPlan(seconds: number, segments: number, context: number, lead = false): SelfLiftPlan {
  const target = Math.round(seconds * VIDEO_FPS);
  const count = Math.max(segments, Math.ceil(Math.max(0, target - (lead ? 0 : context)) / (MAX_CHUNK - context)));
  const lengths: number[] = [];
  let remaining = target;
  for (let i = 0; i < count; i += 1) {
    const overlap = i || lead ? context : 0;
    // 给后面每段留至少一个 17 帧的新画面，不能生成全是上下文的空段。
    const available = Math.min(MAX_CHUNK, remaining - (count - i - 1) * 17 + overlap);
    const length = i === count - 1 ? gridUp(available) : Math.floor((available - 5) / 17) * 17 + 5;
    lengths.push(Math.min(MAX_CHUNK, Math.max(overlap + 17, MIN_CLIP, length)));
    remaining -= lengths[i] - overlap;
  }
  return { context, lengths, from: lengths.map((_, i) => Math.min(segments - 1, i)), total: lengths.reduce((n, length, i) => n + length - (i || lead ? context : 0), 0) };
}

// 这条会分几段接力（界面上写「分 N 段跑」用）
export function selfliftClips(params: Pick<VideoJobParams, 'seconds' | 'segments' | 'selflift' | 'clipPlan'>): SelfLiftPlan {
  const context = selfliftOf(params).contextFrames;
  if (!params.clipPlan) return legacySelfliftPlan(params.seconds, params.segments.length, context);
  const { lengths, from } = params.clipPlan;
  const lead = Boolean(params.selflift?.lead);
  return { context, lengths, from, total: lengths.reduce((n, length, i) => n + length - (i || lead ? context : 0), 0) };
}

// 写提示词时也照同一份分段，覆盖两遍生成的均分时长说明。
export function selfliftPromptNote(seconds: number, settings: VideoSettings): string {
  const sl = selfliftOfSettings(settings);
  const segments = segmentCount(seconds);
  const lead = Boolean(sl.lead);
  const plan = selfliftPlan(seconds, segments, sl.contextFrames, lead);
  const durations = Array(segments).fill(0) as number[];
  plan.lengths.forEach((length, i) => { durations[plan.from[i]] += (length - (i || lead ? plan.context : 0)) / VIDEO_FPS; });
  return `当前使用 SelfLift 接续，以下时长替代历史消息里的均分说明：视频${lead ? '新生成部分' : ''}时长 ${seconds} 秒，写 ${segments} 段提示词，各段约 ${durations.map(n => n.toFixed(1)).join(' / ')} 秒。前段尽量跑满 15 秒，尾段补余量；多出的接续片段重复最后一段提示词。`;
}

// SelfLift 那套的整条帧数：chunk 是每段多少帧，overlap 是一段开头带几帧上一段的尾巴
export function selfliftFrames(seconds: number, segments: number, context: number): VideoJobParams['frames'] {
  const plan = selfliftPlan(seconds, segments, context);
  return { total: plan.total, chunk: plan.lengths[0], overlap: context };
}

// 写进说明的每段大约几秒
export const segmentSeconds = (seconds: number) => Math.round(videoFrames(seconds, segmentCount(seconds)).chunk / VIDEO_FPS);

// 时长要几段、框里写了几段：一段最长 15 秒（MAX_CHUNK），框里写少了出来的片子就比要的短
// （写多了不要紧，帧数按段数摊，总长照样对得上）。对得上返回 null。
// 服务端拿它拦下来，界面拿它提前说，两边同一句话，见 docs/dev-plan.md 5.24
export function lengthProblem(seconds: number, written: number, selflift?: Pick<VideoSelfLift, 'contextFrames' | 'lead'>): string | null {
  const wanted = segmentCount(seconds);
  if (written >= wanted) {
    if (selflift) {
      const context = selflift.contextFrames;
      const lead = Boolean(selflift.lead);
      const plan = selfliftPlan(seconds, written, context, lead);
      if (plan.lengths.slice(0, -1).some((length, i) => length - (i || lead ? context : 0) < context)) {
        return `分段后的片段短于 ${context} 帧上下文，下一段接不上。减少提示词段数或「接几帧」，或者增加视频时长`;
      }
    }
    return null;
  }
  const actual = videoFrames(seconds, written);
  return (
    `时长 ${seconds} 秒至少要分 ${wanted} 段（一段最长 ${SEGMENT_SECONDS} 秒），这个框里只写了 ${written} 段，这样出来只有 ${(actual.total / VIDEO_FPS).toFixed(1)} 秒。` +
    `让模型照 ${seconds} 秒重写这个框，或者把时长改成 ${written * SEGMENT_SECONDS} 秒`
  );
}

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
  const workflow = workflowOfSettings(settings);
  const selflift = selfliftOfSettings(settings);
  const plan = workflow === 'selflift' ? selfliftPlan(seconds, segments.length, selflift.contextFrames, Boolean(selflift.lead)) : null;
  return {
    segments,
    seconds,
    // SelfLift 接续那套的帧数按它自己那套算：一段一条片子，第 2 段起开头带上一段的尾巴
    frames: plan ? { total: plan.total, chunk: plan.lengths[0], overlap: plan.context } : videoFrames(seconds, segments.length),
    ...(plan && { clipPlan: { lengths: plan.lengths, from: plan.from } }),
    aspectRatio: typeof sized === 'string' ? videoAspect(sized) : 'image',
    ...(images.refs.length && { refs: images.refs }),
    ...(first && { firstFrame: first.id }),
    megapixels: settings.megapixels,
    upscale: settings.upscale,
    ...videoSizes(settings.megapixels, settings.upscale, sized),
    model: settings.model,
    ...(settings.loras.length && { loras: settings.loras }),
    steps: stepsOfSettings(settings),
    workflow,
    denoise: denoiseOfSettings(settings),
    selflift,
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
  preview: '22',
};

// SelfLift 接续那套的节点号：一段一个任务，任务里接上一段用的节点从 300 起（读上一段、取尾巴、加噪、钉进提示词、
// 声音羽化），双 LoRA 双采的两套 LoRA 用 75、76（照 U37 接在注意力节点之后）；
// 解码、拼片、存片的从 160 起；最后把各段拼起来那一条读各段从 400 起，见 docs/dev-plan.md 5.32
export const SELFLIFT_NODE = {
  lowresLora: '75',
  hiresLora: '76',
  feather: '315',
  load: '300',
  tail: '301',
  components: '302',
  head: '303',
  noisy: '304',
  last: '305',
  clean: '306',
  batch: '307',
  guide: '308',
  firstGuide: '309',
  refTail: '310',
  refComponents: '311',
  outComponents: '312',
  color: '313',
  colorVideo: '314',
  decode: '160',
  decodeAudio: '161',
  video: '162',
  crop: '163',
  save: '21',
} as const;

// 最后把各段拼起来那一条的节点号
export const MERGE_NODE = { load: (i: number) => String(400 + i), concat: '90', save: '21' } as const;

// ComfyUI 先跑编码提示词，再加载主模型、采样，采样完解码、剪、对齐颜色、存片。
// 只认这几个节点，别的节点跑的时候还算前一步；SelfLift 接续那套一段一个任务，第几段按进度里的段数走
const STAGE_OF: Record<string, VideoStage> = {
  [NODE.prompts]: 'encode',
  [NODE.pass1]: 'pass1',
  [NODE.upscale]: 'upscale',
  [NODE.pass2]: 'pass2',
  [NODE.save]: 'save',
};

// 开始跑到哪个节点是到了哪一步；不是那五个的返回 null
export const videoStage = (node: string): VideoStage | null => STAGE_OF[node] ?? null;

// 一采、二采每段几步：加速的；这一条记了的照它记的。SelfLift 那套是一套调度跑一段，
// 报给「还要多久」的算法时算在一采上，二采没有
export const PASS_STEPS = VIDEO_SPEEDS.fast.steps;
export const stepsOf = (params: Pick<VideoJobParams, 'steps' | 'workflow' | 'selflift'>): VideoSteps =>
  workflowOf(params) === 'selflift' ? { pass1: selfliftOf(params).steps, pass2: 0 } : (params.steps ?? PASS_STEPS);

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
// 配音接 audio，打开 use_input_audio。dubAsRef 是 SelfLift 接续那套用的：那边编码提示词用的是 H3 官方的
// MiniMaxH3ReferenceToVideo，没有 use_input_audio 这个口子，配音就当参考音频接进去
function mediaNodes(params: VideoJobParams, files: VideoFiles, options: { dubAsRef?: boolean } = {}): { nodes: ComfyGraph; inputs: Record<string, unknown> } {
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
    if (dub && options.dubAsRef) {
      nodes[trim] = { class_type: 'TrimAudioDuration', inputs: { audio: link(load), start_index: item.start, duration: item.take } };
      inputs[`ref_audios.ref_audio_${audios}`] = link(trim);
      audios += 1;
      continue;
    }
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

// 一采出完先存一份低清预览的那个节点（MMH3StreamingSave）。服务端收到它的 executed 就把这一份取回来，
// 让用户在一采完、二采还在跑的时候就能看到片子大概什么样，见 docs/dev-plan.md 5.27
export const PREVIEW_NODE = NODE.preview;

// 带的参考图、首帧图接成节点：参考图从 30 号起，一张直接接、几张用 ImageTensorList 串起来（chained，两遍生成那套的节点要一整条）；
// 首帧图不在参考图里时单独一个 39 号。loads 是每张图各自的 LoadImage 编号：H3 官方那个编码节点的参考图是「自动增长」输入，
// 要一张一张发（ref_images.ref_image_0…），不能发串起来的那一整条（发过去是一块张量，节点里 `(ref_images or {})` 一判真假就报
// Boolean value of Tensor … ambiguous），所以那套不接 ImageTensorList
function refNodes(files: VideoFiles, chained = true): { nodes: ComfyGraph; refs?: string; loads: string[]; first?: string } {
  const link = (node: string, slot = 0) => [node, slot];
  const nodes: ComfyGraph = {};
  const loads = files.refs.map((name, i) => {
    const id = String(REF_LOAD + i);
    nodes[id] = { class_type: 'LoadImage', inputs: { image: name }, _meta: { title: `参考图 ${i + 1}` } };
    return id;
  });
  let refs = chained ? loads[0] : undefined;
  if (chained) {
    for (const [i, id] of loads.slice(1).entries()) {
      const list = String(REF_LIST + i);
      nodes[list] = { class_type: 'ImageTensorList', inputs: { image1: link(refs!), image2: link(id) } };
      refs = list;
    }
  }
  let first: string | undefined;
  if (files.firstFrame) {
    const index = files.refs.indexOf(files.firstFrame);
    first = index >= 0 ? loads[index] : FIRST_LOAD;
    if (index < 0) nodes[FIRST_LOAD] = { class_type: 'LoadImage', inputs: { image: files.firstFrame }, _meta: { title: '首帧图' } };
  }
  return { nodes, refs, loads, first };
}

// 挂的 LoRA 接在主模型和注意力节点之间，返回最后一个的 id
function loraChain(model: string, params: VideoJobParams, nodes: ComfyGraph): string {
  const link = (node: string, slot = 0) => [node, slot];
  for (const [i, lora] of (params.loras ?? []).entries()) {
    const id = String(LORA_FIRST + i);
    nodes[id] = { class_type: 'LoraLoaderModelOnly', inputs: { model: link(model), lora_name: lora.name, strength_model: lora.strength }, _meta: { title: `LoRA ${i + 1}` } };
    model = id;
  }
  return model;
}

// 主模型、注意力、文字编码器、两个 VAE 这几个装载节点，两套流程一样；model 是（挂完 LoRA 的）主模型 id
function baseNodes(model: string, unet: string): ComfyGraph {
  const link = (node: string, slot = 0) => [node, slot];
  return {
    [NODE.model]: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' }, _meta: { title: '主模型' } },
    [NODE.attention]: { class_type: 'ModelAttentionBackend', inputs: { model: link(model), attention: 'comfy kitchen attention' } },
    [NODE.lowVram]: { class_type: 'MiniMaxLowVRAMAttention', inputs: { model: link(NODE.attention), head_chunks: 8 } },
    [NODE.feedForward]: { class_type: 'MiniMaxChunkFeedForward', inputs: { model: link(NODE.lowVram), chunks: 8, seq_threshold: 4096 } },
    [NODE.clip]: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default' } },
    [NODE.videoVae]: { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' }, _meta: { title: '视频 VAE' } },
    [NODE.audioVae]: { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' }, _meta: { title: '音频 VAE' } },
  };
}

// 照 docs/workflows/h3-long-video.json 的两遍生成拼 API 格式，见 docs/dev-plan.md 5.26。一采、二采用同一个种子。
// 参考图接进编码提示词的 ref_images，每段都带：一张直接接，几张用 KJNodes 的 ImageTensorList 一张张接成一串，各自保持原来的比例；
// 首帧图照 U37 接在一采的 keyframes，钉在第 0 帧。jobId 给了的，一采、二采的结果按它的名字存下来
export function twoPassGraph(params: VideoJobParams, seed: number, files: VideoFiles = { refs: [] }, jobId?: string): ComfyGraph {
  const link = (node: string, slot = 0) => [node, slot];
  const { nodes: images, refs, first } = refNodes(files);
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
  const model = loraChain(NODE.model, params, images);
  const graph: ComfyGraph = {
    ...images,
    ...baseNodes(model, params.model),
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
    [NODE.sigmas2]: { class_type: 'BasicScheduler', inputs: { model: link(NODE.feedForward), scheduler: 'beta', steps: stepsOf(params).pass2, denoise: denoiseOf(params) } },
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
    // 一采出完先存一份低清预览：画面和声音都是整条的，压得狠一点、文件小一点。
    // 服务端收到这个节点的 executed 就把这一份取回来，用户在一采完、二采还在跑的时候就能看到大概什么样；
    // 二采途中叫停，留下的也是这一份，见 docs/dev-plan.md 5.27
    [NODE.preview]: {
      class_type: 'MMH3StreamingSave',
      inputs: {
        latent: link(NODE.pass1),
        vae: link(NODE.videoVae),
        groups_per_chunk: 4,
        fps: VIDEO_FPS,
        filename_prefix: jobId ? `media_agent_${jobId}_preview` : 'media-agent/preview',
        crf: 28,
        audio: link(NODE.audio),
        video_encoder: 'auto',
        ffmpeg_path: '',
        save_metadata: false,
      },
      _meta: { title: '一采出完先存低清预览' },
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

// 这节点走哪套内置流程：没选过的是两遍生成，选了 SelfLift 接续的走出第 1 段（后面几段服务端接着发），见 docs/dev-plan.md 5.32
export function videoGraph(params: VideoJobParams, seed: number, files: VideoFiles = { refs: [] }, jobId?: string): ComfyGraph {
  return workflowOf(params) === 'selflift' ? selfliftClipGraph(params, seed, files, jobId, 0) : twoPassGraph(params, seed, files, jobId);
}

// ─── SelfLift 接续那套，照 U37「真-上下文无缝无色差长视频-SelfLift双采-惊尘573」，见 docs/dev-plan.md 5.32 ───

// 一段的流程图（API 格式）。clip 是第几段（从 0 数），prev 是上一段拷进那台 input 目录以后的名字（第 1 段没有）。
// 第 2 段起：读上一段 → 取最后 contextFrames 帧 → 前面几帧加一点噪、最后一帧不加 → 连同这几帧的声音一起
// 用 AddGuide 钉在这一段的第 0 帧上（frame_idx 0，要羽化就再过一道 AudioGuideFeather）；
// 采样完把开头这几个上下文帧剪掉，再把整段颜色对齐到上一段的最后一帧。
// 第 1 段没有上下文：有首帧图就把那张钉在第 0 帧，没有就用编码提示词本身。
// 双 LoRA 双采：主模型和注意力补丁之上给低分辨率那遍、高分辨率那遍各挂一套 LoRA（U37 的 8 步 / 4 步两个加速 LoRA）
export function selfliftClipGraph(
  params: VideoJobParams,
  seed: number,
  files: VideoFiles = { refs: [] },
  jobId?: string,
  clip = 0,
  prev?: string,
  lowresPreview = false,
): ComfyGraph {
  const link = (node: string, slot = 0) => [node, slot];
  const { nodes: images, loads, first } = refNodes(files, false);
  const media = mediaNodes(params, files, { dubAsRef: true });
  Object.assign(images, media.nodes);
  const model = loraChain(NODE.model, params, images);
  const sl = selfliftOf(params);
  // 不用放大器就是插件的 SelfLift-zero：靠模型自己的 VAE 锚点修（rho 0.6、修正强度 1）；用放大器就是纯潜空间提升（rho 0）
  const lift = sl.upscaler === VIDEO_SELFLIFT.none ? VIDEO_SELFLIFT.zero : VIDEO_SELFLIFT.external;
  const plan = selfliftClips(params);
  const length = plan.lengths[clip] ?? plan.lengths.at(-1)!;
  const prompt = params.segments[plan.from[clip] ?? 0] ?? params.segments[0];
  // 上一段给的才有上下文：接力那套第 2 段起是，有「续写起点」时这次新出的第 1 段也是（它接的是前一段视频）
  const context = prev ? plan.context : 0;
  // 双 LoRA：一套挂低分辨率那遍（sampler 的 model、算 sigmas 也用这个），一套挂高分辨率那遍（model_hires）；
  // 没配就不接，采样器那边照插件自己的默认走
  const phase: ComfyGraph = {};
  const phaseLora = (id: string, lora: VideoLora | null | undefined, title: string) => {
    if (!lora) return undefined;
    phase[id] = { class_type: 'LoraLoaderModelOnly', inputs: { model: link(NODE.feedForward), lora_name: lora.name, strength_model: lora.strength }, _meta: { title } };
    return id;
  };
  const lowresModel = phaseLora(SELFLIFT_NODE.lowresLora, sl.lowresLora, '低分辨率那遍的 LoRA') ?? NODE.feedForward;
  const hiresModel = phaseLora(SELFLIFT_NODE.hiresLora, sl.hiresLora, '高分辨率那遍的 LoRA');
  const graph: ComfyGraph = {
    ...images,
    ...baseNodes(model, params.model),
    ...phase,
    [NODE.prompts]: {
      class_type: 'MiniMaxH3ReferenceToVideo',
      inputs: {
        clip: link(NODE.clip),
        vae: link(NODE.videoVae),
        audio_vae: link(NODE.audioVae),
        // SelfLift 的 latent_image 定的是「抬到多高」，所以按出片大小编码，低分辨率那段由它自己缩
        width: params.finalWidth,
        height: params.finalHeight,
        length,
        ref_image_size: 'match',
        // 这一套一段一条片子，写的就是这一段提示词（多段那套的 | 分隔在这里没有意义，换掉免得被当成分段）
        prompt: prompt.replaceAll('|', '/'),
        // 参考图一张一张接：H3 官方这个节点是「自动增长」输入（ref_images.ref_image_0、_1…），发整条会被当张量
        ...Object.fromEntries(loads.map((id, i) => [`ref_images.ref_image_${i}`, link(id)])),
        ...media.inputs,
      },
      _meta: { title: `第 ${clip + 1} 段：编码提示词` },
    },
    [NODE.sampler]: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    // 一套调度：总共 sl.steps 步，其中前 transitionStep 步在低分辨率跑
    [NODE.sigmas1]: { class_type: 'BasicScheduler', inputs: { model: link(lowresModel), scheduler: 'beta', steps: sl.steps, denoise: 1 } },
    [SELFLIFT_NODE.decode]: { class_type: 'VAEDecode', inputs: { samples: link(NODE.pass1), vae: link(NODE.videoVae) }, _meta: { title: '解成画面' } },
    [SELFLIFT_NODE.decodeAudio]: { class_type: 'VAEDecodeAudio', inputs: { samples: link(NODE.pass1), vae: link(NODE.audioVae) }, _meta: { title: '解出声音' } },
    [SELFLIFT_NODE.video]: {
      class_type: 'CreateVideo',
      inputs: { images: link(SELFLIFT_NODE.decode), audio: link(SELFLIFT_NODE.decodeAudio), fps: VIDEO_FPS, bit_depth: 8, color_space: 'sRGB', codec: 'none' },
      _meta: { title: `第 ${clip + 1} 段` },
    },
  };
  let positive = NODE.prompts;
  if (context && prev) {
    const components = link(SELFLIFT_NODE.components);
    graph[SELFLIFT_NODE.load] = { class_type: 'LoadVideo', inputs: { file: prev }, _meta: { title: `读上一段（第 ${clip} 段）` } };
    graph[SELFLIFT_NODE.tail] = {
      class_type: 'VideoFrameSample',
      inputs: { video: link(SELFLIFT_NODE.load), num_frames: context, strategy: 'tail', seed: 0 },
      _meta: { title: `上一段最后 ${context} 帧` },
    };
    graph[SELFLIFT_NODE.components] = { class_type: 'GetVideoComponents', inputs: { video: link(SELFLIFT_NODE.tail) } };
    // 前面几帧轻轻加一点噪（U37：减轻接缝闪烁），最后一帧一点不加 —— 这一帧就是要接上的那一帧
    graph[SELFLIFT_NODE.head] = { class_type: 'GetImageRangeFromBatch', inputs: { images: components, start_index: 0, num_frames: context - 1 } };
    graph[SELFLIFT_NODE.noisy] = { class_type: 'ImageAddNoise', inputs: { image: link(SELFLIFT_NODE.head), seed: 0, strength: sl.noise } };
    graph[SELFLIFT_NODE.last] = { class_type: 'GetImageRangeFromBatch', inputs: { images: components, start_index: context - 1, num_frames: 1 } };
    graph[SELFLIFT_NODE.clean] = { class_type: 'ImageAddNoise', inputs: { image: link(SELFLIFT_NODE.last), seed: 0, strength: 0 } };
    graph[SELFLIFT_NODE.batch] = {
      class_type: 'ImageBatchMulti',
      inputs: { inputcount: 2, image_1: link(SELFLIFT_NODE.noisy), image_2: link(SELFLIFT_NODE.clean) },
      _meta: { title: '接缝这几帧' },
    };
    graph[SELFLIFT_NODE.guide] = {
      class_type: 'MiniMaxH3AddGuide',
      inputs: {
        positive: link(NODE.prompts),
        latent: link(NODE.prompts, 1),
        frame_idx: 0,
        vae: link(NODE.videoVae),
        audio_vae: link(NODE.audioVae),
        image: link(SELFLIFT_NODE.batch),
        // 声音也接着上一段：连着那几帧的声音一起钉进去
        audio: link(SELFLIFT_NODE.components, 1),
      },
      _meta: { title: '把上一段的尾巴钉在这一段的开头' },
    };
    positive = SELFLIFT_NODE.guide;
    // 接缝那几帧的声音有硬边，羽化一下（U37 的 MiniMaxH3AudioGuideFeather）；刻度填 0 就不接这个节点
    if (sl.audioFeather > 0) {
      graph[SELFLIFT_NODE.feather] = {
        class_type: 'MiniMaxH3AudioGuideFeather',
        inputs: { positive: link(SELFLIFT_NODE.guide), audio_feather_ticks: sl.audioFeather },
        _meta: { title: '接缝声音羽化' },
      };
      positive = SELFLIFT_NODE.feather;
    }
  } else if (first) {
    // 图当首帧：这一张钉在第 0 帧，见 docs/dev-plan.md 5.26
    graph[SELFLIFT_NODE.firstGuide] = {
      class_type: 'MiniMaxH3AddGuide',
      inputs: { positive: link(NODE.prompts), latent: link(NODE.prompts, 1), frame_idx: 0, vae: link(NODE.videoVae), audio_vae: link(NODE.audioVae), image: link(first) },
      _meta: { title: '首帧图钉在第 0 帧' },
    };
    positive = SELFLIFT_NODE.firstGuide;
  }
  // 负面照 U37：拿编码出来的正面全零掉
  graph[NODE.firstCond] = { class_type: 'ConditioningZeroOut', inputs: { conditioning: link(NODE.prompts) }, _meta: { title: '负面（全零）' } };
  graph[NODE.pass1] = {
    class_type: 'SelfLiftH3Sampler',
    inputs: {
      model: link(lowresModel),
      positive: link(positive),
      negative: link(NODE.firstCond),
      vae: link(NODE.videoVae),
      latent_image: link(NODE.prompts, 1),
      sampler: link(NODE.sampler),
      sigmas: link(NODE.sigmas1),
      // 双 LoRA 双采：高分辨率那遍换成另一套 LoRA（U37 那边是 4 步那个）；没配就不接
      ...(hiresModel && { model_hires: link(hiresModel) }),
      // 每段换一个种子，跟 ComfyUI 界面上「每段加一」一样
      seed: seed + clip,
      cfg: 1,
      transition_step: sl.transitionStep,
      lowres_scale: sl.lowresScale,
      rho: lift.rho,
      w_min: lift.wMin,
      w_max: lift.wMax,
      upscaler_model: sl.upscaler,
      highres_tiling: false,
    },
    _meta: { title: `第 ${clip + 1} 段（SelfLift）` },
  };
  // 可选扩展只读取最后一次低清预测并存预览，SelfLift 原采样器继续照 U37 跑。
  if (lowresPreview && clip === 0) {
    graph[NODE.preview] = {
      class_type: 'MediaAgentSelfLiftPreview',
      inputs: {
        model: link(lowresModel),
        vae: link(NODE.videoVae),
        transition_step: sl.transitionStep,
        fps: VIDEO_FPS,
        trim_frames: context,
        filename_prefix: jobId ? `media_agent_${jobId}_preview` : 'media-agent/preview',
      },
      _meta: { title: '低清采样结束先存预览' },
    };
    graph[NODE.pass1].inputs.model = link(NODE.preview);
  }
  // 出片：带上下文的把开头那几个上下文帧剪掉（U37 的 VideoTemporalCrop），再把整段颜色对齐到上一段的最后一帧
  let out: string = SELFLIFT_NODE.video;
  if (context && prev) {
    graph[SELFLIFT_NODE.crop] = {
      class_type: 'VideoTemporalCrop',
      inputs: { video: link(SELFLIFT_NODE.video), start_frame: context, length: 99999 },
      _meta: { title: '剪掉开头的上下文帧' },
    };
    out = SELFLIFT_NODE.crop;
    if (sl.colorMatch > 0) {
      graph[SELFLIFT_NODE.refTail] = { class_type: 'VideoFrameSample', inputs: { video: link(SELFLIFT_NODE.load), num_frames: 1, strategy: 'tail', seed: 0 } };
      graph[SELFLIFT_NODE.refComponents] = { class_type: 'GetVideoComponents', inputs: { video: link(SELFLIFT_NODE.refTail) } };
      graph[SELFLIFT_NODE.outComponents] = { class_type: 'GetVideoComponents', inputs: { video: link(SELFLIFT_NODE.crop) } };
      graph[SELFLIFT_NODE.color] = {
        class_type: 'ColorTransfer',
        inputs: {
          image_target: link(SELFLIFT_NODE.outComponents),
          image_ref: link(SELFLIFT_NODE.refComponents),
          method: 'mkl_lab',
          // 动态下拉的下一级输入在 API 格式里是「父项.子项」这个名字（照报错里的 input_name 写的）
          source_stats: 'target_frame',
          'source_stats.target_index': 0,
          strength: sl.colorMatch,
        },
        _meta: { title: '颜色对齐上一段的最后一帧' },
      };
      graph[SELFLIFT_NODE.colorVideo] = {
        class_type: 'CreateVideo',
        inputs: { images: link(SELFLIFT_NODE.color), audio: link(SELFLIFT_NODE.outComponents, 1), fps: VIDEO_FPS, bit_depth: 8, color_space: 'sRGB', codec: 'none' },
      };
      out = SELFLIFT_NODE.colorVideo;
    }
  }
  graph[NODE.save] = {
    class_type: 'SaveVideo',
    inputs: { video: link(out), filename_prefix: `media-agent/selflift_${jobId ?? 'job'}_s${clip}`, format: 'auto' },
    _meta: { title: `存第 ${clip + 1} 段` },
  };
  return graph;
}

// 最后把各段拼成一条：读各段（都拷进那台 input 目录了）→ ConcatenateVideo（已经是编码好的 mp4，直接接、不重新解）→ 存
export function selfliftMergeGraph(clips: { name: string }[], jobId?: string): ComfyGraph {
  const graph: ComfyGraph = {};
  clips.forEach((clip, i) => {
    graph[MERGE_NODE.load(i)] = { class_type: 'LoadVideo', inputs: { file: clip.name }, _meta: { title: `第 ${i + 1} 段` } };
  });
  graph[MERGE_NODE.concat] = {
    class_type: 'ConcatenateVideo',
    inputs: { ...Object.fromEntries(clips.map((_, i) => [`videos.video${i}`, [MERGE_NODE.load(i), 0]])), codec: 'auto' },
    _meta: { title: '一段段接起来' },
  };
  graph[MERGE_NODE.save] = {
    class_type: 'SaveVideo',
    inputs: { video: [MERGE_NODE.concat, 0], filename_prefix: `media_agent_${jobId ?? 'job'}`, format: 'auto' },
    _meta: { title: '存成整条' },
  };
  return graph;
}

// ─── 从第 N 段起重出（只有 SelfLift 接力那套有），见 docs/dev-plan.md 5.34 ───

// 前 N−1 段照旧留着，从第 N 段往后再跑一遍再拼起来。为什么不能只重出中间一段：接力是链式的，
// 第 N+1 段是接着第 N 段的画面长出来的，换了第 N 段后面就得跟着重出；所以能选的起点就这几档。
// 老的那条得先把前面几段出完（留着的那几段得在那台上），最多只能从「已经出完的下一段」起；第 1 段起等于整条重出，所以从 2 起。
// 「段」按出片的顺序数：有前一段视频的（见 docs/dev-plan.md 5.35）它算第 1 段，所以「从第 2 段起」＝留着前一段视频、新出的从头重做
export const rerunFroms = (job: Pick<VideoJob, 'chain'>): number[] => {
  const total = job.chain?.total ?? 0;
  const done = (job.chain?.clips.length ?? 0) + (job.chain?.lead ? 1 : 0);
  const last = Math.min(total, done + 1);
  return Array.from({ length: Math.max(0, last - 1) }, (_, i) => i + 2);
};

export const rerunText = (clip: number) => `从第 ${clip} 段起重出`;
export const rerunKeptText = (clip: number) => `前 ${clip - 1} 段照旧`;

// ─── 续写起点（SelfLift 才有），见 docs/dev-plan.md 5.35 ───

// 传上去的前一段视频要先量一下、必要时规整成出片大小，这两步是在那台上跑脚本做的（packages/server/src/comfy/videoLead.ts）。
// 脚本里带这行标记（后面是目标和出片大小），假的 SSH（tools/mock-comfyui/src/ssh.ts）认这行，照它回一份量出来的结果；
// 两边改一个就得改另一个
export const LEAD_MARK = { probe: '# media-agent:lead-probe', fix: '# media-agent:lead-fix' };

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

// 记录只留同样出片大小、同样段数、同一套流程的最近 5 条，见 docs/dev-plan.md 5.29、5.32
export const TIMINGS_KEPT = 5;
const sameKind = (a: Pick<VideoTiming, 'finalWidth' | 'finalHeight' | 'segments' | 'workflow'>, b: Pick<VideoTiming, 'finalWidth' | 'finalHeight' | 'segments' | 'workflow'>) =>
  a.finalWidth === b.finalWidth && a.finalHeight === b.finalHeight && a.segments === b.segments && (a.workflow ?? 'two-pass') === (b.workflow ?? 'two-pass');

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
  const kind = { finalWidth: params.finalWidth, finalHeight: params.finalHeight, segments: params.segments.length, workflow: workflowOf(params) };
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

// 出的视频先放工作文件夹 video-temp/YYYY-MM-DD/HHmmss-<种子>.mp4，按本机时间，见 docs/dev-plan.md 5.27。
// 一采那份低清预览用 tail 加个「-preview」：它和成片常常在同一秒、同一个种子下写，不加就重名了
export const videoTempFileName = (date: Date, seed: number, tail = '') => `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${seed}${tail}.mp4`;

// 下载的文件名：<节点标题>-<种子>.mp4，文件名里不能用的字符换成 _
export const videoDownloadName = (title: string, seed: number) => `${title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}-${seed}.mp4`;

// 整条多少秒，界面上写一位小数
export const videoSecondsText = (frames: number) => `${(frames / VIDEO_FPS).toFixed(1)} 秒`;
