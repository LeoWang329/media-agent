# 提示词画布 开发计划

写给负责实现的 agent。需求访谈记录在 `docs/requirements-interview.md`（生图那部分在 `docs/requirements-interview-image.md`），那两份讲的是「为什么这么定」；这份讲「具体怎么做」。它们不该冲突，发现冲突先停下来问用户。

Krea2 文生图和四视图的新增需求及实现见 `docs/requirements-interview-krea2.md`、`docs/dev-plan-krea2.md`。

## 1. 一句话说明

一个本机运行的网页：左边是资产库（导入本机文件夹里的图片），中间是画布（每个节点是一段和 agent 的对话，可以从任意一条消息 fork 出新节点），右边是当前节点的对话面板（上面有 9 个图片槽位、视频时长和画面比例）。agent 按 MiniMax H3 官方写法写视频提示词，图片在提示词里用 `<Picture 1>` 到 `<Picture 9>` 引用。第一版只出提示词，不生成视频。

第三批加两样：一是全局控制模型要不要思考、思考多深；二是生图：在生图节点里让模型写 Danbooru 标签提示词（底模是 IL 或 Pony 系列），能用中文搜标签、手动改，再接 ComfyUI 出图（局域网里的那台，或 AutoDL Art 上租的实例）。视频还是只出提示词。

第四批：视频节点的提示词框能直接生成视频。用 AutoDL Art 上另一台跑「MINIMAX-H3提速500高画质」应用的实例，跑内置的长视频流程：分段生成、每段开头原样接上一段结尾，先低分辨率生成、再放大重采一遍。时长能到 60 秒，超过 15 秒的由模型在一个框里按段写。为什么这么定见 `docs/requirements-interview-video.md` 的「第二步」。

## 2. 技术选型

| 部分 | 选择 | 原因 |
| --- | --- | --- |
| 运行方式 | 本机 Node 服务 + 浏览器打开 | 机器上已有 Node 24；不打包，另一台机器装 Node 就能跑 |
| 语言 | TypeScript，npm workspaces | 一个仓库三个包：`server`、`client`、`shared` |
| 服务端 | Express 5 | 熟悉、简单；流式回复用 SSE |
| 图片处理 | sharp | 缩略图、尺寸处理、拼图 |
| 前端 | React 18 + Vite + TypeScript | 常规 |
| 画布 | @xyflow/react（React Flow 12）+ @dagrejs/dagre | 节点拖动、连线、自动排整齐 |
| 状态 | zustand | 简单 |
| 富文本输入（第二批） | Tiptap | @ 选图后显示带缩略图的小标签 |
| 测试 | vitest（单元、服务端集成）、supertest、Playwright（端到端） | 常规 |
| 大模型 | 直接用 fetch 调 OpenAI 兼容接口（`/v1/chat/completions`，stream） | 不依赖某家 SDK |
| 连 ComfyUI（第三批） | Node 自带的 fetch 和 WebSocket | Node 24 都内置了，不加依赖 |
| 标签词库（第三批） | 服务启动时读进内存，搜索时逐个比对 | 12 万个标签，比一遍十几毫秒，用不着搜索引擎 |
| 往 AutoDL 传模型（第三批） | ssh2 | 纯 JS 的 SSH，在那台上执行命令，传文件就是把文件灌进那台上的 `cat`；测试里用它起一个假的 SSH 服务 |

端口：服务 `127.0.0.1:3711`，只监听本机。开发时 Vite 在 5173，代理 `/api` 到 3711。正式运行 `npm start` 由服务端托管打包好的前端，并自动打开浏览器。

不支持的东西（第一版）：HEIC/HEIF 图片（sharp 的预编译包不能解码）、GIF。资产库里遇到这些文件显示为灰色并标「不支持」。

## 3. 目录结构

代码仓库：

```
media_agent/
  package.json                # workspaces
  packages/
    shared/                   # 类型 + 纯逻辑（解析、槽位差异、版本树、图片处理规则），前后端共用，单元测试都在这里
    server/
      src/index.ts            # Express 入口
      src/config.ts           # 本机配置读写
      src/store/              # canvas、node、images、prompts 的读写
      src/assets/             # 资产库索引、缩略图、拼图
      src/llm/                # 拼消息、调接口、流式转发
      src/tags/               # 词库：读取、搜索、校验、更新（第三批）
      src/comfy/              # 连 ComfyUI 和 AutoDL、拼工作流、出图任务（第三批）
      src/native/             # 弹系统选文件夹窗口、在资源管理器里显示文件
    client/
      src/pages/              # Home、Canvas、Settings
      src/components/         # AssetLibrary、CanvasView、NodeCard、ChatPanel、SlotStrip、PromptBox、UploadChecklist、Collage、MentionEditor
      src/store/
  tools/mock-llm/             # 假的大模型服务，测试和开发用
  tools/mock-comfyui/         # 假的 ComfyUI 和 AutoDL 接口，测试和开发用（第三批）
  tests/e2e/                  # Playwright
  tests/fixtures/images/      # 测试图片
  data/danbooru/              # 词库快照（第三批），见 5.13
  docs/
```

数据存放（不在仓库里）：

```
本机配置（Windows：%APPDATA%\media-agent\；其他系统：~/.media-agent/）
  config.json                 # 工作文件夹路径、各模型配置的 key（按模型配置 id 存）、资产库导入了哪些文件夹、上次拼图存哪；
                              # 第三批加：AutoDL 的开发者 Token、这台机器出图用哪台 ComfyUI、上次下载出的图存哪
  thumbs/<hash>.jpg           # 资产库缩略图缓存

工作文件夹（用户指定，可放同步盘）
  model-configs.json          # 模型配置（名字、接口地址、模型名、发图长边、价格），不含 key，两台机器共用
  settings.json               # 两台机器共用的设置（第三批）：思考档位、ComfyUI 地址和 AutoDL 实例、底模属于哪个系列、各系列的默认出图参数
  fragments.json              # 片段库（第三批）
  tags/                       # 词库（第三批），第一次用时从仓库 data/danbooru/ 复制，「更新词库」下完整个换掉
  workflows/<id>.json         # 导入的 ComfyUI 工作流（第三批）
  image-temp/YYYY-MM-DD/      # 出的图先放这里（第三批），程序不自动删
  prompts/
    ref2va.md / i2v.md / t2v.md / fl2va.md / l2va.md # 自带的五套视频系统提示词（参考模式、图当首帧、纯文字、首尾帧、尾帧图）
    il.md / pony.md           # 自带的两套生图系统提示词（第三批）
                              # 七套的原文都在 docs/prompts/，第一次设置工作文件夹时复制；以后新加的自带提示词在服务启动时补上（已有同名的不覆盖）
    <其他名字>.md
    .history/<name>-<hash>.md # 每次用到的系统提示词版本存一份，按内容 hash 命名
  canvases/
    <canvasId>/
      canvas.json             # 画布信息、节点位置、折叠状态
      nodes/<nodeId>.json     # 节点的全部消息和版本
      images/<sha256>.<ext>   # 放进过槽位的图，已按 H3 要求处理过
      images/<sha256>.llm.jpg # 发给大模型用的小图（长边 1600）
      images.json             # imageId → 原始路径、尺寸、是否处理过
  .trash/                     # 删除的画布和节点先移到这里，不直接删
```

所有 JSON 写入都先写临时文件再改名，避免写一半断电。

## 4. 数据模型

放在 `packages/shared/src/types.ts`。

```ts
type ModelConfig = { id: string; name: string; baseUrl: string; model: string; imageLongSide: number /* 默认 1600 */ };  // 工作文件夹 model-configs.json 里的一项

type LocalConfig = {                    // 本机 config.json
  workFolder: string | null;
  apiKeys: Record<string, string>;      // 模型配置 id → key
  assetFolders: string[];
  lastCollageFolder: string | null;
};

type Canvas = {
  id: string; title: string; createdAt: string; updatedAt: string;
  nodes: { id: string; x: number; y: number; collapsed: boolean }[];   // 连线由 Node.parentNodeId 决定，不单独存
};

type AspectRatio = 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

type Node = {
  id: string; canvasId: string;
  title: string; titleIsManual: boolean;
  parentNodeId: string | null;
  forkedFromMessageId: string | null;   // 父节点里那条消息的 id；复制过来的消息保留原 id
  modelConfigId: string;
  systemPromptName: string;             // prompts/ 下的文件名，不含 .md
  slots: string[];                      // 当前槽位（还没发出去的状态），imageId 列表，长度 0–9，不留空
  duration: number;                     // 4–15 的整数，默认 8
  aspectRatio: AspectRatio;             // 默认 16:9
  messages: Record<string, Message>;
  rootIds: string[];                    // 第一层消息的各个版本
  activeChildOf: Record<string, string>;// 键是父消息 id（顶层用 'root'），值是当前显示的那个版本的 id
  draft: string;                        // 输入框里没发出的文字（fork 时预填）
  createdAt: string; updatedAt: string;
};

type Attachment = { picture: number; imageId: string };

type Message = {
  id: string; parentId: string | null; role: 'user' | 'assistant'; createdAt: string;
  text: string;                         // user：用户输入；assistant：模型原始回复（手动改过的版本就是改过的全文）
  slotSnapshot: string[];               // 发出/生成时的槽位
  duration: number; aspectRatio: AspectRatio;
  // 只有 user 消息有：
  systemNote?: string;                  // 程序自动加的说明（见 6.4），也发给模型
  attachments?: Attachment[];           // 这条消息实际发给模型的图
  // 只有 assistant 消息有：
  modelConfigId?: string; modelName?: string;
  systemPromptName?: string; systemPromptHash?: string;
  parsed?: { title?: string; prompts: { index: number; label?: string; text: string; summary: string }[] };
  stars?: number[];                     // 打了星的提示词框 index
  translations?: {                      // 提示词框的译文，见 5.11
    promptIndex: number; language: '英文' | '中文' | '日文' | '韩文';
    instruction: string;                // 翻译时写的要求，没写是空字符串
    text: string; createdAt: string; modelConfigId: string; modelName: string;
    usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number };
  }[];
  editedFromMessageId?: string;         // 手动改提示词生成的版本，指向被改的那条
  handwritten?: boolean;                // 生图节点「写标签」自己写的框，没调模型（5.14）
  videos?: { promptIndex: number; path: string; createdAt: string; meta: Record<string, unknown> }[];  // 预留，第一版恒为空
  usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number };
  error?: string;                       // 生成失败时的错误，text 为空
};

type ImageRecord = {
  id: string; sha256: string; ext: 'jpg' | 'png' | 'webp';
  originalPath: string; originalName: string;
  width: number; height: number;        // 处理后的尺寸
  processed: null | { reason: 'too-large' | 'too-small' | 'file-too-big'; originalWidth: number; originalHeight: number };
  addedAt: string;
};
```

第三批加的：

```ts
type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';
type ThinkingStyle = 'none' | 'reasoning-effort' | 'enable-thinking' | 'thinking-type' | 'model-switch';  // 见 5.12
// ModelConfig 加两个字段：thinkingStyle: ThinkingStyle；thinkingModel: string（model-switch 时开思考用的模型名）
// Message 加三个字段（只有 assistant 消息有）：reasoning?: string（思考原文）；thinkingMs?: number；images?: ImageJob[]（生图节点出的图）
// ChatNode 加：kind: 'video' | 'image'（建的时候定，之后不能改，见 5.23）；image?: ImageSettings（生图节点才有，见 5.14）
// 本机 config.json 加：autodlToken: string | null；comfyTarget: 'lan' | 'autodl'；lastDownloadFolder: string | null；comfyClientId: string（连 ComfyUI 用的固定身份，见 5.19）

type Family = 'IL' | 'Pony';

type FamilyDefaults = {                 // 一个系列的默认值，见 5.18。用哪个放大、检测、ControlNet 模型不在这里，由预设管（5.21）
  prefix: string;                       // 固定开头，比如 masterpiece, best quality
  negative: string;                     // 默认负面词
  rating: { general: string; sensitive: string; explicit: string };  // 三档评级在这个系列里怎么写
  steps: number; cfg: number; sampler: string; scheduler: string; clipSkip: number;
};

type SharedSettings = {                 // 工作文件夹 settings.json
  thinking: { level: ThinkingLevel; chat: ThinkingLevel | 'follow'; translate: ThinkingLevel | 'follow'; tagging: ThinkingLevel | 'follow' };
  comfy: { lanUrl: string | null; autodl: { instanceUuid: string | null; idleMinutes: number } };  // 没选实例是 null
  checkpoints: Record<string, Family | null>;  // 底模文件名 → 系列，null 是两个都不是
  defaults: Record<Family, FamilyDefaults>;
  taggerModel: string | null;           // 反推用的模型
};

type ImageSettings = {
  width: number; height: number;        // 九档之一（5.14），或者自己填的 8 的倍数（5.21）
  count: number;                        // 一次出几张，1–8，默认 4
  workflowId: string | null;            // null 是内置流程，否则是导入的工作流
  checkpoint: string;                   // 空着：出图时用这台 ComfyUI 上这个系列的第一个，记进这一组的参数
  vae: string;                          // 空着是用底模自带的，见 5.21
  loras: { name: string; strength: number }[];
  loraTarget: 'both' | 'model';         // LoRA 作用在哪：画图的模型和文字理解都作用，或者只作用在画图的模型上，见 5.21
  weighting: 'comfy' | 'a1111';         // 带权重的标签怎么算，见 5.21
  steps: number; cfg: number; sampler: string; scheduler: string;
  seed: number | null;                  // null 是每次随机
  rating: 'none' | 'general' | 'sensitive' | 'explicit';
  negativeExtra: string;                // 接在系列默认负面词后面
  upscale: UpscaleSettings;             // 放大，见 5.21
  details: DetailPass[];                // 部位重绘，按顺序做，见 5.21
  controls: ControlSettings[];          // ControlNet，按顺序接，见 5.21
  // P17 加：start（文生图或图生图）
};

type UpscaleSettings = { on: boolean; model: string; scale: 1.5 | 2; denoise: number };  // denoise 0 是只放大不重画
type DetailPass = {                     // 部位重绘的一道
  on: boolean;
  detector: string;                     // 检测模型，bbox/ 下的重画整个框，segm/ 下的只重画轮廓里面
  sam: string;                          // 用哪个 SAM 模型把框收成形状，空着是不用，见 5.21
  threshold: number; denoise: number;
  guideSize: 512 | 768 | 1024;          // 检测到的地方放大到多大再画
  positive: string; negative: string;   // 写了就换掉框里的标签、额外的负面词；空着用原图的
};
type ControlType = 'pose' | 'depth' | 'lineart' | 'edge' | 'other';  // 姿势、深度、线稿、边缘、其他；画风 P17 加
type RefImage =                         // 参考图：槽位里的图，或者这个节点出过的图（那一组的 id 和那张的种子）
  | { kind: 'slot'; imageId: string }
  | { kind: 'generated'; messageId: string; jobId: string; seed: number };
type ControlSettings = {                // ControlNet 的一个，见 5.21
  on: boolean;
  type: ControlType;
  image: RefImage | null;               // 参考图，没选是 null
  preprocessor: string;                 // 提取方式，AIO_Preprocessor 列表里的名字；none 是不提取，直接用这张
  model: string;                        // ControlNetLoader 的文件名，空着是还没选
  strength: number; start: number; end: number;  // 默认 1、0、1
};
type ImagePreset = {                    // 预设，工作文件夹 image-presets.json，见 5.21
  id: string; name: string; family: Family;
  settings: Omit<ImageSettings, 'count' | 'seed'>;  // ControlNet 的参考图不存，存成 null
  createdAt: string; updatedAt: string;
};

// 往 AutoDL 那台传的模型，见 5.22。都不存盘，从那台上现读
type ModelKind = 'checkpoint' | 'lora' | 'upscale' | 'bbox' | 'segm' | 'controlnet' | 'ipadapter' | 'clipVision' | 'vae';
type RemoteModelFile = {
  kind: ModelKind;
  path: string;                         // 相对这一类的文件夹，比如 IL/xxx.safetensors
  bytes: number; modifiedAt: string;
  partial: boolean;                     // .part 结尾的，没传完、没下完
};
type ModelTransfer = {                  // 在传的和排着的，只在内存里
  id: string; way: 'upload' | 'download';
  kind: ModelKind; path: string; url?: string;
  done: number; total: number | null;   // 字节；给链接的取不到大小时 total 是 null
  state: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  error?: string;
};

type ImageJob = {                       // 点一次「生图」（或出完的图上补做、局部重绘）出的一组
  id: string; promptIndex: number; createdAt: string;
  rev?: number;                         // 每改一次加一：推送和请求的回复谁先到不一定，前端拿它丢掉旧的
  kind: 'txt2img' | 'refine' | 'inpaint';  // refine 是出完的图上补做放大和部位重绘
  source?: { kind: 'generated'; jobId: string; seed: number };  // 从哪张图来：那一组的 id 和那张的种子（删掉一张后后面的往前补位，所以不记第几张）
  target: 'lan' | 'autodl';
  params: {                             // 发出去的全部参数，「同样参数再来」照这个发
    family: Family;
    positive: string; negative: string; // 最终发给 ComfyUI 的，含固定开头和默认负面词
    workflow: { id: string | null; name: string; hash: string };
    width: number; height: number;      // 补做的是原图的尺寸
    checkpoint?: string; loras?: { name: string; strength: number }[];       // 导入的工作流没有这几项
    steps?: number; cfg?: number; sampler?: string; scheduler?: string; clipSkip?: number;
    vae?: string; loraTarget?: 'model'; weighting?: 'a1111';                  // 不是默认的才记
    upscale?: UpscaleSettings;          // 开着的才记
    details?: DetailPass[];             // 开着的才记，positive、negative 是拼好的最终提示词，空着是和原图一样
    controls?: ControlSettings[];       // 开着的才记，参考图是当时选的
    mask?: string;                      // 局部重绘涂好的那张 PNG，相对工作文件夹的路径
  };
  images: {                             // 每张图是 ComfyUI 上的一个任务
    seed: number; promptId?: string;
    status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
    file?: string;                      // 临时文件夹里的图，相对工作文件夹的路径
    width?: number; height?: number; ms?: number;   // 出图用了多久
    savedPath?: string;                 // 下载到哪
    starred?: boolean;
    error?: string;
  }[];
};

type Fragment = {                       // 片段，工作文件夹 fragments.json
  id: string; name: string;
  category: 'character' | 'style' | 'quality' | 'other';
  text: string;                         // 写法和提示词框里一样
  createdAt: string; updatedAt: string;
};

type ImportedWorkflow = {               // 工作文件夹 workflows/<id>.json
  id: string; name: string; hash: string; importedAt: string;
  file: string;                         // 导入时的文件名，设置里显示
  graph: Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;  // ComfyUI 的 API 格式
  fill: { positive: FillTarget; negative: FillTarget | null; seed: FillTarget | null; width: FillTarget | null; height: FillTarget | null };
};
type FillTarget = { node: string; input: string };
```

后来加的（只带最近几轮，见 5.4）：

```ts
type TurnLimit = 'all' | number;        // 节点对话最多带几轮：all 是全带，数字只能是 5、10、20、30、50
// SharedSettings 加：turnLimit: TurnLimit，默认 all
// ChatNode 加：turnLimit?: TurnLimit | 'follow'（没有或 follow 是跟设置）
// Message 加（只有 assistant 消息有）：trimmed?: { kept: number; dropped: number }（真截掉了才有：带了几轮、前面几轮没带）
```

第四批加的（生成视频，见 5.24 到 5.28）：

```ts
type VideoSettings = {                  // 视频节点的生成设置，存在 node.video；没有时用默认值
  megapixels: number;                   // 一采大小（百万像素）：0.3、0.4、0.5、0.6、0.8、1，默认 0.4
  upscale: 1.5 | 2;                     // 放大倍数，默认 2
  seed: number | null;                  // null 是每次随机
};
// SharedSettings.comfy 加：videoAutodl: { instanceUuid: string | null; idleMinutes: number }（生成视频用的那台，默认没选、空闲 15 分钟关机）
// Message.videos 原来留的字段改成 VideoJob[]
type VideoJob = {                       // 点一次「生成视频」出的一条
  id: string; promptIndex: number; createdAt: string;
  rev?: number;
  source?: { jobId: string };           // 「同样参数再来」「只换种子再来」照着哪条
  params: {                             // 发出去的全部参数，再来照这个发
    segments: string[];                 // 每段的提示词
    seconds: number;                    // 写这条回复时的时长
    frames: { total: number; chunk: number; overlap: number };  // 整条、每段、相邻两段重叠几帧
    aspectRatio: Exclude<AspectRatio, 'auto'>;
    megapixels: number; width: number; height: number;          // 一采
    upscale: number; finalWidth: number; finalHeight: number;   // 出片
    model: string;                      // 主模型文件名
  };
  seed: number;
  promptId?: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  file?: string;                        // 临时文件夹里的视频，相对工作文件夹，用 / 隔开
  bytes?: number; ms?: number;          // 文件多大、从开始跑到出完用了多久
  savedPath?: string;                   // 下载到哪
  error?: string;
};
```

视频和音频参考加的（P22，见 5.31）：

```ts
type MediaRecord = {                    // 放进画布的视频、音频，画布的 media.json；文件在 media/<sha>.<扩展名>
  id: string; sha256: string; kind: 'video' | 'audio'; ext: string;
  originalPath: string; originalName: string;   // 从文件夹拖进来的 originalPath 是空的
  seconds: number;                      // 多长，浏览器读的
  width?: number; height?: number; hasAudio?: boolean;   // 只有视频有
  bytes: number; addedAt: string;
};
type MediaSlot =                        // 节点的视频、音频槽位一格
  | { kind: 'video'; mediaId: string; seconds: number; start: number; use: 'picture' | 'both' | 'sound'; frame?: string }
  | { kind: 'audio'; mediaId: string; seconds: number; start: number; use: 'voice' | 'dub' };
  // seconds 是这个文件多长；start 是从第几秒开始取；frame 是截给模型看的那一帧，存成画布里的一张图
// ChatNode 加 media: MediaSlot[]（视频在前、音频在后，各自按顺序；没有是空）
// Message 加 mediaSnapshot?: MediaSlot[]（发出、生成时的视频和音频）、frames?: { video: number; imageId: string }[]（这条消息发给模型的截帧）
// VideoJobParams 加 media?: { kind; mediaId; use; start; take: number; width?: number; height?: number }[]
  // 这一条带的视频和音频，按编号的顺序；take 是取多少秒
```

id 一律用 `crypto.randomUUID()`。

## 5. 核心规则

这些规则是产品的骨架，实现时按这里的原文来，别自己发挥。

### 5.1 槽位和编号

- 每个节点有自己的槽位 `node.slots`，最多 9 个，编号就是数组下标加 1，对应提示词里的 `<Picture N>`。
- 中间不留空：删掉第 2 张，原第 3 张变成第 2 张。
- 放图：双击资产库里的图，放进下一个空位；多选后拖进槽位区，按选中的先后顺序填进空位；拖到某个已有图的槽位上，替换它；点一下槽位弹出选图窗口，单击一张就放进这一格，Ctrl 或 Shift 多选后点「放入选中的 N 张」一次放好几张（点空槽位时弹出的是第一个空位，因为槽位中间不留空）；从 Windows 文件夹里直接把图拖进槽位区（不用先导入文件夹）；槽位之间拖动，调顺序。
- 放图时先把图复制进画布文件夹（见 5.6），槽位里存的是 imageId。
- 槽位改动不马上发给模型，发下一条消息时才带上（见 5.4）。
- `node.slots` 随时保存，打开节点时用存的值（没发出的改动不丢）。切换消息版本时，`node.slots` 重置为新路径最后一条消息的 `slotSnapshot`；切换前如果槽位有没发出的改动，弹一句确认。
- 时长、比例同样规则。

### 5.2 消息版本树

- 消息是一棵树：`parentId` 指向上一条消息，同一个 `parentId` 下的多个孩子就是同一位置的多个版本。
- 当前显示的路径：从 `activeChildOf['root']` 开始，一路按 `activeChildOf[消息 id]` 往下走，直到没有孩子。
- 新建消息：挂在指定的父消息下，并把 `activeChildOf[父 id]` 设成它。
- 切换版本：只改 `activeChildOf[父 id]`；更深层的 `activeChildOf` 不动，这样切回去时后面的对话原样恢复。
- 编辑用户消息：在同一个父消息下新建一条 user 消息，文字是改过的，`slotSnapshot`、`duration`、`aspectRatio`、`attachments`、`systemNote` 原样复制自被编辑的那条；然后照常生成回复。也就是说，编辑早先的消息只改文字，图片沿用那条消息当时的。
- 重新生成：在同一个父消息下新建一条 assistant 消息。
- 手动改提示词：在同一个父消息下新建一条 assistant 消息，`text` 是原全文里把那个提示词框的内容替换掉之后的结果，`editedFromMessageId` 指向原来那条，重新解析。不调模型。
  - 之后接着聊时，发给模型的对话里这一版拆成两条：先发模型写的那一版（改过几次的，顺着 `editedFromMessageId` 找到最早那条），再当成用户说的话发「我手动改了你上面这条回复里的框，改完是这样：」，后面是每个改过的框的全文，最后一句「之后在我改的这一版上接着改，我改过的地方不要改回去。」这样模型知道哪些是用户特意改的。改回和原来一样就不发后面那条。
- 自己写的框（5.14）：接在当前路径最后一条后面，新建一条 assistant 消息，`text` 只有一个不带名字的 `<prompt>` 框，`handwritten` 为真。不调模型，不能重答；编辑它照手动改提示词来，新版本也是自己写的。
- 版本切换控件只在有兄弟版本的消息上显示，形如 `‹ 1/2 ›`。

### 5.3 fork

- 从消息 M 所在的当前路径 fork，新节点 B 的消息链 = M 的祖先（含 M 本身，如果 M 是 assistant）；如果 M 是 user 消息，链到 M 的上一条为止，M 的文字放进 `B.draft`。
- 复制时消息 id 不变，`parentId` 不变，只复制链上的消息（其他版本不复制），按链建 `rootIds` 和 `activeChildOf`。
- `B.slots`、`B.duration`、`B.aspectRatio` 取链上最后一条消息的快照；链为空时取 M 的快照。
- `B.modelConfigId`、`B.systemPromptName` 复制自原节点。`B.title` = 原标题 + `「 · 分支」`，`titleIsManual = false`。
- `B.parentNodeId` = 原节点，`B.forkedFromMessageId` = M。画布上放在原节点右侧、已有子节点的下方，并连一条线。
- 「沿第 N 个方向往下改」按钮：等于从那条 assistant 消息 fork，再把 `draft` 预填为「沿第 N 个方向（标签）往下改：」。

### 5.4 发给模型的内容怎么拼

放在 `shared/src/compose.ts`，纯函数，输入节点、当前路径、系统提示词文本，输出 OpenAI 格式的 `messages`。

system 消息 = 系统提示词文件内容 + 两个空行 + 固定的格式要求（`docs/prompts/format-requirement.md` 里「---」下面那段，程序内置，设置页可查看）。

每条 user 消息的 content 是一个数组，顺序是：

1. `{type:'text', text: systemNote}`（有才加）
2. 对每个 attachment：`{type:'text', text:'<Picture N>'}`，接 `{type:'image_url', image_url:{url:'data:image/jpeg;base64,...'}}`（用 `.llm.jpg` 小图）
3. `{type:'text', text: 用户输入}`

assistant 消息的 content 就是 `text`（失败的消息跳过）。

发送时 `systemNote` 和 `attachments` 由程序算出来并存进消息。算法：拿上一条消息（当前路径上的最后一条，不分角色）的 `slotSnapshot` 叫 prev，当前 `node.slots` 叫 cur：

- 节点里还没有任何消息：attachments = cur 全部；note =「参考图共 K 张，编号如下。视频时长 D 秒，画面比例 R。」K 为 0 时 note =「本次没有参考图。视频时长 D 秒，画面比例 R。」
- prev 和 cur 完全相同：不带图；时长或比例变了才有 note：「视频时长改为 D 秒。」「画面比例改为 R。」两句可并列。
- cur 是在 prev 末尾追加了几张（前面完全相同）：只带新的；note =「新增参考图：<Picture 4>、<Picture 5>。」
- 长度相同，只有若干位置换了图：只带换掉的；note =「<Picture 2>、<Picture 3> 换成了下面的新图，其他不变。」
- 其他情况（删了图、调了顺序，或既换又加）：带全部；note =「参考图已重新编号，以下是当前全部 K 张参考图，以此为准，之前的编号作废。」

时长、比例变了的句子接在上面 note 的后面。比例 `auto` 显示成「自动」。

生图节点（见 5.14）不说时长和比例：第一条消息的 note 是「参考图共 K 张，编号如下。」，K 为 0 时不加 note；之后只有槽位变了才有 note，句子同上。

界面上 `systemNote` 显示成用户气泡上方的一行灰字，attachments 显示成带编号的小缩略图。

只带最近几轮（后来加的）：

- 设置里一个「最多带几轮」：全部、5、10、20、30、50，默认全部。每个节点在面板顶上能单独改，默认「跟设置」；新建的节点跟设置，从这里岔出的新节点照抄原节点的选择。
- 发的一条 user 消息算一轮，这次发的也算。超过了就从倒数第 N 条 user 消息开始往后带，更前面的不发。system 消息照常在最前面。
- 留下的第一条 user 消息，说明和图换成「节点里还没有任何消息」那种：带它发出时槽位里的全部图，note 是「参考图共 K 张，编号如下。」加时长和比例（生图节点照 5.14 不说时长和比例）。后面几条照存的发。截掉的那些轮里放过、后来不在槽位里的图就不再发。
- 存着的 `systemNote` 和 `attachments` 不改，只在发的时候换。
- 真截掉了的回复记下 `trimmed`，回复下面 tokens 旁边写「只带了最近 N 轮，前面 M 轮没带」。
- 重新生成、岔出以后再发都一样；翻译和转标签只发一次，不受影响。

### 5.5 回复怎么解析

放在 `shared/src/parse.ts`。

- 标题：`<title>…</title>`，取第一个。
- 提示词框：`<prompt>` 或 `<prompt label="…">` 在行首开始，`</prompt>` 结束，中间原样保留（去掉首尾空行）。模型把正文和标签写在同一行也认：开始标签后面的算框里第一行，结束标签前面的算最后一行、后面的算框外文字。用非贪婪匹配，允许多个。框里出现的 `<Picture 1>`、`<Subject 1>`、`<d>` 等尖括号内容不是标签，不要当 HTML 处理，显示时要转义。
- 概述：在框内找以 `summary:` 开头的行（不区分大小写），取它后面直到下一个 `xxx:` 部分名行之间的文字，去掉换行；没有就取前两行非空文字。卡片上显示前 80 个字。
- 流式显示时，边收边解析；没收到 `</prompt>` 前，框以「生成中」样式显示。

### 5.6 图片处理（三种尺寸）

放进槽位时，服务端对原文件做：

1. 算 sha256，已经有就直接复用 imageId。
2. 画布副本 `images/<sha>.<ext>`：按 H3 要求处理。长边超过 5760 → 缩到 5760；短边不到 256 → 放大到 256（两个条件冲突的极端长条图以不超过 5760 为准，槽位上标红「尺寸不符」）；处理后文件仍超过 30 MB → 转成 JPEG，从质量 90 开始每次降 5 直到不超过 30 MB。没触发任何条件就原样复制。记录 `processed`。
3. 模型用小图 `images/<sha>.llm.jpg`：长边缩到模型配置里的 `imageLongSide`（默认 1600），JPEG 质量 85。
4. 写 `images.json`。

从 Windows 文件夹拖进来的图走同一套处理，只是浏览器只给得出文件名和内容，`originalPath` 存空字符串。

资产库缩略图：长边 256，JPEG 质量 80，存本机缓存，键是 `sha1(路径 + 修改时间 + 大小)`。

### 5.7 上传清单

对某个提示词框打开清单，列的是这条消息 `slotSnapshot` 里的每张图，按编号：

- 大缩略图、`Picture N`、文件名。
- 路径：`processed` 为空且原文件还在 → 原始路径；否则 → 画布副本路径，并标「已处理，请上传这份」或「原图不在了，用这份」。
- 每行两个按钮：「在资源管理器中显示」（服务端执行 `explorer /select,<路径>`）、「复制路径」。
- 顶部：「复制提示词」按钮；提示词里引用了不存在的编号（比如只有 3 张却写了 `<Picture 5>`）时，顶部标红提示。
- 提示词里没引用到的编号，行首标灰「提示词里没用到」。

### 5.8 标题

- 节点标题来自这个节点第一条 assistant 回复里的 `<title>`（`titleIsManual` 为假时）。之后的回复里的 `<title>` 忽略。回复里没有标题时，取概述前 12 个字；再没有就保持原标题。
- 双击卡片标题可以改，改过后 `titleIsManual = true`。

### 5.9 星标

- 星打在提示词框上：`message.stars` 里记框的 index。
- 节点里任何消息、任何版本有星，卡片就显示星标。
- 岔出去的节点连星一起复制了回复，复制来的星不算它的：同一个框只算在写出这条回复的节点上。画布页的节点卡片、首页最近节点卡片上的星，首页「打过星的提示词」和画布卡片上「几个节点打过星」，都按这个算。

### 5.10 系统提示词版本

- 每次发送前读取 `prompts/<name>.md`，算 sha256，存到 assistant 消息的 `systemPromptHash`；内容以 `prompts/.history/<name>-<hash前 12 位>.md` 存一份（已存在就跳过）。
- 面板里 assistant 消息角落显示模型名和提示词名，点开能看当时那版提示词全文。

### 5.11 翻译提示词框

- 框上「翻译」打开翻译窗口：选语言（英文、中文、日文、韩文），要求选填，用节点现在选的模型配置问一次。系统消息是 `docs/prompts/translate.md` 里「---」以下的说明，`{语言}` 换成选中的语言，写了要求时另起一段接上「用户对这次翻译的要求（和上面冲突时以这里为准）：」和要求；用户消息只有这个框里的提示词原文，不带对话历史和图。
- 回复去掉首尾空白后存成译文，记进这条 assistant 消息的 `translations`；同一个框同一种语言再翻就换掉旧的。再打开窗口时停在最近翻过的语言，直接显示译文和当时写的要求。
- 窗口按 `web/prototype` 的原型做：左边四种语言各自标着翻过的时间、「正在翻 N 秒」或「还没翻过」，下面是要求和默认不翻的内容；右边是译文，「复制译文」在译文上方，有译文时打开就把焦点放在它上面。几种语言可以同时翻；翻着的时候可以关掉窗口，翻好时窗口关着或开的是别的框就在底部提示。重新翻译时旧译文照样能看、能复制，顶上提示正在重新翻译。失败时底部提示「「框的标签」翻成某语言失败：原因」。
- 说明里默认不翻部分名字、各种标记、`<d>` 里的台词和英文引号里的画面文字，用户的要求和这些冲突时以要求为准。
- 手动改提示词生成的新版本，不带被改那个框的译文，别的框的照旧。翻译花的钱算进面板顶上「这个节点花了」。

### 5.12 思考（第三批）

- 设置里一个总档位：关、低、中、高。另有三个用途，各选「跟总开关」或者某一档：写提示词（节点里聊天）、翻译（5.11）、转标签（5.15）。默认写提示词跟总开关，翻译和转标签是关。存在工作文件夹 `settings.json`，两台机器共用。
- 每套模型配置加「思考写法」，决定档位怎么发给接口。各家的参数名，接的时候按文档逐个核对：
  - 不支持：什么都不发，档位不起作用。
  - reasoning_effort（OpenAI、Gemini 这类）：低中高发 `low`、`medium`、`high`；关也发 `low`，因为多数家关不掉思考，`low` 是各家都认的最低一档。
  - enable_thinking（通义）：关发 `enable_thinking: false`；低中高发 `true`，`thinking_budget` 分别是 2000、8000、不发。
  - thinking.type（豆包、智谱）：关发 `thinking: {type: "disabled"}`，低中高都发 `enabled`。
  - 换模型名（DeepSeek）：关用配置里的模型名，低中高换成「开思考用的模型名」，比如 `deepseek-reasoner`。
- 读回复时，除了 `delta.content`，也读 `delta.reasoning_content`（DeepSeek、通义）和 `delta.reasoning`（有的转发平台用这个名字）。思考原文存进 `message.reasoning`，和正文一样边收边落盘；从发出请求到收到第一个正文字的毫秒数存进 `thinkingMs`。档位是关、也没收到思考原文的，不存这两项。手动改提示词生成的新版本不调模型，也不带这两项。
- 拼下一轮发给模型的消息时不带思考原文（5.4 只用 `text`）。
- 显示：档位不是关时，正文出来之前显示「正在思考 N 秒」；收到过思考原文的回复，上面多一块折叠着的「思考了 N 秒」，点开看原文；没收到原文的只显示想了多久。
- 花费照 6.4 的算法算：多数接口把思考的 token 算在 `completion_tokens` 里，不另算。

### 5.13 词库（第三批）

- 仓库里的 `data/danbooru/` 是 2026-10-03 下的快照，来源和覆盖情况见 `docs/requirements-interview-image.md`「查到的事实」：
  - `tags.csv`：`tag, category, count, deprecated`，Danbooru 上用过 50 次以上的标签，再加上全部已废弃的标签（Danbooru 撤了的，比如 bangs，现在多是 0 次），一共 128,261 个，其中已废弃的 4,056 个。分类 0 通用、1 画师、3 作品、4 角色、5 元标签。
  - `aliases.csv`：`alias, tag`，官方生效的别名 41,281 条。
  - `zh/*.csv`：`tag, category, aliases, zh, count, notes`。`zh` 是中文名；`aliases` 是常用叫法，用 `|` 隔开，有日文原名、社区叫法、英文旧写法；`notes` 是一句说明。文件开头带 BOM。MIT 许可，`zh/LICENSE` 跟着数据走。
- 工作文件夹里没有 `tags/` 时，从仓库复制一份过去（和自带系统提示词一样）。服务启动时读进内存：以 `tags.csv` 为准，按 tag 并上中文名、常用叫法、说明；`aliases.csv` 只留指向 `tags.csv` 里有的标签的。
- 比对标签名时，空格和下划线当成一样，不区分大小写，去掉 `\` 转义。词库里的写法是小写加下划线（`long_hair`）。
- 搜索（打字联想用）：
  - 英文：先比标签名开头，再比标签名中间，再比官方别名；
  - 中文：比中文名和常用叫法，开头对上的在前；
  - 同一档里按使用次数从多到少，已废弃的不出；最多 20 个，每个带中文名、分类、使用次数，靠别名对上的注明是哪个别名。
- 校验，每个标签得出三种之一：
  - 认识：在词库里（已废弃的也算，底模多半还认得），或者是这个系列固定开头、评级词里的词（5.18）。
  - 别名：是官方别名，给出标准名。
  - 不认识：给最接近的 5 个，先用上面的搜索取，不够再按编辑距离补，已废弃的不给。LoRA 的触发词、自然语言短语也会落在这里，只标出来，不替换、不删。
- 更新词库（设置里手动点）：服务端照快照的做法重新下，大约 4 分钟，界面上显示下到哪一步。
  - 标签：`https://danbooru.donmai.us/tags.json?search[post_count]=%3E50&limit=1000&page=a<上一页最大的 id>&only=id,name,post_count,category,is_deprecated`，从 `page=a0` 翻到返回空为止；再把 `search[post_count]=%3E50` 换成 `search[is_deprecated]=true` 同样翻一遍，补上前面没有的已废弃标签。
  - 别名：`https://danbooru.donmai.us/tag_aliases.json?search[status]=active&limit=1000&page=a<上一页最大的 id>&only=id,antecedent_name,consequent_name`，同样翻页。
  - 中文对照：`https://raw.githubusercontent.com/amenorira/danbooru-tags-data-zh/main/` 下的 `tags/` 五个文件和 `LICENSE`。
  - 请求头带 `User-Agent: media-agent`，一页一页按顺序请求，中间隔 0.5 秒。全部下完才整体换掉 `tags/`；中途失败，旧的不动，说是哪一步失败的。
- 设置里显示词库是哪天的、多少个标签、多少个有中文（另写按使用次数算有中文的占多少）、多少条别名、数据从哪来。更新时能点「停止更新」，停在正在下的那一页，下了一半的扔掉，旧的不动。

### 5.14 生图节点（第三批）

- 节点建的时候定是生图节点还是视频节点（5.23），生图节点只能选生图用的系统提示词。系统提示词文件开头可以有一段用 `---` 上下围起来的说明，有这段、写着「用途: 生图」的是生图提示词，「底模」是 IL 或 Pony：

  ```
  ---
  用途: 生图
  底模: IL
  ---
  ```

  发给模型时去掉这段。设置页新建系统提示词时复制当前那套，这段跟着复制；列表里标出哪些是生图用的、哪个系列。
- 自带两套生图提示词 `il` 和 `pony`，放在 `docs/prompts/`，P9 写好先给用户看。要求：
  - 只用 Danbooru 标准标签，英文，用英文逗号隔开；
  - 下划线写成空格，标签名里的括号写成 `\(` `\)`；
  - 按人数、角色、作品、外观、服装、表情和动作、构图、背景、画风的顺序排；
  - 不写这个系列的固定开头，程序会加；
  - 能看图的模型，照着槽位里的图写；一次可以给几个方向，每个方向一个框。
- 生图节点的固定格式要求用 `docs/prompts/format-requirement-image.md`（P9 写）：和视频的一样用 `<title>` 和 `<prompt label="…">`；框里只放英文标签，英文逗号隔开，不写别的；标题概括这张图。设置页两份都能看。
- 和视频节点不一样的地方：
  - 面板上时长和比例的位置换成尺寸和张数。尺寸九档：1024×1024；竖的 896×1152、832×1216、768×1344、640×1536；横的是这四个宽高对调，默认 832×1216。P16 起九档后面能自己填（5.21）。张数 1 到 8，默认 4。
  - 出图设置存在 `node.image`，没改过的项按节点系列的默认值；底模下拉只列标成这个系列的底模（5.17）。LoRA 可以挂几个，各带强度；选 LoRA 时能按名字搜，空格隔开的几个词都对得上才列出来，不分大小写。
  - 输入框旁边有「写标签」：打开一个空的标签编辑窗（5.15），打中文英文都有联想，也能整串粘贴。「存成框」不问模型，存成一个框，回复那一栏写「自己写的」，角落写「自己写的，没有调用 AI」；这个框和模型写的一样能生图、编辑、打星、岔出。
  - 写标签的窗里还有「让 AI 优化」，旁边能写一句要求：先把写的存成框，再在它后面像平时一样发一条消息给模型，内容是「优化上面这个框里我自己写的标签：」加要求，没写要求就用「保持原意，改成标准写法，补上缺的，去掉重复和冲突的」。模型带着系统提示词和前面的对话回一个新框，自己写的那个留着。
  - 发给模型的对话里，自己写的框当成用户说的话：「我自己写了一个框：」加框的原文。
  - 槽位照旧：图照样发给模型看，也是 ControlNet、图生图参考图的来源（5.21）。5.4 的说明不写时长比例。
  - 提示词框上的按钮：复制、生图、打星、编辑（打开标签编辑窗，5.15）、沿此方向 fork。没有翻译（标签下面已经显示中文）和上传清单（那是往视频平台传图用的）。
  - 卡片上（画布和首页）：出过图的，缩略图换成最近出的图；没出过的照旧显示槽位里的图。时长比例那行换成尺寸和系列。
- 中途换系统提示词，从视频换成生图或者反过来，已有的消息不动，面板控件跟着换。

### 5.15 标签的显示、校验和编辑（第三批）

- 拆标签放在 `shared/src/tags.ts`：框里的文字按英文逗号拆，括号里的逗号不拆，去掉首尾空白，空项丢掉；`(tag:1.2)` 拆出权重，`(tag)` 当 1.1；`\(` `\)` 是标签名里的括号。拆出来的每一项按 5.13 校验。
- 框里的显示：每个标签一个小块，英文在上，中文在下；权重不是 1 的标出来；是别名的，显示标准名并注明原来写的是什么；不认识的标出来，点开看最接近的几个，点一个就换掉，存成新版本（走 5.2 的手动改提示词）。
- 拼成提示词，出图和复制都用这一串：
  - 别名换成标准名，不认识的原样照写；
  - 下划线换成空格，颜文字标签保留下划线（`^_^`、`>_<`、`@_@`、`+_+`、`=_=`、`o_o`、`|_|`、`0_0`、`u_u`、`>_o`、`._.`、`x_x`、`<o>_<o>`、`3_3`、`6_9`）；
  - 标签名里的括号写成 `\(` `\)`，权重不是 1 写成 `(tag:1.2)`；
  - 标签之间用 `, ` 隔开。复制拿到的就是这串，不含系列固定开头。
- 标签编辑窗：生图节点里框上的「编辑」打开它，代替 5.2 的手动改提示词窗口。做法和 @ 选图一样，用 Tiptap，标签是一行文字里的小块：
  - 打开时框里的标签都是小块。打字时弹候选（5.13 的搜索，中文英文都行），每个候选显示英文、中文、分类、使用次数；选中候选，或者打了逗号，前面打的这段变成小块。词库里没有的英文照样变成小块，标「不认识」。
  - 小块能拖动排序、删掉；点一下调权重，0.1 到 2.0，每次 0.1。
  - 打的中文词库里搜不到（比如「坐在窗边看书」）：给一个「让模型转成标签」，用节点的模型配置问一次。系统消息是 `docs/prompts/to-tags.md`（P9 写）里「---」以下那段，用户消息就是这句中文，思考用「转标签」那档。回来的标签逐个校验，变成小块插在光标处。
  - 插片段（5.16）：搜片段名，插进来的是片段里的标签，展开成普通小块，之后和片段没有关系。
  - 选几个小块「存成片段」。
  - 从图反推（5.21）：选一张节点槽位里的或这个节点出过的图，反推出来的标签加在末尾。
  - 存：照 5.2 的手动改提示词，存成新版本，不调模型。
- 视频节点的手动改不变。

### 5.16 片段库（第三批）

- 存在工作文件夹 `fragments.json`，两台机器共用。一个片段有名字、分类（角色、画风、质量词、其他）、标签串（写法和框里一样）。
- 在标签编辑窗里存和插（5.15）。存的时候起名字、选分类；名字重了提示换一个。
- 设置里「片段库」一节：按分类列出全部，能改名、改分类、改内容（同样用标签编辑窗）、删除。

### 5.17 ComfyUI 和 AutoDL（第三批）

- 两种来源，接法一样，都是 ComfyUI 自带的接口：局域网那台在设置里填地址（比如 `http://192.168.1.20:8188`），存 `settings.json`；AutoDL Art 上租的实例见下面。
- 出图用哪台，在出图设置里选，记在本机 `config.json`（两台电脑可能不在同一个网络里），所有节点共用。
- 测试连接：`GET /system_stats`，显示 ComfyUI 版本、显卡和显存。
- 选项从 `GET /object_info` 读：底模（`CheckpointLoaderSimple` 的 `ckpt_name`）、VAE（`VAELoader` 的 `vae_name`）、LoRA（`LoraLoader` 的 `lora_name`）、采样器和调度器（`KSampler`）、放大模型（`UpscaleModelLoader`）、检测模型（`UltralyticsDetectorProvider` 的 `model_name`，装了插件才有）、SAM 模型（`SAMLoader` 的 `model_name`，装了插件才有）、ControlNet 模型（`ControlNetLoader`）、提取方式（`AIO_Preprocessor` 的 `preprocessor`，装了插件才有）、IP-Adapter 模型（`IPAdapterModelLoader`，装了插件才有）、CLIP Vision 模型（`CLIPVisionLoader`）、反推模型（`WD14Tagger|pysssss` 的 `model`）。打开出图设置时读；同一台缓存起来，点「刷新」或换了地址才重读。列模型的那几种节点（底模、VAE、LoRA、放大、检测、SAM、ControlNet、IP-Adapter、CLIP Vision）读完整份以后再一种一种要一次（`GET /object_info/<节点类型>`）：AutoDL 那台的 ComfyUI 改过，整份缓存着，只在底模、LoRA 这几类文件夹最外层变了时重做，新放的放大、检测模型和放进子文件夹的不在里面。
- 底模属于哪个系列：设置里列出读到的底模，每个选 IL、Pony 或都不是，存 `settings.json` 的 `checkpoints`（都不是存 null）。没标过的按文件名猜，不分大小写：名字里有 pony 的当 Pony；有 illustrious、noob、wai，或者单独一个 IL（比如 IL-xxx、xxx_IL）的当 IL；别的两个都不是。节点的底模下拉只列这个系列的，都不是的哪里都不列。
- AutoDL：
  - 开发者 Token 只存本机 `config.json`，和模型密钥一样不进工作文件夹；实例 uuid 和空闲多久关机（默认 15 分钟）存 `settings.json`。
  - 填了 Token 后列出账号下的实例（`POST https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/list`，请求头 `Authorization: <Token>`），选一个。显卡和每小时的价格从各自的快照里取，价格的单位是千分之一元。
  - 状态用 `GET …/pro/status`：`running` 是开着，`shutdown` 是关了。运行中时从 `GET …/pro/snapshot` 取 6006 端口的访问地址（`service_6006_domain`，只有域名和端口，前面加 `https://`），当 ComfyUI 地址用。
  - AutoDL 出错时 HTTP 也是 200，看返回的 `code`：Token 不对是 `AuthorizeFailed`，实例不存在是 `RecordNotFoundError`，`msg` 是原话。余额不够的 `code` 文档没写，按原话里有没有「余额」认。开机时那台主机没有空闲显卡的也没写，按原话里有没有「资源不足」，或者同时说到「GPU、显卡」和「不足、不够、占满、没有空闲」认，说余额的不算。
  - 出图时实例关着：先开机（`POST …/pro/power_on`，`{instance_uuid, payload: "gpu"}`），每 5 秒查一次状态；变成运行中以后，再等到 ComfyUI 的 `/system_stats` 能通，然后发任务。超过 5 分钟没好算失败。界面上显示「正在开机，等了 N 秒」。
  - 设置里和出图设置里都能手动开机、关机（`POST …/pro/power_off`）。正在开机时点「别开了」：等着开机的图算叫停，已经发出的开机请求等它开好后马上关掉。
  - 自动关机：实例开着，程序这边最后一个任务结束后空闲到设定的分钟数，就关机。实例不是程序开的、程序这边也没出过图的，从程序看到它开着时算起。到点时先看一眼 ComfyUI 的队列（`GET /queue`）：里面有任务（比如在 ComfyUI 网页上直接出的图）就不关，过一分钟再看；队列空了，从最后一次看到有任务时起再空闲到设定的分钟数才关。看不了队列（ComfyUI 连不上）照常关。服务退出时（Ctrl+C、关掉窗口），这次开机是程序开的、又没见它关掉，先发关机请求再退出。程序没开着时管不了，所以界面上要一直看得到实例开着。
  - 访问地址要不要另外鉴权、ComfyUI 是不是开机就自己起来、跑在哪个端口，文档没写。P11 开工前先用用户的真实例核对，结果写进 P11 的报告。
  - 出错要说清是哪种，带上 AutoDL 返回的原话：Token 不对、实例不存在、余额不够开不了机、开机超时。主机没有空闲显卡的，提示去设置里另选一台（出图那台还可以先用局域网那台），也可以过一会再开。

### 5.18 工作流（第三批）

- 内置流程：程序自己拼 ComfyUI 的 API 格式 JSON，只用 ComfyUI 自带的节点。`CheckpointLoaderSimple` → 每个 LoRA 一个 `LoraLoader`，串起来 → `CLIPSetLastLayer`（`stop_at_clip_layer` 是 clip skip 取负）→ 正面、负面两个 `CLIPTextEncode` → `EmptyLatentImage`（尺寸，`batch_size` 1）→ `KSampler`（种子、步数、CFG、采样器、调度器，`denoise` 1）→ `VAEDecode` → `PreviewImage`。用 `PreviewImage` 是为了不在 ComfyUI 那台机器上留文件，它的临时目录在 ComfyUI 重启时会清掉。
- 正面 = 系列固定开头 + 评级词（选了才加）+ 框里的标签（5.15 拼出来的那串）；负面 = 系列默认负面词 + 节点的额外负面词。
- 出几张就发几个任务，种子依次加 1；种子是随机时，第一个随机取。每张的种子都记下，图上能「同样参数再来」（同一个种子）和「只换种子再来」。
- 各系列的默认值存 `settings.json`，设置里能改。初始值按两个系列常见的用法填，P10 对照官方说明核对过（结果见 `docs/reports/P10.md`）：

| | IL | Pony |
| --- | --- | --- |
| 固定开头 | `masterpiece, best quality` | `score_9, score_8_up, score_7_up, source_anime` |
| 默认负面词 | `lowres, worst quality, bad quality, bad anatomy, bad hands, extra digits, jpeg artifacts, signature, watermark, username, text` | `score_6, score_5, score_4, worst quality, low quality, watermark, signature, text` |
| 评级词（全年龄、擦边、成人） | `general`、`sensitive`、`explicit` | `rating_safe`、`rating_questionable`、`rating_explicit` |
| 步数、CFG | 28、5 | 25、7 |
| 采样器、调度器 | `euler_ancestral`、`normal` | `euler_ancestral`、`normal` |
| clip skip | 2 | 2 |

- 导入的工作流：
  - 只认 API 格式，就是在 ComfyUI 里用「导出（API）」存下来的 JSON，顶层是「节点号 → `{class_type, inputs}`」。导进来的是普通工作流文件（顶层有 `nodes`、`links`）时，提示「请在 ComfyUI 里用「导出（API）」再存一份」。
  - 程序自动找往哪填：顺着 `KSampler`（或 `KSamplerAdvanced`）的 `positive`、`negative` 连线找到两个 `CLIPTextEncode` 的 `text`，中间隔着 ControlNet、合并条件这类节点也顺着找过去；`KSampler` 的 `seed`（`KSamplerAdvanced` 是 `noise_seed`）；`EmptyLatentImage` 的 `width`、`height`。找不到或者有好几个候选的，导入窗口里列出节点（节点号、类型、`_meta.title`）让用户选，有候选的先选上第一个。正面一定要有，其他几项可以不填。
  - 存到工作文件夹 `workflows/<id>.json`，名字不能重。设置里能改名、重新指定往哪填、删除（挪进 `.trash`，用它的节点出图时换回内置流程）。
  - 出图时只改这几个值，其他照原样；张数和种子照内置流程的做法。系列固定开头和默认负面词照样加，填的是整个 `text`，工作流里原来写的会被换掉。
  - 选了导入的工作流，出图设置里底模、LoRA、步数这些不显示，照工作流里的。放大、部位重绘、ControlNet、图生图、局部重绘只用内置流程。
- 发任务前对照 `/object_info`：工作流里有这台 ComfyUI 上没有的节点类型，直接说缺哪几个，不发。节点列表是缓存的，说缺之前先重读一次，刚装好插件的不用手动刷新。内置流程用到插件节点时（5.21）也一样。

### 5.19 出图任务（第三批）

- 点「生图」：服务端按节点的出图设置和这个框拼好参数，建一个 `ImageJob` 挂到这条 assistant 消息的 `images` 里，每张图一项，状态是排队，存盘后返回；然后逐张 `POST /prompt`（带本程序的 `client_id`），记下每张的 `prompt_id`。
- 一个框可以点好几次生图，每次一个 `ImageJob`，按时间排。
- 进度：服务端对每台 ComfyUI 开一个 WebSocket（`/ws?clientId=`），收 `executing`、`progress`（第几步、共几步）、`execution_success`、`execution_error`、`execution_interrupted`；排在第几用 `GET /queue` 算。前端从 `GET /api/image-jobs/events`（SSE）收变化。进度和排队位置不存盘。
- 出完一张：`GET /history/{prompt_id}` 找到输出的图，`GET /view` 下载下来，存进临时文件夹（5.20），这一项改成完成。导入的工作流可能既有预览又有存图，取最后一张存图（`type` 是 `output`），没有存图的取最后一张预览。
- 叫停：还在排队的从 ComfyUI 的队列里删掉（`POST /queue`，`{delete: [prompt_id…]}`）；正在跑的 `POST /interrupt`。新版 ComfyUI 的 `/interrupt` 能带 `prompt_id`，只停这一个，接的时候核对；老版本不认，会停掉 ComfyUI 当前正在跑的任何任务。已经出完的图留着。
- 出错要说清是哪种，带上原话：
  - 连不上：地址不对，或者 ComfyUI 没开；
  - `/prompt` 返回 `node_errors`：写出是哪个节点哪一项，比如底模文件不在；
  - 执行出错：错误里有 out of memory 的说显存不够；
  - 缺节点（5.18）。
- 服务重启后，没完的项按 `prompt_id` 查一次 `/history`：出完了就取图；还在 ComfyUI 队列里就接着等；都不在就标失败「程序重启时这张还没出完」。接着等靠的是 `client_id` 不变：第一次连 ComfyUI 时随机生成一个存进本机 `config.json`，以后都用它，ComfyUI 才会把重启前发的任务的进度推给新连上的 WebSocket。
- 首页打过星的生图框能「再出图」：用那个节点现在的出图设置再发一个 `ImageJob`。

### 5.20 出的图：临时文件夹和下载（第三批）

- 出的图存在工作文件夹 `image-temp/YYYY-MM-DD/`，文件名 `HHmmss-<种子>.png`，重名加 `-2`。程序不自动删；设置里显示这个文件夹的路径，能在资源管理器里打开。
- 下载：和拼图保存一样，弹系统窗口选文件夹（记住上次，存本机 `lastDownloadFolder`），复制过去，文件名 `<节点标题>-<种子>.png`，文件名里不能用的字符换成 `_`，重名加序号。那个文件夹不在资产库里，问要不要导入。下载过的图上标「已下载」，`savedPath` 记下存到哪。能多选几张一起下。
- 用户清了临时文件夹：列图时看文件还在不在；不在的，下载过就改用下载的那份，没下载过显示「已清理」。参数还在，照样能「同样参数再来」。
- 一张图能单独打星，意思是这张好；框下面和首页列图时，打过星的排在前面。
- 视频节点的槽位只从资产库选图，所以出的图要先下载才能放进去。
- 节点里删一张图：从 `ImageJob` 里去掉这一项，临时文件直接删，不进 `.trash`；下载过的那份不动。一组里一张不剩了整组去掉。还没出完的不能删，先叫停。
- 出的图属于出图的那个节点和那条回复：岔出去的节点、手动改提示词生成的新版本，都不带原来出的图。

### 5.21 放大、部位重绘、预设、ControlNet、图生图、局部重绘、反推（第三批）

为什么这么定见访谈记录已定第 25 到 28 条、第 35、36 条。都只用内置流程。

- 内置流程按顺序是这几段，没开的不拼：起图（文生图，P17 起能选图生图）→ ControlNet（P15）→ 采样 → 解码 → 放大 → 部位重绘 → `PreviewImage`。用到插件节点的，发任务前照 5.18 对照 `/object_info`，缺了说缺哪个节点、要装哪个插件，一张都不发。
- 放大，像 WebUI 的高清修复。出图设置里一段：开关、放大模型（`UpscaleModelLoader` 的列表）、倍数（1.5 或 2）、重绘强度（0 到 1，打开时默认 0.35）。
  - 流程：`UpscaleModelLoader` + `ImageUpscaleWithModel` → `ImageScale`（lanczos）缩到出图尺寸乘倍数，取 8 的倍数 → 重绘强度大于 0 时接 `VAEEncode` → `KSampler`（底模、提示词、种子、步数这些同原图，`denoise` 是重绘强度）→ `VAEDecode`。强度是 0 就只放大不重画，E02 就是这样。
  - 只用自带节点，加一个放大模型。
- 部位重绘，像 WebUI 的 ADetailer。出图设置里一个列表，能加几道、删掉、上下挪，按顺序做。每道：开关、检测模型（`UltralyticsDetectorProvider` 的列表，比如 `bbox/face_yolov8m.pt` 找脸、`bbox/hand_yolov8s.pt` 找手、`segm/person_yolov8m-seg.pt` 找人）、检测阈值（默认 0.3）、重绘强度（默认 0.4）、重画尺寸（检测到的地方放大到多大再画：512、768、1024，默认 1024）、正面、负面。新加一道时检测模型先选列表里第一个名字带 face 的。
  - 每道一个 `UltralyticsDetectorProvider` + `FaceDetailer`。`FaceDetailer` 名字叫修脸，换个检测模型什么部位都能修。底模、LoRA、种子、步数、CFG、采样器、调度器同原图。`bbox/` 下的检测模型重画整个框；`segm/` 下的另接 `segm_detector_opt`，只重画轮廓里面。默认不用 SAM，P16 起能选（见下面「E02 的几样」）。其余参数照 E02：`bbox_dilation` 10、`bbox_crop_factor` 3、`feather` 5、`noise_mask_feather` 20、`max_size` 1024、`drop_size` 10。
  - 这道写了正面，就换掉框里的标签；写了负面，就换掉额外的负面词；系列固定开头、评级词、默认负面词照样加（5.18）。没写的用原图的。
  - 画面里检测到几个就重画几个；一个都没检测到，这道什么都不做。
  - 要装 Impact Pack 和 Impact Subpack，检测模型放进 ComfyUI 的 `models/ultralytics/bbox` 或 `segm`。
- 出完的图上补做：大图窗口里点「放大和重绘」，弹出的窗里是节点现在的放大和各道部位重绘，能关掉、能改，点「开始」再发一个任务，`kind` 是 `refine`，`source` 记从哪张图来，出的图挂在同一个框下面。
  - 流程：先用 `/upload/image` 把那张图传上去，`LoadImage` → 放大 → 部位重绘 → `PreviewImage`。放大和部位重绘至少开一样。底模、LoRA、提示词、种子这些用原图那一组记的；原图是导入的工作流出的，用节点现在的出图设置。
  - 原图的临时文件清掉了、也没下载过，按钮不能点。
  - 补做出的图上「同样参数再来」「只换种子再来」，是把原图重新传上去再补做一次；原图删了的提示没法再来。
- 预设：出图设置整套存成一个名字，存在工作文件夹 `image-presets.json`，两台机器共用。
  - 存张数、种子以外的全部出图设置，ControlNet 的参考图也不存；按系列分开，套用时只列这个节点那个系列的。
  - 出图设置顶上「预设」：选一个就套上，节点留自己的一份，套完再改不影响预设；「存成预设」起名字，名字重了问要不要换掉原来的。
  - 设置里「预设」一节：列出全部，能改名、删除。
  - P12 做好后把 E02-文生图-SDXL 存成「E02」：底模、两个 LoRA、20 步、CFG 4、euler_ancestral、karras；尺寸取九档里最近的 832×1216；放大开，`4x_foolhardy_Remacri.pth`、2 倍、重绘强度 0；部位重绘两道，检测模型都是 `bbox/face_yolov8m.pt`，第一道阈值 0.2、强度 0.5、重画尺寸 1024，第二道阈值 0.5、强度 0.5、重画尺寸 512。E02 的负面词里跟它那张图内容有关的（衣服、人数、体液、发色眼睛这些）不带，通用的（画质、手脚、文字、塑料感这些）去掉和 IL 默认负面词重复的，写进额外的负面词。P16 做好后「E02」的尺寸改成 864×1280，下面 E02 的几样全打开。
- E02 的几样（P16）：E02 有、内置流程原来没照做的，都做成出图设置里能选的，新节点默认照现在。不是默认的才记进这一组的参数，大图参数里列出来；出完的图上补做照原图那组的。
  - 部位重绘每道能选用 SAM 把框收成形状，模型从 `SAMLoader` 的列表里选（E02 用 `sam_vit_b_01ec64.pth`，`device_mode` 是 AUTO），接 `FaceDetailer` 的 `sam_model_opt`。选了 SAM 的，segm 的检测模型也改用 SAM（`FaceDetailer` 两个都给时只用 SAM）。
  - 带权重的标签怎么算，放在「很少动的」里：ComfyUI 自带的，或者 A1111 的（`BNK_CLIPTextEncodeAdvanced`，`weight_interpretation` 是 A1111，`token_normalization` 是 none，要装 ComfyUI_ADV_CLIP_emb 插件）。正面、负面、部位重绘自己写的提示词都换成它。
  - VAE，放在「很少动的」里：底模自带的，或者从 `VAELoader` 的列表里单独选一个（E02 用 `sdxl_vae.safetensors`）。解码、放大重画、部位重绘都用它。
  - LoRA 作用在哪，挂了 LoRA 时在 LoRA 下面选：画图的模型和文字理解都作用，或者只作用在画图的模型上（`LoraLoaderModelOnly`，文字理解用底模原来的）。
  - 尺寸九档后面加「自己填」，点开填宽高，取最近的 8 的倍数，照 WebUI 能填 64 到 2048。
- ControlNet（P15），像 WebUI。出图设置里 LoRA 下面一个列表，能加几个、去掉，按顺序接。每个：开关、类型、参考图、提取方式、模型、强度（默认 1）、起止（默认 0 到 1）。
  - 类型：姿势、深度、线稿、边缘、其他；画风 P17 加。类型决定下拉里列哪些：
    - 提取方式从 comfyui_controlnet_aux 插件的 `AIO_Preprocessor` 列表里按名字挑：姿势是名字带 Pose 的和 DWPreprocessor，深度是名字带 Depth 的，线稿是名字带 LineArt 的，边缘是 Canny、HED、PiDiNet、TEED、Scribble、M-LSD 这类；「其他」全列。另有「不提取，直接用这张」。新加一个时，姿势选 DWPreprocessor，深度选 MiDaS-DepthMapPreprocessor，线稿选 AnimeLineArtPreprocessor，边缘选 CannyEdgePreprocessor，列表里没有就选这一类的第一个；「其他」选不提取。
    - 模型从 `ControlNetLoader` 的列表里挑：名字对得上类型的在前（姿势 pose，深度 depth，线稿 lineart，边缘 canny、hed、softedge、scribble），再列名字带 union 的，一个都对不上时全列；「其他」全列。新加一个时选名字对得上类型的第一个，没有就空着，自己选。
  - 参考图从节点槽位里的图或这个节点出过的图里选一张。发之前用 `/upload/image` 传上去，文件名按内容算，同一张传几次都是同一个名字。
  - 流程：`LoadImage` → `AIO_Preprocessor`（分辨率取出图尺寸的短边；不提取的不接）→ `ControlNetLoader`（名字带 union 的再接 `SetUnionControlNetType`：姿势 openpose，深度 depth，线稿 canny/lineart/anime_lineart/mlsd，边缘里 Canny、M-LSD 是 canny/lineart/anime_lineart/mlsd、别的是 hed/pidi/scribble/ted，其他 auto）→ `ControlNetApplyAdvanced`（强度、`start_percent`、`end_percent`），几个按顺序串起来接在正负面后面。放大时重画那一遍也用加了 ControlNet 的正负面；部位重绘、出完的图上补做不用。
  - 开着的没选参考图或模型，点生图时说「ControlNet 第 2 个还没选参考图」这样，不发。参考图后来删了，或者临时文件清掉了又没下载过，这组算失败，说是第几个 ControlNet 的参考图找不到了。
  - 一组图记下开着的 ControlNet，大图参数里列出来；「同样参数再来」「只换种子再来」照记的参考图重新传。预设不存参考图，套用后要重选。
  - 要装 comfyui_controlnet_aux 插件；全都选了「不提取」的不用。缺了照 5.18 说缺哪个节点、要装哪个插件。
  - 提取方式要用的模型，插件第一次用时自己从 HuggingFace 本站下。AutoDL 那台连不上本站，用之前要先放进插件的 `ckpts` 文件夹，不然出错，照常显示 ComfyUI 的原话。
  - 出图设置的说明里写推荐的模型：IL 用 NoobAI-XL 出的 ControlNet（比如深度 `Eugeoter/noob-sdxl-controlnet-depth_midas-v1-1`、姿势 `Laxhar/noob_openpose`），Pony 用通用 SDXL 的（比如 xinsir 出的 union，一个文件管好几种）。
- 画风（P17）就是原来的画风参考，WebUI 里它也在 ControlNet 里：`IPAdapterModelLoader` + `CLIPVisionLoader` + `IPAdapterAdvanced`（`weight_type` 用 style transfer），接在底模后面，模型从这两个节点的列表里选。说明里写推荐的模型：IL 用 NoobAI 的 IP-Adapter，Pony 用 `ip-adapter-plus_sdxl_vit-h`。
- 图生图（P17）：出图设置里起图选「文生图」或「图生图」；图生图选一张参考图（来源同 ControlNet）和重绘强度（默认 0.6）：`LoadImage` → `ImageScale` 缩放裁切成出图尺寸 → `VAEEncode` → `KSampler`。只用自带节点。
- 局部重绘（P18）：在一张出的图上点，大图窗口进掩码模式，**拖框和涂抹两个工具都能用**（详见 5.35）。用画笔涂要重画的地方，笔刷能调大小，能擦、能清空；也能在图上按住拖一个矩形、拖动、拉手柄缩放；两种能叠加。再填这块要画成什么（默认是原图框里的标签，正面、负面照普通出图加固定开头和负面词）和重绘强度（`denoise` 默认 1；调到 0.5 到 0.8 保留原来的轮廓、只改细节）。
  - 发的时候程序把原图涂过的地方改成透明（只改透明度，颜色照留），存成 PNG 放进临时文件夹，用 `/upload/image` 传上去，`LoadImage` 把透明的地方当遮罩。
  - 流程照 AutoDL 实例上修好的 E05：`LoadImage` → `InpaintCropImproved`（只裁出遮罩附近一块：周边多带 1.5 倍，遮罩外扩 8 像素，缩放到 1024×1024）→ `InpaintModelConditioning`（普通底模也能用）→ `KSampler`（底模、LoRA、步数这些同原图，原图是导入的工作流出的就用节点现在的出图设置；种子随机）→ `VAEDecode` → `InpaintStitchImproved`（缩回去拼回原图，边缘羽化 32 像素，遮罩附近以外保持原图像素）→ `PreviewImage`。
  - 要装 ComfyUI-Inpaint-CropAndStitch 插件。节点名和参数名，开工前对照 E05 的 JSON 核对。
  - 「同样参数再来」「只换种子再来」重新上传存下的那张 PNG，不用再涂。
- 程序不写死模型文件名，都从 `/object_info` 读到的列表里选，常用的组合存成预设。
- 反推（P17）：在标签编辑窗里「从图反推」（5.15）。要装 ComfyUI-WD14-Tagger 插件：`LoadImage` → `WD14Tagger|pysssss`（`threshold` 0.35，`character_threshold` 0.85，模型用设置里选的），从 `/history` 的输出里拿标签串，按 5.15 拆开、校验。

### 5.22 往 AutoDL 那台传模型（第三批）

为什么这么定见访谈记录已定第 29 到 31 条。只管 AutoDL 那台；局域网那台直接往它的文件夹里拷。

- 那台现有的模型是 AutoDL 公共模型库链接过来的，只读。自己传的放进下面这些文件夹，那台镜像的 `extra_model_paths.yaml` 里配好了，ComfyUI 会读。程序只列、只删这些文件夹里的普通文件，链接过来的不列。
  - 底模 `/root/autodl-tmp/models/checkpoints`，LoRA `…/loras`，放大 `…/upscale_models`，ControlNet `…/controlnet`，IP-Adapter `…/ipadapter`，CLIP Vision `…/clip_vision`，VAE `…/vae`。
  - 检测：找框的 `/root/ComfyUI/models/ultralytics/bbox`，找轮廓的 `/root/ComfyUI/models/ultralytics/segm`。
  - 文件夹不在先建。传的时候能写一个子文件夹（比如 `IL`），不写放最外层。子文件夹和文件名不许带 `..`、`/` 开头，不对返回 400。
  - 生成视频那台（第四批 P21）只能传 LoRA。它的 `/root/ComfyUI/extra_model_paths.yaml` 也是 `/root/autodl-tmp/models` 下的那套，LoRA 一样放 `…/loras`。设置「AutoDL 上的模型」选了生成视频的实例时，上面能切「出图那台 / 生成视频那台」，两台的列表和传输各是各的；接口在 `/comfy/video/models` 下，和出图那台的一样。
- 怎么连：经 SSH。地址、端口、用户从实例快照（5.17 的 `…/pro/snapshot`）的 `ssh_command` 里拆，密码是快照的 `root_password`；每次用时现查，不存、不写日志、不发给前端。实例关着时跟出图一样先开机（5.17）。传的时候、下的时候、排着的时候都算忙，不算空闲，不会被自动关机；顶上的 AutoDL 状态写「正在传模型」。
- 从这台电脑传：点「从电脑传…」，用浏览器的选文件窗口选一个，选类型，填子文件夹；文件名默认用原名，能改。点「传」时先问一次服务同名的有没有、空间够不够（关着的这时开机），过了才排上。排队在页面上，一次发一个；前端把文件一边读一边发给本机服务，服务一边收一边灌进那台上的 `cat > 文件`，收完了比一下那台上的大小对不对。传完前这个页面不能关，界面上写着。
- 给链接让那台下：点「给链接下…」，填链接，选类型，填子文件夹；文件名取链接最后一段（去掉 `?` 后面的），能改。`huggingface.co` 的链接换成 `hf-mirror.com` 再下。在那台上用 curl 下（跟着跳转），先取大小；进度每秒看一次已经下了多少。下不了时带 curl 的原话。说明里写着：那台连不上 Civitai 和 HuggingFace 本站，Civitai 上的先下到电脑再传。
- 两种共同的：
  - 从电脑传的一个一个来，给链接的也一个一个来，两种互不等。有进度，能停。
  - 先写成 `<名字>.part`，完了再改成真名字；停了、断了、出错了，删掉半截的。服务退出时没传完的留在那台上，列表里标「没传完」，能删。
  - 开始前看那台还剩多少空间（`df /root/autodl-tmp`），不够就不开始，说还差多少；给链接的取不到大小时不查。
  - 同名的已经有了，问要不要换掉。
  - 传完、下完、删了，重读一次 `/object_info`，出图设置里马上能选。底模照 5.17 按名字分系列。
- 列表：设置「生图」下面一节「AutoDL 上的模型」。顶上写那台还剩多少空间；下面按类型列出自己传的：名字、多大、什么时候传的（文件的修改时间）；能删，删前问一句。在传的和排着的列在最上面，有进度、能停。实例关着时列不出来，写「开机后才看得到」；「从电脑传」「给链接下」照样能点，点了先开机。

### 5.23 生图节点和视频节点分开（第三批）

为什么这么定见访谈记录已定第 32 到 34 条。

- 节点多一项类型 `kind`，是 `video` 或 `image`，建的时候定，之后不能改。面板、发给模型的说明、出图、卡片上标的字都看它，不再看系统提示词是哪种用途；生图节点的系列（IL 或 Pony）照旧看它选的系统提示词。
- 新建：工具栏的「新建节点」点开一个小菜单，两项「视频节点」「生图节点」。视频节点用新节点默认的那套系统提示词（`ref2va`）；生图节点用 `il`，`il` 删了用排在最前的生图提示词；一套生图提示词都没有时，点「生图节点」不建，提示「设置里还没有生图用的系统提示词」。
- 系统提示词的下拉只列这一种的。同一种之间照旧能换：生图节点在 `il` 和 `pony` 之间换，系列跟着换。服务端收到另一种的系统提示词返回 400。
- 岔出来的节点和原节点同一种。
- 节点用的系统提示词后来删了，或者说明段改了、用途变成了另一种：类型不变，下拉里照旧显示它，写着用不了，换一套同种的。
- 已有的节点按现在用的系统提示词归类：生图提示词的算生图节点，别的（包括提示词已经删了的）算视频节点。读的时候补上，下次存的时候写进文件。
- 卡片：视频节点标「视频」，生图节点照旧标「生图 · IL」这样带系列。生图节点的卡片边框用紫色，选中时照旧是选中的样子。紫色是新加的，明暗两套都要。首页最近动过的节点卡片不改。
- 设置的系统提示词列表里，两组的说明改成「写视频提示词 · 视频节点用」「写生图标签 · 生图节点用」。
- 生图节点里用户消息下面只写带了几张图，不写时长和比例（这两样不发给模型）。

### 5.24 长视频的分段写法（第四批）

为什么这么定见 `docs/requirements-interview-video.md`「第二步」已定第 5 条。

- 视频节点的时长能选 4 到 60 秒。超过 15 秒的分几段生成：16 到 30 秒 2 段，31 到 45 秒 3 段，46 到 60 秒 4 段。
- 时长中间的数字点开是个小窗，能直接填，也能点 15、30、45、60；超过 15 秒的，时长旁边写「分 4 段」。
- 发给模型的说明：时长超过 15 秒时写「视频时长 60 秒，分 4 段生成，每段约 15 秒，相邻两段重叠约 1 秒。」，改了时长写「视频时长改为 60 秒，分 4 段生成。」每段多长按 5.26 的算法。
- 固定格式要求（`docs/prompts/format-requirement.md`）加一条：分段时一个框里按顺序写全部几段，每段都是一份完整的提示词，段与段之间单独一行、只写一个 `|`；每段按这一段的时长写，切镜时间从这一段开头算；每段开头接着上一段结尾的画面写，人物在哪、朝哪、在做什么、镜头在哪都和上一段结尾一样，不要一开头就换地方或机位；人物外貌、服装、画风的写法每段一字不差；一句台词可以跨切镜，但不能跨段，每句台词都在同一段里说完。
- 五套视频提示词不改：工作文件夹里那几份是第一次用时复制过去的，改 `docs/prompts/` 里的到不了；固定格式要求每次现读，写在那里每个节点都生效。五套里说的「视频时长」，分段时由上面这条说明是指这一段的时长。
- 解析：框里单独一行只有 `|` 的地方切开，每段去掉首尾空行；没有这种行就是一段。框的显示、复制、翻译、打星照旧，`|` 那行原样显示。
- **时长以节点上那个为准，生成时现取**：写这条回复时的时长只用来写说明（`slotDiff` 的 note），生成视频时用的是节点现在的 `duration`。写完之后把时长拨大了再点「生成视频」，出的就是拨大的那个，不再偷偷用写的时候那个。
- **段数不够就拦住**：一段最长 15 秒（`MAX_CHUNK` 362 帧），框里写的段数少于时长要的段数时，出来的片子会比要的短。所以生成前拿 `lengthProblem(时长, 框里段数)` 比一下，不够就 400 拦下来，说清楚要几段、现在写了几段、这样出来只有多长、要么让模型重写要么把时长改成多少。界面在框上先显示同一句话，并把「生成视频」按住（`data-od-id="video-length-mismatch"`）。段数写多了不要紧（帧数按段数摊，总长照样对得上），只拦写少。

### 5.25 生成视频用的那台 AutoDL（第四批）

- 设置「ComfyUI 和 AutoDL」里加「生成视频用的实例」：从账号下的实例里选一个（和出图那台共用一个列表、一个 Token），和空闲多久自动关机（默认 15 分钟）。存 `settings.json` 的 `comfy.videoAutodl`。不能和出图那台选同一个，选了返回 400。
- 排在出图那台下面，也是选实例、状态和开机关机、空闲多久自动关机三行。另一台选了的实例在列表里灰掉，后面写「（出图在用）」或「（生成视频在用）」。
- 开机、关机、空闲自动关机、服务退出时关机、开机超时，规则照 5.17，两台各管各的。视频在跑、在等开机时算忙，不会被空闲关机。
- 顶上多一个视频那台的状态，没选时不显示；点开能开机、关机，跟出图那台一样。
- 只用 AutoDL，不支持局域网那台：H3 要 32 GB 显存的卡。

### 5.26 内置的长视频流程（第四批）

- 程序拼 ComfyUI 的 API 格式，照 `docs/workflows/h3-long-video.json`（实例上的 U37）的两遍生成，不要只给 ComfyUI 界面看的预览和说明节点：
  - 主模型 `UNETLoader`（`minimax/DasiwaMinimaxH3_dasiwaHybridTurboV2_int8.safetensors`）→ `ModelAttentionBackend`（comfy kitchen attention）→ `MiniMaxLowVRAMAttention`（8）→ `MiniMaxChunkFeedForward`（8、4096）。文字编码 `CLIPLoader`（`qwen3vl_32b_minimax_h3_int8_convrot.safetensors`，minimax），视频、音频各一个 `VAELoader`。
  - `MMH3ReferenceMultiPrompt`：几段提示词用 `\n|\n` 连起来，一采宽高，整条帧数，编完卸掉文字编码器。`MMH3CondSelect` 取第一段给 `BasicGuider`。
  - 一采 `MMH3LoopingSampler`：`RandomNoise`、`KSamplerSelect`（euler）、`BasicScheduler`（beta，10 步），每段帧数、重叠帧数，接缝用 mask 原样带上一段结尾（画面 1.0、声音 0.9）。
  - `LTXVSeparateAVLatent` → `MinimaxH3LatentUpscaler3D`（不解码放大，按目标宽高放，宽高是程序算好的出片宽高）→ `LTXVConcatAVLatent`（声音用一采的）。
  - 二采 `MMH3LoopingSampler`：同样的分段，`BasicScheduler` beta 3 步、去噪 0.2。
  - `VAEDecodeAudio`（一采的声音）+ `MMH3StreamingSave`（一段一段解码直接写 mp4，存到那台 ComfyUI 的 `output/media-agent/`）。
- 帧数：H3 的帧数只能是 17 的倍数加 5。重叠固定 22 帧（0.92 秒）。段数 N 是框里切出来的段数，最多 4 段，多了不发，说「这个框分了 5 段，最多 4 段」。每段帧数 =（时长 × 24 + (N − 1) × 22）÷ N，取最近的 17 的倍数加 5，最多 362（15.08 秒）、最少 107。整条帧数 = N × 每段帧数 − (N − 1) × 22。60 秒 4 段是 1382 帧，57.6 秒；15 秒 1 段是 362 帧。
- 一采宽高照 ComfyUI 自带的 `ResolutionSelector` 算：宽 = √(一采大小 × 1024² × 宽比 ÷ 高比)，高 = √(一采大小 × 1024² × 高比 ÷ 宽比)，各取最近的 32 的倍数。16:9、0.4 是 864×480。比例是「自动」的按 16:9。出片宽高 = 一采宽高 × 放大倍数，各取最近的 32 的倍数，正好一半的往大取（0.4、放大 1.5 是 1312×736），用目标宽高的方式（`target dimensions`）传给 `MinimaxH3LatentUpscaler3D`，界面上写的就是出来的大小。U37 用的是按倍数放；按目标宽高放在 P19 的真机测试里跑过，出来的大小对。
- 一采、二采用同一个种子。
- 发之前照 5.18 对照 `/object_info`，缺的节点说要装哪个插件。
- 槽位的图怎么用，跟着写这条回复的那套提示词（回复记下的系统提示词名字）：
  - 参考模式（`ref2va`）：这条回复的槽位快照里的图都当参考图，按 `<Picture N>` 的顺序，每段都带。接进 `MMH3ReferenceMultiPrompt` 的 `ref_images`：一张直接接 `LoadImage`；几张用 KJNodes 的 `ImageTensorList` 一张张接成一串，这样每张保持自己的比例，不会被裁成第一张的大小。参考图大小用 `match`。
  - 图当首帧（`i2v`）：只用第一张。照 U37 接在一采 `MMH3LoopingSampler` 的 `keyframes`，`keyframe_indices` 是 0，钉在第 0 帧；二采不接。这一套写的提示词第一行说 `<Picture 1>` 在第 0 秒，所以这张也当参考图接进 `ref_images`。比例是「自动」的，一采宽高按这张图的宽高比算；比例选了固定的照选的，图会被拉成这个比例。
  - 纯文字（`t2v`）：不带图。
  - 首尾帧（`fl2va`）、尾帧（`l2va`）：还不支持，说「首尾帧、尾帧这两种提示词写的还不能生成视频，现在支持参考模式、图当首帧和纯文字」，不发。框下面也这么写。
  - 自己建的提示词按名字开头认，比如「i2v-慢节奏」算图当首帧；认不出的按参考模式。
- 图用画布里存的那份（已经按 H3 的要求处理过），等那台开好后传给它的 ComfyUI（`/upload/image`，文件名按内容算）。画布里那份被删了的这条算失败，说「第 N 张参考图找不到了」。
- 带的图记在 VideoJob 的参数里（`refs`、`firstFrame`，存图的 id），「同样参数再来」照样带。框下面没生成过时写上「带 2 张参考图」或「第 1 张图当首帧」。

### 5.27 生成视频任务（第四批）

- 视频节点的提示词框上加「生成视频」。点了：服务端按这个框、这条回复的时长和比例、节点现在的生成设置拼参数，建一个 `VideoJob` 挂到这条回复的 `videos`，状态是排队，存盘后返回；然后等视频那台开好（关着的先开机，照 5.17），`POST /prompt`。
- 一个框能生成好几次，每次一条。
- 进度：视频那台也开一个 WebSocket（`client_id` 和出图共用）。从 `executing` 的节点号知道在做哪步：编码提示词、一采、放大、二采、存文件；一采、二采的 `progress` 是这一段第几步、共几步，步数变小了就是到了下一段。前端显示「一采 第 2/4 段 5/10 步」和跑了多久。进度不存盘。
- 出完：从 `/history` 找到 `MMH3StreamingSave` 出的 mp4，`/view` 下载，存进工作文件夹 `video-temp/YYYY-MM-DD/HHmmss-<种子>.mp4`。那台 output 里的那份不删。
- **一采出完先出一版低清预览**：流程里再加一个 `MMH3StreamingSave`（节点 22），接的是一采那份潜变量、`crf` 28，文件名前缀 `media_agent_<jobId>_preview`。它比二采先跑完，服务端收到它的 `executed` 就把这一份 `/view` 取回来存进 `video-temp`，记在 `VideoJob.preview` 上。界面在二采跑着的时候就把这一版画成能播的播放器（`GET …/videos/:jobId/preview`），并写着「这是一采（低清）出的整条，二采还在跑。看着不行就现在叫停，这一版归你」。取预览失败不算这条失败，成片照样取。
- **叫停不白费**：正在跑的、排着的、`/history` 里看到被打断的，三条路都走同一个 `stoppedChange`——已经拿到 `preview` 的就把它转正成 `file` 并记 `partial: true`。这样二采途中叫停，手上是一条整条的低清版，能播能下载，不用把十几分钟的显卡钱丢掉。界面在下面写「这是叫停时留下的一采低清版，二采没跑完。想要高清的，同样参数再来一遍」。
- 叫停、出错的说法、服务重启后接着等，照 5.19。
- 「同样参数再来」用同一个种子，「只换种子再来」随机一个，参数都照那一条的。
- 生成设置在节点面板里，放在生图节点放出图设置的地方：一个按钮，上面写着出片多大，比如「出片 1728×960」；点开改加速还是不加速、一采、二采每段几步（自己填）、一采大小（下拉，每项带出这个比例下的宽高）、放大倍数（1.5 或 2）、种子（每次随机或固定一个数），下面也写出片多大。每个节点各存一份。
- 生成设置里还能换主模型、挂 LoRA（第四批 P21）：
  - 列表从生成视频那台的 `/object_info` 读（`GET /comfy/video/options`），关着时读过的照样给，有「刷新」重读。
  - 主模型只列 `UNETLoader` 里 `minimax/` 下的 H3 模型，默认 DaSiWa Hybrid Turbo V2 int8，能按名字搜。步数、采样器不跟着变；换官方模型要加速的，自己挂加速 LoRA。
  - LoRA 能挂几个，各带强度（默认 0.8），能按名字搜，列 `LoraLoaderModelOnly` 能选的。流程里每个一个 `LoraLoaderModelOnly`，照 U37「8 步加速」那个的位置，串在主模型和 `ModelAttentionBackend` 之间，只作用在主模型上。
- 生成设置最上面能切「加速 / 不加速」（P21b，为什么见 `docs/requirements-interview-video.md` 第六步）：
  - 加速：DaSiWa V2 加速版（`DasiwaMinimaxH3_dasiwaHybridTurboV2_int8`），一采每段 10 步，二采每段 3 步。默认是这个。
  - 不加速：DaSiWa V2 完整版（`DasiwaMinimaxH3_dasiwaHybridV2_int8`），一采每段 20 步，二采每段 6 步。
  - 两种都不开 CFG，采样器、调度器、二采的降噪 0.2、放大都一样。切的时候主模型和一采、二采的步数一起换成这个预设的，换完两样都能手动改。
  - **步数能自己填**（「步数」那一节）：一采 1–50、二采 1–20 的整数，填完存进 `VideoSettings.steps`。取的时候 `stepsOfSettings(settings)`：`steps` 有就照它，没有（没改过）才照 `VIDEO_SPEEDS[speed].steps` 那个预设——这样以前存过的节点（speed 是 full 但没 steps）照样是 20/6，不会被默认值悄悄改掉。切加速/不加速会把 `steps` 一并写成预设的值，也就是覆盖掉自己改的（和主模型一个规矩）；小节右边写着「现在是照「加速」」还是「现在是自己改的」。
  - 每段几步记进 VideoJob 的参数（`steps`），「同样参数再来」、重拍照着发。以前出的没记，按加速的算。
  - 预计还要多久：每步用时两种一样，按这一条的步数乘记下的每步用时算，不分开记。步数改大了预估跟着涨，因为记的是每步用时。

### 5.28 出的视频（第四批）

- 框下面列出这个框生成的视频，按生成的先后。没出完的写在做什么（排第几、正在开机、编码提示词、一采 第 2/4 段 5/10 步、放大、二采、存文件）和跑了多久，能叫停；出完的是能播放的视频，写着出片宽高、多长、多大、种子、用了多久，能下载、同样参数再来、只换种子再来、删掉；失败的写原因。
- 下载照 5.20：弹系统窗口选文件夹（和出的图共用上次那个文件夹），复制过去，文件名 `<节点标题>-<种子>.mp4`，重名加序号；下载过的标「已下载」。视频不进资产库，不问要不要导入。
- 删掉：临时文件直接删，下载过的那份不动；没出完的先叫停。临时文件清掉了的，下载过就播下载的那份，没下载过显示「已清理」。
- 岔出去的节点、手动改提示词生成的新版本，都不带原来的视频。

### 5.29 视频任务小窗（第四批）

- 画布页顶上视频那台的状态旁边加一个「视频任务」按钮，有在做或排着的时候写条数，比如「视频任务 2」。没选生成视频那台时不显示。
- 点开是个小窗，列出所有画布的视频任务。上面是在做的和排着的，按点生成的先后；下面是这次开程序以后完了的（出完、失败、已叫停），新的在上，最多 10 条。
- 每条写：画布名、节点标题、第几个框、多长、出片宽高；在做什么（等开机、排第几、编码提示词、一采 第 1/2 段 4/10 步、放大、二采、存文件）、跑了多久、预计还要多久。在做的和排着的能叫停。点一条跳到那个画布、那个节点，框下面那条视频闪一下。
- **完了的那条在小窗里就能直接播、直接下**：出完的，和叫停时留下一采低清版的（`partial`），行尾两个按钮——「播放」跳到那个节点看这条，「下载」直接弹下载小窗。别的画布上那条也能下：`VideoDownloadTarget` 带上 `canvasId`，`DownloadDialog` 用它而不是当前画布。
- 预计还要多久：每条出完记下各步用了多久（编码提示词、一采每步、放大、二采每步、存文件），存在工作文件夹的 `video-timings.json`，同样出片大小、同样段数的只留最近 5 条。估的时候用最近一条同样大小、同样段数的：还没到的步照那条的用时，正在做的一采、二采按剩下的步数乘那条每步的用时。排着的再加上前面每条剩下的。没有能比的写「第一次出这个大小，估不出」。
- 服务端：`GET /api/video-jobs` 返回在做的、排着的和这次开程序以后完了的，带画布名和节点标题；之后的变化照旧走 `GET /api/video-jobs/events`。框下面那条照旧。

### 5.30 重拍一截（第四批）

试验和量出来的数在 `docs/reports/reshoot-segment.md`，试验用的流程在 `outputs/reshoot/run.mts`（`fastGraph` 重拍整段，`midGraph` 重拍段中间一截）。

- 每条视频出的时候都存一采、二采的结果：流程里加两个 `MiniMaxH3NativeLatentCheckpointSaveT8Advanced`，分别接一采、二采的输出，文件名前缀 `media_agent_<jobId>_pass1`、`media_agent_<jobId>_pass2`，存在视频那台的 `output/MiniMaxH3/latent_checkpoints/` 下。出完从 `/history` 拿到两个路径，记进 VideoJob 的 `latents`。存一次约 1 秒。两段 30 秒、出 1312×736 的一共约 108MB（一采 32MB、二采 75MB），60 秒、出 1728×960 的估计 0.5GB 左右。
- 删掉视频时，那台开着就经 SSH 删掉这两个文件；关着的记进工作文件夹的 `video-latents-trash.json`，下次开机删。
- 视频下面一条时间条，按段画好分隔，拖选一截。起止对齐到潜空间帧，约 0.15 秒一格；下面写「重拍 8.0 到 11.0 秒，在第 1 段」。拖的时候视频跟着跳到那一帧。
- 选好后能改种子（默认随机）和这一截所在段的提示词（默认原来的；跨两段的两段都能改），参考图沿用原片的。点「重拍这一截」建一个新的 VideoJob，`parent` 是原片，`reshoot` 记着在哪一版上重拍（`base`）和对齐后的起止帧，照常排队、显示进度、能叫停。
- 服务端拼重拍的流程：
  - 读回原来那条的一采、二采存档。
  - 找出这一截落在哪几窗里，只把这几窗从存档里切出来算（`MMH3TrimAV`），从窗口开头切，分窗和原片对得上。
  - 遮罩：这一截白（重画），别的黑（保留），画面和声音用同一个；两遍的 `overlap_strength_audio` 都用 1。
  - 一采在切出来的一采存档上按遮罩生成。二采的输入是原片二采切出来的同几窗，只把重画的潜空间帧换成新一采放大后的（`LatentCut`、`ReplaceVideoLatentFrames`），再按同一个遮罩细化。
  - 拼回去：前后没动的部分从存档接上（`MMH3ConcatAV`，`trim_b_latents` 7，去掉重叠的 7 个潜空间帧）。声音用新一采的，只有这一截是新的。
  - 新的整条一采、二采也存成存档，这一版上还能再选一截重拍。
- 出完挂在原视频下面，作为它的一个版本：「原片」「重拍 8.0 到 11.0 秒」……点一下切换播放，每个版本都能下载、删掉。删原片时一起删它的各个版本。
- 存档没了（换了实例、实例被释放、被删了），点重拍时说「那台上没有这条的存档了，只能整条重出」。
- 只在我们这套长视频流程上能用。
- 重拍的那截只看得到前后接上的画面，那里看不到的东西可能和别处对不上，界面不另外提示。

### 5.31 视频和音频参考（第四批）

为什么这么定见 `docs/requirements-interview-video.md` 第三步。

- 资产库也列视频（mp4、mov、webm、m4v）和音频（mp3、wav、m4a、aac、ogg、flac）。视频的格子显示开头的画面，音频的格子是个图标，都标着「视频」「音频」。点选、多选、放进节点和图一样。
- 只有视频节点能放视频和音频。图的槽位下面一排「视频和音频」，视频最多 3 个、音频最多 3 个。从资产库挑、从电脑里选、从文件夹拖进来都行，和图混在一起选也行，各进各的槽位。
- 放进来时先复制一份进画布：`canvases/<id>/media/<sha>.<扩展名>`，同样内容的复用，记进 `media.json`。不转码、不截。
- 多长、宽高、视频有没有声音由浏览器读。读不出来的（浏览器放不了的编码）不收，说「x 读不出来，换成 mp4（H.264）或 webm 再试」；不到 2 秒的不收。
- 点一格弹出小窗：
  - 从开始那一秒播放试听。
  - 从第几秒开始取，默认 0。参考用的从这里取，最多 15 秒；配音从这里一直用到视频结束。
  - 视频还能填取到第几秒，没填的取到这段结束；开始挪到了它后面的，改回取到结束。用画面的视频按 H3 节点真用的帧数砍掉零头（17 帧一档：5、22、39…帧），取多少秒就真用多少秒，框旁边写「用 192 帧」。
  - 视频怎么用：只用画面（默认）、画面和声音、只用声音。没声音的视频后两项点不了。
  - 音频怎么用：声音参考（默认）、配音。配音只能有一个，另一个选了配音，原来那个变回声音参考。
  - 往前挪、往后挪、删掉。
- 参考模式下，这一排下面写用画面的视频各管成片前几秒，比如「视频 1 管成片前 8 秒。」：H3 的参考视频只管成片开头和它一样长的那一截，后面照提示词画。分段生成的，节点每段都从参考的开头管起，后面加「，分段的每段都从头管」。
- 编号照 H3 节点（`MMH3ReferenceMultiPrompt`）数的顺序：
  - 用画面的视频按顺序是 `<Video 1>`、`<Video 2>`。
  - 音频先数「画面和声音」的视频的声音，再数「只用声音」的视频，再数当声音参考的音频，依次是 `<Audio 1>`、`<Audio 2>`。
  - 配音不编号。
  - 格子上照这个写「视频 1」「音频 2」「配音」，「画面和声音」的写「视频 1 · 声音是音频 1」。
- 发给写提示词的模型（接 5.4）：
  - user 消息记下发出时的视频和音频（`mediaSnapshot`）。第一条，或者和上一条比变了（加、删、换、调顺序、改开始的秒数、改用法都算），就在说明后面接一段，把现在的全部重说一遍。例：「参考视频 2 段、参考音频 2 段：<Video 1> 取 12 秒，只用画面；<Video 2> 取 8 秒，画面和声音都用，它的声音是 <Audio 1>；<Audio 2> 取 10 秒，是一段视频里的声音。配音：一段 20 秒的音频当整条视频的声音，人物跟着它对口型。下面是 <Video 1>、<Video 2> 各截的一帧。」
  - 不是第一条的，前面加「参考视频和音频改了，以下是现在全部的，以此为准。」全删了说「参考视频和音频都去掉了。」
  - 用画面的视频各截一帧：用的那一截正中间那帧，存成画布里的一张图，跟在说明后面，前面标一行 `<Video N>`。截帧在浏览器里做，放进来和改开始的秒数时截。
  - 每个拿来干什么，用户在对话里自己说。
  - 只带最近几轮时，留下的第一条照「第一条」重说一遍。
  - 面板底部「有改动还没发出去」也算视频和音频，撤回改动一起撤回；切版本、岔出新节点照槽位的办法带过去。
- 生成视频（接 5.26）：
  - 参考视频、参考音频只在参考模式写的回复里带，另外两套提示词里写着不用 `<Video N>`、`<Audio N>`；配音三套都带。
  - 点生成时按这条回复的快照查上限，超了不发，说是哪条超了、删掉一段再写：参考的视频最多 3 段、音频最多 3 段（视频里的声音算一段音频）；图、视频、音频加起来最多 12 个；每段取出来的 2 到 15 秒；视频加起来不超过 15 秒，音频加起来也不超过 15 秒；有参考音频时至少要有一张参考图或一段用画面的视频；配音最多一个。槽位下面照这个用红字写出来。
  - 文件照图的办法传给那台的 ComfyUI（`/upload/image`，文件名按内容算）。
  - 用画面的视频：`VHS_LoadVideo`，按每秒 24 帧读，跳过开始秒数 × 24 帧，读取的秒数 × 24 帧；比一采的画面大的，读的时候缩到和画面一样大，和参考图的 match 一样（节点自己只会把参考视频放到短边 768，不缩到画面大小，按 768 读每一步慢好几倍）。接 `ref_videos.ref_video_<k>`，k 从 0 起；画面和声音都用的，它的声音（第 3 个输出，跟着截好了）接 `ref_video_audios.ref_video_audio_<k>`。
  - 只用声音的视频、当声音参考的音频：`LoadAudio` → `TrimAudioDuration`（开始秒数、取多少秒）→ `ref_audios.ref_audio_<j>`，按编号的顺序。
  - 配音：`LoadAudio` → `TrimAudioDuration`（从开始秒数取到视频结束）→ `MMH3ReferenceMultiPrompt` 的 `audio`，打开 `use_input_audio`。节点把这段声音写进声音那一半并钉住，一采每段都不改它；出片的声音照旧从一采解码，就是这段配音。音频比视频短的，后面没声音：在配音后面用 `AudioConcat` 接一段 `EmptyAudio` 静音，补到视频结束多一秒（节点自己在后面补的是全 0 的潜变量，解出来是底噪，不是静音）。节点挂的这个遮罩是单通道的，T8 存档要遮罩和数据一样形状，所以存一采、二采的结果之前先接 Impact-Pack 的 `RemoveNoiseMask` 去掉，二采照样拿带遮罩的。
  - 带的视频和音频记进 VideoJob 的参数（`media`），同样参数再来、重拍照样带。框下面没生成过时写「带 1 段参考视频、2 段参考音频、配音」。
  - 重拍有配音的：声音那一半整条钉住不重画，画面照 5.30。
- 视频、音频不能当首帧，不能在输入框里 @。

### 5.32 第二套内置流程：SelfLift 接续（第四批，照 U37 那份重做）

生成设置里多一个「流程」，两选一：两遍生成（默认，5.26）和 SelfLift 接续。这套不是自己设计的接续方式，是照实例上那份
`U37-真-上下文无缝无色差长视频-SelfLift双采-惊尘573`（作者：惊尘573）**原样搬进来**：他把长视频拆成一条条 5 秒上下的小片子，
一条出完把结尾几帧当上下文喂给下一条，人工一条条接着出；程序把这套手动接力自动化。

一份工作流原本是「一个人工迭代循环」，变成内置流程就是：程序一段一段发任务，每段出完把这一段拷进那台的 input 目录，
下一段用 `LoadVideo` 读回来当上下文，最后把几段用 `ConcatenateVideo` 拼成一条。**一个任务变成了好几个任务**，
所以 `VideoJob` 多一个 `chain`（一共几段、已经出完哪几段、正在拼没有），见 5.27 的任务状态机。

- `VideoSettings` 多三项：`workflow`（`two-pass` | `selflift`，没记的按 `two-pass`）、`denoise`（0.05 到 1，没记的按 `VIDEO_DENOISE.default` 0.2）、
  `selflift`（`steps`、`transitionStep`、`lowresScale`、`upscaler`、`contextFrames`、`noise`、`colorMatch`、`lowresLora`、`hiresLora`、`audioFeather`）。
  这些都写进 `VideoJobParams`，同样参数再来照发。
- 二采重画多少：两遍生成里二采那个 `BasicScheduler` 的 `denoise`，原来是写死的 0.2，现在照 `params.denoise`。0.2 是留着放大后的构图细修，1 是照放大后的重出一遍。
- 一段的流程图（照 U37 的单段结构，用 H3 官方节点 `MiniMaxH3ReferenceToVideo` 编码、不是多段提示词那个 `MMH3ReferenceMultiPrompt`）：
  - `MiniMaxH3ReferenceToVideo`（`prompt` 是这一段那段的提示词、`width`/`height` 按出片大小、`length` 是这一段的帧数）→ `positive` + 空白 `LATENT`；
    参考图**一张一张**接 `ref_images.ref_image_0`、`ref_image_1`…（H3 官方节点的这几项是「自动增长」输入，发成整条 `ref_images` 会被当成一块张量，
    节点里 `for img in (ref_images or {}).values()` 直接报 `RuntimeError: Boolean value of Tensor with more than one value is ambiguous`，2026-10-10 修，见报告）；
    参考视频、参考音频照 5.31 那套接（`ref_videos.ref_video_0`、`ref_video_audios.ref_video_audio_0`、`ref_audios.ref_audio_0`）。配音在这套里当参考音频接进去（官方节点没有 `use_input_audio` 那个口子）。
  - 第 2 段起：`LoadVideo` 读上一段（程序拷进 input 目录的名字）→ `VideoFrameSample`（`strategy` tail，取 `contextFrames` 帧）→ `GetVideoComponents`
    → 前 `contextFrames - 1` 帧 `ImageAddNoise`（`noise`，U37 是 0.1，减轻接缝闪烁）、最后一帧加 0 噪 → `ImageBatchMulti` 合成一沓；
    连着这几帧的**声音**一起，用 `MiniMaxH3AddGuide`（`frame_idx` 0）钉在这一段的第 0 帧上，接出来的 `positive` 给采样器。
    钉完接缝那几帧的声音有硬边，再过一道 `MiniMaxH3AudioGuideFeather`（`audio_feather_ticks` 照 `audioFeather`，U37 填 12）羽化一下；
    刻度填 0 就是不羽化、**不接这个节点**（没装那个插件也能跑）。第 1 段没有上下文，这一道也就不接（没声音可羽化）。
  - 采样：`SelfLiftH3Sampler`（comfyui-SelfLift 插件）——一套调度里前 `transitionStep` 步在低分辨率跑，抬到全分辨率再跑完剩下的步；
    `BasicScheduler`（beta、`steps` 步、denoise 1）、`KSamplerSelect`（euler，插件只收标准 euler）、`negative` 是 `ConditioningZeroOut(编码出来的正面)`、`cfg` 1（等于不走 CFG）、
    第 n 条种子是 `seed + n - 1`。`latent_image` 就是编码那个空白潜变量（它定的是「抬到多高」，低分辨率那段插件自己缩）。
  - **双 LoRA 双采**（U37 的「双采」那一段）：主模型和注意力补丁之上，低分辨率那遍挂一套 LoRA（节点 75，给 `SelfLiftH3Sampler.model`，
    `BasicScheduler` 的 `model` 也用它）、高分辨率那遍挂另一套（节点 76，给 `model_hires`），各带自己的强度。
    照 U37 就是低分辨率那遍 8 步加速 LoRA 0.75、高分辨率那遍 4 步加速 LoRA 0.7（`SELFLIFT_U37_LORAS`，界面上一键「照 U37 那套填上」）。
    两套都接在同一个 `feedForward`（挂了注意力补丁的主模型）之后，**互不叠加**——这正是双采的意思：不同步数调出来的加速 LoRA 各管自己那一段，
    不用互相将就（U37 的注释：「加速 lora 降低权重，少些油腻」）。两遍都带的是设置里「LoRA」那一栏的栈（人物、风格那类），它接在主模型和注意力节点之间（照 U37 的位置）。
    两个槽都不填就是不接额外节点，照插件默认（`model_hires` 不给时插件用 `model`），行为跟以前一样。
  - 出片：`VAEDecode` + `VAEDecodeAudio` → `CreateVideo`（24fps）→ 第 2 段起 `VideoTemporalCrop` 把开头 `contextFrames` 个上下文帧剪掉
    → `ColorTransfer`（`mkl_lab`、`source_stats` target_frame、强度 `colorMatch`）把整段颜色对齐到上一段的**最后一帧**（U37 的「无色差」就是这一步）
    → `CreateVideo`（带上剪完那段的原声音）→ `SaveVideo` 存这一段。
  - 放大器：默认 `h3_upscaler_lms_v0.1_fp32.safetensors`（U37 选的），`rho` 0、`w_min` 0.5、`w_max` 1；选「不用放大器」（`upscaler_model` `none`）就是插件的 SelfLift-zero，
    `rho` 0.6、修正强度都是 1（插件 README 给的 H3 起点）。
- 分几段、每段多长（`selfliftPlan`）：一段最长也是 362 帧（15 秒）、最短 22 帧，第 2 段起开头那 `contextFrames` 帧是重复上一段的（出片时剪掉），
  所以一段真正新出的是「每段帧数 − contextFrames」。先看要几条才够（框里那段提示词要出太多就把它拆成几条、用同一段提示词），
  再按 U37 的算法（17 的倍数加 5、不够就往上多给几帧）取每段帧数。60 秒 4 段 22 帧上下文 → 5 条、每条 311 帧、合起来 1467 帧。
- 拼起来：各段都出完后，程序把最后一段也拷进 input 目录，再发一个「读各段 → `ConcatenateVideo` → `SaveVideo`」的任务。
  `ConcatenateVideo` 对已经是编码好的 mp4 是直接接流、不重新解码（原生节点就是这么写的），所以拼这一步很便宜，声音也一起接上。
  只有一段的短视频（15 秒以内、一段提示词）也走这一条：真机上验过 `ConcatenateVideo` 收一个输入照样出片，所以短片子不用另开一条路。
- 为什么不用一个任务跑完整条：一个任务里要串好几条片子，每条都得先把画面解出来给下一条当上下文，ComfyUI 会把中间结果都缓在显存里，
  十几条就是十几份整段画面，必爆；U37 那份工作流本身也是「出一条、存下来、下一条读回来」，一个任务一段是对着它来的。
- 那台的文件怎么来回：这段的 mp4 在 `output/media-agent/` 下，程序按 `/history` 里的 `subfolder`/`filename` 经 SSH `cp` 进 `input/`，
  名字是 `media_agent_<jobId>_s<第几段>.mp4`，下一段的 `LoadVideo` 填这个名字。**不能**用「文件名`[output]`」那种写法：这版 ComfyUI 的
  `annotated_filepath` 少截一个字符（`name[:-9]` 对 8 个字符的 `[output]`），写了会报「Invalid video file」。
- 预览、叫停、删掉：第 1 段出完就取回来当低清预览（小窗里能先看个大概）。叫停时把**已经出完的几段先拼起来**当这条的结果（`partial`，能播能下载），
  正在跑的那段让 ComfyUI 停掉、不算；一段都没出完就是普通的叫停。删这条时那台上拷进 input 的几份和一段一段出的那几个片子一起删（那台关着就留在那台上）。
- 程序重启：`chain` 存在这条里，`resume` 按 `promptId` 查 `/history`，出完了就接着发下一段（那一段已经记过的不会记两遍）；正在拼的那条也认。
- 没有一采二采的存档，所以这套**不能重拍一截**：界面上那条不出现「重拍一截」，接口也拦（说「这条出的时候没存一采、二采的结果，只能整条重出」）。
  只改后面几段的话用 5.34 的「从第 N 段起重出」。
- 进度和用时：每段的采样器都算「一采」，小窗里写「生成 第 2/5 段 3/8 步」（第几段是服务端记的，不靠步数往回跳），没有「放大」「二采」这两步。
  `VideoTiming` 记下 `workflow` 和段数（这里是分几条接力），估还要多久只跟同一套流程、同样大小段数的记录比；SelfLift 那种记录里放大、二采每步用时是 0。
- 界面（生成设置小窗）：最上面「流程」，选 SelfLift 接续时把一采、二采那套（步数、二采重画多少）换成接续那套的
  （总步数、低分辨率跑几步、低分辨率倍数、放大器、接上一段带几帧 22/39/90、接缝加噪、偏色对齐、声音羽化、双 LoRA 双采两遍各挂哪套），一采大小和放大倍数的说明跟着换过来，
  底下那行会写「按 60 秒、4 段提示词算，会分 5 条接力、每条 311 帧（约 13.0 秒），出来约 61.1 秒」。
  放大器那个下拉从生成视频那台的 `SelfLiftH3Sampler` 读（没装那套节点就只有默认那个和「不用放大器」）。
  声音羽化是 0 到 256 的整数（0 是不接那个节点）；双 LoRA 那两个槽没填时是一个「挂一套（U37 用 …）」按钮，点了默认填 U37 那两个 LoRA，旁边还有一键「照 U37 那套填上」。
- 真机验过（20 秒 2 段 22 帧上下文、0.2 百万像素）：第 1 段 141 帧 → 第 2 段带着上一段尾巴出 141 帧 → 拼起来 260 帧 / 10.83 秒 / 608×352 / h264 + aac，
  帧数和 `plan.total`（2×141 − 22）一模一样；两段之间只隔一次「拷进 input」。另外走程序自己的服务端整条验过一次（20 秒 2 段、出片 1120×640、1.30 MB）：
  进度是「encode 第 1/2 段 → pass1 1…6/6 → save → encode 第 2/2 段 → … → 拼接 → done」，全程 4 分 17 秒（双 LoRA + 羽化那版见 5.33）。
- 这套要装的插件：`comfyui-SelfLift`（采样器）、H3 官方节点包（`MiniMaxH3ReferenceToVideo`、`MiniMaxH3AddGuide`）、
  接缝声音羽化那个 `ComfyUI-MiniMax-H3-Audio-Guide-Feather`（作者 wjc573，缺了界面把刻度填 0 就能跑，`PLUGIN_OF` 里写着要装哪个）。
  **那个插件的 `compat.py` 在 ComfyUI 0.38.0 上是静默失效的**（它按 8 空格缩进去 `replace` 方法体，0.38.0 `dedent` 之后是 4 空格，一个串都不命中，
  于是 `MiniMaxH3Model._forward` 被打成一份逐字相同的副本，`audio_feather_ticks` 对结果毫无影响、跑起来还是绿的）；实例上那份已经按 4 空格修好，
  **重装插件要再修一次**。修完仍然只是「刻度进了模型」，羽化好不好听要自己听。

### 5.33 SelfLift 接续补齐 U37 的双 LoRA 双采和接缝声音羽化（第四批）

5.32 搬这套时留了两处没抄：U37 的**双 LoRA 双采**和**接缝声音羽化**。这一节把这两处补上。

- 双 LoRA 双采：`selflift.lowresLora`、`selflift.hiresLora`，各是 `{ name, strength } | null`（没记的是 `null`，就是不挂）。
  - 低分辨率那遍：`feedForward`（主模型 + 注意力补丁）→ `LoraLoaderModelOnly`（节点 75）→ `SelfLiftH3Sampler.model`，`BasicScheduler.model` 也是它（照 U37，那边的调度器接的就是挂了低分辨率 LoRA 的那个模型）。
  - 高分辨率那遍：同一个 `feedForward` → `LoraLoaderModelOnly`（节点 76）→ `SelfLiftH3Sampler.model_hires`。不填就不给 `model_hires`，插件自己用 `model`（跟加这一项之前一模一样）。
  - 两条分支都从同一个 `feedForward` 出来、**互不叠加**：U37 里两个 `LoraLoaderModelOnly` 也是并联在 `ModelAttentionBackend` 之后的。设置里「LoRA」那一栏的栈是两遍都带的，位置照旧（`UNETLoader` 和注意力节点之间）。
  - 默认两个都是 `null`：这套的主模型（`DasiwaMinimaxH3_dasiwaHybridTurboV2_int8`）自己就是加速模型，不挂 LoRA 才是原来那份默认。界面上没填时是两个「挂一套（U37 用 …）」按钮（点了填 U37 的值：8 步那个 0.75 / 4 步那个 0.7），另有一键「照 U37 那套填上」（`SELFLIFT_U37_LORAS`）。
  - 校验：`lowresLora`、`hiresLora` 没写或 `null` 就是不挂，写了要有非空名字和数字强度（`phaseLora`）。
- 接缝声音羽化：`selflift.audioFeather`，0 到 256 的整数（那个节点的 spec 是 INT 0–256、默认 8；运行期还会夹到这一段音频的 token 数）。
  `AddGuide` 钉完接缝那几帧的声音之后接一道 `MiniMaxH3AudioGuideFeather`（节点 315，`audio_feather_ticks` 照填），出来的 `Conditioning` 给采样器。
  - 默认 12：照 U37 那份工作流的节点 254（不是节点默认的 8）。
  - 填 0 就**不接这个节点**（那台没装那个插件也能跑）；第 1 段没有上下文、没东西可羽化，也不接。
  - 没写这一项时服务端按默认 12 补（老界面发上来的记录里没这一项）。
- 插件：`ComfyUI-MiniMax-H3-Audio-Guide-Feather`（作者 wjc573，实例上装在 `/root/ComfyUI/custom_nodes/` 下，commit `043c631`），
  `PLUGIN_OF` 里写了它，缺插件时报错会说装哪个。**作者那版 `compat.py` 在 ComfyUI 0.38.0 上静默失效**（8 空格 vs `dedent` 后的 4 空格，两个 `replace` 都不命中，
  于是 `_forward` 被换成逐字相同的副本，节点跑绿但刻度不起作用）；实例上那份已按 4 空格修好，重装插件要再修。修完只是「刻度进了模型」，好不好听要自己听。
- 真机验过（实例 A，ComfyUI 0.38.0，双 LoRA 8 步 0.75 / 4 步 0.7 + 羽化 12）：**走程序自己的服务端**跑 20 秒 2 段（0.3 百万像素 × 1.5，出片 1120×640，8 步里前 4 步低分辨率），
  全程 4 分 54 秒、`status: done`、成片 1,905,591 字节，第 1 段的低清预览也留下了。那台 `/history` 里这条 job 的三张图逐条对过：两条片段里都是
  `LoraLoaderModelOnly` 两套（都接 `['4', 0]`，8 步 @0.75 / 4 步 @0.7）、`SelfLiftH3Sampler.model` = `['75', 0]`、`model_hires` = `['76', 0]`、`BasicScheduler.model` = `['75', 0]`；
  第 2 段有 `MiniMaxH3AudioGuideFeather`（刻度 12、`positive` 接 `AddGuide`），第 1 段没有；拼接那条读 `media_agent_<jobId>_s0/s1.mp4`。
  羽化「真的起作用」也单独验过：同种子只差刻度，音频指纹 0 = `8f0534a9…`、12 = `d434b2f0…`，同参数复跑逐比特相同；而作者原版 `compat.py` 下 12 和 0 一模一样（假绿）。

### 5.34 SelfLift 接续：从第 N 段起重出（第四批）

接力那套是**链式**的：第 N+1 段是「接着第 N 段的画面」长出来的，所以**不能只重出中间一段**——换掉第 N 段，后面几段的接缝立刻对不上；
这套也没存一采二采的潜变量，用不了两遍生成那套的「重拍一截」。真正合理的粒度是「**从第 N 段起往后的都重出**，前面几段留着」：
5 段里第 3 段有问题，就那么改（省掉前 2 段的时间），而不是整条重来。

- 界面上：出完的那条视频（`chain.clips` 至少 1 段）上多一个「从第几段起重出」，点开挑从第几段起。
  能选的起点（`rerunFroms`）是 `2` 到 `min(总段数, 已经出完几段 + 1)`：第 1 段起等于整条重出（用「同样参数再来」），所以从 2 起；
  前面几段得先出完（留着的那几段得在那台上）。
- 参数照原来那条（跟「同样参数再来」一样），**种子也照原来那条**（留下来的几段还是同一个种子出的，重出的那几段能跟上一版对着比）；
  提示词照**框里现在的**（要改第 N 段就先改好再点）。段数不能变：变了每段的帧数就对不上，留下来的几段接不进去。
- `VideoJob.rerun = { base, clip }`（base 是照着哪条重出、clip 是从第几段起，从 1 数）。它是另一条独立的成片，不跟原片并成版本。
- 服务端（`videoJobs.create` 的 `rerun` 分支）：留下的前 `clip − 1` 段原样记进新这条的 `chain.clips`，但**名字换成新这条的**（`media_agent_<新 jobId>_s<i>.mp4`）；
  发第一段之前把这几个文件从那台的 `output/media-agent/` 照新名字拷回 `input/`（原文件还在——程序只在删这条视频时才清那几段）。
  校验：只有接力那套能这么重出、不能在还在跑的那条上重出、`clip` 得在可选范围、段数不能变、留下来的每段帧数要和这一版的计划一样；
  那几段要是在那台上没了，报「第 k 段在那台上找不到了（那条视频删了？）…只能整条重出」。
- 发哪一段的图：`submit` 现在按「已经出完几段」决定发第几段（新的一条是第 0 段），所以同一条代码路径既能起一条新接力，也能从中途接着跑
  （「从第 N 段起重出」就是给新的一条预先记上前 `clip − 1` 段）。
- 覆盖：`packages/shared` 里 `rerunFroms` 的档位、服务端集成测试（真发假 ComfyUI：留下的那一段只拷一次、只发后面几段 + 一条拼接、合并读的是新名字）、
  e2e（界面上点出来跑通）；真机也跑过一遍（见 `docs/reports/selflift-u37.md`）。

### 5.35 SelfLift 接续：续写起点（给一段前一段视频，从它接着往下出）（第四批）

接力那套默认是「重新生成」；要接着**已经有的**一段往下出（上一轮出的成片、别处剪好的一段、手机上拍的），
在两遍生成的语境里只能当参考视频，接不上去。这一版给它一个「**续写起点**」：选一段视频，出来的整条 ＝ **这一段 + 按这个节点时长新出的几段**。

- 界面上：SelfLift 那栏最上面一行「续写起点」，默认写着「不接，重新生成」。点开能挑：
  ① **这个框下面已生成的**（出完或者叫停留下 partial 的那些）② **这台画布上的视频素材**（5.31 放进来过的）③ **电脑里的**：资产库挑一段，或者直接传一段上来。
  选好了下面出个小播放器确认是不是那段。空着就是重新生成，跟以前一模一样。
- 存在哪：节点生成设置里的 `VideoSelfLift.lead`（`{ kind: 'job' | 'media' | 'lead' }`），跟别的设置一样每个节点一份、改了自动存。
  **和「哪个框」无关**：视频是按「哪一条」选的，从别的框生成照样认（`videoJobIn` 在整个节点的消息里找）。
- 用户传上来的那段视频存**画布**的 `leads/` 下（`leads.json` + 按内容哈希命名，`store/leads.ts`）：**只按内容存一份，什么都不探测**
  ——浏览器不一定读得出宽高（H.265/HEVC 就报不出宽高，5.31 那套素材导入会因此拦下来），而我们也不需要：规整是在那台上做的。
  路由：`POST /canvases/:id/leads`（按路径复制）、`POST /canvases/:id/leads/upload`（传内容）、`GET /canvases/:id/leads/:id/file`（试播）。
- 链条怎么算：`VideoChain.total` 多了那一段（`selfliftClips(...) + 1`），那一段**不放进 `chain.clips`**（clips 只放这次新出的几段），
  单独记在 `chain.lead`（`name` 是接进流程用的那份、`uploaded` 是原来传上去的那份、`seconds` 是量出来的时长）。
  所以「这次出到第几段」还是 `clips.length`，进度、`advance`、`send` 那几处不用改口径；
  拼整条时读的是 `[lead, ...clips]`（`mergeClips`），程序重启后接着跑也照这个来。
- 发任务时（`submit`，在锁里、拷完留下的那几段之后）：把那段传上那台（`comfy.uploadFile` 带名字，就按任务起名 `media_agent_<jobId>_lead<ext>`，
  同一条视频被两条任务用着也不至于互相删掉），再**量一次、必要时规整**（`comfy/videoLead.ts`，在那台上跑脚本）：
  量出来的宽高、帧率（24）、编码（h264）、位深（8 位 yuv420p）、色彩（bt709 系）、**声音（32 kHz 立体声）**跟出片全对得上就**原样用**
  （拼接时能不重编就不重编）；差一样就调 `ffmpeg` 规整一份 `…-lead-fix.mp4`：缩到出片大小（比例不一样的两边补黑边）、24 帧、8 位 yuv420p、
  `-color_primaries bt709 -color_trc iec61966-2-1 -colorspace bt709`、声音 `aac 32000` 立体声，没声音的补一条静音；
  规整完再量一次，还是对不上就当场报错，不往下发。
  ffmpeg 优先用系统装的，没有就用 ComfyUI 那个 python 里 `imageio_ffmpeg` 自带的一版；都没有就报错说清楚。
  **为什么非要规整、为什么是这几样**：最后是把前一段和这次出的几段用 `ConcatenateVideo` 接成一条，它「各段签名一样」才走原样接，
  签名里带编码器写出来的 SPS/PPS（`extradata`）、宽高、帧率、位深、色彩、声音采样率和声道数；差一样它就把每段重编一遍，
  而重编两段出来的 SPS 未必一致，对不上整条报 `Video chunk 1 could not be encoded compatibly: extradata …`（真机上撞到过，
  对照试出上面这套参数的经过见 `docs/reports/selflift-u37.md`）。
- 出来的整条：`SaveVideo` 存的是拼起来的那条，位置、时长、下载都跟以前一样；那条视频卡片上标题写「续写」、元信息里写「续写 <是哪一段>」。
  **有起点时新出的那段开头 `contextFrames` 帧是起点的尾巴**（`AddGuide` 钉进去的），出片时剪掉，所以真正新出来的画面是 `plan.total − contextFrames` 帧
  （8 秒 1 段、22 帧上下文时是 170 帧 ≈ 7.08 秒，加上 8 秒的起点就是 15.08 秒）；弹窗顶上的摘要按「新出多少」算，已经把这几个帧减掉。
- 「同样参数再来」照旧带上起点（参数里记着）；「从第 N 段起重出」（5.34）里**前一段也算第 1 段**：
  从第 2 段起就是「留着前一段，这次新出的几段从头重做」（`rerunFroms` 里把 `lead` 算进已完成的段数）。
- 覆盖：`packages/shared`（有上一段时第 1 段就带上下文：读它、取 22 帧尾巴、钉在第 0 帧、剪掉、颜色对齐；`rerunFroms` 的档位）、
  服务端集成测试（原样接 / 规整一份 / 用已生成的那条 / 那条还在跑或临时文件清掉了）、
  e2e（弹窗里传一段再出、资产库里挑一段再出、清掉就是重新生成）；
  真机跑了两条（原样接、规整一份，见 `docs/reports/selflift-u37.md`）。

### 5.36 点「生成视频」先弹配置窗（第四批）

以前点「生成视频」是**直接**按节点的生成设置发出去；想改点东西得先去槽位区右边点「生成设置」那个小窗，来回两趟。
现在点「生成视频」先弹一个**配置窗**：里面就是生成设置那一份（`VideoSettingsBody`，和小窗同一个组件），**顶上是「开始生成」**，
看清楚了、改好了再点它才真的发出去。Esc、点外面、「取消」都只是关掉，什么都不发。

- 顶上还写清楚这次按什么生成：「<节点标题>」的第 N 个提示词框 · 生成时按 X 秒、Y 段提示词；摘要一行写出走哪套流程、分几条接力、出片多大、约多长、带几张参考图（几段视频或音频）。
  框里段数不够时（5.24）照旧拦下来：窗里也显示原因，两个「开始生成」都是灰的。
- 改的还是**节点上那一份**（每个节点一份、改了自动存、和小窗互通）：先打开空着的小窗看一眼再打开配置窗，看到的是同一套值。
- 覆盖：e2e（弹窗里改一采大小和二采重画多少 → Esc 关掉什么都没发 → 再打开还是改过的 → 点「开始生成」才发，发出去的图里是改过的值）。

这一轮（配置弹窗 + 续写起点）的交接说明见 `docs/handoff-video-lead.md`：现状、怎么验、踩过的坑都在里面。
### 5.37 Krea2 指令编辑（第五批）

> 位置说明：图像编辑分支原编号 5.34–5.36 与主分支的视频功能重叠，合并时移到 5.37–5.39；视频章节及其引用保持原编号。

用户原话：「放一张图进去，指定改哪儿，但不用涂抹。」

- 「起图」那一排从两个按钮变成三个：**文生图 / 四视图 / 编辑**（`KreaSettings['mode']` 加 `'edit'`）。不新做节点类型，就在 `Krea2 出图设置` 里。
- 原理：**作者那套 Ostris 编辑节点**（`Krea2OstrisEditModelPatch` + `TextEncodeKrea2OstrisEdit`，来自 [ostris/ComfyUI-Krea2-Ostris-Edit](https://github.com/ostris/ComfyUI-Krea2-Ostris-Edit) v1.0.1）。这条是给**用 ai-toolkit 训的 edit LoRA**（动漫转真人那类）用的：
  `UNETLoader` → `LoraLoaderModelOnly`（串起来）→ `Krea2OstrisEditModelPatch(kv_cache true)` → `KSampler(denoise 1, cfg 1, euler/simple)` → `VAEDecode` → `PreviewImage`；
  `CLIPLoader` → `TextEncodeKrea2OstrisEdit(prompt = 框里那句话, vae, image1 = 参考图)` → 正面，同一个节点空 prompt → 负面。
  **这不是 img2img**：`denoise 1` + 空潜变量，参考图是当「参考」喂进 Qwen3-VL 和模型的参考潜变量，改哪儿由正面词决定，**所以不用掩码、不用涂**。
  - **为什么不用 Krea2Edit 那条路**（本节原来写的）：真机上验过，`Krea2EditModelPatch` 配写实/转真人 LoRA 会出花图（边缘露原图、颜色飞），摘掉 LoRA 也一样；同一个 LoRA 在 Ostris 这条路上是好的。四视图没这个问题，继续保持用 Krea2Edit。
  - 插件：`PLUGIN_OF` 里 `Krea2OstrisEditModelPatch` / `TextEncodeKrea2OstrisEdit` → `ComfyUI-Krea2-Ostris-Edit`，`LayerUtility: ImageScaleByAspectRatio V2` → `ComfyUI_LayerStyle`。缺了照样给安装包名字。
- **尺寸**：编辑档**不看面板上的宽高**——参考图先按自己的比例缩到**长边 2048**（`LayerUtility: ImageScaleByAspectRatio V2`，`scale_to_length = KREA2_EDIT_LONG_SIDE`、`scale_to_side = longest`、`round_to_multiple = '16'`），出图尺寸跟着缩放后的参考图走（`GetImageSize` → `EmptySD3LatentImage` 的宽高）。
  - 为什么是 2048：V3 那个 LoRA 是 2K 训的。作者示例里用的 `FluxKontextImageScale` 只有 ~1MP（880×1184），真机对比明显发糊，拉长边就清楚了。
  - 面板的尺寸校验还是留着（`mode !== 'text'` 时要求 16 的倍数），因为切档时 `kreaDefaults('edit')` 会带上 1024×1536，懒一下也不会撞校验。
  - **「参考图相似度」（`ref_boost` / `refBoostA`）编辑档不看**，那是四视图那条路的；字段还存着，界面上有提示说明。
- **双图**：编辑档能给**两张**参考图 —— **图 1 = 场景（构图/背景/姿势）在前，图 2 = 主体（人物长相）在后**（训练顺序）。接法是 `image1` / `image2`，两个编码节点（正负面）都给；**没选图 2 时 `image2` 一个都不接**。作者的双图触发词里 `Figure 2` 指的就是第二张。
  - 尺寸还是看图 1 的（场景定构图），图 2 只当参考。
  - `KreaSettings` 加 `referenceB?: RefImage | null`、`refBoostA?: number`（都可选，老节点读出来当没选/1）。预设不存参考图，两张都不存。
  - 大图参数里双图写「编辑（双图）· 场景 N / 人物 M」，单图写「编辑 · 相似度 N」（这个显示还是四视图那套字段，编辑档实际不看）。
- 默认值（`kreaDefaults('edit')`）：底模 `krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors`（写实微调）、文字理解 `qwen3vl_4b_uncensored_int8_convrot.safetensors`（去审查）、VAE `qwen_image_vae.safetensors`、LoRA 动漫转真人 V3 @1、**10 步**、CFG 1、euler/simple、`kv_cache = true`。
  - `kv_cache` 开着是照作者那张示例，真机对比也比关掉清楚；关掉那张脸更软。`OSTRIS_EDIT_KV_CACHE` 常量控制。
  - 底模和文字理解这两样决定「出不出得来写实」和「松不松」，都能在出图设置里换。**写实类的底模 + 去审查的编码器出来就是露骨的**（真机验过），这是这一档的既定行为，不是 bug。
- 编辑也要选参考图（来源照四视图：槽位里的图，或这个节点出过的图）。没选时点生图返回 400「编辑还没选参考图」，一张都不发。参考图后来删了、临时文件清了又没下载过，报「编辑的参考图找不到了」。
- 一组的 `kind` 是 `'edit'`，框下面那组标「编辑」，大图参数里「起图」写「编辑 · 相似度 N」。
- **编辑方案**（`KREA2_EDIT_PRESETS`）：出图设置里「编辑」档下面一个下拉，每个方案 = 一套 LoRA（名字 + 强度）+ 可选触发词 + 可选参数。选一个就把 LoRA 和参数填进节点（之后还能手动改）；**手动改过 LoRA 就显示「自己选的 LoRA」**。
  - 服务端**不另存「选了哪个方案」**：照这一组的 LoRA 名字反认（`editPresetOf`），认出来且方案带触发词时，把触发词放在正面词最前面（`触发词\n\n框里那句话`）。这样手写 LoRA 名字也能吃到触发词，改强度也不影响认。
  - 现在的方案（第一个是默认，`DEFAULT_EDIT_PRESET`）：`动漫转真人 V3`（默认，触发词 `transform the image to realistic photograph`、10 步 / CFG 1）、`动漫转真人 V1`（同触发词、10 步）、`身份编辑 v1.1`（照 T07）、`身份编辑 v1.2`、`换装（krea_outfittransfer）`。
  - **只有前两个在真机上验过**（配的就是 Ostris 这条路）。身份编辑和换装那两个是给 Krea2Edit 那套训的，配这条路没验过，方案说明里写清了「试了再说」。
  - 触发词和推荐参数都是照作者在模型页上写的（动漫转真人那两档见 Civitai 2808492）。**要加新方案就往这个数组里加一条**，界面和服务端都跟着走。
- **界面上要写清局限**：没提到的部分不保证像素不动（背景、姿态、构图可能跟着变一点），人物长相靠 LoRA 保住。要「只改一块、别处一个像素不动」用局部重绘（5.38）。尺寸和相似度这两栏这一档不看，界面上也有提示。
- 预设照旧：`PresetSettings` 存 `krea.mode`，参考图不存。

### 5.38 局部重绘：拖框 + 涂抹（第五批）

用户原话：「把它针对指定区域做一些变更，就不用涂抹的那一块」，接着又说「同时也支持涂抹」。所以两种画法都做，同一个窗口里切换、能叠加。

- **入口**：大图窗口「做四视图」旁边加「局部重绘」。**照「做四视图」的规矩，Krea2 出的图不给这个按钮**（局部重绘是内置 SDXL 流程的活，Krea2 那张底模走不了 E05 那条路）。
- **掩码怎么给**：把原图涂过的地方**改成透明**（只改透明度，颜色照留），存成 PNG 进临时文件夹，用 `/upload/image` 传上去；`LoadImage` 的槽 0 出 IMAGE、槽 1 出 MASK，掩码就是这张 PNG 的 **alpha 通道**。一次上传、一个节点、底图和掩码同源，天然像素对齐 —— 不用 `LoadImageMask`，也不会出现掩码和底图尺寸对不上。
- **画法**：拖框（按住拖一个矩形，能拖动、能拉手柄缩放）+ 画笔（大小可调，能擦、能清空），两种叠加。编辑器画在显示尺寸上，导出的 PNG 必须是**原图像素**尺寸：要重画处 alpha=0，别处 255。
- **流程照实例上的 `E05-局部重绘-手绘遮罩SDXL`**：
  `LoadImage` → `InpaintCropImproved`（只裁遮罩附近一块）→ `InpaintModelConditioning`（`noise_mask=true`，普通底模也能用）→ `KSampler` → `VAEDecode` → `InpaintStitchImproved`（缩回去拼回原图）→ `PreviewImage`。
  「遮罩外不动」是这个算法保证的：只裁遮罩附近一块重画，再拼回原图。
- `InpaintCropImproved` 照 E05 的值填（25 个必填项：接进来的 `image` 加 24 个参数，全给）：`mask_expand_pixels = 8`、`output_target_width/height = 1024`、`context_from_mask_extend_factor = 1.2`、`mask_blend_pixels = 32`、`output_resize_to_target_size = true`、`output_padding = 32`、`device_mode = cpu (compatible)`、`preresize = false`，其余同默认。这三个非默认值是给 SDXL 调的，Krea2 那边要不要改等真机看。周边多留 20%（`context_from_mask_extend_factor`）就是接缝能接上的原因。
- `KSampler` 的底模、LoRA、步数这些照原图那组（原图是导入的工作流出的就用节点现在的出图设置），种子随机，`denoise` 默认 1（调到 0.5–0.8 保留原来的轮廓、只改细节）。
- 正面、负面照普通出图加固定开头和负面词；正面默认是原图框里的标签。
- 接口：`POST /canvases/:canvasId/nodes/:nodeId/messages/:messageId/images/:jobId/:index/inpaint`，收 `{ mask（base64 PNG）、positive、negative、denoise }`。掩码 PNG 落在 `image-temp/当天/`，所以「已清理」那套自动适用；`ImageJobParams` 加可选的 `inpaint: { mask, denoise }` 记着这张 PNG 的路径，「同样参数再来」「只换种子再来」重发时**重新上传同一张 PNG，不用再涂**。临时文件被清掉时报错，和补做那条一样。
- 一组的 `kind` 是 `'inpaint'`，参数里记着从哪张来。
- 要装 `ComfyUI-Inpaint-CropAndStitch`（`InpaintCropImproved` / `InpaintStitchImproved` 是它带的），缺了照 5.18 说缺哪个节点、装哪个插件。
- 假的 ComfyUI 要补 `InpaintCropImproved`（出 `STITCHER` + `IMAGE` + `MASK`）、`InpaintModelConditioning`、`InpaintStitchImproved` 三个节点；`LoadImage` 本来就出 `['IMAGE','MASK']`，alpha 掩码那条路 mock 天然支持。
- 「涂抹的界面原型」这条是 P18 一直没开工的原因（`web/prototype/` 里原先没有）——原型先出给用户看，点头了再写实现。

### 5.39 图像编辑节点（第六批）

用户原话：「我需要额外有一个节点，图像编辑的界面。我可以打开一张图或多张图，然后有编辑的各类选项。有的节点编辑我还想让模型参与帮忙写提示词。」

**为什么单独开一种节点**：编辑跟生图是两回事——生图是「照这句话画一张新的」，编辑是「拿这张图改一改」。框里的语义、底下的按钮、要几张图都不一样，硬塞进生图节点会把两边的提示词、参数和出图入口全搅在一起。所以节点类型从两种变三种：`video` / `image` / `edit`。

详细计划在 `docs/plan-image-edit-node.md`（开发步骤）和 `docs/plan-image-edit-node-layout.md`（界面草图，配能点的原型 `web/prototype/image-edit-node.html`）；转真人那套照 `docs/krea2-real-usage.md`（作者原件 `krea2_v10.json`）。

**节点类型和系统提示词解绑**（以前 `NodeKind = PromptMeta['use']`）：

- `NodeKind` 独立成 `'video' | 'image' | 'edit'`；`PromptMeta['use']` 也加 `'edit'`。两者成员一样但不再互为别名，以后各自能走各自的。
- 系统提示词的说明段多认一种「用途: 编辑」；再读一个「功能: 指令编辑 / 换装 / 局部重绘 / 转真人」，见 `packages/shared/src/promptMeta.ts`。
- 编辑节点**每个功能一套**系统提示词，都放在 `docs/prompts/`：`edit.md`、`edit-outfit.md`、`edit-inpaint.md`、`edit-real.md`，共用的输出格式是 `format-requirement-edit.md`。选哪个功能就用哪套，用户在设置页里能改能换。
- **模型不决定功能**：模型只写字，功能是用户在面板里选的；候选框上的角标只标「这条是给哪个功能用的」。
- 老节点没记 `kind` 的照旧按现在用的系统提示词补：生图提示词算生图节点，编辑提示词算图像编辑节点，别的（包括提示词已经不在了的）算视频节点。

**第一轮范围**（用户说「所有功能都做」，分三批）：

| 批 | 功能 | 走什么 |
| --- | --- | --- |
| 1 | 指令编辑 | Krea2 编辑档（T07） |
| 1 | 转真人 | `docs/krea2-real-usage.md` 那套：`Easy_QwenEdit2509` + `Krea2OstrisEditModelPatch` + `beta57`；含「反推 / 手输」、「只转真人 / 换脸（`image2_strength`）」、LoRA 两组；无审查当默认 |
| 1 | 换装 | Krea2 编辑档 + `krea_outfittransfer` |
| 1 | 局部重绘 | E05（5.38） |
| 2 | 放大 / 高清、四视图 | 都从大图窗口搬（**已做完**，见下面 E5） |
| 3 | 扩图、深度 / 姿势迁移、风格 Remix | **要先在真机上摸工作流**（现在不接 AutoDL，等有机器） |

**第 3 批的真机摸底结论**（2026-10-12，`outputs/devcheck/w3-findings.md`）：**深度迁移能做、风格 Remix / 换人能做，姿势迁移和扩图不做**。

- **深度迁移**（进代码）：控制类三节点一组（`Krea2ControlLoRALoader` → `Krea2ControlApply`，facok 的 `comfyui-krea2-controlnet`）+ `DepthAnythingV2Preprocessor`（`depth_anything_v2_vitl.pth`、resolution 1024）→ `Krea2ControlImageEncode`（grayscale / per_image_minmax / invert false）。**控制编码那个 latent 必须和采样器用的是同一个**（官方 README 明写）。底模 turbo fp8、8 步 / CFG 1 / euler / simple、1024×1024。逐字照抄 `outputs/devcheck/w3-depth.json`，主结果图 `outputs/real/shots/W3-深度-DepthAnything控制.png`。
  - ⚠️ `Krea2ControlLoRALoader.strength` **不能填 0**：0 时 loader 不注册采样 wrapper，`Krea2ControlApply` 直接抛「must receive the MODEL output from Krea2 Control LoRA Loader.」（`w3-depth0.json` 那次）。
- **风格 Remix / 换人**（进代码）：Ostris 那条路（跟转真人同族）但**只喂 model**（`LoraLoaderModelOnly`，不是 `LoraLoader`）+ `Krea2OstrisEditModelPatch(kv_cache=true)` + `TextEncodeKrea2OstrisEdit`（参考图先 `ImageScaleToTotalPixels` 到 0.140625 MP / 384×384 / step 16）+ 正负各一个 `FluxKontextMultiReferenceLatentMethod(index_timestep_zero)`。底模 turbo int8 convrot、8 步 / CFG 1 / euler / simple、出图尺寸跟参考图无关。两个 LoRA 同一套接线只换 `lora_name`：`krea2/krea2_reid_rank32.safetensors`（放得开）和 `krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors`（保守）。逐字照抄 `w3-reid2.json` / `w3-remix2.json`。
  - ⚠️ **LoRA 名必须带 `krea2/` 前缀**，少了会在提交阶段被 `value_not_in_list` 拒掉（真机踩过）。
- **姿势迁移不做**：那台上 `Krea2ControlLoRALoader` 的 373 项里没有任何 pose 的 Krea2 控制 LoRA；拿 OpenPose 骨架喂深度 LoRA 会把骨架白线当成内容画进画面（`W3-深度-OpenPose试探-T0人像.png`）。
- **扩图不做**：现有节点满足不了那个 LoRA 的输入契约（要源图在画布上的 bounding box → `reference_placements`），四种接法都试过，见 `w3-findings.md` 第 4 节。要做得先装 `ComfyUI-Rebels-Krea2-Outpaint`。
- **这两档先用验过的那套底模**（turbo fp8 / int8 + fp8 文字理解），**不扩成「无审查」两档** —— 那一档没在真机上验过。

**E1 已经做完**（2026-10-11）：

- `NodeKind` 加 `'edit'`、`PromptMeta` 加 `use: 'edit'` 和 `fn`、`parsePromptMeta` 认「用途: 编辑」「功能:」。
- `BUILTIN_PROMPTS` 加四份编辑提示词；`FORMAT_REQUIREMENT_DOCS` 加 `edit`。
- 新建节点菜单第三项「图像编辑节点」；卡片标「编辑」、边框用新加的 `--edit` 青色（跟视频的灰、生图的紫分开）；`NodeSummary` 加 `kind`。
- 设置页第三组「写改图说明 · 图像编辑节点用」，每份带「编辑 · 功能名」标签；固定格式要求多一份「图像编辑节点的四套用这份」。
- 编辑节点默认用 `edit`（指令编辑）那套；一套编辑提示词都没有时建不出来，报「设置里还没有图像编辑用的系统提示词」。
- 编辑节点只能选编辑用的系统提示词，报「图像编辑节点只能选图像编辑用的系统提示词」。
- 单测卡在 `packages/shared/test/imageJob.test.ts`（说明段）、`packages/server/test/prompts.test.ts`（列表和格式要求）、`packages/server/test/imageNode.test.ts`（新建定类型、老节点归类、换提示词）；e2e 在 `tests/e2e/20-edit-node.spec.ts`。
- **E2 已经做完**（2026-10-11）：面板底部的编辑栏，从上到下是 **功能 → 图 → 提示词 → 开始**：
  - **功能**：下拉，先只放「指令编辑」，另外三个列出来标「还没做」，点了给一句提示。
  - **图**：槽位点一下就是「用这张图」（单选），选中的底下标角色名（`要改的` / `要转的` …），原来那个菜单挪到**右键**；卡片上写「N 张图」，不再显示时长和比例。
  - **提示词**：下拉里是指令编辑那六条现成的（换衣服 / 换背景 / 加个东西 / 去掉个东西 / 改光线 / 改表情），选中填进下面那行；那行能改。
  - **参数 + 开始**：相似度 + 开始（没选图或没写字时按住）。点开始服务端自己造一条回复、把出的图挂在框下面（照「做四视图」那套），走 Krea2 编辑档。
  - **指令编辑挂的是身份编辑 v1.1 的 LoRA，不是动漫转真人 V3** —— 所以不会自己加真人化触发词；编辑档的接线照 5.37（Ostris 那两个节点），**不是**四视图那条 Krea2Edit。
  - 编辑节点的 `edit` 设置在节点里记着（功能、第几张图、那句话、相似度），后端 `PATCH` 收 `edit`，建任务走 `POST /canvases/:id/nodes/:nid/edit`。
  - **E3 已经做完**（2026-10-11）：模型参与那套，报告 `docs/reports/P27.md`。
    - 面板顶栏那一格在编辑节点上叫「**模型提示词**」，只列**当前功能那一份**（按提示词说明段里的「功能: 」对名字）；换功能服务端自己把 `systemPromptName` 换成那份，请求里明写了系统提示词的照请求。
    - 发给模型的图**只有选中的那一张**（`editDiff`），并说明「要改的是第 N 张参考图」；面板底下「有改动还没发出去」那句也跟着换。
    - 每条回复上记 `message.edit = { fn, slot }`：候选框右下角标「**指令编辑 · 用 1 号图**」，按钮 **「用它」** 把框里那句话落到编辑栏，功能、图一起切回去。
    - 输入框旁多一个「**写一个**」：不问你要改什么，直接发「看图，按「X」给我几个方向。」。
    - 假模型按固定格式要求里那句「一个字都不会被程序改动」认编辑那四套（四个功能回四句不一样的话），测试靠它卡「换功能真的换了提示词」。
    - 「框上直接开始出图」（布局稿第 4 节 ④）和另外三个功能的界面切换留给 E4 / E6；E4 之前「换功能」在 e2e 里是调接口换的。
    - **真机验过**：指令编辑这条路（Ostris 两个节点 + 身份编辑 v1.1）在那台上跑通了，见 `docs/reports/real-machine-edit-node.md`。
  - **E4 已经做完**（2026-10-11，转真人 + 换装；局部重绘留给下一轮）：报告 `docs/reports/P28.md`。
    - **转真人照作者那套**（那台上的 `Krea2转真人-全开关（反推+单双图+手输）`，参数一字不改）：`Easy_QwenEdit2509` + `Krea2OstrisEditModelPatch(kv_cache=true)` + `KSampler(euler, **beta57**, 8 步, CFG 1)` + V3 LoRA（model 和 clip 一起喂）+ 两张图各自 `ColorCorrect(−20)`/长边 1536 + 反推（35B MoE，`force_offload=false`）。无审查是默认。
    - 反推的两份系统提示词抠自 `docs/krea2-real-reverse-prompt.md`（放代码里，不放 `docs/prompts/`），有一条测试从 doc 里抠出来逐字比对。
    - **换装**照编辑档那条路，只换 `krea_outfittransfer` 的 LoRA；四条现成句子在 `EDIT_PRESETS.outfit`。
    - 面板：功能下拉能切转真人/换装；转真人那套参数区（谁写词 / 做法+图 2 强度 / LoRA 两组 / 无审查）；图槽能标「真人参考」。
    - **`POST /edit` 的底改成节点上存的设置**（请求里的字段覆盖它）——只发 `{fn}` 时不会再把反推/双图/LoRA 悄悄换回默认值。
    - **真机验过**：跟作者那套同一张图对照，四条转真人出来基本一致（30 秒 / 21 秒 vs 作者 80 秒 / 38 秒）；`image2_strength` 那个旋钮还没单独验。
  - **E7 第一半已经做完**（2026-10-12）：新增两个功能「**深度迁移**」和「**风格 Remix**」（第 3 批那三条里能做的两条，姿势迁移和扩图不做，理由见上面那张表下面）。报告见本节，接线和参数照 `outputs/devcheck/w3-findings.md` 逐字抄。
    - `EditFnId` 加 `'depth' | 'remix'`，`EDIT_FNS` 各一条（名字必须跟系统提示词说明段里的「功能:」一字不差）；每个功能一套系统提示词 `docs/prompts/edit-depth.md` / `edit-remix.md`，`BUILTIN_PROMPTS` 从 12 套变 14 套。
    - 内置流程在两个新文件里：`packages/shared/src/krea2Depth.ts`（控制类三节点那一组）、`packages/shared/src/krea2Remix.ts`（Ostris 那条只喂 model）。`kreaGraph` 按 `krea.mode` 分派，服务端 `editParams` 里两条新分支把底模 / 文字理解定死成跑通的那套（**不扩无审查两档**），控制强度和 LoRA 走 `ImageJobParams.remix`。
    - 面板各一块参数区：深度迁移是「提示词 + 控制强度（默认 1，只收 0.1–1.5）」，风格 Remix 是「提示词 + 换人/风格 LoRA 下拉 + 强度」。两个功能都**没有**出图设置那一套（尺寸跟图走）。
    - `PLUGIN_OF` 补 `Krea2ControlLoRALoader` / `Krea2ControlImageEncode` / `Krea2ControlApply`（`comfyui-krea2-controlnet`）和 `DepthAnythingV2Preprocessor`（`comfyui_controlnet_aux`）—— 2026-10-12 照实机 `object_info` 的 `python_module` 核过；`ImageScaleToTotalPixels` 是 ComfyUI 本体（`comfy_extras`），缺了要升级本体，不是插件，所以不列。
    - 测试：单测 `packages/shared/test/krea2DepthRemix.test.ts`（两张图的整条接线，逐项卡参数、LoRA 前缀、latent 共用、正负 conditioning 的接法）、集成 `packages/server/test/editJobs.test.ts`（假 ComfyUI 真收到的那张图 + 缺图 / 缺插件的人话）、e2e `tests/e2e/23-edit-depth-remix.spec.ts`。
  - **E5 已经做完**（第 2 批那两个功能 + 收尾的「框上开始」）：
    - **放大 / 高清**：`EditFnId` 加 `'upscale'`，参数是**倍数（1.5 / 2）+ 放大模型 + 面部修复开关**三样。走的是生图节点已有的那条内置放大路（`UpscaleModelLoader` + `ImageUpscaleWithModel` → `ImageScale` 缩到原图 × 倍数，取 8 的倍数），**重绘强度固定 0 = 只放大不重画**；「面部修复」是部位重绘的一道（`UltralyticsDetectorProvider` + `FaceDetailer`，`newDetailPass` 的默认参数）。原图是槽位里选中的那张（`ImageJobParams.upscaleFrom`），出图前由 `graphMaker` 走 `refFile` 传上去。底模、步数这些照**这份提示词说明段里那个系列**（跟局部重绘同一个 `sdxlFamily`，没写按 IL，Krea2 走不了这条）。
    - **放大模型没选就用这台 ComfyUI 上第一个**（`chooseUpscaleModel`，跟底模那套 `chooseCheckpoint` 一个路子）：面板上留着「用这台 ComfyUI 上的第一个」，点了「开始」就能直接放大。
    - **这个功能不用模型写字**：`EditFn` 加了 `writes` 字段，它是 `false` —— 面板上没有「提示词」那一行（写明「这个功能不用模型写字」）、输入框旁没有「写一个」、`EDIT_PRESETS.upscale` 是空的、**没有 `docs/prompts/edit-upscale.md`**；换功能时 `promptNameForFn` 找不到就留着现在那套，顶栏那一格写着「是聊天用的」。
    - **四视图**：`EditFnId` 加 `'fourview'`，跟生图节点那个「做四视图」同一条路（`krea2_4panel` + `Krea2EditModelPatch` / `Krea2EditGroundedEncode`，`krea.mode` 还是 `'four-view'`）。原图是槽位里选中的那张；框里那句话当**额外要求**，主指令 `FOUR_VIEW_INSTRUCTION` 由 `fourViewPrompt()` 接在最前面，**不写也行**。系统提示词 `docs/prompts/edit-fourview.md`（说明段 `用途: 编辑` + `功能: 四视图`），`BUILTIN_PROMPTS` 从 14 套变 15 套。
    - **`editTextBlock()`**（shared）统一了「这个功能要不要先写字」：放大 / 高清、四视图、转真人开着反推时都不用写，别的一律要 —— 面板底部的「开始」、框上的「开始」和服务端三处问的是同一个函数。
    - **框上直接「开始」**（布局稿第 4 节 ④）：框上多一个「开始」，用**这条框自己的**功能 / 图 / 那句话出图。`POST /edit` 多收 `messageId` + `promptIndex`：带上时**不新建回复**，出的那组挂在这条回复的那个框下面（`promptIndex` 就是框的序号），不带时照旧自己造一条回复；面板底部和框上共用这一条服务端路径。缺东西时给一句人话：功能还没做、这条框用的图不在槽位里了、局部重绘还没画掩码。
    - 顺手修的界面实话：深度迁移 / 风格 Remix 那两句「尺寸不用填，跟着这张图走」改成**出图固定 1024×1024**（照真机那几份 JSON，代码里的尺寸没动）；局部重绘那块加一句「这一块走 SDXL 那条重绘流程，底模按提示词上的系列走」。
    - 测试：单测 `packages/shared/test/edit.test.ts`（八个功能、`writes`、`editTextBlock`、放大默认值）、集成 `packages/server/test/editJobs.test.ts`（放大那条的内置流程和面部修复、四视图那条的接线和主指令拼接、框上「开始」不新建回复 + 两条人话）、e2e `tests/e2e/24-edit-upscale-fourview.spec.ts`。
    - ⚠️ **局部重绘真机上是坏的**（2026-10-12 验的）：掩码对（单独跑探针确认过白框落在抠掉的位置）、尺寸跟原图一样、遮罩外没动，但**要重画那块是纯黑的**。查出来的两件事：① ComfyUI 的 `LoadImage` 会把 RGBA **按 alpha 合成到黑底**，所以「一张 PNG 同时当底图和掩码」那套下，要重画那块在底图里永远是黑的（把框里填中灰也一样黑）；② 改成 **底图和掩码分两张传**（`inpaintGraph` 现在生成两个 `LoadImage`，掩码取 MASK 口）**还是黑**，而且换 seed、denoise 0.85→1，出图**逐字节一样** —— 生成结果没落到那块上。**问题在 E05 这条流程本身**：`docs/reports/P24.md` 当时只验了「遮罩外 827927 个像素没动」，没验「遮罩里画成了什么」。**修好之前别拿局部重绘干活动**，下一步是查 `InpaintCropImproved` / `InpaintStitchImproved` 的出入参或者换一条 inpaint 流程，见 `docs/reports/P29.md`。

## 6. 界面

界面全中文。第三批的界面照设计 agent 新出的原型做（给设计的需求见 `docs/design-handoff-image.md`），原型出来后把文件名补到对应的小节里。

### 6.1 首页 `/`

最常做的是接着改上次的节点，其次是找回打过星的提示词，管理画布最少。样子照 `web/prototype/home.html`。

- 顶栏：工作文件夹路径（点了去设置里换）、明暗、设置、「新建画布」（输入标题，最多 30 个字）。
- 这台机器上要处理的事：只在有问题时出现在最上面。现在只有一种：某套模型配置在本机还没填密钥，按钮去设置里的模型配置。
- 最近动过的节点：跨全部画布，最多 8 个，按节点最后改动的时间排。只算自己发过消息的节点，岔出来还没发过消息的不算。卡片上有槽位缩略图、标题、星、正在生成或回复失败、概述、画布名、多久前动过、几个方向、时长和比例。点一下进画布并打开这个节点的对话，地址是 `/canvas/:id#node=节点 id`，画布读出来后去掉 `#node=`。
- 打过星的提示词：宽屏在右栏，滚动时一直在；窄于 1080 像素排在最近节点下面。所有版本里打过星的框都列，新写的在前。每条有框名、概述、这条回复当时带的图和时长比例、「画布 › 节点」（点了跳到这个节点）、多久前写的；能复制原文、复制翻过的各语言译文、看上传清单。
- 生图节点（第三批）：最近动过的节点卡片上，出过图的显示最近出的图（5.14）；打过星的生图框列出标签（带中文）和这个框出过的图，能复制、「再出图」（5.19），没有译文和上传清单。
- 全部画布：按最近动过排，画布本身或里面任一节点改过都算。卡片上有封面（最近放进槽位的图）、几个节点正在生成、节点数、几个节点打过星、多久前动过。能按名字找。菜单和右键：打开、改名、删除（移到 `.trash/`，确认一次，底部提示条里能撤销）。
- 读工作文件夹时显示占位卡片和「正在读取」；读不出来（同步盘没连上、文件夹被挪走）整页提示「打不开工作文件夹」，能重试或去设置里换，这时新建画布点不了。一个画布都没有时显示「还没有画布」和新建按钮。
- 没设工作文件夹时，进首页直接跳到首次设置。

### 6.2 画布页 `/canvas/:id`

三栏：左资产库（可收起，默认 280px 宽）、中画布、右对话面板（默认 480px 宽，可拖宽）。

画布：

- 节点卡片（约 260px 宽）：标题（双击改）、9 格小缩略图（空格显示为虚线框）、概述（当前路径最新一条 assistant 的第一个框；有多个框时右上角显示「3 个方向」）、右上角星标、折叠时下方显示「▸ 已收起 N 个」；标着「视频」或「生图 · 系列」，生图节点边框是紫色（5.23）。
- 点卡片选中并在右侧打开；连线从父指向子。
- 卡片右键菜单：fork 到新节点（等于从最后一条消息 fork）、折叠/展开、删除（弹确认，写明会一起删多少个子节点）、重命名。
- 工具栏：「新建节点」（点开选视频节点或生图节点，5.23；空节点放在画布空白处）、「自动排整齐」（dagre 从左到右，和 fork 新节点放在原节点右侧一致）、缩放归位。
- 拖动节点后保存位置。

右侧面板从上到下：

1. 头部：标题、模型配置下拉、系统提示词下拉、带几轮下拉（5.4）、对话目录按钮。对话目录浮在面板左边（画布工具条下面），当前路径上每发一次需求算一轮，列出需求前两行、时间和回复写了什么（几个方向、第一个框的标签或概述、没有提示词、失败、叫停），点一下滚到那一轮并闪一下；开没开记在浏览器里。
2. 消息列表。用户消息靠右：上方灰字 `systemNote`，气泡内文字，下方带编号的小缩略图。assistant 消息靠左：框外文字按 Markdown 渲染；每个提示词框是一个组件，标签在框顶，内容用等宽以外的可读字体、保留换行；框底一排按钮：复制、翻译（见 5.11）、星标、编辑、上传清单、沿此方向 fork。消息悬停出操作：用户消息「编辑」「从这里 fork」；assistant 消息「重新生成」「从这里 fork」；有兄弟版本时显示 `‹ 1/2 ›`。失败的消息显示错误和「重试」。
3. 槽位区：一行 9 格，填了的显示缩略图和编号，悬停显示删除；支持 5.1 里的拖拽。右边是时长（4–15 下拉）和比例下拉。点有图的格子出菜单，第一项「放大看」：弹窗显示画布里存的那张图，先整张放进窗口，点图切换原始大小，点图外面的空白或 Esc 关掉。
4. 输入框：Enter 发送，Shift+Enter 换行；发送中显示「停止」。第二批换成 Tiptap 编辑器，输入 @ 弹出选图窗口，选中的图在框里显示成带缩略图的小标签。
5. 生图节点（第三批，规则见 5.12 到 5.21）：槽位区右边是尺寸、张数和出图设置；提示词框里的标签显示成带中文的小块，框下面挂着出的图，每次生图一组，排队、进度、失败、叫停都显示在这里；点一张看大图和全部参数，能下载、打星、删除、在资源管理器里显示、同样参数再来、只换种子再来、放大和重绘（5.21）、局部重绘（在大图上涂要重画的地方）。回复上面是思考（5.12）。画布上一直看得到现在用哪台 ComfyUI 和它的状态，用 AutoDL 时还有开机中、运行中、多久后自动关机。

### 6.3 资产库（左栏）

- 顶部：搜索框（按文件名，不区分大小写，子串匹配，搜全部导入过的文件夹，按选的排法取前 200 条）、「导入文件夹」（弹系统窗口；非 Windows 或弹窗失败时显示路径输入框）、「拼图」（第二批）。
- 文件夹树：每个导入的根文件夹一棵，可展开子文件夹；右键「移除」（只从库里移除，不动文件）。
- 图片网格：当前文件夹下的图片，缩略图懒加载，超过 200 张用虚拟滚动。单击选中，Ctrl/Shift 多选，双击放进下一个空槽位，拖拽到槽位区。
- 排序：网格上方一个下拉，修改时间（新的在前）、修改时间（旧的在前）、文件名（A 到 Z）、文件名（Z 到 A），默认新的在前；修改时间一样的按文件名。选过的存在这台电脑的浏览器里，下次打开照上次的。搜索结果、「@」选图那排、拼图窗口里选图那栏都跟着这个排法。文件夹里的图服务端一次全给，浏览器自己排，换排法不用重读硬盘；搜索最多给 200 条，要服务端先排好再取。
- 打开某个文件夹时重新扫描一次（超过 5 秒没扫过才扫），另有「刷新」按钮。
- 只列 jpg、jpeg、png、webp；heic、heif 灰显「不支持」。第四批起也列视频和音频，见 5.31。

### 6.4 设置页 `/settings`

- 工作文件夹：路径 + 「选择」（系统窗口）。第一次设置时初始化目录结构并复制默认提示词。
- 模型配置列表：名字、接口地址、key（显示时打码）、模型名、发图长边、价格（币种 ¥ 或 $，输入、输出、缓存命中三个价，按每百万 tokens 填，留空当 0）；「测试连接」调一次 `/v1/models` 或发一条极短消息。
- 填了价格后，每条回复角落显示这次花了多少钱：命中缓存的输入按缓存价、其余输入按输入价、输出按输出价。命中的 token 数从接口的 `usage.prompt_tokens_details.cached_tokens`（DeepSeek 是 `prompt_cache_hit_tokens`）取，接口不报就当没命中。
- 系统提示词：列出 `prompts/*.md`，右侧文本编辑器，保存、新建、删除、「用外部编辑器打开」（服务端 `start <文件>`）。自带五套视频的：`ref2va`（参考模式，六个部分，新建节点默认用它）、`i2v`（一张图当首帧）、`t2v`（纯文字）、`fl2va`（首尾帧各一张图）、`l2va`（一张图当尾帧），列表里按这个顺序排在前面。
- 程序固定附加的格式要求：只读显示。
- 资产库文件夹列表（和左栏同一份数据）。
- 第三批加的：
  - 模型配置加「思考写法」和「开思考用的模型名」；思考一节：总档位和三个用途（5.12）。
  - 系统提示词列表标出生图用的和系列；自带的 `il`、`pony` 排在视频的五套后面；生图的固定格式要求也能看（5.14）。
  - ComfyUI：局域网地址和测试连接；AutoDL 的 Token、实例、开机关机、空闲多久自动关机（5.17）。
  - 底模和默认值：读到的底模各属哪个系列，两个系列各自的默认值，反推用哪个模型（5.17、5.18、5.21）。
  - 工作流：导入、改名、重新指定往哪填、删除（5.18）。
  - 预设：改名、删除（5.21）。
  - AutoDL 上的模型：那台还剩多少空间，自己传的列表，从电脑传、给链接下、删（5.22）。
  - 词库：哪天的、多少个标签、多少个有中文、多少条别名，「更新词库」、进度和停止（5.13）。
  - 片段库（5.16）。
  - 出的图：临时文件夹的路径，能在资源管理器里打开（5.20）。
- 后来加的：对话一节，最多带几轮（5.4），存 `settings.json`。

## 7. 服务端接口

全部在 `/api` 下，JSON。路径参数里凡是文件路径，必须在导入的资产文件夹或工作文件夹之内，否则 403。

```
配置       GET/PUT  /config                         （modelConfigs 每项是工作文件夹里的配置加上本机的 apiKey；GET 时 apiKey 打码；PUT 里 key 为 "******" 表示不改）
提示词     GET      /prompts                         列表（第三批起每项带用途和系列 {name, use, family}）
           GET/PUT  /prompts/:name                   读/写
           POST     /prompts                         新建 {name, text}
           DELETE   /prompts/:name
           GET      /prompts/:name/history/:hash     历史版本
           GET      /format-requirement              固定格式要求原文（第三批起两份 {video, image}）
首页       GET      /home                            {canvases, recentNodes, starred, images}，见 6.1；工作文件夹读不了返回 503 和原因
画布       POST     /canvases                        新建 {title}
           GET      /canvases/:id                    canvas.json + 每个节点的摘要（标题、slots、概述、星、折叠）
           PATCH    /canvases/:id                    {title} 或 {nodes:[{id,x,y,collapsed}]}
           DELETE   /canvases/:id                    移到 .trash
节点       POST     /canvases/:id/nodes              新建空节点 {x,y,kind?}，kind 不给就是 video（5.23）
           GET      /canvases/:id/nodes/:nid         完整节点
           PATCH    /canvases/:id/nodes/:nid         {title, modelConfigId, systemPromptName, slots, duration, aspectRatio, draft, activeChildOf, turnLimit}
           DELETE   /canvases/:id/nodes/:nid         连同子节点移到 .trash
           POST     /canvases/:id/nodes/:nid/fork    {messageId, draftPrefix?} → 新节点
消息       POST     /canvases/:id/nodes/:nid/send    {parentId, text} → SSE 流
           POST     /canvases/:id/nodes/:nid/messages/:mid/regenerate      → SSE 流
           POST     /canvases/:id/nodes/:nid/messages/:mid/edit  {text}    → SSE 流（用户消息的新版本 + 回复）
           POST     /canvases/:id/nodes/:nid/messages/:mid/edit-prompt {promptIndex, text} → 新 assistant 版本，不调模型
           POST     /canvases/:id/nodes/:nid/handwritten {parentId, text} → 节点；自己写的框，不调模型（5.14）
           POST     /canvases/:id/nodes/:nid/messages/:mid/star {promptIndex, on}
           POST     /canvases/:id/nodes/:nid/messages/:mid/translate {promptIndex, language, instruction?} → 这份译文（等模型写完才返回，见 5.11）
           POST     /canvases/:id/nodes/:nid/stop     停止正在生成的回复
图片       POST     /canvases/:id/images             {path} → ImageRecord（做 5.6 的处理）
           POST     /canvases/:id/images/upload      ?name=&nodeId= 加图片内容 → ImageRecord（从文件夹拖进来的）
           GET      /canvases/:id/images/:iid/file   画布副本
           GET      /canvases/:id/images/:iid/thumb
           GET      /canvases/:id/images/:iid/checklist-path   {path, kind:'original'|'canvas', note}
资产库     GET      /assets/folders                  导入过的根文件夹
           POST     /assets/folders                  {path}
           DELETE   /assets/folders                  {path}
           POST     /assets/pick-folder              弹系统窗口 → {path} 或 501
           GET      /assets/tree?root=               子文件夹树
           GET      /assets/list?folder=             图片列表 [{path,name,size,mtime,supported}]，按文件名排
           GET      /assets/search?q=&sort=          跨全部根文件夹，按 sort 排好取前 200 条；sort 是 time-desc、time-asc、name-asc、name-desc，不带是 name-asc
           GET      /assets/thumb?path=
           POST     /assets/reveal                   {path} 在资源管理器里显示
           POST     /assets/collage                  {files,rows,columns,cell,numbers,folder} → {path,folder,width,height,inLibrary}
大模型     POST     /llm/test                        {modelConfigId} → {ok, error?}

第三批（/config 另加本机的 comfyTarget、autodlToken（GET 时打码）、lastDownloadFolder；comfyClientId 只在服务端用，不返回）：
设置       GET/PUT  /settings                        工作文件夹 settings.json
词库       GET      /tags/search?q=                  见 5.13
           POST     /tags/check                      {tags, family} → 每个标签的校验结果
           GET      /tags/info                       哪天的、多少个标签、多少个有中文、按使用次数算有中文的比例、多少条别名
           POST     /tags/update                     → SSE，下到哪一步；停了推 {type:'stopped'}
           POST     /tags/update/stop                停止更新，旧的不动
           POST     /tags/convert                    {canvasId, nodeId, text} → 标签（让模型转，5.15）
片段       GET/POST /fragments
           PATCH/DELETE /fragments/:id
预设       GET/POST /image-presets                    POST {name, family, settings}，名字重了 409
           PATCH/DELETE /image-presets/:id            PATCH {name?, settings?}
ComfyUI    GET      /comfy/status?target=lan|autodl  局域网那台连不连得上、版本、显卡；target=autodl 回 AutoDL 实例的状态、多久后自动关机
           GET      /comfy/options?target=&refresh=1 底模、LoRA、采样器、各种模型、提取方式、有哪些节点类型；不带 target 用这台电脑出图用的那台。AutoDL 关着时给读过的
           GET      /comfy/autodl/instances          用本机 Token 列实例
           POST     /comfy/autodl/power              {on} 开机或关机
           GET      /comfy/autodl/models             {free, files: RemoteModelFile[]}，那台关着时 409
           POST     /comfy/autodl/models/check       {kind, folder, name, size, replace?} 从电脑传之前问：同名的有了 409，空间不够 400；关着的先开机
           POST     /comfy/autodl/models/upload      请求体就是文件本身，?id=&kind=&folder=&name=&size=&replace=1；边收边传，传完才返回
           POST     /comfy/autodl/models/download    {kind, url, folder?, name?, replace?}
           GET      /comfy/autodl/models/transfers   ModelTransfer[]
           POST     /comfy/autodl/models/transfers/:id/stop
           DELETE   /comfy/autodl/models             {kind, path}
工作流     GET      /workflows
           POST     /workflows                       {name, file, graph, fill} → 存好的工作流。往哪填在导入窗口里就认好、挑好了，点「导入」才发
           PATCH    /workflows/:id                   {name, fill}
           DELETE   /workflows/:id
出图       POST     /canvases/:id/nodes/:nid/messages/:mid/images   {promptIndex, again?, refine?, inpaint?} → ImageJob
                    again 是「同样参数再来」「只换种子再来」{jobId, index, sameSeed}
                    refine 是出完的图上补做放大和部位重绘 {jobId, index, upscale, details}（5.21）
                    inpaint 是局部重绘 {jobId, index, mask, tags, denoise}，mask 是和原图一样大的黑白 PNG（白的是要重画的地方），base64
           POST     /canvases/:id/nodes/:nid/messages/:mid/images/:jobId/stop
           DELETE   /canvases/:id/nodes/:nid/messages/:mid/images/:jobId/:index          删一张
           POST     /canvases/:id/nodes/:nid/messages/:mid/images/:jobId/:index/star     {on}
           POST     /images/download                 {items: [{canvasId, nodeId, messageId, jobId, index}], folder} → {paths, inLibrary}
           GET      /canvases/:id/nodes/:nid/messages/:mid/images/:jobId/:index/file    出的图；临时文件清掉了用下载的那份，都不在返回 404（显示「已清理」）
           GET      /canvases/:id/nodes/:nid/messages/:mid/images/:jobId/:index/thumb   缩略图，找图的办法同上
           GET      /canvases/:id/nodes/:nid/messages/:mid/images/:jobId/:index/where   {temp, saved}：临时文件夹里的、下载的那份各在不在，大图旁边显示
           POST     /canvases/:id/nodes/:nid/messages/:mid/images/:jobId/:index/reveal  在资源管理器里显示
           GET      /image-temp                      临时文件夹在哪、按日期分的子文件夹各有几张多大、上次下载到哪（在不在资产库里）
           POST     /image-temp/open                 在资源管理器里打开临时文件夹，还没有就先建
           POST     /images/tagger                   {canvasId, imageId} 或 {canvasId, nodeId, messageId, jobId, index} → 反推出的标签
           GET      /image-jobs/events               SSE，见下面
视频       POST     /canvases/:id/nodes/:nid/messages/:mid/videos   {promptIndex} 或 {again: {jobId, sameSeed}} → VideoJob（第四批）
           POST     /canvases/:id/nodes/:nid/messages/:mid/videos/:jobId/stop
           DELETE   /canvases/:id/nodes/:nid/messages/:mid/videos/:jobId
           GET      /canvases/:id/nodes/:nid/messages/:mid/videos/:jobId/file       视频文件，临时文件清掉了用下载的那份，都不在 404；支持 Range，能拖进度条
           POST     /videos/download                 {folder?, item: {canvasId, nodeId, messageId, jobId}} → {path}
           GET      /video-jobs/events               SSE，见下面
           GET      /comfy/video/status              生成视频那台的 AutoDL 状态
           POST     /comfy/video/power               {on} 开机或关机
视频音频   POST     /canvases/:id/media              {path, seconds, width?, height?, hasAudio?} → MediaRecord（P22，见 5.31）
           POST     /canvases/:id/media/upload       ?name=&seconds=&width=&height=&hasAudio= 加文件内容 → MediaRecord（从文件夹拖进来的）
           GET      /canvases/:id/media/:mid/file    画布里那份，支持 Range
           GET      /assets/file?path=               资产库里的视频、音频原文件，预览和读多长用，支持 Range
```

节点的 PATCH 第四批起也收 `media`（视频和音频槽位）。

出图事件（`/image-jobs/events`，第三批）：`{type:'job', canvasId, nodeId, messageId, job}`（任务或其中一张的状态变了，发整个任务）、`{type:'progress', jobId, index, step, total}`、`{type:'queue', jobId, index, position}`、`{type:'autodl', state, since, idleLeftMs, …}`（AutoDL 实例的整个状态，新连上的页面先收到一次）。

视频事件（`/video-jobs/events`，第四批）：`{type:'job', canvasId, nodeId, messageId, job}`、`{type:'progress', jobId, stage, chunk, chunks, step, steps}`（stage 是 encode、pass1、upscale、pass2、save）、`{type:'queue', jobId, position}`、`{type:'removed', canvasId, nodeId, messageId, jobId}`（删掉了一条）、`{type:'autodl', …}`（生成视频那台的整个状态，新连上的页面先收到一次）。

SSE 事件（send / regenerate / edit 共用）：`{type:'user', message}`（send 和 edit 先发这个）、`{type:'assistant-start', message}`、`{type:'delta', text}`、`{type:'done', message}`（含解析结果和 usage）、`{type:'error', message}`。第三批加 `{type:'reasoning', text}`，是思考原文的一段（5.12）。服务端收到流的每一段就落盘一次 `text`（节流 1 秒），中断后再打开也能看到已收到的部分。

调接口时 `stream: true`，解析 `data:` 行；`usage` 有就记，含命中缓存的输入 token 数。请求失败或非 2xx，把状态码和返回体前 500 字写进 `error`。

## 8. 分阶段开发

每个阶段做完：测试全绿；写一份 `docs/reports/Px.md`（做了什么、怎么试、跑了哪些测试和结果、没做的和疑问）；等用户看过再进下一阶段。不要自己合并阶段，不要提前做后面阶段的东西。

### P0 骨架

做：仓库和三个包；服务端能起、读写本机配置、初始化工作文件夹、复制默认提示词；前端三个路由的空页面；设置页能填工作文件夹和模型配置、测试连接；`tools/mock-llm`；vitest 和 Playwright 跑通一个冒烟用例；仓库根目录写 `CLAUDE.md`（怎么装、怎么跑、怎么测、不要自动提交）。

完成标准：`npm run dev` 打开首页；设置页设好工作文件夹后 `prompts/` 里出现自带的提示词；对 mock-llm 测试连接返回成功。

### P1 画布和对话（还没有图片）

做：首页画布列表和增删改；画布页三栏布局（左栏先留空）；新建节点、卡片、连线、拖动、自动排整齐、折叠、删除；右侧面板发送消息、流式显示、停止；回复解析成标题和提示词框（复制按钮先做）；版本树：编辑用户消息、重新生成、切换版本；fork（从用户消息和从 assistant 消息两种）；沿第 N 个方向 fork；模型配置和系统提示词按节点选；系统提示词历史版本记录；设置页的系统提示词管理和固定格式要求查看（6.4）；错误显示和重试。

完成标准：见 10.1 第 1、5、6、7、8、10、12、13 条，用 mock-llm 全部通过。

### P2 资产库和槽位

做：导入文件夹（系统窗口 + 路径输入）、文件夹树、网格、缩略图缓存、搜索、刷新；槽位区和 5.1 全部操作；5.6 图片处理；5.4 的 systemNote 和 attachments；时长和比例；快照跟着消息、切换版本时槽位跟着变；卡片上的 9 格缩略图。

完成标准：10.1 第 2、3、4、9 条通过；用 6000 像素宽的测试图放进槽位后，画布副本长边是 5760，`processed.reason` 是 `too-large`。

### P3 提示词框的功能

做：星标（框和卡片）；手动改提示词生成新版本；上传清单；assistant 消息角落显示模型和提示词名、可查看当时的提示词全文；usage 显示；`videos` 字段和一个空组件占位（不显示任何内容）。

完成标准：10.1 第 11、14 条通过；手动改过的提示词复制出来是改过的内容。

### P4 第一批收尾

做：跑完整的端到端用例；用户按 11.1 手动验收清单用真模型过一遍；修问题；写 `README.md`（安装、运行、数据在哪、怎么换机器）。

### P5 @ 选图（第二批）

做：输入框和提示词编辑框换成 Tiptap；输入 @ 弹出选图；小标签按 imageId 显示当前编号，调顺序自动变；发送或保存时序列化成 `<Picture N>`；引用的图已不在槽位时阻止发送并提示；点击空槽位或已有槽位也用同一个弹窗选图。

细节：弹窗上半部分「当前槽位」列出 9 格；下半部分是整个资产库（搜索框按文件名搜，停手 200 毫秒再搜，还能按文件夹翻）。选资产库里的图时，先放进下一个空槽位再插入标签；槽位满了就提示「槽位已满」不插入。

完成标准：10.2 第 1、2 条。

### P6 拼图（第二批）

做：资产库「拼图」按钮打开拼图面板（盖在画布上，左边资产库照样能拖）；选行数和列数（各 1–3，不能 1×1）；从资产库拖图进格子，格子间拖动调顺序；「加编号」开关，默认开；每格是正方形，边长可选 1024（默认）或 1536；图完整放进格子，空白补白色；编号开启时在左上角画黑字白底圆角小框，字高约格子边长的 5%；导出 JPEG 质量 92；保存前弹系统窗口选文件夹（记住上次），文件名 `collage-YYYYMMDD-HHmmss.jpg`；保存后如果那个文件夹在库里，刷新出现；不在库里，问要不要导入。

完成标准：10.2 第 3 条。

### P7 撤销（第二批）

做：Ctrl+Z / Ctrl+Shift+Z，客户端撤销栈 50 步，覆盖：节点移动、节点删除（服务端从 `.trash` 恢复）、折叠、重命名、槽位改动（替换、调顺序、删除、新增）、时长和比例改动。切换画布时清空。已发出的消息不可撤销。

完成标准：10.2 第 4 条。

### 第三批：思考和生图

在新分支上做，每个阶段单独能回退。每个阶段的界面照设计 agent 出的原型做，原型还没出来的阶段先不开工。

### P8 思考

做：5.12 全部：模型配置的思考写法、设置里的档位、发请求时带参数、读思考原文、「正在思考」和折叠的思考原文；mock-llm 照 9.1 补上思考的部分。

完成标准：10.3 第 1 条。

### P9 词库和标签

做：5.13 词库（复制、读取、搜索、校验、更新）；5.14 生图节点（系统提示词开头的说明段；自带的 `il`、`pony` 和生图的固定格式要求，写好先给用户看；面板换成尺寸和张数；框上的按钮）；5.15 标签显示、拼提示词、标签编辑窗、让模型转标签（`to-tags.md` 也写好给用户看；从图反推留到 P15）；5.16 片段库；设置里的词库、片段库两节。这一步还不能出图，标签复制出去能在别处用。

完成标准：10.3 第 2、3、4 条。

### P10 出图：局域网 ComfyUI 和内置流程

做：5.17 局域网那台（地址、测试连接、读选项、底模属于哪个系列）；5.18 内置流程和两个系列的默认值；节点的出图设置；5.19 出图任务；5.20 临时文件夹和下载；图挂在框下、大图和参数、再来；卡片和首页显示出的图，首页再出图；`tools/mock-comfyui`（9.5）。

完成标准：10.3 第 5 到 8 条；用户用自己局域网的 ComfyUI 做 11.3 第 3 条。

### P11 导入工作流和 AutoDL

开工前：用用户的 AutoDL 实例核对 5.17 里文档没写的三件事。

做：5.18 导入的工作流和缺节点检查；5.17 AutoDL 全部（Token、选实例、开机关机、自动关机、退出时关机）；mock-comfyui 加上 AutoDL 的几个接口。

完成标准：10.3 第 9、10 条；用户做 11.3 第 4 条。

### P12 放大、部位重绘、预设

开工前：AutoDL 实例上 Impact Pack、Impact Subpack、放大模型、脸和全身的检测模型都有了；手的检测模型 `hand_yolov8s.pt` 要放进去才能测手。界面原型里没有的部分（部位重绘的列表、预设）照原型里出图设置的样子做，不等设计。

做：5.21 的放大、部位重绘、出完的图上补做、预设，做好后存「E02」那套；设置里去掉按系列选的默认模型（改由预设管）；mock-comfyui 照 9.5 补上。

完成标准：10.3 第 11、12 条；在 AutoDL 上用「E02」出一组，看放大和修脸都做了。

### P13 往 AutoDL 传模型

开工前：测真实例时会往那台写文件、删文件，先问用户。

做：5.22 全部；mock-comfyui 照 9.5 加假的 SSH 服务。

完成标准：10.3 第 16 条；在 AutoDL 上从电脑传一个 LoRA、给链接下 `hand_yolov8s.pt`，出图设置里都能选，用手那道部位重绘出一张。

### P14 生图节点和视频节点分开

做：5.23 全部；用到「换系统提示词变成生图节点」的测试改成直接建生图节点。

完成标准：10.3 第 17 条。

### P15 ControlNet

开工前：不用等模型，先在测试环境里测。真用之前，用户往 AutoDL 那台放 IL 能用的 ControlNet 模型和提取方式要用的模型（5.21）。

做：5.21 的 ControlNet（姿势、深度、线稿、边缘、其他）。

完成标准：10.3 第 13 条。

### P16 E02 的几样

做：5.21 的 E02 的几样，「E02」预设跟着改。

完成标准：10.3 第 18 条。

### P17 画风、图生图、反推

做：5.21 的画风、图生图、反推。

完成标准：10.3 第 14、19 条。

### P18 局部重绘

开工前：涂抹的界面原型补上。

做：5.21 的局部重绘。

完成标准：10.3 第 15 条；用户做 11.3 第 5 条。

### 第四批：生成视频

### P19 长视频生成（不带图）

做：5.24 到 5.28，不带图的部分。

完成标准：10.4 第 1 到 4 条；用户做 11.4 第 1 条。

### P19b 视频任务小窗

做：5.29。

完成标准：10.4 第 7 条。

### P19c 重拍一截

做：5.30。假的 ComfyUI 加上存档存取、切开、拼接、遮罩这几个节点。

完成标准：10.4 第 8 条；用户做 11.4 第 3 条。

### P20 参考图和首帧

做：5.26 里槽位的图怎么用那几条。参考模式（ref2va）写的回复，槽位的图都当参考图，每段都带；一图当首帧（i2v）写的，用第一张当开头，比例是「自动」的按这张图；首尾帧、尾帧两种说还不支持。

完成标准：10.4 第 5 条；用户做 11.4 第 2 条。

### P21 主模型和 LoRA

开工前：开生成视频那台，看它的 `extra_model_paths.yaml`，定自己传的 LoRA 放哪，补进 5.22。（看过了，已补。）

做：生成设置里能换主模型、挂 LoRA（几个都行，各带强度，能按名字搜，接 `LoraLoaderModelOnly`）；设置「AutoDL 上的模型」能切到生成视频那台，那台只能传 LoRA。

完成标准：10.4 第 6 条。

### P21b 加速和不加速

做：5.27 里「加速 / 不加速」那几条。

完成标准：10.4 第 9 条。

### P22 视频和音频参考

做：5.31。假的 ComfyUI 加上 `VHS_LoadVideo`、`LoadAudio`、`TrimAudioDuration`，传上来的视频、音频才能选。测试用的小视频、小音频放 `tests/fixtures/media/`。

完成标准：10.4 第 10、11 条；开 A 真机试一次参考视频、一次声音参考、一次两段 30 秒的配音，看配音跨段对不对得上口型；用户做 11.4 第 4 条。

### P23 Krea2 指令编辑

做：5.37。

完成标准：界面上「起图」多一档「编辑」；选参考图 + 框里写一句话能出图；没选参考图时拦住并说清楚；真机跑一张，改的和说的是同一件事；`typecheck` / `vitest` / `e2e` 全绿。（**已做**：真机 1024×1024、8 步、63 秒，「换成红色皮衣」出来了，见 `docs/reports/P23.md`。）

### P24a 掩码编辑器

做：5.38 里的编辑器（拖框 + 涂抹 + 擦 + 清空，导出原图像素的 alpha 掩码 PNG），先出 `web/prototype/` 原型给用户看。

完成标准：原型能在浏览器里点开看，拖框、涂、擦、清空、两工具叠加都顺眼；实现出来的导出的 PNG 正确（原图尺寸、要重画处 alpha=0、别处 255），单测覆盖缩放、非等比、小图放大。

### P24b 局部重绘的服务端和流程

做：5.38 里的接口、`inpaintGraph`、mock 节点、大图窗口入口。

完成标准：10.3 第 15 条；e2e 覆盖拖框 → 出图 → mock 收到的 PNG 涂过的地方透明。

### P24c 局部重绘的真机验证

做：在出图那台真跑一次拖框重绘，确认遮罩外真的没动；顺带定 `output_target_width/height` 和 `mask_expand_pixels` 这两个数。

完成标准：11.3 第 5 条里的局部重绘那部分。（**仅验过遮罩外不变**：832×1216、强度 0.85，遮罩外 827 927 个像素一个都没动、最大差 0，15 秒出完，见 `docs/reports/P24.md`。2026-10-12 的完整出片检查发现遮罩内是黑块，尚未达到局部重绘的验收标准，见 `docs/reports/P29.md`。）

### P25 图像编辑节点（第六批，E1）

做：5.39 里的节点类型、四份编辑提示词、设置页第三组、格式要求。

完成标准：10.3 第 18 条；e2e 覆盖三种节点、编辑节点只能选编辑用的提示词、老节点按提示词归类。报告 `docs/reports/P25.md`。

### P26 图像编辑节点的编辑栏（第六批，E2）

做：5.39 里的编辑栏（功能 → 图 → 提示词 → 开始）、`POST /canvases/:id/nodes/:nid/edit`、出的图挂在框下面。

完成标准：放一张图 + 选一句话 + 点开始，真出一张挂在框下面；图槽单选用右键开菜单。报告 `docs/reports/P26.md`。

### P27 图像编辑节点让模型参与（第六批，E3）

做：5.39 里的「模型提示词」那一行、按功能切提示词、发给模型的只有选中那张、候选框上的「用它」、输入框旁的「写一个」。

完成标准：`tests/e2e/20-edit-node.spec.ts` 的 E3 那一条；报告 `docs/reports/P27.md`。**真机验证单独记在** `docs/reports/real-machine-edit-node.md`。

### P28 图像编辑节点：转真人 / 换装（第六批，E4）

做：5.39 里的转真人（照 `docs/krea2-real-usage.md` 那份「全开关」的接线和参数）+ 换装（编辑档换 LoRA）+ 面板上两个功能的参数区。

完成标准：`tests/e2e/21-edit-real.spec.ts` 那 7 条；真机上跟作者那套同一张图对照过。报告 `docs/reports/P28.md`。局部重绘的界面和流程后来已实现，但真机遮罩内出黑块，尚未验收通过，见 5.38 和 `docs/reports/P29.md`。

## 9. 测试

### 9.1 mock-llm

`tools/mock-llm`，Express 监听 3799，实现 `POST /v1/chat/completions`（支持 stream 真假）和 `GET /v1/models`。回复内容按规则生成，测试靠它断言：

- 统计最后一条 user 消息里的图片数和它们前面的 `<Picture N>` 标签，回复里写「收到 N 张图：<Picture 1>、<Picture 2>」；没有图写「收到 0 张图」。
- 把最后一条 user 消息的第一个文本段（也就是 systemNote）原样写进「说明：…」。
- 写「历史消息 M 条」，M 是请求里除 system 外的消息数。
- 写「请求里一共 N 张图」，N 是请求里所有消息带的图加起来（测只带最近几轮时补到留下的第一轮的图，5.4）。
- 默认输出 `<title>测试标题</title>` 和一个提示词框，框里有六个部分，`summary:` 那行写「[reference generation] 测试概述，引用了 <Picture 1>」。
- 用户文字含「三个方向」→ 三个带 label 的框；含「只回答」→ 不输出框；含「报错」→ 同样的文字第一次请求返回 500，再请求就正常回复（测重试）；含「慢」→ 每段间隔 500 毫秒、总共 6 秒（测停止）。
- 系统消息里写着「翻译成某种语言」（翻译提示词框）→ 不按上面几条出回复：第一行写「译文（语言）」，系统消息里带了用户的翻译要求时接「，按要求：……」，下面接用户消息原文。提示词原文含「报错」「慢」时照样按上面的约定失败一次、慢慢写。
- 第三批：
  - 请求里带了思考参数（`reasoning_effort`、`enable_thinking`、`thinking_budget`、`thinking`，或者模型名以 `reasoner` 结尾）→ 正文最后一行写「思考参数：」加收到的参数原样，测试靠它断言发了什么；这些参数表示开着思考时（`enable_thinking` 是假、`thinking.type` 是 disabled 的不算），正文前先用 `reasoning_content` 分 4 段发「思考：……」，共 1 秒。没带思考参数的不写这一行，原来的用例不受影响。翻译的回复同样处理。
  - 系统消息里写着「转成 Danbooru 标签」（5.15 的转标签）→ 只回 `sitting, window, book, reading`。
  - 系统消息里写着「框里只放英文标签」（生图的固定格式要求）→ 出 `<title>测试图片</title>` 和一个框：`1girl, solo, long hair, blond hair, goldish hair, smile, hatsune miku`。blond hair 是官方别名，goldish hair 不认识，测 5.15。用户文字含「三个方向」时出三个框。

### 9.2 单元测试（vitest，`packages/shared`）

- `parse`：标题、单个框、多个带 label 的框、没有框、框内含 `<Picture 1>` 和 `<d>` 不被破坏、概述提取（有 summary 行、没有时取前两行）、流式半截时的状态。
- `slotDiff`：5.4 的五种情况各至少一个用例，包括「换图又追加」归入重新编号。
- `compose`：第一条消息带全部图和 note；追问不带图；时长变化只有 note；失败的 assistant 消息被跳过；content 数组顺序正确。
- `versionTree`：当前路径计算、新建消息更新 activeChildOf、切换版本不影响更深层、编辑用户消息复制快照。
- `forkChain`：从 assistant 消息 fork 含该消息；从 user 消息 fork 不含且 draft 正确；只复制链上的消息。
- `imageRules`：给定宽高和字节数，返回要不要缩、缩到多大、要不要转 JPEG，覆盖 5760、256 和 30 MB 三条边界。
- `collageLayout`：格子坐标、fit-inside 尺寸、编号位置。
- `summaryForCard`：多框时取第一个，80 字截断。
- 第三批：
  - `thinkingParams`：五种写法各配四个档位。
  - `tags`：拆标签、权重、括号转义、颜文字、拼回去。
  - 词库的搜索排序和校验：用一份几十行的小词库，覆盖开头和中间、中文名和常用叫法、别名、不认识给候选、已废弃。
  - 系统提示词开头说明段的解析。
  - 内置流程拼出的 JSON：IL 和 Pony 的 clip skip、LoRA 串联、放大（重画和不重画）、部位重绘（框和轮廓、自己写的提示词）、出完的图上补做；P15 加 ControlNet（提取和不提取、union 的类型、几个串起来、放大重画也用、部位重绘不用）；P16 加 E02 的几样；P17 加画风、图生图。
  - 导入工作流自动找填值位置：一个 KSampler、KSamplerAdvanced、两个候选、普通格式文件。
  - 种子依次加 1；临时文件名和下载文件名。
- 第四批：
  - 时长分几段：15、16、30、31、45、46、60 秒；发给模型的说明带不带段数。
  - 框切成几段：有 `|` 行、没有、`|` 两边有空行、行里夹着 `|` 的不切。
  - 帧数：60 秒 4 段 1382、15 秒 1 段 362、20 秒 2 段、4 秒、段数比时长该有的少。
  - 一采和出片宽高：16:9 的 0.3 到 1 几档对上 ComfyUI 那张表，9:16、1:1、自动；放大 1.5 和 2。
  - 拼出的 JSON：几段提示词连起来、两个 `MMH3LoopingSampler` 的帧数和步数、放大倍数、种子、输出到 `media-agent/`。

### 9.3 服务端集成测试（vitest + supertest，用临时工作文件夹）

- 画布增删改查、删除进 `.trash`。
- 首页数据：最近动过的节点只算自己发过消息的；打过星的提示词带当时的图和译文，岔出去的节点复制来的只列一次；画布动过的时间算上节点；工作文件夹读不了返回 503。
- 星标：岔出去的节点复制来的星，画布卡片上不显示；它自己回复里打的星照常显示。
- 节点 fork：链复制正确、槽位和时长正确、父子关系正确。
- send 走 mock-llm：SSE 事件顺序、消息落盘、解析结果、标题写进节点；regenerate 生成兄弟；edit 生成用户版本并复制快照；edit-prompt 不调模型；handwritten 不调模型，之后发给模型时当成用户说的话。
- 图片导入：正常图原样复制；6000 像素图缩到 5760；200 像素图放大到 256；同一文件第二次导入复用 id；`.llm.jpg` 长边 1600。
- 资产库：扫描只列支持的格式；搜索跨根文件夹；路径越界返回 403。
- 停止生成后消息保留已收到的部分。
- 30 MB 的用例用 `it.skip` 标出并写明原因（生成大图慢），改为手动验收。
- 第三批：
  - 词库接口（用小词库）；更新词库对着 mock 起的假 Danbooru 接口，全部下完才换掉，中途失败旧的不动。
  - 出图任务对 mock-comfyui 的全过程：排队、进度、完成，文件出现在 `image-temp/当天/`；叫停排队的和正在跑的；几种失败的说法；服务重启后接着取图。
  - 下载：复制过去，文件夹不在资产库时 `inLibrary` 为假。
  - AutoDL：出图时自动开机，空闲到点自动关机，到点时 ComfyUI 上还有任务不关（用假时钟）。
  - 缺节点时不发任务，内置流程开了部位重绘而这台没装 Impact Pack 时也一样。
  - 出完的图上补做：传上去的是那张图，拼出的流程从 `LoadImage` 开始，出的图挂在同一个框下；补做出的图再来时重新传原图。
  - ControlNet：槽位里的、出过的参考图都传上去，拼出的流程里有提取和 ControlNet；开着的没选参考图、没选模型返回 400；参考图找不到了这组算失败；没装 `AIO_Preprocessor` 时不发，都选了不提取的照发。
  - E02 的几样：默认的不记，打开的记进这一组，同样参数再来、补做照用；权重算法、LoRA 作用在哪只收那两种；P16 之前存的预设按默认的补上；选了 A1111 而没装插件时不发。
  - 预设：增删改，名字重了 409。
  - 节点类型：新建生图节点用 `il`；生图节点换成视频用的系统提示词返回 400；没有类型的老节点按提示词归类；岔出来的和原节点同一种。
  - 往 AutoDL 传模型（对 mock 的假 SSH 服务）：从电脑传先写成 `.part` 再改名；停了删掉半截的；空间不够不开始；同名不带换掉的 409；给链接下，`huggingface.co` 换成 `hf-mirror.com`；删除；路径带 `..` 返回 400；快照里的密码不出现在任何返回里。
- 第四批：
  - 生成视频那台：选成出图那台返回 400；生成时自动开机，空闲到点关机，和出图那台互不影响。
  - 生成视频任务对 mock-comfyui 的全过程：排队、开机、各步进度、完成，mp4 出现在 `video-temp/当天/`；叫停排队的和正在跑的；几种失败的说法；服务重启后接着等；同样参数再来、只换种子再来；删掉；下载。
  - 没选生成视频那台、框分了 5 段、回复带了图（P19）返回 400；缺 MMH3 节点时不发。
  - 视频文件接口：带 Range 的请求回 206；临时文件清掉了用下载的那份。
  - 视频和音频参考（P22）：资产库列出来、原文件按 Range 取；放进画布复用同样内容、拖进来的边收边存、不到 2 秒的不收；槽位校验；发给模型的说明和截帧（第一条、没变、变了、全删）；岔出、改这句带着；生成时传文件、各接各的、超上限不发、首帧和纯文字只带配音、重拍有配音的声音钉住。

### 9.4 端到端（Playwright，对 mock-llm）

用例见第 10 节。测试前用脚本生成 `tests/fixtures/images/`：五张 800×600 的纯色带文字 JPEG、一张 6000×4000、一张 200×150、一个 `.heic` 空文件。第三批的用例还要起 mock-comfyui。

### 9.5 mock-comfyui（第三批）

`tools/mock-comfyui`，Express 加 WebSocket，监听 3798，接口的样子照真的 ComfyUI：

- `/system_stats`、`/object_info`：两个底模 `il-test.safetensors`、`pony-test.safetensors`，一个 VAE `sdxl_vae.safetensors`，三个 LoRA（两个放在子文件夹 `IL/` 里，测按名字搜；`LoraLoaderModelOnly` 列同样的），常用的采样器和调度器，三个检测模型（`bbox/face_yolov8m.pt`、`bbox/hand_yolov8s.pt`、`segm/person_yolov8m-seg.pt`）和一个 SAM 模型 `segm/sam_vit_b_01ec64.pth`（真的 ComfyUI 上也和检测模型列在一起，检测模型的下拉里不该有它；`SAMLoader` 里列的是 `sam_vit_b_01ec64.pth`），ControlNet 三个（`openpose-test.safetensors`、`depth-test.safetensors`、`union-test.safetensors`），放大模型、IP-Adapter、CLIP Vision、反推模型各一个，`AIO_Preprocessor` 列几种常用的提取方式。插件节点（`FaceDetailer`、`SAMLoader`、`UltralyticsDetectorProvider`、`BNK_CLIPTextEncodeAdvanced`、`WD14Tagger|pysssss`、`AIO_Preprocessor`、`IPAdapterAdvanced`、`InpaintCropImproved`、`InpaintStitchImproved`）默认都有，测试能通过接口去掉某几个，测缺节点。整份 `/object_info` 照 AutoDL 那台缓存，底模、LoRA 文件夹最外层变了才重做；`/object_info/<节点类型>` 不缓存。
- 出的图多大：有 `ImageScale` 的按它的宽高，不然有空白画布的按画布，不然按 `LoadImage` 那张传上来的图。
- `/prompt`：检查底模文件名和节点类型，不对就返回 `node_errors`；正面提示词顺着 `KSampler` 的 `positive` 往上找，中间隔着 ControlNet 的照样找得到；收下后排队，一个一个跑，每个 5 步、共 1.5 秒，WebSocket 按真的格式发 `executing`、`progress`、`execution_success`。
- 正面提示词含「慢」→ 每个跑 6 秒，测叫停；含「报错」→ `execution_error`；含「显存」→ 错误里写 `CUDA out of memory`。
- `/history`、`/view`：图是按尺寸现画的 PNG，上面写着种子和正面提示词的前 40 个字；`/upload/image` 收图；`/queue` 能删；`/interrupt` 停当前的。
- `WD14Tagger|pysssss` 的输出固定是 `1girl, solo, smile`。
- AutoDL 的几个接口（list、status、snapshot、power_on、power_off）：一个实例，开机 2 秒后变运行中，6006 的访问地址指回 mock 自己。
- 假的 SSH 服务（ssh2 的 Server）：快照里的 `ssh_command`、`root_password` 指向它。那台的文件落到 mock 的临时文件夹；能执行的命令只认程序发的几种（`cat >` 收文件、看剩余空间、取大小、列文件、建文件夹、改名、删、curl 下载），curl 下 127.0.0.1 的地址真去取，`hf-mirror.com` 给一个假文件，Civitai 和 HuggingFace 本站连不上。
- 收到的每个 `/prompt` 请求体和 `/upload/image` 的文件都记下来，测试用 `GET /_last-prompts`、`GET /_uploads` 取，断言程序拼的 JSON 和传上去的图。
- 第四批：`/object_info` 加上长视频流程用到的节点（主模型、文字编码、两个 VAE 的文件名照 AutoDL 那台）。收到有 `MMH3LoopingSampler` 的任务时按长视频跑：先「编码提示词」，一采每段 10 步、二采每段 3 步（照流程里 `BasicScheduler` 的步数），段数按 `MMH3ReferenceMultiPrompt` 里的提示词数，再「存文件」；每步多久能配，默认 40 毫秒。出的是一个很小的真 mp4（放在 mock 的 fixtures 里，VP9 编码，Playwright 带的 Chromium 能播；真的 H3 出的是 H.264），`/view` 按 `video/mp4` 给。提示词含「慢」「报错」「显存」的规矩同出图，出错在一采第 1 段第 2 步。AutoDL 有两台实例：出图那台和生成视频那台，各开各的。

## 10. 端到端用例

### 10.1 第一批

1. 新建画布 → 新建节点 → 发「写一个」→ 看到标题「测试标题」、一个提示词框、卡片概述含「测试概述」。
2. 导入 fixtures 文件夹 → 双击三张图（两张 800×600 和那张 6000×4000）→ 槽位显示 1、2、3 → 发「写一个」→ 回复含「收到 3 张图：<Picture 1>、<Picture 2>、<Picture 3>」，说明含「参考图共 3 张」和「视频时长 8 秒」。
3. 把第四张图拖到 2 号槽位 → 发「改一下」→ 回复含「收到 1 张图：<Picture 2>」，说明含「换成了」。
4. 删除 1 号槽位 → 发「再改」→ 回复含「收到 2 张图」，说明含「重新编号」。
5. 从最后一条 assistant 消息 fork → 画布多一个节点和一条线，槽位一样 → 在新节点发消息 → 回复里「历史消息」数 = 原路径条数 + 1。
6. 从第一条用户消息 fork → 新节点输入框预填该文字，消息列表为空。
7. 编辑第一条用户消息 → 显示 `1/2`，后面的消息消失 → 切回 1 → 后面的消息回来。
8. 重新生成 → assistant 显示 `1/2`。
9. 时长改成 12 → 发消息 → 说明含「视频时长改为 12 秒」，不带图。
10. 发「三个方向」→ 三个框 → 卡片显示「3 个方向」→ 点第二个框的「沿此方向」→ 新节点输入框预填含「第 2 个方向」。
11. 打开第 2 条用例那条回复的上传清单 → 三行，路径是 fixtures 里的原路径；对 6000 像素那张，路径指向画布副本并标「已处理」。
12. 删除有两个子节点的节点 → 确认框写「连同 2 个子节点」→ 三个都消失；折叠一个有子节点的节点 → 子节点隐藏，卡片显示「已收起」。
13. 发「报错」→ 显示错误和重试 → 重试成功。
14. 编辑第一个提示词框，改一个词 → assistant 显示 `1/2` → 复制按钮复制的是改过的。

### 10.2 第二批

1. 输入 @ → 弹窗列出当前 3 张 → 选 2 号 → 出现小标签 → 发送 → 请求里的用户文字含 `<Picture 2>`。
2. 输入 @ 后搜索文件名选一张不在槽位的 → 4 号槽位出现它，标签显示 `Picture 4`；把它拖到 1 号位 → 标签变 `Picture 1`。
3. 拼图 2×2、边长 1024、四张图、关掉编号 → 文件存在，尺寸 2048×2048，左上角是纯白；带着编号再拼一次 → 左上角像素区域不是纯白。
4. 删除节点后 Ctrl+Z → 节点回来，子节点也回来；改槽位顺序后 Ctrl+Z → 顺序恢复。
5. 点框上「翻译」→ 选日文、写要求「台词也翻译」→ 译文第一行是「译文（日文），按要求：台词也翻译」，复制译文拿到的是它 → 关掉再打开，停在日文、要求还在 → 清空要求重新翻译，旧的换掉。
6. 点 2 号槽位选「放大看」→ 弹窗标题含「2 号」、文件名和 800×600，图的原始宽度是 800 → 切原始大小再切回 → 点图外面关掉。
7. 发三轮（普通、「只回答」、「三个方向」）→ 打开对话目录，三项分别含需求文字、没有提示词、「3 个方向 · 方向一」→ 点第一项，第一条需求滚进视野 → 刷新后目录还开着。
8. 把提示词框手动改成含「报错」和「慢」的 → 翻译，底部提示「「提示词」翻成英文失败：」→ 再翻，窗口里是「正在翻成英文」、英文那行写着正在翻、按钮不能点 → 关掉窗口，翻好后底部提示 → 再打开点重新翻译，顶上提示正在重新翻译、标着旧译文，翻完提示消失。
9. 首页：新建画布不起名字提示「先起个名字」→ 菜单里改名 → 右键删除，提示条里撤销，画布回来。用接口建两个发过消息的节点，给一个框打星并翻成英文 → 最近动过的节点第一个是它，带星、「3 个方向」→ 打过星的提示词里复制原文和英文译文，上传清单标题是「画布 › 节点 · 框名」→ 点「画布 › 节点」进画布直接打开这个节点，地址里没有 `#node=` → 回首页点另一个节点的卡片，打开的是那个节点。按名字找画布，找不到时能清空。有一套模型配置没填密钥时顶上提示，点了去设置里的模型配置。工作文件夹被删掉 → 整页提示打不开、新建画布点不了 → 重试，提示「还是打不开：找不到这个路径」→ 文件夹回来后重试，显示「还没有画布」。

### 10.3 第三批

1. 设置里总档位调到中，mock 那套模型配置的思考写法选 reasoning_effort → 发「写一个」→ 正文出来前显示「正在思考」→ 回复上面有折叠的「思考了 N 秒」，点开有「思考：」→ 回复最后一行「思考参数」含 `reasoning_effort` 和 `medium` → 翻译这个框，译文最后一行的「思考参数」是 `low`（翻译默认关，reasoning_effort 关的时候发 `low`）。
2. 新建生图节点 → 面板上是尺寸和张数，没有时长和比例 → 发「写一个」→ 框里的标签是小块，long hair 下面是「长发」；blond hair 显示成 blonde hair，注明原来写的；goldish hair 标不认识，点开候选里有 blonde hair，选它 → 回复显示 `2/2` → 复制拿到的里面没有 goldish hair 和 blond hair。
3. 标签编辑窗：打「金发」，候选第一个是 blonde hair → 选中 → 拖到最前 → 权重调到 1.2 → 存 → 复制拿到的以 `(blonde hair:1.2), ` 开头。再打开，打「坐在窗边看书」→ 让模型转成标签 → 多了 sitting、window、book、reading 四个小块。
4. 选两个小块存成片段「测试角色」→ 另一个生图节点的编辑窗里搜「测试角色」插进来 → 设置的片段库里看得到，删掉后编辑窗里搜不到。
5. 设置里填 mock-comfyui 的地址，测试连接显示版本和显卡 → 底模里 pony-test 自动标成 Pony → 生图节点张数选 2，点「生图」→ 框下面两张先排队、再显示进度、最后出图 → 两个文件在工作文件夹 `image-temp/当天/` 里 → 打开大图，参数里正面以 `masterpiece, best quality, ` 开头，两张的种子差 1；mock 收到的请求里 `CLIPSetLastLayer` 是 −2。
6. 张数 3，框里改成含「慢」的 → 生图 → 第一张在跑时点叫停 → 跑着的和排队的都标「已叫停」；含「报错」的显示失败原因；底模选一个 mock 上没有的文件名 → 提示底模文件不在。
7. 下载一张，选一个不在资产库里的新文件夹 → 问要不要导入 → 导入后资产库里有这张 → 新建视频节点，把它放进槽位。删掉这张的临时文件 → 节点里改显示下载的那份；删掉另一张没下载过的临时文件 → 显示「已清理」，「同样参数再来」照样能出。
8. 给生图框打星 → 首页打过星的提示词里显示它出过的图，点「再出图」→ 回到画布，这个框下面多一组。
9. 导入一个 API 格式的工作流 → 自动认出正面、负面、种子、尺寸 → 选它出图 → mock 收到的 JSON 里这几处换了，其他没动；导入普通格式的文件，提示用「导出（API）」；工作流里有 mock 上没有的节点 → 出图时提示缺哪个。
10. 设置里填 AutoDL 的 Token（mock 的）、选实例 → 出图设置切到 AutoDL → 生图 → 显示「正在开机」→ 出完图 → 手动关机，状态变成已关机。
11. 出图设置里打开放大（2 倍）、加两道部位重绘（脸、手，手这道正面写 `detailed hands`）→ 生图 → 新图宽高是原来的 2 倍 → mock 收到的 JSON 里有 `ImageUpscaleWithModel` 和两个 `FaceDetailer`，检测模型一个脸一个手，手那道的正面以固定开头开头、以 `detailed hands` 结尾 → 大图参数里写着放大和两道部位重绘 → 让 mock 去掉 `FaceDetailer` 再生图 → 提示缺 Impact Pack。
12. 大图里点「放大和重绘」→ 关掉放大、只留脸那道 → 开始 → 框下面多一组，标着从哪张来 → mock 收到传上去的图，JSON 从 `LoadImage` 开始、有一个 `FaceDetailer`。出图设置里存成预设「测试预设」→ 另一个节点套用它 → 放大和部位重绘带过来了，张数没变 → 设置里改名、删除。
13. （P15）槽位放一张图 → 出图设置里加一个 ControlNet，类型选深度，提取方式是 MiDaS，参考图选槽位 1 号 → 生图 → mock 收到传上去的图，和槽位那张一样；JSON 里 `AIO_Preprocessor` 是 `MiDaS-DepthMapPreprocessor`，`ControlNetApplyAdvanced` 的强度是 1，`KSampler` 的正负面接在它后面 → 大图参数里写着 ControlNet 深度 → 再加一个姿势的、不选参考图 → 生图时提示「ControlNet 第 2 个还没选参考图」。
14. （P17）标签编辑窗里「从图反推」选槽位 1 号 → 末尾多了 1girl、solo、smile 三个小块，下面有中文。
15. （P18）在一张出的图上点局部重绘 → 在左上角涂一块，重绘强度改成 0.8 → 开始重绘 → 框下面多一组，参数里记着从哪张来 → mock 收到的 PNG 涂过的地方透明、别处不透明，JSON 里有 `InpaintCropImproved`、`InpaintModelConditioning`、`InpaintStitchImproved`，`KSampler` 的 denoise 是 0.8 → 点「只换种子再来」，不用再涂，mock 又收到同一张 PNG。让 mock 去掉 `InpaintCropImproved` 后再点 → 提示缺 ComfyUI-Inpaint-CropAndStitch。
16. （P13）设置「AutoDL 上的模型」→ 从电脑传一个小文件当 LoRA，子文件夹填 `IL` → 进度走完，列表里有它、大小对 → 出图设置的 LoRA 下拉里搜得到 → 同名再传一次，问要不要换掉 → 给一个链接（指向 mock）当放大模型下 → 列表里有它 → 删掉那个 LoRA，列表和下拉里都没了。
17. （P14）「新建节点」点开选「生图节点」→ 卡片标「生图 · IL」、边框是紫色，系统提示词下拉只有生图用的 → 换成 `pony`，卡片变成「生图 · Pony」→ 再新建一个视频节点 → 卡片标「视频」，下拉只有视频用的 → 从生图节点的框岔出新节点，新节点还是生图节点。
18. （P16）出图设置里部位重绘那道选用 SAM，权重算法选 A1111，VAE 单独选一个，LoRA 只作用在画图的模型上，尺寸自己填 864×1280 → 生图 → mock 收到的 JSON 里有 `SAMLoader`、`BNK_CLIPTextEncodeAdvanced`、`VAELoader`、`LoraLoaderModelOnly`，`EmptyLatentImage` 是 864×1280。
19. （P17）起图选图生图 → `KSampler` 的 denoise 是 0.6；加一个画风 → 有 `IPAdapterAdvanced`。

### 10.4 第四批

1. 设置里选生成视频用的实例：出图那台在列表里灰掉，写着「出图在用」；选 mock 的第二台 → 顶上多出视频那台的状态，写着已关机。
2. 视频节点的系统提示词换成 `t2v`，时长调到 60 → 发「写一个」→ 用户消息下面的说明里有「分 4 段生成」→ 框里是 4 段 → 点「生成视频」→ 先写正在开机，再走编码提示词、一采 第 1/4 段、放大、二采、存文件 → 出完是能播放的视频，写着 1728×960、57.6 秒 → 文件在 `video-temp/当天/` 里 → mock 收到的 JSON 里提示词是 4 段，一采 864×480，两个 `MMH3LoopingSampler` 每段 362 帧、重叠 22 帧。
3. 生成设置里一采大小改成 0.3、种子固定 → 写着「出片 1472×832」→ 生成 → JSON 里是 736×416、种子是那个数 → 「只换种子再来」→ 种子不一样。框改成含「慢」的 → 生成 → 一采时叫停 → 标「已叫停」；含「报错」的写失败原因 → 删掉一条，临时文件也没了。
4. 下载一条 → 文件名是「节点标题-种子.mp4」，标「已下载」。
5. （P20）参考模式写的、槽位两张图 → 框下面写着「带 2 张参考图」→ 生成视频 → mock 收到传上去的两张图，JSON 里两张用 `ImageTensorList` 接成一串进 `MMH3ReferenceMultiPrompt` → 换成一图当首帧、比例自动 → 生成设置写着按这张图算的出片大小 → 一采的 `keyframes` 接着这张图，比例按这张图；首尾帧写的 → 框下面和点生成视频都提示还不支持。
6. （P21）生成设置里挂一个 LoRA，强度 0.8 → JSON 里有 `LoraLoaderModelOnly`；设置「AutoDL 上的模型」切到生成视频那台，传一个 LoRA → 生成设置里搜得到。
7. （P19b）两个画布各点一次生成视频，框里一个含「慢」→ 顶上写「视频任务 2」→ 点开，一条在做、写着一采第几段第几步，一条排第 1，都写着跑了多久；第一次出这个大小写「估不出」→ 叫停排着的那条，它挪到下面「完了的」里、标已叫停 → 点在做的那条，跳到那个画布、那个节点 → 出完以后再生成一条同样大小的，写着预计还要多久。
8. （P19c）生成一条两段的视频 → mock 收到的 JSON 里有两个存档节点 → 出完在时间条上拖选第 8 到 11 秒 → 下面写「重拍 8.0 到 11.0 秒，在第 1 段」→ 改种子、点「重拍这一截」→ mock 收到的 JSON 读回两个存档、只切第 1 窗、遮罩 192 帧黑 72 帧白 98 帧黑 → 出完原视频下面多一个版本「重拍 8.0 到 11.0 秒」，能切换播放、能下载 → 在这一版上再选一截重拍，读回的是这一版的存档 → 删掉原片，各版本和 mock 上的存档都没了；mock 上把存档删掉再点重拍 → 提示只能整条重出。
9. （P21b）生成设置里点「不加速」→ 主模型换成 DaSiWa V2 完整版 → 生成视频，mock 收到的 JSON 里一采 20 步、二采 6 步 → 点回「加速」，主模型换回加速版。
10. （P22）资产库里看得到视频和音频的格子 → 选一段视频、一段音频和一张图一起放进视频节点 → 图进图的槽位，视频、音频进下面一排，写着「视频 1」「音频 1」→ 视频改成「画面和声音」、开始改成 0.5 秒 → 3 秒的视频取 2.3 秒、用 56 帧 → 改到第 2.5 秒，只能用 1.6 秒，红字说不到 2 秒 → 改回第 3 秒 → 格子写「视频 1 · 声音是音频 1」，原来的音频变成音频 2，下面写「视频 1 管成片前 2.3 秒。」→ 发「写一个」→ 用户消息上面的说明里有 <Video 1>、<Audio 1>、<Audio 2>，下面有视频 1 的截帧 → 不改再发一条，说明里不再说视频和音频。
11. （P22）参考模式写的回复，带一段画面和声音的视频、一段声音参考、一段配音 → 框下面写「带 1 段参考视频、2 段参考音频、配音」→ 生成视频 → mock 收到三个传上来的文件，JSON 里有 `VHS_LoadVideo` 接 `ref_videos.ref_video_0`、它的声音接 `ref_video_audios.ref_video_audio_0`，`TrimAudioDuration` 接 `ref_audios.ref_audio_0`，配音接 `audio`、`use_input_audio` 是真 → 音频槽位再加两段，凑成 4 段参考音频 → 点生成视频，提示音频超了、删掉一段。

## 11. 手动验收（用户用真模型做）

### 11.1 第一批

1. 用自己的模型配置，3 张真实参考图，写一条 8 秒 16:9 的需求，回复里六个部分齐全、`<Picture N>` 只引用了 1–3、切镜时间都在 8 秒内。
2. 追问改一个细节，回复只改了那处；确认这次请求没有重新发图（看 usage 或服务端日志里的 content 段数）。
3. 换掉 2 号图再追问，回复里对 2 号的描述换成新图内容。
4. fork 后换整套图，发「按新图改写这版」，得到结构一样、内容对应新图的提示词。
5. 复制提示词贴到第三方平台网页，按上传清单顺序传图，能生成视频。
6. 在另一台机器上把工作文件夹设成同步盘同一目录，打开画布，节点里的图都在。
7. 一张 35 MB 的照片放进槽位，画布副本小于 30 MB，上传清单指向副本。
8. 改系统提示词后再发消息，回复按新版；之前的回复点开看到的是旧版。

### 11.2 第二批

1. 输入框里用 @ 引用槽位里的图和资产库里的图，发出后 agent 正确对应。
2. 拼一张 3×3 宫格放进 1 号槽位，提示词里用「左上」「第二排中间」这类说法，看 H3 生成结果是否按格子理解（这是要验证的风险点，结果记到 `docs/reports/`）。
3. 各种操作后 Ctrl+Z 能回退，Ctrl+Shift+Z 能重做。

### 11.3 第三批

1. 用自己常用的几家模型配置打开思考，关低中高都试一遍；DeepSeek 或通义能看到思考原文；花费里算上了思考。
2. 用中文聊出 IL 和 Pony 的标签提示词，大部分标签认识；在标签编辑窗里改几处、插一个片段。
3. 局域网 ComfyUI：内置流程 IL、Pony 各出一组，Pony 不糊；下载几张进资产库，放进视频节点的槽位写视频提示词。
4. 导入一个自己的工作流出一组。AutoDL：实例关着时点生图，自动开机出图；空闲到点自动关机，到 AutoDL 控制台确认关了；开着时退出程序，实例被关掉。
5. 放大、部位重绘（脸、手、全身）、出完的图上补做、预设、ControlNet（姿势、深度）、画风、图生图、局部重绘、反推各跑一次，结果对得上。
6. 另一台机器打开同一个工作文件夹：生图节点、出过的图、片段库、词库、导入的工作流都在。
7. 往 AutoDL 那台从电脑传一个 LoRA，给 hf-mirror 的链接下一个 `hand_yolov8s.pt`，出图设置里都能选，用手那道部位重绘出一张；删掉一个。

### 11.4 第四批

1. 设置里选「A」做生成视频用的实例。视频节点用 `t2v`、时长 60，让模型写一条 1 分钟的，点生成视频：自动开机，大约半小时出完，能播放；接缝处画面和声音接得上；空闲到点自动关机。
2. （P20）参考模式带两张人物图写一条 30 秒的，生成后人物前后一致；一图当首帧的从那张图开始。
3. （P19c）用「A」出一条两段 30 秒的，在时间条上挑一截不满意的重拍：大约 6 分钟出完；重拍的那截前后接得上，别的地方和原片一样；在重拍出来的这一版上再重拍一截也行。
4. （P22）带一段自己的视频当动作参考、一段人声当声音参考写一条，出来的动作和嗓音跟参考像；拿一段 30 秒的对白当配音出一条两段的，嘴型前后都对得上。

## 12. 给实现 agent 的约定

- 只做本计划写的；觉得该加的先问用户，不要自作主张加守卫、警告、功能。
- 界面文字全中文，代码标识符英文，注释少而准。
- 每阶段结束写报告，等用户确认再继续；不要自动 git 提交。
- 测试用 mock-llm 和 mock-comfyui，不要在测试里调真模型、连真的 ComfyUI 和 AutoDL（AutoDL 开机就扣钱）；真的只在手动验收时用。
- 拿不准的产品行为，先查 `docs/requirements-interview.md`，还是拿不准就问，不要猜。
- 服务只监听 127.0.0.1；所有文件路径参数必须校验在允许的目录内。

## 13. 预留和以后

- 接第三方接口生成视频：第四批先接了 AutoDL 上的 H3（5.24 到 5.28），`Message.videos` 用上了；以后接别家的照这个做。
- 视频和音频参考：以后在节点上加 `videoSlots`（3 个）和 `audioSlots`（3 个），编号各自独立，不影响图片编号。
- 复制时按平台写法转换 `<Picture N>`：以后在 `shared/src/exportFormat.ts` 加转换函数，复制按钮按设置里选的平台调用。
- 按画面内容搜图、节点提示词对比、节点搜索、清晰度设置：不做预留。
