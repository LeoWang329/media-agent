# 提示词画布 开发计划

写给负责实现的 agent。需求访谈记录在 `docs/requirements-interview.md`（生图那部分在 `docs/requirements-interview-image.md`），那两份讲的是「为什么这么定」；这份讲「具体怎么做」。它们不该冲突，发现冲突先停下来问用户。

## 1. 一句话说明

一个本机运行的网页：左边是资产库（导入本机文件夹里的图片），中间是画布（每个节点是一段和 agent 的对话，可以从任意一条消息 fork 出新节点），右边是当前节点的对话面板（上面有 9 个图片槽位、视频时长和画面比例）。agent 按 MiniMax H3 官方写法写视频提示词，图片在提示词里用 `<Picture 1>` 到 `<Picture 9>` 引用。第一版只出提示词，不生成视频。

第三批加两样：一是全局控制模型要不要思考、思考多深；二是生图：在生图节点里让模型写 Danbooru 标签提示词（底模是 IL 或 Pony 系列），能用中文搜标签、手动改，再接 ComfyUI 出图（局域网里的那台，或 AutoDL Art 上租的实例）。视频还是只出提示词。

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
    ref2va.md / i2v.md / t2v.md # 自带的三套系统提示词，第一次设置工作文件夹时从 docs/prompts/ 复制（已有同名的不覆盖）
    il.md / pony.md           # 自带的两套生图系统提示词（第三批），已经设好的工作文件夹在服务启动时补上
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
// ChatNode 加：image?: ImageSettings（生图节点才有，见 5.14）
// 本机 config.json 加：autodlToken: string | null；comfyTarget: 'lan' | 'autodl'；lastDownloadFolder: string | null；comfyClientId: string（连 ComfyUI 用的固定身份，见 5.19）

type Family = 'IL' | 'Pony';

type FamilyDefaults = {                 // 一个系列的默认值，见 5.18
  prefix: string;                       // 固定开头，比如 masterpiece, best quality
  negative: string;                     // 默认负面词
  rating: { general: string; sensitive: string; explicit: string };  // 三档评级在这个系列里怎么写
  steps: number; cfg: number; sampler: string; scheduler: string; clipSkip: number;
  upscaleModel: string | null; poseModel: string | null; styleModel: string | null; clipVision: string | null;  // 见 5.21
};

type SharedSettings = {                 // 工作文件夹 settings.json
  thinking: { level: ThinkingLevel; chat: ThinkingLevel | 'follow'; translate: ThinkingLevel | 'follow'; tagging: ThinkingLevel | 'follow' };
  comfy: { lanUrl: string | null; autodl: { instanceUuid: string | null; idleMinutes: number } };  // 没选实例是 null
  checkpoints: Record<string, Family | null>;  // 底模文件名 → 系列，null 是两个都不是
  defaults: Record<Family, FamilyDefaults>;
  taggerModel: string | null;           // 反推用的模型
};

type ImageSettings = {
  width: number; height: number;        // 九档之一，见 5.14
  count: number;                        // 一次出几张，1–8，默认 4
  workflowId: string | null;            // null 是内置流程，否则是导入的工作流
  checkpoint: string;                   // 空着：出图时用这台 ComfyUI 上这个系列的第一个，记进这一组的参数
  loras: { name: string; strength: number }[];
  steps: number; cfg: number; sampler: string; scheduler: string;
  seed: number | null;                  // null 是每次随机
  rating: 'none' | 'general' | 'sensitive' | 'explicit';
  negativeExtra: string;                // 接在系列默认负面词后面
};

type ImageJob = {                       // 点一次「生图」（或放大、修脸、局部重绘）出的一组
  id: string; promptIndex: number; createdAt: string;
  rev?: number;                         // 每改一次加一：推送和请求的回复谁先到不一定，前端拿它丢掉旧的
  kind: 'txt2img' | 'img2img' | 'pose' | 'style' | 'upscale' | 'facefix' | 'inpaint';
  source?: { kind: 'generated'; jobId: string; seed: number } | { kind: 'slot'; imageId: string };  // 从哪张图来：那一组的 id 和那张的种子（删掉一张后后面的往前补位，所以不记第几张）
  target: 'lan' | 'autodl';
  params: {                             // 发出去的全部参数，「同样参数再来」照这个发
    family: Family;
    positive: string; negative: string; // 最终发给 ComfyUI 的，含固定开头和默认负面词
    workflow: { id: string | null; name: string; hash: string };
    width: number; height: number;
    checkpoint?: string; loras?: { name: string; strength: number }[];       // 导入的工作流没有这几项
    steps?: number; cfg?: number; sampler?: string; scheduler?: string; clipSkip?: number;
    denoise?: number; strength?: number; scale?: number; model?: string;     // 放大、修脸、局部重绘、参考图用的
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

- 节点选的系统提示词决定它是生图节点还是视频节点。系统提示词文件开头可以有一段用 `---` 上下围起来的说明，有这段、写着「用途: 生图」的是生图提示词，「底模」是 IL 或 Pony：

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
  - 面板上时长和比例的位置换成尺寸和张数。尺寸九档：1024×1024；竖的 896×1152、832×1216、768×1344、640×1536；横的是这四个宽高对调，默认 832×1216。张数 1 到 8，默认 4。
  - 出图设置存在 `node.image`。节点第一次变成生图节点时，按它的系列取默认值；底模下拉只列标成这个系列的底模（5.17）。LoRA 可以挂几个，各带强度；选 LoRA 时能按名字搜，空格隔开的几个词都对得上才列出来，不分大小写。
  - 输入框旁边有「写标签」：打开一个空的标签编辑窗（5.15），打中文英文都有联想，也能整串粘贴。「存成框」不问模型，存成一个框，回复那一栏写「自己写的」，角落写「自己写的，没有调用 AI」；这个框和模型写的一样能生图、编辑、打星、岔出。
  - 写标签的窗里还有「让 AI 优化」，旁边能写一句要求：先把写的存成框，再在它后面像平时一样发一条消息给模型，内容是「优化上面这个框里我自己写的标签：」加要求，没写要求就用「保持原意，改成标准写法，补上缺的，去掉重复和冲突的」。模型带着系统提示词和前面的对话回一个新框，自己写的那个留着。
  - 发给模型的对话里，自己写的框当成用户说的话：「我自己写了一个框：」加框的原文。
  - 槽位照旧：图照样发给模型看，也是参考图生图的来源（5.21）。5.4 的说明不写时长比例。
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
- 选项从 `GET /object_info` 读：底模（`CheckpointLoaderSimple` 的 `ckpt_name`）、LoRA（`LoraLoader` 的 `lora_name`）、采样器和调度器（`KSampler`）、放大模型（`UpscaleModelLoader`）、ControlNet 模型（`ControlNetLoader`）、IP-Adapter 模型（`IPAdapterModelLoader`，装了插件才有）、CLIP Vision 模型（`CLIPVisionLoader`）、反推模型（`WD14Tagger|pysssss` 的 `model`）。打开出图设置时读；同一台缓存起来，点「刷新」或换了地址才重读。
- 底模属于哪个系列：设置里列出读到的底模，每个选 IL、Pony 或都不是，存 `settings.json` 的 `checkpoints`（都不是存 null）。没标过的按文件名猜，不分大小写：名字里有 pony 的当 Pony；有 illustrious、noob、wai，或者单独一个 IL（比如 IL-xxx、xxx_IL）的当 IL；别的两个都不是。节点的底模下拉只列这个系列的，都不是的哪里都不列。
- AutoDL：
  - 开发者 Token 只存本机 `config.json`，和模型密钥一样不进工作文件夹；实例 uuid 和空闲多久关机（默认 15 分钟）存 `settings.json`。
  - 填了 Token 后列出账号下的实例（`POST https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/list`，请求头 `Authorization: <Token>`），选一个。显卡和每小时的价格从各自的快照里取，价格的单位是千分之一元。
  - 状态用 `GET …/pro/status`：`running` 是开着，`shutdown` 是关了。运行中时从 `GET …/pro/snapshot` 取 6006 端口的访问地址（`service_6006_domain`，只有域名和端口，前面加 `https://`），当 ComfyUI 地址用。
  - AutoDL 出错时 HTTP 也是 200，看返回的 `code`：Token 不对是 `AuthorizeFailed`，实例不存在是 `RecordNotFoundError`，`msg` 是原话。余额不够的 `code` 文档没写，按原话里有没有「余额」认。
  - 出图时实例关着：先开机（`POST …/pro/power_on`，`{instance_uuid, payload: "gpu"}`），每 5 秒查一次状态；变成运行中以后，再等到 ComfyUI 的 `/system_stats` 能通，然后发任务。超过 5 分钟没好算失败。界面上显示「正在开机，等了 N 秒」。
  - 设置里和出图设置里都能手动开机、关机（`POST …/pro/power_off`）。正在开机时点「别开了」：等着开机的图算叫停，已经发出的开机请求等它开好后马上关掉。
  - 自动关机：实例开着，程序这边最后一个任务结束后空闲到设定的分钟数，就关机。实例不是程序开的、程序这边也没出过图的，从程序看到它开着时算起。到点时先看一眼 ComfyUI 的队列（`GET /queue`）：里面有任务（比如在 ComfyUI 网页上直接出的图）就不关，过一分钟再看；队列空了，从最后一次看到有任务时起再空闲到设定的分钟数才关。看不了队列（ComfyUI 连不上）照常关。服务退出时（Ctrl+C、关掉窗口），这次开机是程序开的、又没见它关掉，先发关机请求再退出。程序没开着时管不了，所以界面上要一直看得到实例开着。
  - 访问地址要不要另外鉴权、ComfyUI 是不是开机就自己起来、跑在哪个端口，文档没写。P11 开工前先用用户的真实例核对，结果写进 P11 的报告。
  - 出错要说清是哪种，带上 AutoDL 返回的原话：Token 不对、实例不存在、余额不够开不了机、开机超时。

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
  - 选了导入的工作流，出图设置里底模、LoRA、步数这些不显示，照工作流里的。放大、修脸、局部重绘、参考图只用内置流程。
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

### 5.21 放大、修脸、局部重绘、参考图、反推（第三批）

- 都是再发一个任务，结果和普通出图一样挂在框下，`kind` 记是哪种，`source` 记从哪张图来。只用内置流程。
- 放大：在一张出的图上点。只要自带节点和一个放大模型：`LoadImage`（先用 `/upload/image` 把图传上去）→ `UpscaleModelLoader` + `ImageUpscaleWithModel` → `ImageScale` 缩到原图的 1.5 倍或 2 倍 → `VAEEncode` → `KSampler`（同样的提示词和种子，`denoise` 默认 0.35）→ `VAEDecode` → `PreviewImage`。倍数和 denoise 发之前能改。
- 修脸：在一张出的图上点。要装 Impact Pack 和 Impact Subpack 两个插件，加一个人脸检测模型（比如 `face_yolov8m.pt`）：`LoadImage` → `UltralyticsDetectorProvider` + `FaceDetailer`（底模、提示词、种子同原图，`denoise` 默认 0.4）→ `PreviewImage`。
- 局部重绘：在一张出的图上点，大图窗口进涂抹模式。用画笔涂要重画的地方，笔刷能调大小，能擦、能清空；再填这块要画成什么（默认是原图框里的标签，正面、负面照普通出图加固定开头和负面词）和重绘强度（`denoise` 默认 1；调到 0.5 到 0.8 保留原来的轮廓、只改细节）。
  - 发的时候程序把原图涂过的地方改成透明（只改透明度，颜色照留），存成 PNG 放进临时文件夹，用 `/upload/image` 传上去，`LoadImage` 把透明的地方当遮罩。
  - 流程照 AutoDL 实例上修好的 E05：`LoadImage` → `InpaintCropImproved`（只裁出遮罩附近一块：周边多带 1.5 倍，遮罩外扩 8 像素，缩放到 1024×1024）→ `InpaintModelConditioning`（普通底模也能用）→ `KSampler`（底模、LoRA、步数这些同原图，原图是导入的工作流出的就用节点现在的出图设置；种子随机）→ `VAEDecode` → `InpaintStitchImproved`（缩回去拼回原图，边缘羽化 32 像素，遮罩附近以外保持原图像素）→ `PreviewImage`。
  - 要装 ComfyUI-Inpaint-CropAndStitch 插件。节点名和参数名，开工前对照 E05 的 JSON 核对。
  - 「同样参数再来」「只换种子再来」重新上传存下的那张 PNG，不用再涂。
- 参考图生图：点「生图」时选方式和参考图，参考图从节点的槽位里选一张：
  - 图生图：`LoadImage` → `VAEEncode` → `KSampler`（`denoise` 默认 0.6）。只用自带节点。
  - 姿势参考：要 comfyui_controlnet_aux 插件（用 `DWPreprocessor` 提取姿势）和 openpose 的 ControlNet 模型，接 `ControlNetLoader` + `ControlNetApplyAdvanced`（强度默认 0.8）。IL 用 Illustrious-XL ControlNet Openpose；NoobAI 一路的底模用 NoobAI-XL ControlNet-OPENPOSE；Pony 没有专门的，用通用 SDXL 的 openpose，比如 xinsir 出的，效果差一些。
  - 画风参考：要 ComfyUI_IPAdapter_plus 插件、IP-Adapter 模型和配套的 CLIP Vision 模型，接 `IPAdapterModelLoader` + `CLIPVisionLoader` + `IPAdapterAdvanced`（`weight_type` 用 style transfer，强度默认 0.8）。IL 和 NoobAI 一路用 NoobAI 的 IP-Adapter；Pony 用通用 SDXL 的 `ip-adapter-plus_sdxl_vit-h`。
- 程序不写死模型文件名：设置里按系列选默认用哪个放大模型、ControlNet、IP-Adapter、CLIP Vision，从 `/object_info` 读到的列表里选；上面推荐的写进设置页的说明。
- 反推：在标签编辑窗里「从图反推」（5.15）。要装 ComfyUI-WD14-Tagger 插件：`LoadImage` → `WD14Tagger|pysssss`（`threshold` 0.35，`character_threshold` 0.85，模型用设置里选的），从 `/history` 的输出里拿标签串，按 5.15 拆开、校验。
- 缺插件或缺模型：发任务前对照 `/object_info`，直接说「这台 ComfyUI 上没有某某节点，要装某某插件」，不发。

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

- 节点卡片（约 260px 宽）：标题（双击改）、9 格小缩略图（空格显示为虚线框）、概述（当前路径最新一条 assistant 的第一个框；有多个框时右上角显示「3 个方向」）、右上角星标、折叠时下方显示「▸ 已收起 N 个」。
- 点卡片选中并在右侧打开；连线从父指向子。
- 卡片右键菜单：fork 到新节点（等于从最后一条消息 fork）、折叠/展开、删除（弹确认，写明会一起删多少个子节点）、重命名。
- 工具栏：「新建节点」（空节点放在画布空白处）、「自动排整齐」（dagre 从左到右，和 fork 新节点放在原节点右侧一致）、缩放归位。
- 拖动节点后保存位置。

右侧面板从上到下：

1. 头部：标题、模型配置下拉、系统提示词下拉、对话目录按钮。对话目录浮在面板左边（画布工具条下面），当前路径上每发一次需求算一轮，列出需求前两行、时间和回复写了什么（几个方向、第一个框的标签或概述、没有提示词、失败、叫停），点一下滚到那一轮并闪一下；开没开记在浏览器里。
2. 消息列表。用户消息靠右：上方灰字 `systemNote`，气泡内文字，下方带编号的小缩略图。assistant 消息靠左：框外文字按 Markdown 渲染；每个提示词框是一个组件，标签在框顶，内容用等宽以外的可读字体、保留换行；框底一排按钮：复制、翻译（见 5.11）、星标、编辑、上传清单、沿此方向 fork。消息悬停出操作：用户消息「编辑」「从这里 fork」；assistant 消息「重新生成」「从这里 fork」；有兄弟版本时显示 `‹ 1/2 ›`。失败的消息显示错误和「重试」。
3. 槽位区：一行 9 格，填了的显示缩略图和编号，悬停显示删除；支持 5.1 里的拖拽。右边是时长（4–15 下拉）和比例下拉。点有图的格子出菜单，第一项「放大看」：弹窗显示画布里存的那张图，先整张放进窗口，点图切换原始大小，点图外面的空白或 Esc 关掉。
4. 输入框：Enter 发送，Shift+Enter 换行；发送中显示「停止」。第二批换成 Tiptap 编辑器，输入 @ 弹出选图窗口，选中的图在框里显示成带缩略图的小标签。
5. 生图节点（第三批，规则见 5.12 到 5.21）：槽位区右边是尺寸、张数和出图设置；提示词框里的标签显示成带中文的小块，框下面挂着出的图，每次生图一组，排队、进度、失败、叫停都显示在这里；点一张看大图和全部参数，能下载、打星、删除、在资源管理器里显示、同样参数再来、只换种子再来、放大、修脸、局部重绘（在大图上涂要重画的地方）。回复上面是思考（5.12）。画布上一直看得到现在用哪台 ComfyUI 和它的状态，用 AutoDL 时还有开机中、运行中、多久后自动关机。

### 6.3 资产库（左栏）

- 顶部：搜索框（按文件名，不区分大小写，子串匹配，搜全部导入过的文件夹，结果最多 200 条）、「导入文件夹」（弹系统窗口；非 Windows 或弹窗失败时显示路径输入框）、「拼图」（第二批）。
- 文件夹树：每个导入的根文件夹一棵，可展开子文件夹；右键「移除」（只从库里移除，不动文件）。
- 图片网格：当前文件夹下的图片，按文件名排序，缩略图懒加载，超过 200 张用虚拟滚动。单击选中，Ctrl/Shift 多选，双击放进下一个空槽位，拖拽到槽位区。
- 打开某个文件夹时重新扫描一次（超过 5 秒没扫过才扫），另有「刷新」按钮。
- 只列 jpg、jpeg、png、webp；heic、heif 灰显「不支持」。

### 6.4 设置页 `/settings`

- 工作文件夹：路径 + 「选择」（系统窗口）。第一次设置时初始化目录结构并复制默认提示词。
- 模型配置列表：名字、接口地址、key（显示时打码）、模型名、发图长边、价格（币种 ¥ 或 $，输入、输出、缓存命中三个价，按每百万 tokens 填，留空当 0）；「测试连接」调一次 `/v1/models` 或发一条极短消息。
- 填了价格后，每条回复角落显示这次花了多少钱：命中缓存的输入按缓存价、其余输入按输入价、输出按输出价。命中的 token 数从接口的 `usage.prompt_tokens_details.cached_tokens`（DeepSeek 是 `prompt_cache_hit_tokens`）取，接口不报就当没命中。
- 系统提示词：列出 `prompts/*.md`，右侧文本编辑器，保存、新建、删除、「用外部编辑器打开」（服务端 `start <文件>`）。自带三套：`ref2va`（参考模式，六个部分，新建节点默认用它）、`i2v`（一张图当首帧，开头带对齐指令行加三个部分）、`t2v`（纯文字，三个部分），列表里按这个顺序排在前面。
- 程序固定附加的格式要求：只读显示。
- 资产库文件夹列表（和左栏同一份数据）。
- 第三批加的：
  - 模型配置加「思考写法」和「开思考用的模型名」；思考一节：总档位和三个用途（5.12）。
  - 系统提示词列表标出生图用的和系列；自带的 `il`、`pony` 排在视频的三套后面；生图的固定格式要求也能看（5.14）。
  - ComfyUI：局域网地址和测试连接；AutoDL 的 Token、实例、开机关机、空闲多久自动关机（5.17）。
  - 底模和默认值：读到的底模各属哪个系列，两个系列各自的默认值和默认模型，反推用哪个模型（5.17、5.18、5.21）。
  - 工作流：导入、改名、重新指定往哪填、删除（5.18）。
  - 词库：哪天的、多少个标签、多少个有中文、多少条别名，「更新词库」、进度和停止（5.13）。
  - 片段库（5.16）。
  - 出的图：临时文件夹的路径，能在资源管理器里打开（5.20）。

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
节点       POST     /canvases/:id/nodes              新建空节点 {x,y}
           GET      /canvases/:id/nodes/:nid         完整节点
           PATCH    /canvases/:id/nodes/:nid         {title, modelConfigId, systemPromptName, slots, duration, aspectRatio, draft, activeChildOf}
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
           GET      /assets/list?folder=             图片列表 [{path,name,size,mtime,supported}]
           GET      /assets/search?q=                跨全部根文件夹
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
ComfyUI    GET      /comfy/status?target=lan|autodl  局域网那台连不连得上、版本、显卡；target=autodl 回 AutoDL 实例的状态、多久后自动关机
           GET      /comfy/options?target=&refresh=1 底模、LoRA、采样器、各种模型、有哪些节点类型；不带 target 用这台电脑出图用的那台。AutoDL 关着时给读过的
           GET      /comfy/autodl/instances          用本机 Token 列实例
           POST     /comfy/autodl/power              {on} 开机或关机
工作流     GET      /workflows
           POST     /workflows                       {name, file, graph, fill} → 存好的工作流。往哪填在导入窗口里就认好、挑好了，点「导入」才发
           PATCH    /workflows/:id                   {name, fill}
           DELETE   /workflows/:id
出图       POST     /canvases/:id/nodes/:nid/messages/:mid/images   {promptIndex, kind, source?, reference?, again?} → ImageJob
                    reference 是参考图 {imageId, strength}；again 是「同样参数再来」「只换种子再来」{jobId, index, sameSeed}
                    inpaint 是局部重绘 {mask, tags, denoise}，mask 是和原图一样大的黑白 PNG（白的是要重画的地方），base64
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
```

出图事件（`/image-jobs/events`，第三批）：`{type:'job', canvasId, nodeId, messageId, job}`（任务或其中一张的状态变了，发整个任务）、`{type:'progress', jobId, index, step, total}`、`{type:'queue', jobId, index, position}`、`{type:'autodl', state, since, idleLeftMs, …}`（AutoDL 实例的整个状态，新连上的页面先收到一次）。

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

做：5.13 词库（复制、读取、搜索、校验、更新）；5.14 生图节点（系统提示词开头的说明段；自带的 `il`、`pony` 和生图的固定格式要求，写好先给用户看；面板换成尺寸和张数；框上的按钮）；5.15 标签显示、拼提示词、标签编辑窗、让模型转标签（`to-tags.md` 也写好给用户看；从图反推留到 P12）；5.16 片段库；设置里的词库、片段库两节。这一步还不能出图，标签复制出去能在别处用。

完成标准：10.3 第 2、3、4 条。

### P10 出图：局域网 ComfyUI 和内置流程

做：5.17 局域网那台（地址、测试连接、读选项、底模属于哪个系列）；5.18 内置流程和两个系列的默认值；节点的出图设置；5.19 出图任务；5.20 临时文件夹和下载；图挂在框下、大图和参数、再来；卡片和首页显示出的图，首页再出图；`tools/mock-comfyui`（9.5）。

完成标准：10.3 第 5 到 8 条；用户用自己局域网的 ComfyUI 做 11.3 第 3 条。

### P11 导入工作流和 AutoDL

开工前：用用户的 AutoDL 实例核对 5.17 里文档没写的三件事。

做：5.18 导入的工作流和缺节点检查；5.17 AutoDL 全部（Token、选实例、开机关机、自动关机、退出时关机）；mock-comfyui 加上 AutoDL 的几个接口。

完成标准：10.3 第 9、10 条；用户做 11.3 第 4 条。

### P12 放大、修脸、局部重绘、参考图、反推

开工前：用户在局域网那台和 AutoDL 实例上装好 5.21 要的插件和模型（程序的缺节点提示能帮着查漏）。涂遮罩的界面原型里还没有，等设计补上再开工。

做：5.21 全部；设置里按系列选默认模型、反推模型。

完成标准：10.3 第 11 到 14 条；用户做 11.3 第 5 条。

## 9. 测试

### 9.1 mock-llm

`tools/mock-llm`，Express 监听 3799，实现 `POST /v1/chat/completions`（支持 stream 真假）和 `GET /v1/models`。回复内容按规则生成，测试靠它断言：

- 统计最后一条 user 消息里的图片数和它们前面的 `<Picture N>` 标签，回复里写「收到 N 张图：<Picture 1>、<Picture 2>」；没有图写「收到 0 张图」。
- 把最后一条 user 消息的第一个文本段（也就是 systemNote）原样写进「说明：…」。
- 写「历史消息 M 条」，M 是请求里除 system 外的消息数。
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
  - 内置流程拼出的 JSON：IL 和 Pony 的 clip skip、LoRA 串联、放大、修脸、三种参考图。
  - 导入工作流自动找填值位置：一个 KSampler、KSamplerAdvanced、两个候选、普通格式文件。
  - 种子依次加 1；临时文件名和下载文件名。

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
  - 缺节点时不发任务。

### 9.4 端到端（Playwright，对 mock-llm）

用例见第 10 节。测试前用脚本生成 `tests/fixtures/images/`：五张 800×600 的纯色带文字 JPEG、一张 6000×4000、一张 200×150、一个 `.heic` 空文件。第三批的用例还要起 mock-comfyui。

### 9.5 mock-comfyui（第三批）

`tools/mock-comfyui`，Express 加 WebSocket，监听 3798，接口的样子照真的 ComfyUI：

- `/system_stats`、`/object_info`：两个底模 `il-test.safetensors`、`pony-test.safetensors`，三个 LoRA（两个放在子文件夹 `IL/` 里，测按名字搜），常用的采样器和调度器，放大模型、ControlNet、IP-Adapter、CLIP Vision、反推模型各一个。插件节点（`FaceDetailer`、`UltralyticsDetectorProvider`、`WD14Tagger|pysssss`、`DWPreprocessor`、`IPAdapterAdvanced`、`InpaintCropImproved`、`InpaintStitchImproved`）默认都有，测试能通过接口去掉某几个，测缺节点。
- `/prompt`：检查底模文件名和节点类型，不对就返回 `node_errors`；收下后排队，一个一个跑，每个 5 步、共 1.5 秒，WebSocket 按真的格式发 `executing`、`progress`、`execution_success`。
- 正面提示词含「慢」→ 每个跑 6 秒，测叫停；含「报错」→ `execution_error`；含「显存」→ 错误里写 `CUDA out of memory`。
- `/history`、`/view`：图是按尺寸现画的 PNG，上面写着种子和正面提示词的前 40 个字；`/upload/image` 收图；`/queue` 能删；`/interrupt` 停当前的。
- `WD14Tagger|pysssss` 的输出固定是 `1girl, solo, smile`。
- AutoDL 的几个接口（list、status、snapshot、power_on、power_off）：一个实例，开机 2 秒后变运行中，6006 的访问地址指回 mock 自己。
- 收到的每个 `/prompt` 请求体和 `/upload/image` 的文件都记下来，测试用 `GET /_last-prompts`、`GET /_uploads` 取，断言程序拼的 JSON 和传上去的图。

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
2. 新建节点，系统提示词选 `il` → 面板上是尺寸和张数，没有时长和比例 → 发「写一个」→ 框里的标签是小块，long hair 下面是「长发」；blond hair 显示成 blonde hair，注明原来写的；goldish hair 标不认识，点开候选里有 blonde hair，选它 → 回复显示 `2/2` → 复制拿到的里面没有 goldish hair 和 blond hair。
3. 标签编辑窗：打「金发」，候选第一个是 blonde hair → 选中 → 拖到最前 → 权重调到 1.2 → 存 → 复制拿到的以 `(blonde hair:1.2), ` 开头。再打开，打「坐在窗边看书」→ 让模型转成标签 → 多了 sitting、window、book、reading 四个小块。
4. 选两个小块存成片段「测试角色」→ 另一个生图节点的编辑窗里搜「测试角色」插进来 → 设置的片段库里看得到，删掉后编辑窗里搜不到。
5. 设置里填 mock-comfyui 的地址，测试连接显示版本和显卡 → 底模里 pony-test 自动标成 Pony → 生图节点张数选 2，点「生图」→ 框下面两张先排队、再显示进度、最后出图 → 两个文件在工作文件夹 `image-temp/当天/` 里 → 打开大图，参数里正面以 `masterpiece, best quality, ` 开头，两张的种子差 1；mock 收到的请求里 `CLIPSetLastLayer` 是 −2。
6. 张数 3，框里改成含「慢」的 → 生图 → 第一张在跑时点叫停 → 跑着的和排队的都标「已叫停」；含「报错」的显示失败原因；底模选一个 mock 上没有的文件名 → 提示底模文件不在。
7. 下载一张，选一个不在资产库里的新文件夹 → 问要不要导入 → 导入后资产库里有这张 → 新建视频节点，把它放进槽位。删掉这张的临时文件 → 节点里改显示下载的那份；删掉另一张没下载过的临时文件 → 显示「已清理」，「同样参数再来」照样能出。
8. 给生图框打星 → 首页打过星的提示词里显示它出过的图，点「再出图」→ 回到画布，这个框下面多一组。
9. 导入一个 API 格式的工作流 → 自动认出正面、负面、种子、尺寸 → 选它出图 → mock 收到的 JSON 里这几处换了，其他没动；导入普通格式的文件，提示用「导出（API）」；工作流里有 mock 上没有的节点 → 出图时提示缺哪个。
10. 设置里填 AutoDL 的 Token（mock 的）、选实例 → 出图设置切到 AutoDL → 生图 → 显示「正在开机」→ 出完图 → 手动关机，状态变成已关机。
11. 在一张出的图上放大 2 倍 → 新图宽高是原来的 2 倍，参数里记着从哪张来；让 mock 去掉 `FaceDetailer` 后点修脸 → 提示缺 Impact Pack。
12. 槽位放一张图，生图时选姿势参考和这张图 → mock 收到的 JSON 里有上传的图、`DWPreprocessor` 和 `ControlNetApplyAdvanced`；选图生图 → `KSampler` 的 denoise 是 0.6。
13. 标签编辑窗里「从图反推」选槽位 1 号 → 末尾多了 1girl、solo、smile 三个小块，下面有中文。
14. 在一张出的图上点局部重绘 → 在左上角涂一块，重绘强度改成 0.8 → 开始重绘 → 框下面多一组，参数里记着从哪张来 → mock 收到的 PNG 涂过的地方透明、别处不透明，JSON 里有 `InpaintCropImproved`、`InpaintModelConditioning`、`InpaintStitchImproved`，`KSampler` 的 denoise 是 0.8 → 点「只换种子再来」，不用再涂，mock 又收到同一张 PNG。让 mock 去掉 `InpaintCropImproved` 后再点 → 提示缺 ComfyUI-Inpaint-CropAndStitch。

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
5. 放大、修脸、局部重绘、三种参考图、反推各跑一次，结果对得上。
6. 另一台机器打开同一个工作文件夹：生图节点、出过的图、片段库、词库、导入的工作流都在。

## 12. 给实现 agent 的约定

- 只做本计划写的；觉得该加的先问用户，不要自作主张加守卫、警告、功能。
- 界面文字全中文，代码标识符英文，注释少而准。
- 每阶段结束写报告，等用户确认再继续；不要自动 git 提交。
- 测试用 mock-llm 和 mock-comfyui，不要在测试里调真模型、连真的 ComfyUI 和 AutoDL（AutoDL 开机就扣钱）；真的只在手动验收时用。
- 拿不准的产品行为，先查 `docs/requirements-interview.md`，还是拿不准就问，不要猜。
- 服务只监听 127.0.0.1；所有文件路径参数必须校验在允许的目录内。

## 13. 预留和以后

- 接第三方接口生成视频：`Message.videos` 已留字段；每个提示词框以后加「生成」按钮，结果挂在框下；发起生成时用这条消息的 `slotSnapshot` 按编号上传画布副本。做法可以照生图的出图任务（5.19）。
- 视频和音频参考：以后在节点上加 `videoSlots`（3 个）和 `audioSlots`（3 个），编号各自独立，不影响图片编号。
- 复制时按平台写法转换 `<Picture N>`：以后在 `shared/src/exportFormat.ts` 加转换函数，复制按钮按设置里选的平台调用。
- 按画面内容搜图、节点提示词对比、节点搜索、清晰度设置：不做预留。
