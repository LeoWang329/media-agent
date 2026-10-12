import { describe, expect, it } from 'vitest';
import {
  defaultDepthSettings,
  defaultEditSettings,
  defaultRealSettings,
  defaultRemixSettings,
  defaultUpscaleSettings,
  DEPTH_STRENGTH,
  editDiff,
  EDIT_FNS,
  EDIT_PRESETS,
  editFnNamed,
  editFnOf,
  editSettingsOf,
  editTextBlock,
  editWriteOneText,
  EDIT_LORA,
  KREA2_EDIT_PRESETS,
  kreaEditSetup,
  kreaOutfitSetup,
  promptNameForFn,
  REAL_LORA,
  REAL_TRIGGER,
  REAL_TRIGGER_DUAL,
  realLorasOf,
  realPromptOf,
  REMIX_LORA,
  REMIX_LORAS,
  REMIX_STRENGTH,
} from '../src';

// 图像编辑节点的功能表和设置，见 docs/dev-plan.md 5.36
describe('编辑节点的功能', () => {
  it('八个功能：名字跟系统提示词说明段里的「功能:」对齐，id 不重名，八个都做了', () => {
    expect(EDIT_FNS.map((fn) => [fn.id, fn.name, fn.ready])).toEqual([
      ['edit', '指令编辑', true],
      ['real', '转真人', true],
      ['outfit', '换装', true],
      ['inpaint', '局部重绘', true],
      ['depth', '深度迁移', true],
      ['remix', '风格 Remix', true],
      ['upscale', '放大 / 高清', true],
      ['fourview', '四视图', true],
    ]);
    expect(new Set(EDIT_FNS.map((fn) => fn.id)).size).toBe(EDIT_FNS.length);
    expect(new Set(EDIT_FNS.map((fn) => fn.name)).size).toBe(EDIT_FNS.length);
    // 每个功能都写清了要几张图
    for (const fn of EDIT_FNS) expect(fn.need).toMatch(/^要 \d/);
    // 只有放大 / 高清不用模型写字：界面上不给「提示词」那一行，输入框旁也不给「写一个」
    expect(EDIT_FNS.filter((fn) => !fn.writes).map((fn) => fn.id)).toEqual(['upscale']);
  });

  it('按 id 或按名字都找得到那个功能；找不到给第一个', () => {
    expect(editFnOf('real').name).toBe('转真人');
    expect(editFnOf('nope' as never).id).toBe('edit');
    expect(editFnNamed('换装')?.id).toBe('outfit');
    expect(editFnNamed('生图')).toBeNull();
    expect(editFnNamed(null)).toBeNull();
  });

  it('现成的提示词：指令编辑六条、换装四条、局部重绘六条、深度迁移四条、风格 Remix 四条；转真人、放大、四视图这三份空着', () => {
    const presets = EDIT_PRESETS.edit;
    expect(presets.map((preset) => preset.name)).toEqual(['换衣服', '换背景 / 换天气', '加一个东西', '去掉一个东西', '改光线 / 色调', '改表情 / 姿势']);
    expect(EDIT_PRESETS.outfit.map((preset) => preset.name)).toEqual(['黑色机车皮衣', '红色晚礼服', '白色衬衫 + 牛仔裤', '和服']);
    // 局部重绘那几条写的是「这块画成什么」：一小段英文名词短语，不是祈使句，见 docs/prompts/edit-inpaint.md
    expect(EDIT_PRESETS.inpaint.map((preset) => preset.name)).toEqual(['换衣领', '换衣服', '修手', '去掉杂物', '补细节', '换背景']);
    expect(EDIT_PRESETS.depth.map((preset) => preset.name)).toEqual(['电影感摄影', '二次元插画', '油画 / 厚涂', '等距黏土模型']);
    expect(EDIT_PRESETS.remix.map((preset) => preset.name)).toEqual(['雨夜霓虹街', '街头写真', '影棚硬光', '日系胶片']);
    for (const preset of [...presets, ...EDIT_PRESETS.outfit, ...EDIT_PRESETS.depth, ...EDIT_PRESETS.remix]) {
      expect(preset.text.length).toBeGreaterThan(20);
      expect(preset.text).not.toMatch(/masterpiece|best quality|8k|DSLR/);
    }
    for (const preset of EDIT_PRESETS.inpaint) {
      expect(preset.text).toBeTruthy();
      expect(preset.text).not.toMatch(/^(change|replace|remove|make|add|swap)\b/i);
      expect(preset.text).not.toMatch(/masterpiece|best quality|8k|DSLR/);
    }
    // 深度迁移 / 风格 Remix 写的是「照这个构图画成什么」，是画面描述、不是祈使句（跟指令编辑那份不一样），
    // 见 docs/prompts/edit-depth.md、docs/prompts/edit-remix.md
    for (const preset of [...EDIT_PRESETS.depth, ...EDIT_PRESETS.remix]) {
      expect(preset.text).not.toMatch(/^(change|replace|remove|make|add|swap|turn)\b/i);
    }
    // 空着的三份都是有意的：转真人那句是反推开着时模型现写（关掉自己手输）、放大整条路不看提示词、
    // 四视图的主指令是固定的（框里那句只当额外要求，没有说话模板），见 docs/plan-image-edit-node.md 第 3 节
    expect(EDIT_PRESETS.real).toEqual([]);
    expect(EDIT_PRESETS.upscale).toEqual([]);
    expect(EDIT_PRESETS.fourview).toEqual([]);
    expect(EDIT_FNS.filter((fn) => EDIT_PRESETS[fn.id].length === 0).map((fn) => fn.id)).toEqual(['real', 'upscale', 'fourview']);
  });

  it('设置：没有时给默认（指令编辑、图 1 图 2 都指第 1 张、空句子、相似度 1、其余几个功能各走各的默认）', () => {
    expect(defaultEditSettings()).toEqual({
      fn: 'edit',
      slot: 0,
      slotB: 0,
      text: '',
      refBoost: 1,
      real: defaultRealSettings(),
      inpaint: { denoise: 0.85 },
      depth: { strength: 1 },
      remix: { lora: { name: REMIX_LORA, strength: 1 } },
      upscale: defaultUpscaleSettings(),
    });
    expect(editSettingsOf(undefined, 0)).toEqual(defaultEditSettings());
    // 转真人那份默认：用反推、只转真人、像图 2 是 1、挂 V3 强度 1、不挂人物 LoRA、走无审查
    expect(defaultRealSettings()).toEqual({
      reverse: true,
      dual: false,
      image2Strength: 1,
      lora: { name: REAL_LORA, strength: 1 },
      people: [],
      uncensored: true,
    });
    // 深度迁移的控制强度默认 1（照 w3-depth.json）；风格 Remix 默认挂「换人」那条、强度 1
    expect(defaultDepthSettings()).toEqual({ strength: DEPTH_STRENGTH });
    expect(defaultRemixSettings()).toEqual({ lora: { name: REMIX_LORA, strength: REMIX_STRENGTH } });
    // 放大 / 高清默认 2 倍、放大模型空着（出图时用这台 ComfyUI 上第一个）、面部修复不开
    expect(defaultUpscaleSettings()).toEqual({ scale: 2, model: '', face: '' });
    expect(REMIX_LORAS.map((one) => one.name)).toEqual(['krea2/krea2_reid_rank32.safetensors', 'krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors']);
    // 两个候选都必须带 krea2/ 前缀：少了会在提交阶段被 value_not_in_list 拒掉（真机上踩过）
    for (const one of REMIX_LORAS) expect(one.name.startsWith('krea2/')).toBe(true);
  });

  it('半份设置跟默认值深合并：只带 real.dual 时别的项不动', () => {
    const merged = editSettingsOf({ fn: 'real', slot: 1, real: { dual: true } }, 3);
    expect(merged).toMatchObject({ fn: 'real', slot: 1, text: '', refBoost: 1, real: { ...defaultRealSettings(), dual: true } });
    // 几层各只带一项：那一项换上，其余还是 base / 默认的
    expect(editSettingsOf({ real: { image2Strength: 0.5, lora: { strength: 0.8 } }, inpaint: { denoise: 0.5 } }, 1)).toMatchObject({
      real: { reverse: true, dual: false, image2Strength: 0.5, lora: { name: REAL_LORA, strength: 0.8 }, people: [], uncensored: true },
      inpaint: { denoise: 0.5 },
    });
    // 深度迁移只带强度、风格 Remix 只带强度时，LoRA 名字还是默认那条
    expect(editSettingsOf({ fn: 'depth', depth: { strength: 0.6 } }, 1).depth).toEqual({ strength: 0.6 });
    expect(editSettingsOf({ fn: 'remix', remix: { lora: { strength: 0.5 } } }, 1).remix).toEqual({ lora: { name: REMIX_LORA, strength: 0.5 } });
    // 放大 / 高清只带倍数 / 只带模型时，别的项还是默认的
    expect(editSettingsOf({ fn: 'upscale', upscale: { scale: 1.5 } }, 1).upscale).toEqual({ scale: 1.5, model: '', face: '' });
    expect(editSettingsOf({ fn: 'upscale', upscale: { face: 'bbox/face_yolov8m.pt' } }, 1).upscale).toEqual({ scale: 2, model: '', face: 'bbox/face_yolov8m.pt' });
  });

  it('哪几个功能不要求先写字：放大 / 高清、四视图、转真人开着反推时；别的功能缺了就给那句话', () => {
    const base = defaultEditSettings();
    // 放大 / 高清整条路不看提示词、四视图主指令固定（框里那句只当额外要求），这两条空着也开得起来
    expect(editTextBlock({ ...base, fn: 'upscale' })).toBeNull();
    expect(editTextBlock({ ...base, fn: 'fourview' })).toBeNull();
    // 转真人：反推开着不用写，关掉就得写
    expect(editTextBlock({ ...base, fn: 'real', real: { ...base.real, reverse: true } })).toBeNull();
    expect(editTextBlock({ ...base, fn: 'real', real: { ...base.real, reverse: false } })).toBe('先写一句要改什么');
    // 别的功能：空着（或者只有空格）就说一句，局部重绘那句不一样
    for (const fn of ['edit', 'outfit', 'depth', 'remix'] as const) {
      expect(editTextBlock({ ...base, fn })).toBe('先写一句要改什么');
      expect(editTextBlock({ ...base, fn, text: '   ' })).toBe('先写一句要改什么');
      expect(editTextBlock({ ...base, fn, text: 'x' })).toBeNull();
    }
    expect(editTextBlock({ ...base, fn: 'inpaint' })).toBe('先写一句这块画成什么');
    expect(editTextBlock({ ...base, fn: 'inpaint', text: 'a red collar' })).toBeNull();
  });

  it('选了第 5 张但只剩 2 张了：图 1、图 2 都收回第 1 张，别指着空槽位', () => {
    expect(editSettingsOf({ fn: 'edit', slot: 4, slotB: 4, text: 'x', refBoost: 1 }, 2)).toMatchObject({ slot: 0, slotB: 0 });
    expect(editSettingsOf({ fn: 'edit', slot: -1, text: 'x', refBoost: 1 }, 2).slot).toBe(0);
    // 老节点少了后来的字段：缺的用默认值补上
    expect(editSettingsOf({ slot: 1 }, 3)).toEqual({ ...defaultEditSettings(), slot: 1 });
  });

  it('指令编辑借编辑档的接线，但挂的是身份编辑 LoRA，不是动漫转真人 V3', () => {
    expect(kreaEditSetup().loras).toEqual([{ name: EDIT_LORA, strength: 1 }]);
    // 认得出是哪个方案，而且那个方案没有触发词 —— 所以指令编辑出图不会自己加真人化那句
    const preset = KREA2_EDIT_PRESETS.find((item) => item.id === 'identity-v1-1')!;
    expect(preset.trigger).toBeUndefined();
    expect(preset.loras[0].name).toBe(EDIT_LORA);
  });

  it('换装也是编辑档的接线，只把 LoRA 换成 krea_outfittransfer', () => {
    expect(kreaOutfitSetup().loras).toEqual([{ name: 'krea2/krea_outfittransfer.safetensors', strength: 1 }]);
    expect(kreaOutfitSetup().loras).not.toEqual(kreaEditSetup().loras);
    // 换装那条也没有触发词，正面词就是框里那句
    expect(KREA2_EDIT_PRESETS.find((item) => item.id === 'outfit')!.trigger).toBeUndefined();
  });
});

// 转真人那句话怎么来，见 docs/krea2-real-usage.md 第 4 节
describe('转真人的提示词和 LoRA', () => {
  it('反推关着时触发词自己拼（双图多带 Figure 2 那句）；开着时用反推写的那句，手输那句不参与', () => {
    const real = { ...defaultRealSettings(), reverse: false };
    expect(realPromptOf(real, '她站在雨夜的站台上。', '')).toBe(`${REAL_TRIGGER}\n\n她站在雨夜的站台上。`);
    expect(realPromptOf({ ...real, dual: true }, '她站在雨夜的站台上。', '')).toBe(`${REAL_TRIGGER_DUAL}\n\n她站在雨夜的站台上。`);
    // 反推开着：反推模型写什么就是什么，手输那句不参与
    expect(realPromptOf(defaultRealSettings(), '不参与', 'transform the image to realistic photograph, a woman, backlight')).toBe('transform the image to realistic photograph, a woman, backlight');
    // 手输那句空着时不留多余的空行（反推开着时界面上那句话是灰的）
    expect(realPromptOf(real, '   ', '')).toBe(REAL_TRIGGER);
    expect(realPromptOf({ ...real, dual: true }, '', '')).toBe(REAL_TRIGGER_DUAL);
  });

  it('挂哪些 LoRA：转真人那条在前、人物那条依次；名字空着的不挂', () => {
    const real = defaultRealSettings();
    expect(realLorasOf(real)).toEqual([{ name: REAL_LORA, strength: 1 }]);
    expect(
      realLorasOf({
        ...real,
        people: [
          { name: 'krea2/Nick_baotunqun_Krea2.safetensors', strength: 0.6 },
          { name: '', strength: 0.6 },
        ],
      }),
    ).toEqual([
      { name: REAL_LORA, strength: 1 },
      { name: 'krea2/Nick_baotunqun_Krea2.safetensors', strength: 0.6 },
    ]);
    // 转真人那条被清空时只剩人物那条；两条都空就一个都不挂
    expect(realLorasOf({ ...real, lora: { name: '', strength: 1 } })).toEqual([]);
  });
});

// 模型参与：按当前功能挑那套系统提示词、发给模型的图、输入框旁「写一个」，见 docs/dev-plan.md 5.36 的 E3
describe('编辑节点让模型写提示词', () => {
  const prompts = [
    { name: 'edit', fn: '指令编辑' },
    { name: 'edit-real', fn: '转真人' },
    { name: 'edit-outfit', fn: '换装' },
    { name: 'edit-inpaint', fn: '局部重绘' },
    { name: 'edit-depth', fn: '深度迁移' },
    { name: 'edit-remix', fn: '风格 Remix' },
    { name: 'edit-fourview', fn: '四视图' },
    { name: 'il', fn: null },
  ];

  it('换功能就用那个功能那一份：拿名字跟提示词说明段里的「功能:」对，不看用户选的哪个', () => {
    expect(promptNameForFn(prompts, editFnOf('edit'))).toBe('edit');
    expect(promptNameForFn(prompts, editFnOf('real'))).toBe('edit-real');
    expect(promptNameForFn(prompts, editFnOf('outfit'))).toBe('edit-outfit');
    expect(promptNameForFn(prompts, editFnOf('inpaint'))).toBe('edit-inpaint');
    expect(promptNameForFn(prompts, editFnOf('depth'))).toBe('edit-depth');
    expect(promptNameForFn(prompts, editFnOf('remix'))).toBe('edit-remix');
    expect(promptNameForFn(prompts, editFnOf('fourview'))).toBe('edit-fourview');
    // 放大 / 高清**没有**自己那份（这个功能不用模型写字）：找不到，调用方留着现在用的那套，见 plan 第 3 节
    expect(promptNameForFn(prompts, editFnOf('upscale'))).toBeNull();
  });

  it('设置里没有这个功能那一份时返回 null，调用方留着现在用的那套', () => {
    expect(promptNameForFn(prompts.filter((p) => p.name !== 'edit-real'), editFnOf('real'))).toBeNull();
    expect(promptNameForFn([], editFnOf('edit'))).toBeNull();
  });

  it('发给模型的只有选中的那张图，并说清是第几张', () => {
    expect(editDiff(['a', 'b', 'c'], { slot: 1 })).toEqual({
      systemNote: '要改的是第 2 张参考图。',
      attachments: [{ picture: 2, imageId: 'b' }],
    });
    // 槽位空着（还没放图）时不硬发
    expect(editDiff([], { slot: 0 })).toEqual({ systemNote: '还没有选要改的图。', attachments: [] });
  });

  it('「写一个」发出去的那句话说清按哪个功能写', () => {
    expect(editWriteOneText(editFnOf('edit'))).toBe('看图，按「指令编辑」给我写几个方向。');
    expect(editWriteOneText(editFnOf('real'))).toBe('看图，按「转真人」给我写几个方向。');
  });
});
