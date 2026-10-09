# 中文社区 AI 视频提示词实战技巧调研

**抓取失败渠道**：知乎（全 403）、B 站简介、小红书、贴吧、公众号原文（仅能经腾讯云等转载读到）。凡标"未找到"即确实没拿到原文，未编造。

标注：**共识**＝≥3 独立来源同向；**实测**＝有同提示词对照结果；**单人**＝单一来源；**低可信**＝含推广或搬运。

---

## 1. 结构公式：七家对照

| 来源 | 公式 | 强调 |
|---|---|---|
| [阿里云百炼官方（万相）](https://www.alibabacloud.com/help/zh/model-studio/text-to-video-prompt) 官方 | 主体+场景+运动；进阶 +美学控制+风格化 | 运动要写**幅度、速率、作用效果**（"猛烈地摇摆""打碎了玻璃"） |
| [Seedance 2.5 官方指南解读](https://cloud.tencent.cn/developer/article/2739372)（腾讯云转公众号） | 主体+动作/事件+场景+视觉风格+运镜+声音，后四项可选 | **动作只概括主要过程，只为关键动作写细节** |
| [Seedance SKILL](https://github.com/NeverSight/learn-skills.dev/blob/main/data/skills-md/rich5000/seedance-prompt-guide/seedance-prompt/SKILL.md) 社区整理 | 素材指定+动作剧情+镜头语言+氛围音效 | "按时间线叙述，而非用技术术语" |
| [可灵 3.0 指南](https://www.hxsd.com/content/59409/) **低可信（明示搬运 acceptprompt.com）** | 主体+运动+场景+镜头语言+光影+声音 | "用镜头思维写，而非关键词堆叠" |
| [Veo 3 八要素](https://github.com/cclank/lanshu-awesome-ai-video-kit) | 景别运镜+风格+光线+角色+地点+动作+对白+音频 | Dialogue/Audio 各单独成行 |
| [Hao0321 跨平台研究](https://github.com/Hao0321/ai-media-generator/blob/main/references/community-prompt-patterns.md) | Kling：Scene→Characters→Action→Camera→Audio | **主体放最前 10–15 token** |
| [凤梨酱/火星时代](https://www.hxsd.com/content/59437/) 低可信（疑改编英文库） | 主体+身体姿态+肢体细节+表情+场景+风格 | "AI 不知道什么叫自然，只能翻译成具体身体部位" |

**共识**：主体+动作+场景是最小公倍数，其余可选。**分歧**：字节官方说"一个干净特写只要主体+动作两句"，可灵搬运指南与 Veo 倾向写满 4–6 段——路线冲突，无统一答案。

---

## 2. 写"变化"

- **动作拆到关节级**（共识）："打字"＝"手指悬在键帽上方，食指刚好按下，另一只手在触控板上滑动"；走路写"脚跟先着地再过渡到脚尖"（[凤梨酱](https://www.hxsd.com/content/59437/)，与 [invideo](https://invideo.io/faq/how-do-you-describe-camera-movements-and-shot-types-in/) "describe behavior, not intent" 同向）。
- **慢 ≠ 慢动作**（单人，高价值）：写"缓慢行走"会被理解成慢镜头，应写**短步幅 + unhurried**（[凤梨酱](https://www.hxsd.com/content/59437/)）；与 [Hao0321](https://github.com/Hao0321/ai-media-generator/blob/main/references/community-prompt-patterns.md) 记的 Kling 禁忌"'slow motion' 放负面词没用"互证。
- **`fast` 是最差动词**（单人）：改用 `extreme speed / kinetic / rapid` + 物理词 `realistic weight transfer, momentum`（[Hao0321](https://github.com/Hao0321/ai-media-generator/blob/main/references/community-prompt-patterns.md)）。
- **一个切片塞多少**——三份独立来源罕见收敛：**一个切片 = 一个核心变化 + 一个联动细节**，2 秒精度（[微表情库](https://github.com/woodfantasy/Seedance-ShotDesign-Skills/blob/main/references/micro-expressions.md)）；每窗口 1–3 秒、每段只安排一个主要变化、让眼神嘴角下颌依次接力（[太平洋科技](https://www.pconline.com.cn/ai/article/1657088.html)，**软广**）；[Hao0321](https://github.com/Hao0321/ai-media-generator/blob/main/references/community-prompt-patterns.md) 明确推翻自己早前"每镜一个动词"，改为"每个 time block 一个**主状态变化**，支撑同一事件的微动作可保留"。**共识级。**
- **镜头时长 vs 动作量：不存在通用换算表。**[澎湃/AIX 财经实测](https://www.thepaper.cn/newsDetail_forward_33072773)同段 10 秒赵子龙提示词跑三家：即梦跑完"冲入战场→挑落敌将→回首→冲入尘烟"四拍，可灵"即梦 4 秒讲完的事，可灵 5 秒只讲了一半"。
- **单/多镜头**：可灵 3.0 支持单提示词 ≤6 镜头、≤15 秒；Wan 2.7 **不再支持** `shot_type`，改用提示词"生成单镜头"；Seedance 用时间戳。[实战复盘](https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/main/cases.zh.md)：一镜到底超 15 秒画质崩，甜区 5–15 秒。

---

## 3. 表情/情绪

**有效写法**（共识）：**部位 + 动作方向 + 幅度 + 时点，禁写情绪词**。

- [微表情库](https://github.com/woodfantasy/Seedance-ShotDesign-Skills/blob/main/references/micro-expressions.md)四陷阱：完美对称表情、情绪瞬间切换、夸张卡通式、面瘫式静态。三准则：**不对称性、渐进性、联动性**。禁忌词："极度悲伤/愤怒""突然大笑""脸上露出XX的表情""表情丰富"。
- [太平洋科技](https://www.pconline.com.cn/ai/article/1657088.html)五层结构：**角色锚定+面部动作+幅度+时间节奏+负面约束**，例："颧大肌带动嘴角向耳侧上提约 2 毫米…0—0.5 秒眼神变亮"。兜底句："表情自然克制，不张大嘴，不做夸张皱眉，不要卡通式表情"。
- [invideo](https://invideo.io/faq/how-do-you-describe-camera-movements-and-shot-types-in/)：AI 演不了意图——不写"更渴望"，写"目光多停留两拍，嘴微张，手在半途停住"。

**分歧**：微表情库主张默认从 L2（内敛）起步、L4 爆发全片只用一次；短剧实操普遍偏 L3 外显。文艺片与短剧审美路线差，非对错。

---

## 4. 运镜词库

规模：[CSDN 导演词库](https://blog.csdn.net/u014177256/article/details/157134110)约 80 条；[AI 尹小歪案例集](https://yinxiaowai.github.io/awesome-ai-video-camera-movement-prompts/)25 个带可复制中文提示词的案例。

中英对应（[lvzhengbin](https://github.com/lvzhengbin/AI-Prompts/blob/main/skills/seedance-prompt-skill/references/shot-types.md)+[MapleShaw](https://github.com/MapleShaw/seedance2.0-prompt-skill/blob/main/references/camera-codec.md)+[尹小歪](https://yinxiaowai.github.io/awesome-ai-video-camera-movement-prompts/) 三源一致）：

推/拉 Dolly In/Push In、Dolly Out｜摇 Pan L/R、Tilt Up/Down｜移/跟 Truck L/R、Tracking/Follow｜升降 Crane/Boom/Pedestal｜环绕 Orbit/Circular Tracking｜希区柯克变焦 Dolly Zoom｜荷兰角 Dutch Angle（"倾斜构图 15°"）｜手持 Handheld｜斯坦尼康 Steadicam｜甩镜 Whip Pan｜一镜到底 Long Take。

**国产模型上更有效**：Wan **中文明显优于英文**；Seedance 武打/古装/romance 写中文更好、**中英混合更佳**；Kling 中英平手；Hailuo 偏好连字符相机动词（`walk-right`）。[Wan 官方](https://www.alibabacloud.com/help/zh/model-studio/text-to-video-prompt)指定中文写法"镜头推进""镜头左移""固定镜头"。**运镜写焦段数值而非"长焦"**——`85mm` 比"长焦"稳（[MapleShaw](https://github.com/MapleShaw/seedance2.0-prompt-skill/blob/main/references/camera-codec.md)，与 invideo "name the optic, not the vibe" 同向）。

---

## 5. 负面提示词：能治什么、治不了什么

**本次调研最重要的分野**：

- **静态画质类有效**：[CSDN 元界深掘](https://blog.csdn.net/2601_97010617/article/details/166736689)分三抽屉——脏空气（空气尘埃/灰雾感）、塑料材质（塑料皮肤/蜡质皮肤/塑料布料）、假光雾（光晕描边/漂浮轮廓光）。**正向搭骨架，负向清场**。
- **跨帧运动类基本无效**：[HackerNoon/Frank Houbre](https://hackernoon.com/negative-prompts-dont-fix-ai-video-glitches-heres-the-checklist-that-does)（从业者复盘，引 arXiv 2509.24702）：负面词走 CFG，是**逐帧**工具，而崩坏是**跨帧累积**的——存在 lagged suppression（压下去又爬回来）与 cumulative trajectory bias（误差复利）。他实测 "no motion blur/strobing/flicker" 完全压不住吊扇转速跳变。**修法往上游走**：镜头缩到 3–4 秒切在动作上、一次只留一个不稳定元素、用运动笔刷/强度滑杆代替文字、锁参考图或 seed、全分辨率回看（压缩预览会藏漂移）。
- **数量要少**（共识）：过度约束的负面词会放大它本想消除的缺陷；两三个针对性的胜过一长串。
- **模型机制差异大**：[jnMetaCode](https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/main/templates/negative-prompts.md)：Veo/Kling/Wan/Hailuo 有独立负面字段（填名词列表，**不要写 "no/don't"**）；**Runway Gen-4 是 positive-only，写 "no distorted hands" 反而可能召唤扭曲的手**；Sora 2 无专用框。
- **正解是"分配动作预算"**：[WaveSpeed](https://wavespeed.ai/blog/zh-CN/posts/blog-kling-2-6-motion-control-prompt-patterns/)用"没有肩膀参与""完全没有镜头移动""头发保持平静"冻结不该动的链条。

**手部崩坏/人物漂移**：负面词可缓解不可根治。实测证据是[澎湃三强测评](https://www.thepaper.cn/newsDetail_forward_33072773)：HappyHorse 产品特写出"三只手"，且**三家"没有一家能稳定生成可读中文，多人面孔一致性也是集体翻车点"**——多指与"克隆人"是当前天花板，不是提示词问题。

---

## 6. 常见错误清单

1. **空泛形容词**：❌"美女，夕阳，海滩，电影感，4K" ✅"一位长发被海风吹散的女子站在金色沙滩水边。低垂夕阳在湿润沙地上投下绵长的铜色阴影…"（[可灵指南](https://www.hxsd.com/content/59409/)；[CSDN](https://blog.csdn.net/2601_97010617/article/details/166736689)同样点名"8K、超清、细节爆炸、大师之作"是新手陷阱词）
2. **一个提示词塞太多主体**：❌ 多主体独立动作（A 打 B 闪 C 射）；Kling 单条 >4–5 个 distinct nouns 就崩（[Hao0321](https://github.com/Hao0321/ai-media-generator/blob/main/references/community-prompt-patterns.md)）
3. **同一动作重复描述**：❌"拉坯、再拉坯、继续拉坯"会让节奏反复横跳（[官方](https://cloud.tencent.cn/developer/article/2739372)）
4. **指令冲突**：同时"推进+拉远"、"缓慢+快速"（[MapleShaw](https://github.com/MapleShaw/seedance2.0-prompt-skill/blob/main/references/camera-codec.md)）；"正向里又要梦幻柔光又要清晰商业质感，模型只能猜，一猜就乱补"（[CSDN](https://blog.csdn.net/2601_97010617/article/details/166736689)）
5. **素材/镜头太多**：官方"素材越多稳定性越容易下降"
6. **把生成参数写进提示词**：分辨率/帧率/运动强度——官方明确"既没用还会干扰"
7. **抽象情绪词**：见 §3
8. **"自然""放松"**：须译成"重心放在一条腿上""脊柱有轻微弧度"（[凤梨酱](https://www.hxsd.com/content/59437/)）
9. **版权/人脸拦截**：❌ 钢铁侠红金战甲 → ✅ 原子朋克复古未来感红金战衣；正脸照拒绝率最高（[jnMetaCode](https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/main/cases.zh.md)）
10. **垫图让画风泄漏**：参考图画质差会把二次元质感带进输出；该作者主张"动态镜头干脆不垫图"（[同上](https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/main/cases.zh.md)）

**慢动作默认**：**未找到**证据。相邻证据只有"写缓慢会被理解成慢镜头"与"缩短镜头减少漂移"。**此条无法证实，不建议当结论用。**

---

## 7. 首帧/尾帧/参考图

- **图生视频不要重复描述画面**（两家官方一致）：[Wan 官方](https://www.alibabacloud.com/help/zh/model-studio/text-to-video-prompt)"图像已确定主体、场景、风格，提示词主要描述动态过程及运镜"，公式简化为 **运动+运镜**；[可灵指南](https://www.hxsd.com/content/59409/)"静态图片中过于复杂的运动容易产生瑕疵"。
- **首尾帧配对质量 > 提示词质量**（单人，[WaveSpeed](https://wavespeed.ai/blog/zh-CN/posts/wan-2-7-first-last-frame-guide/)）：最强配对共享"一致光源方向、匹配景深、空间合理的主体"。坏配对：光照方向不一致（中途光源跳变）、空间不匹配（宽景配特写迫使模型自造运镜）、景深线索冲突。**中间 50–70% 是伪影高发区**，要 0.5 倍速看；"在修改提示词之前先修输入配对"。
- **尾帧被忽略的原因**：提示词的运动在逻辑上无法在尾帧终止——"当提示词连贯性与帧附着性冲突时，模型优先前者"，要**着眼于到达尾帧，而非仅离开首帧**。
- **多素材写映射与"不采用什么"**（官方，实测）：`@图片1用于…不采用图片背景`、`@视频1用于动作节奏，不采用视频中的人物身份、服装和场景`；"多张独立视角图比拼在一张更稳定"（[字节官方](https://cloud.tencent.cn/developer/article/2739372)）。参考视频规范：3–8 秒、运动单一、剪掉开头 1–2 秒起手抖动、用三脚架素材（[MapleShaw](https://github.com/MapleShaw/seedance2.0-prompt-skill/blob/main/references/camera-codec.md)）。
- **锁脸**："五官、脸型、发型 100% 保留，不要美化"；变身镜头"变身前后保持完全相同的骨骼结构、下颌几何与面部五官"；每个关键元素各给一张专属参考图（[jnMetaCode](https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/main/cases.zh.md)）。

---

## 8. 评测与迭代

- **一次只改一个变量**（[CapCut](https://www.capcut.com/create/ai-video-generator/video-generation-model-matrix)，结构化最高）：写"测试卡"——固定 viewer outcome/主体/机位/构图/背景/光线/时长，只改一条指令。只把 "slow clockwise rotation" 改成 counterclockwise，**不要同时改杯子颜色或加镜头运动**。判据："你能否用一句话指出那一个变化"。
- **对照实验**（[CSDN](https://blog.csdn.net/2601_97010617/article/details/166736689)）：同一正向出四张——只开负面抽屉 A / B / C / A+B+C，找出"你的模型最爱乱补哪一类"。
- **判断哪句起作用**：只能变量控制——先做"单问题修复"pass，再做对照 pass，否则不知道是哪条指令起的作用。
- **抽卡预期**（实测）：高难度镜头 20+ 次、简单镜头 2–3 次；某项目 400 张图 + 200+ 条视频才落地约 40 条成片，"把提示词当抽卡券，功夫下在挑选上"（[jnMetaCode](https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/main/cases.zh.md)）；[invideo](https://invideo.io/faq/how-do-you-describe-camera-movements-and-shot-types-in/)给行业数字：**约 3 次生成换 1 个可用镜头、剪辑选用率约 25%**。
- **锁 seed + 低分辨率迭代、高分辨率定稿**（[WaveSpeed](https://wavespeed.ai/blog/zh-CN/posts/wan-2-7-first-last-frame-guide/)）。

---

## 9. 明确的矛盾点

1. **负面词有没有用**：[CSDN](https://blog.csdn.net/2601_97010617/article/details/166736689)与[jnMetaCode](https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/main/templates/negative-prompts.md)主张常备；[HackerNoon](https://hackernoon.com/negative-prompts-dont-fix-ai-video-glitches-heres-the-checklist-that-does)说它结构上压不住运动崩坏，堆多更糟。**分歧不在"有没有效果"而在"治什么病"**——画质/材质/光雾有效，跨帧运动无效。把负面词当运动问题的解药是错的。
2. **画质参数该不该写**：字节官方说"写进提示词既没用还干扰"；[rich5000](https://github.com/NeverSight/learn-skills.dev/blob/main/data/skills-md/rich5000/seedance-prompt-guide/seedance-prompt/SKILL.md)把"4K，HDR，60fps"列为避免写法；但 [Hao0321](https://github.com/Hao0321/ai-media-generator/blob/main/references/community-prompt-patterns.md)记录"Seedance 2.0 对 4K/8K/1080p token 有反应"，并推翻自己早前"8K 是 generic"的判断；[MapleShaw](https://github.com/MapleShaw/seedance2.0-prompt-skill/blob/main/references/camera-codec.md)也写"4K 超高清"。**三方两向且都指向 Seedance。我的判断：`4K/8K` 这类风格化画质词可能有效，但帧率/运动强度/分辨率确实该交给设置项——证据不足以一刀切。**
3. **导演名能不能用**：[Hao0321](https://github.com/Hao0321/ai-media-generator/blob/main/references/community-prompt-patterns.md)：MJ/Sora/Veo 吃，Flux/Nano Banana 被刷掉，Kling 可能 over-weight；[lanshu](https://github.com/cclank/lanshu-awesome-ai-video-kit)与[jnMetaCode](https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/main/cases.zh.md)主张中文模型改用具体视觉词。但[尹小歪案例集](https://yinxiaowai.github.io/awesome-ai-video-camera-movement-prompts/)把斯皮尔伯格/王家卫/韦斯·安德森/诺兰/塔可夫斯基全当模板直接用在中文提示词里并给出成片。**未解：可能"风格描述词"（韦斯·安德森式对称构图）有效，而"人名裸写"无效。**
4. **运镜能否叠加**：[MapleShaw](https://github.com/MapleShaw/seedance2.0-prompt-skill/blob/main/references/camera-codec.md)铁律"每镜最多双轴，三轴=失控"，且"近景+大幅旋转容易崩脸"；Hao0321 记 Kling 禁忌"stacking 相机运动"、Wan 禁忌"maximum motion"。但 [CSDN 词库](https://blog.csdn.net/u014177256/article/details/157134110)把"旋转俯冲"当卖点，[Wan 官方](https://www.alibabacloud.com/help/zh/model-studio/text-to-video-prompt)也示范"无人机快速穿越…镜头上摇"。**"最多双轴"是社区经验值，不是模型硬限制。**
5. **甩镜能不能用**：[尹小歪](https://yinxiaowai.github.io/awesome-ai-video-camera-movement-prompts/)与[CSDN](https://blog.csdn.net/u014177256/article/details/157134110)列为推荐；[invideo](https://invideo.io/faq/how-do-you-describe-camera-movements-and-shot-types-in/)明确"Pans and tilts work; **whip pans are unreliable**"。**我倾向信 invideo 的"不可靠"——中文案例集展示精选成片，存在幸存者偏差。**
6. **单镜头动作数**：字节官方"只概括主要过程"vs 词库"拆到关节级"。**调和点**：字节说的是"不要重复描述同一动作"，微表情库说的是"一个切片一个核心变化"——两者不冲突，冲突的是细节粒度适用于**单个动作**还是**单个切片**。
7. **垫图 vs 纯文案**：jnMetaCode 主张动态镜头不垫图，所有官方文档都推参考图。**是"画风泄漏"与"一致性"的取舍。**

---

## 10. 最值得直接抄进模板的 10 条

1. **主体+动作+场景**打底，后四项（风格/运镜/声音/光影）按需加，不需要的段落直接删——写长反而发散。
2. **每个时间切片只放一个主状态变化**，2–3 秒一切，用 `0-2秒：…/2-4秒：…` 显式分段。
3. **动作写"部位+方向+幅度+时点"**："右手腕小幅左右摆动，肩肘保持稳定，动作发生在第 2–3 秒，然后手回到桌面"。
4. **情绪一律翻译成肌肉动作**，禁写"悲伤/愤怒/紧张"；兜底句常备"表情自然克制，不张大嘴，不做夸张皱眉，不要卡通式表情"。
5. **单侧+渐进+联动**："左侧嘴角先微抬""从 A 逐渐过渡到 B""眼神变化时呼吸也变"——破 AI 对称假脸。
6. **运镜用中文动词+焦段数值**："缓慢推近，85mm，浅景深"；一镜到底写"生成单镜头"，多镜头用 `第1个镜头[0-3秒]`。
7. **每镜最多双轴运动**，避免特写配大幅环绕。
8. **负面词只写你正看着的那一个具体毛病**（如"重复的缆线""产品标签变形"），两三个封顶；别抄通用质检清单。
9. **运动类崩坏别跟负面词较劲**：先把镜头缩到 3–4 秒切在动作上、一次只留一个不稳定元素、给不稳定元素锁参考图或 seed。
10. **一次只改一个变量，用测试卡记录**；把输出当抽卡，预算按"约 3 次生成换 1 个可用镜头"算。
