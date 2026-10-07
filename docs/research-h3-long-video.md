# 用 H3 做长视频：调研

2026-10-06 查的。H3 指 MiniMax H3，就是现在五套视频提示词写给的那个模型。

## H3 本身

- 2026 年 8 月 3 日开源权重，ComfyUI 当天原生支持，不用装插件。来源：[ComfyUI 博客](https://blog.comfy.org/p/minimax-h3-day-0-support-in-comfyui)、[ComfyUI 文档](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)。
- 一次出一段，5 到 15 秒，每秒 24 帧，原生 768 短边（16:9 是 1344×768），视频和立体声一起出。要 2K 得另外放大。
- 帧数只能取 17 的倍数加 5（5、22、39……），时长会对齐到这个格子。来源：[原生节点文档](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native)。
- 两个主模型，各约 19.5 GB（int8 版）：
  - fl2va 那个：管文生视频、图生视频、首尾帧。
  - ref2va 那个：管参考图生视频，最多 9 张图、3 段视频、3 段音频；还管多帧参考和 ControlNet。
- 另要文字编码器约 14.6 GB、视频 VAE 4.9 GB、音频 VAE 0.6 GB。来源：[ComfyUI Wiki 教程](https://comfyui-wiki.com/en/tutorial/advanced/video/minimax/minimax-h3)。
- 官方建议 20 步；加速 LoRA 能降到 8 步或 4 步，但声音在 8 步时最弱。
- 自带一个「多帧参考」节点（MiniMaxH3AddGuide），能把一张图或一小段视频钉在任意一帧上。不过它只是参考，不是把那几帧原样接上。

## 长视频的几种做法

H3 一次最多 15 秒，长视频都是一段一段接起来。区别在接缝处怎么接。

| 做法 | 要不要装插件 | 接缝效果 | 说明 |
| --- | --- | --- | --- |
| 上一段最后一帧当下一段首帧 | 不用 | 画面接得上，动作会重新起步，声音会断一下 | 最简单，只用图生视频 |
| 上一段结尾几帧用多帧参考钉在下一段开头 | 不用 | 比一帧好，动作方向能带过去，但不保证原样接上 | 用 ref2va 模型，每段还能带角色参考图 |
| 把上一段结尾的视频和声音原样接进下一段 | 要 | 动作和声音都能连上，接缝最自然 | 社区插件做的，下面几家 |

社区插件（都是 8 到 9 月出的）：

- **H3 Continuum**：最成熟。121 星，10 月 4 日还在更新（3.9.1 版）。来源：[插件页](https://comfy.icu/extension/ukr8b3g-cmyk__ComfyUI-H3-Continuum)。
  - 一段 5 到 15 秒，一共 4 到 16 段。
  - 声音能接续。
  - 每段能分配不同的参考图，最多 9 张。
  - 能一段一段审：满意就接着生成，不满意就重来这一段。
  - 已知问题：接的段多了，有些画面对比度和边缘会越来越重。
  - 16 GB 显卡、9 张参考图、3 段 5 秒，用到约 15 GB。
- **tritant 的 H3 Extender**：约 120 星，8 月 19 日更新。一个节点连着出多段，中间结果存硬盘，能续上已有的视频。来源：[GitHub](https://github.com/tritant/ComfyUI_MiniMax_H3_Extender)、[节点说明](https://www.runcomfy.com/comfyui-nodes/ComfyUI_MiniMax_H3_Extender)。
- **pmhaidn 的 H3 Extender**：13 星。接上一段结尾 22 帧，合并时能平滑接缝、对齐颜色。来源：[插件页](https://comfy.icu/extension/pmhaidn__ComfyUI-Minimax-H3-Extender)。
- **Herrgott 的无限接续套件**：作者自己说是实验性的，测过 7 段、约 61 秒。来源：[ComfyUI Wiki 新闻](https://comfyui-wiki.com/en/news/2026-08-11-h3-infinite-continuation-suite)。
- 另有两个更小的：kat3ri 的接续节点（[说明](https://comfy.icu/node/MiniMaxH3VideoExtendPatched)），panghea 的延长节点（[说明](https://comfy.icu/node/MiniMaxH3LatentExtend)，作者说只成功过一次）。

## AutoDL Art 上的 H3 应用

- 你账号下「A」和「二」两台实例，跑的就是「MINIMAX-H3提速500高画质」这个应用（[应用页](https://www.autodl.art/app/market/252)，要登录才看得到详情）。显卡是 RTX 5090，每小时 2.88 元。作者的视频：[提速 530% 一键整合包](https://www.bilibili.com/video/BV1BjuG6pEFJ/)。
- 10 月 6 日开「A」看过一次，只读不改，开了 1.5 分钟就关了。开机后约 1 分钟 ComfyUI 就能用。

开机看到的：

- 环境：ComfyUI 0.38.0（9 月 29 日的版本），PyTorch 2.12.1，显存 32 GB，内存 90 GB。系统盘还剩 9.2 GB；模型放在挂载的共享模型库里，不占系统盘。有 AutoDL 的学术加速，能从 GitHub 装插件。
- 工作流一共 331 个，分 24 个文件夹，H3 的在「U视频-MINIMAX-H3」里，有 58 个：文生、图生、首尾帧、多图参考、二次采样放大、导演台、换装、数字人等。
- 这 58 个都只出一段，最长 15 秒，没有自动把几段接成长视频的。有的工作流里留着别人一段一段手动接的提示词，比如「第四段｜36-47秒｜承接上一段结尾」。
- H3 Continuum 没装。
- 已经装了一个能出长视频的插件 **MMH3Tools**：
  - 核心是「Looping Sampler」节点：先定好整条的长度，它在一次运行里一段一段填满，每段开头带着上一段结尾的画面和声音（默认 22 帧），这部分不重新生成，所以是原样接上。
  - 每段一条提示词，用竖线隔开写在一个框里；可以给开头钉一张首帧图，也可以每段带参考图。
  - 配套的节点能按「总长 60 秒、分 4 段」算出每段多长、重叠多少；长视频解码时一段一段直接写成 mp4，内存不会爆。
  - 插件自带 12 个示例，但都很复杂（最多 90 个节点），还用到两个没装的节点（一个加速注意力、一个本地大模型写提示词），不能直接用，要照着搭一个简化版。
- H3 要用的模型都在：官方 fl2va 和 ref2va 主模型（bf16、int8、剪枝版都有），文字编码器 int8，视频和音频 VAE，4 步和 8 步加速 LoRA，预览用的 taeh3。
- 别的 H3 插件也装了不少：导演台（Director）、FeiHou Easy H3、几种潜空间放大、几种加速。

## 试过以后知道的

10 月 7 日在「A」上试过，细节在 `docs/reports/h3-long-video.md`。

- MMH3Tools 的 Looping Sampler 在 ComfyUI 0.38.0 上能直接跑，「接上一段」不用另外打补丁。
- 5090 跑一段 15 秒、1344×768、8 步加速 LoRA、10 步：每步约 37 秒，一段约 6.3 分钟。4 段 57.6 秒的整条共 29 分钟。
- 分两遍生成（864×480 跑 10 步，不解码放大 2 倍，1728×960 再跑 3 步）整条也是 29 分钟，画面大 1.6 倍。
