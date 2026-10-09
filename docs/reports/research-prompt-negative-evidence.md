# AI 视频生成提示词：反面证据与评测方法

> 强度：**强**＝官方/论文原文可核对；**中**＝官方示例或间接推得；**弱**＝社区观察。URL 均实际抓取（2026-10-09），例外见文末。

## 一、失败模式与成因

| 失败模式 | 成因与解法 | 强度/性质 |
|---|---|---|
| 人物漂移 | VBench 单列 subject consistency；Sora 2 承认措辞微小变化即可改变身份与姿势。**靠参考图，不靠形容词** | 强/论文+官方 |
| 动作僵硬/偏慢 | 训练数据偏差。DenseDPO：标注者在两段独立生成间选优，**会系统性偏向低运动片段，因其瑕疵更少**。Motion Prompting：纯文本难以捕捉动作时序的细微差别 | 强/论文 |
| 肢体崩坏/多指 | VBench-2.0 把解剖学正确性归入 Human Fidelity，明说模型在**解剖学与构图完整性**上仍失败 | 强/论文 |
| 闪烁/纹理沸腾 | VBench 专维度 temporal flickering | 强/基准实现 |
| 主体不动只有背景动 | Runway：**详细复述输入图已有内容会导致运动减少**；应聚焦描述运动，并显式写 locked camera | 强/官方 |
| 镜头不动或乱动 | Sora 2：每镜头只给一个镜头运动 + 一个主体动作 | 强/官方 |
| 多主体混乱 | Runway：用位置或标识——「左边的对象向前走，右边的保持不动」 | 强/官方 |
| 口型不匹配 | Sora 2：对话放独立 `<dialogue>` 块，多人场景固定说话人标签；冗长台词难以同步 | 强/官方 |
| 指令冲突/风格漂移 | Runway：5–10 秒内塞多次场景转换、多主体动作或风格切换，会因模型调和「矛盾指令」而失控 | 强/官方 |

## 二、学术与基准

| 基准 | 年份 | 维度 | 含义 |
|---|---|---|---|
| [VBench](https://arxiv.org/abs/2311.17982) | 2023，CVPR 2024 Highlight | 16 维：subject/background consistency、temporal flickering、motion smoothness、aesthetic/imaging quality、dynamic degree、object class、multiple objects、human action、color、spatial relationship、scene、appearance/temporal style、overall consistency | 逐维打分 |
| [VBench-2.0](https://arxiv.org/abs/2503.21755) | 2025 | Human Fidelity、Controllability、Creativity、Physics、Commonsense | 减少需模型推理的成分 |
| [VideoScore](https://aclanthology.org/2024.emnlp-main.127/) | 2024，EMNLP | 学习人类多维打分作自动代理 | 与人类 Spearman 77.1，可作粗筛 |

**提示词具体程度对质量的影响**（本任务核心问题）：
- [Motion Prompting](https://arxiv.org/abs/2412.02700)（CVPR 2025）：文本对动作时序控制不足，故改用运动轨迹作条件，并把高层请求展开为半稠密运动提示。**能用轨迹/首尾帧就别只靠形容词。**
- [RAPO](https://openaccess.thecvf.com/content/CVPR2025/html/Gao_The_Devil_is_in_the_Prompts_Retrieval-Augmented_Prompt_Optimization_for_CVPR_2025_paper.html)（CVPR 2025）：检索增强的提示词优化能同时提升静态与动态维度。**具体化的收益在「动态」上可测。**
- 「越长越好」：**未找到支持该说法的论文。**

## 三、提示词重写/增强：收益与副作用

**收益（强）。** [VPO](https://openaccess.thecvf.com//content/ICCV2025/html/Cheng_VPO_Aligning_Text-to-Video_Generation_Models_with_Prompt_Optimization_ICCV_2025_paper.html)（ICCV 2025）：视频模型在「高度详细」的文本-视频对上训练，而用户输入往往「简短、含糊或结构混乱」；VPO 用文本级+视频级反馈做偏好学习，优于基线。Wan2.2 官方亦建议启用。

**副作用（反面证据关键）：**
1. **扭曲用户意图**——VPO 点名现有 LLM 重写「may distort user intent, omit critical details, or introduce safety risks」（强/论文）。
2. **加入用户没要的镜头**——HunyuanVideo-1.5 官方对照显示，重写给「DJ 沉浸在自己的音乐世界」补上 `slowly advancing medium shot`，给「叶上露珠」补上镜头缓慢下摇（中/官方示例）。**要严格控镜头就得关掉重写。**
3. **收益小且反噬**——DialectGen：重写对方言表现仅提升 <7%，却可能拖累标准美式英语（强，https://arxiv.org/abs/2510.14949 ）。
4. **重写默认开着**——HunyuanVideo-1.5 的 `--rewrite` 默认 true，官方称关闭「可能导致视频质量下降」（强/官方）。

## 四、负面提示词在视频模型里有效吗

| 模型 | 独立负面提示词 | 证据 |
|---|---|---|
| Sora 2 | **无**（API 参数仅 model/size/seconds/characters） | 强/官方 |
| Veo 3.1 | **无**，官方建议在正面句写排除：「a desolate landscape with no buildings or roads」优于「no man-made structures」 | 强/官方 |
| Runway Gen-4 | **不支持**：「Negative phrasing is not supported and may produce unpredictable or even opposite results」 | 强/官方 |
| Kling 3.0 | 无独立字段，官方注明 prompt「可包含正面和负面描述」 | 强/官方 |
| LTX-2 | API 有 `negative_prompt` | 强/diffusers 文档 |
| HunyuanVideo-1.5 | 有 `--negative_prompt`（默认空） | 强/官方 README |
| Wan2.2 | 官方 README **未列出**该参数 | 未找到 |

**核心机制：cfg=1 时负面提示词在数学上恒等于无效。** ComfyUI 官方模板仓库 issue #919 给出 `out = uncond + cfg × (cond − uncond)`；`cfg = 1` 时 `out = cond`，负分支被消掉且 `CFGGuider` 会跳过 uncond 前向。该 issue 核对五个 LTX-2.3 模板，全部 cfg=1 而负面框预填 `pc game, ... ugly`——**改了等于没改，属虚假可供性**（强/官方 issue，2026-06-03 仍 open）。

更根本的机制：[NAG](https://arxiv.org/abs/2505.21179) 指出 CFG 在激进采样步压缩（few-step）下会因正负分支预测发散而失效。**现代视频模型普遍走少步蒸馏，负面提示词空间被结构性压缩（强/论文）。**

**能 / 不能：** 在 cfg>1 的非蒸馏模型上，抑制明确的画质/风格词有一定作用（中）。**不能**修复手部多指、肢体变形或闪烁——无任何官方或论文如此声称，Runway 还说不支持且可能反向。

## 五、评测与迭代方法

官方方法几乎一致：Runway「一次只加一个新元素」并先写最简基础提示词；Sora 2「编辑是为了微调而不是赌博」，镜头不理想就「冻结镜头、简化动作、清空背景，跑通后再逐层加复杂度」；同一提示词多次生成结果必不同，单次对比无意义（均强/官方）。

流程：① 固定全部非提示词变量（种子、分辨率、步数、cfg、采样器）并**确认重写开关**；② 建立最短可运行基线；③ 单变量阶梯，每档改一项、每档 ≥3 个种子；④ 按 VBench 维度自评（至少 subject consistency、temporal flickering、motion smoothness、dynamic degree）；⑤ 只有跨种子稳定复现的差异才算提示词效果。

## 六、明确没有证据支持的说法

- **「负面提示词能防手部崩坏/多指」——无证据，且有反向证据。** Sora 2 与 Veo 3.1 无该参数、Runway 明确不支持、LTX 模板在 cfg=1 下静默失效（强）。
- **「提示词越长越好」——不成立。** Sora 2：更长更详细的提示词「会限制模型创造力」，它会更努力遵循引导「但可能并不总是可靠地做到」；Runway：「不要低估简洁的力量」。HunyuanVideo-1.5 相反：「写更长更详细的提示词，生成视频会显著改善」。**长度没有普适最优（强，均为官方）。**
- **「负面提示词能统一画风」——未找到证据。** 风格漂移由 VBench 的 appearance/temporal style 度量。
- **「负面提示词能消除闪烁」——未找到证据。** 闪烁由时序结构决定，是 temporal flickering 维度。
- **「写 'no camera movement' 能锁住镜头」——有反向证据。** Runway 把 `No camera movement. The camera doesn't move. NO MOVEMENT` 判为错，正确写法是正面句 `Locked camera. The camera remains still.`（强）。
- **未找到**：量化「提示词长度 vs 视频质量」的论文；专门评测视频负面提示词有效性的基准。

## 七、提示词写作清单

1. 先写「一个主体 + 一个动作 + 一个镜头运动」，跑通再逐项叠加，每轮只改一个变量。
2. 动作写成可数的秒级节拍（「走四步到窗边，停顿，最后一秒拉上窗帘」）。
3. 想有运动就别复述画面里已有的外貌细节——复述会压低运动量。
4. 段内不要出现两个镜头运动、两个主体动作或两次风格切换。
5. 多主体用位置或简单标识分派动作，不要用代词。
6. 身份一致靠参考图 + 跨镜头复用同一措辞，不靠形容词。
7. 想排除某物就写进正面句，不要依赖负面提示词字段。
8. 用负面提示词前先确认 cfg>1，否则该字段恒等于无效。
9. 长台词拆短句并标注说话人，单段时长对应一两轮对话。
10. 对比测试固定种子与全部采样参数、每档 ≥3 个种子。

---
**未能验证**：PromptEnhancer（CVPR 2026）PDF 无法解析；Wan2.2 是否支持负面提示词在官方 README 未找到；Google 官方 Veo 3.1 博文抓取仅返回空正文，其结论经逐字转载该博文的[镜像页](https://chromeosphere.com/the-ultimate-prompting-guide-for-veo-3-1/)核对。

主要来源：[VBench](https://arxiv.org/abs/2311.17982)、[VBench-2.0](https://arxiv.org/abs/2503.21755)、[VideoScore](https://aclanthology.org/2024.emnlp-main.127/)、[DenseDPO](https://arxiv.org/abs/2506.03517)、[Motion Prompting](https://arxiv.org/abs/2412.02700)、[VPO](https://openaccess.thecvf.com//content/ICCV2025/html/Cheng_VPO_Aligning_Text-to-Video_Generation_Models_with_Prompt_Optimization_ICCV_2025_paper.html)、[NAG](https://arxiv.org/abs/2505.21179)、[ComfyUI issue #919](https://github.com/Comfy-Org/workflow_templates/issues/919)、[Sora 2 指南](https://developers.openai.com/cookbook/examples/sora/sora2_prompting_guide)、[Runway Gen-4 指南](https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide)、[HunyuanVideo-1.5](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5)、[Wan2.2](https://github.com/Wan-Video/Wan2.2)、[Kling API](https://kling.ai/document-api/api/video/3-0-omni/text-to-video)。
