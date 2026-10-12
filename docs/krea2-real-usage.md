# Krea2 图转真人 · 用法与实现规格

> 把动漫 / 插画 / 2D 图转成**真人照片**，人物的长相、构图、场景尽量保住。
> 作者原件：[Krea2_Anything2RealCharacters-V3-Workflows](https://civitai.com/models/2881049)（`krea2_v10.json`）。
> 已在 AutoDL 实例 `pro-79110c14fb03`（ComfyUI 0.37.0）上装好、跑通、逐项验过。
> **这份文档同时给人和 AI 用**：节点类型、参数、接线、接口格式、以及"为什么这么接"都写全了。

---

## 1. 用哪个

ComfyUI → 左边「工作流」列表：

| 工作流 | 什么时候用 |
| --- | --- |
| **Krea2转真人-全开关（反推+单双图+手输）** | **主力**。三个开关控制：用不用反推 / 单图还是双图 / 手输提示词 |
| Krea2转真人-作者原版 | 手写提示词、单图（保真最好，作者原始参数） |
| Krea2转真人-作者原版-双图 | 手写提示词、双图 |
| Krea2转真人-无审查 | 同「作者原版」，但底模 / 文字理解换成去审查那套（见第 7 节） |
| Krea2转真人-反推一体（读备注） | 反推 + 单图，无反推开关（image2 物理上没接） |
| Krea2转真人-反推一体-双图（读备注） | 反推 + 双图，**image2 固定接图 2**；反推模型是 **Qwen3-VL-8B-abliterated Q8**（不是 35B MoE）；提示词里写死双图触发词 |
| Krea2转真人-反推一体-动态（读备注） | 反推 + 「**有第二张人物参考吗**」自动切：切反推指令（单图 / 双图两套备注）和人物参考那张；反推模型是 35B MoE |

> 2026-10-11 从实例上 `ls /root/ComfyUI/user/default/workflows/` 核对过：上面 7 份都在（后两份是这份文档写完之后加的）。

## 2. 双图怎么用

### 两张图分别管什么

| 放哪 | 传什么 | 管什么 |
| --- | --- | --- |
| 上面的 `LoadImage`（**图 1 · 场景姿势**） | 要转的那张动漫 / 插画图 | 构图、姿势、场景，**并且决定出图尺寸** |
| 下面的 `LoadImage`（**图 2 · 人物**） | 真人参考图 | 长相（identity） |

### 步骤

1. 打开 **`Krea2转真人-全开关（反推+单双图+手输）`**
2. 上面那个 `LoadImage` → 选**要转的图**
3. 下面那个 `LoadImage` → 选**真人参考图**
4. 看 **② 双图吗**：开着（默认）
5. 点 Queue

### 一句话

> 图 1 决定「长什么样、什么姿势、什么场景」，图 2 决定「是谁」。

### ⚠️ 图 2 会把「整颗头」带过来，不是只换脸

这是这条路**固有的**：图 2 是当**参考潜变量**整个喂进去的，模型看到的是"整个人"。实测过——提示词里明写 `silver hair` 也压不住，图 2 的**发色、发型、帽子、耳环**全都会跟过来。

**这不是 bug，也没法用提示词修。** 要"只换脸"得靠换脸节点（像素级贴脸），那是另一条路。

### 🎛 图 2 说话有多大声：`image2_strength`

`Easy_QwenEdit2509` 上有三个可选权重：`image1_strength` / `image2_strength` / `image3_strength`，**FLOAT，默认 1，范围 0–10**，已经在工作流里放开了。

**`image2_strength` 就是「图 2 的影响力」**，实测（同一张图 1、同一张图 2）：

| `image2_strength` | 实测效果 |
| --- | --- |
| **1.0**（默认） | 图 2 全盘接管：**粉发 + 绿贝雷帽 + 金耳环**全过来 |
| **0.6** | **混合**：银色为主（图 1），后侧带粉色，帽子没了 |
| **0.0** | 图 1 为主：**银色**，只残留一缕粉 —— 0 也没能 100% 抹干净 |

**所以它是一个连续的"像图 2 多少"的旋钮。** 想要"脸有点像图 2、发型还是自己的"，就在 **0.3–0.6** 之间试。

## 3. 全开关工作流（主力那份）

三个控件，互不干扰：

| 控件 | 作用 |
| --- | --- |
| **① 用反推吗**（布尔） | 开 = 提示词取**反推模型的输出**；**关 = 取「手输提示词」那一栏** |
| **② 双图吗**（布尔） | 开 = `image2` 取**图 2**、反推用「反推-双图」那套指令；关 = `image2` 取**图 1**（你选的图 2 一定不会被用到）、用「反推-单图」指令 |
| **手输提示词** | ①关掉时生效，预填的是作者那句 |

### ⚡ 关键实现：惰性开关（`LazySwitchKJ`）

三个开关用的都是 **`LazySwitchKJ`**（ComfyUI-KJNodes），不是 ComfyUI 那种普通 switch。

**为什么必须用它**：它的 `on_true` / `on_false` 是 **lazy 输入**（`{"lazy": true}`），**没被选中的那一边根本不会被求值**。所以：

- **反推关掉时，反推整条链（loader / parameters / instruct / 两个备注）完全不执行** —— 不加载模型、不推理
- **双图关掉时，图 2 那条链（LoadImage → ColorCorrect → 缩放）完全不执行**

**实测证据**（ComfyUI 日志里 llama.cpp 生成 token 的痕迹 `find_slot` 条数）：

| 组合 | 耗时 | `find_slot` 条数 | 结论 |
| --- | --- | --- | --- |
| 反推开 · 单图 | 39 秒 | 18 | 反推执行 |
| 反推开 · 双图 | 61 秒 | 18 | 反推执行 |
| **反推关 · 单图** | **30 秒** | **0** | **反推链完全没执行** ✅ |
| **反推关 · 双图** | **30 秒** | **0** | **反推链完全没执行** ✅ |

（ComfyUI 自带的 `ComfySwitchNode` 也是惰性的，但输出是 matchtype，接口格式没 KJ 这个省事。）

### 🕳 一个必踩的坑：显示节点不能接在反推输出上

**`ShowText` / `PreviewAny` 这类是「输出节点」，ComfyUI 为了喂它会把它的上游强行拉起来执行。**

如果把显示节点接在**反推节点的输出**上，那么**每次都会跑反推**，惰性开关等于白装。

**正确接法：显示节点接在「开关的输出」上**（现在那份就是这么接的，标题叫「实际用到的提示词」，反而更好用——显示的就是最终喂给模型的那句）。

### 单图模式下的 `image2`

单图模式时 `image2` 接的是**图 1 自己**（用 `LazySwitchKJ` 的 `on_false` 支路），不是"物理断开"。

- 你选的**图 2 一定不会被用到** ✅
- 等价于"同一张参考喂了两遍"，实测正常
- 要**物理断开**的干净状态，用 `Krea2转真人-反推一体（读备注）`（那份 `image2` 根本没连）

**原因**：ComfyUI 里没有能输出"空 IMAGE"的节点，开关的两个分支都必须有东西。

### 反推那一侧

- 模型：**`Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf`** + **`mmproj-Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-f16.gguf`**，`chat_handler = Qwen3.6`（MoE 只激活 3B，比 27B 快）
- 两个备注框：「**反推-单图**」「**反推-双图**」，就是给反推模型的系统提示词，`WorkflowNotes` 节点按**标题前缀**（`反推`）收集
- `max_size = 1536`（图缩到 1536 再喂给 VLM，越大看得越细越慢）
- `force_offload = false`（跑完不卸载）
- **反推不常驻显存**：跑过一次之后显存大约多留 5GB 不释放（15.8GB → 20.6GB）；要彻底释放得重启 ComfyUI

## 4. 提示词

### 主触发词（必须放最前面，一个字都别改）

```
transform the image to realistic photograph
```

### 双图触发词（双图时才加）

```
with the character looking exactly like the one in Figure 2.
```

**⚠️ 反推关掉 + 用双图时，这句要你自己写进「手输提示词」框里** —— 因为它是反推生成的，反推一关就没了。

### 可选辅助词（作者训练时带进去的）

| 类别 | 词 |
| --- | --- |
| 视角 / 面部 | `looking at camera`、`look down`、`unfocused face` |
| 光影 / 滤镜 | `backlight`、`Film filter`、`hazy` |
| 画质 | `photorealistic`、`highly detailed` |
| 服饰 | `black stockings`、`white stockings` |
| 解剖细节 | `pubic hair`、`labia` |
| 人物特征 | `caucasian`、`woman`、`man`、`muscular` |

### 🕳 词表不能整个塞给反推模型（会照抄）

实测踩过：把上面这张**完整词表**（尤其"服饰"和"解剖细节"）写进反推的系统提示词，**模型会把它们照抄一遍**——图里明明没有黑丝、没有裸露，它也会写 `black stockings` / `pubic hair` / `labia`。加一句"没有就别写"**不管用**。

**正确做法（已在备注里）：**

| 类别 | 给不给词表 |
| --- | --- |
| **风格 / 方向**（`looking at camera`、`backlight`、`photorealistic`…） | ✅ 可以给 —— 它们描述的是"转成什么照片"，不是"图里有什么" |
| **内容**（性别、体型、穿什么、有没有裸露、解剖细节） | ❌ **不给** —— 必须照画面写，给了必抄 |

NSFW 部分也一样：**不给示例词**，只说"画面里真有裸露/性暗示的照实写、不要回避、不要说 cannot"，去审查模型自己会写出来。

### 反推里还有一条：复杂画面要逐项扫

**这是这套流程最容易翻车的地方。** 参考图被压到 1MP、VLM 只看 384×384 缩略图，**细节传不过去**，所以必须靠文字补。备注里要求按 7 项逐项扫：

1. 主体（几个人、姿势、表情）2. 长相（发色 / 发长 / 发型 / 瞳色 / 年龄感）3. 服装**一件一件写**（颜色 + 材质 + 配饰）4. 构图（机位 / 景别 / 位置占比）5. 环境**逐件点名**（家具、道具、墙上、桌上、窗里窗外）6. 光（方向 / 颜色 / 影子 / 质感）7. 材质（布料 / 皮肤 / 头发 / 金属）

**简单特写 40 词，复杂场景写到 80 词上限。**

## 5. 参数：照抄，别动

| 位置 | 值 | 为什么 |
| --- | --- | --- |
| `Krea2OstrisEditModelPatch` → `kv_cache` | **开（true）** | 作者原话：关掉会 "severe loss of image consistency"，出糊图 / 坏图 |
| `KSampler` | **8 步 / CFG 1 / `euler` / `beta57` / denoise 1** | 调度器是 `beta57`，**不是**习惯上的 `simple` |
| `LayerUtility: ImageScaleByAspectRatio V2` | `longest` / **1536** / `round_to_multiple = None` / `crop` / `lanczos` | 长边，作者建议 1024–2048 |
| `ColorCorrect` | 饱和度 **−20**（其余 0，gamma 1） | 作者实测：输入图先降饱和，最终写实度明显提升 |
| `Lora Loader Stack` | `Krea2_Anything2RealCharacters-V3` 强度 **1** | 作者建议 0.8–1.0 |
| `Easy_QwenEdit2509` | `auto_resize = crop`、`vl_size = 384` | 别改 |
| `Easy_QwenEdit2509` → `image2_strength` | 默认 1，**可调 0–10** | 见第 2 节 |

**出图尺寸不用设** —— 它跟着缩放后的**图 1** 走（长边 1536、按原图比例、16 的倍数）。KSampler 上本来就没有宽高可填。

## 6. 想加人物 LoRA

在 `Lora Loader Stack (rgthree)` 的**第 2 槽**（现在是 `None`）加上，强度先填 **0.6**。

**硬前提：必须是 Krea2 家族的 LoRA。** Krea2 是 Qwen-Image 系架构，**SDXL / Illustrious / Pony 的 LoRA 挂上去完全不生效**。

那台上现成的 Krea2 LoRA 有 29 个，人物向的：`krea2/krea2_identity_edit_v1_1`（专管锁长相）、`v1_2`、`krea2-Cc风情万种-人像`、`Krea2_Remix_RealCosplay_rank64_v1`、`Krea2_DreamCos_Realism`、`Nick_baotunqun_Krea2`。

**注意三点：**

1. **位置**：LoRA 在 `Krea2OstrisEditModelPatch` **之前**（作者那套就是这么接的）
2. **它也影响文字理解**：这个 stack 的 **clip 输出接到了 `Easy_QwenEdit2509`**，所以 LoRA 同时作用于模型和 CLIP
3. **会跟参考图抢**：单图模式长相来自图 1、双图来自图 2（都是很强的参考潜变量），人物 LoRA 是叠加影响，**结果是混合**。强度到 1.0 容易跟 V3 转真人 LoRA 打架 → 花图 / 糊图。**两个 LoRA 同时挂，总强度别顶满**
4. **触发词要写进提示词**才吃满效果（反推的备注里加一句，或者手输时自己带上）

**想"指定某个具体的人"，图 2（配 `image2_strength`）比 LoRA 直接得多。** LoRA 是次要手段。

## 7. 想更松（NSFW）

打开 **`Krea2转真人-无审查`**，接线一模一样，只是这两处换了：

| | 作者原版 | 无审查 |
| --- | --- | --- |
| 底模 | `krea2/krea2_turbo_fp8_scaled.safetensors` | `krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors` |
| 文字理解 | `qwen3vl_4b_fp8_scaled.safetensors`（官方，有安全对齐） | `qwen3vl_4b_uncensored_int8_convrot.safetensors` |

也可以只换其中一个：只把 `CLIPLoader` 换成去审查那个，底模保持官方 Turbo（保真更好）。

## 8. 出问题了怎么看

| 症状 | 多半是 | 怎么办 |
| --- | --- | --- |
| **出图跟原图完全是两张图** | 编码节点被换成了别的（比如 Ostris 自带示例里的 `TextEncodeKrea2OstrisEdit`）。那个节点会把参考图**压到 1MP 以内**，跟生成图网格对不上，参考图就使不上劲 | 确认用的是 `Easy_QwenEdit2509`，接线照附录 A |
| 图发糊 / 发花 | `kv_cache` 被关了 | 打开 |
| 出图比原图暗 / 灰 | `ColorCorrect` 被删了或被改了 | 饱和度 −20、其余 0、gamma 1 |
| 报缺节点 | 少装插件 | 装下面的两个，重启 |
| 人物不像图 2 | 作者标注这是**实验性**功能 | 调高 `image2_strength`；换种子；两张图的人物朝向尽量接近 |
| **人物太像图 2（头发帽子都被带走）** | 这是固有行为 | **调低 `image2_strength`（0.3–0.6 试）** |
| **反推关掉但还是很慢** | 显示节点被接在反推输出上了，把惰性开关废了 | 显示节点改接**开关的输出**（见第 3 节） |
| 反推写出一堆图里没有的词 | 词表整个塞进系统提示词了 | 按第 4 节拆开：风格词给、内容不给 |

## 9. 地址

| 东西 | 地址 |
| --- | --- |
| 工作流原件 | https://civitai.com/models/2881049 |
| LoRA（V3） | https://civitai.com/models/2808492 |
| 作者主页 | https://civitai.com/user/AIGC_Singularity |
| 必装节点 1 | https://github.com/cardenluo/easy_qwenEdit_2509 |
| 必装节点 2 | https://github.com/ostris/ComfyUI-Krea2-Ostris-Edit |
| 官方底模 | https://huggingface.co/Comfy-Org/Krea-2 |

---

## 附录 A：单图完整接线

### 节点

| 节点 | 类型 | 参数 |
| --- | --- | --- |
| 215 | `UNETLoader` | `krea2/krea2_turbo_fp8_scaled.safetensors` `default` |
| 216 | `CLIPLoader` | `qwen3vl_4b_fp8_scaled.safetensors` `krea2` `default` |
| 217 | `FluxKontextMultiReferenceLatentMethod` | `index_timestep_zero` |
| 218 | `FluxKontextMultiReferenceLatentMethod` | `index_timestep_zero` |
| 219 | `Krea2OstrisEditModelPatch` | `true` |
| 220 | `Easy_QwenEdit2509` | `crop` `384` `transform the image to realistic photograph` `Describe the key features of the input image (color, shape, size, texture, objects, background), then explain how the user's text instruction should alter or modify the image. Generate a new image that meets the user's requirements while maintaining consistency with the original input where appropriate.` |
| 221 | `KSampler` | `892624666372231` `randomize` `8` `1` `euler` `beta57` `1` |
| 222 | `VAELoader` | `qwen_image_vae.safetensors` |
| 224 | `VAEDecode` | — |
| 缩放（图 1） | `LayerUtility: ImageScaleByAspectRatio V2` | `original` `1` `1` `crop` `lanczos` `None` `longest` `1536` `#000000` |
| **图 1 · 场景姿势** | `LoadImage` | `005.jpg` `image` |
| 228 | `SaveImage` | `Krea2转真人-作者原版` |
| 236 | `Lora Loader Stack (rgthree)` | `krea2/Krea2_Anything2RealCharacters-V3.safetensors` `1` `None` `1` `None` `1` `None` `1` |
| ColorCorrect（图 1） | `ColorCorrect` | `0` `0` `0` `0` `-20` `1` |

### 接线

| 从 | 到 | 类型 |
| --- | --- | --- |
| `Easy_QwenEdit2509` | `FluxKontextMultiReferenceLatentMethod` → **conditioning** | CONDITIONING |
| `Easy_QwenEdit2509` | `FluxKontextMultiReferenceLatentMethod` → **conditioning** | CONDITIONING |
| `VAELoader` | `Easy_QwenEdit2509` → **vae** | VAE |
| `FluxKontextMultiReferenceLatentMethod` | `KSampler` → **positive** | CONDITIONING |
| `FluxKontextMultiReferenceLatentMethod` | `KSampler` → **negative** | CONDITIONING |
| `Easy_QwenEdit2509` | `KSampler` → **latent_image** | LATENT |
| `KSampler` | `VAEDecode` → **samples** | LATENT |
| `VAELoader` | `VAEDecode` → **vae** | VAE |
| `Krea2OstrisEditModelPatch` | `KSampler` → **model** | MODEL |
| `VAEDecode` | `SaveImage` → **images** | IMAGE |
| `LayerUtility: ImageScaleByAspectRatio V2` | `Easy_QwenEdit2509` → **image1** | IMAGE |
| `LayerUtility: ImageScaleByAspectRatio V2` | `Easy_QwenEdit2509` → **latent_image** | IMAGE |
| `UNETLoader` | `Lora Loader Stack (rgthree)` → **model** | MODEL |
| `CLIPLoader` | `Lora Loader Stack (rgthree)` → **clip** | CLIP |
| `Lora Loader Stack (rgthree)` | `Easy_QwenEdit2509` → **clip** | CLIP |
| `Lora Loader Stack (rgthree)` | `Krea2OstrisEditModelPatch` → **model** | MODEL |
| `LoadImage` | `ColorCorrect` → **image** | IMAGE |
| `ColorCorrect` | `LayerUtility: ImageScaleByAspectRatio V2` → **image** | IMAGE |

## 附录 B：双图相对单图的增量

只多三个节点、三条线，其它一字未改：

| 新增 | 类型 | 参数 |
| --- | --- | --- |
| **图 2 · 人物** | `LoadImage` | 真人参考图 |
| ColorCorrect（图 2） | `ColorCorrect` | `0` `0` `0` `0` `-20` `1` |
| 缩放（图 2） | `LayerUtility: ImageScaleByAspectRatio V2` | `original` `1` `1` `crop` `lanczos` `None` `longest` `1536` `#000000` |

接线：`LoadImage` → `ColorCorrect` → `LayerUtility: ImageScaleByAspectRatio V2` → **`Easy_QwenEdit2509.image2`**

## 附录 C：全开关工作流的开关接线

| 从 | 到 | 类型 |
| --- | --- | --- |
| `反推（按备注写）` | `提示词取哪边（真·惰性）` → **on_true** | STRING |
| `手输提示词（①关掉时用它）` | `提示词取哪边（真·惰性）` → **on_false** | STRING |
| `① 用反推吗` | `提示词取哪边（真·惰性）` → **switch** | BOOLEAN |
| `提示词取哪边（真·惰性）` | `Easy_QwenEdit2509` → **prompt** | STRING |
| `读备注：反推-双图` | `反推用哪套指令` → **on_true** | STRING |
| `读备注：反推-单图` | `反推用哪套指令` → **on_false** | STRING |
| `② 双图吗` | `反推用哪套指令` → **switch** | BOOLEAN |
| `反推用哪套指令` | `反推（按备注写）` → **system_prompt** | STRING |
| `LayerUtility: ImageScaleByAspectRatio V2` | `人物参考取哪张` → **on_true** | IMAGE |
| `LayerUtility: ImageScaleByAspectRatio V2` | `人物参考取哪张` → **on_false** | IMAGE |
| `② 双图吗` | `人物参考取哪张` → **switch** | BOOLEAN |
| `人物参考取哪张` | `Easy_QwenEdit2509` → **image2** | IMAGE |
| `提示词取哪边（真·惰性）` | `实际用到的提示词` → **text** | STRING |

节点清单（除开关外和附录 A 一样）：

| 节点 | 类型 | 作用 |
| --- | --- | --- |
| 读备注：反推-单图 | `WorkflowNotes` | 读备注：反推-单图 |
| 读备注：反推-双图 | `WorkflowNotes` | 读备注：反推-双图 |
| ① 用反推吗 | `LayerUtility: Boolean` | ① 用反推吗 |
| ② 双图吗 | `LayerUtility: Boolean` | ② 双图吗 |
| 手输提示词（①关掉时用它） | `PrimitiveStringMultiline` | 手输提示词（①关掉时用它） |
| 提示词取哪边（真·惰性） | `LazySwitchKJ` | 提示词取哪边（真·惰性） |
| 反推用哪套指令 | `LazySwitchKJ` | 反推用哪套指令 |
| 人物参考取哪张 | `LazySwitchKJ` | 人物参考取哪张 |
| 反推模型（35B MoE 去审查） | `llama_cpp_model_loader` | 反推模型（35B MoE 去审查） |
| 351 | `llama_cpp_parameters` |  |
| 反推（按备注写） | `llama_cpp_instruct_adv` | 反推（按备注写） |
| 实际用到的提示词 | `ShowText|pysssss` | 实际用到的提示词 |

## 附录 D：接口格式（要重装或程序化调用时用）

单图：

```json
{
 "215": {
  "class_type": "UNETLoader",
  "inputs": {
   "unet_name": "krea2/krea2_turbo_fp8_scaled.safetensors",
   "weight_dtype": "default"
  }
 },
 "216": {
  "class_type": "CLIPLoader",
  "inputs": {
   "clip_name": "qwen3vl_4b_fp8_scaled.safetensors",
   "type": "krea2",
   "device": "default"
  }
 },
 "217": {
  "class_type": "FluxKontextMultiReferenceLatentMethod",
  "inputs": {
   "conditioning": [
    "220",
    0
   ],
   "reference_latents_method": "index_timestep_zero"
  }
 },
 "218": {
  "class_type": "FluxKontextMultiReferenceLatentMethod",
  "inputs": {
   "conditioning": [
    "220",
    1
   ],
   "reference_latents_method": "index_timestep_zero"
  }
 },
 "219": {
  "class_type": "Krea2OstrisEditModelPatch",
  "inputs": {
   "model": [
    "236",
    0
   ],
   "kv_cache": true
  }
 },
 "220": {
  "class_type": "Easy_QwenEdit2509",
  "inputs": {
   "clip": [
    "236",
    1
   ],
   "vae": [
    "222",
    0
   ],
   "image1": [
    "225",
    0
   ],
   "latent_image": [
    "225",
    0
   ],
   "auto_resize": "crop",
   "vl_size": 384,
   "prompt": "transform the image to realistic photograph",
   "system_prompt": "Describe the key features of the input image (color, shape, size, texture, objects, background), then explain how the user's text instruction should alter or modify the image. Generate a new image that meets the user's requirements while maintaining consistency with the original input where appropriate."
  }
 },
 "221": {
  "class_type": "KSampler",
  "inputs": {
   "model": [
    "219",
    0
   ],
   "positive": [
    "217",
    0
   ],
   "negative": [
    "218",
    0
   ],
   "latent_image": [
    "220",
    2
   ],
   "seed": 892624666372231,
   "steps": 8,
   "cfg": 1,
   "sampler_name": "euler",
   "scheduler": "beta57",
   "denoise": 1
  }
 },
 "222": {
  "class_type": "VAELoader",
  "inputs": {
   "vae_name": "qwen_image_vae.safetensors"
  }
 },
 "224": {
  "class_type": "VAEDecode",
  "inputs": {
   "samples": [
    "221",
    0
   ],
   "vae": [
    "222",
    0
   ]
  }
 },
 "225": {
  "class_type": "LayerUtility: ImageScaleByAspectRatio V2",
  "inputs": {
   "image": [
    "237",
    0
   ],
   "aspect_ratio": "original",
   "proportional_width": 1,
   "proportional_height": 1,
   "fit": "crop",
   "method": "lanczos",
   "round_to_multiple": "None",
   "scale_to_side": "longest",
   "scale_to_length": 1536,
   "background_color": "#000000"
  }
 },
 "227": {
  "class_type": "LoadImage",
  "inputs": {
   "image": "{{图 1}}",
   "upload": "image"
  }
 },
 "228": {
  "class_type": "SaveImage",
  "inputs": {
   "images": [
    "224",
    0
   ],
   "filename_prefix": "Krea2转真人-作者原版"
  }
 },
 "236": {
  "class_type": "Lora Loader Stack (rgthree)",
  "inputs": {
   "model": [
    "215",
    0
   ],
   "clip": [
    "216",
    0
   ],
   "lora_01": "krea2/Krea2_Anything2RealCharacters-V3.safetensors",
   "strength_01": 1,
   "lora_02": "None",
   "strength_02": 1,
   "lora_03": "None",
   "strength_03": 1,
   "lora_04": "None",
   "strength_04": 1
  }
 },
 "237": {
  "class_type": "ColorCorrect",
  "inputs": {
   "image": [
    "227",
    0
   ],
   "temperature": 0,
   "hue": 0,
   "brightness": 0,
   "contrast": 0,
   "saturation": -20,
   "gamma": 1
  }
 }
}
```

双图：

```json
{
 "215": {
  "class_type": "UNETLoader",
  "inputs": {
   "unet_name": "krea2/krea2_turbo_fp8_scaled.safetensors",
   "weight_dtype": "default"
  }
 },
 "216": {
  "class_type": "CLIPLoader",
  "inputs": {
   "clip_name": "qwen3vl_4b_fp8_scaled.safetensors",
   "type": "krea2",
   "device": "default"
  }
 },
 "217": {
  "class_type": "FluxKontextMultiReferenceLatentMethod",
  "inputs": {
   "conditioning": [
    "220",
    0
   ],
   "reference_latents_method": "index_timestep_zero"
  }
 },
 "218": {
  "class_type": "FluxKontextMultiReferenceLatentMethod",
  "inputs": {
   "conditioning": [
    "220",
    1
   ],
   "reference_latents_method": "index_timestep_zero"
  }
 },
 "219": {
  "class_type": "Krea2OstrisEditModelPatch",
  "inputs": {
   "model": [
    "236",
    0
   ],
   "kv_cache": true
  }
 },
 "220": {
  "class_type": "Easy_QwenEdit2509",
  "inputs": {
   "clip": [
    "236",
    1
   ],
   "vae": [
    "222",
    0
   ],
   "image1": [
    "225",
    0
   ],
   "image2": [
    "240",
    0
   ],
   "latent_image": [
    "225",
    0
   ],
   "auto_resize": "crop",
   "vl_size": 384,
   "prompt": "transform the image to realistic photograph, with the character looking exactly like the one in Figure 2.",
   "system_prompt": "Describe the key features of the input image (color, shape, size, texture, objects, background), then explain how the user's text instruction should alter or modify the image. Generate a new image that meets the user's requirements while maintaining consistency with the original input where appropriate."
  }
 },
 "221": {
  "class_type": "KSampler",
  "inputs": {
   "model": [
    "219",
    0
   ],
   "positive": [
    "217",
    0
   ],
   "negative": [
    "218",
    0
   ],
   "latent_image": [
    "220",
    2
   ],
   "seed": 892624666372231,
   "steps": 8,
   "cfg": 1,
   "sampler_name": "euler",
   "scheduler": "beta57",
   "denoise": 1
  }
 },
 "222": {
  "class_type": "VAELoader",
  "inputs": {
   "vae_name": "qwen_image_vae.safetensors"
  }
 },
 "224": {
  "class_type": "VAEDecode",
  "inputs": {
   "samples": [
    "221",
    0
   ],
   "vae": [
    "222",
    0
   ]
  }
 },
 "225": {
  "class_type": "LayerUtility: ImageScaleByAspectRatio V2",
  "inputs": {
   "image": [
    "237",
    0
   ],
   "aspect_ratio": "original",
   "proportional_width": 1,
   "proportional_height": 1,
   "fit": "crop",
   "method": "lanczos",
   "round_to_multiple": "None",
   "scale_to_side": "longest",
   "scale_to_length": 1536,
   "background_color": "#000000"
  }
 },
 "227": {
  "class_type": "LoadImage",
  "inputs": {
   "image": "{{图 1}}",
   "upload": "image"
  }
 },
 "228": {
  "class_type": "SaveImage",
  "inputs": {
   "images": [
    "224",
    0
   ],
   "filename_prefix": "Krea2转真人-作者原版-双图"
  }
 },
 "236": {
  "class_type": "Lora Loader Stack (rgthree)",
  "inputs": {
   "model": [
    "215",
    0
   ],
   "clip": [
    "216",
    0
   ],
   "lora_01": "krea2/Krea2_Anything2RealCharacters-V3.safetensors",
   "strength_01": 1,
   "lora_02": "None",
   "strength_02": 1,
   "lora_03": "None",
   "strength_03": 1,
   "lora_04": "None",
   "strength_04": 1
  }
 },
 "237": {
  "class_type": "ColorCorrect",
  "inputs": {
   "image": [
    "227",
    0
   ],
   "temperature": 0,
   "hue": 0,
   "brightness": 0,
   "contrast": 0,
   "saturation": -20,
   "gamma": 1
  }
 },
 "238": {
  "class_type": "LoadImage",
  "inputs": {
   "image": "{{图 2}}",
   "upload": "image"
  }
 },
 "239": {
  "class_type": "ColorCorrect",
  "inputs": {
   "image": [
    "238",
    0
   ],
   "temperature": 0,
   "hue": 0,
   "brightness": 0,
   "contrast": 0,
   "saturation": -20,
   "gamma": 1
  }
 },
 "240": {
  "class_type": "LayerUtility: ImageScaleByAspectRatio V2",
  "inputs": {
   "image": [
    "239",
    0
   ],
   "aspect_ratio": "original",
   "proportional_width": 1,
   "proportional_height": 1,
   "fit": "crop",
   "method": "lanczos",
   "round_to_multiple": "None",
   "scale_to_side": "longest",
   "scale_to_length": 1536,
   "background_color": "#000000"
  }
 }
}
```
