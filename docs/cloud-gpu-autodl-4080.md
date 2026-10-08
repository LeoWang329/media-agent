# 云 GPU：AutoDL 4080 机器情况（2026-10-03 查看）

## 怎么连

- SSH：本机 `~/.ssh/config` 里已有别名 `autodl-4080`（connect.westd.seetacloud.com，端口 21746，用户 root，密钥 `~/.ssh/autodl_rsa`），直接 `ssh autodl-4080`。
- 网页控制面板：https://uu131241-7909216ef7bf.westd.seetacloud.com:8443 ，对应机器上的 6008 端口。

## 机器配置

| 项 | 值 |
|---|---|
| 显卡 | RTX 4080 SUPER，32GB 显存，驱动 580.76，CUDA 13.0 |
| CPU | 16 核（容器限额，`nproc` 显示的 208 是整台宿主机的） |
| 内存 | 80GB（容器限额，`free` 显示的 1TB 是宿主机的） |
| 磁盘 | 只有一块 30GB 系统盘，已用 15GB、剩 15GB。`/root/autodl-tmp` 没有单独挂数据盘，和系统盘共用 |
| 系统 | Ubuntu 22.04 |

## 装了什么

社区镜像「Zealman ComfyUI v9.31」：

- ComfyUI 0.37.0（镜像说明里写的是 0.34，实际已经是 0.37），Python 3.12，PyTorch 2.12.1+cu130，装了 197 个插件。
- 283 套预置工作流，按分类放在 `/root/ComfyUI/user/default/workflows/`，每类的说明在 `/root/工作流说明/*.md`。
- 模型大多是从 AutoDL 公共模型库链接过来的（`/.autodl-model/data`），不占本机磁盘。

## 正在跑的服务

| 端口 | 服务 | 外网能否访问 |
|---|---|---|
| 6006 | ComfyUI 本体 | 只监听 127.0.0.1，外面访问不到，要经过面板转发 |
| 6008 | Zealman 控制面板（node） | 映射到上面那个 8443 公网地址 |
| 8888 | JupyterLab | 从 AutoDL 控制台进 |
| 6007 | TensorBoard | 从 AutoDL 控制台进 |

查看时 ComfyUI 空闲、队列为空。ComfyUI 进程占着 7GB 显存，它自己报告还有 26GB 可用。

## 接口怎么调

面板对外提供 HTTP 接口，基地址就是 8443 公网地址。生成一次分两步：

1. `POST /api/workflow/generate`，请求体：

   ```json
   {
     "workflow_id": "API-U03-minimax_h3_文生视频基础版API-V2",
     "input_values": { "节点ID:字段名": "值" }
   }
   ```

   立刻返回 `prompt_id`，不等生成完。图片、音频这类文件参数可以填公网 URL、base64（约 50MB 上限），或者先调上传接口拿到文件名再填。
2. 每隔 1–3 秒 `GET /api/workflow/result?prompt_id=...`，直到 `pending` 为 false。`results` 里是产出文件的 `/output/...` 路径，拼上基地址就能下载。

`workflow_id` 只能填面板「API 生成」页里已经保存的工作流（见下一节）。每个工作流能改哪些参数（节点 ID、字段名）要到面板里看对应卡片。

从本机调用的情况：`/api/health` 返回 200，约 1 秒；`/api/comfy/status` 显示 ComfyUI 已就绪；`/api/workflow/list` 能拿到下面的列表。

完整接口说明在机器上：`/root/zealman-api接口说明.html`（v8.8，六十多个接口，除了生成还有面板管理、资产下载、多台机器并发调度）。

## 面板里已存好的 API 工作流（43 个）

跑过的（次数 / 最后一次）：

- API-U24-文武双修T8版：6 次，2026-09-24
- API-B18-Qwenimage2.1：2 次，2026-09-27
- API-U06-9图3音频-V5：2 次，2026-09-24
- API-U00-minimax_h3提示词QWEN3.8群主版：1 次，2026-09-27
- API-U08：1 次，2026-09-26

没跑过的：

- MiniMax-H3 视频：API-U32、API-U30、API-U06-9图版API-V5、API-U17-9图1视频3音频V1-api、API-U11-Minimax-图片音频对口型API、API-U09-9图版API-V2、API-U07-A、API-U03-minimax_h3_文生视频基础版API-V2、API-U03-minimax_h3_light2v-文生视频加速版API-V2、API-U02-minimax_h3_图生视频基础版-V2、API-U01-minimax_h3_基础版API
- LTX 视频：API-Y08-四宫格-LTX-2.3图生视频优化版、API-H41-AI代码侠土豆-LTX2.3-MSR多参考图生成、API-H31-ltx2.3声音-图像生成视频、API-H28-LTX2.3-高动态图生视频、API-H17-文图生视频-LTX2.3全面优化版
- Wan 视频：API-G10-图生视频-Wan2.2SmoothMixV2、API-G07-图生视频-Wan2.2-LightX2V-WorkFisher、API-G03-图生视频-Wan2.2SmoothMix、API-G02-首尾帧-Wan2.2首尾帧视频、API-G01-图生视频-Wan2.2万相基础版
- 动作迁移：API-P17-动作迁移4090-48G显卡专用V8、API-P07-动作迁移-Wan2.2AnimateV4、API-P02-动作迁移-Wan2.2Animate角色迁移
- 数字人 / 声音：API-J13-小珠光90秒全自动版-单人InfiniteTalk、API-J11-LTX2.3高清超自然电商数字人、API-N2-单人声音克隆FishAudioS2pro
- 图像：API-T4-Krea2-int8-角色设定三视图、API-T10-Krea2做剧图像4视图、API-D20-RAW画质重建Adonis_Workflow、API-D18-klein9b真人剧制造机-多图编辑、API-D14-分镜-Flux克莱因9B多角度多场景、API-C19-人物设定三视图zimage双采、API-C18-豹豹喵呜制作-白玉AIO三采超高清写真生成、API-C16-短剧文生图专用-支持场景-角色、API-B13-千问角色一键多角度_multiple_character_angles-v1.0、API-A08-洗图-Qwen二次元转真人高清放大、API-A01-文生图-Qwen2512高清放大

## 要注意的

- 面板接口没有任何鉴权：拿到 8443 地址的人都能提交任务、停掉 ComfyUI、清空输出目录，地址不要外传。
- `prompt_id` 只存在 ComfyUI 内存里，ComfyUI 一重启（关机再开、崩溃）旧的就查不到了。任务一完成就要把结果文件下载下来。
- 磁盘只剩 15GB，视频产出多了会满。目前输出目录 `/root/ComfyUI/output` 209MB，输入目录 `/root/ComfyUI/input` 917MB。
