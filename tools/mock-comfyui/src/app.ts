import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import sharp from 'sharp';
import { WebSocketServer, type WebSocket } from 'ws';
import { createMockAutodl, MOCK_AUTODL_PATH, type MockAutodl, type MockAutodlOptions } from './autodl';
import { createMockSsh, type MockSsh } from './ssh';

// 假的 ComfyUI，接口和推送的样子照真的，见 docs/dev-plan.md 9.5。
// 正面提示词含「慢」的每步走得慢（测叫停），含「报错」的跑到一半出错，含「显存」的报显存不够。
// 出的图多大：有 ImageScale 的按它，不然按空白画布，不然按 LoadImage 那张传上来的图。
// 有 MMH3LoopingSampler 的按长视频跑，出的是 fixtures/video.mp4，提示词的规矩同上，见 runVideo。
// 长视频里存一采、二采结果的节点，在假的那台上写一个小文件；读回存档的节点，那台上没有这个文件就出错
// 假的 AutoDL 接口也挂在这里，见 ./autodl；它上面的 SSH 见 ./ssh，要另外 listen

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
type Task = { id: string; number: number; graph: Graph; clientId: string };
type Run = { task: Task; samplerId: string; timer?: NodeJS.Timeout; started: [string, Record<string, unknown>][] };
type ImageRef = { filename: string; subfolder: string; type: string };
type HistoryEntry = {
  prompt: [number, string, Graph, { client_id: string }, string[]];
  outputs: Record<string, { images?: ImageRef[]; animated?: boolean[]; text?: string[] }>;
  status: { status_str: 'success' | 'error'; completed: boolean; messages: [string, Record<string, unknown>][] };
};

// videoStepMs 是长视频每一步多久，一采、二采每段都要走好几步，比出图的快
export type MockComfyOptions = { stepMs?: number; slowStepMs?: number; videoStepMs?: number; autodl?: MockAutodlOptions };
export type MockComfy = { server: http.Server; autodl: MockAutodl; ssh: MockSsh; close(): Promise<void> };

const STEPS = 5;

// 生成视频那台上存一采、二采结果的文件夹
const LATENT_DIR = '/root/ComfyUI/output/MiniMaxH3/latent_checkpoints';

// 长视频出的是这个很小的真 mp4（VP9，Playwright 带的 Chromium 也能播）
const VIDEO = fs.readFileSync(new URL('../fixtures/video.mp4', import.meta.url));

const MODELS = {
  checkpoints: ['il-test.safetensors', 'pony-test.safetensors'],
  // 后两个和下面三样是长视频用的，文件名照 AutoDL 上 H3 那台
  vae: ['sdxl_vae.safetensors', 'qwen_image_vae.safetensors', 'minimax_h3_audio_vae_fp32.safetensors', 'minimax_h3_video_vae_fp16.safetensors'],
  unet: ['minimax/DasiwaMinimaxH3_dasiwaHybridTurboV2_int8.safetensors', 'minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors', 'minimax/minimax_h3_ref2va_int8_convrot.safetensors'],
  textEncoder: ['qwen3vl_32b_minimax_h3_int8_convrot.safetensors', 'qwen3vl_4b_uncensored_int8_convrot.safetensors', 'qwen3vl_4b_fp8_scaled.safetensors'],
  latentUpscale: ['minimax_h3_latent_upscaler_3d_bf16.safetensors'],
  loras: ['detail-test.safetensors', 'IL/anime-style-test.safetensors', 'IL/detail-tweaker-test.safetensors', 'krea2/krea2_4panel.safetensors', 'krea2/krea2_darkbrush.safetensors', 'krea2/DynamicCharacterSheet_krea2_v1.safetensors'],
  samplers: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde'],
  schedulers: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple'],
  upscale: ['4x-test.pth'],
  controlnet: ['openpose-test.safetensors', 'depth-test.safetensors', 'union-test.safetensors'],
  // ControlNet 的提取方式，真的 AIO_Preprocessor 列得更多，第一个是 none
  preprocessor: [
    'none',
    'MiDaS-DepthMapPreprocessor',
    'DepthAnythingV2Preprocessor',
    'Zoe-DepthMapPreprocessor',
    'DWPreprocessor',
    'OpenposePreprocessor',
    'AnimeLineArtPreprocessor',
    'LineArtPreprocessor',
    'CannyEdgePreprocessor',
    'HEDPreprocessor',
    'TilePreprocessor',
  ],
  unionType: ['auto', 'openpose', 'depth', 'hed/pidi/scribble/ted', 'canny/lineart/anime_lineart/mlsd', 'normal', 'segment', 'tile', 'repaint'],
  ipadapter: ['ip-adapter-test.safetensors'],
  clipVision: ['clip-vision-test.safetensors'],
  tagger: ['wd-v1-4-moat-tagger-v2'],
  // 真的 ComfyUI 上，检测模型的文件夹里还放着 SAM 这类别的模型，也会列出来
  detector: ['bbox/face_yolov8m.pt', 'bbox/hand_yolov8s.pt', 'segm/person_yolov8m-seg.pt', 'segm/sam_vit_b_01ec64.pth'],
  sam: ['sam_vit_b_01ec64.pth'],
};

// 下拉选项两种写法都有：老的 [[选项…], {…}]，新的 ['COMBO', {options: […]}]
const combo = (options: string[]) => [options, {}];
const comboV3 = (options: string[]) => ['COMBO', { options }];
const node = (required: Record<string, unknown> = {}, output: string[] = [], outputNode = false, optional?: Record<string, unknown>) => ({
  input: { required, ...(optional && { optional }) } as { required: Record<string, unknown>; optional?: Record<string, unknown> },
  output,
  output_node: outputNode,
});

const OBJECT_INFO: Record<string, ReturnType<typeof node>> = {
  CheckpointLoaderSimple: node({ ckpt_name: combo(MODELS.checkpoints) }, ['MODEL', 'CLIP', 'VAE']),
  VAELoader: node({ vae_name: combo(MODELS.vae) }, ['VAE']),
  LoraLoader: node({ model: ['MODEL'], clip: ['CLIP'], lora_name: combo(MODELS.loras), strength_model: ['FLOAT', {}], strength_clip: ['FLOAT', {}] }, ['MODEL', 'CLIP']),
  LoraLoaderModelOnly: node({ model: ['MODEL'], lora_name: combo(MODELS.loras), strength_model: ['FLOAT', {}] }, ['MODEL']),
  CLIPSetLastLayer: node({ clip: ['CLIP'], stop_at_clip_layer: ['INT', { min: -24, max: -1 }] }, ['CLIP']),
  CLIPTextEncode: node({ text: ['STRING', { multiline: true }], clip: ['CLIP'] }, ['CONDITIONING']),
  BNK_CLIPTextEncodeAdvanced: node(
    {
      text: ['STRING', { multiline: true }],
      clip: ['CLIP'],
      token_normalization: combo(['none', 'mean', 'length', 'length+mean']),
      weight_interpretation: combo(['comfy', 'A1111', 'compel', 'comfy++', 'down_weight']),
    },
    ['CONDITIONING'],
  ),
  EmptyLatentImage: node({ width: ['INT', {}], height: ['INT', {}], batch_size: ['INT', {}] }, ['LATENT']),
  EmptySD3LatentImage: node({ width: ['INT', {}], height: ['INT', {}], batch_size: ['INT', {}] }, ['LATENT']),
  ConditioningZeroOut: node({ conditioning: ['CONDITIONING'] }, ['CONDITIONING']),
  Krea2EditModelPatch: node({ model: ['MODEL'], source_latent: ['LATENT'] }, ['MODEL'], false, { target_latent: ['LATENT'], source_image: ['IMAGE'], vae: ['VAE'], ref_boost: ['FLOAT', {}], ref_boost_a: ['FLOAT', {}], fit_mode: combo(['fit', 'crop (legacy)']) }),
  Krea2EditGroundedEncode: node({ clip: ['CLIP'], prompt: ['STRING', { multiline: true }] }, ['CONDITIONING'], false, { image: ['IMAGE'], grounding_px: ['INT', {}], system_prompt: ['STRING', {}] }),
  ImageResizeKJv2: node({ image: ['IMAGE'], width: ['INT', {}], height: ['INT', {}], upscale_method: combo(['lanczos']), keep_proportion: combo(['resize']), pad_color: ['STRING', {}], crop_position: combo(['center']), divisible_by: ['INT', {}] }, ['IMAGE'], false, { device: combo(['cpu', 'gpu']) }),
  KSampler: node(
    {
      model: ['MODEL'],
      seed: ['INT', {}],
      steps: ['INT', {}],
      cfg: ['FLOAT', {}],
      sampler_name: comboV3(MODELS.samplers),
      scheduler: comboV3(MODELS.schedulers),
      positive: ['CONDITIONING'],
      negative: ['CONDITIONING'],
      latent_image: ['LATENT'],
      denoise: ['FLOAT', {}],
    },
    ['LATENT'],
  ),
  KSamplerAdvanced: node({}, ['LATENT']),
  VAEDecode: node({ samples: ['LATENT'], vae: ['VAE'] }, ['IMAGE']),
  VAEEncode: node({}, ['LATENT']),
  PreviewImage: node({ images: ['IMAGE'] }, [], true),
  SaveImage: node({ images: ['IMAGE'] }, [], true),
  LoadImage: node({}, ['IMAGE', 'MASK']),
  UpscaleModelLoader: node({ model_name: combo(MODELS.upscale) }, ['UPSCALE_MODEL']),
  ImageUpscaleWithModel: node({}, ['IMAGE']),
  ImageScale: node({}, ['IMAGE']),
  ControlNetLoader: node({ control_net_name: combo(MODELS.controlnet) }, ['CONTROL_NET']),
  ControlNetApplyAdvanced: node({}, ['CONDITIONING', 'CONDITIONING']),
  SetUnionControlNetType: node({ control_net: ['CONTROL_NET'], type: comboV3(MODELS.unionType) }, ['CONTROL_NET']),
  AIO_Preprocessor: node({ image: ['IMAGE'] }, ['IMAGE'], false, { preprocessor: combo(MODELS.preprocessor), resolution: ['INT', { default: 512, min: 64, max: 16384, step: 64 }] }),
  CLIPVisionLoader: node({ clip_name: comboV3(MODELS.clipVision) }, ['CLIP_VISION']),
  IPAdapterModelLoader: node({ ipadapter_file: combo(MODELS.ipadapter) }, ['IPADAPTER']),
  IPAdapterAdvanced: node({}, ['MODEL']),
  UltralyticsDetectorProvider: node({ model_name: combo(MODELS.detector) }, ['BBOX_DETECTOR', 'SEGM_DETECTOR']),
  SAMLoader: node({ model_name: combo(MODELS.sam), device_mode: combo(['AUTO', 'Prefer GPU', 'CPU']) }, ['SAM_MODEL']),
  FaceDetailer: node({}, ['IMAGE']),
  DWPreprocessor: node({}, ['IMAGE']),
  'WD14Tagger|pysssss': node({ model: combo(MODELS.tagger) }, ['STRING'], true),
  // 长视频流程用的，下拉项照 H3 那台
  UNETLoader: node({ unet_name: combo([...MODELS.unet, 'krea2/darkBeastINT8Convrot2_krea211INT8Convrot.safetensors', 'krea/krea2_turbo_int8_convrot.safetensors']), weight_dtype: combo(['default', 'fp8_e4m3fn', 'fp8_e4m3fn_fast', 'fp8_e5m2']) }, ['MODEL']),
  ModelAttentionBackend: node({ model: ['MODEL'], attention: comboV3(['pytorch attention', 'comfy kitchen attention']) }, ['MODEL']),
  MiniMaxLowVRAMAttention: node({ model: ['MODEL'], head_chunks: ['INT', {}] }, ['MODEL']),
  MiniMaxChunkFeedForward: node({ model: ['MODEL'], chunks: ['INT', {}], seq_threshold: ['INT', {}] }, ['MODEL']),
  CLIPLoader: node({ clip_name: combo(MODELS.textEncoder), type: combo(['stable_diffusion', 'ltxv', 'minimax', 'krea2']) }, ['CLIP'], false, { device: combo(['default', 'cpu']) }),
  MMH3ReferenceMultiPrompt: node(
    { clip: ['CLIP'], vae: ['VAE'], audio_vae: ['VAE'], width: ['INT', {}], height: ['INT', {}], length: ['INT', {}], ref_image_size: comboV3(['match', 'max']), prompts: ['STRING', {}] },
    ['MMH3_COND_SET', 'LATENT', 'INT', 'IMAGE'],
    false,
    { ref_images: ['IMAGE'] },
  ),
  ImageTensorList: node({ image1: ['IMAGE'], image2: ['IMAGE'] }, ['IMAGE']),
  // 参考视频、参考音频、配音用的：读的文件要是传上来过的
  VHS_LoadVideo: node(
    { video: combo([]), force_rate: ['FLOAT', {}], custom_width: ['INT', {}], custom_height: ['INT', {}], frame_load_cap: ['INT', {}], skip_first_frames: ['INT', {}], select_every_nth: ['INT', {}] },
    ['IMAGE', 'INT', 'AUDIO', 'VHS_VIDEOINFO'],
    false,
    { format: combo(['None', 'AnimateDiff', 'H3']) },
  ),
  LoadAudio: node({ audio: comboV3([]) }, ['AUDIO']),
  TrimAudioDuration: node({ audio: ['AUDIO'], start_index: ['FLOAT', {}], duration: ['FLOAT', {}] }, ['AUDIO']),
  RemoveNoiseMask: node({ samples: ['LATENT'] }, ['LATENT']),
  EmptyAudio: node({ duration: ['FLOAT', {}], sample_rate: ['INT', {}], channels: ['INT', {}] }, ['AUDIO']),
  AudioConcat: node({ audio1: ['AUDIO'], audio2: ['AUDIO'], direction: combo(['after', 'before']) }, ['AUDIO']),
  MMH3CondSelect: node({ cond_set: ['MMH3_COND_SET'], index: ['INT', {}] }, ['CONDITIONING', 'STRING']),
  BasicGuider: node({ model: ['MODEL'], conditioning: ['CONDITIONING'] }, ['GUIDER']),
  RandomNoise: node({ noise_seed: ['INT', {}] }, ['NOISE']),
  KSamplerSelect: node({ sampler_name: comboV3(MODELS.samplers) }, ['SAMPLER']),
  BasicScheduler: node({ model: ['MODEL'], scheduler: comboV3(['simple', 'beta', 'normal']), steps: ['INT', {}], denoise: ['FLOAT', {}] }, ['SIGMAS']),
  MMH3LoopingSampler: node(
    { noise: ['NOISE'], guider: ['GUIDER'], sampler: ['SAMPLER'], sigmas: ['SIGMAS'], cond_set: ['MMH3_COND_SET'], latent: ['LATENT'], carry: comboV3(['mask', 'keyframe']) },
    ['LATENT', 'INT', 'STRING'],
    false,
    { keyframes: ['IMAGE'], vae: ['VAE'], denoise_mask_mode: comboV3(['max', 'min', 'mean', 'last']) },
  ),
  LTXVSeparateAVLatent: node({ av_latent: ['LATENT'] }, ['LATENT', 'LATENT']),
  MinimaxH3LatentUpscaler3D: node({ latent: ['*'], model_name: comboV3(MODELS.latentUpscale), device: comboV3(['cuda', 'rocm', 'cpu']), precision: comboV3(['fp32', 'fp16', 'bf16']) }, ['*']),
  LTXVConcatAVLatent: node({ video_latent: ['LATENT'], audio_latent: ['LATENT'] }, ['LATENT']),
  VAEDecodeAudio: node({ samples: ['LATENT'], vae: ['VAE'] }, ['AUDIO']),
  MMH3StreamingSave: node({ latent: ['LATENT'], vae: ['VAE'], filename_prefix: ['STRING', {}] }, ['STRING'], true, { video_encoder: comboV3(['auto', 'libx264', 'h264_nvenc']) }),
  // 重拍一截用的：存档存取、切开、拼接、遮罩
  MiniMaxH3NativeLatentCheckpointSaveT8Advanced: node({ av_latent: ['LATENT'], filename_prefix: ['STRING', {}], checkpoint_id: ['STRING', {}] }, ['LATENT', 'STRING', 'STRING', 'STRING', 'STRING', 'STRING'], true),
  MiniMaxH3NativeLatentCheckpointLoadT8Advanced: node({ checkpoint_path: ['STRING', {}] }, ['LATENT', 'STRING', 'BOOLEAN', 'STRING', 'STRING', 'STRING', 'STRING', 'STRING']),
  PreviewAny: node({ source: ['*'] }, ['STRING'], true),
  MMH3TrimAV: node({ latent: ['LATENT'], trim_head_latents: ['INT', {}], trim_tail_latents: ['INT', {}] }, ['LATENT', 'INT', 'INT', 'STRING']),
  MMH3ConcatAV: node({ latent_a: ['LATENT'], latent_b: ['LATENT'], trim_b_latents: ['INT', {}] }, ['LATENT']),
  LatentCut: node({ samples: ['LATENT'], dim: comboV3(['x', 'y', 't']), index: ['INT', {}], amount: ['INT', {}] }, ['LATENT']),
  ReplaceVideoLatentFrames: node({ destination: ['LATENT'], index: ['INT', {}] }, ['LATENT'], false, { source: ['LATENT'] }),
  SolidMask: node({ value: ['FLOAT', {}], width: ['INT', {}], height: ['INT', {}] }, ['MASK']),
  MaskToImage: node({ mask: ['MASK'] }, ['IMAGE']),
  RepeatImageBatch: node({ image: ['IMAGE'], amount: ['INT', {}] }, ['IMAGE']),
  ImageBatch: node({ image1: ['IMAGE'], image2: ['IMAGE'] }, ['IMAGE']),
  ImageToMask: node({ image: ['IMAGE'], channel: combo(['red', 'green', 'blue', 'alpha']) }, ['MASK']),
};

// 往 AutoDL 那台传的模型也列进下拉，跟真的 ComfyUI 读 extra_model_paths.yaml 一样
const REMOTE_MODELS: { dir: string; type: string; input: string; prefix?: string }[] = [
  { dir: '/root/autodl-tmp/models/checkpoints', type: 'CheckpointLoaderSimple', input: 'ckpt_name' },
  { dir: '/root/autodl-tmp/models/loras', type: 'LoraLoader', input: 'lora_name' },
  { dir: '/root/autodl-tmp/models/loras', type: 'LoraLoaderModelOnly', input: 'lora_name' },
  { dir: '/root/autodl-tmp/models/vae', type: 'VAELoader', input: 'vae_name' },
  { dir: '/root/autodl-tmp/models/upscale_models', type: 'UpscaleModelLoader', input: 'model_name' },
  { dir: '/root/ComfyUI/models/ultralytics/bbox', type: 'UltralyticsDetectorProvider', input: 'model_name', prefix: 'bbox/' },
  { dir: '/root/ComfyUI/models/ultralytics/segm', type: 'UltralyticsDetectorProvider', input: 'model_name', prefix: 'segm/' },
  { dir: '/root/autodl-tmp/models/controlnet', type: 'ControlNetLoader', input: 'control_net_name' },
  { dir: '/root/autodl-tmp/models/ipadapter', type: 'IPAdapterModelLoader', input: 'ipadapter_file' },
  { dir: '/root/autodl-tmp/models/clip_vision', type: 'CLIPVisionLoader', input: 'clip_name' },
];

function filesUnder(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return filesUnder(path.join(dir, entry.name), `${prefix}${entry.name}/`);
    return entry.isFile() && !entry.name.endsWith('.part') ? [`${prefix}${entry.name}`] : [];
  });
}

function comboOptions(spec: unknown): unknown[] | null {
  if (!Array.isArray(spec)) return null;
  if (Array.isArray(spec[0])) return spec[0];
  if (spec[0] === 'COMBO') return (spec[1] as { options: unknown[] }).options;
  return null;
}

const findNode = (graph: Graph, type: string) => Object.keys(graph).find((id) => graph[id].class_type === type);
const linked = (graph: Graph, value: unknown) => (Array.isArray(value) ? graph[String(value[0])] : undefined);

// 正面提示词：顺着 positive 往上找到写着文字的节点，中间隔着 ControlNet 的照样找得到
function textAbove(graph: Graph, value: unknown): string {
  const seen = new Set<unknown>();
  for (let item = linked(graph, value); item && !seen.has(item); item = linked(graph, item.inputs.positive)) {
    if (typeof item.inputs.text === 'string') return item.inputs.text;
    if (typeof item.inputs.prompt === 'string') return item.inputs.prompt;
    seen.add(item);
  }
  return '';
}
const escapeXml = (text: string) => text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// 按真 ComfyUI 的规矩检查：节点类型要有，下拉项的值要在列表里（选填的没填不管）；LoadImage 的图、读视频和音频的文件要是传上来过的
function validate(graph: Graph, info: typeof OBJECT_INFO, uploaded: Map<string, Buffer>, hidden: Set<string>): object | null {
  for (const [id, item] of Object.entries(graph)) {
    if (!info[item.class_type] || hidden.has(item.class_type)) {
      return {
        error: { type: 'invalid_prompt', message: `Cannot execute because node ${item.class_type} does not exist.`, details: `Node ID '#${id}'`, extra_info: {} },
        node_errors: {},
      };
    }
  }
  const outputs = Object.keys(graph).filter((id) => info[graph[id].class_type].output_node);
  const nodeErrors: Record<string, object> = {};
  for (const [id, item] of Object.entries(graph)) {
    const { required, optional = {} } = info[item.class_type].input;
    const files = combo([...uploaded.keys()]);
    const specs = {
      ...optional,
      ...required,
      ...(item.class_type === 'LoadImage' && { image: files }),
      ...(item.class_type === 'VHS_LoadVideo' && { video: files }),
      ...(item.class_type === 'LoadAudio' && { audio: files }),
    };
    const errors = Object.entries(specs).flatMap(([name, spec]) => {
      const options = comboOptions(spec);
      const value = item.inputs[name];
      if (!options || Array.isArray(value) || options.includes(value) || (value === undefined && name in optional)) return [];
      return [
        {
          type: 'value_not_in_list',
          message: 'Value not in list',
          details: `${name}: '${String(value)}' not in [${options.map((option) => `'${String(option)}'`).join(', ')}]`,
          extra_info: { input_name: name, received_value: value },
        },
      ];
    });
    if (errors.length) nodeErrors[id] = { errors, dependent_outputs: outputs, class_type: item.class_type };
  }
  if (!Object.keys(nodeErrors).length) return null;
  return { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: '', extra_info: {} }, node_errors: nodeErrors };
}

// 图按尺寸现画：背景颜色跟着种子变，写上种子和正面提示词的前 40 个字
async function drawImage(width: number, height: number, seed: number, positive: string): Promise<Buffer> {
  const color = `#${((seed * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(-6)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="${color}"/>
<rect x="24" y="24" width="${width - 48}" height="150" rx="12" fill="#ffffff"/>
<text x="48" y="90" font-size="40" font-family="Arial, sans-serif" fill="#000000">seed ${seed}</text>
<text x="48" y="145" font-size="28" font-family="Arial, sans-serif" fill="#000000">${escapeXml(positive.slice(0, 40))}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export function createMockComfy({ stepMs = 300, slowStepMs = 1200, videoStepMs = 40, autodl: autodlOptions }: MockComfyOptions = {}): MockComfy {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const ssh = createMockSsh();
  const autodl = createMockAutodl({
    ...autodlOptions,
    sshCommand: () => {
      const address = ssh.server.address();
      return `ssh -p ${address && typeof address === 'object' ? address.port : 10000} root@127.0.0.1`;
    },
  });
  app.use(MOCK_AUTODL_PATH, autodl.router);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, string>();
  const queue: Task[] = [];
  const history = new Map<string, HistoryEntry>();
  const images = new Map<string, Buffer>();
  const videos = new Set<string>();
  const uploads = new Map<string, Buffer>();
  // 测试用：假装没装的节点类型，object_info 里不列，发来的任务也不收
  const hidden = new Set<string>();
  // 照 AutoDL 那台的 ComfyUI：整份 object_info 缓存着，底模、LoRA 文件夹最外层变了才重做
  let whole: { sign: string; info: typeof OBJECT_INFO } | null = null;
  const prompts: unknown[] = [];
  let current: Run | null = null;
  let counter = 0;
  let videoCounter = 0;

  const sendTo = (clientId: string, type: string, data: Record<string, unknown>) => {
    for (const [ws, id] of clients) if (id === clientId) ws.send(JSON.stringify({ type, data }));
  };
  const remaining = () => queue.length + (current ? 1 : 0);

  // 静态的节点列表，加上往假的 AutoDL 上传的模型
  function objectInfo(): typeof OBJECT_INFO {
    const info = { ...OBJECT_INFO };
    for (const { dir, type, input, prefix } of REMOTE_MODELS) {
      const local = ssh.local(dir);
      const names = fs.existsSync(local) ? filesUnder(local, prefix) : [];
      if (!names.length) continue;
      const spec = info[type].input.required[input] as unknown[];
      const options = [...(comboOptions(spec) as string[]), ...names];
      info[type] = { ...info[type], input: { ...info[type].input, required: { ...info[type].input.required, [input]: spec[0] === 'COMBO' ? comboV3(options) : combo(options) } } };
    }
    return info;
  }
  const broadcastStatus = () => {
    for (const ws of clients.keys()) ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: remaining() } } } }));
  };
  const row = (task: Task) => [task.number, task.id, task.graph, { client_id: task.clientId }, Object.keys(task.graph).filter((id) => OBJECT_INFO[task.graph[id].class_type].output_node)];
  const record = (task: Task, outputs: HistoryEntry['outputs'], ok: boolean, messages: HistoryEntry['status']['messages']) => {
    history.set(task.id, {
      prompt: row(task) as HistoryEntry['prompt'],
      outputs,
      status: { status_str: ok ? 'success' : 'error', completed: ok, messages },
    });
  };

  // 一个一个跑，每个 5 步
  function runNext() {
    if (current || !queue.length) return;
    const task = queue.shift()!;
    const { graph } = task;
    if (findNode(graph, 'MMH3LoopingSampler')) return runVideo(task);
    const samplerId = findNode(graph, 'KSampler') ?? findNode(graph, 'FaceDetailer') ?? Object.keys(graph)[0];
    const sampler = graph[samplerId];
    const positive = textAbove(graph, sampler.inputs.positive);
    const seed = Number(sampler.inputs.seed ?? 0);
    const wait = positive.includes('慢') ? slowStepMs : stepMs;
    const failure = positive.includes('显存')
      ? 'CUDA out of memory. Tried to allocate 2.00 GiB'
      : positive.includes('报错')
        ? 'mock-comfyui：正面提示词含「报错」，按约定出错'
        : null;
    const start = { prompt_id: task.id, timestamp: Date.now() };
    const run: Run = { task, samplerId, started: [['execution_start', start]] };
    current = run;
    sendTo(task.clientId, 'execution_start', start);
    sendTo(task.clientId, 'execution_cached', { nodes: [], prompt_id: task.id, timestamp: Date.now() });
    sendTo(task.clientId, 'executing', { node: samplerId, display_node: samplerId, prompt_id: task.id });
    broadcastStatus();

    let step = 0;
    const tick = async () => {
      step += 1;
      sendTo(task.clientId, 'progress', { value: step, max: STEPS, prompt_id: task.id, node: samplerId });
      if (failure && step === 2) {
        const error = {
          prompt_id: task.id,
          node_id: samplerId,
          node_type: sampler.class_type,
          executed: [],
          exception_message: failure,
          exception_type: failure.includes('CUDA') ? 'torch.OutOfMemoryError' : 'RuntimeError',
          traceback: [],
          current_inputs: {},
          current_outputs: {},
          timestamp: Date.now(),
        };
        record(task, {}, false, [...run.started, ['execution_error', error]]);
        current = null;
        sendTo(task.clientId, 'execution_error', error);
        sendTo(task.clientId, 'executing', { node: null, prompt_id: task.id });
        broadcastStatus();
        runNext();
        return;
      }
      if (step < STEPS) {
        run.timer = setTimeout(tick, wait);
        return;
      }
      const size = await outputSize(graph);
      const data = await drawImage(size.width, size.height, seed, positive);
      if (current !== run) return;
      // 有存图节点的按真的放进 output，不然是预览用的 temp
      const saveId = findNode(graph, 'SaveImage');
      const outputId = saveId ?? findNode(graph, 'PreviewImage') ?? samplerId;
      const ref = { filename: `ComfyUI_${saveId ? '' : 'temp_'}${randomUUID().slice(0, 5)}_00001_.png`, subfolder: '', type: saveId ? 'output' : 'temp' };
      images.set(ref.filename, data);
      const success = { prompt_id: task.id, timestamp: Date.now() };
      record(task, { [outputId]: { images: [ref] } }, true, [...run.started, ['execution_success', success]]);
      current = null;
      sendTo(task.clientId, 'executing', { node: outputId, display_node: outputId, prompt_id: task.id });
      sendTo(task.clientId, 'executed', { node: outputId, display_node: outputId, output: { images: [ref] }, prompt_id: task.id });
      sendTo(task.clientId, 'execution_success', success);
      sendTo(task.clientId, 'executing', { node: null, prompt_id: task.id });
      broadcastStatus();
      runNext();
    };
    run.timer = setTimeout(tick, wait);
  }

  // 长视频，见 docs/dev-plan.md 9.5：先编码提示词，按节点号的先后跑两个 MMH3LoopingSampler，
  // 每个跑提示词的段数那么多段，每段的步数是它接的 BasicScheduler 的；一采后面照真的先解码声音，再放大，二采完存文件。
  // 提示词含「慢」「报错」「显存」的规矩同出图，出错在一采第 1 段第 2 步
  function runVideo(task: Task) {
    const { graph } = task;
    const of = (type: string) =>
      Object.keys(graph)
        .filter((id) => graph[id].class_type === type)
        .sort((a, b) => Number(a) - Number(b));
    const encodeId = of('MMH3ReferenceMultiPrompt')[0];
    const text = String(graph[encodeId]?.inputs.prompts ?? '');
    const chunks = text.split('\n').filter((line) => line.trim() === '|').length + 1;
    const wait = text.includes('慢') ? slowStepMs : videoStepMs;
    // 读回的存档那台上没有：一开始就出错
    const lost = of('MiniMaxH3NativeLatentCheckpointLoadT8Advanced').find((id) => !fs.existsSync(ssh.local(`${LATENT_DIR}/${String(graph[id].inputs.checkpoint_path)}`)));
    const failure = lost
      ? `checkpoint not found: ${String(graph[lost].inputs.checkpoint_path)}`
      : text.includes('显存')
        ? 'CUDA out of memory. Tried to allocate 20.00 GiB'
        : text.includes('报错')
          ? 'mock-comfyui：提示词含「报错」，按约定出错'
          : null;
    const [pass1, pass2] = of('MMH3LoopingSampler');
    const stepsOf = (id: string) => Number(linked(graph, graph[id].inputs.sigmas)?.inputs.steps ?? 3);
    const saveId = of('MMH3StreamingSave')[0] ?? pass2 ?? pass1;
    // 每一项是推一条消息，推完等一步
    const events: [string, Record<string, unknown>][] = [];
    const executing = (id: string | undefined) => {
      if (id) events.push(['executing', { node: id, display_node: id, prompt_id: task.id }]);
    };
    executing(encodeId);
    executing(of('UNETLoader')[0]);
    for (const [index, id] of [pass1, pass2].entries()) {
      if (!id) continue;
      executing(id);
      for (let chunk = 0; chunk < chunks; chunk += 1) {
        for (let step = 1; step <= stepsOf(id); step += 1) events.push(['progress', { value: step, max: stepsOf(id), prompt_id: task.id, node: id }]);
      }
      if (index === 0) {
        executing(of('VAEDecodeAudio')[0]);
        executing(of('MinimaxH3LatentUpscaler3D')[0]);
      }
    }
    executing(saveId);

    const start = { prompt_id: task.id, timestamp: Date.now() };
    const run: Run = { task, samplerId: pass1, started: [['execution_start', start]] };
    current = run;
    sendTo(task.clientId, 'execution_start', start);
    sendTo(task.clientId, 'execution_cached', { nodes: [], prompt_id: task.id, timestamp: Date.now() });
    broadcastStatus();

    let sent = 0;
    const tick = () => {
      if (current !== run) return;
      const [type, data] = events[sent];
      sent += 1;
      sendTo(task.clientId, type, data);
      if (failure && (lost || (type === 'progress' && data.node === pass1 && data.value === 2))) {
        const error = {
          prompt_id: task.id,
          node_id: lost ?? pass1,
          node_type: lost ? 'MiniMaxH3NativeLatentCheckpointLoadT8Advanced' : 'MMH3LoopingSampler',
          executed: [],
          exception_message: failure,
          exception_type: failure.includes('CUDA') ? 'torch.OutOfMemoryError' : 'RuntimeError',
          traceback: [],
          current_inputs: {},
          current_outputs: {},
          timestamp: Date.now(),
        };
        record(task, {}, false, [...run.started, ['execution_error', error]]);
        current = null;
        sendTo(task.clientId, 'execution_error', error);
        sendTo(task.clientId, 'executing', { node: null, prompt_id: task.id });
        broadcastStatus();
        runNext();
        return;
      }
      if (sent < events.length) {
        run.timer = setTimeout(tick, wait);
        return;
      }
      // 照 MMH3StreamingSave：filename_prefix 最后一个斜杠前面是子文件夹，文件名后面加 5 位序号
      const prefix = String(graph[saveId]?.inputs.filename_prefix ?? 'video');
      const slash = prefix.lastIndexOf('/');
      videoCounter += 1;
      const ref = { filename: `${prefix.slice(slash + 1)}_${String(videoCounter).padStart(5, '0')}.mp4`, subfolder: prefix.slice(0, Math.max(0, slash)), type: 'output' };
      videos.add(ref.filename);
      const output = { images: [ref], animated: [true] };
      const outputs: HistoryEntry['outputs'] = { [saveId]: output };
      // 存档写进假的那台，存下的文件名照真的写进接着的 PreviewAny
      for (const id of of('MiniMaxH3NativeLatentCheckpointSaveT8Advanced')) {
        const name = `${String(graph[id].inputs.filename_prefix)}_${randomUUID().replace(/-/g, '').slice(0, 12)}.h3latent.safetensors`;
        const file = ssh.local(`${LATENT_DIR}/${name}`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'mock latent');
        for (const preview of of('PreviewAny')) if (linked(graph, graph[preview].inputs.source) === graph[id]) outputs[preview] = { text: [name] };
      }
      const success = { prompt_id: task.id, timestamp: Date.now() };
      record(task, outputs, true, [...run.started, ['execution_success', success]]);
      current = null;
      sendTo(task.clientId, 'executed', { node: saveId, display_node: saveId, output, prompt_id: task.id });
      sendTo(task.clientId, 'execution_success', success);
      sendTo(task.clientId, 'executing', { node: null, prompt_id: task.id });
      broadcastStatus();
      runNext();
    };
    run.timer = setTimeout(tick, wait);
  }

  async function outputSize(graph: Graph): Promise<{ width: number; height: number }> {
    const scale = findNode(graph, 'ImageScale');
    const latent = findNode(graph, 'EmptyLatentImage') ?? findNode(graph, 'EmptySD3LatentImage');
    const load = findNode(graph, 'LoadImage');
    const from = scale ?? latent;
    if (from) return { width: Number(graph[from].inputs.width), height: Number(graph[from].inputs.height) };
    const upload = load && uploads.get(String(graph[load].inputs.image));
    if (upload) {
      const { width = 512, height = 512 } = await sharp(upload).metadata();
      return { width, height };
    }
    return { width: 512, height: 512 };
  }

  app.get('/system_stats', (_req, res) => {
    res.json({
      system: { os: 'nt', ram_total: 68719476736, ram_free: 34359738368, comfyui_version: '0.3.60', python_version: '3.12.10', pytorch_version: '2.8.0+cu128', embedded_python: true, argv: ['main.py'] },
      devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', type: 'cuda', index: 0, vram_total: 25757220864, vram_free: 24000000000, torch_vram_total: 0, torch_vram_free: 0 }],
    });
  });

  app.get('/object_info', (_req, res) => {
    const sign = REMOTE_MODELS.filter(({ type }) => type === 'CheckpointLoaderSimple' || type === 'LoraLoader')
      .map(({ dir }) => (fs.existsSync(ssh.local(dir)) ? fs.statSync(ssh.local(dir)).mtimeMs : 0))
      .join(',');
    if (whole?.sign !== sign) whole = { sign, info: objectInfo() };
    res.json(Object.fromEntries(Object.entries(whole.info).filter(([type]) => !hidden.has(type))));
  });

  // 只要一种节点的，不缓存
  app.get('/object_info/:type', (req, res) => {
    const info = objectInfo();
    const type = req.params.type;
    res.json(info[type] && !hidden.has(type) ? { [type]: info[type] } : {});
  });

  // 测试用：假装没装这几种节点，测缺插件；传空的就都装回来
  app.post('/_hide-nodes', (req, res) => {
    hidden.clear();
    for (const type of req.body?.types ?? []) hidden.add(String(type));
    res.status(204).end();
  });

  app.post('/prompt', (req, res) => {
    prompts.push(req.body);
    const graph = req.body?.prompt as Graph;
    const problem = validate(graph ?? {}, objectInfo(), uploads, hidden);
    if (problem) {
      res.status(400).json(problem);
      return;
    }
    const task: Task = { id: randomUUID(), number: counter++, graph, clientId: String(req.body?.client_id ?? '') };
    queue.push(task);
    res.json({ prompt_id: task.id, number: task.number, node_errors: {} });
    broadcastStatus();
    setImmediate(runNext);
  });

  app.get('/queue', (_req, res) => {
    res.json({ queue_running: current ? [row(current.task)] : [], queue_pending: queue.map(row) });
  });

  app.post('/queue', (req, res) => {
    if (req.body?.clear) queue.length = 0;
    for (const id of req.body?.delete ?? []) {
      const index = queue.findIndex((task) => task.id === id);
      if (index >= 0) queue.splice(index, 1);
    }
    broadcastStatus();
    res.status(200).end();
  });

  // 带了 prompt_id 只停这一个（新版的做法）
  app.post('/interrupt', (req, res) => {
    const wanted = req.body?.prompt_id;
    const run = current;
    if (run && (!wanted || wanted === run.task.id)) {
      clearTimeout(run.timer);
      current = null;
      const data = { prompt_id: run.task.id, node_id: run.samplerId, node_type: run.task.graph[run.samplerId]?.class_type ?? 'KSampler', executed: [], timestamp: Date.now() };
      record(run.task, {}, false, [...run.started, ['execution_interrupted', data]]);
      sendTo(run.task.clientId, 'execution_interrupted', data);
      sendTo(run.task.clientId, 'executing', { node: null, prompt_id: run.task.id });
      broadcastStatus();
      setImmediate(runNext);
    }
    res.status(200).end();
  });

  app.get('/history/:id', (req, res) => {
    const entry = history.get(req.params.id);
    res.json(entry ? { [req.params.id]: entry } : {});
  });

  app.get('/view', (req, res) => {
    if (req.query.type === 'output' && videos.has(String(req.query.filename))) {
      res.type('video/mp4').send(VIDEO);
      return;
    }
    const data = req.query.type === 'temp' || req.query.type === 'output' ? images.get(String(req.query.filename)) : undefined;
    if (!data) {
      res.status(404).end();
      return;
    }
    res.type('image/png').send(data);
  });

  // 收图，和真的一样是 multipart：image 是文件，overwrite 为真时同名的换掉
  app.post('/upload/image', express.raw({ type: 'multipart/form-data', limit: '50mb' }), async (req, res) => {
    const form = await new Response(req.body as Buffer, { headers: { 'content-type': String(req.headers['content-type']) } }).formData();
    const file = form.get('image');
    if (!(file instanceof File)) {
      res.status(400).end();
      return;
    }
    uploads.set(file.name, Buffer.from(await file.arrayBuffer()));
    res.json({ name: file.name, subfolder: '', type: 'input' });
  });

  // 测试用：传上来的图，名字、大小、sha256
  app.get('/_uploads', (_req, res) => {
    res.json([...uploads].map(([name, data]) => ({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') })));
  });

  // 测试用：收到的每个 /prompt 请求体
  app.get('/_last-prompts', (_req, res) => {
    res.json(prompts);
  });

  // 测试用：假的 AutoDL 实例（出图那台，和按 uuid 的两台）现在的状态、收到过的开机关机请求
  app.get('/_autodl', (_req, res) => {
    res.json({ instance: autodl.instance, instances: autodl.instances, calls: autodl.calls });
  });

  // 测试用：假的 SSH 收到的命令、那台还剩多少空间、存着哪些一采二采的存档；能改剩多少、删掉几个存档
  app.get('/_ssh', (_req, res) => {
    const dir = ssh.local(LATENT_DIR);
    res.json({ commands: ssh.commands, free: ssh.state.free, latents: fs.existsSync(dir) ? fs.readdirSync(dir) : [] });
  });
  app.post('/_ssh', (req, res) => {
    if (typeof req.body?.free === 'number') ssh.state.free = req.body.free;
    for (const name of req.body?.removeLatents ?? []) fs.rmSync(ssh.local(`${LATENT_DIR}/${path.basename(String(name))}`), { force: true });
    res.status(204).end();
  });

  // 测试用：给链接下载的文件。bytes 是多大，ms 是花多久慢慢给（测停），status 不是 200 的直接回这个
  app.get('/_files/:name', async (req, res) => {
    const status = Number(req.query.status ?? 200);
    if (status !== 200) {
      res.status(status).end();
      return;
    }
    const bytes = Number(req.query.bytes ?? 100_000);
    const ms = Number(req.query.ms ?? 0);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(bytes));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const pieces = ms ? 10 : 1;
    for (let i = 0; i < pieces && !res.destroyed; i += 1) {
      const size = i === pieces - 1 ? bytes - Math.floor(bytes / pieces) * i : Math.floor(bytes / pieces);
      res.write(Buffer.alloc(size, i));
      if (ms) await new Promise((resolve) => setTimeout(resolve, ms / pieces));
    }
    res.end();
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // 同一个 clientId 重连时顶掉旧的，和真的一样
      const clientId = url.searchParams.get('clientId') || randomUUID().replace(/-/g, '');
      for (const [other, id] of clients) if (id === clientId) clients.delete(other);
      clients.set(ws, clientId);
      ws.on('close', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: remaining() } }, sid: clientId } }));
    });
  });

  return {
    server,
    autodl,
    ssh,
    async close() {
      autodl.close();
      await ssh.close();
      clearTimeout(current?.timer);
      current = null;
      queue.length = 0;
      for (const ws of wss.clients) ws.terminate();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
