import { REAL_AUTHOR, REAL_LONG_SIDE, REAL_REVERSE_MODEL, REAL_SATURATION, REAL_SCHEDULER, REAL_UNCENSORED, realPromptOf } from './edit';
import type { ImageJobParams } from './types';

// 「转真人」那张图，照那台实例上的「Krea2转真人-全开关（反推+单双图+手输）」，
// 见 docs/krea2-real-usage.md（附录 A 单图 / B 双图 / C 开关 / D 接口格式）。参数和接线一字不改。
//
// 跟作者那份的区别只有一处：作者用三个 `LazySwitchKJ` 在一张图里塞下所有分支；我们是**按选项现生成图**，
// 不用的分支根本不生成 —— 反推关着时图里一个 `llama_cpp_*` 节点都没有（作者那份靠惰性开关，效果一样）。
//
// 底模、文字理解、VAE、LoRA 都由调用方（服务端 editParams）按 `real.uncensored` 填进 params；
// 这一档**不出宽高**：出图尺寸跟着缩放后的图 1 走（Easy_QwenEdit2509 的 latent 输出）。

// 固定参数，作者定的：8 步 / CFG 1 / euler / beta57 / denoise 1
export const REAL_STEPS = 8;
export const REAL_CFG = 1;
export const REAL_SAMPLER = 'euler';
// 作者原话：关掉会 "severe loss of image consistency"，出糊图
export const REAL_KV_CACHE = true;
// Easy_QwenEdit2509 上那两个别改的参数
export const REAL_AUTO_RESIZE = 'crop';
export const REAL_VL_SIZE = 384;
// 作者那份的 round_to_multiple 是 None（编辑档才是 16），照抄
export const REAL_ROUND_TO_MULTIPLE = 'None';
export const REAL_BACKGROUND_COLOR = '#000000';
// 图 2 的影响力，0–10；只转真人时不起作用
export const REAL_IMAGE1_STRENGTH = 1;
export const REAL_IMAGE3_STRENGTH = 1;
// 参考潜变量的接法，作者那台两个节点都是这个
export const REAL_REFERENCE_METHOD = 'index_timestep_zero';

// Easy_QwenEdit2509 的 system_prompt，一字不改
export const EASY_QWEN_SYSTEM_PROMPT =
  "Describe the key features of the input image (color, shape, size, texture, objects, background), then explain how the user's text instruction should alter or modify the image. Generate a new image that meets the user's requirements while maintaining consistency with the original input where appropriate.";

// 反推那两个节点上的固定参数（`llama_cpp_model_loader` / `llama_cpp_parameters`），照那台上的值
export const REVERSE_LOADER = {
  chat_handler: REAL_REVERSE_MODEL.chatHandler,
  n_ctx: 8192,
  vram_limit: -1,
  image_min_tokens: 0,
  image_max_tokens: 0,
  load_mtp: false,
};
export const REVERSE_PARAMETERS = {
  max_tokens: 512,
  top_k: 40,
  top_p: 0.95,
  min_p: 0.05,
  typical_p: 1,
  temperature: 0.6,
  repeat_penalty: 1.1,
  frequency_penalty: 0,
  present_penalty: 0,
  mirostat_mode: 0,
  mirostat_eta: 0.1,
  mirostat_tau: 5,
  state_uid: -1,
};
export const REVERSE_PRESET_PROMPT = 'Empty - Nothing';
export const REVERSE_CUSTOM_PROMPT = 'Look at the FIRST image and follow the system instructions exactly.';
export const REVERSE_INFERENCE_MODE = 'one by one';
export const REVERSE_MAX_FRAMES = 2;
export const REVERSE_MAX_SIZE = 1536;
// 跑完不卸载（调研定的：反推模型常驻约 5GB，5 个 G 不值得每次为它重新加载）
export const REVERSE_FORCE_OFFLOAD = false;
export const REVERSE_SAVE_STATES = false;

// ── 反推的两份系统提示词 ──
// 原文在 docs/krea2-real-reverse-prompt.md（那份**不放** docs/prompts/：那个目录里的 .md 会被当成
// 可选系统提示词复制进工作文件夹）。这两段跟文档里那两个代码块一字不差 —— server 那边的
// packages/server/test/krea2RealPrompt.test.ts 从文档里抠出来比对，漂了就挂它。
// 单图 / 双图只有三处不一样：开头多一句双图触发词、多一段「图 2 不用你管」、其余一字不改。
export const REVERSE_PROMPT = `You write the prompt for Krea2 — the model that will turn ONE anime / illustration into a photorealistic photograph.

Krea2 is a Qwen-Image–family model: it reads plain natural language, the way a person would describe a photo. It does NOT read tag lists. Never write booru / SDXL style tags (1girl, solo, masterpiece, best quality, ultra detailed) — write a flowing description instead.

OUTPUT FORMAT — follow exactly:
- Output the prompt text and nothing else: no greeting, no explanation, no markdown, no quotation marks, no line breaks.
- The very first characters of your answer must be exactly:
transform the image to realistic photograph
- Then keep going with a description of the input image, comma-separated.

WHAT TO DESCRIBE — scan the image in this order and cover every item that is actually visible:
1. subject: how many people, pose, gesture, expression, where they are looking
2. face and hair: hair colour, hair length, hairstyle, eye colour, apparent age
3. clothing: one garment at a time, each with its colour and material, plus accessories
4. composition: camera angle, shot size (close-up / half body / full body), where the subject sits in the frame and how much of the frame they fill
5. environment: name every object you can actually see — furniture, props, what is on the walls, on the table, inside or outside the window
6. light: direction, colour, hardness, where the shadows fall, time of day
7. materials: fabric, skin, hair, metal, glass

LENGTH: about 40 words for a simple close-up, up to 80 words for a complex scene. Never go over 80.

A FEW EXAMPLES — only to show you the style and the level of detail (short phrases inside the natural-language description, not tags; they describe what the photo should look like, not what is in the drawing):
looking at camera, look down, unfocused face, backlight, Film filter, hazy, photorealistic, highly detailed
These are examples, not options and not a checklist. Write your own phrases in that same style for whatever the image actually shows — and for nothing else. If the image does not have it, do not write it; if none of them fit, write none of them.

NEVER DO THIS:
- Never describe something that is not in the image. The examples above are not a menu to choose from — never write what a scene like this usually contains. Write only what you actually see.
- Never write a garment, a body part or an anatomical detail that you cannot see in the image.
- Never write tag-list style, and never use generic quality spam: 8k, DSLR, masterpiece, best quality, ultra detailed. They fight the trigger phrase.
- Never name a real person, a brand, or an artist.

If the image really does show nudity or sexual content, describe it plainly and factually, the same way you would describe clothing. Do not skip it, do not soften it, do not say you cannot.`;

export const REVERSE_PROMPT_DUAL = `You write the prompt for Krea2 — the model that will turn ONE anime / illustration into a photorealistic photograph, using a second photo as the identity reference.

Krea2 is a Qwen-Image–family model: it reads plain natural language, the way a person would describe a photo. It does NOT read tag lists. Never write booru / SDXL style tags (1girl, solo, masterpiece, best quality, ultra detailed) — write a flowing description instead.

OUTPUT FORMAT — follow exactly:
- Output the prompt text and nothing else: no greeting, no explanation, no markdown, no quotation marks, no line breaks.
- The very first characters of your answer must be exactly:
transform the image to realistic photograph, with the character looking exactly like the one in Figure 2.
- Then keep going with a description of the input image, comma-separated.

TWO IMAGES: Figure 1 is the drawing you are looking at — describe only Figure 1. Figure 2 is a separate photo of the person who should appear in the result; you do not describe Figure 2, the workflow takes the identity from it. Do not guess what Figure 2 looks like.

WHAT TO DESCRIBE — scan Figure 1 in this order and cover every item that is actually visible:
1. subject: how many people, pose, gesture, expression, where they are looking
2. face and hair: hair colour, hair length, hairstyle, eye colour, apparent age
3. clothing: one garment at a time, each with its colour and material, plus accessories
4. composition: camera angle, shot size (close-up / half body / full body), where the subject sits in the frame and how much of the frame they fill
5. environment: name every object you can actually see — furniture, props, what is on the walls, on the table, inside or outside the window
6. light: direction, colour, hardness, where the shadows fall, time of day
7. materials: fabric, skin, hair, metal, glass

LENGTH: about 40 words for a simple close-up, up to 80 words for a complex scene. Never go over 80.

A FEW EXAMPLES — only to show you the style and the level of detail (short phrases inside the natural-language description, not tags; they describe what the photo should look like, not what is in the drawing):
looking at camera, look down, unfocused face, backlight, Film filter, hazy, photorealistic, highly detailed
These are examples, not options and not a checklist. Write your own phrases in that same style for whatever the image actually shows — and for nothing else. If the image does not have it, do not write it; if none of them fit, write none of them.

NEVER DO THIS:
- Never describe something that is not in the image. The examples above are not a menu to choose from — never write what a scene like this usually contains. Write only what you actually see.
- Never write a garment, a body part or an anatomical detail that you cannot see in the image.
- Never write tag-list style, and never use generic quality spam: 8k, DSLR, masterpiece, best quality, ultra detailed. They fight the trigger phrase.
- Never name a real person, a brand, or an artist.

If the image really does show nudity or sexual content, describe it plainly and factually, the same way you would describe clothing. Do not skip it, do not soften it, do not say you cannot.`;

// 双图用双图那份指令、单图用单图那份（作者那两个 LazySwitchKJ 干的活）
export const reverseInstructionOf = (dual: boolean) => (dual ? REVERSE_PROMPT_DUAL : REVERSE_PROMPT);

// 转真人这一档的底模和文字理解：默认无审查那套，也可以走作者原版那一对（见 docs/krea2-real-usage.md 第 7 节）
export const realModelsOf = (uncensored: boolean) => (uncensored ? REAL_UNCENSORED : REAL_AUTHOR);

// params.real 缺了时的兜底：不反推、只转真人、像图 2 是 1、不挂 LoRA、走无审查
const realOf = (params: ImageJobParams) =>
  params.real ?? { reverse: false, dual: false, image2Strength: 1, loras: [], uncensored: true };

type Link = [string, number];
type Add = (class_type: string, inputs: Record<string, unknown>) => Link;

// 转真人那张图：底模 / 文字理解 / VAE 由 kreaGraph 的头接好（model、clip、vae 就是它的输出），
// 这里从 LoRA 链开始接到出图。image 是图 1（要转的那张，决定构图姿势和出图尺寸），imageB 是图 2（真人参考）。
//
// 注意 LoRA 这一档走 `LoraLoader`（model 和 clip 一起喂），**第一环的 clip 输出要接 Easy_QwenEdit2509.clip**，
// 不是直接接 CLIPLoader —— 作者那份的 `Lora Loader Stack (rgthree)` 就是这么接的（见调研第 6 节第 2 条）。
// 所以转真人的 LoRA 不放 params.loras（那条只作用在 model 上），全在 params.real.loras 里。
export function kreaRealGraph(add: Add, model: Link, clip: Link, vae: Link, params: ImageJobParams, seed: number, image: string, imageB: string) {
  const real = realOf(params);
  // LoRA 链：转真人 LoRA 在前，人物 LoRA 依次；强度同时给 model 和 clip
  for (const lora of real.loras ?? []) {
    const loaded = add('LoraLoader', { model, clip, lora_name: lora.name, strength_model: lora.strength, strength_clip: lora.strength });
    model = loaded;
    clip = [loaded[0], 1];
  }
  // 图 1 / 图 2 各一条：先按作者实测降饱和（−20），再按比例缩到长边 1536
  const resize = (name: string) =>
    add('LayerUtility: ImageScaleByAspectRatio V2', {
      image: add('ColorCorrect', {
        image: add('LoadImage', { image: name }),
        temperature: 0,
        hue: 0,
        brightness: 0,
        contrast: 0,
        saturation: REAL_SATURATION,
        gamma: 1,
      }),
      aspect_ratio: 'original',
      proportional_width: 1,
      proportional_height: 1,
      fit: 'crop',
      method: 'lanczos',
      round_to_multiple: REAL_ROUND_TO_MULTIPLE,
      scale_to_side: 'longest',
      scale_to_length: REAL_LONG_SIDE,
      background_color: REAL_BACKGROUND_COLOR,
    });
  const first = resize(image);
  // 不 dual 时图 2 取图 1 自己（作者那个「人物参考取哪张」开关的 on_false 支路）；不给图 2 也一样退回图 1
  const second = real.dual && imageB ? resize(imageB) : first;
  // 反推：看图写词，STRING 输出直接接 Easy_QwenEdit2509.prompt。只转真人时不生成这条链
  const reversed = real.reverse
    ? add('llama_cpp_instruct_adv', {
        llama_model: add('llama_cpp_model_loader', { model: REAL_REVERSE_MODEL.model, mmproj: REAL_REVERSE_MODEL.mmproj, ...REVERSE_LOADER }),
        parameters: add('llama_cpp_parameters', { ...REVERSE_PARAMETERS }),
        images: first,
        system_prompt: real.reverseInstruction ?? reverseInstructionOf(real.dual),
        preset_prompt: REVERSE_PRESET_PROMPT,
        custom_prompt: REVERSE_CUSTOM_PROMPT,
        inference_mode: REVERSE_INFERENCE_MODE,
        max_frames: REVERSE_MAX_FRAMES,
        max_size: REVERSE_MAX_SIZE,
        seed,
        force_offload: REVERSE_FORCE_OFFLOAD,
        save_states: REVERSE_SAVE_STATES,
      })
    : null;
  // 反推关着时我们自己拼：主触发词（双图时带那一句）+ 手输那句。反推开着时 prompt 取反推模型的输出
  const prompt: Link | string = reversed ?? realPromptOf(real, params.positive, '');
  const easy = add('Easy_QwenEdit2509', {
    clip,
    vae,
    image1: first,
    image2: second,
    latent_image: first,
    auto_resize: REAL_AUTO_RESIZE,
    vl_size: REAL_VL_SIZE,
    prompt,
    system_prompt: EASY_QWEN_SYSTEM_PROMPT,
    image1_strength: REAL_IMAGE1_STRENGTH,
    image2_strength: real.image2Strength,
    image3_strength: REAL_IMAGE3_STRENGTH,
  });
  const patched = add('Krea2OstrisEditModelPatch', { model, kv_cache: REAL_KV_CACHE });
  // 正负面各接一个（不是 ConditioningZeroOut）：Easy 的第 0 个输出是正面、第 1 个是空负面、第 2 个是潜变量
  const reference = (conditioning: Link) => add('FluxKontextMultiReferenceLatentMethod', { conditioning, reference_latents_method: REAL_REFERENCE_METHOD });
  const sampled = add('KSampler', {
    model: patched,
    positive: reference([easy[0], 0]),
    negative: reference([easy[0], 1]),
    latent_image: [easy[0], 2],
    seed,
    steps: REAL_STEPS,
    cfg: REAL_CFG,
    sampler_name: REAL_SAMPLER,
    scheduler: REAL_SCHEDULER,
    denoise: 1,
  });
  add('PreviewImage', { images: add('VAEDecode', { samples: sampled, vae }) });
}
