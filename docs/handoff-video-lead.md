# 交接：生成视频配置弹窗 + SelfLift 续写起点（2026-10-12）

最新修复及合并功能回归见 [已知问题回归](reports/known-bugs-regression-20261012.md)：局部重绘黑块、删除失败与竞态、重复图片槽位、手工双图指令、AutoDL 缺货识别；应用内 12 组图像、4 组 SelfLift 视频真机完成，历史手工 JSON 的额外 GPU 验证受库存阻塞。以下交接为此前的历史快照。

同日后续补充：[SelfLift 完成状态回退和一采低清预览修复](reports/selflift-status-preview-20261012.md)。以下是此前一轮的历史快照；后续分支整合状态见 `docs/reports/branch-integration-20261012.md`。

最新分段策略、历史任务兼容和真机验证见 [SelfLift 长视频修复](reports/selflift-duration-20261012.md)；转真人当前标准见 [Krea2 标准工作流修复](reports/krea2-real-standard-20261012.md)。本轮用户已授权完成后提交并推送 `main`。

这份是给接手的 agent 看的。这轮做完了用户要的三件事，**代码还没提交**（用户没说「提交」，照 `AGENTS.md` 的约定别自己提）。
先看第 1 节（现状）、第 4 节（怎么验）、第 5 节（坑），细节都在 `docs/dev-plan.md` 5.35、5.36 和 `docs/reports/selflift-u37.md` 里。

---

## 1. 出门前的状态（照个相，接手先对一遍）

**git**：`HEAD = 78148cb`，和 `origin/main` 一致。工作区（**未提交**）24 个改 + 7 个新：

```
M AGENTS.md                               M packages/shared/src/types.ts
M docs/dev-plan.md                        M packages/shared/src/video.ts
M docs/reports/selflift-u37.md            M packages/shared/test/video.test.ts
M packages/client/src/api.ts              M tests/e2e/17-video.spec.ts
M packages/client/src/canvas/AssetsDialog.tsx      M tools/mock-comfyui/src/app.ts
M packages/client/src/canvas/PromptBox.tsx         M tools/mock-comfyui/src/ssh.ts
M packages/client/src/canvas/VideoJobs.tsx
M packages/client/src/canvas/VideoSettings.tsx
M packages/client/src/canvas/overlays.ts
M packages/client/src/design/video.css
M packages/client/src/pages/Canvas.tsx
M packages/client/src/store/canvasStore.ts
M packages/server/src/comfy/client.ts
M packages/server/src/comfy/videoJobs.ts
M packages/server/src/routes/canvases.ts
M packages/server/src/routes/validate.ts
M packages/server/src/store/canvases.ts
M packages/server/test/videoJobs.test.ts

新：docs/handoff-video-lead.md（就是这份）        新：packages/server/src/comfy/videoLead.ts
     packages/client/src/canvas/VideoGenDialog.tsx      packages/server/src/store/leads.ts
     packages/client/src/canvas/VideoLeadPick.tsx       docs/reports/video-gen-dialog.png
                                                        docs/reports/video-lead.png
```

`AGENTS.md` 只加了一行（指向这份交接）；`web/prototype/.gen/` 是别的会话留下的草稿，没动、也别提。

**已推上去的那三轮**（用户的规矩是「说提交才提交」，这三轮是他说的）：

- `02243ee` SelfLift 接续照 U37 那份搬进来 + 双 LoRA 双采 + 接缝声音羽化
- `9b19667` 「从第 N 段起重出」+ 接力的参考图改 `ref_images.ref_image_<i>`（修 Boolean value of Tensor 报错）
- `78148cb` 补文档（worktree 流程、局部重绘双图、Krea2 实测）

**跑起来的东西**：

- dev 服务在 3711（服务）/ 5173（Vite）/ 3798（假 ComfyUI）/ 3799（假大模型）。
  ⚠️ 现在这套是我这个会话的后台任务，我这边结束后可能一起没了；接手先 `npm run dev` 自己起一遍。
- AutoDL 视频那台 **running**：`pro-788815c418ec`，设置里空闲 30 分钟自动关（应用自己会关，不用手动关）。
- 工作文件夹：`C:\Users\leo.wang\Downloads\tmp_h3`；本机配置在 `%APPDATA%\media-agent\config.json`。

**验过的**（下面第 4 节有命令）：`typecheck` 绿、`npm test` 331 passed / 1 skipped、`npm run test:e2e` 75 passed、
真机两条 SelfLift 续写都是 `done`（15.08 秒、1728×960、有声音）。

---

## 2. 用户这轮要的三件事，做到了什么程度

1. **先提交并推送** ✅ 做完了（`9b19667`、`78148cb` 已推）。
2. **点「生成视频」弹配置窗，里面能改配置，顶上有「开始生成」** ✅ 做完、e2e 覆盖、截图 `docs/reports/video-gen-dialog.png`。
3. **SelfLift 能传入「前一段视频」接着续写，空着就是重新生成** ✅ 做完，shared / 服务端 / e2e 都有用例，真机两条验过，
   成片 `outputs/u37/videos/续写-原样接-2d69ce0b.mp4`、`续写-规整一份-f27b9ec2.mp4`，截图 `docs/reports/video-lead.png`。

---

## 3. 改了什么、设计是什么样的（接手必须知道的部分）

### 3.1 「续写起点」的数据模型

| 东西 | 在哪 | 说明 |
| --- | --- | --- |
| `VideoLead` | `packages/shared/src/types.ts` | `{ kind: 'job'; jobId } \| { kind: 'media'; mediaId } \| { kind: 'lead'; leadId }`：三种来源 |
| `VideoSelfLift.lead` | 同上 | 节点生成设置里那一项；`null` = 重新生成。跟别的设置一样每个节点一份、改了自动存 |
| `LeadRecord` + `CanvasDetail.leads` | 同上 | 传上来的那段视频：`{ id, sha256, ext, originalName, originalPath, bytes, addedAt }` |
| `VideoChain.lead` | 同上（`VideoChainLead`） | 这条任务实际用的那段：`name` 是接进流程的名字、`uploaded` 是原件名（规整过才有）、`seconds` 是量出来的时长 |
| `VideoJob.lead` | 同上 | 显示用：`{ label, seconds? }`，视频卡片上写「续写 <label>」 |

**段数口径（最容易搞错的地方）**：`chain.total` **含**前一段（`selfliftClips(...) + 1`），但 `chain.clips` **只放这次新出的几段**。
所以「这次出到第几段」还是 `clips.length`，`advance` / `send` / 进度那几处不用减一；拼整条时用 `mergeClips(chain)` 把前一段排在最前面。
`rerunFroms`（「从第 N 段起重出」能选哪几档）把 `lead` 算进「已经出完的段数」，段号按出片顺序数（第 1 段就是前一段）。

### 3.2 一条带起点的任务从头到尾

1. **选**：`VideoLeadPick.tsx`（SelfLift 那栏最上面一行）→ `canvasStore.setLead` / `useLead`。
   传本机文件走 `api.uploadLead` → `POST /canvases/:id/leads/upload`；资产库走 `AssetsDialog` 的 `lead` 模式 → `POST /canvases/:id/leads`。
   两种都存进画布的 `leads/`（`store/leads.ts`，按内容哈希命名），**只存不探测**——浏览器读不出宽高（H.265 就是）也能用。
2. **建任务**：`videoJobs.create`。普通那条把节点设置里的 `lead` 带进 `params.selflift.lead`（`videoParams` 自动带上）；
   `again` / `rerun` 照参数抄。建完统一做一次 `leadSourceOf`（`videoJobs.ts:349`）校验并记 `job.lead`（显示用）。
3. **发任务**：`submit`（`videoJobs.ts:474` 附近，在 `withLock` 里、拷完留下的那几段之后）：
   `leadFileOf`（`:367`）找到本机文件 → `prepareLead`（`comfy/videoLead.ts:68`）把它传上那台，**量一次、必要时规整**，
   结果记进 `chain.lead`。文件名按任务起：`media_agent_<jobId>_lead<ext>`（规整出来的加 `-lead-fix.mp4`）。
4. **出片**：第 1 段的 `LoadVideo` 读的就是前一段（`chain.clips.at(-1)?.name ?? chain.lead?.name` 那行），
   之后 `VideoFrameSample(tail, context)` → `AddGuide(frame_idx 0)` → 羽化 → 剪掉上下文帧 → `ColorTransfer`，跟第 2 段起一模一样。
   注意 `shared/video.ts` 里那句 `context = prev ? plan.context : 0`——**有起点时新出的第 1 段也带上下文**（原来是按 `clip > 0` 判的，改过）。
5. **拼接**：最后一段出完，`selfliftMergeGraph(mergeClips(chain))` 读 `[前一段, ...这次出的]` → `ConcatenateVideo` → `SaveVideo`。
   成片时长 = 前一段 +（`plan.total − contextFrames`）帧：新出那段开头 `contextFrames` 帧是前一段的尾巴、出片时剪掉了
   （8 秒 + 8 秒那档实测 **15.08 秒**，界面摘要按「新出多少」算，已经减掉这几帧）。
6. **收尾**：成片出来后 `dropChainInputs` 把传上去的原件 + 规整那份 + 各段一起 `rm -f`；删这条视频时 `dropChainFiles` 兜底。
   两条任务用同一段视频各传各的（按任务命名），不会互相删。

### 3.3 规整：这轮最花时间的一条真机结论

`ConcatenateVideo` 只有**各段签名一样**才走「原样接」（不重编），签名里带编码器写出来的 **SPS/PPS（`extradata`）**、
宽高、帧率、位深、色彩、**声音采样率和声道数**。差一样它就把每段重编一遍，而重编两段出来的 SPS 未必一致，整条直接失败：

```
生成视频出错（SaveVideo）：Video chunk 1 could not be encoded compatibly:
  extradata: expected b'…j\x02\x02\x02\x80…', got b'…j\x02\x1a\x02\x80…'
```

在真机上拿四种规整法对照跑（`outputs/u37/try-concat.mjs`）试出来：规整必须照 **ComfyUI 自己写 sRGB 的写法**
（`-color_primaries bt709 -color_trc iec61966-2-1 -colorspace bt709`）+ **声音 `aac 32000` 立体声**（H3 音频 VAE 就是 32 kHz），
`scale/pad` 到出片大小、`fps=24`、`format=yuv420p`、`libx264 -crf 18`。所以 `videoLead.ts` 里：

- `fits()`（`:91`）：宽高、24 帧、**h264**、8 位 yuv420p、色彩 bt709 系（或没标）、有声音、**声音 32 kHz 立体声** → 原样用；
- 否则 `transcode()`（`:105`）按上面那套做一份 `-fix.mp4`，**做完再量一次**，还是对不上就当场报错（不往下发）；
- `AUDIO_RATE = 32000`（`:88`）是**照 H3 音频 VAE 硬编码的**——哪天换音频模型/换流程，这里是第一个要看的地方。

### 3.4 配置弹窗

- 组件：`VideoGenDialog.tsx`（挂在 `pages/Canvas.tsx` 最后一行）；开关状态在 `overlays.ts` 的 `genVideo` + `openGenVideo/closeGenVideo`；
  入口是 `PromptBox.tsx` 里那个「生成视频」按钮（现在只开窗，不再直接发）。
- 窗里内容跟「生成设置」小窗**同一个组件**：`VideoSettings.tsx` 里的 `VideoSettingsBody`（这轮从小窗里抽出来的，`message` 给了就多几样跟框相关的）。
  改的还是节点上那一份设置，两边互通、改了自动存。
- 顶部「开始生成」（`#vgGo`）+ 底部再放一个（`#vgGoFoot`）；段数不够时两个都灰、窗里显示原因。

---

## 4. 怎么验（照抄就行）

```powershell
# 1) 类型 + 单测/集成（只用 mock，不连真机）
npm run typecheck
npm test                       # 期望：30 文件 331 passed / 1 skipped

# 2) e2e —— 必须带这三个环境变量！
#    不然 playwright 会复用 dev 那套跑着的 mock（3798/3799），测的是旧进程、静默假绿
$env:E2E_MOCK_COMFY_PORT='3898'; $env:E2E_MOCK_LLM_PORT='3899'; $env:E2E_MOCK_COMFY_SSH_PORT='3897'
npm run test:e2e               # 期望：75 passed（约 8 分钟）
npx playwright test 17-video --reporter=line -g "续写起点|弹配置窗"   # 只想跑这两条新用例

# 3) 真机（会开机、花真钱，两条各 ~5 分钟，一共 ~10 分钟）
npx vitest run --config outputs/u37/vitest.real.config.ts outputs/u37/try-lead.real.ts
#    日志 outputs/u37/try-lead2.log；成片落在 outputs/u37/videos/
```

注意：

- e2e 前如果 3712 端口上还留着上次没退干净的 e2e 服务，会报「already used」，杀掉那个进程再来。
- `vitest` 偶尔抖（8~12ms 秒挂 / 几秒超时，单跑都过）：`npx vitest run --no-file-parallelism --retry=1`。
- 真机脚本用的是**临时工作文件夹**（`startTestApp` 自己建的），不会动用户的工作文件夹。

---

## 5. 坑（这轮踩过的，别再踩）

1. **Vite 会被文件工具的临时目录搞崩**：报 `EBUSY … .<文件>.<pid>.<uuid>.tmpdir/<文件>.tmp`。
   处理：删掉 `packages/**` 下的 `*.tmpdir` 目录，重启 `npm run dev`。别在 Vite 跑着的时候疯狂改 `packages/client` 下的文件。
2. **改 mock 必须换端口跑 e2e**（上面那三个环境变量），否则复用到旧进程 = 假绿。
3. **别用 PowerShell 改仓库里的 UTF-8 源码**（`Set-Content` 会按 ANSI 重写，中文注释全乱、还可能吃换行）。要改就用编辑器工具。
4. **mock 和真代码之间有一处「约定字符串」要同步**：`packages/shared/src/video.ts` 的 `LEAD_MARK`
   （`# media-agent:lead-probe` / `# media-agent:lead-fix`）和 `tools/mock-comfyui/src/ssh.ts` 里的 `LEAD_PROBE_MARK` / `LEAD_FIX_MARK`。
   改一边要改另一边，`tools/mock-comfyui/src/ssh.ts` 的 `state.lead = 'fits' | 'fix'` 决定假的那台量出来是「一样」还是「要规整」。
5. **假 SSH 的私钥偶尔生成失败**（`Cannot parse privateKey`）：重跑就好，不是代码问题。
6. **实例上那个羽化插件**（`ComfyUI-MiniMax-H3-Audio-Guide-Feather`）作者那版 `compat.py` 在 ComfyUI 0.38 上默认不生效，
   装了得按 4 空格缩进修一次（这台已修）；重装/换实例要重新修，不修的话「接缝声音羽化」刻度等于白填。
7. **`npm run test:e2e` 会自己打包前端**，所以改了客户端代码不用手动 build；但 **dev 服务（5173）是另一套**，改完刷新页面即可。
8. 用户的约定：**界面文案和注释全中文**；**测试只准用 mock**（不连真模型、真 ComfyUI、真 AutoDL）；
   **不要自动 git 提交**，等他说「提交」。

---

## 6. 还没做的 / 可能的下一步

- **提交这轮**：等用户说「提交」，把第 1 节那 23 改 + 6 新一起提（新文件别漏）。
- **视频素材导入 HEVC 那条老问题**（用户之前报的：`…前10s.mp4` 拖进「视频/音频」那一排读不出来，提示「换成 mp4（H.264）或 webm 再试」）：
  根因是**浏览器探测**拿不到宽高（`hvc1` 2160×3840@60 → `videoWidth/Height = 0`），`mediaProbe` 就拒了。
  之前给过用户三个选项（a 改文案、b 允许导入但没预览/没截帧、c 服务端带 ffmpeg），他还没选。
  **注意**：这轮做的「续写起点」不走那条路（`leads/` 只存内容、不探测），所以续写用 HEVC 文件是能用的；
  但「视频/音频槽位」那条老路还是拒 HEVC。要修的话落点在 `packages/client/src/canvas/mediaProbe.ts` + `store/media.ts`。
- **U37 里仍然没抄的**：`ExtendIntermediateSigmas`（那份工作流里输出悬空）、注意力补丁那几个节点（程序自己有一套）、
  `ComfySwitchNode` 那两个开关（换成程序自己判断）。见 `docs/reports/selflift-u37.md`「没抄什么，为什么」。
- **续写起点可以再往前做的**：
  - 两遍生成（`two-pass`）那套目前**不认**起点（`chainOf` 只对 selflift 生效，界面也只在 SelfLift 那栏显示）——要做就是另一套拼接口径。
  - 起点那段视频如果特别长（几分钟），现在会整段拼进去；要不要截一个上限、给个「只用最后 N 秒」的选项，用户没提。
  - 视频卡片/视频任务小窗里现在只写「续写 <label>」，要不要加缩略图/能点开看看。
- **`AUDIO_RATE = 32000` 硬编码**：见 3.3，换 H3 音频模型/换流程时要动。

---

## 7. 建议的接手顺序

1. 读 `docs/dev-plan.md` 的 **5.32 → 5.36**（SelfLift 怎么来的、双 LoRA、羽化、从第 N 段起重出、续写起点、配置弹窗）。
2. 读 `docs/reports/selflift-u37.md`（那份工作流长什么样、真机数据、这轮踩的 `extradata` 坑）。
3. `npm run typecheck && npm test`，再 `npm run dev` 打开 http://localhost:5173 手点一遍：
   视频节点 → 生成设置里切「SelfLift 接续」→「续写起点」传一段 → 「开始生成」。
4. 要动拼接口径就先把 `outputs/u37/try-concat.mjs` 的思路捡起来：在那台上直接跑
   `LoadVideo ×2 → ConcatenateVideo → SaveVideo` 做对照试验，比在程序里猜快得多。
