// 工作文件夹 model-configs.json 里的一项，不含 key
// 每百万 tokens 的价格，用来算每条回复花了多少钱；cached 是命中缓存那部分输入的价
export type ModelPricing = { currency: '¥' | '$'; input: number; output: number; cached: number };

export type ModelConfig = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  imageLongSide: number;
  pricing: ModelPricing;
};

export type ModelConfigWithKey = ModelConfig & { apiKey: string };

// GET/PUT /api/config 的数据：模型配置来自工作文件夹，key 来自本机
export type Config = {
  workFolder: string | null;
  modelConfigs: ModelConfigWithKey[];
  assetFolders: string[];
  lastCollageFolder: string | null;
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
  | { type: 'done'; message: Message }
  | { type: 'error'; message: Message };
