/* 生图和思考的示例数据。标签、中文名、使用次数、分类都从 data/danbooru/ 原样摘出来。
   要在 canvas-data.js 之后、canvas-graph.js 之前加载：生图节点要并进 CANVAS.nodes。 */

/* ─── 词库（摘出来的一部分）：标签名、分类、使用次数、中文名 ───
   分类：0 通用、1 画师、3 作品、4 角色、5 元标签 */
var TAG_ROWS = [
  ['1girl', 0, 8491444, '一个女孩'], ['solo', 0, 7127765, '单人'], ['long_hair', 0, 6270082, '长发'],
  ['brown_hair', 0, 2107772, '棕发'], ['wavy_hair', 0, 151104, '波浪卷发'], ['yellow_eyes', 0, 1034980, '黄瞳'],
  ['orange_eyes', 0, 259391, '橙瞳'], ['white_shirt', 0, 1436243, '白衬衫'], ['collared_shirt', 0, 775875, '带领衬衫'],
  ['sweater_vest', 0, 68066, '毛衣背心'], ['blue_sweater_vest', 0, 2801, '蓝色毛衣背心'], ['red_bowtie', 0, 117355, '红色领结'],
  ['bowtie', 0, 498634, '领结'], ['school_uniform', 0, 1066447, '校服'], ['sitting', 0, 1326162, '坐姿'],
  ['window', 0, 182115, '窗户'], ['windowsill', 0, 1629, '窗台'], ['reading', 0, 24040, '阅读'],
  ['book', 0, 192838, '书'], ['holding_book', 0, 74789, '手持书'], ['open_book', 0, 41373, '打开的书'],
  ['hugging_book', 0, 1267, '抱着书'], ['turning_page', 0, 368, '翻页'], ['sunset', 0, 39705, '日落'],
  ['evening', 0, 13606, '傍晚'], ['twilight', 0, 9055, '黄昏'], ['dusk', 0, 6152, '黄昏'], ['orange_sky', 0, 9693, '橙色的天空'],
  ['sunlight', 0, 103216, '阳光'], ['light_rays', 0, 33492, '光线（光束）'], ['backlighting', 0, 46034, '逆光'],
  ['sidelighting', 0, 13416, '侧光'], ['warm_colors', 0, 1919, '暖色调'], ['indoors', 0, 557969, '室内'],
  ['classroom', 0, 26449, '教室'], ['school_desk', 0, 25662, '课桌'], ['desk', 0, 57723, '书桌'], ['chair', 0, 149492, '椅子'],
  ['curtains', 0, 93404, '窗帘'], ['from_side', 0, 342413, '侧视'], ['profile', 0, 183918, '侧脸'],
  ['from_above', 0, 147801, '俯视'], ['from_below', 0, 121086, '仰视'], ['from_outside', 0, 2430, '室外看向室内(的镜头)'],
  ['smile', 0, 4214157, '微笑'], ['closed_mouth', 0, 1996713, '闭嘴'], ['blush', 0, 4140297, '脸红'],
  ['closed_eyes', 0, 1070839, '闭眼'], ['sleeping', 0, 102173, '睡觉'], ['looking_away', 0, 33456, '移开视线'],
  ['looking_at_viewer', 0, 4969718, '看向观者'], ['looking_back', 0, 368036, '回眸'], ['head_rest', 0, 45685, '头部依靠（头枕）'],
  ['upper_body', 0, 1209303, '上半身'], ['cowboy_shot', 0, 862720, '牛仔构图'], ['standing', 0, 1345903, '站立'],
  ['wariza', 0, 109890, '跪坐（鸭子坐）'], ['against_wall', 0, 20084, '靠着墙'], ['depth_of_field', 0, 126128, '景深'],
  ['blurry_background', 0, 187767, '模糊背景'], ['bokeh', 0, 10768, '焦外成像'], ['wind', 0, 68429, '风'],
  ['floating_hair', 0, 196553, '飘浮的头发'], ['hair_between_eyes', 0, 1807416, '眉心垂发'], ['blunt_bangs', 0, 433731, '齐刘海'],
  ['blonde_hair', 0, 2193701, '金发'], ['gold_hairband', 0, 4711, '金发带'], ['black_hair', 0, 2224332, '黑发'],
  ['white_hair', 0, 1056492, '白发'], ['aqua_hair', 0, 180908, '水色头发'], ['streaked_hair', 0, 444472, '挑染发'],
  ['multicolored_hair', 0, 1205906, '多彩发色'], ['two-tone_hair', 0, 407132, '双色头发'],
  ['twintails', 0, 1247740, '双马尾'], ['low_twintails', 0, 166034, '低双马尾'], ['short_twintails', 0, 87733, '短双马尾'],
  ['braided_twintails', 0, 5337, '编发双马尾'], ['aqua_eyes', 0, 258433, '水色瞳'], ['red_eyes', 0, 1795969, '红眼'],
  ['hoodie', 0, 200943, '连帽衫'], ['hood', 0, 447194, '兜帽'], ['hood_down', 0, 146951, '兜帽放下'], ['headphones', 0, 139105, '耳机'],
  ['long_sleeves', 0, 2380287, '长袖'], ['sleeves_past_wrists', 0, 240590, '袖子长过手腕'],
  ['city', 0, 35468, '城市'], ['city_lights', 0, 6992, '城市灯光背景'], ['night', 0, 173044, '夜晚'], ['rain', 0, 49261, '雨'],
  ['wet', 0, 197201, '湿漉'], ['neon_lights', 0, 3590, '霓虹灯'], ['umbrella', 0, 121636, '雨伞'],
  ['transparent_umbrella', 0, 4951, '透明雨伞'], ['holding_umbrella', 0, 53334, '持伞'], ['reflection', 0, 56978, '倒影'],
  ['puddle', 0, 8131, '水坑'], ['crosswalk', 0, 3678, '人行横道'], ['cyberpunk', 0, 4484, '赛博朋克'],
  ['fox_ears', 0, 221141, '狐耳'], ['fox_tail', 0, 146707, '狐尾'], ['fox_girl', 0, 150613, '狐娘'], ['animal_ears', 0, 1781128, '兽耳'],
  ['kitsune', 0, 18533, '狐狸（狐妖）'], ['miko', 0, 23200, '巫女'], ['red_hakama', 0, 20331, '红色袴'], ['japanese_clothes', 0, 534606, '日本传统服装'],
  ['torii', 0, 16870, '鸟居'], ['snow', 0, 56505, '雪'], ['snowing', 0, 37889, '下雪'], ['snowflakes', 0, 18696, '雪花'],
  ['shrine', 0, 6317, '神社'], ['stone_lantern', 0, 2568, '石灯笼'], ['lantern', 0, 39364, '灯笼'], ['breath', 0, 65406, '呼吸（白气）'],
  ['outdoors', 0, 817951, '户外'], ['sky', 0, 625908, '天空'], ['cloud', 0, 402761, '云'], ['scenery', 0, 75636, '风景'],
  ['pastel_colors', 0, 4824, '柔和的颜色'], ['glasses', 0, 509323, '眼镜'], ['nervous_smile', 0, 12225, '不安地微笑'],
  ['signature', 0, 448213, '签名'], ['watermark', 0, 249632, '水印'], ['bad_anatomy', 0, 18336, '错误解剖（肢体错位）'],
  ['bad_hands', 0, 3375, '手的画法错误'], ['extra_digits', 0, 540, '多指（趾）'], ['username', 0, 96, '用户名'],
  ['hatsune_miku', 4, 146849, '初音未来'], ['vocaloid', 3, 210943, 'VOCALOID'],
  ['ningen_mame', 1, 634, ''], ['mika_pikazo', 1, 1122, ''], ['fuzichoco', 1, 1165, '藤原'],
  ['highres', 5, 8255139, '高分辨率'], ['absurdres', 5, 3041427, '超高分辨率'], ['lowres', 5, 113374, '低分辨率'],
  ['jpeg_artifacts', 5, 27371, 'JPEG伪影'], ['watercolor_(medium)', 5, 22923, '水彩']
];
/* 官方别名：旧写法 → 标准写法 */
var TAG_ALIASES = { blond_hair: 'blonde_hair', chin_rest: 'head_rest', shrine_maiden: 'miko', book_hug: 'hugging_book' };
var TAG_CAT = { 0: '通用', 1: '画师', 3: '作品', 4: '角色', 5: '元标签' };
/* 不认识的标签，原型里预先算好的最接近的几个（正式程序按 5.13 现算） */
var TAG_NEAR = {
  'amber eyes': ['yellow_eyes', 'orange_eyes', 'aqua_eyes', 'red_eyes', 'closed_eyes'],
  'warm sunset glow': ['sunset', 'sunlight', 'warm_colors', 'orange_sky', 'backlighting'],
  'page turning': ['turning_page', 'open_book', 'reading', 'holding_book', 'book'],
  'soft lighting': ['sidelighting', 'backlighting', 'sunlight', 'light_rays', 'pastel_colors'],
  'neon glow': ['neon_lights', 'glowing', 'city_lights', 'cyberpunk', 'night']
};
TAG_ROWS.push(['glowing', 0, 139997, '发光']);
var TAGDB = {};
TAG_ROWS.forEach(function (r) { TAGDB[r[0]] = { tag: r[0], cat: r[1], count: r[2], zh: r[3] }; });

/* ─── 两个系列的固定写法和默认值（dev-plan 5.18 的初始值） ─── */
var SERIES = {
  IL: { prefix: 'masterpiece, best quality', neg: 'lowres, worst quality, bad quality, bad anatomy, bad hands, extra digits, jpeg artifacts, signature, watermark, username, text',
        rating: { '全年龄': 'general', '擦边': 'sensitive', '成人': 'explicit' }, steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal', clip: 2,
        upscale: '4x-AnimeSharp.pth', cn: 'illustriousXL_openpose_v1.safetensors', ipa: 'noobIPAMARK1_mark1.safetensors', clipv: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors' },
  Pony: { prefix: 'score_9, score_8_up, score_7_up', neg: 'score_6, score_5, score_4, worst quality, low quality, watermark, signature, text',
        rating: { '全年龄': 'rating_safe', '擦边': 'rating_questionable', '成人': 'rating_explicit' }, steps: 25, cfg: 7, sampler: 'euler_ancestral', scheduler: 'normal', clip: 2,
        upscale: '4x-AnimeSharp.pth', cn: 'xinsir_controlnet-openpose-sdxl-1.0.safetensors', ipa: 'ip-adapter-plus_sdxl_vit-h.safetensors', clipv: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors' }
};
var QUALITY_WORDS = ['masterpiece', 'best quality', 'very aesthetic', 'score_9', 'score_8_up', 'score_7_up', 'general', 'sensitive', 'rating_safe'];
var SIZES = [
  { v: '1024×1024', k: '正方形' },
  { v: '896×1152', k: '竖' }, { v: '832×1216', k: '竖' }, { v: '768×1344', k: '竖' }, { v: '640×1536', k: '竖' },
  { v: '1152×896', k: '横' }, { v: '1216×832', k: '横' }, { v: '1344×768', k: '横' }, { v: '1536×640', k: '横' }
];

/* ─── 系统提示词：生图用的两套自带，一套自己复制改的 ─── */
var IMAGE_PROMPTS = { il: 'IL', pony: 'Pony', 'il-厚涂': 'IL' };
SYSTEM_PROMPTS.push('il', 'pony', 'il-厚涂');
function seriesOf(sys) { return IMAGE_PROMPTS[sys] || null; }
function isImageNode(n) { return !!(n && seriesOf(n.sys)); }

/* ─── 思考：总档位和三个用途；模型配置的「开思考的写法」 ─── */
var THINK = { level: '中', uses: { write: '跟总开关', translate: '关', toTags: '关' } };
var THINK_STYLES = ['不支持', 'reasoning_effort', 'enable_thinking', 'thinking.type', '换模型名'];
MODEL_CONFIGS[0].think = 'reasoning_effort';   // 主力 MiniMax-M2：不发思考原文
MODEL_CONFIGS[1].think = '不支持';
MODEL_CONFIGS.push({ id: 'm4', name: '通义', model: 'qwen-plus', think: 'enable_thinking', price: { cur: '¥', inp: 0.8, out: 2, cache: 0.16 } });

/* ─── ComfyUI 和 AutoDL ─── */
var COMFY = {
  use: 'lan',
  lan: { url: 'http://192.168.1.20:8188', state: 'ok', version: '0.3.62', gpu: 'NVIDIA GeForce RTX 4070 Ti SUPER', vram: '16 GB' },
  autodl: { tokenSet: true, instance: 'ComfyUI-纯净版', region: '西北B区', gpu: 'RTX 4090 · 24 GB', price: '¥2.18/小时',
            state: 'off', since: 0, idleMin: 15, idleLeft: 0, byApp: false, error: null }
};
var CHECKPOINTS = [
  { name: 'waiIllustriousSDXL_v150.safetensors', series: 'IL', guessed: false },
  { name: 'noobaiXLNAIXL_epsilonPred11Version.safetensors', series: 'IL', guessed: false },
  { name: 'illustriousXL_v01.safetensors', series: 'IL', guessed: true },
  { name: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors', series: 'Pony', guessed: true },
  { name: 'autismmixSDXL_autismmixPony.safetensors', series: 'Pony', guessed: true },
  { name: 'hassakuXLIllustrious_v21.safetensors', series: 'IL', guessed: true }
];
var LORAS = ['my_watercolor_style_il.safetensors', 'sunset_lighting_xl.safetensors', 'add-detail-xl.safetensors', 'neon_city_pony.safetensors', 'better_hands_il_v2.safetensors'];
var SAMPLERS = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'dpmpp_3m_sde', 'uni_pc'];
var SCHEDULERS = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'beta'];
var WORKFLOWS = [
  { id: 'builtin', name: '内置基础流程', builtin: true },
  { id: 'wf1', name: '高清修复两段式', file: 'hires-2pass-api.json', at: '9月28日', map: { pos: '6 · CLIPTextEncode · 正面', neg: '7 · CLIPTextEncode · 负面', seed: '3 · KSampler · seed', size: '5 · EmptyLatentImage' }, needs: [] },
  { id: 'wf2', name: '区域提示词·双人', file: 'regional-2girls-api.json', at: '10月1日', map: { pos: '12 · CLIPTextEncode · 左边的人', neg: '15 · CLIPTextEncode · 负面', seed: '21 · KSamplerAdvanced · noise_seed', size: null }, needs: ['ComfyUI-Impact-Pack'] }
];
var FRAGMENTS = [
  { id: 'f1', name: '我的画风', cat: '画风', text: '(watercolor \\(medium\\):0.8), pastel colors, depth of field' },
  { id: 'f2', name: '栗发少女的外观', cat: '角色', text: '1girl, long hair, brown hair, wavy hair, yellow eyes, white shirt, collared shirt, sweater vest, red bowtie' },
  { id: 'f3', name: '狐耳巫女', cat: '角色', text: 'fox girl, fox ears, fox tail, white hair, red eyes, miko, red hakama, japanese clothes' },
  { id: 'f4', name: '傍晚窗边光', cat: '画风', text: 'sunset, orange sky, (light rays:1.2), backlighting, warm colors' },
  { id: 'f5', name: '收尾质量词', cat: '质量词', text: 'absurdres, highres' },
  { id: 'f6', name: '雨夜霓虹', cat: '其他', text: 'night, rain, city lights, neon lights, wet, reflection, puddle' }
];
var TAGLIB = { at: '2026-10-03', tags: 124319, zh: 99951, aliases: 21632, state: 'idle', step: 0 };
var IMAGE_TEMP = WORKDIR + '\\image-temp';
var LAST_DOWNLOAD = 'D:\\素材\\动漫角色\\角色设定';

/* ─── 出的图 ─── */
var GEN = {};
['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'].forEach(function (k) { GEN[k] = { src: 'img/gen/' + k + '-window-read.jpg' }; });
['e1', 'e2', 'e3', 'e4'].forEach(function (k) { GEN[k] = { src: 'img/gen/' + k + '-neon-rain.jpg' }; });
['e5', 'e6', 'e7', 'e8'].forEach(function (k) { GEN[k] = { src: 'img/gen/' + k + '-fox-shrine.jpg' }; });
/* 下载进资产库的那几张，能放进视频节点的槽位 */
FOLDERS.push({ id: 'f4', path: 'D:\\素材\\动漫角色', count: 38, children: [{ id: 'f4a', name: '角色设定', count: 12 }] });
IMAGES.g3 = { src: 'img/gen/d3-window-read.jpg', name: '窗边读书·傍晚-1834201173.png', folder: 'f4a', w: 1664, h: 2432, size: '6.8 MB' };
IMAGES.g6 = { src: 'img/gen/e6-fox-shrine.jpg', name: '雪夜神社·狐耳-2208116534.png', folder: 'f4a', w: 832, h: 1216, size: '1.9 MB' };

/* 一组出图。items 每项：g 图、seed、st 状态（done / queued / running / failed / stopped）、ms 用时 */
function job(o) {
  var base = { kind: 'gen', src: 'lan', workflow: 'builtin', size: '832×1216', steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal',
               ckpt: 'waiIllustriousSDXL_v150.safetensors', loras: [['sunset_lighting_xl.safetensors', 0.7]], rating: '全年龄', extraNeg: '' };
  for (var k in o) base[k] = o[k];
  return base;
}

/* ─── 生图提示词（框里就是模型写的那一串，原样存着；别名、不认识的在显示时校验） ─── */
var T_DIR1 = '1girl, solo, long hair, brown hair, wavy hair, amber eyes, white shirt, collared shirt, sweater vest, red bowtie, school uniform, sitting, windowsill, reading, holding book, open book, from side, profile, closed mouth, indoors, classroom, window, curtains, sunset, orange sky, sunlight, (light rays:1.2), warm sunset glow, depth of field';
var T_DIR2 = '1girl, solo, long hair, brown hair, wavy hair, yellow eyes, white shirt, sweater vest, red bowtie, school uniform, sitting, school desk, chin rest, reading, open book, (smile:0.8), looking away, upper body, indoors, classroom, window, sunset, orange sky, sidelighting, warm colors, blurry background';
var T_DIR3 = '1girl, solo, long hair, brown hair, (floating hair:1.1), yellow eyes, white shirt, sweater vest, red bowtie, standing, hugging book, page turning, looking back, smile, cowboy shot, indoors, window, curtains, wind, sunset, backlighting, (ningen mame:0.6), (watercolor \\(medium\\):0.8), pastel colors, absurdres';
var T_NEON = '1girl, solo, twintails, black hair, streaked hair, aqua hair, aqua eyes, hoodie, hood down, headphones, holding umbrella, transparent umbrella, looking back, night, rain, city, neon lights, wet, reflection, puddle, crosswalk, cyberpunk, from below';
var T_MIKU = 'hatsune miku, vocaloid, 1girl, solo, twintails, aqua hair, aqua eyes, sitting, windowsill, reading, open book, smile, indoors, window, sunset, orange sky, sunlight, warm colors';
var T_FOX = '1girl, solo, fox girl, fox ears, fox tail, white hair, red eyes, shrine maiden, red hakama, japanese clothes, standing, holding lantern, breath, smile, outdoors, shrine, torii, stone lantern, snow, snowing, night';

var THINK_N9 = [
  '用户要的是：栗色长发的女生，窗边看书，傍晚，暖色。要三个方向，节点用的是 IL 系列的提示词，只写 Danbooru 标签。',
  '',
  '先定共同的部分：1girl, solo 打头。外观按用户之前说过的定妆：栗色长发带一点卷，眼睛偏琥珀色——Danbooru 里琥珀色眼睛不确定有没有专门的标签，先写 amber eyes，程序会校验。服装用白衬衫、毛衣背心、红领结，加 school uniform 让整体更像校服。',
  '',
  '三个方向怎么拉开差别：',
  '1. 侧面坐在窗台上低头看书，安静，重点是夕阳从窗外打进来的光束。加 light rays 并稍微加权。',
  '2. 坐在课桌前托腮看书，半身，表情放松，背景虚化，光从侧面来。托腮写 chin rest。',
  '3. 站着抱书回头笑，有风吹起头发和窗帘，逆光，画风轻一点，可以加水彩感和一个画师风格做弱参考，权重压低。',
  '',
  '顺序按人数、外观、服装、动作、构图、背景、画风排。不写 masterpiece 这类质量词，程序会按系列自动加。',
  '',
  '检查一下：三个框都没有写评级词；方向三的画师权重 0.6，不会盖过整体画风。'
].join('\n');

var CANVAS_IMAGE_NODES = [
  { id: 'n9', title: '窗边读书·傍晚', parent: null, x: 0, y: 820, collapsed: false,
    model: 'm4', sys: 'il', slots: [], duration: 8, ratio: '16:9', size: '832×1216', count: 4,
    image: { src: 'lan', workflow: 'builtin', ckpt: 'waiIllustriousSDXL_v150.safetensors', loras: [['sunset_lighting_xl.safetensors', 0.7]], seedMode: 'random', seed: 1834201170,
             steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal', rating: '全年龄', extraNeg: 'glasses' },
    summary: '3 个方向：窗台侧坐；课桌托腮；抱书回头',
    thread: [
      { role: 'user', cur: 0, versions: [
        { auto: null, text: '栗色长发的女生坐在窗边看书，傍晚，暖色。给我三个方向。', imgs: [], size: '832×1216', count: 4, at: '10月3日 16:31' }
      ] },
      { role: 'ai', cur: 0, versions: [
        { model: 'm4', sys: 'il', sysAt: '10月3日 16:31', tin: 4120, tout: 2860, tcache: 0, at: '16:32', thinking: { ms: 38000, text: THINK_N9 },
          intro: '三个方向的区别在姿势和光线：窗台侧坐看书、课桌前托腮、站着抱书回头。三个都按你之前定的外观写，没写质量词，程序会按 IL 系列自动加。',
          boxes: [
            { label: '方向一：窗台侧坐，光束', text: T_DIR1, starred: true, jobs: [
              job({ id: 'j1', at: '16:35', ts: Date.parse('2026-10-03T16:35:00'), seed0: 1834201170, items: [
                { g: 'd1', seed: 1834201170, st: 'done', ms: 21400 }, { g: 'd2', seed: 1834201171, st: 'done', ms: 20900 },
                { g: 'd3', seed: 1834201172, st: 'done', ms: 21100, star: true, dl: LAST_DOWNLOAD + '\\窗边读书·傍晚-1834201172.png' }, { g: 'd4', seed: 1834201173, st: 'done', ms: 21300 }] }),
              job({ id: 'j2', at: '16:41', ts: Date.parse('2026-10-03T16:41:00'), seed0: 907715342, note: '只换种子再来 · 来自第 3 张', items: [
                { g: 'd5', seed: 907715342, st: 'done', ms: 21000 }, { g: 'd6', seed: 907715343, st: 'done', ms: 20700, star: true },
                { g: 'd7', seed: 907715344, st: 'done', ms: 21600 }, { g: 'd8', seed: 907715345, st: 'done', ms: 20800 }] }),
              job({ id: 'j3', at: '16:47', ts: Date.parse('2026-10-03T16:47:00'), kind: 'upscale', scale: 2, denoise: 0.35, size: '1664×2432', source: { job: 'j1', i: 2 }, seed0: 1834201172, items: [
                { g: 'd3', seed: 1834201172, st: 'done', ms: 48200, dl: LAST_DOWNLOAD + '\\窗边读书·傍晚-1834201172-2x.png', up: true }] }),
              job({ id: 'j4', at: '16:49', ts: Date.parse('2026-10-03T16:49:00'), kind: 'face', denoise: 0.4, size: '1664×2432', source: { job: 'j3', i: 0 }, seed0: 1834201172, items: [
                { g: 'd3', seed: 1834201172, st: 'done', ms: 15600, up: true }] })
            ] },
            { label: '方向二：课桌托腮，侧光', text: T_DIR2, jobs: [
              job({ id: 'j5', at: '17:02', ts: Date.parse('2026-10-03T17:02:00'), seed0: 552019886, live: true, items: [
                { g: 'd2', seed: 552019886, st: 'done', ms: 22100 }, { g: 'd6', seed: 552019887, st: 'running', step: 11 },
                { seed: 552019888, st: 'queued', pos: 1 }, { seed: 552019889, st: 'queued', pos: 2 }] })
            ] },
            { label: '方向三：抱书回头，逆光', text: T_DIR3, jobs: [] }
          ] }
      ] }
    ] },

  { id: 'n10', title: '雨夜霓虹·双马尾', parent: null, x: 344, y: 820, collapsed: false,
    model: 'm1', sys: 'pony', slots: ['g3'], duration: 8, ratio: '16:9', size: '832×1216', count: 4,
    image: { src: 'lan', workflow: 'builtin', ckpt: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors', loras: [['neon_city_pony.safetensors', 0.8]], seedMode: 'random', seed: 3310045, steps: 25, cfg: 7, sampler: 'euler_ancestral', scheduler: 'normal', rating: '全年龄', extraNeg: '' },
    summary: '雨夜霓虹街头，双马尾回头',
    thread: [
      { role: 'user', cur: 0, versions: [
        { auto: '参考图共 1 张，编号如下。', text: '黑色双马尾、发梢挑染青色的女生，雨夜霓虹街头，回头。画风参考 <Picture 1> 的柔和上色。', imgs: ['g3'], size: '832×1216', count: 4, at: '10月3日 15:10' }
      ] },
      { role: 'ai', cur: 0, versions: [
        { model: 'm1', sys: 'pony', sysAt: '10月3日 15:10', tin: 5280, tout: 410, tcache: 0, at: '15:11', thinking: { ms: 9000, text: null },
          intro: '<Picture 1> 的画风用「画风参考」出图时带上就行，标签里只写人物和场景。', boxes: [
            { label: null, text: T_NEON, jobs: [
              job({ id: 'j6', at: '15:14', ts: Date.parse('2026-10-03T15:14:00'), ckpt: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors', steps: 25, cfg: 7, loras: [['neon_city_pony.safetensors', 0.8]], kind: 'style', ref: { img: 'g3', strength: 0.8 }, seed0: 3310045, items: [
                { g: 'e1', seed: 3310045, st: 'done', ms: 26800 }, { g: 'e2', seed: 3310046, st: 'done', ms: 27100 }, { g: 'e3', seed: 3310047, st: 'done', ms: 26400, cleared: true }, { g: 'e4', seed: 3310048, st: 'done', ms: 26900 }] }),
              job({ id: 'j7', at: '15:20', ts: Date.parse('2026-10-03T15:20:00'), ckpt: 'autismmixSDXL_autismmixPony.safetensors', steps: 25, cfg: 7, loras: [], seed0: 77120044, items: [
                { seed: 77120044, st: 'failed', err: { kind: 'noCkpt', msg: '底模文件不在：这台 ComfyUI 上找不到 autismmixSDXL_autismmixPony.safetensors', raw: 'Value not in list: ckpt_name: \'autismmixSDXL_autismmixPony.safetensors\' not in [...]', node: '4 · CheckpointLoaderSimple · ckpt_name' } },
                { seed: 77120045, st: 'failed', err: { kind: 'noCkpt' } }, { seed: 77120046, st: 'failed', err: { kind: 'noCkpt' } }, { seed: 77120047, st: 'failed', err: { kind: 'noCkpt' } }] })
            ] }
          ] }
      ] }
    ] },

  { id: 'n11', title: '雪夜神社·狐耳', parent: 'n9', forkFrom: { node: 'n9', count: 2 }, x: 344, y: 1090, collapsed: false,
    model: 'm4', sys: 'il', slots: [], duration: 8, ratio: '16:9', size: '832×1216', count: 4,
    image: { src: 'lan', workflow: 'wf1', ckpt: 'waiIllustriousSDXL_v150.safetensors', loras: [], seedMode: 'fixed', seed: 2208116534, steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal', rating: '全年龄', extraNeg: '' },
    summary: '狐耳巫女站在雪夜的鸟居下',
    thread: [
      { role: 'user', cur: 0, versions: [
        { auto: null, text: '换个角色：银白长发的狐耳巫女，下雪的夜里站在神社鸟居下，提着灯笼。', imgs: [], size: '832×1216', count: 4, at: '10月2日 21:40' }
      ] },
      { role: 'ai', cur: 0, versions: [
        { model: 'm4', sys: 'il', sysAt: '10月2日 21:40', tin: 6010, tout: 980, tcache: 3900, at: '21:41', thinking: { ms: 14000, text: '狐耳巫女：fox girl、fox ears、fox tail 三个都写，巫女服用 miko 加 red hakama。提灯笼写 holding lantern。夜里下雪，加 breath 表现白气。' },
          intro: '巫女我写的是 shrine maiden，如果程序换成了标准写法就以它为准。', boxes: [
            { label: null, text: T_FOX, starred: true, jobs: [
              job({ id: 'j8', at: '21:44', ts: Date.parse('2026-10-02T21:44:00'), workflow: 'wf1', src: 'autodl', seed0: 2208116534, items: [
                { g: 'e5', seed: 2208116534, st: 'done', ms: 9800 }, { g: 'e6', seed: 2208116535, st: 'done', ms: 9600, star: true, dl: LAST_DOWNLOAD + '\\雪夜神社·狐耳-2208116534.png' },
                { g: 'e7', seed: 2208116536, st: 'done', ms: 9900 }, { g: 'e8', seed: 2208116537, st: 'stopped' }] })
            ] }
          ] }
      ] }
    ] }
];
TAGDB.holding_lantern = { tag: 'holding_lantern', cat: 0, count: 6863, zh: '抱着灯笼' };
CANVAS.nodes = CANVAS.nodes.concat(CANVAS_IMAGE_NODES);
