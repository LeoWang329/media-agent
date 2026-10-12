# Krea2 转真人标准工作流修复（2026-10-12）

用户提供的 `C:/Users/leo.wang/Downloads/Krea2转真人-全开关（反推+单双图+手输）.json` 为本轮基准。原文件 SHA-256：`5ac1570605f859885f51c3f006dd5d08e7666ae3c95f00b3dbd49d43d33bb1de`。

## 修复

| 项目 | 修复前 | 标准及当前实现 |
| --- | --- | --- |
| 底模 | 默认旧 3JAV 模型 | `krea2/Krea2-Moody-Mix-premium_int8_convrot.safetensors` |
| CLIP | 默认旧 uncensored CLIP | `qwen3vl_4b_fp8_scaled.safetensors`，type `krea2` |
| LoRA | V3，缺少 body | 默认 V3 + `krea2/k2_nice_body.safetensors`，各 1；两条都作用于 model 与 clip |
| 反推输入 | 降饱和及缩放后的图 1 | LoadImage 原图；生成分支仍分别降饱和 -20、长边 1536 |
| 反推种子 | 随出图种子变化 | 独立固定 `556050744171086`，出图种子仍可变 |
| 输出 | PreviewImage | SaveImage + ShowText，前缀照标准 |
| 手输完整提示词 | 重复拼主触发词 | 已含主触发词的完整提示词直接使用；短要求保留原有自动补触发词行为 |

保留 8 步、CFG 1、euler、beta57、kv_cache、Easy_QwenEdit2509 的参数和输入位置。单图时 image2 接图 1；双图时两张图各自处理，反推仍只看图 1。

LazySwitchKJ 按开关选择展开；rgthree LoRA 栈展开为串行 LoraLoader，强度同时给 model 与 clip，与 [rgthree 的原实现](https://github.com/rgthree/rgthree-comfy/blob/d7297b42f0fa78bec1c0411478f887423c249502/py/lora_stack.py) 一致。None 槽位不会加载。

附件没有 WorkflowNotes 所读取的 UI 备注正文，因此沿用本项目 `docs/krea2-real-reverse-prompt.md` 已记录的单图和双图指令。没有声称附件含有这些正文。参考图片文件名、手输示例和 ShowText 缓存属于运行数据；回归 fixture 使用普通衣着场景，去掉缓存文本，源附件不改动。

旧 `uncensored` 保存字段继续读取；新的转真人任务统一使用标准组合。其他编辑功能的模型选择不在本轮改变。

## 验证

- `packages/server/test/krea2RealWorkflow.test.ts`：反推/手输 × 单图/双图四种组合，完整递归比较 KSampler、SaveImage、ShowText 的依赖链及每个输入；先复现差异，再修复通过。
- 全量 vitest：36 个文件，429 项通过、1 项原有跳过。后续 SelfLift 写词修复单独覆盖生成服务和视频参数，74 项通过。
- 类型检查通过；浏览器全量 109 项通过，1 项 LoRA 列表预期遗漏 body 已补齐，最终相关 38 项全部通过。
- 真机使用用户指定的运行中 `pro-788815c418ec`（RTX 5090、ComfyUI 0.38.0），没有修改本机选中的生图实例，也没有启动其他实例。

## 真机记录

使用本地既有的正常衣着动漫雨夜街景图 `outputs/p23-p24-real/B1-原图.png`，固定出图种子 `122668227639236`。下表时间来自 `/history` 中 execution_start 到 execution_success，不含等待其他任务的排队时间。

| 模式 | Prompt ID | 结果 | 执行时间 |
| --- | --- | --- | --- |
| 手输 + 单图 | `78b138b4-7714-4e86-9b03-3f189fe69191` | success，1048×1536 | 76.470 秒 |
| 反推 + 单图 | `103767a1-b62e-4af7-8859-4258d353a964` | success，1048×1536 | 37.897 秒 |
| 手输 + 双图 | `075da80c-bf8b-4e4f-aa73-45eba69cb8cf` | success，1048×1536 | 31.286 秒 |
| 反推 + 双图 | `1a25feb5-99df-4739-875f-e7bcc59704fa` | success，1048×1536 | 41.838 秒 |

四张输出已检查：原有衣着、人物构图及雨夜街景保持，输出为写实人物。双图测试用手输单图的生成结果作为图 2，验证完整双图执行链及输出，不把同一人物参考测试当成不同人物换脸质量测试。单图反推的 ShowText 实际输出 55 词，以主触发词开头，直接进入 Easy_QwenEdit2509。输入、执行链、history 及输出文件保存在本机忽略目录 `outputs/krea2-standard/`；测试结果不能推断所有人物输入的质量。

环境问题：本机配置的生图实例 `pro-79110c14fb03` 已不在账号的实例列表。本轮按用户明确选择，仅用开着的 H3 机验证，没有改共享 settings 或本机 Token。正式使用生图入口前，应在设置中选有效实例。

## 实现定位

- `packages/shared/src/edit.ts`：标准模型、固定 body LoRA、手输完整提示词。
- `packages/shared/src/krea2Real.ts`：原图反推、独立种子、预处理及采样链、保存及文本出口。
- `packages/server/src/comfy/jobs.ts`：转真人参数落盘。
- `packages/client/src/canvas/EditPanel.tsx`：标准工作流说明。
