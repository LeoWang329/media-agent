# Krea2 内置流程

需求记录：`docs/requirements-interview-krea2.md`。原流程记录：`outputs/krea2/T01*.json`、`T10*.json` 和 `object_info.json`，均不进 Git。

## 使用

1. 新建生图节点，系统提示词选 `krea2`。对话回复使用英文段落框，能手动修改、翻译、打星和生图。
2. 文生图：面板选尺寸、张数；出图设置里调底模、文字理解模型、VAE、LoRA、步数、CFG、采样器、调度器和种子。
3. 四视图模式：出图设置的起图选“四视图”，从槽位或已出的图中选参考图，调相似度，再点框上的生图。固定四视图指令在前，框中文字作为额外要求。
4. 直接做四视图：槽位图的菜单、生成图下方按钮和大图窗口都提供入口。可以补充英文要求，不调用写提示词的模型。槽位图新建“四视图”框；生成图的结果挂回原框。
5. 所有生图系列都能直接做四视图。IL/Pony 节点的系列和出图设置不改动；默认用 T10。Krea2 节点已选四视图模式时，直接入口沿用该节点的参数，只出一张。
6. 预设按系列保存，Krea2 单独一组。预设保留模式、模型和相似度，不保存参考图、张数与种子。

## 默认参数

| 参数 | 文生图（T01） | 四视图（T10） |
| --- | --- | --- |
| 底模 | `krea2/darkBeastINT8Convrot2_krea211INT8Convrot.safetensors` | `krea/krea2_turbo_int8_convrot.safetensors` |
| 文字理解 | `qwen3vl_4b_uncensored_int8_convrot.safetensors` | `qwen3vl_4b_fp8_scaled.safetensors` |
| VAE | `qwen_image_vae.safetensors` | 同左 |
| LoRA | 默认不挂，可串接多个 | `krea2/krea2_4panel.safetensors`，强度 1，可改 |
| 尺寸 | 1536×2728（原 9:16、4 MP、8 的倍数） | 1536×1024 |
| 步数 / CFG | 8 / 1 | 10 / 1 |
| 采样器 / 调度器 | euler / simple | 同左 |
| 张数 | 1，可改为 1–8 | 模式入口用节点张数；直接入口只出 1 张 |
| 相似度 | 不使用 | 1，可调 0–10 |

T01 尺寸按 [ComfyUI ResolutionSelector 的原公式](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_resolution.py)计算，1 MP 是 1024² 像素。自定义尺寸 64–4096；文生图取 8 的倍数，四视图取 16 的倍数以匹配 `EmptySD3LatentImage`。

## 实现与边界

- `packages/shared/src/krea2.ts` 拼内置 API 图。文生图将 LoRA 串入模型；四视图保留原参考图编码路径，并将采样用的 `target_latent` 接到模型补丁。
- 复用已有出图队列、进度、临时文件、下载、重出与 AutoDL 开关机，不增加另一套任务系统。
- `docs/prompts/krea2.md` 和 `format-requirement-krea2.md` 分开维护语义规则与输出格式。旧工作文件夹自动补提示词，不覆盖用户改过的同名文件。
- 不走 Danbooru 校验，不添加质量前缀、评级词或负面词。当前支持 Turbo；模型下拉排除 Raw 和旧 Flux-Krea。
- 这期不提供 Krea2 放大、部位重绘和 ControlNet。
- 缺少 `ComfyUI-Krea2Edit` / `ComfyUI-KJNodes` 时沿用缺节点提示，任务不提交。
- 相似度默认保留 T10 的 1。按项目 `AGENTS.md` 的测试规则，只运行 mock，不进行真机出片或 1 与 4 的品质对比。

## 验证

- `packages/server/test/krea2.test.ts`：模型选项、跨系列参数、英文段落、多 LoRA、重复出图、参考图内容、固定指令、target_latent、结果归属、缺插件和预设。
- `tests/e2e/18-krea2.spec.ts`：文生图、参数与翻译、四视图模式、预设、IL 直接入口及刷新保存。
- 两套生成图对照 2026-10-08 保存的真实 `object_info.json` 检查节点、必填项、选项和连线类型。
- 全仓单元/集成测试与浏览器回归结果记在 `docs/reports/krea2-integration.md`。
