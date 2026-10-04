# 内置流程和导入的工作流

## 内置流程：现在只有文生图

节点按顺序是：底模（`CheckpointLoaderSimple`）→ LoRA（每个一个 `LoraLoader`，串起来）→ clip skip（`CLIPSetLastLayer`）→ 正面、负面（两个 `CLIPTextEncode`）→ 空白画布（`EmptyLatentImage`）→ 采样（`KSampler`）→ 解码（`VAEDecode`）→ 预览（`PreviewImage`）。只用 ComfyUI 自带的节点，哪台 ComfyUI 都能跑。规则在 `docs/dev-plan.md` 5.18。

出图设置里能调的：用哪台 ComfyUI、底模、LoRA（几个都行，各带强度，能按名字搜）、种子（每次随机或固定一个数）、尺寸、张数、步数、CFG、采样器、调度器、评级、额外的负面词。clip skip 在设置里按系列改。

发出去的提示词：正面是系列固定开头加评级词加框里的标签；负面是系列默认负面词加额外的负面词。

现在没有的：放大、修脸、图生图、局部重绘、参考图。

## 导入的工作流

程序只往四处填：正面、负面、种子、尺寸。别的都按文件里写的，包括底模、LoRA、步数、采样器、高清修复、修脸，出图设置里这些项也不显示。

为什么不能在程序里给导入的工作流加 LoRA：每个工作流的连法不一样，程序不认识里面的插件节点。拿 E02 来说，LoRA 用的是 rgthree 的 Power Lora Loader，模型线从它出来分两路：一路经过通配符编码节点（`ImpactWildcardEncode`）到采样器，一路直接到修脸节点；步数、CFG、采样器又是三个单独的小节点同时连到采样器和两个修脸节点上。SmoothWorkflow 那份干脆没有 LoRA 节点。程序不知道新的 LoRA 该插在哪、哪几根线要跟着改，硬插很容易把工作流弄坏。所以计划里定的是「只换这四处」。要换 LoRA，在 ComfyUI 里改好，再导一次。

## 和 E02 比

E02 三份的流程一样，每出一张都自动做：文生图 → 用放大模型 `4x_foolhardy_Remacri` 放大四倍再缩一半（等于放大两倍，整张不重画）→ 修两遍脸（`FaceDetailer` 和 `FaceDetailerPipe`，重绘强度都是 0.5）→ 存图。三份只差底模和 LoRA：SDXL 和 4LoRA 用 `waiIllustriousSDXL_v150`，挂的 LoRA 不一样；SmoothWorkflow 用 `smoothMixIllustrious2`，没有 LoRA。

内置流程只做文生图这一步。

## 计划里的 P12（还没做）

规则在 `docs/dev-plan.md` 5.21。都是内置流程，参数在程序里调，结果和普通出图一样挂在框下面。

| 功能 | 怎么用 | 能调的 | AutoDL 那台还缺什么 |
| --- | --- | --- | --- |
| 图生图 | 点生图时选，参考图从槽位里挑一张 | 重绘强度，默认 0.6 | 不缺 |
| 姿势参考 | 同上 | 强度，默认 0.8 | 缺 SDXL 用的 openpose ControlNet 模型，现有的 7 个 ControlNet 都是 Flux、Qwen、Wan 这些用的 |
| 画风参考 | 同上 | 强度，默认 0.8 | 有通用 SDXL 的 `ip-adapter-plus_sdxl_vit-h`；计划里 IL 推荐的 NoobAI 那个没有 |
| 放大 | 在出的一张图上点 | 倍数 1.5 或 2，重绘强度默认 0.35 | 不缺 |
| 修脸 | 在出的一张图上点 | 重绘强度，默认 0.4 | 不缺 |
| 局部重绘 | 在大图上涂要重画的地方 | 这块画成什么、重绘强度默认 1 | 不缺；涂抹的界面原型里还没有 |
| 反推 | 标签编辑窗里「从图反推」 | 用哪个反推模型 | 不缺 |

放大和修脸在计划里是出完图以后在单张图上点，挑中的再做；不像 E02 那样每张都自动做。

AutoDL 那台要用的插件都装了，上表是 2026-10-04 从那台的节点列表里查的。
