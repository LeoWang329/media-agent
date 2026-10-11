# MiniMax-H3 与 Krea2：底模 / LoRA / NSFW / LMS 调研

> 调研日期：**2026-10-11**。
> 证据分三类，正文里逐处标注：**实机**＝在 AutoDL 那台（RTX 5090 D 32G，ComfyUI 0.37.0，torch 2.12.1+cu130）上只读核实；**官方**＝MiniMax / Krea / ComfyUI 源码与官方文档；**社区**＝Civitai / HuggingFace / Reddit / 中文社区，属不可验证的用户说法。
> 详细原始报告在 `outputs/research/`：`minimax-h3.md`（H3 全貌 + NSFW）、`minimax-h3-models.md`（量化 / 加速 / 整包选型）、`minimax-h3-lms.md`（LMS 专项）、`krea2-base.md`（Krea2 本体 + 底模谱系）、`krea2-nsfw.md`（LoRA 谱系 + NSFW）。
> 本文是这五份的汇总与结论，冲突处一律以实机 / 官方为准。

---

## 0. 先纠正一个前提：这两个不是同一类东西

| | MiniMax-H3 | Krea2（K2） |
|---|---|---|
| 产出 | **视频 + 音频**（768p / 24fps / 4–15 秒 / 32kHz 立体声） | **静态图像**（1K–2K） |
| 开源时间 | 2026-08-03 | 2026-06-23（闭源线上版 2026-05-16） |
| 发布方 | MiniMax（稀宇科技） | Krea AI |

**MiniMax 没有任何开源的图像生成底模。** 把 HF 官方组织页 20 个仓库全枚举一遍，pipeline 类型只有 text-generation / image-text-to-text / text-to-audio / **image-text-to-video** / image-feature-extraction，**没有 text-to-image 或 image-to-image**。Hailuo（海螺）系列也没有开源权重。

所以「H3 的底模 vs Krea2 的底模，选哪个」这个问题**不成立**——它们不抢同一个岗位：

- **出真人照片** → 继续 Krea2（你现在这条路是对的）。
- **把真人照片变成视频**（动起来、说话、打斗、换装）→ H3，这是它唯一的位置。
- 顺带：H3 生态里**确实有专门的「动漫转真人」LoRA**（`LiseTY/Minimax-H3-ref2v_Anime_2_Realism`，触发词 `LumiReal`），但产出是**视频**不是照片。

真实的关系是**串联**，不是二选一：

```
动漫原图 →（Krea2 + A2R LoRA，图像阶段）真人定妆图 ×N →（H3 ref2va，多图参考）真人风格视频（要锐度就叠 LMS）
```

---

## 1. 两个模型的侧重点（一句话版）

- **Krea2 的侧重点是「单帧的干净、结构正确、审美完成度」**：提示词跟随强、解剖结构社区评价最好、女性角色好看、速度快 2–3 倍；代价是**多样性差**（同一提示词换 seed 出图差异小，社区原话 *"Krea2 will just lock on something and the only way to change it, is to change the prompt"*），且**完全没有原生编辑管线**（换背景/换材质会把主体"重新诠释"一遍）。
- **H3 的侧重点是「动态 + 时间一致性 + 音画同步」**：33B 全模态（视频+音频一次出）、多图多视频参考、原生音频输入/生成；代价是**极吃显存**（32G 卡峰值死贴 31GB）、**在 ComfyUI 里没有真正的 video-to-video**（见 §2.6）。

**分工结论（社区共识，也和官方定位一致）**：**编辑用 Qwen-Image-Edit，生成用 Krea2，视频用 H3。** 你现在「生成/转真人走 Krea2、编辑走 Qwen-Image-Edit」的两条线是**对的**，不要试图合并。

---

## 2. MiniMax-H3

### 2.1 任务族（买底模前先分清）

| 族 | 含义 | 实机文件（例） |
|---|---|---|
| **FL2VA** | 首帧 / 尾帧 → 视频+音频（覆盖 T2VA） | `minimax_h3_fl2va_*` |
| **Ref2VA** | 参考图 / 参考视频 / 参考音频 → 视频+音频 | `minimax_h3_ref2va_*` |
| **Hybrid** | FL2VA + Ref2VA 混血（按 block 区间融合） | `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8`（你库里 3 个工作流在用它） |
| T2VA | 纯文本 → 视频+音频 | `veda/minimax_h3_t2va_veda_8nfe_600step_preview_fp8` |

两族的 **LoRA 不能混用**：参数键完全相同，挂错了**不报错但静默劣化**。

### 2.2 底模档位（实机 68 个文件，官方 5 档量化 + 第三方整包）

关键认知：**量化买的是显存，不是速度。** 只有 `fp8_scaled` 在 Ada/Blackwell 上是真 FP8 matmul（唯一真提速档）；其他档位只要"装得下"，档与档之间的时间差是噪声。真正的提速杠杆是 Sage Attention（≈2×）、分辨率/帧数、以及换更小的模型。

| 档 | 体积（实机） | 说明 |
|---|---:|---|
| `*_pruned_int8_convrot` | 20.97 GB | **官方模板默认，24G/32G 都推荐**（社区实测 RTX 4090 loader 峰值 ~21 GB） |
| `*_pruned_fp8_scaled` | 20.96 GB | 同尺寸但走真 FP8 路径，**50 系可优先 A/B 这一档** |
| `*_pruned_bf16` | 40.23 GB | 质量上限，32G 装不下 |
| `*_pruned_nvfp4` / `w4a8` / `int4_r128` | 12.5 / 12.5 / 12.4 GB | 给 ≤16G 卡用的；4bit"不比 int8 快，还掉质量" |
| GGUF Q3–Q5 | 15.6–23.9 GB | **只有 1/3 速度**，是"装得下"的手段，不是提速手段 |
| 第三方整包 | 21–49 GB | `Singularity`（写实/动作/VFX 定位最明确）、`FeiHou Remix`、`Dasiwa Hybrid`、`10Eros-Max`/`h3ErosMax`（NSFW 向）、`PinkCherry`（NSFW + 低显存） |

文本编码器 = **Qwen3-VL-32B**（这是 H3 显存的大头）：`nvfp4_awq` 15.69 GB（官方默认，Blackwell 原生快）/ `int8_convrot` 27.14 GB（Ampere 正解）/ `gguf Q4_K_M` 14.58 GB。
**好消息：ComfyUI 会先加载 encoder、编完码就释放，再加载 DiT，两者不需要同时驻留。**
VAE 三个：**video VAE 用 `int8_convrot-v2`（2.81 GB，与 fp16 像素等价还省 2.4 GB）**、**audio VAE 必须 fp32（605 MB，fp16 会音画不同步）**。

### 2.3 加速 LoRA（这是 H3 生态最乱的地方，实机 85 个）

至少 7 个来源，加载方式都不同：

| 家族 | 来源 | 步数 | 加载方式 |
|---|---|---|---|
| **lightx2v Turbo** | ModelTC / LightX2V | 4 / 8 | **普通 LoRA loader**（ComfyUI 官方模板就用它） |
| **PDD Acc-8Step** | **Alibaba-PAI** | 8 | **需专用节点 + head bank**（`ComfyUI-MiniMax-H3-PDD-Acc`，你机器上装了） |
| larryvrh Turbo（`turbo_4step_*` / `turbo_v4_step600*`） | 社区 | 4–8 | 需专用 sampler 节点（你机器上装了） |
| HyperFlow 8step | Video Rebirth | 8 | 普通 LoRA + **手动 sigma** |
| DMAD / PDMD 4step | 论文方法 | 4 | Diffusers LoRA |
| FastVideo FastH3 | FastVideo + NVIDIA | 8（固定） | **整模型替换**，且**只蒸馏了 t2v / fl2v，Ref2VA 没做** |
| lightx2v Turbo-SLA | LightX2V | 4 | 普通 LoRA + sage2 稀疏算子 |

**三条硬结论**：

1. **ComfyUI 官方模板用 lightx2v**，所以它是事实标准；但**在 Ref2VA 上 PDD Acc-8Step 明显更好**——同一份第三方实测（1344×768 / 124 帧 / 同 seed）里，PDD 8 步的细节锐度比 lightx2v 8 步高 **42%**（7.986 vs 5.630），而 lightx2v 8 步相对 20 步成片档是**过平滑**的（−22%）。**ref2v 和 i2v 应当用不同策略**（i2v 上两者差距只有 1.5%）。
2. **shift 要按 LoRA 作者的推荐值配对**：544p 系 turbo 推荐 **12 / 3**，768p 系 turbo 推荐 **6 / 3**。
   ⚠️ **但这不是「错一个数字就崩」的硬约束**（见 §8.1 的更正，2026-10-11 二次调研修正）。
3. **蒸馏 LoRA 之间不能叠加**，也不要叠 step-caching（blockcache / EasyCache）。

### 2.4 LoRA 生态（按用途分类，实机 85 个）

| 用途 | 实机上的例子 |
|---|---|
| 步骤加速 | 见上表 |
| **锐化 / 细节** | **`minimax_h3_lms_v1.0_r64`（本次主角，见 §4）**、`Restore_Enhance_Improve_rank16` |
| 质感 / 电影感 | `MinimaxH3真实电影质感V0.1`、`电影感H3-loraV1.0正式版`、`davham_cinema-h3-Euler-simple-0.8`、`h3-realism-people-...-触发词r34l1sm`、`ig_tiktok_aesthetic`、`relim_v2` |
| 运动 / 动作 | `Motion_Repair(_V2)`、`动作i连续性修复LORA`、`H3_Combat_V2`、`minimaxH3枪斗术GunFu`、`wushu_action_v7_*`（4 档）、`camera_motion_h3`、`FrameRush` |
| 功能 | `minimax_h3_head_swap_v1.0_r32`（换头）、`h3_character_swap_pro4500_1000`、`minimax_h3_style_transfer_v1.0_r64`、`minimax_h3_vfx_edit_v1.0_r128`、`live_wallpaper`、`viggle_animate_dmd`、`lightx2v-MiniMax-H3-Prompt-Rewriter`（提示词改写） |
| 无训练滑杆 | `fafafast`、`H3_speed_slider_1.1`、`motion_speed_slider_mmh3_v1.1`（几十 KB ~ 10 MB 的小文件） |
| NSFW | `MysticXXX_MMH3-V1/V4`、`h3_Better_NSFW_Motion_V1`、`PinkFluffyBunny-unpruned-v2-rank256` |

### 2.5 你这台 5090 D 32G 的推荐配法（文件都在盘上）

```
DiT        minimax_h3_ref2va_pruned_int8_convrot.safetensors      (20.97 GB)
   或      minimax_h3_ref2va_pruned_fp8_scaled.safetensors       (20.96 GB，走真 FP8，值得 A/B)
   省事     minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors (一档通吃两个任务，你库里 3 个工作流在用它)
Encoder    qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors           (15.69 GB，Blackwell 原生)
Video VAE  minimax_h3_video_vae_int8_convrot-v2.safetensors       (2.81 GB)
Audio VAE  minimax_h3_audio_vae_fp32.safetensors                  (0.61 GB，必须 fp32)
加速 LoRA  minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16         (官方 R2V 模板同款)
   或      pdd_acc/minimax_h3_ref2va_pdd_acc_8step_comfyui        (质量更高，配 PDD-Acc 节点)
锐化 LoRA  minimax/minimax_h3_lms_v1.0_r64.safetensors            (见 §4)
```

参数基线：`euler` + `simple` + `shift 12/3`（768p 系改成 6/3）+ **CFG 1**（H3 是 CFG-distilled，官方模板用 `BasicGuider`，没有 CFG 输入）。
分辨率 768p 原生画布 = **1344×768**（别用 1.0 MP，会算成 1376×768 越界）；**帧数必须落在 `17n+5`**（5、22、39、56、73、90、107、124…）。
32G 的真实体感（社区 RTX 5090 实测，20 步）：480p/124 帧 ≈ 57 s，720×720/124 帧 ≈ 137 s，704×1216/124 帧 ≈ 310 s，**峰值 VRAM 全部 31 GB 上下，最低只剩 ~1 GB**。→ **32G 是"刚好够"，不是宽裕**；时长不线性（2.1× 时长 ≈ 2.9× 耗时），分辨率比时长更贵。

### 2.6 一条必须知道的限制

**ComfyUI 里的 H3 没有真正的 video-to-video**（结论来自对源码的分析，与实机的 `nodes_minimax_h3.py` 一致）：三个 H3 节点**都从空 latent 开始**，参考图/关键帧/guide 是 **conditioning，每一步被重新注入但从不被去噪**，**没有 `denoise < 1` 的路径**。

含义：**参考视频里没有任何一帧会保留到输出里**，你拿到的是一个**全新生成**、近似跟随参考运动与节奏的视频。「拿一段源视频换角色」在本地 ComfyUI 做不到。

---

## 3. Krea2（K2）

### 3.1 它到底是什么（ComfyUI 源码 + 官方技术报告，交叉验证）

- **Krea AI 自研的约 13B 单流 MMDiT**（`krea2_raw_bf16` = 26.28 GB ≈ 13.1B 参数），**不是 Qwen-Image 换皮**：`comfy/ldm/krea2/model.py` 开头自述 *"Krea 2 (K2) — single-stream MMDiT"*，AdaLN-single、GQA + per-head QK-norm + sigmoid-gated attention、SwiGLU、3-axis RoPE。
- **文本编码器 = Qwen3-VL-4B 的 12 层 hidden states**（taps `[2,5,8,…,35]`，`comfy/text_encoders/krea2.py`），**conditioning 模板「与 Qwen-Image 相同」**（源码注释原文），内部 `txtfusion` adapter。
- **VAE 与 Qwen-Image 共用**：官方技术报告自述"最初用 Qwen Image 自编码器"，实例工作流加载的就是 `qwen_image_vae.safetensors`。→ **两者画质天花板同源**，差别在骨干 / 文本条件 / 后训练审美。
- sampling `shift = 1.15` **已写进 `class Krea2`，工作流里不要再加 `ModelSamplingSD3`**。
- 许可：**Krea 2 Community License**（不是 Apache/MIT）。商用要单独读条款或买商业授权（官方另有 Model Licensing 页）。
- **和 Flux Krea（`flux1_krea_dev`）没有任何血缘**，只是同一个甲方——那是 Black Forest Labs 训的 FLUX.1 联名款，LoRA / TE / VAE 全不通。

### 3.2 turbo vs raw

**turbo 不是"质量更差的快版"，RAW 才是没做完的那个。** 官方 README 原文：RAW 是 *"undistilled checkpoint without any step / cfg guidance distillation and posttraining"*，**官方口号是「TRAIN on Raw, RUN on Turbo」**。

| | RAW | Turbo |
|---|---|---|
| 官方步数 / CFG | 52 / 3.5 | **8 / 0.0**（ComfyUI 里填 1.0，等价关闭） |
| 原生分辨率 | ≤1K | **1K–2K** |
| 负面提示词 | 有效 | **无效**（CFG=1 时被忽略，写了白写） |
| 换来的 | 多样性、可塑性、可训练性 | **审美完成度 + 速度 + 2K** |

### 3.3 底模谱系（实机 25 个 + `krea/` 里 6 个旧档）

官方只发 8 个量化档（`Comfy-Org/Krea-2`，实机核对无误；**实例上的 `krea2_turbo-int4_convrot` 不是官方档**）。社区真正值得装的只有三条线：

| 线 | 作者 / 平台 | 定位 | 实机文件 |
|---|---|---|---|
| **Moody 家族** | `catlover1937` / Civitai（中文作者，单人 + 3080 Ti） | 体量最大的写实 / NSFW 微调系列，**版本号是并列主题不是升级**（作者原话） | `Moody-Krea-Mix-v2G_00001_int8_tensorwise`（= V2 Global，免费档最稳）、`Krea2-Moody-Mix-premium_int8_convrot`（Premium，**至今付费**）、`moodyAmateurMixKrea2_3JAVStyle_int8`（V3 日式素人 JAV 片感）、`..._4RawStudioShot_int8`（V4 RAW 棚拍艺术人体） |
| **Muse by Stable Yogi** | `Stable_Yogi` / Civitai 2741166 | 写实人像 / 全身 / 时尚编辑体，**6.75 万下载** | `krea2MuseByStable_v15TurboFp8`（实例是 v1.5，**最新已到 v3.5 Extended**） |
| **RedCraft / Dark Beast** | `AiMetatron` / Civitai 958009 | 短剧 / 商用生产向，偏重口高强度风格化 | `RedCraft-HighNoise/LowNoise-MASO-MangaDrama-Krea2Turbo-RedMix-v4`（**DUAL 是双权重，高低噪要配对取用**）、`darkBeastINT8Convrot2_krea211INT8Convrot` |

**跨谱系混血要小心**：`redcraftHybridH3A2A_30Krea2`、`darkBeastH3Director_darkBeast330` 是把 **MiniMax H3** 的能力往 Krea2 上嫁接的版本，TE/VAE 都不共享，风险高于纯 Krea2 微调。
**中文圈的 AIO 不要盲买**：`Krea2-turbo-White_Marble-AIO_V1_FP8`（22.27 GB）= 底模 + **bf16 文本编码器** + VAE 打包，**比分开装白吃 3.5 GB 显存**（拆开只用 17.8 GB）；它的卖点是 RunningHub 微调的"更符合国人审美 + 中文提示词理解"，不是 AIO 格式本身。

### 3.4 量化档怎么选（有公开基准，条件和你完全一致）

唯一查到的一份系统性对比（`Merserk/Krea-2-Turbo-Checkpoint-Format-Benchmark`，30 组 prompt-seed 配对，`euler + simple + 8 步 + CFG 1`）：

| 格式 | 体积 GiB | LPIPS-Alex ↓ | DINO ↑ | 权重 SNR dB ↑ | 采样秒 ↓ |
|---|---:|---:|---:|---:|---:|
| BF16（参考） | 24.48 | 0 | 1.0000 | — | 25.78 |
| FP8 Scaled | 12.24 | 0.0937 | 0.9710 | 31.59 | 19.50 |
| **INT8 ConvRot** | 12.57 | **0.0419** | **0.9838** | **41.16** | **12.42** |
| MXFP8 | 12.60 | 0.0712 | 0.9794 | 31.60 | 31.93 ⚠️Ada 回退路径 |
| NVFP4 | 7.15 | 0.2051 | 0.9348 | 20.60 | 24.93 ⚠️Ada 回退路径 |
| INT4 ConvRot W4A4 | 6.43 | 0.3147 | 0.9113 | 15.72 | 9.54 |

**结论（针对你的 5090 D 32G）**：

- **主力换 `krea2_turbo_int8_convrot`（13.49 GB）**——量化档里保真度最高、误差只有 fp8 的一半、**速度还更快**、文件只大 8%，而且是 ComfyUI **原生 safetensors 路径**，工作流一行不用改。
- **不要用 nvfp4 / int4**（32G 卡没有任何理由；nvfp4 的 LPIPS 是 int8 的 5 倍）。注意基准里 nvfp4/mxfp8 "又慢又糊"是 **Ada 卡**的问题，5090 是 Blackwell（SM≥10）能吃原生快路径——但保真度差距依然存在。
- `convrot` = Hadamard rotation 摊平权重离群值 + 逐行 INT8，比朴素 INT8 保真得多，**不是"有损压缩"，是更好的量化**。

### 3.5 你的 Krea2 配置有 4 处可以立刻改

1. **步数 10 → 8**。官方 turbo 蒸馏点就是 8 步，A2R LoRA 官方 card 也写 8 步 / CFG 1 / 2048；10 步多买到的是"更细的纹理"而不是"更对的构图"，收益低于把时间拿去换 seed。
2. **底模 `krea2_turbo_fp8_scaled` → `krea2_turbo_int8_convrot`**（保真 + 速度双赢，零改动）。
3. **确认没有多余的 shift 节点**（1.15 已在模型类里，重复设置等于二次干预）。
4. **编辑档底模可以考虑换**：你现在编辑档用 `moodyAmateurMixKrea2_3JAVStyle_int8`，官方定位是"日式素人 JAV 片感、略糊、生活化"；想要更锐的写实，**`moodyAmateurMixKrea2_4RawStudioShot_int8`（RAW 棚拍、真实皮肤纹理）或 `Moody-Krea-Mix-v2G`** 更稳。

### 3.6 转真人 LoRA：`Krea2_Anything2RealCharacters` 专章

**作者查到了：`WarmBloodAban`（B 站「AIGC特异点」/ AIGC-Singularity）**，发布在 HF 与 [Civitai 2808492](https://civitai.com/models/2808492/krea2anything2realcharacters)，HF 侧标 apache-2.0（**底模是 Krea2 community license，LoRA 标 Apache 的合规性存疑**，商用前自己判断）。

- **V1 / V2 / V2.5 是整模微调，V3 改回发 LoRA**。作者原话：*"Unlike V2 and V2.5, V3 is released as a LoRA. This provides much stronger compatibility when stacking external Krea2 style or character LoRAs"*，同时修好了 V2.5 "realism translation incomplete"。**作者称 V3 是可预见未来的最终版，没有 V4。**
- 触发词 `transform the image to realistic photograph`；官方参数 **8 步 / CFG 1 / 2048×2048**。
- **两条要修正你现在的用法**：
  - **官方 README 根本没给权重推荐值**，你挂的 1.0 是自己定的；
  - 两条独立证据（作者自述 + `Qwen-Rapid-AIO` v21 加了 anything2real、v22 因 *"stomping styles"* 删掉）都指向：**满权重只能单挂，要叠别的 LoRA 必须降到 0.5–0.8**。
- **两个可能更好的替代（都是 Krea2 专属）**：
  - **`Anime in real` v2.0-Krea2**（Zoropaton，218 MB，触发词 `Ani2rel`，**下载量 802 = A2R 的 4 倍**，专攻景深 / 背景虚化）；
  - **`[Krea2 Edit] Anime2Real` v2.5**（xmsthc，触发词 `A2R`，带配套工作流）。
- **叠挂权重梯度（社区验证）**：加速 1.0 / 身份 1.0 / 细节 0.75 / NSFW 0.8 / 皮肤 0.45。turbo LoRA 可以和 A2R 同挂。
- **注意**：你实测过 `Krea2EditModelPatch` 与写实 LoRA 不兼容（出粉白发灰废图），走 Ostris 路线才对——这与"功能型 LoRA 需要专门 pipeline"一致，别混用。

---

## 4. NSFW 支持度对比

### 4.1 MiniMax-H3

| 层面 | 结论 | 性质 |
|---|---|---|
| 许可证 AUP | **20 条禁止用途里没有一条明确禁色情**（无 pornography / sexual 字样）；最接近的是第 5 条"禁止绕过官方安全护栏"和第 15 条宽泛的道德兜底 | 官方 license 原文 |
| 官方 API / 托管服务 | **有审核**，官方明文写 "Content suspected of being unlawful, **pornographic**, or infringing third-party rights may be blocked"；实测 API 返回 422 "sensitive content" | 官方新闻稿 |
| 本地开源权重 | **没有 MiniMax 的托管审核层**（架构层面） | 官方未声明；"无内置过滤"属**推测** |
| 社区实测 | HF 官方仓库 discussion #35（A100 用户）：*"less censorship… perfect model for nsfw video"*；已形成规模生态 | **社区说法** |
| 去审查文本编码器 | 有效且必需：`qwen3vl_32b_minimax_h3_ultra_uncensored_heretic_int8_convrot`（你盘上有）、`..._uncensored_FeiHou`；ethanfel 的 Heretic 版 704 likes | 官方仓库 + 社区 |
| NSFW 生态 | `10Eros-Max`（NSFW 嫁接底模）、EllaPriest45 的 Actions / Characters / Styles 三个合集、Hearmeman / nikdevs 合集 | 社区 |
| 地域 | Excluded Territories = **欧盟 / 英国 / 韩国 / 美国**；**中国大陆可用**（AutoDL 不受影响） | 官方 license |

**一处必须修正的说法**：`10Eros-Max` 的原文是 *"carries transferred character from **LTX 2.3, Wan 2.2, and Krea 2**"* —— **Krea2 只是三个来源之一，而且原文说的是 "character"，没有写 "NSFW 数据"**。用它当"Krea2 的 NSFW 更强"的证据不成立；但把 Krea2 的角色能力移植进 H3 这件事本身是真的。

### 4.2 Krea2 / Qwen-Image 系

| 层面 | 结论 | 性质 |
|---|---|---|
| 底模自身能力 | Krea 官方 `safety.md` **自己承认做了对齐微调**（2500 条 prompt 评测集）；AMA 原话 *"open source version needed to go through some alignment training"* | 官方 |
| 许可证 | **不禁止 NSFW 生成**，但 **§4.2 强制部署方自建内容过滤**、**§4.1(c) 禁止移除安全 / 溯源机制**、**许可可提前 30 天通知单方撤销**、商用有 $1M 门槛 | 官方 license |
| 文本编码器层（**最有效的一环**） | Heretic abliteration 版 **只改了 54 个张量**，HarmBench ASR **30.8% → 100%**，MMLU **+0.03%**、GSM8K 仅 −1.83% → **几乎无损**。你已经在用 `qwen3vl_4b_uncensored_int8_convrot`，方向正确 | 社区基准 |
| `Qwen-Rapid-AIO-NSFW` 系列 | Phr00t 维护了 23 个版本；**v5 起把 NSFW 与 SFW 拆成独立发布线**；作者推荐 **v19 求编辑一致性 / v23 求提示词遵循**；**已宣布停止更新**。**不能和 Krea2 互换**（TE 是 Qwen2.5-VL-7B，Krea2 是 Qwen3-VL-4B），但 conditioning 模板与 VAE 共用 | 作者页面 |
| Krea2 侧 NSFW 底模 / LoRA | `moodyAmateurMixKrea2_3JAVStyle`（V3，JAV 片感）、`_4RawStudioShot`（V4，RAW 棚拍人体）、`Moody-Krea-Mix`（Civitai 11.58 万下载，明确标 uncensored）、`KNP_V2_copy_copy-nsfw_1.5-2`、`krea2-Cc-天魔-身材`、`Nick_baotunqun/leggings`（`loras/qwen/Pornmaster_QI2.1_Breasts_Slider_V1` 也在一起） | 实机文件 |

**注意一个反例**：`krea2_identity_edit_v1_1/v1_2`（conradlocke）是**纯 SFW，明确不支持 NSFW**；别把它当 NSFW 工具用。

### 4.3 一句话结论

**两边都是"官方有对齐、本地有绕过、社区已成规模"的同一个格局**，差别在形态：

- **Krea2 / Qwen-Image 系**：图像向，**生态最成熟**（几十个 NSFW 底模 + 身体/服装 LoRA + 无审查 TE），Krea 官方是**明确承认做了 alignment** 的，但**许可证 §4.2 把过滤义务压给部署方**而不是禁止生成。
- **H3**：视频向（**带音频**，这是 Krea2 完全没有的维度），本地权重无审核层、有无审查 TE 和 NSFW 动作 LoRA，但**成本高**（32G 卡峰值 31GB、一段 5 秒要几分钟到十几分钟）。
- **两者都受各自的社区许可约束**，商用都要单独看条款。**H3 的地域排除清单（欧盟/英国/韩国/美国）是 Krea2 没有的硬约束。**

---

## 5. 「LMS LoRA」是什么、怎么用

### 5.1 考证结论

**LMS = HuggingFace 作者 `Alissonerdx` 为 MiniMax-H3 做的「锐化 / 细节增强」产品线代号。**
官方文档标题就是 **《LMS / Sharpness LoRA》**，LoRA 的**内部名（safetensors `ss_output_name`）是 `minimax_h3_ref2va_sharpness`**。

**铁证（实机 + 官方双向对上）**：
- 实机元数据：`name`/`ss_output_name` = `minimax_h3_ref2va_sharpness`，`ss_base_model_version` = `minimax_h3_ref2va`，`software` = ai-toolkit 0.13.4，`training_info` = `{"step": 4000, "epoch": 10}`，**rank 64，516 个张量，6.2 亿参数**。
- 作者官方工作流里那个 LoRA 节点的文件名逐字就是 **`Downloads/minimax_h3_ref2va_sharpness (1).safetensors`** —— 作者训练时的原始文件名，发布时才改名成 `minimax_h3_lms_v1.0_r64`。

**⚠️ 三个字母的全称官方和社区都没给，查不到**（作者文档、模型卡、awesome-list、ComfyUI Wiki 中文报道、bbs 中文帖、作者 HF 主页全都没有展开），**不臆测**。中文圈有写作「训练者 NRDX」的说法。

### 5.2 两个完全独立的用法（这是最核心的一条）

| 用法 | 文件 | 挂在哪 | 干什么 |
|---|---|---|---|
| **① 锐化 LoRA** | `models/loras/minimax/minimax_h3_lms_v1.0_r64.safetensors`（1.24 GB） | `LoraLoaderModelOnly`，权重 0.2–1.0 | **同分辨率**把 H3 偏软的输出"回锐"，**不增加像素** |
| **② 潜空间放大器** | `models/latent_upscale_models/h3_upscaler_lms_v0.1_fp32.safetensors`（1.38 GB） | `SelfLiftH3Sampler` 的 `upscaler_model`（`rho=0` 外部提升器模式） | 前段低分辨率采样 → **学习式 latent 提升** → 高分辨率收尾 |

**② 的两个文件名是同一份文件**：实机 `h3_upscaler_lms_v0.1_fp32` 与 `h3_upscaler_sharpness_2000steps_v0.1_fp32` 是**同一个 AutoDL blob**（md5 都是 `ac7519f3…`，都是 1,381,153,616 字节）——就是作者把旧名重命名成了新名，本地缓存里留了两个名字。
它**不是 LoRA**，是从 [LBH-123-AI/Minimax_h3_latent_Upscaler](https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler) 初始化、再用**和 LMS LoRA 相同的 sharpness 数据集**微调 2000 步得到的。**官方推荐 fp16 版，你机器上装的是 fp32 训练存档（想省显存换 fp16）。**

> **`_r64` 和 `_r64_r2` 是同一份权重。** 逐张量比对（516/516）显示差异只有 **1–2 个 fp16 ULP**（最大 2⁻¹²，全局相对差 5.1e-4，余弦 ≥0.9999998）；决定性证据是 `_r2` 的元数据 `sshs_model_hash` **仍然等于 r64 的数据段哈希**，同时多出 `hash_modifier_nonce` / `hash_modifier_time` 两个字段 → **二次保存 + 有意的哈希改写，不是第二次训练**。选哪个都行，建议以和官方同名的 `minimax_h3_lms_v1.0_r64` 为基准。

### 5.3 最小配方（照这个填）

**前提：必须同时挂 `MiniMaxH3AddGuide`（`frame_idx = 0`）**，源片经它当 guide latent（LoRA 就是按 guide latent 训的，不挂就**不工作**）；guide 与目标**帧数必须落在 `17n+5`、分辨率尽量一致**；底模选 **ref2va**（`hybrid_fl2va_ref2va` 混血档实测也好用）。

| 项 | 值 |
|---|---|
| 底模 | `minimax_h3_ref2va_pruned_int8_convrot`（官方工作流同款） |
| 加速 LoRA | `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16` @ 1.0（**注意是 ref2v 版，不是 fl2v 版**） |
| **LMS** | `minimax_h3_lms_v1.0_r64` @ **1.0 起**（官方），社区最稳是 **0.8**，当唯一主效果可以到 **0.9** |
| 提示词 | **固定** `Enhance this video with sharp, crisp details while preserving a natural photorealistic appearance.`（触发方式是这句话，不是关键词） |
| 采样 | `euler` + `simple` + **8 步** + denoise 1 + **CFG 1** |
| shift | `MiniMaxH3SigmaShift` = **12 / 3**（768p 系 turbo 改成 6 / 3） |
| 目标 | `EmptyMiniMaxH3LatentAV` 1344 × 768 / 124 帧（17n+5） |

**权重区间（把"有出处的"和"工作流里的"分开看）**：

| 权重 | 出处 | 用法 |
|---|---|---|
| **1.0** | 官方 `docs/lms.md`："Start with LoRA strength 1.0" | 起点 |
| **0.8** | 社区（Banodoco 测试者）："0.8 左右皮肤和纹理最自然；**两遍都推到 1.0 会过于极端**" | **日常最稳** |
| **0.9** | 你机器上 `U27-MinimaxH3纹理增强-爱屋` | LMS 当**唯一主效果**时 |
| **0.2 / 0.3 / 0.4** | 你机器上 `U24` / `U30` / `U29` | 挂在 5–10 个 LoRA 大链**末尾"补刀"**（前面已有加对比/质感的 LoRA，再叠 0.9 会崩） |

**归纳出的两条经验**：① LMS **总是挂在 LoRA 链最后一环**（紧贴 sigma shift / guider 之前），锐化不被后续 LoRA 再"揉"一遍；② **叠的 LoRA 越多，LMS 权重越低**。

### 5.4 现成工作流（这块你其实已经很富）

**你机器上已经有 8 个工作流在用 LMS 家族**（`/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/`，共 58 个）：

| 工作流 | LMS 用法 | 定位 |
|---|---|---|
| **`U27-MinimaxH3纹理增强-爱屋`** | LoRA @ **0.9**（链尾） | **最干净的蓝本**，36 节点、无 bypass、单一目标就是纹理增强；作者就是中文圈那位"爱屋" |
| `U30-Minimax-H3-Singularity超双采放大-AIGC特异点` | LoRA @ **0.3** | 双采 + `MinimaxH3LatentUpscaler3D`(×1.5)，ref2va 专职底模，9 图 + 3 视频参考 |
| `U29-H3高动态多图版-宫格图反推写词-小岚` | LoRA @ **0.4** | 最重的综合流（10 个 LoRA 串联 + 文戏/武戏/高动态开关） |
| `U24-文武双修T8版MiniMaxH3双采参考生视频V927` | LoRA @ **0.2** + 放大器 | LMS 两个用法同时出现的唯一一个 |
| `U00-selflift群主试玩版` | **放大器**（新名） | SelfLift 试玩版，结构最干净（38 节点） |
| `U37-真-上下文无缝无色差长视频-SelfLift双采-惊尘573` | **放大器** | 长视频接续，作者备注最全 |
| `U34-WORK-FISHER-9-28-MINIMAXH3-武戏高动态工作流` | **放大器**（旧名 ×1.5） | 武戏高动态 |
| `U38-打斗增强版-多少会点不精` | **放大器**（旧名 ×1.2） | 打斗增强 |

**想照着复现：用 `U27`（最干净）或 `U30`（LMS 当收尾 + 放大）；想玩 SelfLift：用 `U00`。**

**网上可下载的**：

| 来源 | 内容 | 链接 |
|---|---|---|
| 作者官方 | **LMS 原版工作流**（103 节点，含对比拼图、TAE 预览、PDD_ACC 可选路径） | [HF](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/workflows/minimax_h3_lms_workflow.json) |
| 作者官方 | LoRA 权重（Apache-2.0）/ 放大器（fp16 推荐） | [loras](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/tree/main/loras) · [latent_upscaler](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/tree/main/latent_upscaler) |
| 社区 ethanfel | **DLSS5 + LMS** 工作流 + 说明（接长视频体系，限制与显存估算写得很清楚） | [GitHub](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop/blob/main/example_workflows/) |
| 中文（爱屋） | SelfLift 二采 + LMS 放大 + 2×VAE 与爆显存修复，B 站视频 BV1j7aR6wE66 | [bbs.monster 帖 5209](https://bbs.monster/thread-5209-1-1.html) |

> **官方工作流是"对比演示"性质的**（含 bypass 的节点、作者本机路径 `Downloads/minimax_h3_ref2va_sharpness (1).safetensors`、分辨率只跑 672×384 的对比片段），直接导入要改路径。**要能直接跑的，用你机器上的 U27。**
> 本仓库已存档一份原件：`outputs/research/minimax_h3_lms_workflow_author.json`。

### 5.5 LMS 与「转真人」的关系

**LMS 不改身份、不改风格，只改锐度。** 它对这个场景的价值是**后期**：真人化角色最怕的不是糊，而是"塑料感 / 涂抹感"，而 LMS 的定位正是"把清晰、照片级的细节加回偏 soft 或过度平滑的输出"。

但也有两条硬限制：
- **一致性靠图像阶段和参考图，不靠 LMS**——动漫角色→真人的脸型/发色/服装一致性得靠 Krea2 + A2R 那条线，LMS 帮不上；
- LMS 训练在 **ref2va + guide latent** 上，**混用原生参考图是作者标注的"实验性，可能不会更好"**。

---

## 6. 行动清单（按性价比排序）

**Krea2 线（立刻能做，零风险）**

1. 生成档底模 **`krea2_turbo_fp8_scaled` → `krea2_turbo_int8_convrot`**（保真 + 速度双赢，工作流不用改结构）。
2. **步数 10 → 8**；确认 CFG = 1（不要 >1，会过饱和发灰）；**负面提示词删掉**（CFG=1 下无效）。
3. scheduler 建议 **`simple`** 做基线（`beta` 当风格旋钮）；确认没有多余的 shift 节点。
4. 试 **`Anime in real` v2.0-Krea2**（触发词 `Ani2rel`）对比 A2R V3；如果同时挂风格 LoRA，把 A2R 权重降到 **0.5–0.8**。
5. 编辑档底模可以从 `moodyAmateurMixKrea2_3JAVStyle`（JAV 片感、偏糊）换 `_4RawStudioShot`（RAW 棚拍）或 `Moody-Krea-Mix-v2G` 试画质。

**H3 线（想做视频再做）**

6. 先跑通最小闭环：`hybrid_fl2va_ref2va_b25-49-int8` + `nvfp4_awq` TE + `ref2v_turbo_4step@1.0` + **LMS@0.8** + `euler/simple/8 步/CFG 1` + 1344×768×124 帧。
7. 想上质量：把加速 LoRA 换成 **PDD Acc-8Step**（你机器上有节点包），Ref2VA 上细节 +42%；记住 shift 要配 12/3（或 768p 系 6/3），且**不能和其他蒸馏 LoRA 叠加**。
8. 放大器换成官方推荐的 **fp16** 版（现在装的是 fp32）；对画质没影响，只省显存。

**可选（要我动手就说）**

- 把 Krea2 的 8 步 / int8_convrot 改进画布的预设（`packages/shared/src/krea2.ts` 里的 `KREA2_EDIT_PRESETS` / `kreaDefaults`，在 worktree 分支上，未提交）。
- 把作者原版 LMS 工作流的 LoRA 路径改好、部署到你的工作流库。
- 在实例上实跑一次「Krea2 转真人 → H3 ref2va + LMS」的串联验证（要占 GPU，会先问你）。

---

## 7. 没查到 / 存疑（重要的先列这几条）

1. **「LMS」三个字母的全称：查不到**（官方与社区都没给）。本报告不做缩写臆测。
2. **「LoRA 是放大器的蒸馏版」不成立为已证事实**——官方只说两者用**同一个 sharpness 数据集**，没出现 distill 字样。只能说"同源同数据集"。
3. **H3 本地权重"是否 uncensored"未被受控证明**——官方没做本地 checkpoint 的行为评测，社区报告之间也有矛盾。"本地无审核层"是架构事实，"模型行为不受限"是未测量的推论。
4. **Krea2 许可证未逐条核对**（官方另有 Model Licensing 与 Community License 两页，企业部署另有条款）。**商用前必须自己读原文**：Krea 系 community license、MiniMax H3 系 community license + 地域排除，A2R 的 LoRA 标 Apache-2.0 但底模不是 Apache。
5. **`MASO`（RedCraft 命名里的标记）没有官方释义**；`mystic07`、`veda/..._8nfe`、`quantfunc_int4_r128` 的来源也没查到。
6. **实例上 `FeiHou_MiniMax-H3_Remix_HSA_turbo_v0.8` 与公开 HF 的 v0.6 对不上**，需要核对 Civitai 上的版本。
7. **Krea2 LoRA 生态覆盖率低**：实机 29 项里只有 6 项完整查到、7 项部分查到、**16 项没查到**——Krea2 从 2026-06 才开放，大量资产只在国内平台（liblib / ModelScope）流通。
8. **本次调研未跑任何生成任务**（遵守"不占显存、不重启、不关机"的红线），所有效果描述都来自官方文档、社区报道和你已有工作流的参数记录。

---

## 8. 第二轮补充（Dasiwa / 真人 NSFW / 一处更正）

> 首轮交付后追加了三份子报告：`outputs/research/dasiwa-series.md`、`h3-nsfw-best.md`、`krea2-nsfw-best.md`。

### 8.1 更正：shift 不是「错一个数字就崩」

§2.3 原来写「544p 系 12/3、768p 系 6/3，错配是结构性崩坏」——**这句说重了**。

- 那两个值是 **lightx2v 的作者推荐值**（v1.2 的 HF discussion #52：video shift 6 / audio shift 3），不是硬约束。
- **Dasiwa 作者给的蒸馏区间本身就是 video shift 6–12** —— 6 和 12 都在范围内。
- 你自己的工作流里两种并存：U24/U29/U34/U38 用 **12/3** 配 768p LoRA，U40 用 **6/3** 配 Dasiwa 底模，都能跑。
- **唯一 fail-closed 的是 Alibaba PDD Acc**：节点强制 12.0/3.0，写别的直接报错。

准确说法：**shift 按 LoRA / 底模作者的推荐值配对；只有 PDD Acc 是硬约束。**

### 8.2 Dasiwa 系列是什么

**第三方「整包底模」**（不是 544p/768p 那种 turbo LoRA 分代），来自 **darksidewalker** 的 **`dasiwa-quant-station`**（同一个作者还做了 `ComfyUI-DaSiWa-Nodes`，你那个 U10 导演台就是它）。

命名解码（直接读 `modelspec.title`）：

`dasiwa_minimax_h3_ref2va_v2_pruned_hybrid_turbo_int8_row-wise_convrot_runtime_mixed`

**Hybrid 的确切技术**（`DasiwaHybridV2` 元数据原文）：`base_model = minimax_h3_fl2va_pruned_bf16` + `overlay_model = minimax_h3_ref2va_pruned_bf16`，用 **SVD rank 1024、strength 0.85** 把 ref2va 的权重差叠进 fl2va；`h3_delta_energy` = adaln 100% / attn 55% / mlp 46% / out 100% / proj 93%。

| 你盘上的文件 | modelspec.title | 形态 |
|---|---|---|
| `dasiwaHybrid4turboV1` | `..._v1_pruned_hybrid_bf16_m_4turbo_...` | v1 + 4 步蒸馏已烘入 |
| `dasiwaHybrid8turboV1` | `..._v1_pruned_hybrid_bf16_m_8turbo_...` | v1 + 8 步蒸馏已烘入 |
| `dasiwaHybridV2_int8` | `..._v2_pruned_hybrid` | v2，无 turbo → 20–25 步 |
| `dasiwaHybridTurboV2_int8` | `..._v2_pruned_hybrid_turbo` | v2 + turbo |
| `dasiwaREF2VAHybridV1` | `..._v1_hybrid_pruned_int8_convrot` | v1，ref2va 侧重 |
| **`dasiwaHybridV4Turbo_int8`** | `dasiwa_minimax_h3_ref2va_v4_pruned_turbo` | **最新（10-10），v4 + turbo** |

**shift**：作者推荐蒸馏版 video shift **6–12** / audio 3–5、4 或 8 步；非蒸馏 10–12、20–25 步；**4 步只宜打样**。

**`curveproj1025` 是什么**：全宽 2688 维 AdaLN 经 **1025 点仿射最小二乘**投影到 pruned 的 8 维曲线表 `adaln_t_table`（模型 config 里 `adaln_curve_grid: 1025` 就是它），另存一个 FP32 `diff_b` 承载常数项。

**实测：那 4 个工作流的挂法到底对不对？** 那个 Dasiwa 专用 turbo LoRA 声明 `compatibility_scope: exact_checkpoint_sha256_only`，但 U24/U29/U34/U38 把它挂在**非 Dasiwa** 的 `hybrid_fl2va_ref2va_b25-49-int8` 上。我把三个底模的 `adaln_t_table`（F32 [1025, 8]，32,800 字节）哈希算出来对比：

| 底模 | 曲线表 sha256 |
|---|---|
| `hybrid_fl2va_ref2va_b25-49-int8` | `ac8727cdec52137c…` |
| `DasiwaMinimaxH3_dasiwaREF2VAHybridV1` | `ac8727cdec52137c…` ← **完全相同** |
| 官方 `minimax_h3_ref2va_pruned_int8_convrot` | `c02a6c1188829768…` ← 另一个 |

→ **曲线表没差**，不属于结构性错配；但主干权重不同，严格说不在契约保证范围内。

**其他**：`modelspec.watermark` **不影响画面**（X25519+AES-256-GCM 的元数据溯源签名）；**自带加速的底模不要再叠加速 LoRA**；pruned 与全宽 LoRA 不能混；作者正在 HF 对镜像站提删 —— **自用可以，别再分发**。

### 8.3 真人写实 NSFW：底模与 LoRA

**H3（视频）**

| 位置 | 推荐 | 依据 | 你的情况 |
|---|---|---|---|
| 底模 | **`10Eros_Max_h3_TURBO-hybrid_beta5_int8`** | HF 789 likes / 62 讨论（NSFW 类第一）；作者说 beta5 是「唯一真正可用的版本」；多个第三方 NSFW LoRA 直接把 "best with h3 eros max beta5" 写进文件名 | ✅ **你已经有**（20.97 GB，09-10） |
| ⚠️ 别用 | `..._beta4` | 作者在模型卡上标明 **beta3 / beta4 是 corrupted test versions** | 你也有 beta4 —— **别用那个** |
| 底模备选 | `PinkCherry v1.5 fl2va` | HF 452 likes，唯一带 20+ 自测样片 | 你有的是旧的 `beta-0.6` |
| LoRA·概念 | **`[MMH3] Mystic XXX` v2 或 v4**（Civitai 2856467，作者 alcaitiff） | TenStrip 亲自把它写进 10Eros 的官方用法 | 你有 V1 / V4，**缺 V2**（社区实测 V1 在纯 ref2va 上不可用） |
| LoRA·总合 | `HMNSFW-AIO-V2.5` | Civitai **28,438 downloads**（全类最高）；作者配方 `euler/simple/12 步/shift 6/turbo 0.5` | ❌ 没有 |
| LoRA·动作 | `h3_Better_NSFW_Motion_V1` | 7,635 downloads；作者配方 Mystic 0.8 + motion 0.9 + turbo 1 + motion adapter 1，**但训练数据是 3D 动画，真人要降到 0.5–0.7** | ✅ 有 |
| LoRA·写实 | `Realism People`（触发词 `r34l1sm`，0.6–1.0） | HF 469 likes / 83,195 downloads | ✅ 有（`h3-realism-people-...r34l1sm`） |
| 无审查 TE | ethanfel 的 Heretic 版 | HF 705 likes | ✅ 有 |

> **此处有三条纠正**：① `Cobijada` / `FeiHou Remix` / `Singularity` **都不是 NSFW 底模**——README 里连 NSFW 字样都没有，它们是功能型 hybrid / merge（我实机读元数据也印证了：Cobijada 只有一句 `converted_by: Star Ultimate Model Converter`）。② **`h3ErosMax_*` 是 Civitai 侧的文件名，HF 侧同一个模型叫 `10Eros_Max_*`** —— 同一个东西的两个名字。③ `beta6` 是**另一条路线**（10/3 shift、8–12 步、VSA 稀疏），**别套 beta5 的参数**。

**Krea2（图像）**

| 位置 | 推荐 | 依据 |
|---|---|---|
| **底模** | **`Krea2-SAT-DirtyRealism` → 最新版 `DirtyUncut`**（Civitai **2796522**，作者 Sateluco，16,824 dl / 671 赞，versionId 3372523） | 唯一用整段篇幅定义成人向的底模（*"strong focus on adult NSFW imagery"*）；6 版连续迭代；给了完整参数（896×1152、8 步、CFG 1、`Euler-SGM Uniform`、Hires denoise 0.15）；FP8 / INT8 ConvRot / INT4 / GGUF 四档；**许可最宽**（含 Sell / SellMerge） |
| 热度冠军（非专攻 NSFW） | `Moody Krea 2 Mix (uncensored)`（115,811 dl） | 多风格混合；许可最紧（`allowDerivatives=False`） |
| 并列候选 | `Kreamania` V4（24,666 dl，作者写 "completely uncensored"） | **有公开负评**（有用户称 V5 丢了写实感），故不列第一 |
| **LoRA·第 1** | ⭐ **`Krea2 TextFusion Refusal-Reduction LoRA`**（Civitai **2775340**，**51,771 dl**，strength **1.00**） | 改的是 **TextFusion + projector（合成 12 路文本编码器表示的那层）+ text MLP** —— **正是无审查文本编码器管不到的那一层**，与你现有方案互补 |
| **LoRA·第 2** | ⭐ **`Krea 2 NSFW V4`**（Civitai **2725430**，**104,410 dl**） | NSFW 概念本体；权重梯度 **0.8 → 1 → 1.2 → 2** |
| 触发词（你已有的两个） | `moodyAmateurMixKrea2` V3 = **`JAVPHOTOGRAPHY`**、V4 = **`MoodyStudioPhotography`** | 来自 Civitai 2859971（注意：它和 `Moody Krea 2 Mix` 2731187 是**两个不同的模型页**） |

> **你盘上几个文件的核对**：`Nick_baotunqun_Krea2` 对应平台上的 `Nick_bodycon_包臀裙`（拼音误记）；`KNP_V2_copy_copy-nsfw_1.5-2` 是 `Krea 2 NSFW` V2 的转存重命名件（`KNP` 只是它 v1 的触发词，V2 起已废弃）；`Pornmaster_QI2.1_Breasts_Slider_V1` 是 **Qwen 系的，不能挂 Krea2**；`Krea2-realism-V2`、`Nick_leggings_Krea2` 在平台上找不到同名条目（文件确实在你盘上，只是来源追不到）。

### 8.4 两条实务提醒

1. **底模会消失。** `Windy Krea Windy2 Turbo 0.1INT8`（Civitai 2785781）**API 已 404 下架**，CivArchive 标 Archived。你现在这套 H3 / Krea2 底模有相当一部分来自 Civitai 与国内平台，**建议挑核心的留档并记下 SHA256**。
2. **没有受控横评。** H3 与 Krea2 两个方向都**找不到任何第三方多底模同 seed 的横评**。上面所有「哪个最好」都基于 likes / downloads / 作者自述 / 单条评论 —— 权重与叠挂顺序是作者原话，但「这几件叠在一起」**没有第三方实测**。要定论只能自己 A/B。
