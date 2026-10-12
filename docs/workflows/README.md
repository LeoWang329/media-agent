# ComfyUI 工作流（手工用）

这里的 JSON 是**能直接在 ComfyUI 里打开**的工作流，跟我们程序里那套内置流程一一对应。
程序自己出图时不读这些文件（它按选项现生成图），放这儿是为了**手动跑、调参、对照**用。

## `krea2-real-all-switches-uncensored.json`

「动漫转真人」那条，就是我们系统里 `packages/shared/src/krea2Real.ts` 那套的界面版：
`Easy_QwenEdit2509` + `Krea2OstrisEditModelPatch(kv_cache=true)` + `euler/beta57` 8 步 CFG 1 +
V3 LoRA（model 和 clip 一起喂）+ 两张图各 `ColorCorrect(饱和度 −20)` / 长边 1536 +
反推那条 35B MoE 链（`force_offload=false`）。

**三个控件**（就是原作者那份「全开关」的三个）：

| 控件 | 干什么 |
| --- | --- |
| **① 用反推吗** | 开 = 提示词由反推模型看图现写；关 = 用「手输提示词」那一栏 |
| **② 双图吗** | 开 = `image2` 取图 2（决定长相），反推换成「双图」那套指令；关 = 图 2 退回图 1 |
| **手输提示词** | ① 关掉时用这句。**双图关着时触发词得自己写进去**（作者原话） |

`Easy_QwenEdit2509` 上还有 `image1_strength` / **`image2_strength`**（0–10）/ `image3_strength`。
实测：`image2_strength` 越大越往图 2 靠（发色、脸型、背景），但**调到 1.0 也不是换脸**，拿不到图 2 的具体五官；
0.3 那档最像图 1 真人化。想要「真像图 2 那个人」得靠人物 LoRA 或 ReID。

**跟作者原件（那台实例上的 `Krea2转真人-全开关（反推+单双图+手输）`）的三处差别**：

1. 底模 / 文字理解换成**无审查**那一对（`krea2/moodyAmateurMixKrea2_3JAVStyle_int8` +
   `qwen3vl_4b_uncensored_int8_convrot`）——用户拍过「无审查当默认，不做作者原版那一档」。
   想跑作者原版就把这两个名字换回 `krea2/krea2_turbo_fp8_scaled` + `qwen3vl_4b_fp8_scaled`。
2. 反推的两份系统提示词换成 `docs/krea2-real-reverse-prompt.md` 的**定稿版**（作者那份跟文档不完全一样，
   我们程序里跑的是文档这版）。原文直接写在两个 `PrimitiveStringMultiline` 节点里，界面上能改。
   里面那 8 个风格词（`looking at camera` / `look down` / …）写的是**示例**——是给反推模型看「这类词什么风格、
   颗粒度多细」的，**不是让它从里面挑**：图里有什么写什么，没有的别写，一个都对不上就一个都不写
   （2026-10-12 用户指出的坑，原先写成 `WORDS YOU MAY USE` 读起来像选项菜单）。
3. `SaveImage` 前缀改成 `Krea2转真人-无审查`。

另外：作者那份用的 `WorkflowNotes` 节点在有些实例上没装，这份换成了 ComfyUI 自带的
`PrimitiveStringMultiline`（输出同样是 STRING，接线没动）。

## 推到实例上要带的东西

这份工作流用到三个第三方节点包（有的镜像里没装）：

| 节点 | 包 |
| --- | --- |
| `Easy_QwenEdit2509` | `easy_qwenEdit_2509`（cardenluo） |
| `Krea2OstrisEditModelPatch` | `ComfyUI-Krea2-Ostris-Edit`（ostris） |
| `ColorCorrect` | `comfyui-art-venture`（sipherxyz，要装 `pycocoevalcap`） |

其余用的都是那台本来就有的：`ComfyUI-KJNodes`（`LazySwitchKJ`）、`ComfyUI_LayerStyle`
（`LayerUtility: Boolean` / `ImageScaleByAspectRatio V2`）、`rgthree-comfy`、`ComfyUI-Custom-Scripts`、
`llama-cpp_vllm`，以及 ComfyUI 本体的 `FluxKontextMultiReferenceLatentMethod` / `PrimitiveStringMultiline`。
装完包要重启 ComfyUI（ComfyUI-Manager 的 `POST /api/manager/reboot` 就行），重启后
`node outputs/devcheck/check-workflow-nodes.mjs <这份.json> <那台的 6006 地址>` 能核一遍节点齐不齐
（只有 `Note` 会报「缺」，那是界面自带的节点，不影响打开）。
