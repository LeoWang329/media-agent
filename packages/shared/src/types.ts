// 工作文件夹 model-configs.json 里的一项，不含 key
// 每百万 tokens 的价格，用来算每条回复花了多少钱；cached 是命中缓存那部分输入的价
export type ModelPricing = { currency: '¥' | '$'; input: number; output: number; cached: number };

// 思考档位；用途是写提示词（节点里聊天）、翻译、转标签，各自能跟总档位或单独选一档
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';
export type ThinkingUse = 'chat' | 'translate' | 'tagging';
export type ThinkingSettings = { level: ThinkingLevel } & Record<ThinkingUse, ThinkingLevel | 'follow'>;

// 节点对话发给模型时最多带几轮：all 是全带，数字是只带最近几轮，见 docs/dev-plan.md 5.4
export type TurnLimit = 'all' | number;

// 这家接口开思考的写法，见 docs/dev-plan.md 5.12
export type ThinkingStyle = 'none' | 'reasoning-effort' | 'enable-thinking' | 'thinking-type' | 'model-switch';

export type ModelConfig = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  imageLongSide: number;
  pricing: ModelPricing;
  thinkingStyle: ThinkingStyle;
  thinkingModel: string; // thinkingStyle 是 model-switch 时，开思考用的模型名
};

// 生图底模的系列
export type Family = 'IL' | 'Pony' | 'Krea2';

// 出图用哪台 ComfyUI：局域网那台，或者 AutoDL 上租的实例
export type ComfyTarget = 'lan' | 'autodl';

// AutoDL 选了哪个实例（没选是 null）、空闲多久自动关机（分钟）
export type AutodlSettings = { instanceUuid: string | null; idleMinutes: number };

// 工作文件夹 settings.json，两台机器共用：思考档位、对话最多带几轮、局域网 ComfyUI 地址和 AutoDL 实例（出图的、生成视频的）、底模属于哪个系列（底模文件名 → 系列，null 是两个都不是）、各系列的默认出图参数
export type SharedSettings = {
  thinking: ThinkingSettings;
  turnLimit: TurnLimit;
  comfy: { lanUrl: string | null; autodl: AutodlSettings; videoAutodl: AutodlSettings };
  checkpoints: Record<string, Family | null>;
  defaults: Record<Family, FamilyDefaults>;
};

// 系统提示词开头说明段里写的用途和底模系列；body 是去掉说明段的部分，见 docs/dev-plan.md 5.14
export type PromptMeta = { use: 'video' | 'image'; family: Family | null; body: string };

// GET /api/prompts 列表里的一项
export type PromptInfo = { name: string; use: PromptMeta['use']; family: Family | null };

// 节点是视频节点还是生图节点，和系统提示词的两种用途对应，见 docs/dev-plan.md 5.23
export type NodeKind = PromptMeta['use'];

// 两份固定格式要求：视频节点的、生图节点的
export type FormatRequirements = { video: string; image: string; krea2: string };

// 一个系列的默认值：固定开头、默认负面词、三档评级在这个系列里怎么写、出图参数，见 docs/dev-plan.md 5.18。
// 用哪个放大、检测模型不在这里，由预设管
export type FamilyDefaults = {
  prefix: string;
  negative: string;
  rating: { general: string; sensitive: string; explicit: string };
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  clipSkip: number;
};

// 词库里的一个标签；tag 是 Danbooru 的写法（小写、下划线），category 0 通用、1 画师、3 作品、4 角色、5 元标签。
// alias 是靠哪个别名或叫法对上的
export type TagHit = { tag: string; zh: string; category: number; count: number; alias?: string };

// 校验一个标签：认识、是别名（tag 是标准名）、不认识（给最接近的几个）
export type TagCheck = {
  input: string;
  status: 'ok' | 'alias' | 'unknown';
  tag?: string;
  zh?: string;
  category?: number;
  count?: number;
  suggestions?: TagHit[];
};

// 词库是哪天的、多少个标签、多少个有中文
// 词库概况：标签和有中文的不算已废弃的；zhByUse 是按使用次数算有中文的比例（0 到 1）；aliases 是用得上的官方别名条数
export type TagInfo = { updatedAt: string | null; tags: number; withZh: number; zhByUse: number; aliases: number };

// 让模型把一句中文转成标签：text 是模型回的那串，checks 和 splitTags(text) 一一对应
export type TagConvertResult = { text: string; checks: TagCheck[] };

// 片段：一小串常用标签，存在工作文件夹 fragments.json，见 docs/dev-plan.md 5.16
export type FragmentCategory = 'character' | 'style' | 'quality' | 'other';
export type Fragment = {
  id: string;
  name: string;
  category: FragmentCategory;
  text: string; // 写法和提示词框里一样
  createdAt: string;
  updatedAt: string;
};

// 更新词库时推给前端的事件
export type TagUpdateEvent =
  | { type: 'progress'; step: 'tags' | 'aliases'; page: number; rows: number }
  | { type: 'progress'; step: 'zh'; file: number; files: number }
  | { type: 'done'; info: TagInfo }
  | { type: 'stopped' }
  | { type: 'error'; message: string };

export type ModelConfigWithKey = ModelConfig & { apiKey: string };

// GET/PUT /api/config 的数据：模型配置来自工作文件夹，key 来自本机。
// 出图用哪台 ComfyUI 和 AutoDL 的开发者 Token 也只记在本机，Token 在 GET 时打码
export type Config = {
  workFolder: string | null;
  modelConfigs: ModelConfigWithKey[];
  assetFolders: string[];
  lastCollageFolder: string | null;
  lastDownloadFolder: string | null;
  comfyTarget: ComfyTarget;
  autodlToken: string | null;
};

// 生图节点的出图设置，存在 node.image，见 docs/dev-plan.md 5.14。
// vae、weighting、loraTarget 和部位重绘的 sam 是 E02 的几样（5.21）：VAE 空着是用底模自带的；
// weighting 是带权重的标签怎么算，comfy 是 ComfyUI 自带的，a1111 是 A1111 的；loraTarget 是 LoRA 作用在哪，both 是画图的模型和文字理解都作用，model 是只作用在画图的模型上
export type ImageRating = 'none' | 'general' | 'sensitive' | 'explicit';
export type TagWeighting = 'comfy' | 'a1111';
export type LoraTarget = 'both' | 'model';
export type ImageSettings = {
  textEncoder?: string;
  krea?: KreaSettings;
  width: number; // 宽高是九档之一，或者自己填的 8 的倍数
  height: number;
  count: number; // 一次出几张，1 到 8
  workflowId: string | null; // null 是内置流程
  checkpoint: string;
  vae: string;
  loras: { name: string; strength: number }[];
  loraTarget: LoraTarget;
  weighting: TagWeighting;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number | null; // null 是每次随机
  rating: ImageRating;
  negativeExtra: string; // 接在系列默认负面词后面
  upscale: UpscaleSettings;
  details: DetailPass[]; // 部位重绘，按顺序做
  controls: ControlSettings[]; // ControlNet，按顺序接
};

// 放大，像 WebUI 的高清修复，见 docs/dev-plan.md 5.21：先用放大模型放大，缩到出图尺寸乘倍数；denoise 是 0 时不重画
export type UpscaleSettings = { on: boolean; model: string; scale: number; denoise: number };

// 部位重绘的一道，像 WebUI 的 ADetailer：detector 是检测模型，bbox/ 下的重画整个框，segm/ 下的只重画轮廓里面；
// sam 是用哪个 SAM 模型把框收成形状，空着是不用；
// guideSize 是检测到的地方放大到多大再画；positive 写了换掉框里的标签，negative 写了换掉额外的负面词
export type DetailPass = {
  on: boolean;
  detector: string;
  sam: string;
  threshold: number;
  denoise: number;
  guideSize: number;
  positive: string;
  negative: string;
};

// ControlNet 的一个，像 WebUI，见 docs/dev-plan.md 5.21。type 是姿势、深度、线稿、边缘、其他；
// image 是参考图：槽位里的图，或者这个节点出过的图（那一组的 id 和那张的种子），没选是 null；
// preprocessor 是 AIO_Preprocessor 列表里的提取方式，none 是不提取、直接用这张；model 是 ControlNetLoader 的文件名，空着是还没选
export type ControlType = 'pose' | 'depth' | 'lineart' | 'edge' | 'other';
export type RefImage = { kind: 'slot'; imageId: string } | { kind: 'generated'; messageId: string; jobId: string; seed: number };
export type KreaSettings = { mode: 'text' | 'four-view'; reference: RefImage | null; refBoost: number; extra: string };
export type ControlSettings = {
  on: boolean;
  type: ControlType;
  image: RefImage | null;
  preprocessor: string;
  model: string;
  strength: number;
  start: number;
  end: number;
};

// 预设：出图设置整套存一个名字，存在工作文件夹 image-presets.json，按系列分开，见 docs/dev-plan.md 5.21
export type PresetSettings = Omit<ImageSettings, 'count' | 'seed'>;
export type ImagePreset = { id: string; name: string; family: Family; settings: PresetSettings; createdAt: string; updatedAt: string };

// ComfyUI 的 API 格式：节点号 → 节点类型和输入；连线写成 [节点号, 第几个输出]。导出来的还带着 _meta.title，是节点在界面上的标题
export type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

// 导入的工作流往哪填：哪个节点的哪一项，见 docs/dev-plan.md 5.18。正面一定要有，别的可以不填
export type FillTarget = { node: string; input: string };
export type WorkflowFill = { positive: FillTarget; negative: FillTarget | null; seed: FillTarget | null; width: FillTarget | null; height: FillTarget | null };

// 导入的工作流，存在工作文件夹 workflows/<id>.json；file 是导入时的文件名，hash 按 graph 算
export type ImportedWorkflow = {
  id: string;
  name: string;
  file: string;
  hash: string;
  importedAt: string;
  graph: ComfyGraph;
  fill: WorkflowFill;
};

// 发给 ComfyUI 的全部参数，「同样参数再来」照这个发；positive、negative 是最终发出去的，含固定开头和默认负面词。
// 用导入的工作流时没有底模到 clip skip 这几项，照工作流里原来的。
// 出完的图上补做的，宽高是原图的。放大、部位重绘、ControlNet 开着的才记；部位重绘的 positive、negative 是拼好的，空着是和原图一样。
// VAE、权重算法、LoRA 作用在哪不是默认的才记
export type ImageJobParams = {
  textEncoder?: string;
  krea?: KreaSettings;
  family: Family;
  positive: string;
  negative: string;
  workflow: { id: string | null; name: string; hash: string };
  width: number;
  height: number;
  checkpoint?: string;
  vae?: string;
  loras?: { name: string; strength: number }[];
  loraTarget?: LoraTarget;
  weighting?: TagWeighting;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  clipSkip?: number;
  upscale?: UpscaleSettings;
  details?: DetailPass[];
  controls?: ControlSettings[];
};

// 一组里的一张图，对应 ComfyUI 上的一个任务。file 是临时文件夹里的图，相对工作文件夹、用 / 隔开；ms 是出图用了多久；savedPath 是下载到哪
export type JobImage = {
  seed: number;
  promptId?: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  file?: string;
  width?: number;
  height?: number;
  ms?: number;
  savedPath?: string;
  starred?: boolean;
  error?: string;
};

// 点一次「生图」出的一组，挂在 assistant 消息的 images 里，见 docs/dev-plan.md 5.19。
// kind 是 refine 的是出完的图上补做放大和部位重绘（5.21），source 是补做的那张。
// 别的 source 是照着哪张图出的（「同样参数再来」「只换种子再来」）：那一组的 id 和那张的种子，种子一样就是同样参数再来。
// rev 每改一次加一：推送和请求的回复谁先到不一定，前端拿它丢掉旧的
export type ImageJob = {
  id: string;
  rev?: number;
  promptIndex: number;
  createdAt: string;
  kind: 'txt2img' | 'refine' | 'four-view';
  source?: { kind: 'generated'; jobId: string; seed: number };
  target: ComfyTarget;
  params: ImageJobParams;
  images: JobImage[];
};

// GET /api/image-jobs/events 推的事件：一组里有一张状态变了就发整组；进度和排在第几不存盘；AutoDL 实例的状态变了发整个状态
export type ImageJobEvent =
  | { type: 'job'; canvasId: string; nodeId: string; messageId: string; job: ImageJob }
  | { type: 'progress'; jobId: string; index: number; step: number; total: number }
  | { type: 'queue'; jobId: string; index: number; position: number }
  | ({ type: 'autodl' } & AutodlState);

// AutoDL 账号下的一个实例：设置里选，顶上的状态里显示。price 是每小时多少元，读不到是 null；startedAt 是开着时从什么时候开的，stoppedAt 是关着时从什么时候关的
export type AutodlInstance = {
  uuid: string;
  name: string;
  region: string;
  gpu: string;
  price: number | null;
  status: string;
  startedAt: string | null;
  stoppedAt: string | null;
};

// AutoDL 实例现在怎样，见 docs/dev-plan.md 5.17。
// unset 是还没填 Token 或没选实例；unknown 是查不到，原因在 error；failed 是程序开机没开成，原因在 error，下次开机前一直留着。
// raw 是 AutoDL 返回的状态原文；since 是这次开机从什么时候开始等；upSince 是从什么时候开着的；
// idleLeftMs 是还有多久自动关机，程序这边在用它（busyWith 不空）或者没开着是 null；busyWith 是程序这边正在用它做什么：出图、传模型、生成视频；
// byApp 是这次开机是程序开的
export type AutodlBusy = 'images' | 'models' | 'videos';
export type AutodlState = {
  state: 'unset' | 'unknown' | 'off' | 'booting' | 'running' | 'stopping' | 'failed';
  raw: string | null;
  since: number | null;
  upSince: number | null;
  idleLeftMs: number | null;
  idleMinutes: number;
  busyWith: AutodlBusy[];
  byApp: boolean;
  error: string | null;
  instance: AutodlInstance | null;
};

// 视频节点的生成设置，存在 node.video，见 docs/dev-plan.md 5.27：一采大小（百万像素）、放大倍数、种子（null 是每次随机）、
// 主模型（生成视频那台 minimax/ 下的文件名）、挂的 LoRA（各带强度，只作用在主模型上）、加速还是不加速（定一采、二采每段几步）
export type VideoLora = { name: string; strength: number };
export type VideoSpeed = 'fast' | 'full';
export type VideoSettings = { megapixels: number; upscale: number; seed: number | null; model: string; loras: VideoLora[]; speed: VideoSpeed };

// 生成视频发出去的全部参数，「同样参数再来」照这个发，见 docs/dev-plan.md 5.26。
// seconds 是写这条回复时的时长；frames 是整条、每段、相邻两段重叠几帧；width、height 是一采的，finalWidth、finalHeight 是出片的。
// aspectRatio 是 image 时宽高按首帧图的比例算；refs 是当参考图的槽位图 id，按 <Picture N> 的顺序；firstFrame 是钉在第 0 帧的那张
export type VideoJobParams = {
  segments: string[];
  seconds: number;
  frames: { total: number; chunk: number; overlap: number };
  aspectRatio: Exclude<AspectRatio, 'auto'> | 'image';
  refs?: string[];
  firstFrame?: string;
  megapixels: number;
  width: number;
  height: number;
  upscale: number;
  finalWidth: number;
  finalHeight: number;
  model: string;
  loras?: VideoLora[];
  steps?: { pass1: number; pass2: number }; // 一采、二采每段几步；以前出的没记，按加速的算
  media?: VideoMedia[]; // 带的视频和音频，按接进流程的顺序，见 docs/dev-plan.md 5.31
};

// 视频和音频参考，见 docs/dev-plan.md 5.31。放进画布的视频、音频存在画布的 media.json 里，键是 id；
// seconds 是多长，宽高和有没有声音只有视频有，都是放进来时浏览器读的；从文件夹拖进来的 originalPath 是空的
export type MediaKind = 'video' | 'audio';
export type MediaRecord = {
  id: string;
  sha256: string;
  kind: MediaKind;
  ext: string;
  originalPath: string;
  originalName: string;
  seconds: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  bytes: number;
  addedAt: string;
};

// 视频怎么用：只用画面、画面和声音、只用声音；音频怎么用：声音参考、配音
export type VideoUse = 'picture' | 'both' | 'sound';
export type AudioUse = 'voice' | 'dub';

// 节点的视频、音频槽位一格：seconds 是这个文件多长，start 是从第几秒开始取；frame 是截给写提示词的模型看的那一帧，存成画布里的一张图
// 视频的 end 是取到第几秒，没填的取到这段结束（参考的最多 15 秒）
export type MediaSlot =
  | { kind: 'video'; mediaId: string; seconds: number; start: number; end?: number; use: VideoUse; frame?: string }
  | { kind: 'audio'; mediaId: string; seconds: number; start: number; use: AudioUse };

// 发给模型的截帧：<Video N> 的那一帧
export type FrameAttachment = { video: number; imageId: string };

// 一条视频带的一段视频或音频：take 是取多少秒；宽高是视频的，读的时候按它缩
export type VideoMedia = { kind: MediaKind; mediaId: string; use: VideoUse | AudioUse; start: number; take: number; width?: number; height?: number };

// 一条视频在生成视频那台上存的一采、二采结果（output/MiniMaxH3/latent_checkpoints/ 下的文件名），重拍一截时读回来；instance 是存在哪台实例上，见 docs/dev-plan.md 5.30
export type VideoLatents = { pass1: string; pass2: string; instance: string };

// 点一次「生成视频」出的一条，挂在 assistant 消息的 videos 里，见 docs/dev-plan.md 5.27。
// source 是照着哪条再来的；file 是临时文件夹里的视频，相对工作文件夹、用 / 隔开；bytes 是文件多大，ms 是从开始跑到出完用了多久，savedPath 是下载到哪。
// 重拍一截出的是原来那条的一个版本：parent 是原片的 id，reshoot 是在哪一版上重拍、重拍第几帧到第几帧（不含），见 5.30。
// rev 每改一次加一，前端拿它丢掉旧的
export type VideoJob = {
  id: string;
  rev?: number;
  promptIndex: number;
  createdAt: string;
  source?: { jobId: string };
  parent?: string;
  reshoot?: { base: string; from: number; to: number };
  latents?: VideoLatents;
  params: VideoJobParams;
  seed: number;
  promptId?: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  file?: string;
  bytes?: number;
  ms?: number;
  savedPath?: string;
  error?: string;
};

// 生成视频在做哪一步：编码提示词、一采、放大、二采、存文件
export type VideoStage = 'encode' | 'pass1' | 'upscale' | 'pass2' | 'save';

// 出完一条记下各步用了多久，存工作文件夹 video-timings.json，估还要多久用，见 docs/dev-plan.md 5.29。
// 一采、二采记的是每一步多久（这一遍的总时间除以段数乘每段步数）；at 是什么时候出完的
export type VideoTiming = {
  at: string;
  finalWidth: number;
  finalHeight: number;
  segments: number;
  encodeMs: number;
  pass1StepMs: number;
  upscaleMs: number;
  pass2StepMs: number;
  saveMs: number;
};

// 视频任务小窗里的一条：在哪个画布、哪个节点，带上名字
export type VideoTask = { canvasId: string; canvasTitle: string; nodeId: string; nodeTitle: string; messageId: string; job: VideoJob };

// GET /api/video-jobs：在做的和排着的按点生成的先后，这次开程序以后完了的新的在前、最多 10 条，还有估时间用的记录
export type VideoBoard = { live: VideoTask[]; done: VideoTask[]; timings: VideoTiming[] };

// GET /api/video-jobs/events 推的事件：一条的状态变了发整条，删掉了发 removed；进度和排在第几不存盘，chunk 从 1 数，还没到一采、二采时是 0；
// since 是这一步从什么时候开始的；生成视频那台的状态变了发整个状态
export type VideoJobEvent =
  | { type: 'job'; canvasId: string; nodeId: string; messageId: string; job: VideoJob }
  | { type: 'removed'; canvasId: string; nodeId: string; messageId: string; jobId: string }
  | { type: 'progress'; jobId: string; stage: VideoStage; chunk: number; chunks: number; step: number; steps: number; since: number }
  | { type: 'queue'; jobId: string; position: number }
  | ({ type: 'autodl' } & AutodlState);

// 出完的一张图在哪：哪条回复、哪一组、第几张。卡片和首页拿它拼缩略图的地址
export type GeneratedRef = { messageId: string; jobId: string; index: number; seed: number; starred: boolean };

// 卡片上生图节点出图的情况：最近出的几张；正在出的几组一共出完几张、一共几张，boot 是有发给 AutoDL 的还没发出去（在等开机）；最近一组是不是全失败了
export type CardGenerated = { images: GeneratedRef[]; live: { done: number; total: number; boot: boolean } | null; failed: boolean };

// 一张出的图的文件现在在哪：临时文件夹里的、下载的那份，不在了是 null
export type ImageWhere = { temp: string | null; saved: string | null };

// 设置里「出的图」：临时文件夹、按日期分的子文件夹各有几张多大、上次下载到哪
export type ImageTempInfo = {
  path: string;
  days: { name: string; count: number; bytes: number }[];
  lastDownload: { folder: string; inLibrary: boolean } | null;
};

// 测试连接的结果：ComfyUI 版本、显卡、显存（字节）
export type ComfyStatus =
  | { ok: true; url: string; version: string; gpu: string; vramTotal: number; vramFree: number }
  | { ok: false; url: string | null; error: string };

// 从 ComfyUI 读到的下拉选项；底模带着属于哪个系列（null 是两个都不是），guessed 是没在设置里标过、按文件名猜的。
// detectors 是部位重绘用的检测模型，只列 .pt 的（同一个文件夹里放的 SAM 这类不是），sams 是 SAMLoader 的列表。preprocessors 是 ControlNet 的提取方式（AIO_Preprocessor 的列表）。
// nodeTypes 是这台装了的全部节点类型，用来查缺不缺插件
// 生成视频那台上能选的主模型（minimax/ 下的）和 LoRA，见 docs/dev-plan.md 5.27
export type VideoOptions = { models: string[]; loras: string[] };

export type ComfyOptions = {
  kreaModels: string[];
  textEncoders: string[];
  checkpoints: { name: string; family: Family | null; guessed: boolean }[];
  vaes: string[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
  upscaleModels: string[];
  detectors: string[];
  sams: string[];
  controlnets: string[];
  preprocessors: string[];
  ipadapters: string[];
  clipVisions: string[];
  taggers: string[];
  nodeTypes: string[];
};

// 往 AutoDL 那台传的模型，见 docs/dev-plan.md 5.22。都不存盘，从那台上现读。
// path 是相对这一类的文件夹，比如 IL/xxx.safetensors；partial 是 .part 结尾的，没传完、没下完
export type ModelKind = 'checkpoint' | 'lora' | 'upscale' | 'bbox' | 'segm' | 'controlnet' | 'ipadapter' | 'clipVision' | 'vae';
export type RemoteModelFile = { kind: ModelKind; path: string; bytes: number; modifiedAt: string; partial: boolean };
export type RemoteModels = { free: number; files: RemoteModelFile[] };

// 在传的和排着的，只在服务的内存里。done、total 是字节，给链接的取不到大小时 total 是 null
export type ModelTransfer = {
  id: string;
  way: 'upload' | 'download';
  kind: ModelKind;
  path: string;
  url?: string;
  done: number;
  total: number | null;
  state: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  error?: string;
};

export type AspectRatio = 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

export type CanvasNodeLayout = { id: string; x: number; y: number; collapsed: boolean };

export type Canvas = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: CanvasNodeLayout[]; // 连线由 ChatNode.parentNodeId 决定，不单独存
};

export type Attachment = { picture: number; imageId: string };

// 放进过槽位的图，存在画布文件夹 images.json 里，键是 id
export type ImageRecord = {
  id: string;
  sha256: string;
  ext: 'jpg' | 'png' | 'webp';
  originalPath: string;
  originalName: string;
  width: number; // 处理后的尺寸
  height: number;
  processed: null | { reason: 'too-large' | 'too-small' | 'file-too-big'; originalWidth: number; originalHeight: number };
  addedAt: string;
};

// 资产库里的一个文件；supported 为假的（heic 等）只显示不能用；kind 是图、视频还是音频
export type AssetFile = { path: string; name: string; size: number; mtime: number; supported: boolean; kind: 'image' | MediaKind };
// 资产库的排法：修改时间新的在前、旧的在前，文件名 A 到 Z、Z 到 A，见 docs/dev-plan.md 6.3
export type AssetSort = 'time-desc' | 'time-asc' | 'name-asc' | 'name-desc';

// 资产库文件夹树，只含文件夹；count 是这个文件夹里（含子文件夹）列得出来的图片张数
export type FolderTree = { path: string; name: string; count: number; children: FolderTree[] };

export type PromptBox = { index: number; label?: string; text: string; summary: string };

export type TranslateLanguage = '英文' | '中文' | '日文' | '韩文';

// 提示词框的译文。同一个框同一种语言只留最新一份；instruction 是翻译时写的要求，没写是空字符串
export type PromptTranslation = {
  promptIndex: number;
  language: TranslateLanguage;
  instruction: string;
  text: string;
  createdAt: string;
  modelConfigId: string;
  modelName: string;
  usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number };
};

export type Message = {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant';
  createdAt: string;
  text: string; // user：用户输入；assistant：模型原始回复
  slotSnapshot: string[];
  duration: number;
  aspectRatio: AspectRatio;
  mediaSnapshot?: MediaSlot[]; // 发出、生成时的视频和音频槽位；没有是空
  // 只有 user 消息有
  systemNote?: string;
  attachments?: Attachment[];
  frames?: FrameAttachment[]; // 发给模型的视频截帧
  // 只有 assistant 消息有
  modelConfigId?: string;
  modelName?: string;
  systemPromptName?: string;
  systemPromptHash?: string;
  parsed?: { title?: string; prompts: PromptBox[] };
  stars?: number[];
  translations?: PromptTranslation[];
  editedFromMessageId?: string;
  handwritten?: boolean; // 自己写的框（生图节点的「写标签」），没调模型
  videos?: VideoJob[]; // 视频节点生成的视频，按点生成的先后排
  usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number };
  error?: string; // 生成失败时的错误，text 为空
  stopped?: boolean; // 生成到一半被叫停，text 是叫停前收到的部分
  reasoning?: string; // 接口发回来的思考原文
  thinkingMs?: number; // 从发出请求到收到第一个正文字的毫秒数；没开思考、也没收到思考原文时没有
  images?: ImageJob[]; // 生图节点出的图，按点生图的先后排
  trimmed?: { kept: number; dropped: number }; // 只带了最近几轮时才有：带了几轮、前面几轮没带
};

// 画布上的一个节点，就是一段对话
export type ChatNode = {
  id: string;
  canvasId: string;
  title: string;
  titleIsManual: boolean;
  parentNodeId: string | null;
  forkedFromMessageId: string | null;
  copiedCount?: number; // 岔出时从原节点复制来几条消息（之前岔出的节点没记）
  modelConfigId: string;
  kind: NodeKind; // 建的时候定，之后不能改；没记的老节点读的时候按系统提示词补上
  systemPromptName: string; // 只能是这种节点用的
  slots: string[];
  media?: MediaSlot[]; // 视频和音频槽位，只有视频节点有；没有是空
  duration: number;
  aspectRatio: AspectRatio;
  messages: Record<string, Message>;
  rootIds: string[];
  activeChildOf: Record<string, string>; // 键是父消息 id（顶层用 'root'），值是当前显示的版本
  draft: string;
  image?: ImageSettings; // 生图节点改过出图设置才有；没有时按系列的默认值
  video?: VideoSettings; // 视频节点改过生成设置才有；没有时用默认值
  turnLimit?: TurnLimit | 'follow'; // 这个节点自己设的最多带几轮；没有或 follow 是跟设置
  createdAt: string;
  updatedAt: string;
};

// 首页的一个画布：updatedAt 算上了里面节点动过的时间；cover 是最近放进槽位的那张图的 id，没放过图时为 null；
// generating 是正在生成回复的节点数，stars 是打过星的节点数
export type HomeCanvas = {
  id: string;
  title: string;
  updatedAt: string;
  nodeCount: number;
  cover: string | null;
  generating: number;
  stars: number;
};

// 卡片上生图节点那一行：尺寸和系列。视频节点是 null
export type CardImageInfo = { family: Family | null; width: number; height: number } | null;

// 首页「最近动过的节点」里的一个；error 是当前路径最后一条回复失败的原因
export type HomeNode = {
  id: string;
  canvasId: string;
  title: string;
  summary: string;
  directionCount: number;
  slots: string[];
  duration: number;
  aspectRatio: AspectRatio;
  image: CardImageInfo;
  generated: CardGenerated | null; // 出过图才有
  starred: boolean;
  generating: boolean;
  error: string | null;
  updatedAt: string;
};

// 首页「打过星的提示词」里的一条；images、duration、aspectRatio 是这条回复当时的
export type StarredPrompt = {
  canvasId: string;
  nodeId: string;
  nodeTitle: string;
  messageId: string;
  promptIndex: number;
  label?: string;
  text: string;
  summary: string;
  images: string[];
  duration: number;
  aspectRatio: AspectRatio;
  translations: { language: TranslateLanguage; text: string }[];
  // 生图的框：写这条回复时用的生图提示词是哪个系列，节点现在的尺寸，这个框出过的图（打过星的在前，再按新的在前）；视频的框是 null
  image: { family: Family | null; width: number; height: number; generated: GeneratedRef[] } | null;
  createdAt: string;
};

// GET /api/home；images 只有节点和提示词用到的那些图，按画布分
export type HomeData = {
  canvases: HomeCanvas[];
  recentNodes: HomeNode[];
  starred: StarredPrompt[];
  images: Record<string, Record<string, ImageRecord>>;
};

export type NodeSummary = CanvasNodeLayout & {
  title: string;
  parentNodeId: string | null;
  slots: string[];
  duration: number;
  aspectRatio: AspectRatio;
  image: CardImageInfo;
  generated: CardGenerated | null; // 出过图才有
  summary: string;
  directionCount: number;
  starred: boolean;
  failed: boolean; // 当前路径最后一条回复失败了
  generating: boolean;
};

// originalMissing：原文件已经不在了（只查槽位里正放着的图）
export type CanvasImage = ImageRecord & { originalMissing?: boolean };

export type CanvasDetail = { canvas: Canvas; nodes: NodeSummary[]; images: Record<string, CanvasImage>; media: Record<string, MediaRecord> };

// 上传清单里一张图该传哪个文件；size 是那个文件的字节数
export type ChecklistPath = { path: string; kind: 'original' | 'canvas'; note?: string; size: number };

export type StreamEvent =
  | { type: 'user'; message: Message }
  | { type: 'assistant-start'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'done'; message: Message }
  | { type: 'error'; message: Message };
