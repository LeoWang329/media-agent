// 工作文件夹 model-configs.json 里的一项，不含 key
// 每百万 tokens 的价格，用来算每条回复花了多少钱；cached 是命中缓存那部分输入的价
export type ModelPricing = { currency: '¥' | '$'; input: number; output: number; cached: number };

// 思考档位；用途是写提示词（节点里聊天）、翻译、转标签，各自能跟总档位或单独选一档
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';
export type ThinkingUse = 'chat' | 'translate' | 'tagging';
export type ThinkingSettings = { level: ThinkingLevel } & Record<ThinkingUse, ThinkingLevel | 'follow'>;

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
export type Family = 'IL' | 'Pony';

// 工作文件夹 settings.json，两台机器共用：思考档位、局域网 ComfyUI 地址、底模属于哪个系列（底模文件名 → 系列）、各系列的默认出图参数
export type SharedSettings = {
  thinking: ThinkingSettings;
  comfy: { lanUrl: string | null };
  checkpoints: Record<string, Family>;
  defaults: Record<Family, FamilyDefaults>;
};

// 系统提示词开头说明段里写的用途和底模系列；body 是去掉说明段的部分，见 docs/dev-plan.md 5.14
export type PromptMeta = { use: 'video' | 'image'; family: Family | null; body: string };

// 一个系列的默认值：固定开头、默认负面词、三档评级在这个系列里怎么写、出图参数，见 docs/dev-plan.md 5.18
export type FamilyDefaults = {
  prefix: string;
  negative: string;
  rating: { general: string; sensitive: string; explicit: string };
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  clipSkip: number;
  upscaleModel: string | null;
  poseModel: string | null;
  styleModel: string | null;
  clipVision: string | null;
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
export type TagInfo = { updatedAt: string | null; tags: number; withZh: number };

// 更新词库时推给前端的事件
export type TagUpdateEvent =
  | { type: 'progress'; step: 'tags' | 'aliases'; page: number; rows: number }
  | { type: 'progress'; step: 'zh'; file: number; files: number }
  | { type: 'done'; info: TagInfo }
  | { type: 'error'; message: string };

export type ModelConfigWithKey = ModelConfig & { apiKey: string };

// GET/PUT /api/config 的数据：模型配置来自工作文件夹，key 来自本机
export type Config = {
  workFolder: string | null;
  modelConfigs: ModelConfigWithKey[];
  assetFolders: string[];
  lastCollageFolder: string | null;
  lastDownloadFolder: string | null;
};

// 生图节点的出图设置，存在 node.image，见 docs/dev-plan.md 5.14
export type ImageRating = 'none' | 'general' | 'sensitive' | 'explicit';
export type ImageSettings = {
  width: number;
  height: number;
  count: number; // 一次出几张，1 到 8
  workflowId: string | null; // null 是内置流程
  checkpoint: string;
  loras: { name: string; strength: number }[];
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number | null; // null 是每次随机
  rating: ImageRating;
  negativeExtra: string; // 接在系列默认负面词后面
};

// 发给 ComfyUI 的全部参数，「同样参数再来」照这个发；positive、negative 是最终发出去的，含固定开头和默认负面词
export type ImageJobParams = {
  family: Family;
  positive: string;
  negative: string;
  workflow: { id: string | null; name: string; hash: string };
  width: number;
  height: number;
  checkpoint?: string;
  loras?: { name: string; strength: number }[];
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  clipSkip?: number;
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

// 点一次「生图」出的一组，挂在 assistant 消息的 images 里，见 docs/dev-plan.md 5.19
export type ImageJob = {
  id: string;
  promptIndex: number;
  createdAt: string;
  kind: 'txt2img';
  target: 'lan';
  params: ImageJobParams;
  images: JobImage[];
};

// GET /api/image-jobs/events 推的事件：一组里有一张状态变了就发整组；进度和排在第几不存盘
export type ImageJobEvent =
  | { type: 'job'; canvasId: string; nodeId: string; messageId: string; job: ImageJob }
  | { type: 'progress'; jobId: string; index: number; step: number; total: number }
  | { type: 'queue'; jobId: string; index: number; position: number };

// 测试连接的结果：ComfyUI 版本、显卡、显存（字节）
export type ComfyStatus =
  | { ok: true; url: string; version: string; gpu: string; vramTotal: number; vramFree: number }
  | { ok: false; url: string | null; error: string };

// 从 ComfyUI 读到的下拉选项；底模带着属于哪个系列，guessed 是没在设置里标过、按文件名猜的
export type ComfyOptions = {
  checkpoints: { name: string; family: Family; guessed: boolean }[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
  upscaleModels: string[];
  controlnets: string[];
  ipadapters: string[];
  clipVisions: string[];
  taggers: string[];
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

// 资产库里的一个文件；supported 为假的（heic 等）只显示不能用
export type AssetFile = { path: string; name: string; size: number; mtime: number; supported: boolean };

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
  // 只有 user 消息有
  systemNote?: string;
  attachments?: Attachment[];
  // 只有 assistant 消息有
  modelConfigId?: string;
  modelName?: string;
  systemPromptName?: string;
  systemPromptHash?: string;
  parsed?: { title?: string; prompts: PromptBox[] };
  stars?: number[];
  translations?: PromptTranslation[];
  editedFromMessageId?: string;
  videos?: { promptIndex: number; path: string; createdAt: string; meta: Record<string, unknown> }[];
  usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number };
  error?: string; // 生成失败时的错误，text 为空
  stopped?: boolean; // 生成到一半被叫停，text 是叫停前收到的部分
  reasoning?: string; // 接口发回来的思考原文
  thinkingMs?: number; // 从发出请求到收到第一个正文字的毫秒数；没开思考、也没收到思考原文时没有
  images?: ImageJob[]; // 生图节点出的图，按点生图的先后排
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
  systemPromptName: string;
  slots: string[];
  duration: number;
  aspectRatio: AspectRatio;
  messages: Record<string, Message>;
  rootIds: string[];
  activeChildOf: Record<string, string>; // 键是父消息 id（顶层用 'root'），值是当前显示的版本
  draft: string;
  image?: ImageSettings; // 生图节点改过出图设置才有；没有时按系列的默认值
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
  summary: string;
  directionCount: number;
  starred: boolean;
  failed: boolean; // 当前路径最后一条回复失败了
  generating: boolean;
};

// originalMissing：原文件已经不在了（只查槽位里正放着的图）
export type CanvasImage = ImageRecord & { originalMissing?: boolean };

export type CanvasDetail = { canvas: Canvas; nodes: NodeSummary[]; images: Record<string, CanvasImage> };

// 上传清单里一张图该传哪个文件；size 是那个文件的字节数
export type ChecklistPath = { path: string; kind: 'original' | 'canvas'; note?: string; size: number };

export type StreamEvent =
  | { type: 'user'; message: Message }
  | { type: 'assistant-start'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'done'; message: Message }
  | { type: 'error'; message: Message };
