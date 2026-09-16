# 提示词画布 开发计划

写给负责实现的 agent。需求访谈记录在 `docs/requirements-interview.md`，那份讲的是「为什么这么定」；这份讲「具体怎么做」。两份不该冲突，发现冲突先停下来问用户。

## 1. 一句话说明

一个本机运行的网页：左边是资产库（导入本机文件夹里的图片），中间是画布（每个节点是一段和 agent 的对话，可以从任意一条消息 fork 出新节点），右边是当前节点的对话面板（上面有 9 个图片槽位、视频时长和画面比例）。agent 按 MiniMax H3 官方写法写视频提示词，图片在提示词里用 `<Picture 1>` 到 `<Picture 9>` 引用。第一版只出提示词，不生成视频。

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
      src/native/             # 弹系统选文件夹窗口、在资源管理器里显示文件
    client/
      src/pages/              # Home、Canvas、Settings
      src/components/         # AssetLibrary、CanvasView、NodeCard、ChatPanel、SlotStrip、PromptBox、UploadChecklist、Collage、MentionEditor
      src/store/
  tools/mock-llm/             # 假的大模型服务，测试和开发用
  tests/e2e/                  # Playwright
  tests/fixtures/images/      # 测试图片
  docs/
```

数据存放（不在仓库里）：

```
本机配置（Windows：%APPDATA%\media-agent\；其他系统：~/.media-agent/）
  config.json                 # 工作文件夹路径、各模型配置的 key（按模型配置 id 存）、资产库导入了哪些文件夹、上次拼图存哪
  thumbs/<hash>.jpg           # 资产库缩略图缓存

工作文件夹（用户指定，可放同步盘）
  model-configs.json          # 模型配置（名字、接口地址、模型名、发图长边），不含 key，两台机器共用
  prompts/
    ref2va.md / i2v.md / t2v.md # 自带的三套系统提示词，第一次设置工作文件夹时从 docs/prompts/ 复制（已有同名的不覆盖）
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
  editedFromMessageId?: string;         // 手动改提示词生成的版本，指向被改的那条
  videos?: { promptIndex: number; path: string; createdAt: string; meta: Record<string, unknown> }[];  // 预留，第一版恒为空
  usage?: { promptTokens: number; completionTokens: number };
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

界面上 `systemNote` 显示成用户气泡上方的一行灰字，attachments 显示成带编号的小缩略图。

### 5.5 回复怎么解析

放在 `shared/src/parse.ts`。

- 标题：`<title>…</title>`，取第一个。
- 提示词框：`<prompt>` 或 `<prompt label="…">` 单独成行开始，`</prompt>` 单独成行结束，中间原样保留（去掉首尾空行）。用非贪婪匹配，允许多个。框里出现的 `<Picture 1>`、`<Subject 1>`、`<d>` 等尖括号内容不是标签，不要当 HTML 处理，显示时要转义。
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

### 5.10 系统提示词版本

- 每次发送前读取 `prompts/<name>.md`，算 sha256，存到 assistant 消息的 `systemPromptHash`；内容以 `prompts/.history/<name>-<hash前 12 位>.md` 存一份（已存在就跳过）。
- 面板里 assistant 消息角落显示模型名和提示词名，点开能看当时那版提示词全文。

## 6. 界面

界面全中文。

### 6.1 首页 `/`

- 列出工作文件夹下全部画布：标题、更新时间、节点数。点击打开。
- 「新建画布」（输入标题）、右键或菜单：重命名、删除（移到 `.trash/`，确认一次）。
- 顶部显示工作文件夹路径和「设置」入口。
- 没设工作文件夹时，进首页直接跳到设置页并提示先选文件夹。

### 6.2 画布页 `/canvas/:id`

三栏：左资产库（可收起，默认 280px 宽）、中画布、右对话面板（默认 480px 宽，可拖宽）。

画布：

- 节点卡片（约 260px 宽）：标题（双击改）、9 格小缩略图（空格显示为虚线框）、概述（当前路径最新一条 assistant 的第一个框；有多个框时右上角显示「3 个方向」）、右上角星标、折叠时下方显示「▸ 已收起 N 个」。
- 点卡片选中并在右侧打开；连线从父指向子。
- 卡片右键菜单：fork 到新节点（等于从最后一条消息 fork）、折叠/展开、删除（弹确认，写明会一起删多少个子节点）、重命名。
- 工具栏：「新建节点」（空节点放在画布空白处）、「自动排整齐」（dagre 从左到右，和 fork 新节点放在原节点右侧一致）、缩放归位。
- 拖动节点后保存位置。

右侧面板从上到下：

1. 头部：标题、模型配置下拉、系统提示词下拉。
2. 消息列表。用户消息靠右：上方灰字 `systemNote`，气泡内文字，下方带编号的小缩略图。assistant 消息靠左：框外文字按 Markdown 渲染；每个提示词框是一个组件，标签在框顶，内容用等宽以外的可读字体、保留换行；框底一排按钮：复制、星标、编辑、上传清单、沿此方向 fork。消息悬停出操作：用户消息「编辑」「从这里 fork」；assistant 消息「重新生成」「从这里 fork」；有兄弟版本时显示 `‹ 1/2 ›`。失败的消息显示错误和「重试」。
3. 槽位区：一行 9 格，填了的显示缩略图和编号，悬停显示删除；支持 5.1 里的拖拽。右边是时长（4–15 下拉）和比例下拉。
4. 输入框：Enter 发送，Shift+Enter 换行；发送中显示「停止」。第二批换成 Tiptap 编辑器，输入 @ 弹出选图窗口，选中的图在框里显示成带缩略图的小标签。

### 6.3 资产库（左栏）

- 顶部：搜索框（按文件名，不区分大小写，子串匹配，搜全部导入过的文件夹，结果最多 200 条）、「导入文件夹」（弹系统窗口；非 Windows 或弹窗失败时显示路径输入框）、「拼图」（第二批）。
- 文件夹树：每个导入的根文件夹一棵，可展开子文件夹；右键「移除」（只从库里移除，不动文件）。
- 图片网格：当前文件夹下的图片，按文件名排序，缩略图懒加载，超过 200 张用虚拟滚动。单击选中，Ctrl/Shift 多选，双击放进下一个空槽位，拖拽到槽位区。
- 打开某个文件夹时重新扫描一次（超过 5 秒没扫过才扫），另有「刷新」按钮。
- 只列 jpg、jpeg、png、webp；heic、heif 灰显「不支持」。

### 6.4 设置页 `/settings`

- 工作文件夹：路径 + 「选择」（系统窗口）。第一次设置时初始化目录结构并复制默认提示词。
- 模型配置列表：名字、接口地址、key（显示时打码）、模型名、发图长边；「测试连接」调一次 `/v1/models` 或发一条极短消息。
- 系统提示词：列出 `prompts/*.md`，右侧文本编辑器，保存、新建、删除、「用外部编辑器打开」（服务端 `start <文件>`）。自带三套：`ref2va`（参考模式，六个部分，新建节点默认用它）、`i2v`（一张图当首帧，开头带对齐指令行加三个部分）、`t2v`（纯文字，三个部分），列表里按这个顺序排在前面。
- 程序固定附加的格式要求：只读显示。
- 资产库文件夹列表（和左栏同一份数据）。

## 7. 服务端接口

全部在 `/api` 下，JSON。路径参数里凡是文件路径，必须在导入的资产文件夹或工作文件夹之内，否则 403。

```
配置       GET/PUT  /config                         （modelConfigs 每项是工作文件夹里的配置加上本机的 apiKey；GET 时 apiKey 打码；PUT 里 key 为 "******" 表示不改）
提示词     GET      /prompts                         列表
           GET/PUT  /prompts/:name                   读/写
           POST     /prompts                         新建 {name, text}
           DELETE   /prompts/:name
           GET      /prompts/:name/history/:hash     历史版本
           GET      /format-requirement              固定格式要求原文
画布       GET/POST /canvases                        列表 / 新建 {title}
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
           POST     /canvases/:id/nodes/:nid/messages/:mid/star {promptIndex, on}
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
```

SSE 事件（send / regenerate / edit 共用）：`{type:'user', message}`（send 和 edit 先发这个）、`{type:'assistant-start', message}`、`{type:'delta', text}`、`{type:'done', message}`（含解析结果和 usage）、`{type:'error', message}`。服务端收到流的每一段就落盘一次 `text`（节流 1 秒），中断后再打开也能看到已收到的部分。

调接口时 `stream: true`，解析 `data:` 行；`usage` 有就记。请求失败或非 2xx，把状态码和返回体前 500 字写进 `error`。

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

做：资产库「拼图」按钮打开拼图面板（盖在画布上，左边资产库照样能拖）；选行数和列数（各 1–3，不能 1×1）；从资产库拖图进格子，格子间拖动调顺序；「加编号」开关，默认关；每格是正方形，边长可选 1024（默认）或 1536；图完整放进格子，空白补白色；编号开启时在左上角画黑字白底圆角小框，字高约格子边长的 5%；导出 JPEG 质量 92；保存前弹系统窗口选文件夹（记住上次），文件名 `collage-YYYYMMDD-HHmmss.jpg`；保存后如果那个文件夹在库里，刷新出现；不在库里，问要不要导入。

完成标准：10.2 第 3 条。

### P7 撤销（第二批）

做：Ctrl+Z / Ctrl+Shift+Z，客户端撤销栈 50 步，覆盖：节点移动、节点删除（服务端从 `.trash` 恢复）、折叠、重命名、槽位改动（替换、调顺序、删除、新增）、时长和比例改动。切换画布时清空。已发出的消息不可撤销。

完成标准：10.2 第 4 条。

## 9. 测试

### 9.1 mock-llm

`tools/mock-llm`，Express 监听 3799，实现 `POST /v1/chat/completions`（支持 stream 真假）和 `GET /v1/models`。回复内容按规则生成，测试靠它断言：

- 统计最后一条 user 消息里的图片数和它们前面的 `<Picture N>` 标签，回复里写「收到 N 张图：<Picture 1>、<Picture 2>」；没有图写「收到 0 张图」。
- 把最后一条 user 消息的第一个文本段（也就是 systemNote）原样写进「说明：…」。
- 写「历史消息 M 条」，M 是请求里除 system 外的消息数。
- 默认输出 `<title>测试标题</title>` 和一个提示词框，框里有六个部分，`summary:` 那行写「[reference generation] 测试概述，引用了 <Picture 1>」。
- 用户文字含「三个方向」→ 三个带 label 的框；含「只回答」→ 不输出框；含「报错」→ 同样的文字第一次请求返回 500，再请求就正常回复（测重试）；含「慢」→ 每段间隔 500 毫秒、总共 6 秒（测停止）。

### 9.2 单元测试（vitest，`packages/shared`）

- `parse`：标题、单个框、多个带 label 的框、没有框、框内含 `<Picture 1>` 和 `<d>` 不被破坏、概述提取（有 summary 行、没有时取前两行）、流式半截时的状态。
- `slotDiff`：5.4 的五种情况各至少一个用例，包括「换图又追加」归入重新编号。
- `compose`：第一条消息带全部图和 note；追问不带图；时长变化只有 note；失败的 assistant 消息被跳过；content 数组顺序正确。
- `versionTree`：当前路径计算、新建消息更新 activeChildOf、切换版本不影响更深层、编辑用户消息复制快照。
- `forkChain`：从 assistant 消息 fork 含该消息；从 user 消息 fork 不含且 draft 正确；只复制链上的消息。
- `imageRules`：给定宽高和字节数，返回要不要缩、缩到多大、要不要转 JPEG，覆盖 5760、256 和 30 MB 三条边界。
- `collageLayout`：格子坐标、fit-inside 尺寸、编号位置。
- `summaryForCard`：多框时取第一个，80 字截断。

### 9.3 服务端集成测试（vitest + supertest，用临时工作文件夹）

- 画布增删改查、删除进 `.trash`。
- 节点 fork：链复制正确、槽位和时长正确、父子关系正确。
- send 走 mock-llm：SSE 事件顺序、消息落盘、解析结果、标题写进节点；regenerate 生成兄弟；edit 生成用户版本并复制快照；edit-prompt 不调模型。
- 图片导入：正常图原样复制；6000 像素图缩到 5760；200 像素图放大到 256；同一文件第二次导入复用 id；`.llm.jpg` 长边 1600。
- 资产库：扫描只列支持的格式；搜索跨根文件夹；路径越界返回 403。
- 停止生成后消息保留已收到的部分。
- 30 MB 的用例用 `it.skip` 标出并写明原因（生成大图慢），改为手动验收。

### 9.4 端到端（Playwright，对 mock-llm）

用例见第 10 节。测试前用脚本生成 `tests/fixtures/images/`：五张 800×600 的纯色带文字 JPEG、一张 6000×4000、一张 200×150、一个 `.heic` 空文件。

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
3. 拼图 2×2、边长 1024、四张图 → 文件存在，尺寸 2048×2048；开编号再拼一次 → 左上角像素区域不是纯白。
4. 删除节点后 Ctrl+Z → 节点回来，子节点也回来；改槽位顺序后 Ctrl+Z → 顺序恢复。

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

## 12. 给实现 agent 的约定

- 只做本计划写的；觉得该加的先问用户，不要自作主张加守卫、警告、功能。
- 界面文字全中文，代码标识符英文，注释少而准。
- 每阶段结束写报告，等用户确认再继续；不要自动 git 提交。
- 测试用 mock-llm，不要在测试里调真模型；真模型只在手动验收时用。
- 拿不准的产品行为，先查 `docs/requirements-interview.md`，还是拿不准就问，不要猜。
- 服务只监听 127.0.0.1；所有文件路径参数必须校验在允许的目录内。

## 13. 预留和以后

- 接第三方接口生成视频：`Message.videos` 已留字段；每个提示词框以后加「生成」按钮，结果挂在框下；发起生成时用这条消息的 `slotSnapshot` 按编号上传画布副本。
- 视频和音频参考：以后在节点上加 `videoSlots`（3 个）和 `audioSlots`（3 个），编号各自独立，不影响图片编号。
- 复制时按平台写法转换 `<Picture N>`：以后在 `shared/src/exportFormat.ts` 加转换函数，复制按钮按设置里选的平台调用。
- 按画面内容搜图、节点提示词对比、节点搜索、清晰度设置：不做预留。
