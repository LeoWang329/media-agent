# SelfLift 完成状态和一采预览修复（2026-10-12）

本报告记录同日第一轮仅用 mock 验证的历史状态。后续已补齐 H3 打包潜变量兼容、分段时长和真实 GPU 验证；最新结果见 [长视频修复与真机验收](selflift-duration-20261012.md)，下文的“未提交 / 未真机验证”仅指第一轮收尾时。

用户确认：要在低清采样结束、高分辨率采样仍在跑时显示预览，不等第一段完整生成。

## 完成状态为什么会回退

1. `canvasStore` 读取节点、手动编辑回复等操作会收到整份节点或 messages。较早的请求返回 `running` 时，如果 `done` 事件已先到页面，旧响应仍会覆盖它。浏览器用例控制节点 GET 响应晚到，已复现从 `done` 回到 `running`。
2. `videoStore` 的 EventSource 会自动重连，但原来只有 `onmessage`，没有在 `onopen` 补读任务。服务端 SSE 重连只重放进度/队列/实例状态，不重放断线期间的任务完成事件。浏览器用例屏蔽这段消息后恢复连接，已复现后端完成而页面停在 `running`。

修复：整份节点和 messages 合并时按 `VideoJob.rev` 保留较新任务；重连时只补读当前画布里仍显示运行中的节点，并把任务更新进状态，不替换草稿或生成设置。补读也按 rev 检查，避免补读响应覆盖更晚的推送。

涉及 `packages/client/src/store/canvasStore.ts`、`store/videoStore.ts`、`canvas/videoActions.ts`、`pages/Canvas.tsx`。

## 低清预览为什么没有先出现

原 SelfLift 流程只有一个 `SelfLiftH3Sampler`，低清和高清都在节点内部完成，节点只返回最终 LATENT。原有 SelfLift 预览是第一段完整片段下载；只有几秒的单段任务也要等高清完成、最终拼接开始后才有，不能充当一采预览。

增加 `tools/comfyui-media-agent` 扩展：给低清 MODEL 的副本挂 post-CFG 回调，在最后一次低清 x0 预测后解码、存 H.264 MP4，立即推送。继续用原来的 SelfLift 采样器、步数、种子、升分辨率算法和高低清 LoRA。没有额外模型采样，但会增加一次 VAE 解码和视频编码的时间/显存开销。

服务端每次提交直接查询这个可选节点，安装扩展后不受旧节点缓存影响；仅给第一次新出的片段挂这个出口，续写起点剪掉上下文帧。`previewKind` 区分一采低清画面与第一段完整片段。画面预览没有声音，最终成片声音仍走原流程。低清之后叫停且第一段尚未完整出完时，会留下低清预览供播放、下载，界面明确它不是完整成片。

没有安装扩展时仍能生成，沿用第一段完整预览；安装和重启说明见 [扩展 README](../../tools/comfyui-media-agent/README.md)。本轮没有安装到真实实例，没有连接真实 ComfyUI/AutoDL，也没有运行真实生视频模型。

协议来源：[SelfLift U37 所用版本的低清 x0/过渡实现](https://github.com/facok/comfyui-SelfLift/blob/353418455f97c3ab9e35a6e27243cc2c5488307e/nodes.py)、[ComfyUI post-CFG 回调](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/samplers.py)、[ComfyUI 视频输入实现](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_video.py)。

## 验证

- `npm run typecheck` 通过。
- 视频 shared + 服务端测试：89 条通过，覆盖新预览提前到达、成片完成、低清阶段叫停、未安装扩展兼容，以及原有接力、续写、重拍、存档流程。改为直接查询可选节点后再跑三项 SelfLift 集成回归，也全部通过，包括“先没装、再安装”时从完整片段预览切换到低清预览。
- mock-comfyui 测试：4 条通过。
- Python 扩展测试：3 条通过；验证只在低清边界导出一次、保持预测返回值、预览失败不阻止后续采样、视频批次维度和上下文裁剪。它们使用 ComfyUI API 替身，不证明 GPU 上的 VAE/编码和显存效果。
- 视频浏览器用例：整套 19 条通过；节点旧响应的回退随后也已复现并修复，最后重跑三项 SelfLift 回归（重连、预览、旧响应覆盖）全部通过。
- E2E 独立端口：应用 3912、Comfy 3998、LLM 3999、SSH 3997；工作目录为系统临时目录中的 `media-agent-selflift-fix`，没有复用本机 dev mock 或真实配置。

保留此前的分支合并暂存区；本轮修改未提交、未推送。
