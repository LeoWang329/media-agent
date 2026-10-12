# 真机验证：图像编辑节点走的那条路（2026-10-11）

> 后续说明（2026-10-12）：本报告是旧实例的历史记录。局部重绘黑块的旧诊断已更正，当前 H3 上的修复及 12 组图像回归见 [已知问题回归](known-bugs-regression-20261012.md)。

拿 AutoDL 实例 `pro-79110c14fb03` 验的。这一轮要回答的是「E2 那条指令编辑到底能不能用」——计划里写着身份编辑 v1.1 配 Ostris 这条**没在真机上验过**（`packages/shared/src/krea2.ts` 的 `kreaEditSetup`、`docs/plan-image-edit-node.md`）。

## 机器和接法

| | |
| --- | --- |
| 实例 | `pro-79110c14fb03`（西北 B 区），RTX 5090 D 32 GB，2.78 元/时 |
| ComfyUI | 0.37.0；开机到能调 `/system_stats` 约 50 秒 |
| 接法 | 公网 6006 地址 `https://u131241-79110c14fb03.westd.seetacloud.com:8443`，**不用 SSH 转发**。开机后 SSH 端口和这个域名每次都会变，脚本里要现查（`outputs/devcheck/autodl.mjs`、`comfy.mjs`；**别放 `test-results/`**，playwright 每次跑会把那个目录清空） |
| 走的是哪条路 | 服务端自己的 `POST /api/canvases/:id/nodes/:nid/edit`（`outputs/real/serve.ts` + `verify-edit-node.mjs`），不是手搭的图 |
| LoRA 在哪 | `/root/ComfyUI/models/loras/krea2/`（不在 `autodl-tmp`）；反推的 GGUF 在 `/root/ComfyUI/models/LLM/` |

脚本（都在 gitignore 的 `outputs/real/` 下）：`serve.ts` 起本地服务指向那台、`verify-edit-node.mjs` 走程序自己的编辑节点、`edit-matrix.mjs` 同一张图同一句话只换 LoRA 直接对 ComfyUI 发、`t2i.mjs` 文生图、`montage.py` 拼对照图。

## 一、指令编辑（E2 那条路）能出图 ✅

一张 1024×1024 的写实雨夜站台（我们自己文生图出的），框里写「Change her coat into a bright red leather jacket…」：

- `kind=edit`｜底模 `krea2/moodyAmateurMixKrea2_3JAVStyle_int8`｜文字理解 `qwen3vl_4b_uncensored_int8_convrot`｜LoRA `krea2/krea2_identity_edit_v1_1`@1｜10 步 CFG 1 `euler/simple`
- 正面词**就是框里那句话**，没被加任何触发词（不挂 V3 的效果，符合设计）
- **139 秒**出 2048×2048（原图长边缩到 2048，出图尺寸跟着原图走，面板上的 1024×1536 不管用）
- 红皮衣换上了、雨夜站台/列车/灯光全在

**但是**：原图是**背影**，出图成了**正面**。也就是说这条路的「别的地方不动」靠的是模型自觉，**姿势和景别会漂**。要让姿势也别动，得在提示词里明确写（`keep the same pose and camera angle`），或者用以后那条「深度/姿势迁移」。

## 二、同一张图、同一句话，只换 LoRA（原图是写实咖啡馆人像）

同一个种子 20260220，直接对 ComfyUI 发四组：

| 挂什么 | 指令跟没跟 | 人和构图 |
| --- | --- | --- |
| **不挂 LoRA** | 跟了（红皮衣） | **换了个人**：脸完全不同、景别重排（半身变近景） |
| **身份编辑 v1.1**（E2 用的这条） | 跟了 | 构图保住得多，**脸不是原来那个**；新皮衣**套在原来那件牛仔衬衫外面**（叠穿，不是替换） |
| **换装 outfittransfer** | 跟了 | 人和构图保得最好；同样是叠穿（牛仔+白裙都还在），脸接近原图 |

对照图：`outputs/real/shots/对照-编辑三组.png`（gitignored，四格：原图 / 不挂 / 身份 v1.1 / 换装）。

**结论**：指令编辑挂身份编辑 v1.1 **能用**（不再是「没验过的路」），它确实比不挂 LoRA 稳；但「把衣服换掉」这件事上这条 LoRA 偏保守，会保留原衣服。E4 的「换装」要么换更合适的 LoRA（outfittransfer 稍好一点），要么在提示词里写得更硬（`replace her jacket entirely`）。

## 三、动漫图 → 真人：这一轮**没跑作者那套**

⚠️ **先说清范围**：这一节的五组**全是我们自己编辑档那条路**（`Krea2OstrisEditModelPatch` + `TextEncodeKrea2OstrisEdit` + `euler/simple` + 10 步 + 长边 2048），**没有跑**那台上现成的作者工作流（`Easy_QwenEdit2509` + `beta57`）。所以这里只能得出「**我们这条路配 V3 也能出干净的真人照片**」，得不出「两条路谁更好」。

（用户 2026-10-11 已拍：**E4 的转真人固定参数照作者那套**，就是我们这条只当对照。）

一台动漫女孩（IL 出的雨夜街景），触发词 `transform the image to realistic photograph` + 一句描述，同一个种子，五组对照（`outputs/real/shots/对照-转真人五组.png`）：

| 挂什么 | 结果 |
| --- | --- |
| 不挂 LoRA | 变成照片了，但衣服颜色和细节乱跑（风衣变黄），脸上有块状伪影 |
| 身份编辑 v1.1 | 干净、风衣保住，人变了些 |
| 换装 outfittransfer | 风衣+连帽衫都在，构图接近原图 |
| **动漫转真人 V3（带触发词）** | **最好**：姿势、表情、发型跟原图对得上，脸也像真人 |
| Krea2-realism-V2 | 也干净，偏「可爱的真人」 |

**结论**：作者原流程用的 `Easy_QwenEdit2509` + `beta57` 在**我们这条路**上不是必须的——这条（Ostris patch + `simple` + 10 步 + 长边 2048）配 V3 就能出干净的真人照片。**但 E4 的转真人按用户拍板照作者那套实现**（`Easy_QwenEdit2509` + `beta57` + V3 + `ColorCorrect`），这一节只当「我们那条能跑到什么程度」的对照基线。

## 三点五、那台上的 Krea2 转真人工作流（2026-10-11 核对）

`ls /root/ComfyUI/user/default/workflows/`，Krea2 转真人一共 **7 份**（`docs/krea2-real-usage.md` 第 1 节原来只列了 5 份，已补）：

| 工作流 | 节点 | 反推模型 | 备注 |
| --- | --- | --- | --- |
| `Krea2转真人-作者原版` | 少 | — | 手写提示词、单图 |
| `Krea2转真人-作者原版-双图` | | — | 手写提示词、双图 |
| `Krea2转真人-无审查` | | — | 底模 / 文字理解换去审查那套 |
| **`Krea2转真人-全开关（反推+单双图+手输）`** | 32 | 35B MoE（IQ2_M） | ① 用反推吗 ② 双图吗 + 手输；3 个 `LazySwitchKJ`；**主力那份** |
| `Krea2转真人-反推一体（读备注）` | 24 | 35B MoE | 反推 + 单图 |
| `Krea2转真人-反推一体-双图（读备注）` | 24 | **Qwen3-VL-8B-abliterated Q8** | 反推 + 双图，image2 固定接图 2；提示词写死双图触发词 |
| `Krea2转真人-反推一体-动态（读备注）` | 29 | 35B MoE | 「有第二张人物参考吗」自动切反推指令和人物参考 |

七份共同的骨架（照抄参数）：`UNETLoader(krea2_turbo_fp8_scaled)` → `Lora Loader Stack(V3@1)` → `Krea2OstrisEditModelPatch(kv_cache=true)` → `KSampler(euler, beta57, 8 步, CFG 1, denoise 1)`；两张图都先过 `ColorCorrect(饱和度 −20)` 再 `ImageScaleByAspectRatio V2`（长边 1536、`round_to_multiple None`）；`Easy_QwenEdit2509` 的 `image1` = 图 1 缩放、`image2` = 图 2 缩放、`latent_image` = 图 1 缩放；正负 conditioning 都过 `FluxKontextMultiReferenceLatentMethod(index_timestep_zero)`。

> 用户口述的「**双图双推**那个」我按「双图 + 反推」理解成 `反推一体-双图（读备注）` 或「全开关（② 双图吗 + ① 用反推吗 都开）」，**待确认**。

## 四、作者那套原样跑一遍（E4 的基线）

用户拍板 E4 的转真人照作者那套，所以先照那台上的 **`Krea2转真人-全开关（反推+单双图+手输）`** 手搭一份 API 格式的图（`outputs/devcheck/run-author-real.mjs`，接线和参数从工作流 JSON 里扒的），原样跑两条，当 E4 实现完的对照基线：

- 图 1 = 动漫女孩（IL 出的雨夜街景），图 2 = 写实人像（我们自己文生图出的），种子 20260220
- 底模 / 文字理解走**无审查**那档（`moodyAmateurMixKrea2_3JAVStyle_int8` + `qwen3vl_4b_uncensored_int8_convrot`），V3 LoRA@1，`euler` / `beta57` / 8 步 / CFG 1
- **手输触发词**（`transform the image to realistic photograph, with the character looking exactly like the one in Figure 2.`）：**80 秒**，出 1048×1536（跟着图 1 缩放后的尺寸走）
- **反推开**（35B MoE IQ2_M + mmproj，反推指令取 `docs/krea2-real-reverse-prompt.md` 第 2 段「反推-双图」2919 字）：**38 秒**（模型已经是热的），出图同尺寸
- 对照图：`outputs/real/shots/对照-作者那套双图.png`

两条都出图、场景和衣服（风衣 + 连帽衫）都保住了。**但有个要验的点**：`image2_strength = 1` 时出来的长相**更像图 1 那个角色被真人化**，看不出图 2 那个人的五官——所以 E4 的「图 2 强度」这个旋钮到底有没有用、0.3–0.6 是不是更明显，得在真机上单独试（E4 验收时做）。

## 四点半、E4 落地之后：我们自己这条路跑的四条（2026-10-11）

`outputs/real/verify-edit-real.mjs`（建编辑节点 → PATCH 设置 → `POST /edit`，同一台机器、同一张图 1 / 图 2）：

| 跑法 | 用时 | 尺寸 | 真机上实际提交的图核对过 |
| --- | --- | --- | --- |
| 我们 · 反推 + 双图 | 30 秒 | 1048×1536 | 两个 `LoadImage`、`Easy.image2` 接图 2 那条链、反推指令是「双图」那份 |
| 我们 · 手输 + 双图 | 21 秒 | 1048×1536 | 触发词（含双图那句）自动拼在手输那句前面、**图里一个 `llama_cpp_*` 都没有** |
| 我们 · 换装 | 27 秒 | 1168×2048 | `LoraLoaderModelOnly.lora_name = krea_outfittransfer` |
| 我们 · 指令编辑（回归） | 30 秒 | 1168×2048 | `krea2_identity_edit_v1_1`、正面词就是框里那句 |

四条转真人出来跟作者那套基本一致（真人质感、雨夜街景、风衣 + 连帽衫都保住）。对照图：

- `outputs/real/shots/对照-转真人-作者vs我们.png`（图 1 / 图 2 / 作者手输 / 作者反推 / 我们手输 / 我们反推，六格）
- `outputs/real/shots/对照-换装和指令编辑.png`

**踩到的坑**：第一次跑「双图」时 `Easy_QwenEdit2509.image2` 接的是图 1 ——`POST /edit` 只带 `{fn}`，而服务端原来把请求里的字段当唯一来源（缺的按默认补），把节点上存的「双图」换回了默认的「单图」。已改成**节点上存的设置当底、请求里的字段覆盖**，改完重跑就对了。

**`image2_strength` 三档验过了**（同一张图 1 / 图 2，反推 + 双图，各跑一次）：

| 强度 | 用时 | 出来是什么样 |
| --- | --- | --- |
| **0.3** | 314 秒（反推模型冷启动） | 最像**图 1 真人化**：深色头发、有刘海、脸偏瘦，冷调雨夜街景 |
| **0.6** | 72 秒 | 中间：头发更厚一点、脸略圆 |
| **1.0** | 72 秒 | 明显往**图 2** 靠：**发色变暖变棕**、脸更圆更软、背景偏暖（像图 2 那家咖啡馆的调子） |

对照图：`outputs/real/shots/对照-图2强度三档.png`。

**结论**：这个旋钮**确实有用**，最直观的是**发色和脸型往图 2 靠**、背景调子也跟着变；但它**不是换脸**——1.0 也拿不到图 2 那个人的具体五官（跟调研第 2 节「图 2 带过来的是整颗头、不是只换脸」一致）。要看出明显的「像谁」，图 2 得挑一张特征差别大的（比如换个发色），否则两张都是深发色、差别本来就不大。

**还没做**：如果用户想要「真像图 2 那个人」，得另找路子（人物 LoRA 或者 ReID），这一档只到「气质/发色/脸型靠近」。

## 四点六、六个功能各跑一遍（2026-10-12）

`outputs/real/verify-edit-real.mjs`（建编辑节点 → PATCH 设置 → `POST /edit`），同一台机器：

| 功能 | 用时 | 结果 | 出图 |
| --- | --- | --- | --- |
| 深度迁移 | 36 秒 | 1024×1024，接线跟摸出来的 `w3-depth.json` 一致 | `F-深度迁移.png` |
| 风格 Remix | 27 秒 | 1024×1024，`reid_rank32` 那条 | `F-风格Remix.png` |
| 放大 / 高清 | 9 秒 | 1024×1024 → 2048×2048 | `F-放大高清.png` |
| 四视图 | 42 秒 | 1536×1024，`krea2_4panel` 挂上了 | `F-四视图.png` |
| 指令编辑（回归） | 30 秒 | 正常 | 之前那几张 |
| **局部重绘** | 21–40 秒 | ✗ **要重画那块是纯黑的** | `F-局部重绘*.png` |

### 局部重绘这块黑的，查到哪一步

1. **掩码是对的**：在那台上单独跑 `LoadImage → (PreviewImage, MaskToImage)` 探针，白框正好落在抠掉的位置（`LoadImage` 的 MASK = 1 − alpha）。
2. **原设计有个坑**：E05 那条图是「一张 PNG 同时当底图和掩码」。ComfyUI 的 `LoadImage` 会把 RGBA **按 alpha 合成到黑底**，所以 alpha=0 那块在底图里永远是黑的 —— 把框里 RGB 填成中灰再跑，出来**还是黑**（说明是它合成的，不是我们的文件）。
3. **改成「底图和掩码分两张传」也不行**：`inpaintGraph` 现在生成两个 `LoadImage`（真机上确认过：`#5` 是原图、`#6` 是掩码，`InpaintCropImproved(image=#5, mask=#6)`），出图**还是黑块**；而且换 seed、denoise 0.85 → 1，出图**逐字节一样** → 生成结果根本没落到那块上。
4. **结论**：问题在 E05 这条流程本身，不在我们传的东西。`docs/reports/P24.md` 当时只验了「遮罩外 827927 个像素一个都没动」，**没验「遮罩里画成了什么」**。
5. **下一步**（没做）：查 `InpaintCropImproved` / `InpaintStitchImproved` 的出入参（`preresize`、`output_target_width/height`、stitch 那份 mask 的语义），或者换一条 inpaint 流程（比如 `VAEEncodeForInpaint` 那条）。

## 五、E7 那三样（扩图 / 深度姿势 / 风格 Remix）在那台上齐不齐

- 节点：`Krea2OstrisEditModelPatch`、`TextEncodeKrea2OstrisEdit`、`Krea2EditModelPatch`、`Krea2EditGroundedEncode`、`LayerUtility: ImageScaleByAspectRatio V2`、`GetImageSize`、`Easy_QwenEdit2509`、`llama_cpp_model_loader` / `llama_cpp_parameters` / `llama_cpp_instruct_adv` —— **都在**
- LoRA：`krea2/krea2_outpaint_rank32`（扩图）、`krea2/Krea2-depth-control-lora`（深度）、`krea2/Krea2_Remix_RealCosplay_rank64_v1` + `krea2/krea2_reid_rank32`（Remix / 换人）—— **都在**
- 反推：`Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf` + `mmproj-Qwen3.6-…-f16.gguf` —— 都在 `models/LLM/`
- ControlNet：只有 Qwen-Image 那两套（`Qwen-Image-ControlNet-Union`、`Qwen-Image-InstantX-ControlNet-Union`）和 Flux/Wan/H3 的；**没有 SDXL 的 openpose/depth**。所以「深度 / 姿势迁移」要走 Krea2 那边（depth LoRA + Qwen-Image ControlNet），不要按 SDXL 那套想
- 盘：30 G 用了 18 G，剩 13 G

**没做**：扩图 / 深度 / Remix 三条的**工作流本身**还没在那台上摸（E7 的正事）。这一轮只把「东西齐不齐」盘清了。

## 六、下一轮要用的

1. 开机后先 `node outputs/devcheck/autodl.mjs snapshot <uuid>` 现查 SSH 和 6006 域名，别写死。
2. 出图慢的时候先看 `/history` 里 `status_str`，报错原话在那个 JSON 里。
3. 这台是**生成视频**那台（工作文件夹 `settings.json` 里 `videoAutodl` 指的是它）；出图那台是 `pro-7909216ef7bf`（`zealman-ComfyUI`，vGPU-32GB，之前开机报「当前算力规格暂无库存」）。要按程序自己那套开机流程验，得先确认出图那台有没有库存。
