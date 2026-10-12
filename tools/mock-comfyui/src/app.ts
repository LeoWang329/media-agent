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

// 假的反推输出：真那台上是 35B MoE 看图现写，假的这边按反推系统提示词要求的格式给一句固定的
// （触发词在最前面、后面接画面描述），见 docs/krea2-real-usage.md 第 4 节
const REVERSE_TEXT =
  'transform the image to realistic photograph, a young woman in a dark coat stands on a rainy platform at night, looking at camera, half body shot, backlight, photorealistic, highly detailed';

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
  loras: [
    'detail-test.safetensors',
    'IL/anime-style-test.safetensors',
    'IL/detail-tweaker-test.safetensors',
    'krea2/krea2_4panel.safetensors',
    // 编辑档那几个方案用的，见 docs/dev-plan.md 5.34
    'krea2/krea2_identity_edit_v1_1.safetensors',
    'krea2/krea2_identity_edit_v1_2.safetensors',
    'krea2/krea_outfittransfer.safetensors',
    'krea2/Krea2_Anything2RealCharacters-V1.safetensors',
    'krea2/Krea2_Anything2RealCharacters-V3.safetensors',
    'krea2/krea2_darkbrush.safetensors',
    'krea2/DynamicCharacterSheet_krea2_v1.safetensors',
    // 转真人那一档的两组 LoRA，见 docs/krea2-real-usage.md 第 6 节：转真人 V3/V1 在上面，
    // 下面是人物向的那几个（界面上「人物 LoRA」下拉里的候选）
    'krea2/Krea2_DreamCos_Realism.safetensors',
    'krea2/Krea2-realism-V2.safetensors',
    'krea2/krea2-Cc风情万种-人像.safetensors',
    'krea2/krea2-Cc风情万种-风格.safetensors',
    'krea2/krea2-Cc-天魔-身材.safetensors',
    'krea2/Nick_baotunqun_Krea2.safetensors',
    'krea2/Nick_leggings_Krea2.safetensors',
    'krea2/krea2_reid_rank32.safetensors',
    // 深度迁移和风格 Remix 那两档（图像编辑节点第五、六个功能），名字照真机的 object_info
    'krea2/Krea2-depth-control-lora.safetensors',
    'krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors',
  ],
  // Krea2ControlLoRALoader 的下拉：控制类 LoRA 只有深度那一条（那台上 373 项里没有 pose 的），
  // 见 outputs/devcheck/w3-findings.md 第 2 节
  controlLoras: ['krea2/Krea2-depth-control-lora.safetensors'],
  // DepthAnythingV2Preprocessor 的 ckpt_name 下拉（comfyui_controlnet_aux）
  depthCkpt: ['depth_anything_v2_vitg.pth', 'depth_anything_v2_vitl.pth', 'depth_anything_v2_vitb.pth', 'depth_anything_v2_vits.pth'],
  // 生成视频那台的加速 LoRA（照 U37 那份工作流的双 LoRA），只挂在 LoraLoaderModelOnly 的下拉上，出图那边还是上面那一串。
  // 别的 LoRA 由测试自己通过接口传上去，扫描 /root/autodl-tmp/models/loras 加进来
  videoLoras: [
    'minimax/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',
    'minimax/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors',
  ],
  samplers: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde'],
  // beta57 是转真人那一档的调度器（不是习惯上的 simple），见 docs/krea2-real-usage.md 第 5 节
  schedulers: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'beta57'],
  // 反推那两个模型文件（llama.cpp 那台插件用的），照那台上的名字
  reverseModel: ['Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf'],
  reverseMmproj: ['mmproj-Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-f16.gguf'],
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
  LoraLoaderModelOnly: node({ model: ['MODEL'], lora_name: combo([...MODELS.loras, ...MODELS.videoLoras]), strength_model: ['FLOAT', {}] }, ['MODEL']),
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
  // SelfLift 接续那套（comfyui-SelfLift + H3 官方的 AddGuide 和视频节点），见 docs/dev-plan.md 5.32
  MiniMaxH3ReferenceToVideo: node(
    { clip: ['CLIP'], prompt: ['STRING', {}], width: ['INT', {}], height: ['INT', {}], length: ['INT', {}], ref_image_size: comboV3(['match', 'max']) },
    ['CONDITIONING', 'LATENT'],
    false,
    { vae: ['VAE'], audio_vae: ['VAE'], ref_images: ['IMAGE'], ref_videos: ['IMAGE'], ref_video_audios: ['AUDIO'], ref_audios: ['AUDIO'] },
  ),
  MiniMaxH3AddGuide: node({ positive: ['CONDITIONING'], latent: ['LATENT'], frame_idx: ['INT', {}] }, ['CONDITIONING'], false, {
    vae: ['VAE'],
    audio_vae: ['VAE'],
    image: ['IMAGE'],
    audio: ['AUDIO'],
  }),
  // 接缝声音羽化：作者那个插件（wjc573/ComfyUI-MiniMax-H3-Audio-Guide-Feather），刻度填 0 时程序不接它。
  // 型号照实例上的 spec：INT 0 到 256，默认 8
  MiniMaxH3AudioGuideFeather: node({ positive: ['CONDITIONING'], audio_feather_ticks: ['INT', { default: 8, min: 0, max: 256 }] }, ['CONDITIONING']),
  // 真节点这个下拉列的是 input 目录里的文件；接力那套的文件是程序拷进去的，假的这边就不查了（按名字给）
  LoadVideo: node({ file: ['STRING', {}] }, ['VIDEO']),
  ConcatenateVideo: node({}, ['VIDEO'], false, { codec: comboV3(['auto', 'h264', 'av1']) }),
  SaveVideo: node({ video: ['VIDEO'], filename_prefix: ['STRING', {}], format: comboV3(['auto', 'mp4', 'mkv', 'webm']) }, ['VIDEO'], true, { codec: comboV3(['auto', 'h264', 'av1']) }),
  CreateVideo: node({ images: ['IMAGE'], fps: ['FLOAT', {}] }, ['VIDEO'], false, {
    audio: ['AUDIO'],
    bit_depth: ['INT', {}],
    color_space: combo(['sRGB', 'HDR', 'HDR PQ']),
    codec: combo(['none', 'auto', 'h264', 'av1']),
  }),
  GetVideoComponents: node({ video: ['VIDEO'] }, ['IMAGE', 'AUDIO', 'FLOAT', 'STRING', 'STRING']),
  VideoFrameSample: node({ video: ['VIDEO'], num_frames: ['INT', {}], strategy: comboV3(['uniform', 'head', 'tail', 'random']), seed: ['INT', {}] }, ['VIDEO']),
  VideoTemporalCrop: node({ video: ['VIDEO'], start_frame: ['INT', {}], length: ['INT', {}] }, ['VIDEO']),
  GetImageRangeFromBatch: node({ start_index: ['INT', {}], num_frames: ['INT', {}] }, ['IMAGE', 'MASK'], false, { images: ['IMAGE'], masks: ['MASK'] }),
  ImageAddNoise: node({ image: ['IMAGE'], seed: ['INT', {}], strength: ['FLOAT', {}] }, ['IMAGE']),
  ImageBatchMulti: node({ inputcount: ['INT', {}], image_1: ['IMAGE'] }, ['IMAGE'], false, { image_2: ['IMAGE'] }),
  ColorTransfer: node(
    { image_target: ['IMAGE'], image_ref: ['IMAGE'], method: combo(['reinhard_lab', 'mkl_lab', 'histogram']), source_stats: comboV3(['per_frame', 'uniform', 'target_frame']), strength: ['FLOAT', {}] },
    ['IMAGE'],
    false,
    { target_index: ['INT', {}] },
  ),
  SelfLiftH3Sampler: node(
    {
      model: ['MODEL'],
      positive: ['CONDITIONING'],
      negative: ['CONDITIONING'],
      vae: ['VAE'],
      latent_image: ['LATENT'],
      sampler: ['SAMPLER'],
      sigmas: ['SIGMAS'],
      seed: ['INT', {}],
      cfg: ['FLOAT', {}],
      transition_step: ['INT', {}],
      lowres_scale: ['FLOAT', {}],
      rho: ['FLOAT', {}],
      w_min: ['FLOAT', {}],
      w_max: ['FLOAT', {}],
      upscaler_model: comboV3(['none', 'h3_upscaler_lms_v0.1_fp32.safetensors']),
    },
    ['LATENT'],
    false,
    { model_hires: ['MODEL'], highres_tiling: ['BOOLEAN', {}] },
  ),
  MMH3LatentKeyframe: node(
    { conditioning: ['CONDITIONING'], latent: ['LATENT'], target_frame_count: ['INT', {}], position: comboV3(['first', 'last']), source_frame: comboV3(['first', 'last']) },
    ['CONDITIONING'],
    false,
    { target_width: ['INT', {}], target_height: ['INT', {}] },
  ),
  MMH3ImageKeyframe: node(
    {
      conditioning: ['CONDITIONING'],
      image: ['IMAGE'],
      vae: ['VAE'],
      width: ['INT', {}],
      height: ['INT', {}],
      target_frame_count: ['INT', {}],
      frame_index: ['INT', {}],
      resize: comboV3(['auto', 'stretch', 'crop']),
    },
    ['CONDITIONING'],
  ),
  // 编辑档的双图（T07 名字里的那个）：`_b` 那一路是第二张参考图（主体），见 docs/dev-plan.md 5.34
  Krea2EditModelPatch: node({ model: ['MODEL'], source_latent: ['LATENT'] }, ['MODEL'], false, {
    target_latent: ['LATENT'],
    source_latent_b: ['LATENT'],
    source_image: ['IMAGE'],
    source_image_b: ['IMAGE'],
    vae: ['VAE'],
    ref_boost: ['FLOAT', {}],
    ref_boost_a: ['FLOAT', {}],
    fit_mode: combo(['fit', 'crop (legacy)']),
  }),
  Krea2EditGroundedEncode: node({ clip: ['CLIP'], prompt: ['STRING', { multiline: true }] }, ['CONDITIONING'], false, {
    image: ['IMAGE'],
    image_b: ['IMAGE'],
    grounding_px: ['INT', {}],
    system_prompt: ['STRING', {}],
  }),
  ImageResizeKJv2: node({ image: ['IMAGE'], width: ['INT', {}], height: ['INT', {}], upscale_method: combo(['lanczos']), keep_proportion: combo(['resize']), pad_color: ['STRING', {}], crop_position: combo(['center']), divisible_by: ['INT', {}] }, ['IMAGE'], false, { device: combo(['cpu', 'gpu']) }),
  // 编辑档走的那套（作者 Ostris 的），见 docs/dev-plan.md 5.34
  Krea2OstrisEditModelPatch: node({ model: ['MODEL'], kv_cache: ['BOOLEAN', {}] }, ['MODEL']),
  TextEncodeKrea2OstrisEdit: node({ clip: ['CLIP'], prompt: ['STRING', { multiline: true }] }, ['CONDITIONING'], false, {
    vae: ['VAE'],
    image1: ['IMAGE'],
    image2: ['IMAGE'],
    image3: ['IMAGE'],
  }),
  // ── 转真人那一档（图像编辑节点的「转真人」功能），见 docs/krea2-real-usage.md ──
  // 主图那个编码节点（cardenluo/easy_qwenEdit_2509）：出 正面 / 空负面 / 潜变量 三个。
  // image2 和三个强度是选填的（作者那份单图 JSON 里就没有），双图时才有 image2
  Easy_QwenEdit2509: node(
    {
      clip: ['CLIP'],
      vae: ['VAE'],
      image1: ['IMAGE'],
      latent_image: ['IMAGE'],
      auto_resize: combo(['crop', 'stretch', 'pad']),
      vl_size: ['INT', {}],
      prompt: ['STRING', { multiline: true }],
      system_prompt: ['STRING', { multiline: true }],
    },
    ['CONDITIONING', 'CONDITIONING', 'LATENT'],
    false,
    { image2: ['IMAGE'], image3: ['IMAGE'], image1_strength: ['FLOAT', {}], image2_strength: ['FLOAT', {}], image3_strength: ['FLOAT', {}] },
  ),
  // 参考潜变量的接法（ComfyUI 本体自带）：正面、负面各接一个，不是 ConditioningZeroOut
  FluxKontextMultiReferenceLatentMethod: node({ conditioning: ['CONDITIONING'], reference_latents_method: combo(['offset', 'index', 'index_timestep_zero']) }, ['CONDITIONING']),
  // 图 1 / 图 2 各先过它（作者实测饱和度 −20 出图更像照片）再缩放
  ColorCorrect: node(
    { image: ['IMAGE'], temperature: ['FLOAT', {}], hue: ['FLOAT', {}], brightness: ['FLOAT', {}], contrast: ['FLOAT', {}], saturation: ['FLOAT', {}], gamma: ['FLOAT', {}] },
    ['IMAGE'],
  ),
  // 反推那三个（lihaoyun6/ComfyUI-llama-cpp_vlm）：35B MoE 去审查 VLM 看图写词，
  // STRING 输出直接接 Easy_QwenEdit2509.prompt；反推关着时这张图里一个都不生成
  llama_cpp_model_loader: node({ model: combo(MODELS.reverseModel), mmproj: combo(MODELS.reverseMmproj), chat_handler: combo(['Qwen3.6', 'Qwen3-VL', 'Qwen2.5-VL']) }, ['LLAMA_MODEL'], false, {
    n_ctx: ['INT', {}],
    vram_limit: ['FLOAT', {}],
    image_min_tokens: ['INT', {}],
    image_max_tokens: ['INT', {}],
    load_mtp: ['BOOLEAN', {}],
  }),
  llama_cpp_parameters: node(
    {
      max_tokens: ['INT', {}],
      top_k: ['INT', {}],
      top_p: ['FLOAT', {}],
      min_p: ['FLOAT', {}],
      typical_p: ['FLOAT', {}],
      temperature: ['FLOAT', {}],
      repeat_penalty: ['FLOAT', {}],
      frequency_penalty: ['FLOAT', {}],
      present_penalty: ['FLOAT', {}],
      mirostat_mode: ['INT', {}],
      mirostat_eta: ['FLOAT', {}],
      mirostat_tau: ['FLOAT', {}],
      state_uid: ['INT', {}],
    },
    ['LLAMA_PARAMETERS'],
  ),
  llama_cpp_instruct_adv: node(
    {
      llama_model: ['LLAMA_MODEL'],
      parameters: ['LLAMA_PARAMETERS'],
      images: ['IMAGE'],
      system_prompt: ['STRING', { multiline: true }],
      preset_prompt: combo(['Empty - Nothing']),
      custom_prompt: ['STRING', { multiline: true }],
      inference_mode: combo(['one by one', 'images', 'video']),
      max_frames: ['INT', {}],
      max_size: ['INT', {}],
      seed: ['INT', {}],
      force_offload: ['BOOLEAN', {}],
      save_states: ['BOOLEAN', {}],
    },
    ['STRING'],
  ),
  // 按宽高比缩放（ComfyUI_LayerStyle）：出 IMAGE/MASK/BOX/宽/高
  'LayerUtility: ImageScaleByAspectRatio V2': node(
    {
      aspect_ratio: combo(['original', 'custom', '1:1', '3:2', '4:3', '16:9', '2:3', '3:4', '9:16']),
      proportional_width: ['INT', {}],
      proportional_height: ['INT', {}],
      fit: combo(['letterbox', 'crop', 'fill']),
      method: combo(['lanczos', 'bicubic', 'hamming', 'bilinear', 'box', 'nearest']),
      round_to_multiple: combo(['8', '16', '32', '64', '128', '256', '512', 'None']),
      scale_to_side: combo(['None', 'longest', 'shortest', 'width', 'height', 'total_pixel(kilo pixel)']),
      scale_to_length: ['INT', {}],
      background_color: ['STRING', {}],
    },
    ['IMAGE', 'MASK', 'BOX', 'INT', 'INT'],
    false,
    { image: ['IMAGE'], mask: ['MASK'] },
  ),
  GetImageSize: node({ image: ['IMAGE'] }, ['INT', 'INT']),
  // ── 深度迁移那一档（图像编辑节点的「深度迁移」功能），见 docs/dev-plan.md 5.36、packages/shared/src/krea2Depth.ts ──
  // 控制类三节点一组（facok/comfyui-krea2-controlnet）：LoRA 加载器 → (Apply 的 control_latent) → Apply → KSampler.model。
  // 输入口照那台实机的 object_info（outputs/devcheck/nodeinfo.json）；Krea2ControlImageEncode 的 latent 在真的那台上是选填的
  Krea2ControlLoRALoader: node({ model: ['MODEL'], lora_name: combo(MODELS.controlLoras), strength: ['FLOAT', { default: 1 }] }, ['MODEL']),
  Krea2ControlImageEncode: node(
    {
      control_image: ['IMAGE'],
      vae: ['VAE'],
      resize: combo(['keep_control_image_size', 'match_latent_size']),
      upscale_method: combo(['lanczos', 'bicubic', 'bilinear', 'area', 'nearest-exact']),
      crop: combo(['center', 'disabled']),
      channel_mode: combo(['rgb', 'grayscale']),
      normalize: combo(['none', 'per_image_minmax']),
      invert: ['BOOLEAN', { default: false }],
      batch_mode: combo(['independent_images', 'video_frames']),
    },
    ['LATENT', 'IMAGE'],
    false,
    { latent: ['LATENT'] },
  ),
  Krea2ControlApply: node({ model: ['MODEL'], control_latent: ['LATENT'] }, ['MODEL']),
  // 深度提取（comfyui_controlnet_aux）：ckpt_name 和 resolution 在真的那台上是选填的，默认 vitl / 512
  DepthAnythingV2Preprocessor: node({ image: ['IMAGE'] }, ['IMAGE'], false, { ckpt_name: combo(MODELS.depthCkpt), resolution: ['INT', { default: 512 }] }),
  // 风格 Remix / 换人那条用的（ComfyUI 本体，comfy_extras）：参考图按总像素缩到 384×384 那个预算
  ImageScaleToTotalPixels: node(
    { image: ['IMAGE'], upscale_method: combo(['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos']), megapixels: ['FLOAT', { default: 1 }], resolution_steps: ['INT', { default: 1 }] },
    ['IMAGE'],
  ),
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
  // 局部重绘，见 docs/dev-plan.md 5.35：底图和掩码是同一张 PNG，LoadImage 的第二个输出就是它的 alpha 通道。
  // 参数照真的那台（ComfyUI-Inpaint-CropAndStitch）
  InpaintCropImproved: node(
    {
      image: ['IMAGE'],
      downscale_algorithm: combo(['nearest', 'bilinear', 'bicubic', 'lanczos', 'box', 'hamming']),
      upscale_algorithm: combo(['nearest', 'bilinear', 'bicubic', 'lanczos', 'box', 'hamming']),
      preresize: ['BOOLEAN', {}],
      preresize_mode: combo(['ensure minimum resolution', 'ensure maximum resolution', 'ensure minimum and maximum resolution']),
      preresize_min_width: ['INT', {}],
      preresize_min_height: ['INT', {}],
      preresize_max_width: ['INT', {}],
      preresize_max_height: ['INT', {}],
      mask_fill_holes: ['BOOLEAN', {}],
      mask_expand_pixels: ['INT', {}],
      mask_invert: ['BOOLEAN', {}],
      mask_blend_pixels: ['INT', {}],
      mask_hipass_filter: ['FLOAT', {}],
      extend_for_outpainting: ['BOOLEAN', {}],
      extend_up_factor: ['FLOAT', {}],
      extend_down_factor: ['FLOAT', {}],
      extend_left_factor: ['FLOAT', {}],
      extend_right_factor: ['FLOAT', {}],
      context_from_mask_extend_factor: ['FLOAT', {}],
      output_resize_to_target_size: ['BOOLEAN', {}],
      output_target_width: ['INT', {}],
      output_target_height: ['INT', {}],
      output_padding: combo(['0', '8', '16', '32', '64', '128', '256', '512']),
      device_mode: combo(['cpu (compatible)', 'gpu (much faster)']),
    },
    ['STITCHER', 'IMAGE', 'MASK'],
    false,
    { mask: ['MASK'], optional_context_mask: ['MASK'] },
  ),
  InpaintModelConditioning: node(
    { positive: ['CONDITIONING'], negative: ['CONDITIONING'], vae: ['VAE'], pixels: ['IMAGE'], mask: ['MASK'], noise_mask: ['BOOLEAN', {}] },
    ['CONDITIONING', 'CONDITIONING', 'LATENT'],
  ),
  InpaintStitchImproved: node({ stitcher: ['STITCHER'], inpainted_image: ['IMAGE'] }, ['IMAGE']),
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
  UNETLoader: node({ unet_name: combo([...MODELS.unet, 'krea2/darkBeastINT8Convrot2_krea211INT8Convrot.safetensors', 'krea/krea2_turbo_int8_convrot.safetensors', 'krea2/krea2_turbo_int8_convrot.safetensors', 'krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors', 'krea2/krea2_turbo_fp8_scaled.safetensors']), weight_dtype: combo(['default', 'fp8_e4m3fn', 'fp8_e4m3fn_fast', 'fp8_e5m2']) }, ['MODEL']),
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
    if (findNode(graph, 'SelfLiftH3Sampler') || findNode(graph, 'ConcatenateVideo')) return runSelfLift(task);
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
      // 转真人开着反推时，反推那个节点的 STRING 输出也记进历史（真的那台上是模型现写的那句提示词）
      const instruct = findNode(graph, 'llama_cpp_instruct_adv');
      const outputs: HistoryEntry['outputs'] = { [outputId]: { images: [ref] }, ...(instruct && { [instruct]: { text: [REVERSE_TEXT] } }) };
      record(task, outputs, true, [...run.started, ['execution_success', success]]);
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
    // 存文件的节点有两个：接一采的那个是低清预览（比二采先跑完），接二采的才是成片
    const saves = of('MMH3StreamingSave');
    const previewId = saves.find((id) => linked(graph, graph[id].inputs.latent) === graph[pass1]);
    const saveId = saves.find((id) => id !== previewId) ?? pass2 ?? pass1;
    const refOf = (prefix: string) => {
      const slash = prefix.lastIndexOf('/');
      videoCounter += 1;
      const ref = { filename: `${prefix.slice(slash + 1)}_${String(videoCounter).padStart(5, '0')}.mp4`, subfolder: prefix.slice(0, Math.max(0, slash)), type: 'output' };
      videos.add(ref.filename);
      return ref;
    };
    const prefixOf = (id: string) => String(graph[id]?.inputs.filename_prefix ?? 'video');
    // 预览这一份现在就占好名字，一采一完就推出去
    const preview = previewId ? refOf(prefixOf(previewId)) : null;
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
        // 一采完了：低清预览先出，二采接着跑
        if (preview && previewId) events.push(['executed', { node: previewId, display_node: previewId, output: { images: [preview], animated: [true] }, prompt_id: task.id }]);
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
      const ref = refOf(prefixOf(saveId));
      const output = { images: [ref], animated: [true] };
      const outputs: HistoryEntry['outputs'] = { [saveId]: output };
      if (previewId && preview) outputs[previewId] = { images: [preview], animated: [true] };
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

  // SelfLift 接续那套，见 docs/dev-plan.md 5.32：一段一个任务，先编码提示词，跑 SelfLiftH3Sampler 接的
  // BasicScheduler 的步数那么多步，再解码、剪、对齐颜色、存成这一段；最后拼起来那一条是
  // LoadVideo 各段 → ConcatenateVideo → SaveVideo，也走这里。
  // 提示词含「慢」「报错」「显存」的规矩同出图，出错在第 2 步
  function runSelfLift(task: Task) {
    const { graph } = task;
    const of = (type: string) =>
      Object.keys(graph)
        .filter((id) => graph[id].class_type === type)
        .sort((a, b) => Number(a) - Number(b));
    const merge = of('ConcatenateVideo')[0];
    const encodeId = merge ? undefined : of('MiniMaxH3ReferenceToVideo')[0] ?? of('MMH3ReferenceMultiPrompt')[0];
    const text = String(graph[encodeId ?? '']?.inputs.prompt ?? graph[encodeId ?? '']?.inputs.prompts ?? '');
    const wait = text.includes('慢') ? slowStepMs : videoStepMs;
    const failure = text.includes('显存')
      ? 'CUDA out of memory. Tried to allocate 20.00 GiB'
      : text.includes('报错')
        ? 'mock-comfyui：提示词含「报错」，按约定出错'
        : null;
    const sampler = of('SelfLiftH3Sampler')[0];
    const steps = Number(linked(graph, graph[sampler]?.inputs.sigmas)?.inputs.steps ?? 8);
    // 拼起来那一条：把各段的名字写进历史，测试能看出拼的是哪几段
    const loads = of('LoadVideo');
    const saveId = of('SaveVideo')[0] ?? sampler ?? encodeId!;
    const refOf = (prefix: string) => {
      const slash = prefix.lastIndexOf('/');
      videoCounter += 1;
      const ref = { filename: `${prefix.slice(slash + 1)}_${String(videoCounter).padStart(5, '0')}.mp4`, subfolder: prefix.slice(0, Math.max(0, slash)), type: 'output' };
      videos.add(ref.filename);
      // 那台上的 output 目录里也落一份：接力那套要把上一段拷进 input 目录，假的 SSH 也得拷得到
      const target = ssh.local(`/root/ComfyUI/output/${ref.subfolder ? `${ref.subfolder}/` : ''}${ref.filename}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, VIDEO);
      return ref;
    };
    const prefixOf = (id: string) => String(graph[id]?.inputs.filename_prefix ?? 'video');
    const events: [string, Record<string, unknown>][] = [];
    const executing = (id: string | undefined) => {
      if (id) events.push(['executing', { node: id, display_node: id, prompt_id: task.id }]);
    };
    executing(encodeId);
    executing(of('UNETLoader')[0]);
    for (const [index, id] of loads.entries()) if (index < 3) executing(id);
    executing(merge);
    if (sampler) executing(sampler);
    for (let step = 1; step <= steps; step += 1) events.push(['progress', { value: step, max: steps, prompt_id: task.id, node: sampler }]);
    executing(of('VAEDecode')[0]);
    executing(of('MiniMaxH3AudioGuideFeather')[0]);
    executing(of('ColorTransfer')[0]);
    executing(saveId);

    const start = { prompt_id: task.id, timestamp: Date.now() };
    const run: Run = { task, samplerId: sampler ?? saveId, started: [['execution_start', start]] };
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
      if (failure && sampler && type === 'progress' && data.value === 2) {
        const error = {
          prompt_id: task.id,
          node_id: sampler,
          node_type: 'SelfLiftH3Sampler',
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
      const ref = refOf(prefixOf(saveId));
      const output = { images: [ref], animated: [true] };
      const outputs: HistoryEntry['outputs'] = { [saveId]: output };
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

  // 测试用：假的 AutoDL 两台都回到关着、那台上的模型和存档清掉、开机关机和命令记录清空。
  // 这些都是这个进程里留着的，跨用例、跨轮次都在，e2e 每个文件开头清一次，两轮连着跑才对得上
  app.post('/_reset', (_req, res) => {
    autodl.reset();
    ssh.reset();
    res.status(204).end();
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
