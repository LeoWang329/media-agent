# 调研：basketikun/infinite-canvas 能不能用

调研于 2026-09-16。方法：浅克隆仓库读源码（commit d213a74，v0.18.0，2026-09-07），逐条对照 `docs/requirements-interview.md` 里已经定下的需求。

## 结论

不能直接用，也不建议在它上面二次开发。它是「素材编排画布」——节点是图片/文本/生成配置，连线是数据流，连好了直接出图出视频；我们是「对话树画布」——节点是一段和 agent 的对话，从任意一条消息 fork 成树。节点的含义根本不同，不是缺功能，是另一件事。

但它有三处代码可以直接抄，见最后一节。

## 它是什么

| | infinite-canvas | 我们 |
|---|---|---|
| 规模 | 42,706 行 TS/TSX，395 次提交，6.6k star，MIT | 6,645 行，P0–P6 已完成 |
| 架构 | 纯前端。Vite + React 19 + antd 6 + zustand + localforage，浏览器直连你配的 OpenAI 兼容接口 | 前端 + 本机 Node 服务（express + sharp），服务读写你的工作文件夹 |
| 数据存哪 | 浏览器 IndexedDB，跨机靠 WebDAV 或手动导入导出 | 工作文件夹里的普通文件，放同步盘两台机器共用 |
| 节点是什么 | image / text / config / video / audio / group，靠连线组成数据流 | 一段对话 |
| 对话在哪 | 右侧「画布助手」侧栏，围绕选中节点聊，一条线，不分叉 | 就是节点本身，能 fork 成树 |
| 画布渲染 | 自己手写（`web/src/components/canvas/infinite-canvas.tsx`） | @xyflow/react + dagre |
| 面向什么模型 | 完全模型无关 | 只做 MiniMax H3 |

它顺带还有：插件系统（用 TS SDK 写自定义节点）、本地 Canvas Agent（让 Codex / Claude Code 通过 MCP 操作画布）、内置 7 个开源提示词库。

## 逐条对需求

括号里是证据的文件和行号，或者说明我怎么确认「没有」。

| 需求（访谈记录的条目号） | 它有没有 | 说明 |
|---|---|---|
| 节点 = 一段对话，可 fork 成树（10） | 没有 | 全仓库 grep `fork` / `branch` 只命中一条 analytics 注释 |
| 消息版本切换「1/2」（11） | 没有 | `CanvasAssistantSession.messages` 是平铺数组，`web/src/types/canvas.ts:126` |
| 9 个图片槽位、跟着消息走、自动补位（6–9） | 没有 | 参考图靠连线接进来，数量不限，没有编号语义。grep「槽位」`Picture` 零命中 |
| `<Picture N>` 引用写法（1、19） | 没有 | 同上 |
| MiniMax H3 的六段结构、`<Subject N>`、`[Shot N]`、台词标记（26、27） | 没有 | grep `minimax` / `h3` 零命中（`h3` 只命中 HTML 标题标签）。只有赞助商是卖 H3 API 的 |
| 多套系统提示词、每节点各选一套、版本留档（15、16) | 没有 | 全局只有一个系统提示词文本框，`web/src/components/layout/app-config-modal.tsx:266` |
| 提示词框：复制 / 星标 / 手动改成新版本（12、30） | 没有 | grep `starred` / `favorite` 零命中 |
| 一条回复出多个方向、每个方向单独 fork（22） | 没有 | |
| 上传清单（21） | 没有 | 它直接调接口出图，不需要人工上传 |
| 资产库引用本机文件夹、新加的图自动出现（18、20） | 没有 | 资产是手动加进浏览器，`web/src/stores/use-asset-store.ts`。grep `showDirectoryPicker` / `webkitdirectory` 零命中——浏览器里它根本读不到你的磁盘 |
| 画布存成工作文件夹的子目录、同步盘共用（29） | 没有 | 存 IndexedDB |
| 图片按 H3 规格处理（256–5760 像素、30 MB）（31） | 没有 | 纯前端，没有 sharp 这类服务端图片处理 |
| 拼图，几张拼成一张宫格图（24） | 没有 | 有裁剪、蒙版、分割、放大，没有拼图 |
| 时长 4–15 秒、画面比例跟着消息记录（17） | 部分 | 它有视频时长和比例设置，但是全局生成参数，不跟着消息走 |
| 输入 @ 插带缩略图的小标签（19） | 有，但不是一回事 | `canvas-resource-mention-textarea.tsx`、`canvas-prompt-chip-input.tsx` 插的是画布资源引用，没有槽位编号 |
| Ctrl+Z 撤销（29） | 有 | 画布级撤销重做 |
| 多套模型配置、OpenAI 兼容接口（14） | 有 | 而且比我们全：多渠道、拉模型列表、自定义调用脚本 |
| 接第三方接口调 H3 生成视频（我们的二期） | 有 | `web/src/services/api/video.ts:149`，见下一节 |

一句话：核心的六七条需求（对话树、槽位编号、H3 写法、多套系统提示词、提示词框、本机资产库、工作文件夹），它一条都没有。

## 为什么不建议在它上面二开

1. **要改的是地基，不是外围。** 存储从 IndexedDB 换成本机工作文件夹，得给它加一个能读你磁盘的后端——它现在完全没有后端。资产库引用本机文件夹同理。
2. **对话树塞不进它的数据模型。** 它的节点是素材、连线是数据流；我们要的是节点是对话、边是 fork。等于在它 42,706 行里重写一遍我们已经写完的 6,645 行，还要顺着它的 zustand + IndexedDB 存储改。
3. **它自己说了别跟上游。** README 原文：「项目目前处于开发阶段，不保证历史数据兼容。各种本地存储格式都可能直接调整……如果你需要稳定维护自己的分支，建议自行 fork 后独立开发。」也就是说合并上游会持续痛，而不跟上游的话，二开的意义只剩「起手有 42k 行不相干的代码」。
4. **许可证之外还有一句要求。** MIT 允许免费商用和闭源，但作者在 README 里另外要求「二次开发与 PR 请保留原作者信息和前端页面标识」。这不是 MIT 的强制条款，是作者的请求，长期用之前值得想清楚怎么处理。
5. **我们已经做到 P6，第一版只剩撤销。** 换底盘等于推倒重来。

## 可以抄的三处

1. **调 H3 生成视频的接口写法**（我们二期要做）。`web/src/services/api/video.ts:149-235`：OpenAI 兼容 `/videos` 的 multipart 建任务、轮询、取结果三段都齐了；`resolveVideoMode`（313 行）的规则是超过 2 张参考图自动走 `mode=reference`，首尾帧走 `mode=frames`，正好对应 H3 的参考模式。二期照着写，省掉摸接口的时间。
2. **自定义调用脚本的思路**。它让用户写一段 JS 适配各种中转站，注入 `http` / `request` / `poll` / `sleep` / `onDelta` 等变量（变量清单在 `web/src/i18n/locales/zh-CN.ts:43`）。以后换 H3 的中转站时，这个比写死一种接口耐用。
3. **提示词库的源清单**。内置 7 个开源提示词源，清单在 `docs/content/docs/overview/third-party-prompt-repositories`。以后想在写提示词时翻参考可以用。

不用抄的：画布渲染它是手写的（`infinite-canvas.tsx` 256 行 + `canvas-node.tsx` 960 行），我们用 @xyflow/react 已经跑通了，没必要换。

另外 `canvas-agent/` 那套「本机 Codex / Claude Code 通过 MCP 操作画布」以后如果想让 agent 自己批量开节点跑对比，是现成的参考，现在用不上。

## 克隆位置

调研用的副本在 `C:\Users\LEO~1.WAN\AppData\Local\Temp\claude\D--cc-media-agent\a8d45b8b-c770-4606-bcc7-37c009b68cf4\scratchpad\ic`，是临时目录，下次开会话就没了。要留着看的话说一声，我拷到别处。
