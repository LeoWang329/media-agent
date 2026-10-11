# SelfLift 接续（照 U37「真-上下文无缝无色差」那份重做）

2026-10-09 起，2026-10-10 补齐双 LoRA 双采和接缝声音羽化。原来那套「SelfLift 接力」是自己设计的（潜空间钉帧 + 整条按 5j+2 分窗），用户看过后说不要自己造，
改成把实例上那份 `U37-真-上下文无缝无色差长视频-SelfLift双采-惊尘573.json` 原样搬进程序、并放开调参。
需求讲在 `docs/dev-plan.md` 5.32、5.33，这份记的是「那份工作流长什么样、我们抄了什么、没抄什么、真机跑出来什么数」。

## 那份工作流长什么样

89 个节点，分组：Models / 双采 / Conditioning / User Inputs / 加速 / 8步再插1步低噪 / 上下文打开后传入上段视频参考 / 上下文开关 / 偏色对齐。
它是**人工迭代**用的：出一段，把上一段读回来当参考，再出下一段。关键的几段接线：

- 模型：`UNETLoader`（Dasiwa REF2VA Hybrid）→ 注意力节点 → 两个 LoRA 分叉：`fl2v_turbo_8step_v1.0`（0.75，低分辨率那段用，也是 `SelfLiftH3Sampler.model`）
  和 `fl2v_turbo_4step_v1.2`（0.7，`model_hires`，高分辨率那段用）。VAE 是 `minimax_h3_video_vae_int8_convrot` + `minimax_h3_audio_vae_fp32`，CLIP 是 `qwen3vl_32b_minimax_h3_nvfp4_awq`。
- 编码：`MiniMaxH3ReferenceToVideo`（H3 官方节点）出 `positive` + 空白 `LATENT`；9 张 `LoadImage`、3 个 `VHS_LoadVideo`、3 个 `LoadAudio` 挂在 `ref_images`/`ref_videos`/`ref_audios` 上。
  每段的帧数由 `时长`（PrimitiveFloat，默认 5 秒）经 `ComfyMathExpression` 算成 `max(5, round(a*24)) + (5 - (… % 17)) % 17`，也就是**17 的倍数加 5**；宽高由 `ResolutionSelector`（默认 2 百万像素）给。
- 上下文（`是否上下文参考` = true 那档）：`LoadVideo`（上一段）→ `VideoFrameSample`（tail，`a*17+5` 帧，a 是「上下文帧数 1/2/5」→ 22/39/90 帧）→ `GetVideoComponents`；
  前 21 帧 `ImageAddNoise` 0.1、最后 1 帧加 0 噪，`ImageBatchMulti` 合成一沓；连同这几帧的声音，`MiniMaxH3AddGuide`（`frame_idx` 0）钉在这一段第 0 帧上；
  再过 `MiniMaxH3AudioGuideFeather`（`audio_feather_ticks` 12，作者 wjc573 的插件）。
- 采样：`SelfLiftH3Sampler`，照那份的 widgets 对齐后是 `seed 42, cfg 1, transition_step 6→4, lowres_scale 0.5→0.65, rho 0, w_min 0.5, w_max 1,
  upscaler_model h3_upscaler_lms_v0.1_fp32.safetensors, model_hires = 4 步 LoRA, highres_tiling false`。
  带上下文那档把 `transition_step`/`lowres_scale` 切到 4 / 0.65（工作流里两个 `ComfySwitchNode` 跟着 `是否上下文参考` 走）。
- 出片：`VAEDecode` + `VAEDecodeAudio` → `CreateVideo` → `VideoTemporalCrop`（`start_frame` = 上下文帧数，把重复的那几帧剪掉）
  → `ColorTransfer`（`mkl_lab`、`source_stats` target_frame、强度 0.75；`image_ref` 是上一段的最后一帧）→ `CreateVideo` → `SaveVideo`。

## 抄了什么

- 整条结构：一段一条片子接力，接上一段的尾巴（`AddGuide`，第 0 帧）、出片剪掉上下文帧、段与段之间 `ColorTransfer` 对齐颜色。
- 参数默认值：8 步里前 4 步低分辨率、`lowresScale` 0.65、放大器 `h3_upscaler_lms_v0.1_fp32.safetensors`、`rho` 0 / `w_min` 0.5 / `w_max` 1、
  `cfg` 1 + `ConditioningZeroOut` 当负面、`KSamplerSelect` euler + `BasicScheduler` beta denoise 1、上下文 22 帧、接缝加 0.1 的噪、偏色对齐 0.75。
- 帧数算法：17 的倍数加 5，不够就往上给；一段最长沿用程序的 362 帧（15 秒）。
- 拆段：框里那段提示词要出的画面比一条能出的多，就把它拆成几条（用同一段提示词），条数由 `selfliftPlan` 算。

## 没抄什么，为什么

- **没有把整条塞进一个任务**。一个任务里串十几条片子，每条的画面都得解出来给下一条当上下文，ComfyUI 会把中间结果缓在显存里，必爆；
  那份工作流本身也是「出一条、存下来、下一条读回来」。所以程序改成一段一个任务，出完经 SSH `cp` 进那台的 `input/`，下一段 `LoadVideo` 读回来。
- **`ColorTransfer` 之后那个 `ComfySwitchNode`（偏色对齐开关）换成了程序里的 `colorMatch` 参数**：0 就不接 `ColorTransfer`，直接存剪完的那条。
- **`ComfySwitchNode`「是否上下文参考」那两个开关换成程序自己判断**：第 1 段没有上下文（`transition_step`/`lowres_scale` 也就照填的值走，不再按开关切 6/0.5 那档），
  第 2 段起自动接上一段。
- **`ExtendIntermediateSigmas` 没抄**：那份工作流里它的输出是悬空的（没接给谁），是个实验节点。
- **注意力那几个补丁节点没照抄**：`PathchSageAttentionKJ`、`BlockSparseAttention`、`MiniMaxLowVRAMAttention`、`ModelAttentionBackend` 在程序里本来就有自己的一套
  （`ModelAttentionBackend`「comfy kitchen attention」+ `MiniMaxLowVRAMAttention` + `MiniMaxChunkFeedForward`），照 U37 再叠一遍只会更慢。
- 界面上的说明节点、`Label (rgthree)`、`MarkdownNote`、被忽略（mode 4）的节点都不进流程图。

## 第二轮补的两处：双 LoRA 双采、接缝声音羽化（5.33）

第一轮留了两处没抄：U37 的**双 LoRA 双采**和**接缝声音羽化**（当时这台没装那个插件）。这一轮都补上了。

### 双 LoRA 双采

- U37 的接法是：`ModelAttentionBackend` → 两个 `LoraLoaderModelOnly` 分叉，`fl2v_turbo_8step_v1.0`（0.75）给 `SelfLiftH3Sampler.model`（低分辨率那遍），
  `fl2v_turbo_4step_v1.2`（0.7）给 `model_hires`（高分辨率那遍）。两个 LoRA 是**并联**的，不互相叠加。
- 程序里照这个接：设置里多两个槽 `lowresLora`、`hiresLora`（各是名字 + 强度，`null` 是不挂），都接在 `feedForward`（主模型 + 注意力补丁）之后——
  低分辨率那遍的挂完给 `model`（`BasicScheduler.model` 也用它，照 U37），高分辨率那遍的挂完给 `model_hires`；不填就不给 `model_hires`（插件自己用 `model`，跟改之前一样）。
- 设置里「LoRA」那一栏的栈还是两遍都带（位置不变：`UNETLoader` 和注意力节点之间），所以人物/风格 LoRA 不会只在半边画面上生效。
- 两个加速 LoRA 都在那台上逐字命中（`LoraLoaderModelOnly.lora_name` 共 365 项，各 1.82 GiB）；界面「挂一套」默认就填这两个，另有一键「照 U37 那套填上」。
- 默认**两个都不挂**：这套的主模型（Dasiwa Hybrid Turbo V2）自己就是加速模型，不挂才是原来那份默认。

### 接缝声音羽化（`MiniMaxH3AudioGuideFeather`）

- 插件：`wjc573/ComfyUI-MiniMax-H3-Audio-Guide-Feather`，装在 `/root/ComfyUI/custom_nodes/`，commit `043c631`（和工作流里 `aux_id` 的 ver 一致，4 个文件、没有 requirements）。直连 GitHub 被 TLS reset，走 `https://ghproxy.net/https://github.com/...` 镜像 1 秒装好。
- 节点 spec：`positive`（CONDITIONING）+ `audio_feather_ticks`（INT，默认 8，0 到 256），输出一个 CONDITIONING。刻度 0 = 保持硬接；负数、超 256 在**提交期**就被拦（不会偷偷夹）。
- 程序里的接法：第 2 段起 `MiniMaxH3AddGuide` 出来之后再串一道羽化节点（节点 315），刻度照 `selflift.audioFeather`；默认 12（照 U37 那份工作流的节点 254，不是节点默认的 8）。
  刻度填 0 就**不接这个节点**（那台没装插件也能跑，真机验过「接节点 + 填 0」和「完全不接」的音频指纹一模一样）；第 1 段没有上下文，也不接。
  （作者节点本身有个坑：CONDITIONING 里一个 audio guide 都没有时会抛 `ValueError`，我们的接法只在有 `AddGuide` 的那条路上加这道，碰不到。）
- **作者那版 `compat.py` 在 ComfyUI 0.38.0 上是静默失效的**：它拿 `inspect.getsource` + `dedent` 之后的源码做 `source.replace`，但精确串是按 8 空格缩进写的，dedent 后实际是 4 空格，两个串一个都不命中，
  于是 `MiniMaxH3Model._forward` 被换成一个**逐字相同**的副本——节点连得上、跑得绿、`audio_feather_ticks` 对结果毫无影响。0.38.0 核心也没有原生实现兜底。
  实例上那份已按 4 空格修好（`compat.py` 只动这一个文件，md5 `9a4b9ebb…` → `169f5c96…`，回退 `git checkout -- compat.py`）；**重装插件要再修一次**。

### 羽化到底有没有用的证据（同种子、同一段上下文，只差刻度）

| 运行 | 音频 `-map 0:a -f md5 -` |
| --- | --- |
| 刻度 0 | `8f0534a91b248df1cce341bbc13599cc` |
| 刻度 0 复跑 | `8f0534a9…`（逐比特相同） |
| 刻度 12 | `d434b2f087a968f0d46f6091d7a2c844` |
| 刻度 12 复跑 | `d434b2f0…`（逐比特相同） |
| **作者原版 compat（没修）+ 刻度 12** | `8f0534a9…` ← 和刻度 0 一样，坐实「假绿」 |

- 音频指纹 0 ≠ 12、同参数可复现 → 刻度确实进了模型；作者原版下 12 和 0 一模一样 → 修之前那个节点纯装饰。
- 视频 md5 连同参数两次都不稳（编码器抖动），所以画面改用 SSIM：同参数两次 0.9932，0 vs 12 是 0.8885（差一个量级）→ 画面也被改变。
- 两次提交的图只有 3 处不同（多 feather 节点、`sampler.positive` 指向、`SaveVideo` 前缀），其余 30 个节点逐字相同。

## 第三轮补的一处：从第 N 段起重出（5.34）

用户问「5 段里第 3 段有问题，是重拍第 3 段还是 5 段都重拍」——这套原本只能整条重出。加了「从第 N 段起重出」：

- 为什么不能只重出中间一段：接力是**链式**的，第 N+1 段是接着第 N 段的画面长出来的，换掉第 N 段后面就对不上；所以粒度是「从第 N 段起往后的都重出，前面几段留着」。
- 能选的起点是 `2` 到 `min(总段数, 已经出完几段 + 1)`（第 1 段起等于整条重出）；参数和**种子**照原来那条，提示词照框里现在的，段数不能变。
- 留下的那几段原样记进新这条的 `chain.clips`，只是换成新这条的名字，发第一段之前从那台的 `output/media-agent/` 拷回 `input/`。

### 真机验过（`outputs/u37/try-rerun.real.ts`，实例 A，ComfyUI 0.38.0）

15 秒 2 段、0.3 百万像素 ×1.5（1120×640）、6 步（前 3 步低分辨率）、22 帧上下文、双 LoRA 0.75/0.7 + 羽化 12：

| | 结果 |
| --- | --- |
| 第一条 | 2 段各 192 帧，成片 1,960,240 字节 |
| 从第 2 段起重出 | `rerun {base: 第一条, clip: 2}`，种子照旧 `3206708544`；带过来的段就 1 个（第 1 段，文件名还是第一条那个 `selflift_<第一条>_s0_00001_.mp4`） |
| 进度 | 直接从 `pass1 第 2/2 段` 开始——**第 1 段没重跑** |
| 成片 | 2 段各 192 帧（第 0 段是原来那一段的文件、第 1 段是新出的），1,708,100 字节 |
| 那台 `/history` | 这条 job 只跑了 2 个任务：`selflift_<新>_s1`（34 个节点）+ 拼接（4 个节点）；第 2 段的提示词是改过的那句、`LoadVideo` 读的是 `media_agent_<新>_s0.mp4`，拼接读 `_s0` / `_s1` |

两条成片都留在 `outputs/u37/videos/`（`整条-原版-f2d49327.mp4`、`整条-从第2段重出-b28c70bd.mp4`），跑完把那台上这条 job 留的三个文件清掉了。

## 真机跑出来的数

### 一次手工拼图（`outputs/u37/try-chain.mjs`，只验接线）

20 秒 2 段、22 帧上下文、0.2 百万像素、8 步（前 4 步低分辨率）、`upscaler` 用 lms 那个：

| | 帧数 | 时长 | 尺寸 | 结果 |
| --- | --- | --- | --- | --- |
| 第 1 段 | 141 | 5.88 秒 | 608×352 | 直接出，没有上下文 |
| 第 2 段 | 141 | 5.88 秒 | 608×352 | 带上一段最后 22 帧 + 那几帧的声音，剪掉 22 帧、颜色对齐 |
| 拼起来 | 260（2×141 − 22，正是 `plan.total`） | 10.83 秒 | 608×352 | h264 + aac，声音接得上 |

### 走程序自己的服务端，第一轮（`outputs/u37/try-app-chain.real.ts`，验整条链子）

20 秒 2 段、0.3 百万像素 ×1.5（出片 1120×640）、6 步（前 3 步低分辨率）、22 帧上下文：

- 任务一建出来就带着 `chain: {total: 2, clips: []}`，`frames = {total: 498, chunk: 260, overlap: 22}`。
- 进度依次是：`encode 第 1/2 段` → `pass1 第 1/2 段 1..6/6 步` → `save 第 1/2 段` → 第 1 段出完（`clips: 1`）→ `encode 第 2/2 段` → … → 第 2 段出完（`clips: 2`）→ 拼接那一条 → `done`。
- 结果：`status: done`，成片 1,300,071 字节（`video-temp/2026-10-09/225627-3671569705.mp4`），第 1 段的低清预览也留下了；全程 4 分 17 秒。

### 走程序自己的服务端，第二轮：双 LoRA + 羽化（`outputs/u37/try-app-chain2.real.ts`）

20 秒 2 段、0.3 百万像素 ×1.5（出片 1120×640）、**8 步（前 4 步低分辨率，照 U37）**、22 帧上下文、
低分辨率那遍 `fl2v_turbo_8step_v1.0` @0.75、高分辨率那遍 `fl2v_turbo_4step_v1.2` @0.7、接缝声音羽化 12：

- 任务：`chain {total: 2, clips: []}`，`frames {total: 498, chunk: 260, overlap: 22}`，出片 1120×640。
- 进度：`encode 第 1/2 段` → `pass1 第 1/2 段 1..8/8 步` → `save` → `encode 第 2/2 段` → `pass1 … 8/8` → `save` → 拼接 → `done`；全程 **4 分 54 秒**。
- 结果：`status: done`，成片 1,905,591 字节（`video-temp/2026-10-10/095423-2602345101.mp4`），第 1 段的低清预览留下了。
- 那台 `/history` 里这条 job 的三张图都对上了：第 1 段 18 个节点、第 2 段 34 个节点、拼接 4 个节点。
  - 两条片段里都是两套 `LoraLoaderModelOnly`（都接 `['4', 0]`，8 步 @0.75 / 4 步 @0.7），`SelfLiftH3Sampler` 的 `model` = `['75', 0]`、`model_hires` = `['76', 0]`，
    `BasicScheduler.model` = `['75', 0]`，`cfg` 1、`transition_step` 4、`lowres_scale` 0.65、放大器 lms。
  - 第 2 段有 `MiniMaxH3AudioGuideFeather`（刻度 12），正面链路是 `feather ← AddGuide`；第 1 段没有上下文、没有这个节点。
  - 拼接那条读的是 `media_agent_<jobId>_s0.mp4` / `_s1.mp4`，`ConcatenateVideo` 的输入是 `videos.video0` / `videos.video1`。

### 单段（短视频）那一档

`ConcatenateVideo` 只收一个输入（只有一段的短视频会走到）真机上是 `success`，出的片子正常，所以 15 秒以内的短视频也走同一条路。

中途踩到的坑：`ColorTransfer` 的动态下拉子项在 API 格式里得写成 `source_stats.target_index`（照报错里的 `input_name`），写成 `target_index` 会被拦下来。

### 带着参考图跑就炸：`Boolean value of Tensor with more than one value is ambiguous`（2026-10-10 修）

用户 8 秒单段的接力（**带一张参考图**）报「生成视频出错（MiniMaxH3ReferenceToVideo）：Boolean value of Tensor with more than one value is ambiguous」。
那台的 `/history` 里有完整 traceback，指的是插件自己那一行：

```
File "/root/ComfyUI/comfy_extras/nodes_minimax_h3.py", line 297, in execute
    for img in (ref_images or {}).values():
RuntimeError: Boolean value of Tensor with more than one value is ambiguous
```

`current_inputs` 里 `ref_images` 是**一整块 `tensor([...])`**：H3 官方节点的 `ref_images`/`ref_videos`/`ref_video_audios`/`ref_audios` 都是「自动增长」输入
（`io.Autogrow`，前缀 `ref_image_` 等），要**一张一张**写成 `ref_images.ref_image_0`、`ref_image_1`…；我们把参考图串成一条 `ImageTensorList`
按整条 `ref_images` 发过去，节点拿到一块张量，`(ref_images or {})` 一判真假就炸。**没有参考图的跑法碰不到那一行**，所以前几轮真机验证没暴露。

- 修法：接力的图改成 `ref_images.ref_image_<i>` 一张条一项（两遍生成那套保持原样，它那边的 `MMH3ReferenceMultiPrompt` 就是要一整条），
  接力这条也不再接用不着的 `ImageTensorList`；假 ComfyUI 照真的报同一个错，这类回归以后跑测试就能拦住。
- 真机复验（8 秒 1 段、0.4 百万像素 ×2 = 1728×960、一张参考图、8 步）：`done`，成片 1,652,478 字节；那台上那张编码图的输入键是
  `clip, vae, audio_vae, width, height, length, ref_image_size, prompt, ref_images.ref_image_0`（没有整条 `ref_images`）。
  成片留在 `outputs/u37/videos/带参考图-8秒-5065c640.mp4`。

## 调参放开到哪

生成设置小窗「流程」选 SelfLift 接续后能改：总步数、低分辨率跑几步、低分辨率倍数、放大器、**接上一段带几帧**（22/39/90）、**接缝加噪**（0–0.5）、
**偏色对齐强度**（0–1，0 是不对齐）、**接缝声音羽化**（0–256，0 是不接羽化那个节点）、**双 LoRA 双采**两遍各挂哪套 LoRA（各带强度，一键照 U37 填）。
两遍生成那套能改：一采、二采每段几步，**二采重画多少**（0.05–1，原来写死 0.2）。

界面样子见 `docs/reports/selflift-settings.png`。

## 限制

- **不能重拍一截**：没有一采、二采存档，界面上不出现那条，接口也拦。要改后面几段用「**从第 N 段起重出**」（5.34）：
  接力是链式的，换掉第 N 段后面就得跟着重出，所以能选的是「从第 N 段起往后的都重出、前面几段留着」，不能只重出中间一段。
- **接缝的声音只验到「刻度真的起作用」**：0 和 12 出来的音频逐比特不同、同参数可复现，画面也差一个量级；但「12 是不是比 0 好听」得自己听。
  另外画面靠上下文帧接上，声音是每段自己生成的（只有接缝那几帧的声音是钉进去的）。
- **插件要装、还要修**：不装那个羽化插件就把刻度填 0（照样跑）；装了的话作者那版 `compat.py` 在 0.38.0 上不起作用，得按 4 空格修一次。
- **一段最长 15 秒**：和两遍生成一样按 362 帧卡；要更长的片子就多写几段（30 秒写 2 段就会自己分成 3 条接力）。
- 第 2 段起每条开头那几帧是重复上一段的，出片时剪掉，所以「一条能出的新画面」是 `每段帧数 − 上下文帧数`。
- 拼起来用的是原生 `ConcatenateVideo`（已经是编码好的 mp4 就直接接流），所以那几段得是同一套编码参数（同一套流程出的自然是）。
