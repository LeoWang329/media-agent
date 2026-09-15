// 工作文件夹 model-configs.json 里的一项，不含 key
export type ModelConfig = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  imageLongSide: number;
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

export type PromptBox = { index: number; label?: string; text: string; summary: string };

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
  editedFromMessageId?: string;
  videos?: { promptIndex: number; path: string; createdAt: string; meta: Record<string, unknown> }[];
  usage?: { promptTokens: number; completionTokens: number };
  error?: string; // 生成失败时的错误，text 为空
};

// 画布上的一个节点，就是一段对话
export type ChatNode = {
  id: string;
  canvasId: string;
  title: string;
  titleIsManual: boolean;
  parentNodeId: string | null;
  forkedFromMessageId: string | null;
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

export type CanvasListItem = { id: string; title: string; updatedAt: string; nodeCount: number };

export type NodeSummary = CanvasNodeLayout & {
  title: string;
  parentNodeId: string | null;
  slots: string[];
  summary: string;
  directionCount: number;
  starred: boolean;
};

export type CanvasDetail = { canvas: Canvas; nodes: NodeSummary[] };

export type StreamEvent =
  | { type: 'user'; message: Message }
  | { type: 'assistant-start'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: Message }
  | { type: 'error'; message: Message };
