import type { EditFnId, EditRealSettings, EditRemixSettings, EditSettings, EditUpscaleSettings } from './types';

// 图像编辑节点的八个功能。id 是程序里用的，name 必须跟系统提示词说明段里的「功能:」一模一样
// （编辑节点按这个挑用哪份提示词），见 docs/dev-plan.md 5.36。
// ready 是这一轮做没做：第 1 批四个、第七批补上深度迁移和风格 Remix、第 2 批这两个（放大 / 高清、四视图）。
// writes 是这个功能要不要模型写字：不用写的那条不给「提示词」那一行，输入框旁也没有「写一个」
export type EditFn = {
  id: EditFnId;
  name: string;
  role: string; // 选中的那张图在界面上标什么
  need: string; // 「要几张」那一行
  desc: string; // 这个功能干什么的
  writes: boolean;
  ready: boolean;
};

export const EDIT_FNS: EditFn[] = [
  {
    id: 'edit',
    name: '指令编辑',
    role: '要改的',
    need: '要 1 张：① 要改的图',
    desc: '一句话改图：放一张图 + 写一句要改什么，改哪儿模型自己找',
    writes: true,
    ready: true,
  },
  {
    id: 'real',
    name: '转真人',
    role: '要转的',
    need: '要 1–2 张：① 要转的动漫图 ② 真人参考图（只有「换脸」用得上）',
    desc: '动漫 / 插画转真人照片：图 1 决定构图姿势；换脸时图 2 决定是谁',
    writes: true,
    ready: true,
  },
  {
    id: 'outfit',
    name: '换装',
    role: '要改的',
    need: '要 1 张：① 要换衣服的图',
    desc: '只换衣服：长相和姿势尽量不动',
    writes: true,
    ready: true,
  },
  {
    id: 'inpaint',
    // 原图是槽位里选中的那张，掩码在面板里画（拖框 + 涂抹），走 E05 那条内置 SDXL 流程，见 docs/dev-plan.md 5.35、5.36
    name: '局部重绘',
    role: '要改的',
    need: '要 1 张：① 要改的图',
    desc: '指定一块区域重绘：拖框或涂抹圈出来，别的一个像素不动',
    writes: true,
    ready: true,
  },
  {
    // 控制类三节点那一组（Krea2ControlLoRALoader / ImageEncode / Apply），跟别的功能都不是一条路，见 krea2Depth.ts
    id: 'depth',
    name: '深度迁移',
    role: '要迁移的',
    need: '要 1 张：① 要迁移的图',
    desc: '用这张图的深度结构重新画：构图、透视、人物站位跟原图走，内容风格听你写的那句话',
    writes: true,
    ready: true,
  },
  {
    // Ostris 那条路（跟转真人同族，但用 LoraLoaderModelOnly + TextEncodeKrea2OstrisEdit），见 krea2Remix.ts
    id: 'remix',
    name: '风格 Remix',
    role: '要改的',
    need: '要 1 张：① 要改的图',
    desc: '拿这张图当参考重画一遍：换 LoRA 决定「连人带场景一起 Remix」还是「只把人换过来、场景听你写」',
    writes: true,
    ready: true,
  },
  {
    // 第 2 批：走生图节点已有的那条放大路（UpscaleModelLoader + ImageUpscaleWithModel + 可选的面部重绘），
    // **不为它加系统提示词**（模型不写字），所以 writes: false，见 docs/plan-image-edit-node.md 第 3 节
    id: 'upscale',
    name: '放大 / 高清',
    role: '要放大的',
    need: '要 1 张：① 要放大的图',
    desc: '把这张图放大一档：放大模型先放大，可选再过一道面部修复。这个功能不用模型写字，点了直接放大',
    writes: false,
    ready: true,
  },
  {
    // 第 2 批：跟生图节点那个「做四视图」是同一条路（krea2_4panel + Krea2Edit 那两个节点）。
    // 主指令是 FOUR_VIEW_INSTRUCTION，程序自己接在最前面；框里那句话只当额外要求，不写也行
    id: 'fourview',
    name: '四视图',
    role: '角色图',
    need: '要 1 张：① 角色图',
    desc: '把这张图里的角色转成角色设定纸：脸部特写 + 正面 / 侧面 / 背面全身（主指令固定，最多补一句额外要求）',
    writes: true,
    ready: true,
  },
];

export const DEFAULT_EDIT_FN: EditFnId = 'edit';

export const editFnOf = (id: EditFnId): EditFn => EDIT_FNS.find((fn) => fn.id === id) ?? EDIT_FNS[0];
export const editFnNamed = (name: string | null | undefined): EditFn | null => EDIT_FNS.find((fn) => fn.name === name) ?? null;

// 界面上「提示词」那个下拉里的现成句子。这些是起点不是枷锁：填进正文之后还能改，见 docs/plan-image-edit-node-layout.md 第 3 节
export type EditPreset = { name: string; hint: string; text: string };

export const EDIT_PRESETS: Record<EditFnId, EditPreset[]> = {
  edit: [
    {
      name: '换衣服',
      hint: '保持脸和背景',
      text: 'Change her coat into a black studded leather biker jacket, keep her face, hair and the background exactly the same.',
    },
    {
      name: '换背景 / 换天气',
      hint: '主体不动',
      text: 'Replace the background with a rainy neon street at night, keep the subject exactly the same.',
    },
    { name: '加一个东西', hint: '往画里加', text: 'Add a transparent umbrella in her hand, everything else unchanged.' },
    { name: '去掉一个东西', hint: '从画里拿掉', text: 'Remove the paper cup from her hand, fill the area naturally, everything else unchanged.' },
    {
      name: '改光线 / 色调',
      hint: '只动颜色',
      text: 'Change the lighting to warm sodium street lamps, keep the composition and the subject unchanged.',
    },
    {
      name: '改表情 / 姿势',
      hint: '人还是那个人',
      text: 'Change her expression to a faint smile and turn her head slightly toward the camera, keep everything else the same.',
    },
  ],
  // 转真人的那句话是反推模型写的、或者用户手输（辅助词从白名单里挑），没有现成的几条，所以这里是空的
  real: [],
  outfit: [
    {
      name: '黑色机车皮衣',
      hint: '只换衣服',
      text: 'Dress her in a black studded leather biker jacket, keep her face, hair and pose exactly the same.',
    },
    {
      name: '红色晚礼服',
      hint: '只换衣服',
      text: 'Dress her in a red silk evening gown, keep her face, hair and pose exactly the same.',
    },
    {
      name: '白色衬衫 + 牛仔裤',
      hint: '只换衣服',
      text: 'Dress her in a white shirt and blue jeans, keep her face, hair and pose exactly the same.',
    },
    {
      name: '和服',
      hint: '只换衣服',
      text: 'Dress her in a patterned silk kimono, keep her face, hair and pose exactly the same.',
    },
  ],
  // 局部重绘写的是「这块画成什么」，是一小段名词短语、不是祈使句（见 docs/prompts/edit-inpaint.md）。
  // 「去掉杂物」那种就写空的东西（clean empty background），见 docs/plan-image-edit-node-layout.md 第 4.4 节
  inpaint: [
    { name: '换衣领', hint: '只改领子', text: 'a red leather jacket collar' },
    { name: '换衣服', hint: '涂到哪换哪', text: 'a black studded leather biker jacket' },
    { name: '修手', hint: '手指画坏了', text: 'a natural hand with five fingers' },
    { name: '去掉杂物', hint: '把东西拿掉', text: 'clean empty background' },
    { name: '补细节', hint: '那块太糊', text: 'a detailed leather texture with visible stitching' },
    { name: '换背景', hint: '只换涂到的那块', text: 'a rainy neon street at night' },
  ],
  // 深度迁移写的是「照这个构图画成什么」：整张画面的描述，不是祈使句（构图由深度控制图钉住，
  // 所以不用写「保持什么不变」）。见 docs/prompts/edit-depth.md
  depth: [
    {
      name: '电影感摄影',
      hint: '写实、有体积光',
      text: 'a cinematic photograph of a rainy city street at night, wet asphalt reflecting neon signs, volumetric haze, ultra detailed, 35mm film',
    },
    {
      name: '二次元插画',
      hint: '同构图换画风',
      text: 'a detailed anime style illustration of the same scene, clean line art, soft cel shading, vibrant colors',
    },
    {
      name: '油画 / 厚涂',
      hint: '笔触重一点',
      text: 'an oil painting of the same scene, thick visible brush strokes, warm museum lighting, canvas texture',
    },
    {
      name: '等距黏土模型',
      hint: '小微缩',
      text: 'a tilt-shift photo of the same scene as a miniature clay diorama, soft studio lighting, shallow depth of field',
    },
  ],
  // 风格 Remix / 换人写的是「重画成什么样」：参考图带身份/风格过来，这句话说新画面
  //（场景、服装、姿势、光线）。见 docs/prompts/edit-remix.md
  remix: [
    {
      name: '雨夜霓虹街',
      hint: '场景换掉',
      text: 'a cinematic anime style illustration of the same person, standing on a neon-lit rainy city street at night, holding a transparent umbrella, purple and cyan rim light, detailed background',
    },
    {
      name: '街头写真',
      hint: '只换风格',
      text: 'a photorealistic street style portrait of the same person, overcast daylight, 50mm lens, natural skin texture, candid pose',
    },
    {
      name: '影棚硬光',
      hint: '换个光',
      text: 'a high fashion studio portrait of the same person, hard key light from the left, deep shadows, seamless dark grey backdrop',
    },
    {
      name: '日系胶片',
      hint: '换个色调',
      text: 'a soft film photograph of the same person, japanese summer afternoon, faded warm tones, light grain, gentle backlight',
    },
  ],
  // 放大 / 高清不写提示词（走的是放大模型那条路，一句话都不用写），所以这里是空的，见 docs/plan-image-edit-node.md 第 3 节
  upscale: [],
  // 四视图的主指令是 FOUR_VIEW_INSTRUCTION（程序自己接在最前面、一字不改），框里那句只当额外要求，
  // 没有说话模板可选，所以这里是空的，见 docs/prompts/edit-fourview.md
  fourview: [],
};

// ── 转真人那一套（照那台上的「全开关（反推+单双图+手输）」，见 docs/krea2-real-usage.md） ──

// 固定参数：调度器是 beta57 不是 simple；8 步、CFG 1、denoise 1；参考图长边 1536、饱和度 −20
export const REAL_SCHEDULER = 'beta57';
export const REAL_LONG_SIDE = 1536;
export const REAL_SATURATION = -20;

// 单图 / 双图两个触发词，一字不改（作者定的）
export const REAL_TRIGGER = 'transform the image to realistic photograph';
export const REAL_TRIGGER_DUAL = `${REAL_TRIGGER}, with the character looking exactly like the one in Figure 2.`;

// 转真人 LoRA：默认 V3，作者建议 0.8–1.0
export const REAL_LORA = 'krea2/Krea2_Anything2RealCharacters-V3.safetensors';
export const REAL_LORAS = [
  { name: REAL_LORA, label: 'V3（默认，最像真人）' },
  { name: 'krea2/Krea2_Anything2RealCharacters-V1.safetensors', label: 'V1（早期版本，一致性弱一点）' },
  { name: 'krea2/Krea2_DreamCos_Realism.safetensors', label: 'DreamCos 写实' },
  { name: 'krea2/Krea2-realism-V2.safetensors', label: 'Realism V2' },
];

// 人物 LoRA 的候选清单（那台上有的）。挂上去同时喂 CLIP、跟参考图抢，总强度别顶满
export const REAL_PEOPLE_LORAS = [
  { name: 'krea2/krea2-Cc风情万种-人像.safetensors', label: 'Cc 风情万种 · 人像' },
  { name: 'krea2/krea2-Cc风情万种-风格.safetensors', label: 'Cc 风情万种 · 风格' },
  { name: 'krea2/krea2-Cc-天魔-身材.safetensors', label: 'Cc 天魔 · 身材' },
  { name: 'krea2/Nick_baotunqun_Krea2.safetensors', label: 'Nick 抱臀裙' },
  { name: 'krea2/Nick_leggings_Krea2.safetensors', label: 'Nick 打底裤' },
  { name: 'krea2/krea2_reid_rank32.safetensors', label: 'ReID（换人）' },
];
export const REAL_PEOPLE_STRENGTH = 0.6;

// ── 深度迁移 / 风格 Remix 那一套（照真机摸出来的 w3-depth.json / w3-reid2.json / w3-remix2.json，见 docs/dev-plan.md 5.36） ──

// 深度迁移的控制 LoRA（控制类三节点那一组里的第一条）。控制强度 = Krea2ControlLoRALoader.strength，
// 默认照 JSON 的 1；**不能填 0**：strength=0 时 loader 不注册采样 wrapper，Krea2ControlApply 会直接抛
// 「must receive the MODEL output from Krea2 Control LoRA Loader.」
export const DEPTH_LORA = 'krea2/Krea2-depth-control-lora.safetensors';
export const DEPTH_STRENGTH = 1;

// 风格 Remix / 换人的两个候选。同一条接线，只换 lora_name，都必须带 `krea2/` 前缀
// （少了会在提交阶段被 value_not_in_list 拒掉 —— 真机上踩过）
export const REMIX_LORAS = [
  { name: 'krea2/krea2_reid_rank32.safetensors', label: '换人（放得开：身份带过来，衣服姿势场景都换）' },
  { name: 'krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors', label: '风格 Remix（保守：连原图环境一起留住，只轻微 remix）' },
];
export const REMIX_LORA = REMIX_LORAS[0].name;
export const REMIX_STRENGTH = 1;

// 无审查那档：底模 / 文字理解 / VAE / 反推那两个模型文件（照那台上的「Krea2转真人-无审查」）
export const REAL_UNCENSORED = {
  checkpoint: 'krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors',
  textEncoder: 'qwen3vl_4b_uncensored_int8_convrot.safetensors',
};
export const REAL_AUTHOR = {
  checkpoint: 'krea2/krea2_turbo_fp8_scaled.safetensors',
  textEncoder: 'qwen3vl_4b_fp8_scaled.safetensors',
};
export const REAL_VAE = 'qwen_image_vae.safetensors';
export const REAL_REVERSE_MODEL = {
  model: 'Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf',
  mmproj: 'mmproj-Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-f16.gguf',
  chatHandler: 'Qwen3.6',
};

// 手输时可以从这几个辅助词里挑（作者给的白名单，见 docs/krea2-real-usage.md 第 4 节）
export const REAL_AUX_WORDS = [
  'caucasian',
  'woman',
  'man',
  'muscular',
  'looking at camera',
  'look down',
  'unfocused face',
  'photorealistic',
];

// 转真人的默认设置：用反推、只转真人（不换脸）、像图 2 是 1、挂 V3 强度 1、不挂人物 LoRA、走无审查
export const defaultRealSettings = (): EditRealSettings => ({
  reverse: true,
  dual: false,
  image2Strength: 1,
  lora: { name: REAL_LORA, strength: 1 },
  people: [],
  uncensored: true,
});

// 深度迁移的默认设置：控制强度 1（照 w3-depth.json）。强度 1 是官方推荐值，别填 0
export const defaultDepthSettings = (): EditSettings['depth'] => ({ strength: DEPTH_STRENGTH });

// 风格 Remix 的默认设置：挂「换人」那条（放得开），强度 1
export const defaultRemixSettings = (): EditRemixSettings => ({ lora: { name: REMIX_LORA, strength: REMIX_STRENGTH } });

// ── 放大 / 高清那一套（第 2 批，走生图节点已有的那条放大路） ──

// 放大倍数两档照生图节点的放大（UPSCALE_SCALES），默认 2。
// 放大模型空着是**有意的**：出图时用这台 ComfyUI 上第一个，跟底模那套一样（服务端 chooseUpscaleModel），
// 这样点了「开始」就能直接放大，不用先挑一个模型。面部修复的检测模型空着是不开
export const defaultUpscaleSettings = (): EditUpscaleSettings => ({ scale: 2, model: '', face: '' });

// 编辑节点按当前功能挑那套系统提示词：每份的说明段里写着「功能: 」，名字对上了就是它。
// 一份都没对上时返回 null，调用方留着现在用的那套，见 docs/dev-plan.md 5.36
export function promptNameForFn<T extends { name: string; fn: string | null }>(prompts: readonly T[], fn: EditFn): string | null {
  return prompts.find((prompt) => prompt.fn === fn.name)?.name ?? null;
}

// 输入框旁「写一个」发出去的那句：不问用户要改什么，让模型按当前功能看着图自己开写
export const editWriteOneText = (fn: EditFn) => `看图，按「${fn.name}」给我写几个方向。`;

// 老节点没有编辑设置时用的：指令编辑、图 1、图 2 都指第 1 张、空那句话、相似度 1、其余几个功能各走各的默认
export const defaultEditSettings = (): EditSettings => ({
  fn: DEFAULT_EDIT_FN,
  slot: 0,
  slotB: 0,
  text: '',
  refBoost: 1,
  real: defaultRealSettings(),
  inpaint: { denoise: 0.85 },
  depth: defaultDepthSettings(),
  remix: defaultRemixSettings(),
  upscale: defaultUpscaleSettings(),
});

// 半份编辑设置：服务端发请求时只带改过的那几项，real（连它的 lora）/ inpaint / depth / remix / upscale 几层也可以只带几项
export type PartialEditSettings = Partial<Omit<EditSettings, 'real' | 'inpaint' | 'depth' | 'remix' | 'upscale'>> & {
  real?: Partial<Omit<EditRealSettings, 'lora'>> & { lora?: Partial<EditRealSettings['lora']> };
  inpaint?: Partial<EditSettings['inpaint']>;
  depth?: Partial<EditSettings['depth']>;
  remix?: Partial<Omit<EditRemixSettings, 'lora'>> & { lora?: Partial<EditRemixSettings['lora']> };
  upscale?: Partial<EditUpscaleSettings>;
};

// 取节点现在的编辑设置：没有就给默认的；选了第 5 张但只剩 2 张了，收回第 1 张。
// edit 可以是半份，缺的从默认值补、real（连它的 lora）/ inpaint / depth / remix / upscale 几层各自深合并
export function editSettingsOf(edit: PartialEditSettings | undefined, slotCount: number): EditSettings {
  const base = { ...defaultEditSettings(), ...edit };
  const clamp = (slot: number) => (slot >= 0 && slot < Math.max(slotCount, 1) ? slot : 0);
  return {
    ...base,
    slot: clamp(base.slot),
    slotB: clamp(base.slotB),
    real: { ...defaultRealSettings(), ...base.real, lora: { ...defaultRealSettings().lora, ...base.real?.lora } },
    inpaint: { ...defaultEditSettings().inpaint, ...base.inpaint },
    depth: { ...defaultDepthSettings(), ...base.depth },
    remix: { ...defaultRemixSettings(), ...base.remix, lora: { ...defaultRemixSettings().lora, ...base.remix?.lora } },
    upscale: { ...defaultUpscaleSettings(), ...base.upscale },
  };
}

// 这个功能要不要用户先写那句话：放大 / 高清整条路不看提示词；四视图的主指令是固定的，框里那句只当额外要求、
// 不写也行；转真人开着反推时那句话由反推模型跑图时现写。别的功能缺了就是缺了。
// 返回值是给人看的那句话，够了是 null —— 面板底部的「开始」、框上的「开始」和服务端都问这一句，
// 见 docs/plan-image-edit-node.md 第 3 节
export function editTextBlock(edit: Pick<EditSettings, 'fn' | 'text' | 'real'>): string | null {
  if (edit.fn === 'upscale' || edit.fn === 'fourview') return null;
  if (edit.fn === 'real' && edit.real.reverse) return null;
  if (edit.text.trim()) return null;
  return edit.fn === 'inpaint' ? '先写一句这块画成什么' : '先写一句要改什么';
}

// 转真人那句话：反推开着时是反推模型写的，关着时我们自己把触发词加在手输那句前面（作者要求一字不改）
export const realPromptOf = (real: Pick<EditRealSettings, 'dual' | 'reverse'>, text: string, reversed: string) =>
  real.reverse ? reversed.trim() : [real.dual ? REAL_TRIGGER_DUAL : REAL_TRIGGER, text.trim()].filter(Boolean).join('\n\n');

// 转真人这一档挂哪些 LoRA：转真人那条 + 人物那几条，都同时作用于模型和 CLIP
export const realLorasOf = (real: EditRealSettings): { name: string; strength: number }[] => {
  const people = real.people.filter((one) => one.name);
  return [real.lora, ...people].filter((one) => one.name);
};
