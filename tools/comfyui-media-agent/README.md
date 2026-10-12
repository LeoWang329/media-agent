# SelfLift 一采预览扩展

将这个目录（保留 `__init__.py`）复制到生成视频实例的 `ComfyUI/custom_nodes/comfyui-media-agent/`，然后在没有任务运行时重启 ComfyUI。
无需安装额外 Python 依赖。依赖实例原有的 ComfyUI 视频 API（`comfy_api.latest.InputImpl.VideoFromComponents`，与程序已用的 CreateVideo / SaveVideo 同一套）。

程序每次提交 SelfLift 任务时检查 `MediaAgentSelfLiftPreview` 是否存在：存在就给第一次新出的片段挂预览；不存在仍能生成，沿用第一段完整生成后才显示预览的行为。

扩展给低清 MODEL 的副本挂一个 `sampler_post_cfg_function`，在第 `transition_step` 次模型预测后将 x0 解码成 H.264 MP4，并发给当前任务的客户端。SelfLift 原节点、调度、种子和高低清 LoRA 继续照原工作流走，没有重复采样。VAE 解码和编码会增加少量等待及显存占用；这里的一采预览只有画面，最终成片仍按原流程生成声音。

续写起点时会剪掉前面的上下文帧；第 2 段以后的采样不再挂这个扩展。预览失败只记日志，继续生成高清结果。

2026-10-12 在 RTX 5090 / ComfyUI 0.38.0 上验证通过：81 秒收到低清预览，首段完整结果 197 秒后取得，20 秒接续视频合并后实际 20.04 秒。H3 的 post-CFG 数据需要按 latent_shapes 拆出画面再解码，回归包含这个实际接口格式。详见 [真机记录](../../docs/reports/selflift-duration-20261012.md)。

本地验证（不运行 GPU、真实 ComfyUI 或 AutoDL）：

```powershell
python -m unittest discover -s tools/comfyui-media-agent/tests
```

协议参考：[ComfyUI 的 post-CFG 回调](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/samplers.py)；[SelfLift 的低清 x0 和过渡步骤](https://github.com/facok/comfyui-SelfLift/blob/353418455f97c3ab9e35a6e27243cc2c5488307e/nodes.py)。
