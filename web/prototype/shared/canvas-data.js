/* 画布工作台示例数据：画布「新年广告片」 */

var WORKDIR = 'D:\\同步盘\\提示词画布';
var CANVAS_IMG = WORKDIR + '\\canvases\\cv-7f3a2b\\images\\';

/* 图片：src 是原型里的预览图；name / path / w / h 是用户电脑上的原文件信息 */
var IMAGES = {
  a1: { src: 'img/gen/a1-heroine-portrait.jpg', name: 'DSC_0412.jpg', folder: 'f1a', w: 6000, h: 4000, size: '18.6 MB',
        proc: { note: '长边 6000 超过 5760，已缩到 5760×3840', copy: CANVAS_IMG + '4be1f0c29a7d3e51b8a6c0f2d91e7a34c5b8f06e2d7a19c3b4e5f60718a9b2c3.jpg' } },
  a2: { src: 'img/gen/a2-heroine-back.jpg', name: 'DSC_0415.jpg', folder: 'f1a', w: 5472, h: 3648, size: '12.1 MB' },
  a3: { src: 'img/gen/a3-neon-alley.jpg', name: 'IMG_7731.jpg', folder: 'f1a', w: 4032, h: 3024, size: '5.2 MB',
        missing: true, copy: CANVAS_IMG + '0d9f3a7c61e24b58a1c7e9f02b3d4c5e6f708192a3b4c5d6e7f8091a2b3c4d5e.jpg' },
  a4: { src: 'img/gen/a4-sodium-lamp.jpg', name: 'DSC_0388.jpg', folder: 'f1b', w: 5472, h: 3648, size: '11.4 MB' },
  a5: { src: 'img/gen/a5-red-lanterns.jpg', name: 'DSC_0391.jpg', folder: 'f1b', w: 5472, h: 3648, size: '10.8 MB' },
  a6: { src: 'img/gen/a6-convenience-store.jpg', name: 'DSC_0420.jpg', folder: 'f1a', w: 5472, h: 3648, size: '9.7 MB' },
  a7: { src: 'img/gen/a7-umbrella-drops.jpg', name: 'DSC_0433.jpg', folder: 'f1a', w: 5472, h: 3648, size: '8.9 MB' },
  a8: { src: 'img/gen/a8-heroine-turn.jpg', name: 'DSC_0460.jpg', folder: 'f1a', w: 5472, h: 3648, size: '31.4 MB',
        proc: { note: '文件 31.4 MB 超过 30 MB，已重新压缩到 14.2 MB', copy: CANVAS_IMG + 'e71c5b0a93d84f26b7c1a0e9d8f7c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b.jpg' } },
  a9: { src: 'img/gen/a9-home-windows.jpg', name: 'DSC_0471.jpg', folder: 'f1a', w: 5472, h: 3648, size: '9.2 MB' },
  c1: { src: 'img/gen/c1-puddle-step.jpg', name: 'DSC_0502.jpg', folder: 'f1a', w: 5472, h: 3648, size: '10.1 MB' },
  c2: { src: 'img/gen/c2-taxi-rain.jpg', name: 'DSC_0507.jpg', folder: 'f1a', w: 5472, h: 3648, size: '7.4 MB' },
  c3: { src: 'img/gen/c3-bus-stop.jpg', name: 'DSC_0511.jpg', folder: 'f1a', w: 5472, h: 3648, size: '8.0 MB' },
  c4: { src: 'img/gen/c4-crosswalk-top.jpg', name: 'DJI_0082.jpg', folder: 'f1a', w: 4000, h: 3000, size: '6.6 MB' },
  c5: { src: 'img/gen/c5-window-drops.jpg', name: 'DSC_0520.jpg', folder: 'f1a', w: 5472, h: 3648, size: '7.9 MB' },
  c6: { src: 'img/gen/c6-noodle-stall.jpg', name: 'DSC_0526.jpg', folder: 'f1a', w: 5472, h: 3648, size: '11.2 MB' },
  c7: { src: 'img/gen/c7-subway-entrance.jpg', name: 'DSC_0531.jpg', folder: 'f1a', w: 5472, h: 3648, size: '9.5 MB' },
  c8: { src: 'img/gen/c8-lamp-silhouette.jpg', name: 'DSC_0540.jpg', folder: 'f1b', w: 5472, h: 3648, size: '6.3 MB' },
  c9: { src: 'img/gen/c9-scarf-closeup.jpg', name: 'IMG_0020.png', folder: 'f1a', w: 240, h: 240, size: '96 KB',
        proc: { note: '边长 240 小于 256，已放大到 256×256', copy: CANVAS_IMG + '58a2c4e6f8b0d1e3f5a7c9b1d3e5f7a9c1b3d5e7f9a1c3b5d7e9f1a3c5b7d9e1.png' } },
  u1: { src: 'img/umbrella-red.jpg', name: 'IMG_3104.jpg', folder: 'f1a', w: 4032, h: 2688, size: '4.1 MB' },
  u2: { src: 'img/walker-clear-umbrella.jpg', name: 'IMG_3110.jpg', folder: 'f1a', w: 4032, h: 2688, size: '3.8 MB' },
  u3: { src: 'img/neon-alley.jpg', name: 'IMG_3122.jpg', folder: 'f1a', w: 3024, h: 3780, size: '4.4 MB' },
  u4: { src: 'img/lamp-sodium.jpg', name: 'IMG_3130.jpg', folder: 'f1b', w: 2268, h: 5005, size: '3.9 MB' },
  u5: { src: 'img/lamp-blue.jpg', name: 'IMG_3131.jpg', folder: 'f1b', w: 3024, h: 3074, size: '2.1 MB' },
  u6: { src: 'img/lamp-harbor.jpg', name: 'IMG_3140.jpg', folder: 'f1b', w: 4032, h: 2688, size: '2.6 MB' },
  u7: { src: 'img/wet-street.jpg', name: 'IMG_3151.jpg', folder: 'f1a', w: 4032, h: 3181, size: '4.7 MB' },
  u8: { src: 'img/blue-crossing.jpg', name: 'IMG_3160.jpg', folder: 'f1a', w: 4032, h: 2688, size: '4.9 MB' },
  u9: { src: 'img/sign-tower.jpg', name: 'IMG_3172.jpg', folder: 'f1a', w: 4032, h: 4032, size: '5.3 MB' },
  u10: { src: 'img/red-lanterns.jpg', name: 'IMG_3180.jpg', folder: 'f1b', w: 3024, h: 4536, size: '4.0 MB' },
  u11: { src: 'img/shopping-street.jpg', name: 'IMG_3201.jpg', folder: 'f1a', w: 3024, h: 4536, size: '5.8 MB' },
  u12: { src: 'img/girl-plaid-umbrella.jpg', name: 'IMG_3215.jpg', folder: 'f1a', w: 3024, h: 4536, size: '5.5 MB' },
  u13: { src: 'img/girl-plaid-bw.jpg', name: 'IMG_3215_黑白.jpg', folder: 'f1a', w: 3024, h: 4536, size: '4.2 MB' },
  x1: { src: null, name: 'IMG_2231.HEIC', folder: 'f1a', unsupported: 'HEIC' },
  x2: { src: null, name: '雨夜动图.gif', folder: 'f1a', unsupported: 'GIF' },
  x3: { src: null, name: 'IMG_2240.HEIC', folder: 'f1a', unsupported: 'HEIC' },
  b1: { src: 'img/gen/b1-samoyed-cafe.jpg', name: '萨摩耶-01.jpg', folder: 'f2', w: 5000, h: 3333, size: '8.2 MB' },
  b2: { src: 'img/gen/b2-watch-product.jpg', name: '腕表-侧光.jpg', folder: 'f2', w: 5000, h: 3333, size: '7.1 MB' },
  b3: { src: 'img/gen/b3-cat-fridge.jpg', name: '橘猫-冰箱.png', folder: 'f2', w: 3000, h: 3000, size: '9.6 MB' },
  b4: { src: 'img/gen/b4-night-runner.jpg', name: '夜跑-大桥.jpg', folder: 'f2', w: 5000, h: 3333, size: '6.0 MB' },
  b5: { src: 'img/gen/b5-grandma-kitchen.jpg', name: '外婆-厨房.jpg', folder: 'f2', w: 5000, h: 3333, size: '7.7 MB' },
  b6: { src: 'img/gen/b6-paper-plane-subway.jpg', name: '纸飞机.webp', folder: 'f2', w: 4000, h: 4000, size: '2.2 MB' },
  b7: { src: 'img/gen/b7-snow-suv.jpg', name: '雪山-SUV.jpg', folder: 'f2', w: 5000, h: 3333, size: '8.8 MB' },
  b8: { src: 'img/gen/b8-graduation.jpg', name: '毕业-抛帽.jpg', folder: 'f2', w: 5000, h: 3333, size: '9.0 MB' },
  b9: { src: 'img/gen/b9-fireworks-river.jpg', name: '江边烟花.jpg', folder: 'f2', w: 5000, h: 3333, size: '6.4 MB' },
  k1: { collage: { rows: 2, cols: 2, cells: ['a2', 'c1', 'a7', 'a8'], numbered: false }, name: '分镜-2x2.jpg', folder: 'f1c', w: 1536, h: 1536, size: '612 KB' },
  k2: { collage: { rows: 3, cols: 3, cells: ['a2', 'a3', 'c1', 'a7', 'c5', 'a4', 'c8', 'a8', 'c9'], numbered: true }, name: '分镜-3x3.jpg', folder: 'f1c', w: 1536, h: 1536, size: '934 KB' }
};

var FOLDERS = [
  { id: 'f1', path: 'D:\\素材\\新年广告', count: 1248, children: [
    { id: 'f1a', name: '雨夜街拍', count: 312 },
    { id: 'f1b', name: '灯与灯笼', count: 86 },
    { id: 'f1c', name: '拼图', count: 6 }
  ] },
  { id: 'f2', path: 'E:\\图库\\项目封面', count: 4730, children: [] },
  { id: 'f3', path: 'D:\\手机导出\\2026-09', count: 213, children: [] }
];
function folderPath(id) {
  for (var i = 0; i < FOLDERS.length; i++) {
    var f = FOLDERS[i];
    if (f.id === id) return f.path;
    for (var j = 0; j < f.children.length; j++) if (f.children[j].id === id) return f.path + '\\' + f.children[j].name;
  }
  return '';
}
function imagePath(id) { var im = IMAGES[id]; return folderPath(im.folder) + '\\' + im.name; }

var MODEL_CONFIGS = [
  { id: 'm1', name: '主力', model: 'MiniMax-M2', price: { cur: '¥', inp: 2.1, out: 8.4, cache: 0.21 } },
  { id: 'm2', name: '本地假模型', model: 'mock-llm', price: null }
];
var SYSTEM_PROMPTS = ['ref2va', 'i2v', 't2v', 'ref2va-台词多'];

var SYS_SNAPSHOT_REF2VA = [
  '# MiniMax H3 视频提示词写手（参考模式）',
  '',
  '你替用户写交给 MiniMax H3 的视频提示词。这一套用在有参考图、图提供人物、场景、服装、风格或分镜的时候。用户给你的东西有：几张参考图（程序按 <Picture 1>、<Picture 2> 这样的编号发给你）、视频时长、画面比例，以及一段中文需求。你写出的提示词要能直接贴进 H3 使用。',
  '',
  '## 你拿到的信息怎么用',
  '',
  '- 参考图的编号就是提示词里的 <Picture N>。只引用程序实际发给你的编号，没有的编号不要写。',
  '- 一张图都没有时，说明用户该换成「t2v」那套提示词，在提示词框外面提醒一句，然后照他的需求写。',
  '- 每张参考图都要在提示词里有一个用途。用户没说某张图干什么用时，按最合理的理解给它安排用途，并在提示词框外面说明这是你的假设。用户明确说某张图不用，就不引用它。',
  '- 视频时长决定镜头怎么安排。所有切镜时间都要落在时长以内，最后一个镜头要在时长结束前收尾。',
  '- 画面比例影响构图：竖屏多写纵向构图和人物上半身，横屏多写环境和横向调度。',
  '- 程序会告诉你参考图有没有换、新增或重新编号。以最近一次说明为准，不要沿用旧编号。',
  '',
  '## 怎么和用户对话',
  '',
  '- 用中文交流。',
  '- 需求说得不清楚时，不要反问，先按你的理解写一版，把你假设了什么列在提示词框外面，用户不满意会再改。',
  '- 用户要几个方向，就给几个提示词框，每个框标一句它和别的方向的区别。',
  '- 用户只是问问题、不需要提示词时，直接回答，不要输出提示词框。',
  '- 用户手动改过提示词后，后续修改都在改过的版本上进行，不要退回你原来的写法。',
  '- 修改时只动用户要求的地方，其他内容保持不变。',
  '',
  '（后面还有「提示词的结构」「引用标签」等 140 行，以及程序固定附加的输出格式要求）'
].join('\n');

/* ─── 提示词正文 ─────────────────────────────────────────── */
var HEROINE = '<Subject 1> 是 <Picture 1> 里的年轻女性：齐肩黑色直发，炭灰色羊毛大衣，鲜红色针织围巾，撑一把透明雨伞。';
var ALLEY = '<Subject 2> 是 <Picture 2> 里的窄巷：两侧挂满竖排发光招牌，地面积水，没有行人。';
var LAMP = '<Subject 3> 是 <Picture 3> 里的路灯：老式细灯杆，暖黄色钠灯光，灯光里雨丝清晰可见。';

var P_DIR1 = [
  'subject_definitions:', HEROINE, ALLEY, '',
  'summary:', '[reference generation] 目标视频里，镜头跟在 <Subject 1> 身后穿过 <Subject 2>，走到巷口时她停下甩头回望，两个镜头，无台词。', '',
  'retention_analysis:',
  '<Subject 1>（出现在 [Shot 1]、[Shot 2]）：fully_preserved - 黑色直发、炭灰色大衣、红围巾和透明伞都保留。',
  '<Subject 2>（出现在 [Shot 1]）：fully_preserved - 招牌灯光和积水路面保留。', '',
  'detailed_description:',
  '目标视频是写实的电影感风格，夜晚冷蓝色调，红围巾是画面里唯一的暖色。',
  '[Shot 1] 中景背影，镜头贴着 <Subject 1> 身后一米跟拍，她撑着透明伞走进 <Subject 2>，两侧招牌的蓝光和粉光在伞面上流动，脚下的积水被一步步踩碎。镜头随步伐轻微起伏。',
  '[Shot 2] At 00:04.500, 切到巷口，构图参考 <Picture 4>，她停住脚步，围巾被风带起一角，然后猛地回头看向镜头，发梢甩出一串水珠。镜头定住，保持到最后一帧。', '',
  'overall_soundscape:', '密集的雨打伞面声和巷子里的滴水声，脚步踩水声贯穿前半段。', '',
  'non_diegetic_music:', 'N/A'
].join('\n');

var P_DIR2 = [
  'subject_definitions:', HEROINE, ALLEY, LAMP, '',
  'summary:', '[reference generation] 目标视频里，<Subject 1> 撑着伞穿过 <Subject 2>，停在 <Subject 3> 下回头，三个镜头，无台词，节奏缓慢。', '',
  'retention_analysis:',
  '<Subject 1>（出现在 [Shot 1]、[Shot 2]、[Shot 3]）：fully_preserved - 黑色直发、炭灰色大衣、红围巾和透明伞都保留。',
  '<Subject 2>（出现在 [Shot 1]、[Shot 2]）：fully_preserved - 竖排发光招牌和积水路面保留。',
  '<Subject 3>（出现在 [Shot 3]）：fully_preserved - 暖黄钠灯和灯下雨丝保留。', '',
  'detailed_description:',
  '目标视频是写实的电影感风格，夜晚，冷蓝的招牌光和暖黄的钠灯光形成对比。',
  '[Shot 1] 远景，<Subject 1> 撑着透明伞背对镜头走进 <Subject 2> 深处，积水倒映招牌的蓝光和粉光。镜头极慢地向前推进。',
  '[Shot 2] At 00:03.000, 中景侧面，她走过一片积水，伞面上的雨珠被灯光照亮，围巾随步子轻轻摆动。镜头平移跟随。',
  '[Shot 3] At 00:05.500, 中近景，她停在 <Subject 3> 下，停住一秒后慢慢回头，脸一半暖光一半冷蓝阴影。镜头缓慢推近到近景，保持到最后一帧。', '',
  'overall_soundscape:', '密集的雨声贯穿全片，中间有踩水的脚步声，结尾只剩灯下的滴水声。', '',
  'non_diegetic_music:', '低音钢琴弹出缓慢的单音旋律，每小节两三个音，结尾停在一个长音上。'
].join('\n');

var P_DIR3 = [
  'subject_definitions:', HEROINE, ALLEY, LAMP, '',
  'summary:', '[reference generation] 目标视频里，手持镜头跟着 <Subject 1> 穿过 <Subject 2>，她在 <Subject 3> 下停住，停顿一下后回头说一句话，两个镜头。', '',
  'retention_analysis:',
  '<Subject 1>（出现在 [Shot 1]、[Shot 2]）：fully_preserved - 黑色直发、炭灰色大衣、红围巾和透明伞都保留。',
  '<Subject 2>（出现在 [Shot 1]）：fully_preserved - 招牌灯光和积水路面保留。',
  '<Subject 3>（出现在 [Shot 2]）：fully_preserved - 暖黄灯光和雨丝保留。', '',
  'detailed_description:',
  '目标视频是写实的纪录片感风格，手持摄影，夜晚冷暖对比。',
  '[Shot 1] 中景，手持镜头在 <Subject 1> 斜后方跟拍，画面随步伐轻微晃动，她撑着透明伞穿过 <Subject 2>，招牌的蓝光从她的大衣肩头滑过，积水被踩出一圈圈涟漪。',
  '[Shot 2] At 00:04.000, 镜头绕到她的侧前方，她停在 <Subject 3> 下，伞沿滴下一串水珠。她静静站了一会儿，呼出一口白气，然后回头看向画外，用轻而平静的年轻女声说：<d>[中文] 你也在等雨停吗？</d> 说完嘴角微微一动。镜头轻微晃动后稳住，保持到最后一帧。', '',
  'overall_soundscape:', '雨声和踩水的脚步声贯穿全片，巷子里有空调外机的低鸣和远处的车流声。', '',
  'non_diegetic_music:', 'N/A'
].join('\n');

var P_SLOW_V3 = [
  'subject_definitions:', HEROINE, ALLEY, LAMP,
  '<Picture 4> 是 [Shot 1] 到 [Shot 3] 的分镜参考：左上决定 [Shot 1] 的背影远景，右上决定 [Shot 2] 的脚步特写，右下决定 [Shot 3] 回头的中近景。', '',
  'summary:', '[reference generation] 目标视频里，<Subject 1> 撑着伞从近处慢慢走进 <Subject 2> 深处，走到巷口 <Subject 3> 下停住，停留两秒后回头。三个镜头，全片没有台词，节奏很慢，景别顺序按 <Picture 4> 安排。', '',
  'retention_analysis:',
  '<Subject 1>（出现在 [Shot 1]、[Shot 2]、[Shot 3]）：fully_preserved - 黑色直发、炭灰色大衣、红围巾和透明伞都保留。',
  '<Subject 2>（出现在 [Shot 1]）：fully_preserved - 竖排发光招牌、积水路面和纵深保留。',
  '<Subject 3>（出现在 [Shot 3]）：partially_preserved - 保留暖黄钠灯和灯杆造型，周围环境换成巷口。',
  '<Picture 4>（[Shot 1] 到 [Shot 3] 分镜参考）：weak_reference - 只参考景别顺序和主体位置。', '',
  'detailed_description:',
  '目标视频是写实的电影感风格，夜晚，招牌的冷蓝光和钠灯的暖黄光形成冷暖对比，画面带轻微胶片颗粒，红围巾是全片最饱和的颜色。',
  '[Shot 1] 远景，镜头架在 <Subject 2> 的中轴线上，两侧竖排发光招牌一直延伸到画面深处，积水的路面倒映着蓝色和粉色的灯光。<Subject 1> 撑着透明雨伞背对镜头，从近处慢慢走向巷子深处，身影逐渐变小，伞面上的雨珠被招牌照亮。雨丝斜着落下。镜头以极慢的速度跟着向前推进，几乎察觉不到。能听到密集的雨点打在伞面和铁皮雨棚上的声音。',
  '[Shot 2] At 00:03.500, 切到低机位特写，<Subject 1> 的短靴踩进一片积水，水面里招牌的倒影被踩碎，又慢慢合拢。她的步子很慢，每一步之间有明显的停顿，大衣下摆沾着细小的水珠。脚步踩水发出轻轻的溅水声。',
  '[Shot 3] At 00:06.000, 切到巷口的中近景，<Subject 3> 立在画面右侧三分之一处，暖黄的灯光从上方打下来，灯下的雨丝在逆光里一根根落下。<Subject 1> 从画面左侧走入，停在灯下，伞沿微微抬起。她停住两秒，肩膀随呼吸轻轻起伏，然后慢慢转过头，看向身后来的方向，脸的一侧被暖光照亮，另一侧留在冷蓝的阴影里，围巾的红色在灯下格外鲜明。镜头缓慢推进到她的近景，在她回头看定的那一刻停住，保持到最后一帧。雨声渐渐变得稀疏。', '',
  'overall_soundscape:', '密集的雨声贯穿全片，前半段有雨点打在伞面和铁皮雨棚上的声响和远处车流的低鸣，中段是踩过积水的脚步声，结尾雨声变稀，只剩灯下零星的滴水声。', '',
  'non_diegetic_music:', '一把低音钢琴弹出缓慢的单音旋律，每小节只落两三个音；[Shot 3] 她停下时加入一层很轻的弦乐长音，回头时钢琴停住，只留弦乐慢慢减弱。'
].join('\n');
var P_SLOW_V2 = P_SLOW_V3.replace('停留两秒后回头', '停留一秒后回头').replace('她停住两秒，', '她停住一秒，');
var P_SLOW_V1 = P_SLOW_V2.replace('每一步之间有明显的停顿，', '').replace('；[Shot 3] 她停下时加入一层很轻的弦乐长音，回头时钢琴停住，只留弦乐慢慢减弱。', '，结尾停在一个长音上。');

var P_GRID9 = [
  'subject_definitions:', HEROINE, ALLEY, LAMP,
  '<Picture 4> 是分镜参考：九宫格从左上到右下按播放顺序排，决定 [Shot 1] 到 [Shot 5] 的景别和主体位置。', '',
  'summary:', '[reference generation] 目标视频里，<Subject 1> 穿过 <Subject 2>，停在 <Subject 3> 下回头，五个镜头，无台词，镜头拆分按 <Picture 4> 安排。', '',
  'retention_analysis:',
  '<Subject 1>（出现在 [Shot 1] 到 [Shot 5]）：fully_preserved - 黑色直发、炭灰色大衣、红围巾和透明伞都保留。',
  '<Subject 2>（出现在 [Shot 1]、[Shot 2]）：fully_preserved - 招牌灯光和积水路面保留。',
  '<Subject 3>（出现在 [Shot 4]、[Shot 5]）：fully_preserved - 暖黄灯光和雨丝保留。',
  '<Picture 4>（分镜参考）：weak_reference - 只参考镜头顺序、景别和主体位置。', '',
  'detailed_description:',
  '目标视频是写实的电影感风格，夜晚冷暖对比。',
  '[Shot 1] 远景，按九宫格第一排左边，<Subject 1> 的背影走进 <Subject 2>。',
  '[Shot 2] At 00:02.000, 按第一排中间，招牌灯光扫过伞面的中景。',
  '[Shot 3] At 00:04.000, 按第一排右边，短靴踩进积水的低机位特写。',
  '[Shot 4] At 00:05.500, 按第二排右边，<Subject 3> 下的中景，她停住。',
  '[Shot 5] At 00:07.500, 按第三排中间，她回头的近景，保持到最后一帧。', '',
  'overall_soundscape:', '雨声贯穿全片，中间有踩水声。', '',
  'non_diegetic_music:', 'N/A'
].join('\n');

var P_T2V = [
  'subject_definitions:',
  '<Subject 1> 是一位年轻女性：齐肩黑色直发，炭灰色羊毛大衣，红色针织围巾，撑透明雨伞。',
  '<Subject 2> 是一条夜晚下雨的窄巷，两侧有发光招牌。', '',
  'summary:', '目标视频里，<Subject 1> 在雨夜穿过 <Subject 2>，停在一盏暖黄路灯下回头，两个镜头，无台词。', '',
  'retention_analysis:', 'N/A', '',
  'detailed_description:',
  '目标视频是写实的电影感风格，夜晚冷蓝色调。',
  '[Shot 1] 远景，<Subject 1> 撑伞走在 <Subject 2> 里，积水倒映招牌灯光，镜头缓慢推进。',
  '[Shot 2] At 00:04.000, 中近景，她停在暖黄路灯下，慢慢回头，镜头停住，保持到最后一帧。', '',
  'overall_soundscape:', '雨声和踩水的脚步声。', '',
  'non_diegetic_music:', 'N/A'
].join('\n');

/* ─── 译文示例 ───────────────────────────────────────────
   分节名、<Picture 1> 这类标记、<d> 里的台词照原文留着，其余按目标语言翻。 */
var TR_EN_DIR3 = [
  'subject_definitions:',
  '<Subject 1> is the young woman in <Picture 1>: shoulder-length straight black hair, a charcoal-gray wool coat, a bright red knitted scarf, holding a clear umbrella.',
  '<Subject 2> is the narrow alley in <Picture 2>: both sides lined with glowing vertical signboards, puddles on the ground, no passersby.',
  '<Subject 3> is the streetlamp in <Picture 3>: an old-fashioned slim lamppost, warm yellow sodium light, rain streaks clearly visible in the light.', '',
  'summary:', '[reference generation] In the target video, a handheld camera follows <Subject 1> through <Subject 2>. She stops under <Subject 3>, pauses for a moment, then turns back and says one line. Two shots.', '',
  'retention_analysis:',
  '<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - straight black hair, charcoal-gray coat, red scarf and clear umbrella are all kept.',
  '<Subject 2> (appears in [Shot 1]): fully_preserved - sign lights and wet pavement are kept.',
  '<Subject 3> (appears in [Shot 2]): fully_preserved - warm yellow light and rain streaks are kept.', '',
  'detailed_description:',
  'The target video is realistic and documentary-like, shot handheld, with a warm-cool contrast at night.',
  '[Shot 1] Medium shot. A handheld camera tracks <Subject 1> from a rear three-quarter angle, the frame bobbing slightly with her steps. She walks through <Subject 2> under her clear umbrella; blue light from the signs slides across the shoulders of her coat, and each step breaks the puddles into rings of ripples.',
  '[Shot 2] At 00:04.000, the camera swings around to her front three-quarter side. She stops under <Subject 3>, and a string of drops falls from the edge of her umbrella. She stands still for a while and lets out a breath that fogs in the cold air, then turns to look off-screen and says in a soft, calm young woman\'s voice: <d>[中文] 你也在等雨停吗？</d> After the line, the corner of her mouth moves slightly. The camera wobbles a little, then settles and holds until the last frame.', '',
  'overall_soundscape:', 'Rain and splashing footsteps run through the whole video, with the low hum of air-conditioner units in the alley and distant traffic.', '',
  'non_diegetic_music:', 'N/A'
].join('\n');

var TR_JA_DIR3 = [
  'subject_definitions:',
  '<Subject 1> は <Picture 1> の若い女性：肩までの黒いストレートヘア、チャコールグレーのウールコート、真っ赤なニットのマフラー、透明なビニール傘を差している。',
  '<Subject 2> は <Picture 2> の細い路地：両側に縦長の光る看板がびっしり並び、地面には水たまり、人通りはない。',
  '<Subject 3> は <Picture 3> の街灯：昔ながらの細い灯柱、暖かい黄色のナトリウム灯、光の中に雨筋がはっきり見える。', '',
  'summary:', '[reference generation] 目標の動画では、手持ちカメラが <Subject 1> を追って <Subject 2> を抜け、彼女は <Subject 3> の下で立ち止まり、少し間を置いてから振り返って一言話す。2 ショット。', '',
  'retention_analysis:',
  '<Subject 1>（[Shot 1]、[Shot 2] に登場）：fully_preserved - 黒いストレートヘア、チャコールグレーのコート、赤いマフラー、透明な傘をすべて保持。',
  '<Subject 2>（[Shot 1] に登場）：fully_preserved - 看板の光と濡れた路面を保持。',
  '<Subject 3>（[Shot 2] に登場）：fully_preserved - 暖かい黄色の光と雨筋を保持。', '',
  'detailed_description:',
  '目標の動画はリアルなドキュメンタリー調で、手持ち撮影、夜の寒色と暖色のコントラスト。',
  '[Shot 1] ミディアムショット。手持ちカメラが <Subject 1> の斜め後ろから追い、画面は足取りに合わせてわずかに揺れる。彼女は透明な傘を差して <Subject 2> を抜けていき、看板の青い光がコートの肩を滑り、踏まれた水たまりに波紋が広がる。',
  '[Shot 2] At 00:04.000, カメラが彼女の斜め前に回り込む。彼女は <Subject 3> の下で立ち止まり、傘の縁から水滴がひと連なり落ちる。しばらく静かに立ち、白い息をひとつ吐いてから、画面の外へ振り返り、柔らかく落ち着いた若い女性の声で言う：<d>[中文] 你也在等雨停吗？</d> 言い終えると口元がかすかに動く。カメラは少し揺れてから落ち着き、最後のフレームまで保持する。', '',
  'overall_soundscape:', '雨音と水を踏む足音が全編に流れ、路地には室外機の低いうなりと遠くの車の音がある。', '',
  'non_diegetic_music:', 'N/A'
].join('\n');

var TR_KO_DIR3 = [
  'subject_definitions:',
  '<Subject 1> 은 <Picture 1> 속 젊은 여성: 어깨까지 오는 검은 생머리, 차콜 그레이 울 코트, 새빨간 니트 목도리, 투명 우산을 쓰고 있다.',
  '<Subject 2> 는 <Picture 2> 속 좁은 골목: 양쪽에 세로로 된 빛나는 간판이 빼곡하고, 바닥에는 물이 고여 있으며, 행인은 없다.',
  '<Subject 3> 은 <Picture 3> 속 가로등: 오래된 가느다란 기둥, 따뜻한 노란 나트륨 불빛, 불빛 속으로 빗줄기가 선명하게 보인다.', '',
  'summary:', '[reference generation] 목표 영상에서 핸드헬드 카메라가 <Subject 1> 을 따라 <Subject 2> 를 지나가고, 그녀는 <Subject 3> 아래에 멈춰 잠시 뜸을 들인 뒤 돌아보며 한마디 한다. 숏 두 개.', '',
  'retention_analysis:',
  '<Subject 1>([Shot 1], [Shot 2] 에 등장): fully_preserved - 검은 생머리, 차콜 그레이 코트, 빨간 목도리와 투명 우산을 모두 유지.',
  '<Subject 2>([Shot 1] 에 등장): fully_preserved - 간판 불빛과 젖은 노면을 유지.',
  '<Subject 3>([Shot 2] 에 등장): fully_preserved - 따뜻한 노란 불빛과 빗줄기를 유지.', '',
  'detailed_description:',
  '목표 영상은 사실적인 다큐멘터리풍이며, 핸드헬드로 촬영하고, 밤의 차가운 색과 따뜻한 색이 대비를 이룬다.',
  '[Shot 1] 미디엄 숏. 핸드헬드 카메라가 <Subject 1> 의 비스듬한 뒤에서 따라가며, 화면이 걸음에 맞춰 살짝 흔들린다. 그녀는 투명 우산을 쓰고 <Subject 2> 를 지나가고, 간판의 파란 불빛이 코트 어깨 위를 스치며, 밟힌 물웅덩이에 동그란 물결이 퍼진다.',
  '[Shot 2] At 00:04.000, 카메라가 그녀의 비스듬한 앞쪽으로 돌아간다. 그녀는 <Subject 3> 아래에 멈추고, 우산 끝에서 물방울이 줄지어 떨어진다. 한동안 가만히 서서 하얀 입김을 내쉰 뒤, 화면 밖을 돌아보며 부드럽고 차분한 젊은 여성의 목소리로 말한다: <d>[中文] 你也在等雨停吗？</d> 말을 마치자 입꼬리가 살짝 움직인다. 카메라는 잠깐 흔들리다 자리를 잡고, 마지막 프레임까지 유지한다.', '',
  'overall_soundscape:', '빗소리와 물을 밟는 발소리가 영상 내내 이어지고, 골목에는 실외기의 낮은 웅웅거림과 멀리서 들리는 차 소리가 있다.', '',
  'non_diegetic_music:', 'N/A'
].join('\n');

var TR_EN_SLOW_V3 = [
  'subject_definitions:',
  '<Subject 1> is the young woman in <Picture 1>: shoulder-length straight black hair, a charcoal-gray wool coat, a bright red knitted scarf, holding a clear umbrella.',
  '<Subject 2> is the narrow alley in <Picture 2>: both sides lined with glowing vertical signboards, puddles on the ground, no passersby.',
  '<Subject 3> is the streetlamp in <Picture 3>: an old-fashioned slim lamppost, warm yellow sodium light, rain streaks clearly visible in the light.',
  '<Picture 4> is the storyboard reference for [Shot 1] to [Shot 3]: the top-left panel sets the wide back view of [Shot 1], the top-right panel sets the footstep close-up of [Shot 2], and the bottom-right panel sets the medium close-up of the turn in [Shot 3].', '',
  'summary:', '[reference generation] In the target video, <Subject 1> walks slowly under her umbrella from the foreground deep into <Subject 2>, stops under <Subject 3> at the mouth of the alley, holds for two seconds, then looks back. Three shots, no dialogue throughout, a very slow pace, with the order of shot sizes following <Picture 4>.', '',
  'retention_analysis:',
  '<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - straight black hair, charcoal-gray coat, red scarf and clear umbrella are all kept.',
  '<Subject 2> (appears in [Shot 1]): fully_preserved - the vertical glowing signs, wet pavement and depth are kept.',
  '<Subject 3> (appears in [Shot 3]): partially_preserved - keep the warm yellow sodium light and the shape of the lamppost; the surroundings become the mouth of the alley.',
  '<Picture 4> (storyboard reference for [Shot 1] to [Shot 3]): weak_reference - use only the order of shot sizes and the subject positions.', '',
  'detailed_description:',
  'The target video is realistic and cinematic, at night. The cold blue of the signs and the warm yellow of the sodium lamp create a warm-cool contrast, the image carries a light film grain, and the red scarf is the most saturated color in the whole video.',
  '[Shot 1] Wide shot. The camera sits on the center line of <Subject 2>; the vertical glowing signs on both sides stretch all the way into the depth of the frame, and the wet pavement reflects blue and pink light. <Subject 1>, holding a clear umbrella with her back to the camera, walks slowly from the foreground toward the far end of the alley, her figure gradually getting smaller, the raindrops on her umbrella lit up by the signs. Rain falls at a slant. The camera pushes in behind her at an extremely slow speed, almost imperceptibly. Dense rain can be heard drumming on the umbrella and on the tin awnings.',
  '[Shot 2] At 00:03.500, cut to a low-angle close-up: <Subject 1>\'s ankle boot steps into a puddle, and the reflection of the signs in the water breaks apart, then slowly closes again. Her steps are very slow, with a clear pause between each one, and tiny water drops cling to the hem of her coat. Her footsteps make soft splashing sounds.',
  '[Shot 3] At 00:06.000, cut to a medium close-up at the mouth of the alley. <Subject 3> stands on the right third of the frame, warm yellow light falling from above, the rain beneath it coming down strand by strand against the backlight. <Subject 1> enters from the left of the frame, stops under the lamp and tilts the edge of her umbrella up slightly. She holds still for two seconds, her shoulders rising and falling gently with her breath, then slowly turns her head to look back the way she came. One side of her face is lit by the warm light while the other stays in cold blue shadow, and the red of her scarf stands out sharply under the lamp. The camera slowly pushes in to a close-up of her and stops the moment her gaze settles, holding until the last frame. The rain gradually thins out.', '',
  'overall_soundscape:', 'Dense rain runs through the whole video. The first half has rain hitting the umbrella and the tin awnings over the low rumble of distant traffic, the middle is footsteps splashing through puddles, and at the end the rain thins until only scattered drips under the lamp remain.', '',
  'non_diegetic_music:', 'A low piano plays a slow single-note melody, only two or three notes per bar; in [Shot 3], when she stops, a very soft sustained string note comes in, and when she turns back the piano stops, leaving only the strings slowly fading out.'
].join('\n');
var TR_EN_SLOW_V2 = TR_EN_SLOW_V3.replace('holds for two seconds, then looks back', 'holds for one second, then looks back').replace('She holds still for two seconds,', 'She holds still for one second,');
var TR_EN_SLOW_V1 = TR_EN_SLOW_V2.replace(', with a clear pause between each one', '').replace('; in [Shot 3], when she stops, a very soft sustained string note comes in, and when she turns back the piano stops, leaving only the strings slowly fading out.', ', ending on a long held note.');

var TRANSLATION_SAMPLES = [
  { src: P_DIR3, '英文': TR_EN_DIR3, '日文': TR_JA_DIR3, '韩文': TR_KO_DIR3 },
  { src: P_SLOW_V3, '英文': TR_EN_SLOW_V3 },
  { src: P_SLOW_V2, '英文': TR_EN_SLOW_V2 },
  { src: P_SLOW_V1, '英文': TR_EN_SLOW_V1 }
];
/* 原型里假装翻好：翻成中文就原样返回；有这段原文的示例用示例；没有就用开头最像的那段的示例 */
function translationSample(src, lang) {
  if (lang === '中文') return src;
  var list = TRANSLATION_SAMPLES.filter(function (s) { return s[lang]; });
  var best = list[0], bestLen = -1;
  list.forEach(function (s) {
    var i = 0;
    while (i < s.src.length && s.src.charAt(i) === src.charAt(i)) i++;
    if (i > bestLen) { best = s; bestLen = i; }
  });
  return best[lang];
}

/* ─── 节点与对话 ────────────────────────────────────────────
   thread 是一串位置；每个位置有若干版本，cur 是当前显示第几个。
   版本上的 rest 表示「选中这个版本时，后面接的是这一串」，用来还原旧版本之后的对话。
   forkFrom 表示前 count 个位置是从父节点复制来的。 */
var CANVAS = {
  id: 'cv1', title: '新年广告片',
  nodes: [
    { id: 'n1', title: '雨夜灯下回头', parent: null, x: 0, y: 150, collapsed: false,
      model: 'm1', sys: 'ref2va', slots: ['a1', 'a3', 'a4'], duration: 8, ratio: '16:9',
      summary: '三个方向：跟拍背影、慢推近景、手持加一句台词',
      thread: [
        { role: 'user', cur: 0, versions: [
          { auto: '参考图共 3 张，编号如下。视频时长 8 秒，画面比例 16:9。',
            text: '一个人在雨里走，最后停在灯下回头。<Picture 1> 是主角，<Picture 2> 是她走的那条街，<Picture 3> 是最后停下的那盏灯。给我三个方向。',
            imgs: ['a1', 'a3', 'a4'], duration: 8, ratio: '16:9', at: '9月16日 16:52' }
        ] },
        { role: 'ai', cur: 1, versions: [
          { model: 'm1', sys: 'ref2va', sysAt: '9月16日 16:52', tin: 9284, tout: 1902, tcache: 0, at: '16:53',
            intro: '先给两个方向，区别在镜头是跟着人走还是慢慢推近。',
            boxes: [ { label: '方向一：跟拍背影，结尾甩头', text: P_DIR1 }, { label: '方向二：慢推近景，无台词', text: P_DIR2 } ] },
          { model: 'm1', sys: 'ref2va', sysAt: '9月16日 16:52', tin: 9301, tout: 3418, tcache: 8960, at: '16:58', regen: true,
            intro: '按三张图的分工写了三个方向，区别在镜头运动和有没有台词。三个方向都是 8 秒、16:9，主角外貌完全按 <Picture 1> 保留。\n\n假设：<Picture 2> 的窄巷和 <Picture 3> 的路灯在同一条街上，路灯在巷口。',
            boxes: [ { label: '方向一：跟拍背影，结尾甩头', text: P_DIR1 }, { label: '方向二：慢推近景，无台词', text: P_DIR2, starred: true }, { label: '方向三：手持跟拍，一句台词', text: P_DIR3, translations: {
              '英文': { text: TR_EN_DIR3, at: '9月16日 17:40', ts: Date.parse('2026-09-16T17:40:00'), modelId: 'm1', modelName: 'MiniMax-M2', tin: 1402, tout: 731, instruction: '镜头术语用影视行业里的常见说法' },
              '日文': { text: TR_JA_DIR3, at: '9月16日 17:33', ts: Date.parse('2026-09-16T17:33:00'), modelId: 'm1', modelName: 'MiniMax-M2', tin: 1398, tout: 866, instruction: '' } } } ] }
        ] }
      ] },

    { id: 'n2', title: '慢推近景·灯下停留', parent: 'n1', forkFrom: { node: 'n1', count: 2 }, x: 344, y: 20, collapsed: false,
      model: 'm1', sys: 'ref2va', slots: ['a1', 'a3', 'a4', 'k1'], duration: 10, ratio: '9:16',
      summary: '慢慢走进窄巷深处，在巷口路灯下停两秒再回头',
      thread: [
        { role: 'user', cur: 0, versions: [
          { auto: '新增参考图：<Picture 4>。视频时长改为 10 秒。',
            text: '沿第 2 个方向（慢推近景，无台词）往下改：再慢一点，灯下多停两秒，回头时雨丝要在逆光里看得见。<Picture 4> 是分镜，按它排景别。',
            imgs: ['a1', 'a3', 'a4', 'k1'], duration: 10, ratio: '16:9', at: '9月16日 17:06' }
        ] },
        { role: 'ai', cur: 2, versions: [
          { model: 'm1', sys: 'ref2va', sysAt: '9月16日 17:06', tin: 12840, tout: 2210, tcache: 9301, at: '17:07',
            intro: '按 <Picture 4> 拆成三个镜头：背影远景、脚步特写、回头中近景。', boxes: [ { label: null, text: P_SLOW_V1 } ] },
          { model: 'm1', sys: 'ref2va', sysAt: '9月16日 17:06', tin: 12840, tout: 2356, tcache: 12544, at: '17:11', regen: true,
            intro: '按 <Picture 4> 拆成三个镜头：背影远景、脚步特写、回头中近景。脚步之间加了停顿，配乐在回头时收住。', boxes: [ { label: null, text: P_SLOW_V2 } ] },
          { manual: true, at: '17:19', boxes: [ { label: null, text: P_SLOW_V3, starred: true, translations: {
              '英文': { text: TR_EN_SLOW_V3, at: '9月16日 17:24', ts: Date.parse('2026-09-16T17:24:00'), modelId: 'm1', modelName: 'MiniMax-M2', tin: 2236, tout: 1318, instruction: '' } } } ] }
        ] }
      ] },

    { id: 'n3', title: '手持跟拍·一句台词', parent: 'n1', forkFrom: { node: 'n1', count: 2 }, x: 344, y: 330, collapsed: false,
      model: 'm1', sys: 'ref2va', slots: ['a1', 'a3', 'a4'], duration: 8, ratio: '16:9',
      summary: '手持跟拍穿过窄巷，灯下回头问「你也在等雨停吗？」',
      thread: [
        { role: 'user', cur: 0, versions: [
          { auto: null, text: '沿第 3 个方向（手持跟拍，一句台词）往下改：台词换成「你也在等雨停吗？」，回头前加一个停顿。',
            imgs: ['a1', 'a3', 'a4'], duration: 8, ratio: '16:9', at: '9月16日 17:24' }
        ] },
        { role: 'ai', cur: 0, versions: [
          { model: 'm1', sys: 'ref2va', sysAt: '9月16日 17:24', tin: 12102, tout: 0, tcache: 9301, at: '17:24', streaming: true,
            intro: '台词换好了，回头前加了「静静站了一会儿，呼出一口白气」的停顿。', boxes: [ { label: null, text: P_DIR3 } ] }
        ] }
      ] },

    { id: 'n4', title: '红伞版本', parent: 'n2', forkFrom: { node: 'n2', count: 4 }, x: 688, y: -120, collapsed: false,
      model: 'm1', sys: 'ref2va', slots: ['a8', 'a3', 'a4', 'k1'], duration: 10, ratio: '16:9',
      summary: '慢慢走进窄巷深处，在巷口路灯下停两秒再回头',
      thread: [
        { role: 'user', cur: 0, versions: [
          { auto: '<Picture 1> 换成了下面的新图，其他不变。', text: '把透明伞换成红伞，<Picture 1> 换成回头那张定妆照，其他不变。',
            imgs: ['a8', 'a3', 'a4', 'k1'], duration: 10, ratio: '16:9', at: '9月16日 17:36' }
        ] },
        { role: 'ai', cur: 0, versions: [
          { failed: { code: '429', reason: 'Rate limit reached for requests（上游限流）', at: '17:36:41' }, model: 'm1', sys: 'ref2va', at: '17:36' }
        ] }
      ] },

    { id: 'n5', title: '九宫格分镜试验', parent: 'n2', forkFrom: { node: 'n2', count: 4 }, x: 688, y: 120, collapsed: true,
      model: 'm1', sys: 'ref2va-台词多', slots: ['a1', 'a3', 'a4', 'k2'], duration: 10, ratio: '16:9',
      summary: '按九宫格分镜拆成五个镜头',
      thread: [
        { role: 'user', cur: 0, versions: [
          { auto: '<Picture 4> 换成了下面的新图，其他不变。', text: '分镜换成 3×3 的，每格加了编号，看镜头能不能拆得更细。',
            imgs: ['a1', 'a3', 'a4', 'k2'], duration: 10, ratio: '16:9', at: '9月16日 17:41' }
        ] },
        { role: 'ai', cur: 0, versions: [
          { model: 'm1', sys: 'ref2va-台词多', sysAt: '9月16日 17:41', tin: 13320, tout: 1480, tcache: 12544, at: '17:42',
            intro: '九宫格里有编号，但提示词里还是按「第一排左边」这样的位置来指，H3 不认格子上的数字。', boxes: [ { label: null, text: P_GRID9 } ] }
        ] }
      ] },

    { id: 'n6', title: '竖屏 9:16', parent: 'n5', forkFrom: { node: 'n5', count: 6 }, x: 1032, y: 40, collapsed: false,
      model: 'm1', sys: 'ref2va', slots: ['a1', 'a3', 'a4', 'k2'], duration: 10, ratio: '9:16',
      summary: '九宫格分镜的竖屏构图版', thread: [] },
    { id: 'n7', title: '去掉脚步特写', parent: 'n5', forkFrom: { node: 'n5', count: 6 }, x: 1032, y: 230, collapsed: false,
      model: 'm1', sys: 'ref2va', slots: ['a1', 'a3', 'a4', 'k2'], duration: 8, ratio: '16:9',
      summary: '四个镜头，节奏更紧', thread: [] },

    { id: 'n8', title: '纯文字对照', parent: null, x: 30, y: 520, collapsed: false,
      model: 'm2', sys: 't2v', slots: [], duration: 8, ratio: '16:9',
      summary: '不用参考图，只靠文字写同一个创意',
      thread: [
        { role: 'user', cur: 0, versions: [
          { auto: '视频时长 8 秒，画面比例 16:9。', text: '不用参考图，只用文字：一个人在雨里走，最后停在灯下回头。和有图的版本对照看。',
            imgs: [], duration: 8, ratio: '16:9', at: '9月16日 17:02' }
        ] },
        { role: 'ai', cur: 0, versions: [
          { model: 'm2', sys: 't2v', sysAt: '9月16日 17:02', tin: 3210, tout: 690, tcache: 0, at: '17:02',
            intro: '没有参考图，人物和街道都按文字定义。', boxes: [ { label: null, text: P_T2V } ] }
        ] }
      ] }
  ]
};
