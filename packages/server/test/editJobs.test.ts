import { FAMILY_DEFAULTS, FOUR_VIEW_INSTRUCTION, REAL_BODY_LORA, REAL_STANDARD, REAL_LORA, REAL_TRIGGER, REAL_TRIGGER_DUAL, REAL_UNCENSORED, REAL_VAE, REVERSE_PROMPT, realModelsOf, scaledSize, type ChatNode, type ComfyGraph, type ImageJob } from '@media-agent/shared';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createMockComfy, type MockComfy } from '../../../tools/mock-comfyui/src/app';
import { startTestApp, type TestApp } from './helpers';

// 图像编辑节点的「开始」：转真人走 krea2Real 那张图、换装走编辑档换一条 LoRA，见 docs/dev-plan.md 5.39。
// 断言看的是假 ComfyUI 真收到的图，不是我们拼出来的参数

let t: TestApp;
let mock: MockComfy;
let comfyUrl: string;
let canvasId: string;
let nodeId: string;
const nodeUrl = () => `/canvases/${canvasId}/nodes/${nodeId}`;
const editUrl = () => `${nodeUrl()}/edit`;
const nodesOf = (graph: ComfyGraph, type: string) => Object.values(graph).filter((n) => n.class_type === type);
const nodeOf = (graph: ComfyGraph, type: string) => nodesOf(graph, type)[0];
const idOf = (graph: ComfyGraph, node: ComfyGraph[string]) => Object.entries(graph).find(([, n]) => n === node)![0];
const lastGraph = async () => ((await (await fetch(`${comfyUrl}/_last-prompts`)).json()) as { prompt: ComfyGraph }[]).at(-1)!.prompt;

beforeEach(async () => {
  mock = createMockComfy({ stepMs: 5 });
  await new Promise<void>((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
  comfyUrl = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
  t = await startTestApp();
  await t.ok('PUT', '/settings', { comfy: { lanUrl: comfyUrl } });
  canvasId = (await t.ok('POST', '/canvases', { title: '图像编辑' })).id;
  nodeId = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { kind: 'edit', x: 0, y: 0 })).id;
});

afterEach(async () => {
  await t.cleanup();
  await mock.close();
});

type Started = { node: ChatNode; job: ImageJob; messageId: string; note?: string };

// 点一次「开始」：等这一组出完，再把假 ComfyUI 收到的那张图取回来
async function start(body: Record<string, unknown>): Promise<{ started: Started; graph: ComfyGraph }> {
  const started = await t.ok<Started>('POST', editUrl(), body);
  await expect
    .poll(
      async () => {
        const node = await t.ok<ChatNode>('GET', nodeUrl());
        const job = node.messages[started.messageId].images!.find((j) => j.id === started.job.id)!;
        return job.images.map((image) => image.status);
      },
      { timeout: 8000 },
    )
    .toEqual(['done']);
  return { started, graph: await lastGraph() };
}

it('转真人：反推开着不用写字，Easy_QwenEdit2509 + beta57，标准底模和编码器', async () => {
  const imageId = await t.addImage(canvasId, '#123456');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const { started, graph } = await start({ fn: 'real', slot: 0, text: '', refBoost: 1 });

  expect(started.job.kind).toBe('edit');
  expect(started.job.params).toMatchObject({
    family: 'Krea2',
    checkpoint: REAL_STANDARD.checkpoint,
    textEncoder: REAL_STANDARD.textEncoder,
    steps: 8,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'beta57',
    loras: [],
    krea: { mode: 'real' },
    real: { reverse: true, dual: false, image2Strength: 1, loras: [{ name: REAL_LORA, strength: 1 }, { name: REAL_BODY_LORA, strength: 1 }], uncensored: true },
  });

  // 转真人那张图独有的节点都在：主图编码、Ostris 补丁、两个参考接法、反推三个
  expect(nodeOf(graph, 'Easy_QwenEdit2509')).toBeTruthy();
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch').inputs.kv_cache).toBe(true);
  expect(nodesOf(graph, 'FluxKontextMultiReferenceLatentMethod')).toHaveLength(2);
  expect(nodeOf(graph, 'llama_cpp_instruct_adv')).toBeTruthy();
  expect(nodeOf(graph, 'llama_cpp_model_loader').inputs.model).toBe('Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf');
  expect(nodeOf(graph, 'ColorCorrect').inputs.saturation).toBe(-20);
  expect(nodeOf(graph, 'LayerUtility: ImageScaleByAspectRatio V2').inputs).toMatchObject({ scale_to_length: 1536, round_to_multiple: 'None' });
  // 采样那一档：8 步 / CFG 1 / euler / beta57 / denoise 1，跟编辑档（10 步 simple）不是一条路
  expect(nodeOf(graph, 'KSampler').inputs).toMatchObject({ steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'beta57', denoise: 1 });
  // Easy 的 prompt 接的是反推那个节点的 STRING 输出
  const instructId = Object.entries(graph).find(([, n]) => n.class_type === 'llama_cpp_instruct_adv')![0];
  expect(nodeOf(graph, 'Easy_QwenEdit2509').inputs.prompt).toEqual([instructId, 0]);
  // 假的那台把反推写的那句记进历史（真的那台上是模型现写的）
  const promptId = (await t.ok<ChatNode>('GET', nodeUrl())).messages[started.messageId].images![0].images[0].promptId;
  const history = (await (await fetch(`${comfyUrl}/history/${promptId}`)).json()) as Record<string, { outputs: Record<string, { text?: string[] }> }>;
  expect(history[promptId!].outputs[instructId].text![0]).toContain(REAL_TRIGGER);

  // 出的图挂在框下面，框上标着「转真人」
  expect(started.node.messages[started.messageId].parsed?.prompts[0].label).toBe('转真人');
});

it('转真人：反推关着时图里一个 llama_cpp_* 都没有，提示词是我们自己拼的触发词 + 手输那句', async () => {
  const imageId = await t.addImage(canvasId, '#234567');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const { graph } = await start({ fn: 'real', slot: 0, text: '她站在雨夜的站台上，穿深灰大衣。', refBoost: 1, real: { reverse: false } });

  expect(Object.values(graph).some((node) => node.class_type.startsWith('llama_cpp'))).toBe(false);
  expect(nodeOf(graph, 'Easy_QwenEdit2509').inputs.prompt).toBe(`${REAL_TRIGGER}\n\n她站在雨夜的站台上，穿深灰大衣。`);
  expect(nodeOf(graph, 'KSampler').inputs.scheduler).toBe('beta57');
});

it('转真人换脸：图 2 传上去、image2_strength 进图；只给一张时不报错、退回图 1 并带一句说明', async () => {
  const first = await t.addImage(canvasId, '#345678');
  const second = await t.addImage(canvasId, '#f0f0f0');
  await t.ok('PATCH', nodeUrl(), { slots: [first, second] });
  const { graph } = await start({ fn: 'real', slot: 0, slotB: 1, text: 'x', refBoost: 1, real: { reverse: false, dual: true, image2Strength: 0.6 } });

  const loads = nodesOf(graph, 'LoadImage');
  expect(loads).toHaveLength(2);
  const scales = nodesOf(graph, 'LayerUtility: ImageScaleByAspectRatio V2');
  expect(scales).toHaveLength(2);
  const easy = nodeOf(graph, 'Easy_QwenEdit2509');
  expect(easy.inputs.image1).toEqual([idOf(graph, scales[0]), 0]);
  expect(easy.inputs.image2).toEqual([idOf(graph, scales[1]), 0]);
  expect(easy.inputs.image2_strength).toBe(0.6);
  // 两张都传上去了（图 1 在前、图 2 在后）
  const uploads = (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string }[];
  expect(uploads.map((u) => u.name)).toEqual(loads.map((n) => n.inputs.image));

  // 只给一张（slotB 越界被收回第 1 张 = 图 1）：「换脸」要两张，退回只转真人，不报错
  await t.ok('PATCH', nodeUrl(), { slots: [first] });
  const fallback = await start({ fn: 'real', slot: 0, slotB: 1, text: 'x', refBoost: 1, real: { reverse: false, dual: true } });
  expect(fallback.started.note).toContain('退回只转真人');
  expect(fallback.started.job.params.krea?.referenceB).toBeNull();
  expect(nodesOf(fallback.graph, 'LoadImage')).toHaveLength(1);
  const fallbackEasy = nodeOf(fallback.graph, 'Easy_QwenEdit2509');
  expect(fallbackEasy.inputs.image2).toEqual(fallbackEasy.inputs.image1);
});

it('转真人的 LoRA：转真人那条 + 人物那条按顺序串，两条都同时喂 CLIP', async () => {
  const imageId = await t.addImage(canvasId, '#456789');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const people = { name: 'krea2/Nick_baotunqun_Krea2.safetensors', strength: 0.6 };
  const { started, graph } = await start({
    fn: 'real',
    slot: 0,
    text: 'x',
    refBoost: 1,
    real: { reverse: false, lora: { name: REAL_LORA, strength: 0.9 }, people: [people] },
  });

  expect(started.job.params.real?.loras).toEqual([{ name: REAL_LORA, strength: 0.9 }, { name: REAL_BODY_LORA, strength: 1 }, people]);
  const loras = nodesOf(graph, 'LoraLoader');
  expect(loras).toHaveLength(3);
  expect(loras[0].inputs).toMatchObject({ lora_name: REAL_LORA, strength_model: 0.9, strength_clip: 0.9 });
  expect(loras[1].inputs).toMatchObject({ lora_name: REAL_BODY_LORA, strength_model: 1, strength_clip: 1 });
  expect(loras[2].inputs).toMatchObject({ lora_name: people.name, strength_model: 0.6, strength_clip: 0.6 });
  expect(loras[1].inputs.model).toEqual([idOf(graph, loras[0]), 0]);
  // clip 这一路是串起来的，最后接 Easy —— 不是直接接 CLIPLoader
  expect(loras[1].inputs.clip).toEqual([idOf(graph, loras[0]), 1]);
  expect(loras[2].inputs.model).toEqual([idOf(graph, loras[1]), 0]);
  expect(loras[2].inputs.clip).toEqual([idOf(graph, loras[1]), 1]);
  expect(nodeOf(graph, 'Easy_QwenEdit2509').inputs.clip).toEqual([idOf(graph, loras[2]), 1]);
  expect(loras[0].inputs.clip).toEqual([idOf(graph, nodeOf(graph, 'CLIPLoader')), 0]);
});

it('转真人：旧 uncensored 字段关着也按用户标准模型组合生成', async () => {
  const imageId = await t.addImage(canvasId, '#56789a');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const { started, graph } = await start({ fn: 'real', slot: 0, text: 'x', refBoost: 1, real: { reverse: false, uncensored: false } });

  expect(started.job.params).toMatchObject({ checkpoint: realModelsOf(false).checkpoint, textEncoder: realModelsOf(false).textEncoder });
  expect(nodeOf(graph, 'UNETLoader').inputs.unet_name).toBe(REAL_STANDARD.checkpoint);
  expect(nodeOf(graph, 'CLIPLoader').inputs.clip_name).toBe(REAL_STANDARD.textEncoder);
});

it('换装：还是编辑档那条路（Ostris 两个节点），只把 LoRA 换成 krea_outfittransfer', async () => {
  const imageId = await t.addImage(canvasId, '#6789ab');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const { started, graph } = await start({ fn: 'outfit', slot: 0, text: '把她的大衣换成黑色机车皮衣。', refBoost: 1 });

  expect(started.job.params).toMatchObject({
    checkpoint: REAL_UNCENSORED.checkpoint,
    steps: 10,
    cfg: 1,
    scheduler: 'simple',
    loras: [{ name: 'krea2/krea_outfittransfer.safetensors', strength: 1 }],
    krea: { mode: 'edit' },
  });
  expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs.lora_name).toBe('krea2/krea_outfittransfer.safetensors');
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).toBe('把她的大衣换成黑色机车皮衣。');
  expect(nodeOf(graph, 'Easy_QwenEdit2509')).toBeUndefined();
});

// 深度迁移和风格 Remix 是第七批加的两个功能，接线照真机摸出来的 w3-depth.json / w3-reid2.json，
// 见 docs/dev-plan.md 5.39、packages/shared/src/krea2Depth.ts、krea2Remix.ts 和 outputs/devcheck/w3-findings.md

it('深度迁移：控制类三节点那一组，底模是 turbo fp8（不是无审查那套），槽位那张图提出深度当控制', async () => {
  const imageId = await t.addImage(canvasId, '#112233');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const { started, graph } = await start({ fn: 'depth', slot: 0, text: '雨夜站台的电影感摄影。', refBoost: 1 });

  expect(started.job.kind).toBe('edit');
  expect(started.job.params).toMatchObject({
    family: 'Krea2',
    // 底模和文字理解照跑通的那套（turbo fp8 + fp8 clip），这轮不扩「无审查」两档
    checkpoint: 'krea2/krea2_turbo_fp8_scaled.safetensors',
    textEncoder: 'qwen3vl_4b_fp8_scaled.safetensors',
    vae: REAL_VAE,
    steps: 8,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'simple',
    loras: [],
    krea: { mode: 'depth' },
    remix: { controlStrength: 1, lora: { name: 'krea2/krea2_reid_rank32.safetensors', strength: 1 } },
  });
  expect(nodeOf(graph, 'UNETLoader').inputs.unet_name).toBe('krea2/krea2_turbo_fp8_scaled.safetensors');
  expect(nodeOf(graph, 'CLIPLoader').inputs.clip_name).toBe('qwen3vl_4b_fp8_scaled.safetensors');

  // 控制类三节点一组，缺一不可：LoRA 加载器 → Apply → KSampler.model
  const lora = nodeOf(graph, 'Krea2ControlLoRALoader');
  expect(lora.inputs).toMatchObject({ lora_name: 'krea2/Krea2-depth-control-lora.safetensors', strength: 1 });
  const depth = nodeOf(graph, 'DepthAnythingV2Preprocessor');
  expect(depth.inputs).toMatchObject({ ckpt_name: 'depth_anything_v2_vitl.pth', resolution: 1024 });
  const encode = nodeOf(graph, 'Krea2ControlImageEncode');
  expect(encode.inputs).toMatchObject({ channel_mode: 'grayscale', normalize: 'per_image_minmax', invert: false, batch_mode: 'independent_images' });
  expect(nodeOf(graph, 'Krea2ControlApply').inputs.model).toEqual([idOf(graph, lora), 0]);
  expect(nodeOf(graph, 'KSampler').inputs.model).toEqual([idOf(graph, nodeOf(graph, 'Krea2ControlApply')), 0]);
  // ★ 控制编码那个 latent 和采样器用的是同一个
  const latent = nodeOf(graph, 'EmptyLatentImage');
  expect(latent.inputs).toMatchObject({ width: 1024, height: 1024 });
  expect(encode.inputs.latent).toEqual([idOf(graph, latent), 0]);
  expect(nodeOf(graph, 'KSampler').inputs.latent_image).toEqual([idOf(graph, latent), 0]);
  // 正面是我们那句话、负面空，采样 8 步 / CFG 1 / euler / simple
  expect(nodesOf(graph, 'CLIPTextEncode').map((n) => n.inputs.text)).toEqual(['雨夜站台的电影感摄影。', '']);
  expect(nodeOf(graph, 'KSampler').inputs).toMatchObject({ steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 });
  // 转真人 / Remix 那两条路的节点一个都不该有
  expect(nodeOf(graph, 'Easy_QwenEdit2509')).toBeUndefined();
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch')).toBeUndefined();

  // 传上去的就是槽位那张图（LoadImage 读它的名字）
  const uploads = (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string }[];
  expect(uploads.map((u) => u.name)).toEqual([nodeOf(graph, 'LoadImage').inputs.image]);
  expect(started.node.messages[started.messageId].parsed?.prompts[0].label).toBe('深度迁移');
});

it('深度迁移：控制强度是面板上那个数（强度 0 被 API 拦住），出图尺寸照 JSON 的 1024×1024', async () => {
  const imageId = await t.addImage(canvasId, '#223344');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });

  const weak = await start({ fn: 'depth', slot: 0, text: 'x', refBoost: 1, depth: { strength: 0.6 } });
  expect(weak.started.job.params.remix?.controlStrength).toBe(0.6);
  expect(nodeOf(weak.graph, 'Krea2ControlLoRALoader').inputs.strength).toBe(0.6);

  // 0 不行：真机上 strength=0 时 loader 不注册采样 wrapper，Apply 直接抛错
  expect((await t.call('POST', editUrl(), { fn: 'depth', slot: 0, text: 'x', refBoost: 1, depth: { strength: 0 } })).body.error).toBe('控制强度要在 0.1 到 2 之间');
  expect((await t.call('POST', editUrl(), { fn: 'depth', slot: 0, text: 'x', refBoost: 1, depth: { strength: 2.1 } })).body.error).toBe('控制强度要在 0.1 到 2 之间');
  // 节点上记住的那份也吃得住半份
  const patched = await t.ok<ChatNode>('PATCH', nodeUrl(), { edit: { fn: 'depth', depth: { strength: 0.8 } } });
  expect(patched.edit).toMatchObject({ fn: 'depth', depth: { strength: 0.8 } });
});

it('风格 Remix：Ostris 那条但 LoRA 只喂 model，两个参考接法各接一边，参考图缩到 0.140625 MP', async () => {
  const imageId = await t.addImage(canvasId, '#334455');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const { started, graph } = await start({ fn: 'remix', slot: 0, text: 'a cinematic anime style illustration of the same person。', refBoost: 1 });

  expect(started.job.params).toMatchObject({
    checkpoint: 'krea2/krea2_turbo_int8_convrot.safetensors',
    textEncoder: 'qwen3vl_4b_fp8_scaled.safetensors',
    steps: 8,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'simple',
    loras: [],
    krea: { mode: 'remix' },
    remix: { lora: { name: 'krea2/krea2_reid_rank32.safetensors', strength: 1 } },
  });
  expect(nodeOf(graph, 'UNETLoader').inputs.unet_name).toBe('krea2/krea2_turbo_int8_convrot.safetensors');

  // LoRA 只喂 model（官方图的接法），补丁 kv_cache=true，采样器接补丁的输出
  const lora = nodeOf(graph, 'LoraLoaderModelOnly');
  expect(lora.inputs).toEqual({ model: [idOf(graph, nodeOf(graph, 'UNETLoader')), 0], lora_name: 'krea2/krea2_reid_rank32.safetensors', strength_model: 1 });
  const patch = nodeOf(graph, 'Krea2OstrisEditModelPatch');
  expect(patch.inputs).toEqual({ model: [idOf(graph, lora), 0], kv_cache: true });
  expect(nodeOf(graph, 'KSampler').inputs.model).toEqual([idOf(graph, patch), 0]);

  // 参考图先缩到 384×384 那个预算，两个编码节点共用；正负各接一个参考接法
  const scaled = nodeOf(graph, 'ImageScaleToTotalPixels');
  expect(scaled.inputs).toMatchObject({ upscale_method: 'area', megapixels: 0.140625, resolution_steps: 16 });
  const encodes = nodesOf(graph, 'TextEncodeKrea2OstrisEdit');
  expect(encodes.map((n) => n.inputs.prompt)).toEqual(['a cinematic anime style illustration of the same person。', '']);
  for (const node of encodes) expect(node.inputs.image1).toEqual([idOf(graph, scaled), 0]);
  const references = nodesOf(graph, 'FluxKontextMultiReferenceLatentMethod');
  expect(references.map((n) => n.inputs)).toEqual([
    { conditioning: [idOf(graph, encodes[0]), 0], reference_latents_method: 'index_timestep_zero' },
    { conditioning: [idOf(graph, encodes[1]), 0], reference_latents_method: 'index_timestep_zero' },
  ]);
  expect(nodeOf(graph, 'KSampler').inputs).toMatchObject({ steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 });
  // 深度那条路的控制节点一个都不该有
  expect(nodeOf(graph, 'Krea2ControlLoRALoader')).toBeUndefined();
  expect(nodeOf(graph, 'Easy_QwenEdit2509')).toBeUndefined();
  expect(started.node.messages[started.messageId].parsed?.prompts[0].label).toBe('风格 Remix');
});

it('风格 Remix：换「风格 Remix（保守）」那条 LoRA 只换 lora_name，强度照面板', async () => {
  const imageId = await t.addImage(canvasId, '#445566');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const other = 'krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors';
  const { started, graph } = await start({ fn: 'remix', slot: 0, text: 'x', refBoost: 1, remix: { lora: { name: other, strength: 0.8 } } });

  expect(started.job.params.remix?.lora).toEqual({ name: other, strength: 0.8 });
  expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs).toMatchObject({ lora_name: other, strength_model: 0.8 });
  // 别的接线一个节点都没变
  expect(nodeOf(graph, 'ImageScaleToTotalPixels').inputs).toMatchObject({ megapixels: 0.140625, resolution_steps: 16 });
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch').inputs.kv_cache).toBe(true);
});

it('深度迁移 / 风格 Remix：没选图、没写字各报一句人话，一句都不发出去', async () => {
  const imageId = await t.addImage(canvasId, '#556677');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  expect((await t.call('POST', editUrl(), { fn: 'depth', slot: 0, text: '  ', refBoost: 1 })).body.error).toBe('先写一句要改什么');
  expect((await t.call('POST', editUrl(), { fn: 'remix', slot: 0, text: '', refBoost: 1 })).body.error).toBe('先写一句要改什么');
  await t.ok('PATCH', nodeUrl(), { slots: [] });
  expect((await t.call('POST', editUrl(), { fn: 'depth', slot: 0, text: 'x', refBoost: 1 })).body.error).toBe('先选一张要改的图');
  expect((await t.call('POST', editUrl(), { fn: 'remix', slot: 0, text: 'x', refBoost: 1 })).body.error).toBe('先选一张要改的图');
  expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);
});

it('缺插件时说清装哪个：深度那三个控制节点和深度提取各报各的', async () => {
  const imageId = await t.addImage(canvasId, '#667788');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const hide = (types: string[]) =>
    fetch(`${comfyUrl}/_hide-nodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types }) });
  const errorOf = async (messageId: string) => {
    await expect
      .poll(async () => (await t.ok<ChatNode>('GET', nodeUrl())).messages[messageId].images![0].images[0].error ?? '', { timeout: 8000 })
      .toContain('缺插件');
    return (await t.ok<ChatNode>('GET', nodeUrl())).messages[messageId].images![0].images[0].error!;
  };

  await hide(['Krea2ControlLoRALoader', 'Krea2ControlImageEncode', 'Krea2ControlApply']);
  const first = await t.ok<Started>('POST', editUrl(), { fn: 'depth', slot: 0, text: 'x', refBoost: 1 });
  expect(await errorOf(first.messageId)).toContain('comfyui-krea2-controlnet');
  expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);

  await hide(['DepthAnythingV2Preprocessor']);
  const second = await t.ok<Started>('POST', editUrl(), { fn: 'depth', slot: 0, text: 'x', refBoost: 1 });
  expect(await errorOf(second.messageId)).toContain('comfyui_controlnet_aux');
  expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);
});

it('参考图删掉时，深度迁移 / 风格 Remix 都报一句人话（「这张图找不到了」），一个任务都不建', async () => {
  const imageId = await t.addImage(canvasId, '#778899');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  // 把画布上存的那份删掉（用户删图就是这个效果）：editJob 在选图那一步就找不到了
  const images = JSON.parse(await fs.readFile(path.join(t.work, 'canvases', canvasId, 'images.json'), 'utf8')) as Record<string, { sha256: string; ext: string }>;
  await fs.rm(path.join(t.work, 'canvases', canvasId, 'images', `${images[imageId].sha256}.${images[imageId].ext}`));

  for (const fn of ['depth', 'remix']) {
    expect(await t.call('POST', editUrl(), { fn, slot: 0, text: 'x', refBoost: 1 })).toEqual({
      status: 404,
      body: { error: '这张图找不到了：删掉了，或者程序换过工作文件夹' },
    });
  }
  expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);
});

it('换装 / 转真人之外的规矩不变：没选图、没写字都拦住', async () => {
  const imageId = await t.addImage(canvasId, '#789abc');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  expect((await t.call('POST', editUrl(), { fn: 'outfit', slot: 0, text: '  ', refBoost: 1 })).body.error).toBe('先写一句要改什么');
  // 转真人开着反推时不写字也能开，关掉反推就必须写
  expect((await t.call('POST', editUrl(), { fn: 'real', slot: 0, text: '', refBoost: 1, real: { reverse: false } })).body.error).toBe('先写一句要改什么');
  await t.ok('PATCH', nodeUrl(), { slots: [] });
  expect((await t.call('POST', editUrl(), { fn: 'real', slot: 0, text: 'x', refBoost: 1 })).body.error).toBe('先选一张要改的图');
});

it('转真人的设置能只发一半：范围不对的拦住，其他的跟默认值 / 节点上那份深合并', async () => {
  const imageId = await t.addImage(canvasId, '#89abcd');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });

  // 范围：像图 2 多少 0–10、LoRA 强度 0–1.5、重绘强度 0–1
  expect((await t.call('POST', editUrl(), { fn: 'real', slot: 0, text: 'x', refBoost: 1, real: { image2Strength: 11 } })).body.error).toBe('图 2 强度要在 0 到 10 之间');
  expect((await t.call('POST', editUrl(), { fn: 'real', slot: 0, text: 'x', refBoost: 1, real: { lora: { strength: 1.6 } } })).body.error).toBe('转真人 LoRA强度要在 0 到 1.5 之间');
  expect((await t.call('POST', editUrl(), { fn: 'real', slot: 0, text: 'x', refBoost: 1, real: { people: [{ name: 'x', strength: 2 }] } })).body.error).toBe('人物 LoRA强度要在 0 到 1.5 之间');
  expect((await t.call('POST', editUrl(), { fn: 'real', slot: 0, text: 'x', refBoost: 1, inpaint: { denoise: 1.2 } })).body.error).toBe('重绘强度要在 0 到 1 之间');
  expect((await t.call('POST', editUrl(), { fn: 'real', slot: 0, text: 'x', refBoost: 11 })).body.error).toBe('相似度要在 0 到 10 之间');

  // 只发 real.image2Strength：别的项还是默认值（reverse 还是开着的）
  const { started } = await start({ fn: 'real', slot: 0, text: '', refBoost: 1, real: { image2Strength: 0.4 } });
  expect(started.job.params.real).toEqual({
    reverse: true,
    dual: false,
    image2Strength: 0.4,
    loras: [{ name: REAL_LORA, strength: 1 }, { name: REAL_BODY_LORA, strength: 1 }],
    uncensored: true,
    reverseInstruction: REVERSE_PROMPT,
  });

  // 节点上记住的那份也吃得住半份：只改 dual，别的项留着
  const patched = await t.ok<ChatNode>('PATCH', nodeUrl(), { edit: { fn: 'real', real: { dual: true, image2Strength: 2 } } });
  expect(patched.edit).toMatchObject({ fn: 'real', slot: 0, real: { dual: true, image2Strength: 2, reverse: true, uncensored: true, lora: { name: REAL_LORA, strength: 1 } } });
  expect((await t.call('PATCH', nodeUrl(), { edit: { real: { dual: 'yes' } } })).status).toBe(400);
});

it('换脸的双图触发词跟单图那份不一样（反推关着时按开关挑）', async () => {
  const first = await t.addImage(canvasId, '#9abcde');
  const second = await t.addImage(canvasId, '#fedcba');
  await t.ok('PATCH', nodeUrl(), { slots: [first, second] });

  const single = await start({ fn: 'real', slot: 0, text: 'x', refBoost: 1, real: { reverse: false } });
  expect(nodeOf(single.graph, 'Easy_QwenEdit2509').inputs.prompt).toBe(`${REAL_TRIGGER}\n\nx`);
  const dual = await start({ fn: 'real', slot: 0, slotB: 1, text: 'x', refBoost: 1, real: { reverse: false, dual: true } });
  expect(nodeOf(dual.graph, 'Easy_QwenEdit2509').inputs.prompt).toBe(`${REAL_TRIGGER_DUAL}\n\nx`);
  // 反推开着时换成「反推-双图」那份系统提示词
  const reversed = await start({ fn: 'real', slot: 0, slotB: 1, text: '', refBoost: 1, real: { reverse: true, dual: true } });
  expect(nodeOf(reversed.graph, 'llama_cpp_instruct_adv').inputs.system_prompt).toContain('TWO IMAGES');
});

it('缺插件时说清装哪个：主图那个编码节点和反推那套各报各的，一张都不发', async () => {
  const imageId = await t.addImage(canvasId, '#abcdef');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const hide = (types: string[]) =>
    fetch(`${comfyUrl}/_hide-nodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types }) });
  // 这一组是失败的，等不到「出完」，只能等这一组的 error
  const errorOf = async (messageId: string) => {
    await expect
      .poll(async () => (await t.ok<ChatNode>('GET', nodeUrl())).messages[messageId].images![0].images[0].error ?? '', { timeout: 8000 })
      .toContain('缺插件');
    return (await t.ok<ChatNode>('GET', nodeUrl())).messages[messageId].images![0].images[0].error!;
  };

  await hide(['Easy_QwenEdit2509']);
  const first = await t.ok<Started>('POST', editUrl(), { fn: 'real', slot: 0, text: 'x', refBoost: 1, real: { reverse: false } });
  expect(await errorOf(first.messageId)).toContain('easy_qwenEdit_2509');
  expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);

  // 反推那三个是另一个插件（那台上装的 llama.cpp 那个包，2026-10-11 照实机 object_info 核过）
  await hide(['llama_cpp_model_loader', 'llama_cpp_parameters', 'llama_cpp_instruct_adv']);
  const second = await t.ok<Started>('POST', editUrl(), { fn: 'real', slot: 0, text: '', refBoost: 1 });
  expect(await errorOf(second.messageId)).toContain('llama-cpp_vllm');
  expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);
});

it('局部重绘：原图是槽位里那张，掩码落盘后传上去，图里是 E05 那套节点，强度进去了', async () => {
  // 局部重绘走的是内置 SDXL 那条路（跟提示词是不是生图用的无关）：说明段里写了「底模: IL」就用 IL 那张
  await t.ok('PUT', '/prompts/il', { text: '---\n用途: 生图\n底模: IL\n---\n只写标签' });
  const imageId = await t.addImage(canvasId, '#a1b2c3');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });

  // 把中间一块抠成透明：要重画的地方 alpha=0，别处 255（界面上拖框/涂抹导出的就是这张）
  const raw = Buffer.alloc(300 * 300 * 4);
  for (let y = 0; y < 300; y += 1) {
    for (let x = 0; x < 300; x += 1) {
      const i = (y * 300 + x) * 4;
      raw[i] = 161;
      raw[i + 1] = 178;
      raw[i + 2] = 195;
      raw[i + 3] = x >= 80 && x < 180 && y >= 60 && y < 160 ? 0 : 255;
    }
  }
  const png = await sharp(raw, { raw: { width: 300, height: 300, channels: 4 } }).png().toBuffer();

  const started = await t.ok<Started>('POST', editUrl(), {
    fn: 'inpaint',
    slot: 0,
    text: 'a red leather jacket collar',
    refBoost: 1,
    inpaint: { denoise: 0.85 },
    mask: png.toString('base64'),
  });
  // 掩码落在临时文件夹里，「已清理」那套跟着适用，内容一个字节都没动
  expect(started.job).toMatchObject({
    kind: 'inpaint',
    promptIndex: 0,
    images: [{ status: 'queued' }],
    params: {
      family: 'IL',
      positive: 'masterpiece, best quality, a red leather jacket collar',
      clipSkip: FAMILY_DEFAULTS.IL.clipSkip,
      negative: FAMILY_DEFAULTS.IL.negative,
      width: 300,
      height: 300,
      inpaint: { denoise: 0.85 },
    },
  });
  expect(started.job.params.inpaint!.mask).toMatch(/^image-temp\/\d{4}-\d{2}-\d{2}\/\d{6}-mask\.png$/);
  expect(await fs.readFile(path.join(t.work, started.job.params.inpaint!.mask))).toEqual(png);
  // 出图挂在新建的那条回复下面，框上标着「局部重绘」
  expect(started.node.messages[started.messageId].parsed?.prompts[0].label).toBe('局部重绘');

  await expect
    .poll(async () => JSON.stringify((await t.ok<ChatNode>('GET', nodeUrl())).messages[started.messageId].images![0].images[0]), { timeout: 8000 })
    .toContain('"status":"done"');
  // 出的图跟原图一样大（假的 ComfyUI 按传上去的那张 PNG 定尺寸；真的那台是拼回原图）
  expect((await t.ok<ChatNode>('GET', nodeUrl())).messages[started.messageId].images![0].images[0]).toMatchObject({ width: 300, height: 300 });
  const graph = await lastGraph();
  // 底图和掩码分两张传：ComfyUI 的 LoadImage 会把 RGBA 按 alpha 合成到黑底，
  // 合成一张的话要重画那块在底图里永远是黑的（2026-10-12 真机上验的）
  const loads = nodesOf(graph, 'LoadImage');
  expect(loads).toHaveLength(2);
  for (const load of loads) expect(load.inputs.image).toBeTruthy();
  expect(nodeOf(graph, 'InpaintCropImproved').inputs).toMatchObject({
    image: [idOf(graph, loads[0]), 0],
    mask: [idOf(graph, loads[1]), 1],
    mask_expand_pixels: 8,
    output_target_width: 1024,
    output_target_height: 1024,
  });
  expect(nodeOf(graph, 'InpaintModelConditioning').inputs.noise_mask).toBe(true);
  expect(nodeOf(graph, 'InpaintStitchImproved')).toBeTruthy();
  expect(nodeOf(graph, 'KSampler').inputs.denoise).toBe(0.85);
  expect(nodeOf(graph, 'KSampler').inputs.steps).toBe(FAMILY_DEFAULTS.IL.steps);
  expect(nodeOf(graph, 'CheckpointLoaderSimple').inputs.ckpt_name).toBe('il-test.safetensors');
  // 传上去的两张：底图（槽位那张）和掩码（按内容算名字，同一张传几次都是同一个名字）
  const sourceBytes = await fs.readFile(path.join(t.work, 'test-images', 'a1b2c3-300x300.jpg'));
  const uploads = (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { sha256: string }[];
  expect(uploads.map((one) => one.sha256)).toEqual([createHash('sha256').update(png).digest('hex'), createHash('sha256').update(sourceBytes).digest('hex')]);
}, 20_000);

it('局部重绘：没画掩码、没选图、没写字各报一句人话', async () => {
  const imageId = await t.addImage(canvasId, '#b2c3d4');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const png = (await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()).toString('base64');

  expect(await t.call('POST', editUrl(), { fn: 'inpaint', slot: 0, text: '一块红领子', refBoost: 1 })).toEqual({ status: 400, body: { error: '先在图上拖个框或者涂抹出要重画的地方' } });
  expect(await t.call('POST', editUrl(), { fn: 'inpaint', slot: 0, text: '  ', refBoost: 1, mask: png })).toEqual({ status: 400, body: { error: '先写一句这块画成什么' } });
  // 掩码不是 PNG 也拦下来（跟大图窗口那条报同一句）
  expect(await t.call('POST', editUrl(), { fn: 'inpaint', slot: 0, text: 'x', refBoost: 1, mask: '不是图' })).toEqual({ status: 400, body: { error: '掩码要是 base64 的 PNG' } });
  await t.ok('PATCH', nodeUrl(), { slots: [] });
  expect(await t.call('POST', editUrl(), { fn: 'inpaint', slot: 0, text: 'x', refBoost: 1, mask: png })).toEqual({ status: 400, body: { error: '先选一张要改的图' } });
  // 一句都没发出去
  expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);
});

// 第 2 批那两个功能：放大 / 高清、四视图，见 docs/plan-image-edit-node.md 第 3 节

it('放大 / 高清：不用写字，走生图节点那条内置放大路（放大模型 + 只放大不重画），原图是槽位那张', async () => {
  // 放大走内置 SDXL 那条路，跟局部重绘一样：说明段里写了「底模: IL」就用 IL 那张
  await t.ok('PUT', '/prompts/il', { text: '---\n用途: 生图\n底模: IL\n---\n只写标签' });
  const imageId = await t.addImage(canvasId, '#a0b1c2');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  // 放大模型空着发出去：服务端到 submit 里用这台 ComfyUI 上第一个（假的这台是 4x-test.pth）
  const { started, graph } = await start({ fn: 'upscale', slot: 0, text: '', refBoost: 1, upscale: { scale: 2 } });

  expect(started.job.kind).toBe('edit');
  expect(started.job.params).toMatchObject({
    family: 'IL',
    // 尺寸是原图（假的这边 addImage 是 300×300），倍数在 upscale 里；重绘强度固定 0
    width: 300,
    height: 300,
    // 面板上没选放大模型：发出来的时候还是空的，到 submit 里才用这台 ComfyUI 上第一个填上（下面再读一次）
    upscale: { on: true, model: '', scale: 2, denoise: 0 },
    upscaleFrom: { kind: 'slot', imageId },
    // 只放大不重画：不用写提示词，正面就是系列固定开头
    positive: FAMILY_DEFAULTS.IL.prefix,
    negative: FAMILY_DEFAULTS.IL.negative,
  });
  // 没开面部修复：一道部位重绘都没有
  expect(started.job.params.details).toEqual([]);
  // 存下来的这组里放大模型已经填上了（这台 ComfyUI 上第一个）
  await expect
    .poll(async () => (await t.ok<ChatNode>('GET', nodeUrl())).messages[started.messageId].images![0].params.upscale?.model ?? '', { timeout: 8000 })
    .toBe('4x-test.pth');

  // 图里就是那条内置放大路：LoadImage（传上去的就是槽位那张）→ 放大模型 → 缩到原图 ×2
  const load = nodeOf(graph, 'LoadImage');
  expect(load.inputs.image).toBeTruthy();
  expect(nodeOf(graph, 'UpscaleModelLoader').inputs.model_name).toBe('4x-test.pth');
  expect(nodeOf(graph, 'ImageUpscaleWithModel').inputs).toEqual({ upscale_model: [idOf(graph, nodeOf(graph, 'UpscaleModelLoader')), 0], image: [idOf(graph, load), 0] });
  expect(nodeOf(graph, 'ImageScale').inputs).toMatchObject({ image: [idOf(graph, nodeOf(graph, 'ImageUpscaleWithModel')), 0], upscale_method: 'lanczos', width: 600, height: 600 });
  // 重绘强度 0：整张图没有采样器，也没开面部修复
  expect(nodeOf(graph, 'KSampler')).toBeUndefined();
  expect(nodeOf(graph, 'FaceDetailer')).toBeUndefined();
  expect(nodeOf(graph, 'PreviewImage')).toBeTruthy();
  // 底模是这台 ComfyUI 上 IL 的那个
  expect(nodeOf(graph, 'CheckpointLoaderSimple').inputs.ckpt_name).toBe('il-test.safetensors');

  // 传上去的就是槽位那张图（按内容算名字）
  const uploads = (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string }[];
  expect(uploads.map((u) => u.name)).toEqual([load.inputs.image]);
  // 出的图是放大后的尺寸；框上标着「放大 / 高清」
  await expect
    .poll(async () => JSON.stringify((await t.ok<ChatNode>('GET', nodeUrl())).messages[started.messageId].images![0].images[0]), { timeout: 8000 })
    .toContain('"status":"done"');
  expect((await t.ok<ChatNode>('GET', nodeUrl())).messages[started.messageId].images![0].images[0]).toMatchObject({ width: 600, height: 600 });
  expect(started.node.messages[started.messageId].parsed?.prompts[0].label).toBe('放大 / 高清');
});

it('放大 / 高清：开了面部修复就多一道部位重绘（检测模型照面板上那个），倍数和模型照面板', async () => {
  const imageId = await t.addImage(canvasId, '#b1c2d3', 300, 300);
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const { started, graph } = await start({
    fn: 'upscale',
    slot: 0,
    text: '',
    refBoost: 1,
    upscale: { scale: 1.5, model: '4x-test.pth', face: 'bbox/face_yolov8m.pt' },
  });

  expect(started.job.params.upscale).toEqual({ on: true, model: '4x-test.pth', scale: 1.5, denoise: 0 });
  expect(started.job.params.details).toMatchObject([{ on: true, detector: 'bbox/face_yolov8m.pt', denoise: 0.4, threshold: 0.3, positive: '', negative: '' }]);
  // 1.5 倍取 8 的倍数（跟生图节点那个放大同一个算法）
  expect(nodeOf(graph, 'ImageScale').inputs).toMatchObject(scaledSize(started.job.params, 1.5));
  // 面部修复那一道：检测模型 + FaceDetailer 接在放大之后
  expect(nodeOf(graph, 'UltralyticsDetectorProvider').inputs.model_name).toBe('bbox/face_yolov8m.pt');
  const face = nodeOf(graph, 'FaceDetailer');
  expect(face.inputs.image).toEqual([idOf(graph, nodeOf(graph, 'ImageScale')), 0]);
  expect(face.inputs.denoise).toBe(0.4);
  expect(face.inputs.bbox_detector).toEqual([idOf(graph, nodeOf(graph, 'UltralyticsDetectorProvider')), 0]);
  // 还是只放大不重画：正面词是系列固定开头，没有 KSampler 那一步
  expect(nodeOf(graph, 'KSampler')).toBeUndefined();
});

it('放大 / 高清：倍数越界拦住，没选图也拦住，一句都不发出去', async () => {
  const imageId = await t.addImage(canvasId, '#c2d3e4');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  expect((await t.call('POST', editUrl(), { fn: 'upscale', slot: 0, text: '', refBoost: 1, upscale: { scale: 3 } })).body.error).toBe('放大倍数只能是 1.5、2、4');
  await t.ok('PATCH', nodeUrl(), { slots: [] });
  expect((await t.call('POST', editUrl(), { fn: 'upscale', slot: 0, text: '', refBoost: 1 })).body.error).toBe('先选一张要改的图');
  expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);
});

it('四视图：原图是槽位那张，走 krea2_4panel 那条路，主指令接在框里那句话前面（不写也行）', async () => {
  const imageId = await t.addImage(canvasId, '#d3e4f5');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const { started, graph } = await start({ fn: 'fourview', slot: 0, text: 'keep the red jacket and use a plain background', refBoost: 1 });

  // 跟生图节点那个「做四视图」同一个说法；底模、LoRA、步数照那一档的默认值
  expect(started.job.kind).toBe('four-view');
  expect(started.job.params).toMatchObject({
    family: 'Krea2',
    checkpoint: 'krea/krea2_turbo_int8_convrot.safetensors',
    steps: 10,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'simple',
    loras: [{ name: 'krea2/krea2_4panel.safetensors', strength: 1 }],
    krea: { mode: 'four-view' },
  });
  // 主指令固定在最前面，框里那句接在后面；两个编码节点的正面词都是它
  expect(started.job.params.positive).toBe(`${FOUR_VIEW_INSTRUCTION}\n\nkeep the red jacket and use a plain background`);
  const encodes = nodesOf(graph, 'Krea2EditGroundedEncode');
  expect(encodes.map((n) => n.inputs.prompt)).toEqual([started.job.params.positive, '']);
  // Krea2Edit 那两个节点（不是编辑档的 Ostris 那两个）
  expect(nodeOf(graph, 'Krea2EditModelPatch')).toBeTruthy();
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch')).toBeUndefined();
  // 传上去的是槽位那张
  const uploads = (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string }[];
  expect(uploads.map((u) => u.name)).toEqual([nodeOf(graph, 'LoadImage').inputs.image]);
  expect(started.node.messages[started.messageId].parsed?.prompts[0].label).toBe('四视图');

  // 不写字也能开：框里就是主指令那一句
  const bare = await start({ fn: 'fourview', slot: 0, text: '', refBoost: 1 });
  expect(bare.started.job.params.positive).toBe(FOUR_VIEW_INSTRUCTION);
  expect(bare.started.node.messages[bare.started.messageId].parsed?.prompts[0].text).toBe(FOUR_VIEW_INSTRUCTION);

  // 框上那个「开始」照发整段（框里存的就是主指令 + 额外要求）：fourViewPrompt 会把重复的主指令去掉，
  // 不会变成「主指令 + 主指令 + 额外要求」
  const fromBox = await start({ fn: 'fourview', slot: 0, text: `${FOUR_VIEW_INSTRUCTION}\n\nkeep the red jacket`, refBoost: 1 });
  expect(fromBox.started.job.params.positive).toBe(`${FOUR_VIEW_INSTRUCTION}\n\nkeep the red jacket`);
});

it('编辑节点出的图也能直接做四视图，结果挂回原框，节点的编辑设置不变', async () => {
  const imageId = await t.addImage(canvasId, '#d4e5f6');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId], edit: { fn: 'outfit', text: 'Change the jacket.' } });
  const before = await t.ok<ChatNode>('GET', nodeUrl());
  const { started } = await start({ fn: 'outfit' });
  const made = await t.ok<Started>('POST', `${nodeUrl()}/four-view`, {
    reference: { kind: 'generated', messageId: started.messageId, jobId: started.job.id, seed: started.job.images[0].seed },
    extra: 'Keep the jacket.',
  });
  expect(made.messageId).toBe(started.messageId);
  expect(made.job.params).toMatchObject({ family: 'Krea2', width: 1536, height: 1024, krea: { mode: 'four-view' } });
  expect(made.job.params.positive).toBe(`${FOUR_VIEW_INSTRUCTION}\n\nKeep the jacket.`);
  await expect.poll(async () => {
    const node = await t.ok<ChatNode>('GET', nodeUrl());
    return node.messages[made.messageId].images!.find((job) => job.id === made.job.id)!.images[0].status;
  }, { timeout: 8000 }).toBe('done');
  const after = await t.ok<ChatNode>('GET', nodeUrl());
  expect(Object.keys(after.messages)).toHaveLength(1);
  expect(after.messages[made.messageId].images).toHaveLength(2);
  expect(after.edit).toEqual(before.edit);
  expect(after.systemPromptName).toBe(before.systemPromptName);
  const slot = await t.ok<Started>('POST', `${nodeUrl()}/four-view`, { reference: { kind: 'slot', imageId } });
  expect(slot.node.messages[slot.messageId].edit).toEqual({ fn: 'fourview', slot: 0 });
});

it('框上的「开始」：带上目标回复就不新建回复，出的图挂在那条回复的那个框下面', async () => {
  const imageId = await t.addImage(canvasId, '#e4f5a6');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const first = await t.ok<Started>('POST', editUrl(), { fn: 'edit', slot: 0, text: '把外套换成黑皮衣', refBoost: 1 });
  const before = Object.keys(first.node.messages).length;

  // 框上那个「开始」：messageId + promptIndex，别的字段跟面板底部那条一样
  const again = await t.ok<Started>('POST', editUrl(), { fn: 'edit', slot: 0, text: '把外套换成黑皮衣', refBoost: 1, messageId: first.messageId, promptIndex: 0 });
  expect(again.messageId).toBe(first.messageId);
  const node = await t.ok<ChatNode>('GET', nodeUrl());
  expect(Object.keys(node.messages)).toHaveLength(before);
  // 两组都挂在这条回复下面，第二组的 promptIndex 是 0
  const jobs = node.messages[first.messageId].images!;
  expect(jobs).toHaveLength(2);
  expect(jobs.map((job) => job.promptIndex)).toEqual([0, 0]);
  expect(jobs.map((job) => job.kind)).toEqual(['edit', 'edit']);
  // 等这一组也出完再往下走（收尾时还在写节点文件的话，清临时目录会撞上）
  await expect
    .poll(async () => (await t.ok<ChatNode>('GET', nodeUrl())).messages[first.messageId].images![1].images[0].status, { timeout: 8000 })
    .toBe('done');

  // 回复里没有那个框 / 回复不在：都报一句人话，一个任务都不建
  expect(await t.call('POST', editUrl(), { fn: 'edit', slot: 0, text: 'x', refBoost: 1, messageId: first.messageId, promptIndex: 3 })).toEqual({
    status: 404,
    body: { error: '这条回复里没有第 4 个提示词框' },
  });
  expect(await t.call('POST', editUrl(), { fn: 'edit', slot: 0, text: 'x', refBoost: 1, messageId: '00000000-0000-4000-8000-000000000000' })).toEqual({
    status: 404,
    body: { error: '找不到这条回复' },
  });
  expect(Object.keys((await t.ok<ChatNode>('GET', nodeUrl())).messages)).toHaveLength(before);
});

it('执行种子和反推种子独立，反推实际文字随结果记录，后续修改不覆盖任务快照', async () => {
  const imageId = await t.addImage(canvasId, '#e1a2b3');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId], edit: { seed: 123, real: { reverseSeed: 456 } } });
  const { started, graph } = await start({ fn: 'real', text: '' });
  expect(nodeOf(graph, 'KSampler').inputs.seed).toBe(123);
  expect(nodeOf(graph, 'llama_cpp_instruct_adv').inputs.seed).toBe(456);
  const result = (await t.ok<ChatNode>('GET', nodeUrl())).messages[started.messageId].images![0].images[0];
  expect(result.promptText).toContain(REAL_TRIGGER);
  await t.ok('PATCH', nodeUrl(), { edit: { seed: 789, real: { reverseSeed: 987 } } });
  const frozen = (await t.ok<ChatNode>('GET', nodeUrl())).messages[started.messageId].images![0];
  expect(frozen.images[0].seed).toBe(123);
  expect(frozen.params.real?.reverseSeed).toBe(456);
});

it('4 倍放大、自定义四视图、换装 LoRA 和深度上限进入实际提交的工作流', async () => {
  const imageId = await t.addImage(canvasId, '#e1b2c3');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const upscale = await start({ fn: 'upscale', upscale: { scale: 4 } });
  expect(nodeOf(upscale.graph, 'ImageScale').inputs).toMatchObject({ width: 1200, height: 1200 });
  expect(upscale.started.job.params.upscale?.denoise).toBe(0);
  const four = await start({ fn: 'fourview', text: '蓝色背景', fourview: { width: 1280, height: 768 } });
  expect(four.started.job.params).toMatchObject({ width: 1280, height: 768 });
  expect(four.started.job.params.positive).toBe(`${FOUR_VIEW_INSTRUCTION}\n\n蓝色背景`);
  const outfit = await start({ fn: 'outfit', text: 'red dress', outfitLora: 'krea2/krea_outfittransfer.safetensors' });
  expect(nodeOf(outfit.graph, 'LoraLoaderModelOnly').inputs.lora_name).toBe('krea2/krea_outfittransfer.safetensors');
  const depth = await start({ fn: 'depth', text: 'rain', depth: { strength: 2 } });
  expect(nodeOf(depth.graph, 'Krea2ControlLoRALoader').inputs.strength).toBe(2);
  expect((await t.call('POST', editUrl(), { fn: 'fourview', fourview: { width: 1279, height: 768 } })).status).toBe(400);
});

it('掩码随原图、上下文与思考设置持久化，羽化进入裁剪节点', async () => {
  const imageId = await t.addImage(canvasId, '#e1c2d3');
  const maskShapes = { imageId, rect: { x: 60, y: 60, width: 120, height: 100 }, strokes: [] };
  await t.ok('PATCH', nodeUrl(), { slots: [imageId], thinking: 'low', turnLimit: 5, edit: { maskShapes, inpaint: { feather: 64 } } });
  await t.restart();
  expect(await t.ok('GET', nodeUrl())).toMatchObject({ thinking: 'low', turnLimit: 5, edit: { maskShapes, inpaint: { feather: 64 } } });
  const mask = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const { started, graph } = await start({ fn: 'inpaint', text: 'blue jacket', mask: mask.toString('base64') });
  expect(started.job.params.inpaint?.feather).toBe(64);
  expect(nodeOf(graph, 'InpaintCropImproved').inputs.mask_blend_pixels).toBe(64);
  expect((await t.call('PATCH', nodeUrl(), { edit: { inpaint: { feather: 129 } } })).status).toBe(400);
  expect((await t.call('PATCH', nodeUrl(), { thinking: 'invalid' })).status).toBe(400);
});

it('候选绑定原图，删除或切换原图会阻止错用；明确复用文字后可执行', async () => {
  const first = await t.addImage(canvasId, '#e1d2e3');
  const second = await t.addImage(canvasId, '#f1d2e3');
  await t.ok('PATCH', nodeUrl(), { slots: [first, second], edit: { slot: 0 } });
  const candidateNode = await t.ok<ChatNode>('POST', `${nodeUrl()}/handwritten`, { text: 'blue coat' });
  const message = Object.values(candidateNode.messages)[0];
  expect(message.edit).toEqual({ fn: 'edit', slot: 0 });
  const candidate = { messageId: message.id, promptIndex: 0 };
  const good = await start({ fn: 'edit', slot: 0, text: 'blue coat', candidate });
  expect(good.started.messageId).toBe(message.id);
  expect(Object.keys(good.started.node.messages)).toHaveLength(1);
  expect((await t.call('POST', editUrl(), { fn: 'edit', slot: 1, text: 'blue coat', candidate })).status).toBe(400);
  const reused = await start({ fn: 'edit', slot: 1, text: 'blue coat', candidate: null });
  expect(reused.started.messageId).not.toBe(message.id);
  const fork = await t.ok<ChatNode>('POST', `${nodeUrl()}/fork`, { messageId: reused.started.messageId });
  expect(fork.kind).toBe('edit');
});

it('没有文字候选的已保存放大结果也能派生四视图，且不能挂到别的候选', async () => {
  const imageId = await t.addImage(canvasId, '#a1d2e3');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  const original = await start({ fn: 'upscale', text: '' });
  await t.ok('POST', '/assets/folders', { path: t.work });
  await t.ok('POST', '/images/download', { folder: t.work, items: [{ canvasId, nodeId, messageId: original.started.messageId, jobId: original.started.job.id, index: 0 }] });
  const candidate = { messageId: original.started.messageId, promptIndex: 0 };
  const source = { kind: 'generated', jobId: original.started.job.id, seed: original.started.job.images[0].seed };
  const made = await start({ fn: 'fourview', text: '', source, candidate });
  expect(made.started.messageId).toBe(original.started.messageId);
  expect(made.started.job.source).toEqual(source);
  expect(made.started.job.editFn).toBe('fourview');
  const other = await start({ fn: 'edit', text: 'red coat' });
  expect((await t.call('POST', editUrl(), { fn: 'fourview', text: '', source, candidate: { messageId: other.started.messageId, promptIndex: 0 } })).status).toBe(400);
});
