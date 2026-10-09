# 视频提示词怎么写出"变化"：调研

2026-10-09 查的。写给 MiniMax H3（本项目五套视频提示词对应的模型），另有其他模型的差异点。配套的抄用部分在 `docs/video-prompt-change-writing.md`。

要解决的问题：提示词里写「她很高兴」「气氛紧张」「画面很美」这类空话，模型收到的是标签而不是内容，只能给一个通用表情、一段静态画面。要写的是**从什么状态变成什么状态**。

---

## 一、结论

1. **「变化」是官方要求，不是我们的偏好。** H3 官方 Ref2VA 指南要求每个镜头写清「当前构图、主体外观与位置、环境与光线、**动作与状态变化**、运镜、当前声音」，并明确说不要写成剧情梗概。官方 Skill 的效果建议是「优先写具体的视觉和听觉细节，而不是 cinematic、beautiful 这类抽象词」。
2. **把情绪拆成过程**：起态（原来的表情）→ 触发 → 哪个部位先动、动多少、多久 → 落态 ＋ 压不住的泄露。**只给一个峰值，模型会从头保持到尾，看起来就是一张静止的脸**（宏观表情 0.5–4 秒、微表情不到半秒）。
3. **一次 2–4 个通道，多通道叠加，不做单点映射。** 别写"皱眉＝愤怒"，要写面部 ＋ 呼吸 ＋ 手 ＋ 重心 ＋ 视线 ＋ 声音里的两到四路，让模型从冗余线索里推断。
4. **最好用的是"反向组合"：脸上在压，身体在漏**（抿唇 ＋ 气息发抖）。这最不容易糊成"通用夸张表演"。
5. **不只是脸**：视线、手、肩颈、重心、呼吸、吞咽、喉结、皮肤血色，比表情更容易被模型画对，也更便宜。
6. **环境、光、影子、物体也要各自有变化**，否则只有一个人在动，画面会"演"。复杂动作拆成状态机（门关闭 → 手接近 → 握住 → 铰链转 → 全开 → 手松开）。
7. **一个时间切片（2–3 秒）只放一个主状态变化**，最多带一个联动细节；一个镜头只留一个运镜 ＋ 一个主体动作。一个镜头里画面和镜头至少有一个在变，两个都静止就是一张图。
8. **变化量要跟时长对齐**：2–3 个镜头在 15 秒里最稳；台词长度按每秒 2.5 个英文词（中文 4–5 字）估，末尾留约 1 秒收尾。但"几秒能演几个动作"没有通用换算表，同一段 10 秒提示词在不同模型上跑出的动作量能差一倍。
9. **空的通病有五种**：情绪词、评价词、比喻、心理意图、氛围标签。替换规则见配套手册第二节。
10. **运动类崩坏别跟负面词较劲**：负面词只在 cfg>1 的非蒸馏模型上对静态画质类有效；本地少步蒸馏工作流常见 cfg=1，那时负面词**数学上完全无效**。对跨帧的闪烁、漂移、多指更是基本没用，要往上游改（缩短镜头、一次只留一个不稳定元素、锁参考图或 seed）。


---

## 二、H3 官方怎么说

来源是官方仓库里的三份文件：Base 指南（T2VA／I2VA／FL2VA／L2VA）、Ref2VA 指南、`h3-prompt-writing` Skill。原文核对下来的相关条目：

**要求写"状态变化"**（Ref2VA 指南 `detailed_description` 一节）：

> For each shot, clearly establish the current composition, subject appearance and position, environment and lighting, **actions and state changes**, camera movement, current sound, and the points where referenced content actually appears or takes effect. Avoid reducing the description to a plot summary or a list of reference relationships.

**优先具体、别用抽象词**（官方 Skill "Tips for Better Results"）：

> Prefer concrete visual and audio details over abstract words like "cinematic" or "beautiful".

官方 Skill 的输出规则里还有一条：不要写成剧情梗概（Avoid plot summaries）。

**每个细节都要看得见或听得见**（Base 指南 4.1）：

> Every detail should correspond to something visible or audible: visual style, initial composition, subject appearance and position, scene and key props, actions and reactions, shot changes, spoken language, and synchronized diegetic sound.

**关键帧任务写的是路径，不是两张图的描述**（Base 指南 3.2／3.3）：

- FL2VA：`first-frame state → observable intermediate changes → progressively narrowing differences → last-frame state`，官方还特别说"不要把两张静态图各描述一遍，要给出连接它们的运动路径"。
- I2VA：`first-frame anchor → action onset → continuous development → result or reaction`。
- L2VA：`plausible preceding state → explicit action and transition path → gradual convergence in the final shot → last-frame landing`。

**动作写不实会出问题，官方给的答案是把动作拆成可执行步骤**。第三方转录的官方《H3 使用手册》第四章给出的公式是「完整提示词 = 参考素材说明 + 核心创意 + 画面过程说明」，并明确两条：

- 参考素材要写清用途（人物参考／动作参考／运镜参考／关键帧……），没写用途等于没给。
- 「尽量少写比喻句，多写看得见的画面」，并给了例子：`0-3 秒：全景，女子从画面左侧缓步走入樱花庭院，背景虚化，没有对白，只有脚步声。`

**切镜**：官方要求切镜必须带来新信息（新主体、空间、状态、视角、时间），只是靠近一点或换个小角度就用运镜，不要浪费一个 cut。

**时间预算**：H3 一次 4–15 秒；官方没有给"一秒能演几个动作"的硬指标，第三方的 H3 提示词工程手册（按官方文档整理，见出处）给的经验是单镜一个主要动作目标、2 镜最稳、3 镜可以、4 镜以上容易漂。本项目的 `docs/research-h3-long-video.md` 记了另一条硬约束：帧数只能取 17 的倍数加 5，实际时长是对齐过格子的（5.167／8.000／10.125／12.250／15.083 秒）。

## 三、其他模型官方指南：能借的四条

各家的官方指南在结构上不一样，但"怎么写变化"这件事上高度一致，有四条可以跨模型借：

1. **一个镜头只留一个运镜 ＋ 一个主体动作。** Sora 2 官方指南原话：`Movement is often the hardest part to get right, so keep it simple. Each shot should have one clear camera move and one clear subject action.` Veo 3 的说法是复杂动作要写"逐拍"（play-by-play），而不是堆形容词。
2. **动作写到拍点，不写意图。** Sora 官方给的对比例子最有说服力：弱写法 `Actor walks across the room.`，强写法 `Actor takes four steps to the window, pauses, and pulls the curtain in the final second.`——步数、停一下、最后一秒，全是可以数出来的东西。Runway 的官方说法是：抽象概念会迫使模型自己解释你的意图，结果往往是随机运动（反例 `The subject embodies the essence of joyful greeting…`，正例 `The woman smiles and waves.`）。
3. **抽象词换成可见物。** Sora 官方：不写"漂亮的街道"，写"湿沥青、斑马线、霓虹灯的反光"；不写"电影感"，写"2.0x 变形镜头、浅景深、体积光"。Runway 也强调这类替换。
4. **别把否定式当刹车。** Runway Gen-4 官方明确不支持否定式，写了可能得到相反结果：`No camera movement. The camera doesn't move. NO MOVEMENT` 不如 `Locked camera. The camera remains still.` H3 这边没有负面提示词字段，同理：不想要的，就写清楚画面里**要有什么**。

其他值得记的差异：

- **Veo 3**：官方指南开头就写"细节加得越多，你对成片的控制越强"，并把提示词拆成七段（景别运镜／风格／光线／人物／地点／动作／对白）。人物要可数化（"二十多岁、波浪棕发、淡雀斑的女性"优于"棕发女性"）。
- **Kling 3.0**：官方多镜头格式是固定的——`镜头 n, m, words;`，最多 6 个分镜，每个分镜时长不小于 1 秒，**所有分镜时长之和等于视频总时长**。官方示例把情绪和身体随动写在一起（`a melancholic expression, her head swaying with the train`），这点和 H3 的思路一样：情绪要落在看得见的身体上。
- **阿里 Wan**：运动描述拆成三个要素——**幅度、速率、作用效果**（官方例子"猛烈地摇摆""缓慢地移动""打碎了玻璃"）。图生视频的公式直接简化成"运动＋运镜"，并且用"固定镜头"来强调镜头不变。多镜头写成"总体描述＋镜头序号＋时间戳＋分镜内容"。
- **Seedance 2.0**：官方示例是导演式时间线（"低角度跟拍冰刀 → 进入旋转 → 兵器相撞的瞬间切超慢动作 → 落地时恢复常速"），声音单独成层，参考素材用 `@Image 1` 写明各自负责什么。
- **Luma**：官方给了"弱→强"的对照，弱的是 `A man running`，强的是"灰色连帽衫男人在黄昏雨湿的巷子里疾跑，镜头与他肩同高并排跟拍，路灯在背景里虚化，浅景深，写实"——主体具体、镜头明确、环境具体。

**一处官方文档互相打架的地方**（和本项目直接相关）：H3 的 API 指南在 Text-to-Video 一节点了一句「更细的控制可以在关键描述后面直接加运镜指令，例如 `[pan]`、`[zoom]`、`[static]`」，而上一代 Hailuo 的 API 参考里确实有 15 条方括号运镜指令（`[Truck left]`、`[Push in]`……，一条里最多叠三个，顺序动作用 `then` 串）。但 H3 的两份**提示词写作指南**（Base 和 Ref2VA）从头到尾讲的是自然语言句子（类型＋幅度＋速度），一次方括号都没出现；本项目五套提示词里也明确写着"[Push in] 是上一代 Hailuo 2.3 的写法，H3 只认自然语言句子"。

两边对不上，判断倾向是：**API 指南那句话多半是从上一代文档沿用的**，写作指南才是 H3 的正式写法。但这值得花一次生成做对照验证——同一个镜头、同一个 seed，一次把运镜写成中文句子，一次写成 `[push in]`，其余一字不改，只看运镜跟不跟。这类"官方文档之间矛盾"的地方，只能靠单变量对照实验定，不能靠读文档定。

## 四、把情绪写成可见动作：表演和心理学的依据

详细版分册：`docs/research-emotion-to-visible-action.md`（含 30 行面部动作单元 AU → 中文写法对照表）。这一节只留结论。

**能做的是"做"，情绪是副产品。** 这是表演训练最基本的说法（Meisner：acting is founded on the reality of doing）。所以提示词里不该写"她很难过"，该写她**在做什么**：「她试图把最后一句没说完的话抓住」。编剧层的同一个道理叫 externalizing the internal——《血色将至》的拆解文里有句原话：电影看不见思想和感受，所以编剧的工作就是把它们搬到身体和动作上（[ScriptMag](https://scriptmag.com/features/writers-voice-there-will-be-blood-externalizing-internal-struggle)，WGA 获奖编剧，行业经验）。

**潜台词的可拍化形式就是言行矛盾。** 内心不可拍，矛盾可拍：她说"没事"，同时把杯子放回桌面时手指在杯沿上多停了半秒。这正好是"面部在压、身体在漏"那条写法的来源。

**一段戏按"目标变化的节点"切。** 剧本分析的 objective → beats → tactics 三层（[BYU 戏剧教育系教案](https://tedb.byu.edu/page-id-5144)，教学共识）里，beats 对我们最有用：它指剧情里角色目标发生变化的节点。提示词的时间切片，本质上就是把这些 beat 翻译成"这一段里她想干什么、干成了没有"。导演给演员调整时用的是"换一个行动"而不是"换个形容词"（[StageAgent](https://stageagent.com/blog/how-to-take-an-adjustment)，行业经验）——同一条道理用在提示词上：一个情绪写得不对，不要去换形容词，要换一个行动版本重跑。

**时长有据可查**：宏观表情约 0.5–4 秒，微表情不到半秒（[Ekman Group](https://www.paulekman.com/nonverbal-communication/types-of-facial-expressions/)）；国内微表情研究的说法是 1/25–1/5 秒（[《中国社会科学报》傅小兰](http://sspress.cssn.cn/2011n/1y/4/d9b_30928/201508/t20150827_2657496.shtml)，中科院心理所）。这解释了为什么只写一个表情词没用：模型会把这个峰值从头保持到尾，看起来就是一张静态照片。要给它「起—峰—落」。

**别把表情当情绪仪表盘。** "每种情绪有固定面部签名"这个假设在跨文化研究里有实质争议（[APS 转载 Nature 的报道](https://www.psychologicalscience.org/news/why-faces-dont-always-tell-the-truth-about-feelings.html)，记录 Barrett、Crivelli 等人的批评，有实证支撑）。对提示词的直接含义是：**不要写单点映射（皱眉＝愤怒），要堆叠多通道**——面部 ＋ 呼吸 ＋ 手 ＋ 重心 ＋ 视线 ＋ 声音，让模型从冗余线索里推断。面部动作单元（AU）表可以当"肌肉动作描述器"用（[中科院心理所微表情实验室 AU 表](http://melab.psych.ac.cn/en/au.html)、[Waller et al. 2008](https://pmc.ncbi.nlm.nih.gov/articles/PMC2637410/)），**不要**当"情绪翻译器"用。

**压抑是通过声音漏出来的**：情绪抑制的表达泄漏研究给了"面部压住、发声通道漏出来"这个结构的实证支持（[《心理科学进展》2026](https://journal.psych.ac.cn/xlkxjz/EN/10.3724/SP.J.1042.2026.1299)，中科院心理所主办）。这和我上面说的"反向组合"是同一件事。

**这一节的证据边界要说清**：这些是表演教学和对人的心理学研究，不是对视频模型做的实验。"多通道叠加比单点映射更适合模型"是我的推断，不是实测结论。可验证的部分只有一个方向——按这套写法试几条，和不写情绪细节的版本对照。


## 五、中文社区的实战经验

逐条带来源的版本在 `docs/reports/ai-video-prompt-zh-research.md`（含抓取失败的渠道说明），这里只留对"写变化"有用的。

**共识级（三份以上独立来源同向）**

- **正文公式**：主体 ＋ 动作 ＋ 场景 打底，风格／运镜／光影／声音按需加，不需要的段落直接不写。分歧在于写多长——字节官方说"一个干净的特写只要主体和动作两句，写长反而发散"，可灵和 Veo 一路倾向写满四到六段，没有统一答案。
- **一个时间切片只放一个主状态变化**，最多再带一个跟着它的联动细节，2–3 秒一格。这条是三份独立来源罕见收敛的结论；其中一位作者还公开推翻了自己早前"每镜一个动词"的说法。
- **动作拆到关节级**："打字"要写成"手指悬在键帽上方，食指刚按下，另一只手在触控板上滑动"；走路写"脚跟先着地再过渡到脚尖"。
- **情绪一律翻译成可见部位**：部位＋方向＋幅度＋时点，禁写情绪词。兜底句可以直接抄：`表情自然克制，不张大嘴，不做夸张皱眉，不要卡通式表情。`
- **表情三准则**：不对称、渐进、联动；四种典型失败：完美对称、情绪瞬间切换、夸张卡通、面瘫式静止。
- **运镜写焦段数值**（`85mm`）比写"长焦"稳。
- **一次只改一个变量**：固定主体／机位／构图／光线／时长，只改一条指令，判据是"能不能用一句话指出那一个变化"。

**有分歧、要自己试的**

- **"几秒能演几个动作"没有通用换算表**。澎湃和 AIX 财经用同一段 10 秒提示词跑了三家模型：即梦跑完"冲入战场→挑落敌将→回首→冲入尘烟"四拍，可灵那边"即梦 4 秒讲完的事，可灵 5 秒只讲了一半"。本手册第八节那张表只用来估数。
- **"慢"和"慢动作"要分开**：写"缓慢行走"，模型可能理解成慢镜头；想表达从容，写步幅和节奏。
- **中英文哪个更准，按模型分**：Wan 中文明显优于英文、Seedance 武打古装写中文更好且中英混合最佳、Kling 中英平手、Hailuo 偏好连字符动词——后两条是单人经验，H3 上没验证过，别照搬。
- **负面词治什么病**：静态画质类（脏空气、塑料皮肤、假光晕）有效；跨帧运动类（闪烁、转速跳变、漂移）基本无效——有从业者复盘指出负面词走的是逐帧的 CFG，而运动崩坏是跨帧累积的，压下去还会爬回来（引 arXiv 2509.24702）。**手部崩坏和多人面孔一致性别指望负面词**，实测里三家都会出三只手、都会串脸，这是当前天花板，不是提示词问题。
- **首尾帧任务**：配对质量比提示词质量更重要（光源方向、空间、景深线索要对得上）；伪影高发区在中间 50–70% 那段，0.5 倍速看；尾帧被忽略常常是因为提示词里的运动在逻辑上到不了尾帧——"要着眼于到达尾帧，而不是只想着离开首帧"。
- **图和视频模型都不能靠"写"改的参数**：分辨率、时长、帧率、运动强度属于容器参数，写在正文里没用（H3 的时间戳/时长同理，时长是接口参数）。`4K`／`8K` 这类词有分歧，没定论。

**明确没有证据的**

- 「模型默认出慢动作」这条没有直接证据，但第六节给了一条机制性的解释（偏好数据本身偏运动少的片段），所以动作偏温吞可以预期。
- 「负面提示词能防止手部崩坏」「提示词越长越好」「加 8K 提画质」这几条在证据上都站不住，逐条的反证在第六节。

## 六、崩坏从哪来、怎么评、哪些说法不该信

**评测的坐标系。** VBench（[CVPR 2024 Highlight](https://arxiv.org/abs/2311.17982)）把视频生成拆成 16 个维度分别打分，其中和时间有关的是主体一致性、背景一致性、闪烁、运动平滑度、动态程度；[VBench-2.0](https://arxiv.org/abs/2503.21755) 另立了人体保真（Human Fidelity，包含解剖学正确性）、可控性、物理、常识几项；[VideoScore](https://aclanthology.org/2024.emnlp-main.127/)（EMNLP 2024）则用学出来的人类多维打分做自动代理，与人类评分的 Spearman 相关 77.1，可以当粗筛。对我们的意义是：**"变化够不够"和"变化过程中崩没崩"是两件事，要分开看。** 一条提示词写得变化很足但一直闪，是动态程度够、时间一致性差；一条写得稳稳当当但画面不动，是反过来。先判断属于哪一种，再决定改哪里。

**动作为什么会偏慢、偏僵**（这条有论文级的解释，比社区猜测靠谱）：DenseDPO 那项工作发现，标注者在两段独立生成之间选优时，**会系统性偏向运动少的片段**，因为运动少的瑕疵更少——偏好数据里就带着低运动偏置（[arXiv 2506.03517](https://arxiv.org/abs/2506.03517)）。Motion Prompting（[CVPR 2025](https://arxiv.org/abs/2412.02700)）则指出纯文本对动作时序的控制本来就不足，所以那篇工作改用运动轨迹作条件。落到提示词上的两条：一是**该写清楚的运动量一定要写清楚**（步数、幅度、方向、起止），二是能用首尾帧或轨迹控制的地方，别只靠形容词（这也解释了为什么 FL2VA/L2VA 的"中间过程"要写满）。

**失败模式和对策**（H3 工程手册第 16 章的失败表，加上社区实测）：

| 症状 | 常见原因 | 怎么改 |
| --- | --- | --- |
| 人脸漂移、换人 | 多个参考素材职责重叠；同一角色用了不同措辞描述；镜头太多 | 缩窄每个素材的职责；角色卡固定一套措辞；减少切镜 |
| 服装、发型变化 | 同一角色用了同义的不同说法 | 保留同一句服装描述，不要换同义词 |
| 动作僵硬、像慢动作 | 动作没有起止和幅度；只写了"她在走" | 写步幅、节奏、方向、起止状态；用物理词而不是 `fast` |
| 穿模、开门反向、手穿过物体 | 复杂动作只写了一句概括 | 拆状态机：接近 → 接触 → 施力 → 运动 → 停止（官方示例就是这么写的） |
| 首帧不像输入图 | 重新"设计"了参考图 | 先锚住图里看得见的东西，再从图之后写变化 |
| 尾帧没命中 | 中间动作太多，最后才要求收敛 | 提前进入收敛段，末尾 1–2 秒减少新信息 |
| 切镜处空间、声音断裂 | 上一镜的结束状态和下一镜的开始状态没对齐 | 显式守恒：人物位置、朝向、光线方向、环境声 |
| 台词重复、串到别人嘴里、念不完 | 台词在多个区块重复；台词量超过时长 | 台词只写一次；按每秒 2.5 个英文词／4–5 个汉字估时长 |
| 只堆形容词、画面没动 | 满篇风格词，没有可执行的时序 | 每个镜头补起止状态和一个主要动作 |

**评测方法（能落地的四步）**

1. **一次只改一个变量，而且跨种子确认。** 固定种子、分辨率、时长、步数、cfg、采样器，还要确认"提示词重写"开关是开是关；每档至少跑 3 个种子。**只有跨种子稳定复现的差异才算提示词起了作用**——同一提示词跑两次结果本来就不同，单次对比没有意义。
2. **先建最短可运行基线**，再单变量往上加（Runway 官方："一次只加一个新元素"，先写"只含最必要运动"的版本）。
3. **运动类问题不要靠读结果猜**：中间 50–70% 那段是伪影高发区，0.5 倍速过一遍，比看开头结尾有用。
4. **按抽卡预算安排**：高难度镜头实测要 20 次以上，简单镜头 2–3 次；行业数字大约是 3 次生成换 1 个可用镜头。所以"多给几个方向"比"把一条改到完美"更划算。

**"让模型帮你写提示词"本身有副作用。** 这条对本项目尤其重要，因为画布里的 agent 干的就是这个活：

- VPO（[ICCV 2025](https://openaccess.thecvf.com//content/ICCV2025/html/Cheng_VPO_Aligning_Text-to-Video_Generation_Models_with_Prompt_Optimization_ICCV_2025_paper.html)）在提出重写方法的同时点明，现有的 LLM 重写**可能扭曲用户意图、漏掉关键细节**——视频模型是在"高度详细、精心撰写"的文本上训练的，而真实用户输入是"简短、含糊或结构混乱"的，重写就是补这个差，补过头就成了另一种意思。
- HunyuanVideo-1.5 的官方对照里能看到具体表现：用户只想要"DJ 沉浸在自己的音乐世界"，重写给它补了一个缓慢推进的中景；用户只想要"叶上露珠"，重写补了一个镜头下摇。**要严格控镜头就得把重写关掉**（该模型的 `--rewrite` 默认还是开的）。
- 结论对你的提示词写手同样成立：**可以补细节（场景、动作、声音），不该补用户没要的镜头和调度**。本项目五套模板里"修改时只动用户要求的地方"这条规则，方向是对的，值得在"补细节"和"加镜头"之间再明确一句。

**没有证据、或者被说反了的**

- **"负面提示词能防止手部崩坏"**：无证据，而且有反向证据。多数视频模型根本没有独立的负面提示词字段（Sora 2 没有、Veo 3.1 没有、Runway Gen-4 明确说不支持且"可能给出相反结果"、Kling 只在 prompt 里混写）；有该字段的（LTX-2、HunyuanVideo-1.5）在 **cfg=1 时数学上恒等于无效**——`out = uncond + cfg × (cond − uncond)`，cfg=1 时负分支被消掉，采样器直接跳过（[ComfyUI 模板仓库 issue #919](https://github.com/Comfy-Org/workflow_templates/issues/919) 核对了五个模板，全是 cfg=1 而负面框里还预填着词，属于摆着好看）。现在视频模型普遍走少步蒸馏，负面提示词的空间被结构性压缩（[NAG, arXiv 2505.21179](https://arxiv.org/abs/2505.21179)）。**修法要往上游走**：缩短镜头、一次只留一个不稳定元素、锁参考图或 seed。
- **手部崩坏和多人面孔一致性别指望提示词**：VBench-2.0 把解剖学正确性单列进人体保真维度，并说模型在物理、常识、解剖和构图完整性上仍在失败；实测里几家模型都会出三只手、都会串脸。这是当前模型的天花板。
- **"提示词越长越好"**：没有普适最优。Sora 2 官方说更长更详细的提示词**会限制模型的创造力**（它会努力遵循，但不一定可靠）；Runway 官方说"不要低估简洁的力量"；HunyuanVideo-1.5 官方却说写得更长更细会明显改善。三方各执一词，只能按模型试。H3 自己的长度要求（整合描述 500–800 汉字／生成类 350–500 英文词）是给完整叙事的预算，不是"越长越好"。
- **"写 `no camera movement` 能锁住镜头"**：有反向证据。Runway 官方把它判为错误写法，正确的是正面句 `Locked camera. The camera remains still.` H3 这边同理：不想要什么，就写清楚画面里要有什么。
- **"模型默认出慢动作"**：没有直接证据说模型"默认慢"，但有一条机制性的解释（DenseDPO 的标注偏好偏置，见上），所以"动作偏温吞"是可以预期的，要靠写清运动量来抵消。
- **"加 8K 提画质"**：`4K`／`8K` 这类词有没有用有分歧，没有定论；分辨率、帧率、运动强度属于容器参数，写在正文里通常没用还干扰。
- **导演名**：有案例集直接写王家卫、诺兰并给出成片，也有从业者说中文模型上会被刷掉。未解，倾向写成具体视觉特征而不是人名。


---

## 七、落到本项目的五套提示词

**已经按这份调研新做了一套独立的写手：`docs/prompts/h3-change.md`（「变化优先」版，**只写参考模式 Ref2VA**），现有五套一个字没改。** 它同时复制到了工作文件夹 `C:\Users\leo.wang\Downloads\tmp_h3\prompts\h3-change.md`，在画布的系统提示词列表里能直接选到，可以和现有那套开两个节点对照。用顺了再决定是并进五套、还是加进 `BUILTIN_PROMPTS` 变成自带的一套。

`retention_analysis` 的判定单独加固过：原来的写法按"这段内容能不能独立出现在画面里"分档，实测（grok-4.6，见 `outputs/h3-change-test/`）会退化成一片 `fully_preserved`。现在改成按"这段参考内容最后在成片里剩下多少"分档，给了三步判定顺序（没独立出现→weak_reference；特征用在别人身上→attribute_transfer；本体出现但变了→partially_preserved；一点没改→fully_preserved），并写明"只用来定风格的图只能写 weak_reference""全部写成 fully_preserved 是错的"。

下面记的是**并进现有五套**时的落点，等决定合并再按这里改。

现在五套模板已经有零散的相关句子（都用了同一句「动作和状态变化」「每个细节都要是看得见或听得见的东西，不要写成剧情梗概」），缺的是**把"变化"展开成可执行的写法**。可能的落点：

| 文件 | 现有句子 | 建议加什么 |
| --- | --- | --- |
| `docs/prompts/t2v.md`（第 39、83、87-95 行） | 每镜要写「动作和状态变化」；不要做的事里有「不写评价语」 | 在"每个镜头都要写清"后面加两三句：情绪不写结论，写起态→变化→落态＋压不住的细节；不写比喻和心理活动；在输出前自查里加一条"变化够不够" |
| `docs/prompts/i2v.md`（第 39、45、91 行） | 顺序是「首帧锚住 → 动作开始 → 连续发展 → 结果或反应」 | 把"连续发展"展开成状态链：每一步都要写从什么状态到什么状态；首帧里没有的东西要写清怎么进画面 |
| `docs/prompts/fl2va.md`（第 46、52、101 行） | 「中间的变化要能被看见」「不能因为只有一个镜头就写成两句话」 | 加一句把中间过程拆成 3–5 个可观察中间状态，并写清每个状态之间的先后顺序 |
| `docs/prompts/l2va.md`（第 41、51、98 行） | 顺序是「合理的前置状态 → 明确的动作与过渡路径 → 末镜逐步收敛」 | 同上；再加末段"收敛"的写法（减少新信息，写动作减速、幅度变小） |
| `docs/prompts/ref2va.md`（第 49、103、154 行） | `<Subject N>` 里可以放"动作、表情、姿势"；每镜要写状态变化 | 加一句：`<Subject N>` 里的表情是"要复用的内容"，视频里要写成它的变化过程，而不是每镜重贴一次这个表情标签 |

三件要注意的事：

- 系统提示词的正文只维护 `docs/prompts/*.md`，程序复制到工作文件夹；改完要同步 `web/prototype/shared/prompts-data.js` 里那份。
- e2e 只断言了标题行「MiniMax H3 视频提示词写手」（`tests/e2e/04-prompts.spec.ts` 第 183 行），正文可以改，标题行别动。
- 加了规则就该同时加自查项，否则模型不会执行。五套模板都已有"输出前自查"一节，是最省事的挂点。

如果要改，建议追加的就三句话（可原样粘进五套的「每个镜头都要写清」那一段后面）：

> 情绪和状态不写结论，写成过程：先写此刻是什么状态，再写哪个部位先动、动多少、多久，最后写停成什么样子，以及有没有压不住的小动作（指尖发抖、喉结滚动、呼吸变浅）。情绪词后面至少跟两个看得见的证据，一个在脸上，一个在身上或呼吸上。
>
> 一个时间切片（大约两三秒）只写一个主要的状态变化，最多带一个跟着它的细节。一个镜头只留一个主要动作目标。不写比喻句和心理活动（她想离开、他在犹豫），要写就写成动作。
>
> 画面里除了人物，光、影子、物体也要各有变化（灯亮起、影子爬上墙、水面被打碎），否则整段只有一张脸在动。

改完必须重新生成几条对照看：同一条需求，改前改后各跑一遍，只改提示词这一个变量。

另外一条和"丰富提示词"相反方向的建议：**补细节可以，补调度要克制。** 第六节那份重写研究显示，LLM 帮忙写提示词时最容易多做的一件事，是给用户没要求的东西加上镜头运动（用户只说"DJ 沉浸在自己的音乐世界"，重写给它补了缓慢推进的中景）。本项目五套模板里已经有"修改时只动用户要求的地方"，但没写清"补场景、补动作、补声音"和"补镜头"不是一回事。真要提高出片率，可以在系统提示词里加一句：**用户没提镜头时，只写一个最普通的运镜（或固定镜头）；要加特殊运镜、切镜、慢动作，就在提示词框外面说明这是你加的。**

### 顺带核到的一处：负面词在本项目的哪些路径上有效

第六节那条"cfg=1 时负面词恒等于无效"值得对着本项目核一遍，结论是**现状没有问题，但边界要记住**：

- **视频路径**：SelfLift 的 H3 采样器写死 `cfg: 1`，`negative` 接的是 `ConditioningZeroOut`（`packages/shared/src/video.ts` 第 639、645、652 行），负面条件在这条路上本来就不起作用；界面上也没有给视频任务任何负面词输入框（负面词输入只在图像侧），所以不存在"填了不生效"的假入口。
- **图像路径**：IL 默认 `cfg: 5`、Pony 默认 `cfg: 7`，两边都带真实的默认负面词（`packages/shared/src/imageDefaults.ts` 第 36、39、46、49 行）——**这两套的负面词是有效的**。
- **Krea2**：`cfg: 1`、`negative: ''`（同文件第 33 行），负面词无效；这一点 `docs/krea2-prompting.md` 第 8 行已经写明，是对的。
- 结论：**以后别给视频任务或 Krea2 加负面词输入框**（那是虚假可供性）；IL／Pony 的负面词照旧用。真要在视频上做负面控制，得换成 NAG 这类在少步采样下仍然有效的做法，而不是把词写进 CFG 的负分支。


## 八、还没解决 / 局限

- **没有实测对照。** 这份调研全部是读文档和别人的实测，本项目自己没有跑过 A/B。手册里的规则要在 H3 上验证，方法就是第六节那四步（固定其他变量、只改一条、锁 seed）。
- **官方指南只说要"具体、看得见"，没有量化指标。** "一秒能演多少个微表情""一个切片放几个变化"都是工程经验和社区共识，不是官方数据。
- **官方文档之间有矛盾**，已发现一处：H3 的 API 指南提到可以用 `[pan]` 这类方括号运镜指令，而 H3 的两份提示词写作指南全篇只讲自然语言句子，本项目五套提示词里也写着方括号是上一代的写法。这种矛盾只能靠单变量对照实验定，不能靠读文档定。
- **表演和心理学的依据说的是人，不是模型。** "多通道叠加优于单点映射""反向组合不容易糊"是从表演训练和情绪研究推过来的，方向合理但没在视频模型上验证过。
- **细节和变化会抢容量。** H3 单次 4–15 秒，信息预算有限（社区总结的"约束竞争"）。15 秒里塞 5 个切镜＋3 个情绪转折，通常的结果是哪样都不清楚。这条是上限，不是建议值。
- **跨模型不通用。** 同一句话在 H3 上有效不代表在别的模型上有效；中文／英文哪个更准也是按模型分的。
- 证据不足的常见说法（负面提示词能防手部崩坏、越长越好、加 8K 提画质、模型默认慢动作）不要当规则用，详见第五、六节。


## 出处

分册（这三份是本次调研的深度材料，本报告是它们的摘要＋对项目的落点）：

- `docs/research-emotion-to-visible-action.md`：把情绪写成可见变化的表演与心理学依据，含 30 行 AU → 中文写法对照表、12 类情绪词库、证据强度速查。
- `docs/reports/ai-video-prompt-zh-research.md`：中文社区实战技巧（含抓取失败的渠道说明、每条经验的来源性质与共识标注、7 组明确矛盾）。
- `docs/reports/research-prompt-negative-evidence.md`：反面证据与评测方法（失败模式的论文级成因、VBench 系列、提示词重写的副作用、负面提示词为什么无效、按种子做的对照方法）。

学术与基准：

- [VBench（CVPR 2024 Highlight）](https://arxiv.org/abs/2311.17982)、[VBench-2.0](https://arxiv.org/abs/2503.21755)、[VideoScore（EMNLP 2024）](https://aclanthology.org/2024.emnlp-main.127/)
- [DenseDPO](https://arxiv.org/abs/2506.03517)（偏好数据为什么偏低运动）、[Motion Prompting（CVPR 2025）](https://arxiv.org/abs/2412.02700)、[RAPO（CVPR 2025）](https://openaccess.thecvf.com/content/CVPR2025/html/Gao_The_Devil_is_in_the_Prompts_Retrieval-Augmented_Prompt_Optimization_for_CVPR_2025_paper.html)
- [VPO（ICCV 2025）](https://openaccess.thecvf.com//content/ICCV2025/html/Cheng_VPO_Aligning_Text-to-Video_Generation_Models_with_Prompt_Optimization_ICCV_2025_paper.html)（重写的收益与副作用）、[NAG](https://arxiv.org/abs/2505.21179)（少步采样下 CFG 失效）
- [ComfyUI 模板仓库 issue #919](https://github.com/Comfy-Org/workflow_templates/issues/919)（cfg=1 时负面提示词恒等于无效）

MiniMax H3 官方：

- Base 提示词指南（T2VA／I2VA／FL2VA／L2VA）：[VIDEO_PROMPT_WRITING_GUIDE_base_en.md](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
- Ref2VA 指南：[references/ref-en.txt](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt)
- 官方提示词 Skill：[skills/h3-prompt-writing/SKILL.md](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/SKILL.md)
- API 使用指南（含方括号运镜那句话、时长与素材规格）：[Video Generation](https://platform.minimax.io/docs/guides/video-generation.md)
- 上一代 Hailuo 的方括号运镜规范：[Create Text-to-Video Generation Task](https://platform.minimax.io/docs/api-reference/video-generation-t2v.md)
- 官方《H3 使用手册》第四章的中文转录（第三方仓库；含四要素、"少写比喻句"、踩坑表）：[awesome-minimax-h3-prompts](https://github.com/AtlasCloudAI/awesome-minimax-h3-prompts/blob/main/docs/prompting-guide.zh-CN.md)
- 海螺官方知识库两篇（情绪转换、运镜与主体一致性的 70/30 分配）：[From Fear to Joy: Prompting Smooth Emotional Transitions](https://hailuoai.video/pages/knowledge/prompting-emotional-transitions-ai-video)、[Camera Paths with Consistent Subjects](https://hailuoai.video/pages/knowledge/camera-paths-consistent-subjects-ai-video-guide)（文中自述是经验式方法，不是产品规范）
- H3 提示词工程手册（第三方，按 2026-08-31 的官方文档整理；状态机、约束竞争、15 秒信息预算、失败模式表）：[minimax-h3-prompt-engineering-cn](https://github.com/benny108/minimax-h3-prompt-engineering-cn/blob/main/%E6%8F%90%E7%A4%BA%E8%AF%8D%E5%B7%A5%E7%A8%8B%E6%8A%80%E5%B7%A7.md)

其他模型官方指南：

- Veo 3：[How to create effective prompts with Veo 3](https://deepmind.google/models/veo/prompt-guide/)；[Veo 3.1 in Gemini API](https://ai.google.dev/gemini-api/docs/veo?hl=en)
- Sora 2：[Sora 2 Prompting Guide](https://developers.openai.com/cookbook/examples/sora/sora2_prompting_guide)（页面标注 archived）
- Runway Gen-4：[Gen-4 Video Prompting Guide](https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide)；[Text to Video Prompting Guide](https://help.runwayml.com/hc/en-us/articles/42460036199443-Text-to-Video-Prompting-Guide)
- Kling 3.0／2.6 官方 API 文档：[3.0 Omni](https://klingai.com/document-api/api/video/3-0-omni/text-to-video.md)、[2.6](https://klingai.com/document-api/api/video/2-6/text-to-video.md)
- 阿里 Wan：[文生视频/图生视频提示词指南](https://www.alibabacloud.com/help/zh/model-studio/text-to-video-prompt)
- Seedance 2.0：[官方发布说明](https://seed.bytedance.com/en/blog/official-launch-of-seedance-2-0)
- Luma：[How to Write AI Video Prompts](https://lumalabs.ai/create/ai-video-generator-from-text)

表演与心理学（详细引用见分册）：

- [中科院心理所微表情实验室 AU 对照表](http://melab.psych.ac.cn/en/au.html)、[Waller et al. 2008（PMC2637410）](https://pmc.ncbi.nlm.nih.gov/articles/PMC2637410/)
- [Ekman Group：表情类型与时长](https://www.paulekman.com/nonverbal-communication/types-of-facial-expressions/)；[傅小兰《中国社会科学报》谈微表情时长](http://sspress.cssn.cn/2011n/1y/4/d9b_30928/201508/t20150827_2657496.shtml)
- [APS 转载 Nature：表情不等于情绪读数](https://www.psychologicalscience.org/news/why-faces-dont-always-tell-the-truth-about-feelings.html)
- [《心理科学进展》2026：情绪抑制的发声泄漏](https://journal.psych.ac.cn/xlkxjz/EN/10.3724/SP.J.1042.2026.1299)
- [BYU 戏剧教育系：objective/beats/tactics](https://tedb.byu.edu/page-id-5144)；[StageAgent：adjustment](https://stageagent.com/blog/how-to-take-an-adjustment)；[ScriptMag：externalizing the internal](https://scriptmag.com/features/writers-voice-there-will-be-blood-externalizing-internal-struggle)

本机与本项目：

- 本机已有的 H3 工程实践（MMH3Tools 的 Context-IR 系统提示词；含台词语速预算 2.5 词/秒、时长离散值、续写接缝经验）：`outputs/mmh3tools/ComfyUI-MMH3Tools/docs/context-ir-system-prompt.md`（不进 git）
- 外部 skill（已克隆到本机审阅，`outputs/` 不进 git）：[adoin/video-generation-skills](https://github.com/adoin/video-generation-skills) 的 `prompt-director`（中文视频提示词方法论，20 个 reference / 约 145 KB，65 节），clone 在 `outputs/video-generation-skills/`。审阅后采入 `docs/prompts/h3-change.md` 的条目：情绪强度降维、动作归因（动作在前表情在后）、生理动作链、微表情多时锁固定镜头、四层动态（身体→跟随物→环境光→声音同向）、微弱生命反应、起态带前史痕迹、悬念写预备动作、不写物理参数只写可见后果、台词语气按时间递进、静音按层处理、微表情清单。没有采纳的是别家模型专属语法（时间戳格式、`@图片N` 引用、负面词框、JSON 反推、捏脸流程）和图片模型专属的假因果/时间词技巧。
- 另一个相关 skill（未逐节采入，仅参考）：[Square-Zero-Labs/video-prompting-skill](https://github.com/Square-Zero-Labs/video-prompting-skill) 的 `minimax-h3/prompting.md`（23 KB），里面大块是**参考视频的表演迁移**（performer → performance Subject → target Subject 的映射、口型归属、跨风格锁画风），本项目第一版没有视频参考槽位，加槽位时值得回来抄。
- 本项目：[docs/research-h3-long-video.md](research-h3-long-video.md)（帧数 17j+5、时长对齐）、[docs/h3-guide-check.md](h3-guide-check.md)（默认提示词对着官方指南的逐条核对）、[docs/prompts/format-requirement.md](prompts/format-requirement.md)（程序固定的输出格式）

