# 「图像编辑」节点：开发计划

要解决的问题（你的原话）：

> 我需要额外有一个节点，图像编辑的界面。
> 我可以打开一张图或多张图，然后有编辑的各类选项。
> 有的节点编辑我还想让模型参与帮忙写提示词。

**这份是给你审的计划，还没动代码。** 布局有两份：**md 画的草图** `docs/plan-image-edit-node-layout.md`（带编号注解和四个操作各自的参数区），以及能点开看的原型 `web/prototype/image-edit-node.html`（首页原型列表第 09 条）。

> **第二版**（你说「有的编辑想让模型参与帮忙写提示词」之后）：布局整个重画了。第一版是「图 + 操作 + 历史」的工具箱，**去掉了对话框**——你说得对，那样写「要改什么」就只能自己憋。这一版把模型放回来：**模型看图，帮你把要改什么写成 ComfyUI 能吃的话，一次给几个方向**。
>
> **第三版**（你说「做成下拉菜单」+「转真人用新调研的工作流」之后）：
> - 「做什么」那一排按钮**改成一个下拉菜单**（以后还要加扩图、深度迁移，按钮排不下，而且每个操作要跟一句说明）。
> - **转真人整个换掉**：改成走 `docs/krea2-real-usage.md` 里那套（`Easy_QwenEdit2509` + `Krea2OstrisEditModelPatch` + `beta57`），**不再是**挂在 Krea2 编辑档里的那个预设——那套 LoRA 得配它自己训练时的编码节点，挂在 `Krea2EditGroundedEncode` 上是错的（调研文档第 6 节第一条就是这么翻车的）。
> - ⚠️ **已经写好的代码要跟着改**：`packages/shared/src/krea2.ts` 里 `KREA2_EDIT_PRESETS` 的 `real-v1` / `real-v3` 两条要**拿掉**（它们挂的是 Krea2Edit 那条路），转真人改成一个自己的内置流程。
>
> **第四版**（`docs/krea2-real-usage.md` 更新到 `krea2_v10.json` 那一版之后）：转真人那份调研补了一大半，转真人的实现和界面都要跟着改。四个新东西：
> - **主力工作流是「全开关」那份**：`Krea2转真人-全开关（反推+单双图+手输）`——三个控件：**① 用反推吗**、**② 双图吗**、**手输提示词**。
> - **「反推」是个新能力**：工作流里挂了个 `llama_cpp_instruct_adv` + 35B MoE 去审查 VLM，**模型自己看图写提示词**（系统提示词按备注给），比手写强得多。
> - **`image2_strength`**：双图时「像图 2 多少」的连续旋钮（0–10，默认 1；0.3–0.6 是"脸有点像、发型还是自己的"）。
> - **人物 LoRA 走 `Lora Loader Stack` 第 2 槽**，而且它同时作用于 CLIP、会跟参考图抢。
>
> **我们不需要 `LazySwitchKJ`**：那三个惰性开关是给**手工工作流**用的（一份图里塞下所有分支）。我们是**按选项现生成图**——不用的分支根本不生成，天然就是惰性的。但反推那条链**要真接**（占显存、占时间），见第 5、7 节。
>
> **第五版**（你回的四条之后）：转真人再加东西，并把两条定死。
> **第六版**（你回的四条之后）：四条全定了，另外改了三处。
> - **「所有功能都做」**：第一轮不止那四个，上表九条都进（其中扩图 / 深度迁移 / 风格 Remix 要先真机摸工作流，见第 3 节）。
> - **每个功能配一套自己的系统提示词、而且可以选**（这是第 4 节第 1、2 条的答案）。四份已经写好放在 `docs/prompts/`：`edit.md`（指令编辑）、`edit-outfit.md`（换装）、`edit-inpaint.md`（局部重绘）、`edit-real.md`（转真人），外加一份共用的 `format-requirement-edit.md`。**选了哪个功能就用哪份**，用户在设置页里能改能换。
> - **模型不决定用哪个功能**（第 4 节第 2 条的答案）：它只写字，功能是你在下拉里选的，别让它越权。
> - **无审查是默认**（第 4 节第 4 条的答案）：**不要"作者原版"那一档**，凡是有无审查版本的，默认走无审查。
> - **反推提示词按 Krea2 写**：受众点明是 Krea2（Qwen-Image 系、吃自然语言不吃标签），见 `docs/krea2-real-reverse-prompt.md`。
> - **显存就让它常驻**：调研里 `force_offload = false`（跑完不卸载、常驻约 5GB）——**5 个 G 不值得为它每次重新加载，照调研的 `false` 来**。
> - **LoRA 是两组、都能调、都能加**：① **转真人 LoRA**（V3 那条），**默认就是 `Krea2_Anything2RealCharacters-V3`、强度 1**，但用户可以改（0.8–1.0 是作者建议区间）；② **人物 LoRA 可以挂好几个**（`Lora Loader Stack` 有 6 槽），默认「不加」、强度 0.6；候选清单我先放 6 个 Krea2 家族人物向的，以后往清单里加就行。
> - **双图加回来**（你说「那个现在可以做了，按你那个做法加上去」）：转真人给一个「做法：只转真人 / 换脸（用图 2 的长相）」+ 一个 `image2_strength`（0–10，默认 1）。注意图 2 带过来的是**整颗头**不是只换脸。
> - **反推系统提示词**写在 `docs/krea2-real-reverse-prompt.md`（**不放 `docs/prompts/`**——那个目录会被当成可选系统提示词复制进工作文件夹）。
>
> **第七版**（E3「模型参与」落地之后）：
> - **「模型提示词」是跟着功能走的**：面板顶栏那一格在编辑节点上只列**当前功能那一份**（按提示词说明段里的「功能: 」对名字），不让用户手挑别家功能的提示词。换功能时服务端自己切（见 `docs/reports/P27.md`）。
> - **候选框上的「用它」要把功能和图一起切回去**：所以每条回复上记了 `message.edit = { fn, slot }`，框右下角标「指令编辑 · 用 1 号图」。
> - **发给模型的只有选中的那一张图**（不是槽位里全部），说明写「要改的是第 N 张参考图」。
> - **框上的「开始」这一轮没做**（布局稿第 4 节 ④），留给收尾那批；界面上换功能要等 E4 把另外三个功能做出来。
> - **指令编辑这条路真机验过了**（Ostris 两个节点 + 身份编辑 v1.1）：能出图、不会自己加真人化触发词；但**姿势和景别会漂**、换衣服偏保守（会叠穿），见 `docs/reports/real-machine-edit-node.md`。第 7 节的风险表里那两条可以划掉了。
>
> **第八版**（你 2026-10-11 拍的两条）：
> - **转真人的固定参数照作者那套**：`Easy_QwenEdit2509` + `Krea2OstrisEditModelPatch(kv_cache=true)` + `KSampler(euler, beta57, 8 步, CFG 1, denoise 1)` + V3 LoRA + `ColorCorrect` 饱和度 −20 + 长边 1536。**不要**改成我们编辑档那条（`euler/simple` + 10 步）——那条只是「能出图」，不是这一档要的。
> - **参考工作流就是那台上现成的那几份**（`/root/ComfyUI/user/default/workflows/`）：主力 `Krea2转真人-全开关（反推+单双图+手输）`（① 用反推吗 ② 双图吗 + 手输）、双图那两条 `作者原版-双图` / `反推一体-双图（读备注）`、无审查 `Krea2转真人-无审查`。实现时**照这些的接线和参数抄**，见 `docs/krea2-real-usage.md` 第 1 节的表（已补上后加的两份）。
>
> **第九版**（E4 落地之后，2026-10-11）：
> - **转真人 + 换装做完了**（`docs/reports/P28.md`）：转真人照上面那份「全开关」的原样接线和参数；换装还是编辑档那条路，只换 `krea_outfittransfer`。
> - **局部重绘还没做**（要在大图上拖框/涂抹出掩码、走 E05 那条 SDXL 流程），是 E4 剩下的那一档，下一轮。
> - **`POST /edit` 的口径改了**：请求里的字段是覆盖，底是**节点上存的那份编辑设置**——只发 `{fn}` 时不会再把反推/双图/LoRA 悄悄换回默认值（真机上踩过：双图没生效就是这个）。
> - **插件名按实机核过**：`llama_cpp_*` 是 `llama-cpp_vllm`、`ColorCorrect` 来自 `comfyui-art-venture`、`FluxKontextMultiReferenceLatentMethod` 是 ComfyUI 本体。
> - **`image2_strength` 验过了**：0.3 / 0.6 / 1.0 三档明显不同（1.0 时发色变暖、脸更圆、背景偏暖，往图 2 靠；0.3 最像图 1 真人化），**但不是换脸**——1.0 也拿不到图 2 的具体五官。界面上那句「0.3–0.6 是脸有点像、发型还是自己的」跟实测对得上。

> **第十版**（E7 前一半落地，2026-10-12）：
> - **第 3 批那三条摸完了**（`outputs/devcheck/w3-findings.md`）：**深度迁移**和**风格 Remix / 换人**能做、**进代码了**；
>   **姿势迁移**和**扩图**不做（理由见第 3 节那张表）。
> - 六个功能的系统提示词齐了：`docs/prompts/edit-depth.md`、`edit-remix.md`；`BUILTIN_PROMPTS` 从 12 套变 14 套。
> - 新的两条接线在 `packages/shared/src/krea2Depth.ts` / `krea2Remix.ts`，`krea.mode` 多出 `'depth'` / `'remix'` 两个值
>   （跟 `'real'` 一样只有编辑节点会给，界面上那排下拉里选不到）。
> - **控制强度不能填 0**、**LoRA 名必须带 `krea2/` 前缀** —— 这两条是真机踩出来的，代码里都卡住了。
>
> **第十一版**（E5 落地，第 2 批 + 收尾）：
> - **放大 / 高清和四视图做完了**（第 3 节那张表里两条都改成「已落地」）：
>   放大走**生图节点已有的那条内置放大路**（不新写流程），参数只有倍数 / 放大模型 / 面部修复开关，
>   **重绘强度固定 0（只放大不重画）**；这一条**不用模型写字**，所以没有 `docs/prompts/edit-upscale.md`，
>   面板上也没有「提示词」那一行（改写成「这个功能不用模型写字，点了直接放大」）。
>   四视图照「生图节点已有」那条路搬进来，框里那句只当**额外要求**，主指令 `FOUR_VIEW_INSTRUCTION` 程序自己接。
> - **框上的「开始」做完了**（布局稿第 4 节 ④）：每条候选框上都能直接出图，出的那组挂在**这条框**下面
>   （`POST /edit` 多收 `messageId` + `promptIndex`，带上时不新建回复）；跟面板底部那条共用同一个服务端路径。
> - 顺手把两处说明改成实话：深度迁移 / 风格 Remix 的出图**固定 1024×1024**（不是跟着图走，代码里的尺寸没动）；
>   局部重绘那块写明「走 SDXL 那条重绘流程，底模按提示词上的系列走」。
>
> **第十二版**（六条功能真机各跑一遍之后，2026-10-12）：
> - **深度迁移 / 风格 Remix / 放大高清 / 四视图 / 指令编辑 / 转真人 六条都真机验过**（36 / 27 / 9 / 42 / 30 / 30 秒），出图在 `outputs/real/shots/F-*.png`。
> - ⚠️ **局部重绘真机上是坏的**：掩码对、尺寸对、遮罩外没动，但**要重画那块是纯黑的**。查过三步：① `LoadImage` 把 RGBA 按 alpha 合成到黑底（填中灰再跑还是黑）；② 改成**底图 + 掩码分两张传**还是黑；③ 换 seed、denoise 0.85→1 出图**逐字节一样** → 生成没落到那块上。**问题在 E05 这条流程本身**（`docs/reports/P24.md` 只验过「遮罩外没动」），**修好之前别拿它干活动**，见 `docs/reports/P29.md`。
> - **扩图、姿势迁移不做**（真机证据：扩图那个 LoRA 要 bounding box、四种接法全废；那台上没有 Krea2 的 pose LoRA）。

---

## 1. 现在编辑能力散在哪

| 能力 | 现在从哪进 | 别扭在哪 |
| --- | --- | --- |
| Krea2 指令编辑（T07） | 生图节点 → 出图设置 → 起图选「编辑」 | 得先有个 Krea2 生图节点，还要翻设置 |
| 动漫转真人 | 同上 → 编辑方案选 V1/V3 | 同上；而且它跟"改这张图"没关系，本质是编辑 |
| 换装 | 同上 → 编辑方案选换装 | 同上 |
| 局部重绘（拖框/涂抹） | 大图窗口 → 局部重绘 | 只能从"已经出过的图"进 |
| 四视图 | 槽位菜单 / 图下方按钮 / 大图窗口 | 三个入口，已经够用 |
| 放大和重绘 | 大图窗口 | 只能从"已经出过的图"进 |

**要点：这些全是"拿一张已有的图去改"，却都得从生图节点或者大图窗口绕进去。** 你要的是一个专门干这件事的节点。

---

## 2. 这个节点长什么样

面板宽度就是现在那个抽屉（默认 600px、能拖宽），里面**上中下三块**：

```
┌─ 图像编辑 · 编辑 · 4 张图 ──────────────────── [转真人] [×] ─┐
│                                                              │
│                                    ┌──────────────────────┐  │
│ 上面：跟模型说话                     │ 把她的外套换成朋克风， │  │
│                                    │ 脸别动               │  │
│ 看了 ①（站台这张），给你三个方向：    └──────────────────────┘  │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Change her coat into a black studded leather biker       │ │
│ │ jacket, keep her face, hair and the platform the same.   │ │
│ │ [用它] 复制 翻译                指令编辑 · 用 ①           │ │
│ │ 开始  出 3 张 · 8 步                                      │ │
│ │ ▣ ▣ ▣                                                    │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Replace the grey coat with a worn red leather jacket …   │ │
│ │ [用它] 复制 翻译                指令编辑 · 用 ①           │ │
│ │ 开始  出 1 张 · 8 步                                      │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Turn the anime girl into a photorealistic photograph …   │ │
│ │ [用它] 复制 翻译                转真人 V3 · 用 ② ①        │ │
│ │ 开始  出 1 张 · 8 步 · 2048×2048                          │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ 图  ① ② ③ ＋      拖进来 / 资产库 / 出过的图 / 从电脑里选      │
│     场景 人物                                                 │
├──────────────────────────────────────────────────────────────┤
│ 中间：编辑栏                                                  │
│ 做什么  [指令编辑] [转真人] [换装] [局部重绘]                  │
│         这个操作要 1–2 张：① 场景 ② 人物（② 可不选）           │
│ 要改什么 [Change her coat into a black studded leather …]     │
│ 相似度  场景 [1]   人物 [1]                        [ 开始 ]   │
├──────────────────────────────────────────────────────────────┤
│ 下面：输入框                                                  │
│ 跟模型说两句，比如「把背景换成雪天」      [写一个] [ 发送 ]    │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 上面：模型帮你写「要改什么」

- **模型能看槽位里的图**。你选中的图（① ②）会当参考图发给模型，跟现在视频节点带参考图那套一样。所以它可以照着图说"你这张是雨夜站台，外套是深灰的"。
- **你说人话就行**（中文），模型给 **2–3 个方向**，每个是一张框。框里有：那段能让 ComfyUI 吃的话、`用它 / 复制 / 翻译 / 打星`、以及**这条是哪个操作、用哪几张图**。
- 点 **用它** → 落到下面编辑栏的「要改什么」，同时把操作和图也切过去（框上标着的那套）。想自己写就直接在编辑栏里改。
- 点 **写一个** → 不问那句话，直接让模型按当前操作和图开写（照生图节点的「写标签」）。
- 框上还能直接 **开始**，出的一组图就挂在框下面（这一条完全照生图节点：进度、排队、失败原因、临时文件、下载、打星、看大图、「同样参数再来」全是白拿的）。

**这一版的关键取舍**：编辑节点**有对话**（跟生图节点一样是一棵消息树），但**框里不是"要画什么"，是"要改什么"**。所以版本、岔出、翻译、打星、上传清单这些老机制原样能用。

### 2.2 中间：编辑栏（这一排是新的）

- **图**：就是现在的槽位（拖进来、资产库、出过的图、从电脑里选都现成），最多 9 张，带编号 ①②③。**点一下图就选中它**，选中的标上角色。
- **做什么**：一个**下拉菜单**（不是一排按钮），决定走哪条流程、要几张图、还有哪些参数。每项右边跟一句说明，选完那句说明落到下面那行：

  ```
  ┌────────────────────────────┐
  │ ✓ 指令编辑              ▾ │   一句话改图：单图或双图
  │   转真人                   │   动漫/插画 → 真人照片（可指定长相）
  │   换装                     │   只换衣服，长相姿势不动
  │   局部重绘                 │   拖框或涂抹，只改一块，别处不动
  └────────────────────────────┘
  ```

  换操作**不动**你已经选的图和写好的字；只有"要几张"对不上时才提示。以后加"扩图""深度迁移"就是往这个菜单里加一条。

  | 操作 | 要几张 | 参数 |
  | --- | --- | --- |
  | 指令编辑 | 1–2（① 场景、② 人物可选） | 要改什么、场景相似度、人物相似度 |
  | 转真人 | 1–2（① 要转的动漫图、② 真人参考可选） | 版本（作者原版 / 无审查）、补充词、图 2 强度。**尺寸不用填**（跟图 1 走） |
  | 换装 | 1 | 要改什么（写成"换成什么"） |
  | 局部重绘 | 1 | 「在图上拖框或涂抹」出掩码、这块画成什么、重绘强度 |

- **开始**：按选中的操作 + 选中的图 + 「要改什么」建一组任务。没选够图时按住并写清楚缺哪张。

### 2.3 下面：输入框

跟别的节点一样（发送 / 停止 / 附件 / @ 引用）。

---

## 3. 编辑选项清单

**你说"这一轮所有功能都做"，所以九条全进第一轮**。按下表的"状态"分三批落地：

| 操作 | 要几张 | 走什么 | 状态 | 落地的批 |
| --- | --- | --- | --- | --- |
| **指令编辑** | 1 | **Krea2 编辑档**（5.37 那套，不是四视图的 Krea2Edit）：`Krea2OstrisEditModelPatch` + `TextEncodeKrea2OstrisEdit`，默认挂身份编辑 v1.1 的 LoRA（**不挂动漫转真人 V3**，所以不会自己加真人化触发词） | 流程已有 | 第 1 批 |
| **转真人** | 1–2（图 2 只有「换脸」用） | **另开一条内置流程**，照 [krea2-real-usage.md](krea2-real-usage.md) 附录 A/B/C：`UNETLoader(krea2_turbo_fp8_scaled)` → `Lora Loader Stack`（槽1 = 转真人 LoRA，默认 `Krea2_Anything2RealCharacters-V3` 强度 1；槽2+ = 人物 LoRA，可挂好几个）→ `Krea2OstrisEditModelPatch(kv_cache=true)`；`Easy_QwenEdit2509(image1[, image2], latent_image)` → `FluxKontextMultiReferenceLatentMethod`×2 → `KSampler(8 步 / CFG 1 / euler / beta57)`；图各先过 `ColorCorrect(饱和度 −20)` 再 `ImageScaleByAspectRatio V2`（长边 1536）。**外加「反推」那一侧**：`llama_cpp_model_loader`(Qwen3.6-35B MoE 去审查 + mmproj) → `llama_cpp_parameters` → `llama_cpp_instruct_adv`（system_prompt 用 `docs/krea2-real-reverse-prompt.md` 那两份） | **要新做**（调研完了，接线和参数都定死了） | 第 1 批 |
| **换装** | 1 | Krea2 编辑档 + `krea_outfittransfer` | 流程已有 | 第 1 批 |
| **局部重绘** | 1 | E05（`InpaintCropImproved` → … → `InpaintStitchImproved`） | 流程已有（大图窗口） | 第 1 批 |
| **放大 / 高清** | 1 | 放大模型 + 轻修 | **已做**（第 2 批）：走生图节点那条内置放大路（`UpscaleModelLoader` + `ImageUpscaleWithModel` + 可选的面部修复），**不用模型写字**，见 `packages/server/src/comfy/jobs.ts` 的 `upscaleParams` | 已落地 |
| **四视图** | 1 | T10 + `krea2_4panel` | **已做**（第 2 批）：跟生图节点那个「做四视图」同一条路，原图是槽位选中的那张，框里那句只当额外要求，见 `docs/prompts/edit-fourview.md` | 已落地 |
| **无审查（NSFW）** | 跟各功能一样 | 不是单独操作：转真人那档换底模 + 文字理解两个文件 | 见第 3.1 节 | 第 1 批（跟转真人一起） |
| **扩图（往外扩）** | 1 | `krea2_outpaint_rank32` | **不做**：现有节点满足不了那个 LoRA 的输入契约（要源图在画布上的 bounding box → `reference_placements`），四种接法都试过，见 `outputs/devcheck/w3-findings.md` 第 4 节。要做得先装 `ComfyUI-Rebels-Krea2-Outpaint` | 2026-10-12 真机摸过 |
| **深度迁移** | 1 | `Krea2ControlLoRALoader` + `Krea2ControlImageEncode` + `Krea2ControlApply`（facok 的控制类三节点）+ `DepthAnythingV2Preprocessor` | **已做**（第七批）：`packages/shared/src/krea2Depth.ts`，照 `outputs/devcheck/w3-depth.json` 逐字抄 | 已落地 |
| **姿势迁移** | — | — | **不做**：那台上 Krea2 控制类 LoRA 里没有 pose 的；拿 OpenPose 骨架喂深度 LoRA 会把骨架白线画进画面 | 2026-10-12 真机摸过 |
| **风格 Remix** | 1 | Ostris 那条（`LoraLoaderModelOnly` 只喂 model + `Krea2OstrisEditModelPatch` + `TextEncodeKrea2OstrisEdit` + 参考图缩到 0.140625 MP） | **已做**（第七批）：`packages/shared/src/krea2Remix.ts`，两个 LoRA（换人 / RealCosplay）只换 `lora_name`，照 `w3-reid2.json` / `w3-remix2.json` 逐字抄 | 已落地 |

**"先在真机上摸"是什么意思**：这三条的工作流我们**没跑过**，接线、参数、插件都不知道，照猜会翻车（转真人当初就是这么翻的）。要摸就得有一台能用的 ComfyUI——**现在不接 AutoDL**，所以等你那台局域网 ComfyUI 方便，或者你说什么时候接。

### 3.1 「无审查」是默认，不做"作者原版"那一档

你说"不要普通的那一档，我要默认的；有的话都做无审查那一档"。所以：

| 功能 | 有没有无审查版本 | 我们怎么做 |
| --- | --- | --- |
| **转真人** | **有**（`Krea2转真人-无审查`） | **默认走无审查**：底模 `krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors`、文字理解 `qwen3vl_4b_uncensored_int8_convrot.safetensors`，接线一模一样。界面上不再给"作者原版 / 无审查"二选一 |
| 指令编辑 / 换装 | 没有单独的无审查档 | 照现有链路（LoRA 有身份编辑 v1.1 / v1.2 / 换装） |
| 局部重绘 | 没有 | 照现有 E05 |
| 反推那一侧 | 本来就是去审查的 VLM（35B MoE Uncensored） | 不用改 |

⚠️ **一个代价得说清楚**：无审查那套的底模是 `moodyAmateurMixKrea2_3JAVStyle_int8`，**保真度不如官方的 Turbo**（调研第 7 节说"只把 CLIP 换成去审查那个、底模保持官方 Turbo 保真更好"）。你要是发现无审查那套出图变差，我们再把它拆成两档。

**转真人这条为什么不能将就**（调研文档写得很清楚）：
- 它**必须**用 `Easy_QwenEdit2509` 当编码节点。换成别的（比如我们现在编辑档用的 `TextEncodeKrea2OstrisEdit`，或者四视图那条用的 `Krea2EditGroundedEncode`），参考图会跟生成图的网格对不上 —— 出的图跟原图完全是两张。
- `Krea2OstrisEditModelPatch` 的 `kv_cache` **必须开着**（关了会"severe loss of image consistency"，出糊图）。
- 调度器是 **`beta57`**，不是我们习惯的 `simple`；步数 / CFG / 采样器 / denoise 也固定 8 / 1 / `euler` / 1，界面上不给改。
- **出图尺寸不由我们填**：跟着图 1 缩放后的尺寸走（长边 1536、按原图比例、16 的倍数）。
- 提示词**前半句固定**（`transform the image to realistic photograph`），**必须放最前面、一个字都别改**；用户填的补充词接在后面。**双图触发词**（`with the character looking exactly like the one in Figure 2.`）只有双图才加，而且**反推关掉时得自己写进去**（反推开着时是模型写的）。
- **「反推」的规矩（第 4 节）**：给反推模型的系统提示词里，**风格 / 方向词可以给，内容词一个都不能给**（性别、体型、穿什么、有没有裸露、解剖细节）——给了它必照抄，图里没有黑丝也会写 `black stockings`，加"没有就别写"不管用。另外要它**按 7 项逐项扫**（主体 / 长相 / 服装一件件 / 构图 / 环境逐件 / 光 / 材质），简单特写 40 词、复杂场景 80 词封顶。
- **别加** `8k` / `DSLR` / `masterpiece` / `best quality` 这类质量词 —— 会跟触发词打架。界面上要写这句提醒。
- **人物 LoRA（第 6 节）**：只能挂 Krea2 家族（SDXL / Pony 的挂上去不生效），放 `Lora Loader Stack` 第 2 槽往后、强度先 0.6；它**同时喂 CLIP**，而且**会跟参考图抢**——两个 LoRA 总强度别顶满，容易花。**要指定某个具体的人，图 2（配 `image2_strength`）比 LoRA 直接得多。**
- **双图（第 2 节 + 附录 B）**：图 1 = 要转的图（构图姿势 + **决定出图尺寸**），图 2 = 真人参考（长相）。`image2_strength` 是「像图 2 多少」的连续旋钮（0–10，默认 1）：**1.0 全盘接管、0.6 混合、0.3–0.6 是"脸有点像、发型还是自己的"**（实测 0.0 也压不干净）。⚠️ 图 2 带过来的是**整颗头**——发色、发型、帽子、耳环全跟过来，提示词里明写 `silver hair` 也压不住；**要"只换脸"得靠换脸节点（像素级贴脸），那是另一条路。**
- **反推常驻显存**：`force_offload = false`（照调研），跑完多占约 5GB 不释放——**就这样，5 个 G 不值得每次为它重新加载**。要彻底放掉得重启 ComfyUI。
- 实机结果（调研文档记的）：单图 1152×1536 **147 秒**，双图同尺寸 **63 秒**；**反推开着 ~39 秒、关掉 ~30 秒**（惰性开关生效时反推链完全没跑，`find_slot` 0 条）。

**为什么先做这四个**：指令编辑 / 换装 / 局部重绘都是现成链路，转真人的接线也已经有调研定死了；扩图 / 深度迁移要先摸工作流（现在**不接 AutoDL**，等你那台局域网 ComfyUI 方便）。

---

## 4. 这几条已经定了（原来的"等你拍板"）

1. **节点类型 / 系统提示词**：`NodeKind` 独立出来变成 `'video' | 'image' | 'edit'`，`use` 加 `'edit'`。
   **每个功能配一套自己的系统提示词，而且可以选**（你的原话"每个功能都有相应的提示词……它就会有一套专门的提示词来控制它"）：
   - 四份已经写好：`docs/prompts/edit.md`（指令编辑）、`edit-outfit.md`（换装）、`edit-inpaint.md`（局部重绘）、`edit-real.md`（转真人），说明段都是 `用途: 编辑` + 一个 `功能: xxx`。
   - 共用一份输出格式 `docs/prompts/format-requirement-edit.md`。
   - **选了哪个功能就用哪份**：节点的系统提示词跟着「功能」下拉自动切；用户在设置页里能改、能换（跟现在改生图 / 视频提示词一样）。
   - 要动的代码：`parsePromptMeta`（认 `用途: 编辑`，把 `功能` 也读出来）、`PromptMeta` 加 `fn` 字段、`BUILTIN_PROMPTS` 加这四份、`FORMAT_REQUIREMENT_DOCS` 加 `edit` 一项。
2. **模型不决定功能**（你的原话"不要让它连着功能一起定"）：模型只写那句话，**功能是你在下拉里选的**。候选框上那个角标只标"这条是给哪个功能用的"（就是当前选中的那个），模型没有越权的余地 —— 这样系统提示词里也不用给它一份"有哪些功能"的清单。
3. **结果怎么存**：沿用现在"消息里挂一组图"那套，进度、排队、失败、临时文件、下载、打星、再来全都白拿。编辑节点内部仍用 `messages` 存，只是框里的语义不同。
4. **一次能开几张图**：槽位 9 张，**单选**（转真人开「换脸」时是两张）。
5. **第一轮范围**：**所有功能都做**，见第 3 节那三批。
6. **反推**：做，默认「让模型看图写」；系统提示词定稿在 `docs/krea2-real-reverse-prompt.md`（受众点明是 Krea2）。
7. **双图**：做，「做法：只转真人 / 换脸」+ `image2_strength`。
8. **LoRA**：转真人 LoRA 可调（默认 V3），人物 LoRA 可挂好几个、候选清单写在代码里，以后加一条就多一个选项。
9. **无审查是默认**：不做"作者原版"那一档，见 3.1。

---

## 5. 要改哪些地方（实施时照这个改）

| 层 | 改什么 |
| --- | --- |
| `packages/shared/src/types.ts` | `NodeKind` 独立出来变成 `'video' \| 'image' \| 'edit'`；`PromptMeta['use']` 加 `'edit'`，并加一个 `fn`（这个功能名，比如 '指令编辑'）；`ChatNode` 加可选的编辑设置（记住上次选的功能 / 谁写词 / 做法 / LoRA） |
| `packages/shared/src/promptMeta.ts` | `用途: 编辑` → `use: 'edit'`；顺手把说明段里的 `功能:` 读进 `fn` |
| `docs/prompts/edit.md`（**已写好**） | 指令编辑那套系统提示词：写一句英文祈使句，说清"改什么 + 什么不变" |
| `docs/prompts/edit-outfit.md`（**已写好**） | 换装那套：只写衣服，明说脸 / 姿势 / 背景不动 |
| `docs/prompts/edit-inpaint.md`（**已写好**） | 局部重绘那套：写"这块画成什么"，一小段名词短语，不写祈使句 |
| `docs/prompts/edit-real.md`（**已写好**） | 转真人那套：只挑辅助词，**不写**主触发词、**不写**画面内容、不写质量词 |
| `docs/prompts/format-requirement-edit.md`（**已写好**） | 编辑节点共用的输出格式：框里就是那句要直接发给 ComfyUI 的话 |
| `packages/server/src/store/prompts.ts` | `BUILTIN_PROMPTS` 加这四份；`FORMAT_REQUIREMENT_DOCS` 加 `edit: doc('format-requirement-edit')` |
| `packages/shared/src/nodeSummary.ts` 等 | 卡片写「编辑 · N 张图」；首页最近动过的节点跟着显示 |
| `packages/client/src/pages/Canvas.tsx` | 「新建节点」菜单加第三项「图像编辑节点」（`:36-39`） |
| `packages/client/src/pages/Settings.tsx` | 系统提示词列表加第三组（`:427` 那两行旁边） |
| `packages/client/src/design/image.css` | 卡片第三种颜色 |
| `packages/client/src/canvas/EditPanel.tsx`（新建） | 编辑栏：图选择 + 做什么 + 参数 + 开始；从 `Dock.tsx` 按 kind 分支挂上去 |
| `packages/client/src/canvas/GenSettings.tsx` | 把 Krea2「编辑」档那套参数抽出来，编辑节点和生图节点共用 |
| `packages/client/src/canvas/MaskEditor.tsx` | 已经能独立用，编辑节点直接复用（局部重绘那个参数点开就是它） |
| `packages/client/src/canvas/BoxTagEditor.tsx` / `PromptBox.tsx` | 编辑节点的框不显示标签小块，显示成一段话 + 「用它 / 开始」 |
| `packages/server/src/routes/canvases.ts` | 建节点允许 `kind: 'edit'`；系统提示词只接受「用途: 编辑」的那一套 |
| `packages/shared/src/krea2.ts` | **把 `KREA2_EDIT_PRESETS` 里的 `real-v1` / `real-v3` 拿掉**（转真人不再挂在编辑档里）；编辑档留下身份编辑 v1.1 / v1.2 / 换装 |
| `packages/shared/src/krea2real.ts`（新建） | 转真人的内置流程 `realGraph(params, seed, { image, imageB, mode, reverse })`：照 [krea2-real-usage.md](krea2-real-usage.md) 附录 A + B 拼。固定值写死（8 步 / CFG 1 / euler / **beta57** / denoise 1 / `kv_cache` true / `vl_size` 384 / `auto_resize` crop / 长边 1536 / 饱和度 −20），**不出宽高**（跟着图 1 走）。LoRA：槽 1 固定是转真人 LoRA（默认 V3、强度可调），槽 2+ 是人物 LoRA 列表（可空、可多个、各带强度）。双图（`mode === 'face'`）时多接一条图 2 链 + `image2_strength`。提示词：反推开 → `llama_cpp_instruct_adv` 输出接 `Easy_QwenEdit2509.prompt`；反推关 → 用用户那条（预填主触发词 + 辅助词）。**不用 `LazySwitchKJ`**：不需要的分支不生成 |
| `docs/krea2-real-reverse-prompt.md`（新建） | **反推那两份系统提示词**（单图 / 双图）的原文 + 为什么这么写。**不放 `docs/prompts/`**——那个目录里的 `.md` 会被当成可选系统提示词复制进工作文件夹 |
| `packages/shared/src/workflow.ts` | `PLUGIN_OF` 补：`Easy_QwenEdit2509` → `easy_qwenEdit_2509`、`LazySwitchKJ` → `ComfyUI-KJNodes`、`ColorCorrect` / `LayerUtility: Boolean` → `ComfyUI_LayerStyle`、`llama_cpp_*` → 反推那个插件、`ShowText\|pysssss` → `ComfyUI-Custom-Scripts`（**具体包名实施时照那台机的 `object_info` 核对**） |
| `tools/mock-comfyui/src/app.ts` | **要补**：`Easy_QwenEdit2509`（clip/vae/image1/latent_image + prompt/system_prompt/auto_resize/vl_size，可选 `image2` + `image2_strength`；出 CONDITIONING×2 + LATENT）、`Krea2OstrisEditModelPatch`（model + kv_cache）、`FluxKontextMultiReferenceLatentMethod`、`LayerUtility: ImageScaleByAspectRatio V2`、`ColorCorrect`、**`Lora Loader Stack (rgthree)`（6 槽，model + clip 两路出）**、**`llama_cpp_model_loader` / `llama_cpp_parameters` / `llama_cpp_instruct_adv`（反推，出 STRING）**；`KSampler` 的调度器列表加 **`beta57`**；`UNETLoader` 加 `krea2/krea2_turbo_fp8_scaled.safetensors` 和 `krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors`；LoRA 列表已有 V3 + 六个 Krea2 人物 LoRA |
| `packages/server/src/comfy/jobs.ts` | 建任务：按"操作 + 哪几张图 + 要改什么"拼；指令编辑 / 换装走 Krea2 编辑档，**转真人走 `realGraph`**，局部重绘走 E05；不用 `paramsFor` 那条按标签拼正面词的路 |
| `packages/server/src/routes/images.ts` | 现在 `POST …/images` 是按"提示词框"建任务的，要能收「操作」这个字段 |
| `packages/server/src/comfy/jobs.ts`（看图） | 把槽位里选中的图当参考图发给模型（照视频节点 5.31 那套 `ref_images`） |
| `tools/mock-comfyui`（其余） | 不用改：`Krea2Edit*`、`Inpaint*`、`LoadImage`、`VAEEncode/Decode`、`EmptySD3LatentImage` 都在 |
| 测试 | 单测（`realGraph` 整张 `toEqual`、操作 → 参数）、集成（建任务、两张图、看图、缺插件说清装哪个）、e2e（建编辑节点 → 放两张图 → 选「转真人」→ mock 收到那套接线 → 出一组） |

---

## 6. 分几步做、每步的完成标准

| 步 | 做什么 | 完成标准 |
| --- | --- | --- |
| **E1** | 节点模型：`NodeKind` 加 `'edit'`、`use` 加 `'edit'`、`PromptMeta` 加 `fn`、`parsePromptMeta` 认 `用途: 编辑` 和 `功能:`、`BUILTIN_PROMPTS` 加四份、`FORMAT_REQUIREMENT_DOCS` 加 `edit`、新建菜单第三项、设置页第三组、卡片样式和摘要 | 能建出编辑节点、卡片写「编辑」、设置页里四份编辑提示词都在、面板里能选；老节点不受影响 |
| **E2** | 面板骨架 + 编辑栏：图选择（单选，带角色名）、功能下拉（先只放「指令编辑」）、提示词下拉（的框架）、开始 → 出一组图 | 放一张图、选好、写一句话 → 出图 → 挂在框下面、能看大图 |
| **E3** | 模型参与：看图、**按当前功能自动切系统提示词**、给 2–3 个方向、`用它 / 复制 / 翻译 / 打星`、`写一个` | 说一句中文 → 出几个方向 → 点「用它」落到编辑栏 → 能出图；换功能后模型换一套提示词，写出来的东西跟着变 |
| **E4** | 剩下三个功能：换装、局部重绘、**转真人**（转真人是新流程：`realGraph` + mock 补节点 + 加 `beta57`、LoRA stack、无审查当默认） | 各自能出图；要几张图的提示、缺图时拦住；缺插件时说清装哪个 |
| **E4b** | **转真人的三组开关**：「谁写词（反推 / 手输 + 辅助词）」、**「做法（只转真人 / 换脸 + `image2_strength`）」**、**LoRA 两组（转真人 LoRA 默认 V3 可调 + 人物 LoRA 可加好几个）** | 反推开 → 图里挂上 `llama_cpp_*`（`force_offload=false` 常驻）；关 → 那条链根本不生成；换脸 → 图 2 链出现、`image2_strength` 进图；LoRA 槽按列表拼、clip 也走 stack |
| **E5** | 第 2 批功能：放大 / 高清、四视图（都从大图窗口搬） | 各自能出图；跟编辑栏的其它功能并列在下拉里。**已做完**，顺带把布局稿第 4 节 ④「框上的开始」也做了 |
| **E6** | 收尾：再来、下载、失败原因、空状态、预设 | 「同样参数再来」不重涂；失败说得清楚；节点删了图也没了 |
| **E7** | 第 3 批功能：**深度迁移、风格 Remix**（扩图、姿势迁移真机摸完决定不做，见第 3 节） | 摸清楚接线和参数之后照 E4 那样接；**2026-10-12 已落地** |
| **E7b** | 第 3 批剩下的：扩图（要另装 `ComfyUI-Rebels-Krea2-Outpaint`）、姿势迁移（要 Krea2 的 pose 控制 LoRA） | 有料了再做 |

E1–E7 做完你先看过再进下一步。**E1–E7 不需要新开 ComfyUI 工作流**；E7b 那两条得先有对应的料（插件 / LoRA）。

---

## 7. 风险 / 还没定的

| 风险 | 说明 | 怎么降 |
| --- | --- | --- |
| `NodeKind` 和提示词解绑会碰老数据 | 5.23 定的是"用途决定 kind"，老节点读的时候按系统提示词补 kind | 读的时候照旧补，只是多认一种"用途: 编辑"；加单测卡住老节点 |
| 编辑节点的框和生图节点的框长得像但语义不同 | 一个"要画什么"、一个"要改什么" | 框上标着功能名；复制/翻译/打星照旧，标签小块不显示 |
| **四份编辑提示词写的东西不一样，容易互相串** | 换装那套去写画面、局部重绘那套写成祈使句、转真人那套去写主触发词 | 每份里都写了"反例（别这么写）"；**E3 已经卡住**：换功能时服务端把「模型提示词」换成那个功能那份（单测 + 接口 e2e），假模型按功能回四句不一样的话 |
| 模型看图要占 token | 槽位图发给模型，一次可能好几张 | 照视频节点那套：只发选中的那几张，长边压到阈值（现有 `imageLongSide` 机制） |
| 服务端建任务的入口要新写 | 现在 `paramsFor` 是"按提示词框拼正面词" | 新写 `editParams(action, refs, text)` 和它并列，不互相缠 |
| **转真人那条链路的插件** | `Easy_QwenEdit2509`、`Krea2OstrisEditModelPatch` 要装 `easy_qwenEdit_2509` 和 `ComfyUI-Krea2-Ostris-Edit`；`LayerUtility: …`、`ColorCorrect` 那台上也有，但**别的地方不一定装了** | 出图前用 `requireNodes` 查一遍，缺了照 5.18 说清装哪个；界面上也写一句 |
| **转真人不能用别的编码节点替代** | 调研文档记的翻车：换成 `TextEncodeKrea2OstrisEdit`（我们**编辑档**现在用的就是这个）会"洗白、发粉、跟原图无关"；换成四视图那条的 `Krea2EditGroundedEncode` 同样不对。**出图跟原图完全是两张** | 接线照附录 A 抄死，别"顺手统一成编辑档那套" |
| **反推那侧的插件不一定装了** | `llama_cpp_*` 三个节点 + 35B MoE 的 gguf + mmproj（两个文件都不小），少一个反推就跑不起来 | 出图前 `requireNodes` 查；缺了就说清装哪个 / 下哪个模型；界面上「反推」那一档标清楚它要额外的东西 |
| **反推吃显存和时间** | 模型是 35B MoE（IQ2_M 量化）；反推开着比关掉多 ~9 秒；跑完常驻约 5GB 不释放 | **照调研用 `force_offload = false`**（5 个 G 不值得每次重新加载）；界面上把「反推」标成可选；出图排队时别让两个带反推的任务撞一起 |
| **我们自己拼图，别把「显示节点」接在反推输出上** | 调研记的坑：`ShowText` / `PreviewAny` 是输出节点，ComfyUI 为了喂它会把上游强行拉起来——接在反推输出上，**每次都会跑反推** | 我们生成的图里**不挂任何预览 / 显示节点**；要看"实际用到的提示词"，从 ComfyUI history 里读那条 STRING，或者干脆不显示 |
| **反推系统提示词写不好会照抄** | 把词表整个塞进去，模型会写图里根本没有的 `black stockings` / `pubic hair`，加"没有就别写"不管用 | 原文在 `docs/krea2-real-reverse-prompt.md`（**只给 8 个风格词，内容词一个不给**）；单测卡住：这两份里不许出现内容类示例词 |
| **LoRA 会互相抢** | 转真人 LoRA（V3）+ 人物 LoRA 同时挂、总强度顶满 → 花图 / 糊图；人物 LoRA 还同时喂 CLIP，跟参考图也抢 | 转真人 LoRA 默认 V3、强度 1；人物 LoRA 默认「不加」、强度 0.6；界面上写一句"别顶满"；两个都开时给个提醒 |
| 转真人的尺寸不由我们决定 | 出图跟着图缩放后的尺寸走（长边 1536） | 参数区不显示宽高，写一句"跟着图走"；`ImageJobParams` 里那几个宽高对这个操作不生效 |
| 转真人的固定参数 | 步数 / CFG / 采样器 / 调度器（`beta57`）照抄别动 | 界面上不给改；`validate` 也不收这几个字段对转真人的输入 |
| 扩图 / 深度迁移要新流程 | 没在真机上摸过 | 排第二轮。**2026-10-11 已经把前置盘清**：那台的节点和模型都齐（`krea2_outpaint_rank32`、`Krea2-depth-control-lora`、`Krea2_Remix_RealCosplay_rank64_v1`、`krea2_reid_rank32` 都在；反推两个 GGUF 在 `models/LLM/`）；但**没有 SDXL 的 openpose/depth ControlNet**，深度/姿势要走 Krea2 那条（depth LoRA + Qwen-Image ControlNet）。只差工作流本身，见 `docs/reports/real-machine-edit-node.md` |
| **作者说「换掉 `Easy_QwenEdit2509` 会翻车」，我们实测没翻** | 上一条写的翻车是调研文档记的；2026-10-11 真机上用**我们编辑档那条路**（`Krea2OstrisEditModelPatch` + `TextEncodeKrea2OstrisEdit` + `euler/simple` + 10 步 + 长边 2048）挂 V3 + 触发词，**动漫图转出来的真人照片是干净的，姿势表情跟原图对得上** | **用户已拍：转真人照作者那套（Easy + `beta57`）**。我们那条不推翻，只当对照：真机验收时两条同一张图各跑一遍，好在哪、差在哪写进报告 |

---

## 8. 这份计划里没做的

- **批量**（一次转 5 张）：先不做，一次一张。你要的话说。
- **涂一涂再转真人**（局部重绘 + 转真人串起来）：先不做。
- **编辑节点互相连线**：现在连线是"参考图"那套，够用，先不改。
- **模型自己挑操作**：第 4 节第 2 条，等你拍板。
- **手工工作流里那三个 `LazySwitchKJ`**：那是给"一份图里塞下全部分支"用的。我们是**按选项现生成图**，不用的分支不生成，天然惰性——所以不装 `ComfyUI-KJNodes` 那三个开关也能跑（插件本身那台机上有，但我们的图里不出现它）。
- **反推模型常驻显存**：照调研 `force_offload = false`。5 个 G 而已，不值得每次重新加载。
