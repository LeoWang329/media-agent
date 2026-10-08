# Krea 2 的提示词怎么写

Krea 2 是 Krea 今年开源的文生图模型，有 Raw 和 Turbo 两版。Turbo 是蒸馏过的，8 步出图，最高 2K。文字编码用的是 Qwen3-VL 4B，VAE 用 Qwen Image 的。下面的规则来自官方仓库的说明和它给的扩写系统提示词，另外参考了 DaSiWa 节点包里给 Krea2 写的提示词指南。

## 和 IL、Pony 最不一样的地方

- 写英文整段话，不写标签。`1girl`、`masterpiece`、`best quality`、`8k` 这类标签和质量词没用，权重写法 `(xxx:1.3)` 也不用。
- 没有负面提示词。Turbo 跑 CFG 1，负面词不起作用；不想要的东西，就把「画面里有什么」写清楚。
- 越长越细越好。官方说长而细的提示词效果最好，但短的也能出不错的图；DaSiWa 的指南建议 80 到 250 个英文词。

## 写什么、按什么顺序

1. 主体和动作：谁、在干什么，用动词，比如「她俯身在工作台上，袖子挽到手肘」，不写「站姿」这种空词。
2. 媒介和画风：照片、插画、厚涂、赛璐璐、3D 渲染等。用户说了哪种就照哪种，没说的不要替他定。具体的参照比空泛的夸奖有用，比如「1970 年代柯达克罗姆胶片」「吉卜力背景美术」，不写「艺术感」「高质量」。
3. 环境：前景有什么、主体、背景有什么，写两三个具体的物件，不写一个笼统的类别（写「工作室」会画出一间空屋子）。
4. 光：光源和方向，比如「左边低低的夕阳，背后窗户进来的冷光」。官方的例子都写了光，社区的总结说这个模型对光的描述很敏感。
5. 材质和状态：「黄铜工作台边缘磨得发亮」「呢子大衣袖口起了球」，这是它画得最好的部分。拍真人的写皮肤：毛孔、细纹、雀斑、汗光、碎发。
6. 构图和镜头：需要时写景别、角度、焦段、景深。

## 小规则

- 要画出来的字放在双引号里，比如招牌上写着 "OPEN"；字越短越准，长段文字现在哪个模型都不稳。
- 只写看得见的东西。
- 用户写的东西都要保留，不加用户没提到的人物、道具、衣服颜色。光、材质、皮肤不算「加东西」，可以补。
- 用户的话本来就很细的，只润色，不大改。
- 给了参考图的，按用户说的从图里取（姿势、衣服、人物、场景），别的照用户的话写；用户没说的，就描述图里有什么。

## 官方扩写规则与本项目选择

官方的扩写系统提示词（`docs/expansion.txt`）第 8 条：画人要得体，默认衣服遮住私处。DaSiWa 的指南里另有一条：人物一律写成成年人。

本项目已定：人物写成成年人；衣服照用户要求写，不默认增加遮挡。决定记录在 `docs/requirements-interview-krea2.md`。

## 出处

- 官方说明：[krea-ai/krea-2 docs/prompting.md](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md)
- 官方扩写系统提示词：[krea-ai/krea-2 docs/expansion.txt](https://github.com/krea-ai/krea-2/blob/main/docs/expansion.txt)，原文存了一份在 `outputs/krea2/expansion.txt`（不进 git）
- DaSiWa 节点包的 Krea2 指南：`outputs/dasiwa/src/ComfyUI-DaSiWa-Nodes/data/llm_skills/krea2.md`（不进 git）
- 模型和 ComfyUI 的文件：[ComfyUI Wiki：Krea 2](https://comfyui-wiki.com/en/models/krea/krea-2)、[Krea 2 开源新闻](https://comfyui-wiki.com/en/news/2026-06-22-krea-2-open-source-text-to-image)
- 社区写法总结：[fal：Krea 2 Prompting Guide](https://fal.ai/learn/tools/krea-2-prompting-guide)
