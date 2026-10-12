# 给生图加编辑能力：开发计划

要解决的问题：**放一张图进去，指定改哪儿，但不用涂抹。**

你已经定的范围：**A 指令编辑**（放图 + 一句话，模型自己找地方改）+ **B 局部重绘**（拖框圈范围，只改框里）+ **涂抹也保留**。

这份是给你审的计划。**你点头之后**，里面的规则我再并进 `docs/dev-plan.md` 的 5.32 / 5.33 和阶段表（P23、P24），然后才动代码。

> **第二版**（按你说的「先别动手」之后又查了一轮，把"我打算…"都换成了真值）。这一版改的：
> - 纠正一处**我上一版写错的地方**：`keep_proportion: 'resize'` 是**按比例缩放、不拉伸**（会拉伸的是 `'stretch'`）。相关的风险条目重写了。
> - 补上 `InpaintCropImproved` 的 25 个必填项和默认值，以及 E05 改过的那三个（3.2b 节）。
> - 查实**掩码走 alpha 通道**（`LoadImage` 的槽 1），一次上传、底图和掩码同源 —— 这一步 dev-plan 5.21 里早就设计好了。
> - 查实 `web/prototype/` 里**没有**掩码编辑器原型，所以 P24 多了一步「先出原型给你看」。
>
> **第三版**（又一轮不动代码的准备）：补了 **§8 接入点清单**——每一步落在哪个文件哪一行都定下来了，另外记了三个实施时要绕开的坑。P23 现在是"照着清单填"，不用边做边找地方。

---

## 1. 现状盘点

### 1.1 我们程序现在有什么

| 能力 | 状态 | 在哪 |
| --- | --- | --- |
| Krea2 文生图 | ✅ | 照实例上 T01 做的 |
| Krea2 四视图（参考图 → 角色三视图/四视图） | ✅ | 照 T10 做的 |
| IL/Pony 放大重绘 | ✅ | |
| IL/Pony 部位重绘（检测器 + SAM） | ✅ | `UltralyticsDetectorProvider` + `SAMLoader` + `FaceDetailer` |
| IL/Pony ControlNet | ✅ | |
| 导入 ComfyUI 工作流 | ✅ | 只填正面/负面/种子/尺寸 |

**没有的**（这次要补的就是这些）：

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 图生图、画风参考、反推（P17） | ❌ 没做 | `docs/reports/` 里没有 `P17.md` |
| **局部重绘（P18）** | ❌ 没做 | 没有 `P18.md`；服务端图片接口只有 `four-view`、建任务、叫停、删、打星、file、thumb、where、reveal、download、image-temp、events，**没有 inpaint**；全仓库 `inpaint` 只出现一次（内置流程的 `force_inpaint: true` 参数，是部位重绘用的） |

`docs/requirements-interview-image.md` 里的原话是「**局部重绘还等涂抹界面的设计**」——所以 P18 当初是**卡在界面原型上没开工**，不是做了一半。

### 1.2 两台实例上有什么

两台跑的是同一套工作流包（都来自 `autodl.art/app/market/252`），所以下面两边一样。

**`T-图像-Krea` 里 13 个**，跟这次相关的：

| 工作流 | 节点数 | 干什么 |
| --- | --- | --- |
| `T07-Krea2图像编辑krea2edit版单图双图` | 18 | **你要的「图像编辑」** |
| `T10-Krea2做剧图像4视图` | 24 | 参考图 → 四视图（我们已经照它做了） |
| `T08-krea2-Controlnet洗图工作流` | 43 | 深度 ControlNet 洗图 |
| `T09-Krea2-Remix-RealCosplay-多功能合集` | 100 | 大合集，含洗图 |
| `T12-k2深度自由迁移带n作者C_C-v1.2` | 46 | 两张参考图，深度迁移换姿势 |

**`E图像-SDXL-IL/E05-局部重绘-手绘遮罩SDXL.json`** —— 局部重绘的现成参考，已经调过。

**自动出掩码的零件齐全**（真机 `object_info` 查的）：

- 文字 → 框：`GroundingDinoModelLoader_SDPose`（带 `GroundingDINO_SwinT_OGC` / `GroundingDINO_SwinB` 两个模型）、`LayerMask: ObjectDetectorYOLOWorld`、`Florence2Run`
- 框 → 精确掩码：`Sam2Segmentation`、`Sam2AutoSegmentation`、`SAM3_Detect` + `SAM3_TrackToMask`
- 掩码 → 重绘：`InpaintCropImproved`、`InpaintModelConditioning`、`InpaintStitchImproved`、`SetLatentNoiseMask`、`LoadImageMask`、`VAEEncodeForInpaint`（全都在）

> 注：**文字自动定位区域**（打一句「她的外套」自动出掩码）你这次没选，零件在，以后想做随时能加。计划里先不做。

---

## 2. A：Krea2 指令编辑

### 2.1 原理（这条决定了为什么不用掩码）

T07 的真实接线（从实例上读的工作流）：

```
UNETLoader(krea2_turbo_int8)
  → LoraLoaderModelOnly(krea2/krea2_identity_edit_v1_1, 1.0)      ← 身份编辑 LoRA
  → Krea2EditModelPatch
        source_latent ← LoadImage → 缩放到目标尺寸 → VAEEncode   ← 你的图，当参考
CLIPLoader(qwen3vl_4b, type=krea2)
  正面 → Krea2EditGroundedEncode(prompt = 你写的话, image = 同一张图)
  负面 → Krea2EditGroundedEncode(prompt = "",      image = 同一张图)
KSampler(latent_image = EmptySD3LatentImage, denoise 1, 8 步, cfg 1)
VAEDecode → SaveImage
```

关键：**`latent_image` 是空潜变量、`denoise 1`**。也就是说它**不是 img2img**，而是「把你的图当参考，从空白重画一张」，改哪儿由模型按你写的话决定 —— **所以不需要掩码，不用涂**。

`Krea2EditGroundedEncode` 里的 "grounded" 是**把参考图喂给 Qwen3-VL 做图文对齐**（`grounding_px` 是喂给视觉编码器的最长边上限），**不是**输出空间掩码。

**和我们现有代码的关系**：`packages/shared/src/krea2.ts` 里「四视图」那档用的就是这两个节点，形状一模一样。所以加「编辑」不是新流程，是**换三处**：

| | 四视图（现在） | 编辑（要加） |
| --- | --- | --- |
| LoRA | `krea2/krea2_4panel.safetensors` | `krea2/krea2_identity_edit_v1_1.safetensors` |
| 指令 | 写死的四视图指令 | **你写的那句话** |
| 参考图缩放 + 出图尺寸 | 1024×1024 / 1536×1024 | 1024×1024 / 1024×1024 |

### 2.2 建议的默认值（照 T07）

| 项 | 值 |
| --- | --- |
| 底模 | `krea2/krea2_turbo_int8_convrot.safetensors` |
| 文字理解模型 | `qwen3vl_4b_uncensored_int8_convrot.safetensors` |
| VAE | `qwen_image_vae.safetensors` |
| LoRA | `krea2/krea2_identity_edit_v1_1.safetensors` @ 1.0 |
| 步数 / CFG / 采样器 / 调度器 | 8 / 1 / euler / simple |
| 尺寸 | 1024×1024 |
| 参考图相似度（`ref_boost`） | 1 |

LoRA 两个版本都在那台上：`krea2_identity_edit_v1_1` 和 `v1_2`。顺带还有一批相关的可以以后接成选项：`krea_outfittransfer`（换装）、`krea2_outpaint_rank32`（扩图）、`Krea2-depth-control-lora`、`Krea2_Anything2RealCharacters`。

### 2.3 要改的地方

| 层 | 改什么 |
| --- | --- |
| `packages/shared/src/types.ts` | `KreaSettings['mode']` 加 `'edit'`；`ImageJob['kind']` 加 `'edit'` |
| `packages/shared/src/krea2.ts` | `kreaDefaults('edit')` 一套值；`kreaGraph` 里把「带参考图的那条路」从 `mode === 'four-view'` 放宽成 `mode !== 'text'`；导出 `EDIT_LORA` 常量 |
| `packages/server/src/routes/validate.ts` | `mode` 的合法值加 `'edit'` |
| `packages/server/src/comfy/jobs.ts` | 编辑也要选参考图（报错文案分开）；`kind` 映射；带参考图就上传那张图（现在写死 `four-view`） |
| `packages/client/src/canvas/GenSettings.tsx` | 「起图」那一排加第三个按钮「编辑」；参考图 + 相似度的区块从 `four-view` 放宽成 `!== 'text'`；两档各自的说明文案 |
| `packages/client/src/canvas/imageActions.ts`、`ImageViewer.tsx` | 组的叫法、大图参数里的「起图」显示「编辑 · 相似度 N」 |
| `tools/mock-comfyui` | 不用改（`Krea2Edit*` 那套已经在了） |

### 2.4 局限（会写进界面提示，不藏着）

因为是从空白重画、`denoise 1`，**你没提到的部分不保证像素不动** —— 背景、姿态、构图可能跟着变一点。人物长相靠身份编辑 LoRA 保住。

要「只改一块、别处一个像素不动」，那是 B 干的事。

---

## 3. B：局部重绘（拖框 + 涂抹）

### 3.1 原理

照实例上 E05 的接线（读出来的）：

```
LoadImage(原图) ─┬─→ 槽0 IMAGE ─┐
                 └─→ 槽1 MASK  ─┤
                                 ↓
                    InpaintCropImproved(裁出遮罩附近一块)
                                 ↓              ↓
                          pixels │              │ stitcher
                                 ↓              │
              CLIPTextEncode(正/负) → InpaintModelConditioning(pixels, mask, noise_mask=true)
                                 ↓
                        KSampler(dpmpp_2m / karras, 28 步, cfg 5.5, denoise 1)
                                 ↓ VAEDecode
                    InpaintStitchImproved(stitcher, 重绘结果) → SaveImage
```

**「遮罩外不动」是这个算法保证的**：只裁遮罩附近一块重画，再拼回原图。算法不用我们发明，实例上已经调好。

### 3.2 掩码怎么给：原图把要重画的地方抠成透明

**这一步 dev-plan 5.21 里早就设计好了**，原话：

> 程序把原图涂过的地方改成透明（只改透明度，颜色照留），存成 PNG 放进临时文件夹，用 `/upload/image` 传上去，`LoadImage` 把透明的地方当遮罩。

E05 的接线正好印证：**只有一个 `LoadImage`**，槽 0 出 IMAGE、槽 1 出 MASK —— 掩码就是那张 PNG 的 **alpha 通道**。所以：

- 不需要 `LoadImageMask`（虽然有）
- **一次上传，一个节点**，底图和掩码同源，天然像素对齐 —— 不会出现"掩码和底图尺寸对不上"这类问题

界面上两种画法，产出的是**同一张 PNG**（要重画的地方 alpha=0）：

| 工具 | 怎么用 | 适合 |
| --- | --- | --- |
| **拖框** | 在图上按住拖一个矩形，可拖动、可缩放手柄 | 「就改这一块」，最常见 |
| **涂抹** | 画笔，笔刷大小可调，能擦、能清空 | 形状不规则（头发、手指这类） |

两个工具**在同一个窗口里切换**，可以叠加用：先拖个框，再拿笔补两下。

### 3.2b E05 用的那串参数（读出来的真值）

`InpaintCropImproved` 一共 25 个必填项（接进来的 `image` 加 24 个参数），E05 里是这么填的（照它的值先跑通）：

| 参数 | E05 的值 | 默认值 |
| --- | --- | --- |
| `downscale_algorithm` | `bilinear` | 同 |
| `upscale_algorithm` | `bicubic` | 同 |
| `preresize` | `false` | 同 |
| `preresize_mode` | `ensure minimum resolution` | 同 |
| `preresize_min_width/height` | `1024` / `1024` | 同 |
| `preresize_max_width/height` | `16384` | 同 |
| `mask_fill_holes` | `true` | 同 |
| **`mask_expand_pixels`** | **`8`** | `0` |
| `mask_invert` | `false` | 同 |
| `mask_blend_pixels` | `32` | 同 |
| `mask_hipass_filter` | `0.1` | 同 |
| `extend_for_outpainting` | `false` | 同 |
| `extend_*_factor` | `1` | 同 |
| `context_from_mask_extend_factor` | `1.2` | 同 |
| `output_resize_to_target_size` | `true` | 同 |
| **`output_target_width/height`** | **`1024` / `1024`** | `512` |
| `output_padding` | `32` | 同 |
| `device_mode` | `cpu (compatible)` | 同 |

比默认值多改的是三处：`mask_expand_pixels` 0→8（掩码往外扩 8 像素），`output_target_width/height` 512→1024（重画那一块按 1024 跑）。**这三个数是给 SDXL 调的，Krea2 那边要不要改，等 P24c 真机看。**

`context_from_mask_extend_factor: 1.2` 是「裁的时候在掩码外多留 20% 上下文」，这就是为什么接缝处能接得上。

### 3.3 要改的地方

| 层 | 改什么 |
| --- | --- |
| `packages/shared/src/types.ts` | `ImageJob['kind']` 加 `'inpaint'`；`ImageJobParams` 加可选的 `inpaint: { mask, denoise }` |
| `packages/shared/src/workflow.ts` | 内置流程加一条 inpaint 分支：`LoadImage(底图) + LoadImageMask(掩码)` → `InpaintCropImproved` → `InpaintModelConditioning` → `KSampler` → `VAEDecode` → `InpaintStitchImproved` |
| `packages/server/src/routes/images.ts` | 新接口 `POST …/images/:jobId/:index/inpaint`，收 `{ mask(base64 PNG), positive, negative, denoise }` |
| `packages/server/src/comfy/jobs.ts` | 掩码 PNG 落盘、底图上传、拼 inpaint 流程、缺插件时说清楚要装 `ComfyUI-Inpaint-CropAndStitch` |
| `packages/client/src/canvas/MaskEditor.tsx`（新建） | **掩码编辑器**：拖框工具 + 画笔工具，画布叠在原图上，出黑白 PNG |
| `packages/client/src/canvas/ImageViewer.tsx` | 大图窗口加「局部重绘」入口，接上编辑器；填要画成什么、重绘强度 |
| `tools/mock-comfyui` | 加 `InpaintCropImproved`、`InpaintModelConditioning`、`InpaintStitchImproved`、`LoadImageMask` 几个节点，能跑通 |
| 测试 | 单测（掩码合成、流程拼接）+ 服务端集成 + e2e（涂一块 → 出图 → mock 收到的 mask 对得上） |

### 3.4 为什么这个比 A 大

A 是「换三个值」，B 是**从零建一条链路**：接口、任务类型、流程、mock、以及**一个全新的画布式编辑器**（拖拽、手柄缩放、画笔、撤销、导出 PNG）。

而且 **P18 当初就是卡在这个编辑器上没开工的**——dev-plan 里 P18 的「开工前」写着「涂抹的界面原型补上」，我刚查了 `web/prototype/`：

- 有 `image-panel.js` / `image-tools.js` / `image-core.js`，`review/img-state-lightbox.jpg` 是「看大图」那一屏
- **没有任何掩码/涂抹的原型**，`review/image-notes.md` 里也只提到「看大图」

所以 **P24a 得先出一个界面原型给你看**，你点头了再写实现。这条是 P18 一直没动的直接原因。

---

## 4. 分几步做、每步的完成标准

| 步 | 做什么 | 完成标准 |
| --- | --- | --- |
| **P23** | A：Krea2 指令编辑 | 界面上「起图」多一档「编辑」；选参考图 + 写一句话能出图；没选参考图时拦住并说清楚；真机跑一张，改的和说的是同一件事；`typecheck` / `vitest` / `e2e` 全绿 |
| **P24a-原型** | B 的掩码编辑器**原型**（`web/prototype` 里加一屏） | 你能在浏览器里点开看：拖框、涂、擦、清空、两工具叠加，看着顺眼才进下一步 |
| **P24a** | B 的掩码编辑器实现 | 大图窗口里能拖框、能涂、能擦清空、能叠加；导出的 PNG 正确（原图尺寸、要重画处 alpha=0、边缘和缩放都对） |
| **P24b** | B 的服务端 + 流程 + 出图 | 拖一个框 → 开始重绘 → 框下面多一组，参数里记着从哪张来；mock 收到的那张 PNG 涂过的地方透明；缺插件时说清楚；e2e 覆盖 |
| **P24c** | B 的真机验证 | 在出图那台真跑一次拖框重绘，确认遮罩外真的没动；顺带定 `output_target_width/height` 和 `mask_expand_pixels` 这两个数 |

**建议顺序**：P23 先做（快，马上能用），P24 单独一轮。每步做完你先看过再进下一步。

---

## 5. 要你拍板的几点

1. **「编辑」档放哪**：我打算和「文生图」「四视图」并排放在 `Krea2 出图设置` 的「起图」那一排（三个按钮）。另一个选择是单独做一个「图像编辑」节点类型——那样更显眼，但要动节点模型，大得多。**默认按前者。**
2. **参考图从哪来**：沿用现有的参考图选择器 —— 可以选**槽位里的图**，也可以选**这个节点出过的图**。够用吗？
3. **拖框和涂抹**：按计划做成同一个窗口里的两个工具（可叠加）。如果你更想要「只有拖框、不要涂抹」，P24a 能省掉画笔那块。
4. **要不要顺便把 P17（图生图 / 画风参考 / 反推）也排进来**：它和 B 在同一批没做的清单里，都要动内置流程和大图窗口。分开做也行，一起做能少改一遍那些文件。

---

## 6. 风险 / 还没验证的

| 风险 | 说明 | 怎么降 |
| --- | --- | --- |
| **编辑档的效果没在真机上验过** | T07 是别人调好的工作流，我们换成程序拼的流程后，出的图好不好只有真跑才知道 | P23 最后一步就是真机跑一张，你看着定 |
| 参考图缩放的取舍 | 四视图现在用 `ImageResizeKJv2` 的 `keep_proportion: 'resize'`——**这个值是按比例缩放、不拉伸**（会拉伸的是 `'stretch'`，我先前记错了）。可选值一共 8 个：`stretch / resize / pad / pad_edge / pad_edge_pixel / crop / pillarbox_blur / total_pixels`。编辑档我打算先照四视图用 `resize`，配合 `Krea2EditModelPatch` 的 `fit_mode: 'fit'`（它自己去对齐到目标网格） | P23 真机对比 `resize` 和 `pad` 两种，选好的那版 |
| 掩码 PNG 的尺寸和坐标 | 编辑器是在**显示尺寸**上画的，传给 ComfyUI 的那张 PNG 必须是**原图像素**尺寸；要重画的地方 alpha=0，颜色照留 | P24a 的单测专门测这个：缩放、非等比、小图放大的情况都要对；再加一条"透明区域的 alpha 真的是 0、不透明区域真的是 255" |
| `InpaintCropImproved` 的参数 | E05 那三个非默认值（`mask_expand_pixels=8`、`output_target=1024×1024`）是给 SDXL 调的 | P24b 先用 E05 的值跑通，P24c 真机再看要不要调 |
| 那两台实例一直在计费 | 出图那台和 5090 那台都开着 | 不用就关；程序里 30 分钟空闲会自动关 |

### 6.1 这一轮又查实的（上一版计划里还是"我打算…"的）

- `ImageResizeKJv2.keep_proportion` 的**全部 8 个可选值**（见上）。
- `Krea2EditModelPatch.fit_mode`：只有 `fit | crop (legacy)`，默认 `fit` —— 和四视图一致，不用改。
- `ref_boost` / `ref_boost_a` 的上限是 **1000**（我们界面卡在 0–10，够用）。
- `EmptySD3LatentImage` 默认 1024×1024、最小 16 —— 编辑档的默认尺寸没问题。
- `InpaintCropImproved` 的 24 个必填项和默认值，以及 E05 改过的那三个（见 3.2b）。
- `InpaintModelConditioning` 要 `positive / negative / vae / pixels / mask / noise_mask(=true)`；`InpaintStitchImproved` 要 `stitcher + inpainted_image`。
- 掩码走 **alpha 通道**（`LoadImage` 的槽 1），不是单独的掩码文件。
- `web/prototype/` 里**没有**掩码编辑器原型。

---

## 7. 这份计划里「查过但没用上」的东西

留个记录，以后想扩的时候不用重新查：

- **文字自动定位区域**（打一句话自动出掩码）：`GroundingDinoModelLoader_SDPose`（SwinT_OGC 694MB / SwinB 938MB）+ `Sam2Segmentation` / `SAM3_Detect` 零件齐全，我们没选做。
- **SelfLift 采样器**（`SelfLiftH3Sampler`）：和我们的「一采 → 放大 → 二采」是两种做法。它是**步数切分**（低清跑前 `transition_step` 步 → 放大 → 高清跑完剩下的），我们是**画完再放大再轻修**。它默认的放大模型就是我们用的那个文件。换它要重搭长视频接缝，不划算。
- **放大模型只能用 H3 那一族**：`conv_in.weight` 必须是 `[512,24,3,3,3]`、24 通道，键名要 `conv_in` / `conv_out` / `in_blocks.*`。下拉里的 LTX / HunyuanVideo 那几个键名不同，**加载就报错**。
- 可用备选 LoRA：`krea_outfittransfer`（换装）、`krea2_outpaint_rank32`（扩图）、`Krea2-depth-control-lora`、`krea2_identity_edit_v1_2`。

---

## 8. 接入点清单（行号级，照这个改就行）

这一节是给实施用的，你不用细看。写完计划后又把代码翻了一遍，把每一步落在哪个文件哪一行都定下来了。

### 8.1 A（Krea2 指令编辑）

| 文件 | 位置 | 改什么 |
| --- | --- | --- |
| `packages/shared/src/types.ts` | `:177` | `KreaSettings['mode']` 加 `'edit'` |
| 同上 | `:262` | `ImageJob['kind']` 加 `'edit'` |
| `packages/shared/src/krea2.ts` | `:18` `kreaDefaults` | 加 `'edit'` 那一档（值见 2.2）；导出 `EDIT_LORA` |
| 同上 | `:49` `kreaGraph` | `const four = mode === 'four-view'` 放宽成 `withRef = mode !== 'text'`；参考图缩放尺寸四视图仍 1024×1024、编辑按出图尺寸 |
| `packages/server/src/routes/validate.ts` | `:202` | `mode` 的合法值加 `'edit'` |
| `packages/server/src/comfy/jobs.ts` | `:216` | 加「编辑还没选参考图」；`:220` 正面词（编辑走 `text.trim()`，现有 else 分支已经对） |
| 同上 | `:344` | `kind` 映射加 `'edit'` |
| 同上 | `:441` | 上传参考图那条从 `mode === 'four-view'` 放宽成 `!== 'text'`（报错文案按档分开） |
| `packages/client/src/canvas/GenSettings.tsx` | `:150-160` | 「起图」那排加第三个按钮；参考图区块从 `krea.mode === 'four-view'` 放宽成 `!== 'text'`；两档各自的 hint |
| `packages/client/src/canvas/imageActions.ts` | `:177` `jobLabel` | 加 `'edit'` → 「编辑」 |
| `packages/client/src/canvas/ImageViewer.tsx` | `:313` | 大图参数里「起图」显示「编辑 · 相似度 N」 |
| `tools/mock-comfyui/src/app.ts` | — | **不用改**：`Krea2EditModelPatch`(`:145`)、`Krea2EditGroundedEncode`(`:146`)、`ImageResizeKJv2`(`:147`)、`LoadImage`(`:168`)、`VAEEncode`(`:165`)、`EmptySD3LatentImage`(`:101`) 都在 |

### 8.2 B（局部重绘）

| 文件 | 位置 | 改什么 |
| --- | --- | --- |
| `packages/shared/src/types.ts` | `:215-237` `ImageJobParams` | 加可选的 `inpaint: { mask: string; denoise: number }`（`mask` 是临时文件夹里那张抠过透明的 PNG） |
| 同上 | `:262` | `ImageJob['kind']` 加 `'inpaint'` |
| `packages/shared/src/workflow.ts` | `:45` `builtinGraph` | 建议**另开一个 `inpaintGraph`**，不塞进 `builtinGraph`：那条路没有空白画布（`:103` 的 `EmptyLatentImage`），用的是 `LoadImage` 的 IMAGE+MASK 两个槽 + `InpaintStitchImproved`，结构差得远 |
| `packages/server/src/routes/images.ts` | `:38` 附近 | 新接口 `POST …/images/:jobId/:index/inpaint`，收 `{ mask(base64), positive, negative, denoise }` |
| `packages/server/src/comfy/jobs.ts` | `:435` `graphMaker` | 按 `params.inpaint` 分派到 `inpaintGraph`；`:452` 的上传那条要加「把抠好的 PNG 传上去」 |
| 同上 | `:433` 注释提到的 `requireNodes` | inpaint 缺插件时要说清楚装 `ComfyUI-Inpaint-CropAndStitch` |
| `packages/client/src/canvas/overlays.ts` | `:45` | `viewer` 旁边加一个 `maskEditor`（哪个节点的哪张图） |
| `packages/client/src/canvas/ImageViewer.tsx` | `:246-269` `.ib-acts-2` | 「局部重绘」入口放「做四视图」(`:268`) 旁边；**照 `:255` 的规矩，Krea2 不给这个按钮**（内置流程的活）。`:270` 的 `RefineForm` 是"点开在下面展开一块"的现成范式，编辑器可以照它 |
| `packages/client/src/canvas/MaskEditor.tsx` | 新建 | 掩码编辑器：拖框 + 画笔，导出"要重画处 alpha=0"的原图尺寸 PNG |
| `tools/mock-comfyui/src/app.ts` | `:85-237` OBJECT_INFO | **要补三个节点**：`InpaintCropImproved`（输出 STITCHER + IMAGE + MASK）、`InpaintModelConditioning`、`InpaintStitchImproved`。mock 现在**一个 Inpaint\* 都没有**；好的是 `LoadImage` 已经输出 `['IMAGE','MASK']`（`:168`），alpha 掩码那条路 mock 天然支持 |

### 8.3 三个坑，实施时注意

1. **`ImageJobParams` 是「同样参数再来」的载体**。inpaint 那组的参数里存的是**掩码文件路径**，所以「同样参数再来」重发时会用同一张掩码 —— 这正是我们要的（dev-plan 10.3 第 15 条也这么写的：「点『只换种子再来』，不用再涂」）。但**临时文件被清掉时要报错**（和补做那条一样的处理）。
2. **掩码 PNG 要落在临时文件夹**，走和出图一样的 `image-temp/当天/`，这样「已清理」那套逻辑自动适用。
3. **`builtinGraph` 的 `uploaded.image` 分支（`:100-103`）是「补做」专用的**（不出新图）。inpaint 也能复用 `uploaded.image`，但输出节点不同（要过 stitcher），别把它和补做混在一起。

