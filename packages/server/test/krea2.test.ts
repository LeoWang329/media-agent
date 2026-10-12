import {
  activePath,
  defaultImageSettings,
  EDIT_LORA,
  FAMILY_DEFAULTS,
  FOUR_VIEW_INSTRUCTION,
  kreaDefaults,
  type ChatNode,
  type ComfyGraph,
  type ComfyOptions,
  type ImageJob,
  type ImagePreset,
} from '@media-agent/shared';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createMockComfy, type MockComfy } from '../../../tools/mock-comfyui/src/app';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
let mock: MockComfy;
let comfyUrl: string;
let canvasId: string;
let nodeId: string;
const nodeUrl = () => `/canvases/${canvasId}/nodes/${nodeId}`;
const jobsUrl = (messageId: string) => `${nodeUrl()}/messages/${messageId}/images`;
const nodeOf = (graph: ComfyGraph, type: string) => Object.values(graph).find((n) => n.class_type === type)!;
const lastGraph = async () => ((await (await fetch(`${comfyUrl}/_last-prompts`)).json()) as { prompt: ComfyGraph }[]).at(-1)!.prompt;

beforeEach(async () => {
  mock = createMockComfy({ stepMs: 5 });
  await new Promise<void>((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
  comfyUrl = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
  t = await startTestApp();
  await t.ok('PUT', '/settings', { comfy: { lanUrl: comfyUrl } });
  canvasId = (await t.ok('POST', '/canvases', { title: 'Krea2' })).id;
  nodeId = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { kind: 'image', x: 0, y: 0 })).id;
  await t.ok('PATCH', nodeUrl(), { systemPromptName: 'krea2' });
});

afterEach(async () => {
  await t.cleanup();
  await mock.close();
});

async function frame(text: string) {
  const node = await t.ok<ChatNode>('POST', `${nodeUrl()}/handwritten`, { parentId: null, text });
  return activePath(node).at(-1)!.id;
}

async function done(messageId: string, job: ImageJob) {
  let result = job;
  await expect
    .poll(
      async () => {
        const node = await t.ok<ChatNode>('GET', nodeUrl());
        result = node.messages[messageId].images!.find((j) => j.id === job.id)!;
        return result.images.map((i) => i.status);
      },
      { timeout: 8000 },
    )
    .toEqual(job.images.map(() => 'done'));
  return result;
}

it('Krea2 选项来自 UNET 和 CLIP；跨系列切换清掉旧参数，旧 IL 默认值保持不变', async () => {
  const options = await t.ok<ComfyOptions>('GET', '/comfy/options');
  expect(options.kreaModels).toContain('krea/krea2_turbo_int8_convrot.safetensors');
  expect(options.textEncoders).toContain('qwen3vl_4b_fp8_scaled.safetensors');
  const node = await t.ok<ChatNode>('GET', nodeUrl());
  expect(node.image).toMatchObject({
    width: 1536,
    height: 2728,
    cfg: 1,
    steps: 8,
    textEncoder: 'qwen3vl_4b_uncensored_int8_convrot.safetensors',
    krea: { mode: 'text' },
  });
  await t.ok('PATCH', nodeUrl(), { image: { width: 1024, height: 1024, steps: 12 } });
  const old = await t.ok<ChatNode>('PATCH', nodeUrl(), { systemPromptName: 'il' });
  expect(old.image).toEqual(defaultImageSettings(FAMILY_DEFAULTS.IL));
  expect(old.image?.krea).toBeUndefined();
});

it('文生图原样使用英文段落，不加标签前缀或负面；多 LoRA 真正串入模型；同种子重出参数不变', async () => {
  const text = 'An adult woman by a window, wearing a textured jacket. Soft light falls from the left.';
  const messageId = await frame(text);
  await t.ok('PATCH', nodeUrl(), {
    image: {
      width: 512,
      height: 512,
      seed: 123,
      count: 2,
      loras: [
        { name: 'krea2/krea2_darkbrush.safetensors', strength: 0.8 },
        { name: 'krea2/krea2_4panel.safetensors', strength: 0.2 },
      ],
    },
  });
  const job = await t.ok<ImageJob>('POST', jobsUrl(messageId), { promptIndex: 0 });
  expect(job.params).toMatchObject({ family: 'Krea2', positive: text, negative: '', steps: 8, cfg: 1 });
  expect((await done(messageId, job)).images.map((i) => [i.seed, i.width, i.height])).toEqual([
    [123, 512, 512],
    [124, 512, 512],
  ]);
  const graph = await lastGraph();
  expect(nodeOf(graph, 'CLIPLoader').inputs.type).toBe('krea2');
  expect(nodeOf(graph, 'CLIPTextEncode').inputs.text).toBe(text);
  expect(Object.values(graph).some((n) => n.class_type === 'CLIPSetLastLayer')).toBe(false);
  const model = nodeOf(graph, 'KSampler').inputs.model as [string, number];
  expect(graph[model[0]]).toMatchObject({ class_type: 'LoraLoaderModelOnly', inputs: { strength_model: 0.2 } });
  const previous = graph[model[0]].inputs.model as [string, number];
  expect(graph[previous[0]]).toMatchObject({ class_type: 'LoraLoaderModelOnly', inputs: { strength_model: 0.8 } });
  const again = await t.ok<ImageJob>('POST', jobsUrl(messageId), { again: { jobId: job.id, index: 0, sameSeed: true } });
  expect(again.params).toEqual(job.params);
  expect((await done(messageId, again)).images[0].seed).toBe(123);
});

it('四视图模式必须选图；固定指令追加框中文字，参考图按原内容上传，target_latent 接到采样用的同一份', async () => {
  const imageId = await t.addImage(canvasId, '#123456');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId], image: { ...kreaDefaults('four-view'), width: 768, height: 512 } });
  const messageId = await frame('Keep the red jacket and use a plain background.');
  expect((await t.call('POST', jobsUrl(messageId), { promptIndex: 0 })).body.error).toBe('四视图还没选参考图');
  await t.ok('PATCH', nodeUrl(), { image: { krea: { mode: 'four-view', reference: { kind: 'slot', imageId }, refBoost: 4, extra: '' } } });
  const job = await t.ok<ImageJob>('POST', jobsUrl(messageId), { promptIndex: 0 });
  expect(job.kind).toBe('four-view');
  expect(job.params.positive).toBe(`${FOUR_VIEW_INSTRUCTION}\n\nKeep the red jacket and use a plain background.`);
  await done(messageId, job);
  const graph = await lastGraph();
  expect(nodeOf(graph, 'Krea2EditModelPatch').inputs.target_latent).toEqual(nodeOf(graph, 'KSampler').inputs.latent_image);
  expect(nodeOf(graph, 'Krea2EditModelPatch').inputs.ref_boost).toBe(4);
  expect(nodeOf(graph, 'LoadImage').inputs.image).toBeTruthy();
  expect(nodeOf(graph, 'EmptySD3LatentImage').inputs).toMatchObject({ width: 768, height: 512 });
  const detail = await t.ok<{ images: Record<string, { sha256: string; ext: string }> }>('GET', `/canvases/${canvasId}`);
  const record = detail.images[imageId];
  const bytes = await fs.readFile(path.join(t.work, 'canvases', canvasId, 'images', `${record.sha256}.${record.ext}`));
  const uploads = (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string; bytes: number; sha256: string }[];
  expect(uploads).toEqual([{ name: nodeOf(graph, 'LoadImage').inputs.image, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]);
});

it('编辑档：放一张参考图写一句话就出图，走作者那套 Ostris；没选图拦住', async () => {
  const imageId = await t.addImage(canvasId, '#654321');
  const edit = kreaDefaults('edit');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId], image: { ...edit, width: 768, height: 512 } });
  const messageId = await frame('把外套换成红色皮衣。');
  expect((await t.call('POST', jobsUrl(messageId), { promptIndex: 0 })).body.error).toBe('编辑还没选参考图');
  await t.ok('PATCH', nodeUrl(), { image: { krea: { ...edit.krea!, reference: { kind: 'slot', imageId } } } });
  const job = await t.ok<ImageJob>('POST', jobsUrl(messageId), { promptIndex: 0 });
  expect(job.kind).toBe('edit');
  expect(job.params).toMatchObject({
    family: 'Krea2',
    positive: 'transform the image to realistic photograph\n\n把外套换成红色皮衣。',
    negative: '',
    checkpoint: 'krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors',
    textEncoder: 'qwen3vl_4b_uncensored_int8_convrot.safetensors',
    steps: 10,
    cfg: 1,
    loras: [{ name: 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', strength: 1 }],
    krea: { mode: 'edit' },
  });
  await done(messageId, job);
  const graph = await lastGraph();
  expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs).toMatchObject({ lora_name: 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', strength_model: 1 });
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch').inputs).toMatchObject({ kv_cache: true });
  // 编辑档不看面板上的宽高：参考图按比例缩到长边 2048，出图尺寸跟着它走
  expect(nodeOf(graph, 'LayerUtility: ImageScaleByAspectRatio V2').inputs).toMatchObject({ scale_to_side: 'longest', scale_to_length: 2048, round_to_multiple: '16', fit: 'crop' });
  // 出图尺寸不是面板上那个，是缩放后参考图的宽高（GetImageSize 的两个输出）
  const sizeId = Object.entries(graph).find(([, n]) => n.class_type === 'GetImageSize')![0];
  expect(nodeOf(graph, 'EmptySD3LatentImage').inputs).toMatchObject({ width: [sizeId, 0], height: [sizeId, 1] });
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).toBe('transform the image to realistic photograph\n\n把外套换成红色皮衣。');
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).not.toContain(FOUR_VIEW_INSTRUCTION);
  expect(nodeOf(graph, 'Krea2EditModelPatch')).toBeUndefined();
  expect(nodeOf(graph, 'LoadImage').inputs.image).toBeTruthy();
});

it('双图：图 1 是场景、图 2 是主体，两张都传上去，编码节点两路都接', async () => {
  const sceneId = await t.addImage(canvasId, '#101010');
  const subjectId = await t.addImage(canvasId, '#f0f0f0');
  const edit = kreaDefaults('edit');
  await t.ok('PATCH', nodeUrl(), {
    slots: [sceneId, subjectId],
    image: {
      ...edit,
      krea: { ...edit.krea!, reference: { kind: 'slot', imageId: sceneId }, referenceB: { kind: 'slot', imageId: subjectId }, refBoost: 2, refBoostA: 1.5 },
    },
  });
  const messageId = await frame('把图 2 的人放进图 1 的场景里，姿势不变。');
  const job = await t.ok<ImageJob>('POST', jobsUrl(messageId), { promptIndex: 0 });
  expect(job.params.krea).toMatchObject({
    mode: 'edit',
    reference: { kind: 'slot', imageId: sceneId },
    referenceB: { kind: 'slot', imageId: subjectId },
  });
  await done(messageId, job);
  const graph = await lastGraph();
  const encodes = Object.values(graph).filter((n) => n.class_type === 'TextEncodeKrea2OstrisEdit');
  expect(encodes).toHaveLength(2);
  for (const node of encodes) {
    expect(node.inputs.image1).toBeTruthy();
    expect(node.inputs.image2).toBeTruthy();
  }
  // 两张图都传上去了，顺序是场景在前、主体在后，内容各按自己算名字
  const names = Object.values(graph)
    .filter((n) => n.class_type === 'LoadImage')
    .map((n) => n.inputs.image);
  expect(names).toHaveLength(2);
  const detail = await t.ok<{ images: Record<string, { sha256: string; ext: string }> }>('GET', `/canvases/${canvasId}`);
  const sha = async (id: string) => {
    const record = detail.images[id];
    return createHash('sha256')
      .update(await fs.readFile(path.join(t.work, 'canvases', canvasId, 'images', `${record.sha256}.${record.ext}`)))
      .digest('hex');
  };
  const uploads = (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string; sha256: string }[];
  expect(uploads.map((u) => u.name)).toEqual(names);
  expect(uploads.map((u) => u.sha256)).toEqual([await sha(sceneId), await sha(subjectId)]);
});

it('编辑方案：默认那个（动漫转真人 V3）的触发词自动放在框里那句话前面；手动换 LoRA 就不算方案了', async () => {
  const imageId = await t.addImage(canvasId, '#765432');
  const edit = kreaDefaults('edit');
  await t.ok('PATCH', nodeUrl(), {
    slots: [imageId],
    image: { ...edit, krea: { ...edit.krea!, reference: { kind: 'slot', imageId } } },
  });
  const messageId = await frame('她站在雨夜的站台上，穿深灰大衣。');
  const job = await t.ok<ImageJob>('POST', jobsUrl(messageId), { promptIndex: 0 });
  expect(job.params.positive).toBe(`transform the image to realistic photograph\n\n她站在雨夜的站台上，穿深灰大衣。`);
  expect(job.params.loras).toEqual([{ name: 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', strength: 1 }]);
  await done(messageId, job);
  expect(nodeOf(await lastGraph(), 'TextEncodeKrea2OstrisEdit').inputs.prompt).toContain('transform the image to realistic photograph');

  // 换成不在任何方案里的 LoRA：不加触发词，正面词就是框里那句话
  const other = await frame('把外套换成红色皮衣。');
  await t.ok('PATCH', nodeUrl(), { image: { loras: [{ name: 'krea2/krea2_darkbrush.safetensors', strength: 0.8 }] } });
  const job2 = await t.ok<ImageJob>('POST', jobsUrl(other), { promptIndex: 0 });
  expect(job2.params.positive).toBe('把外套换成红色皮衣。');
});

it('图上做四视图：槽位新建框，已出的图挂回原框；IL 节点也能做，原节点设置不变', async () => {  const imageId = await t.addImage(canvasId, '#345678');
  await t.ok('PATCH', nodeUrl(), { systemPromptName: 'il', slots: [imageId] });
  const before = await t.ok<ChatNode>('GET', nodeUrl());
  const first = await t.ok<{ job: ImageJob; messageId: string }>('POST', `${nodeUrl()}/four-view`, {
    reference: { kind: 'slot', imageId },
    extra: 'Preserve the glasses.',
  });
  expect(first.job.params).toMatchObject({ family: 'Krea2', width: 1536, height: 1024, steps: 10, krea: { mode: 'four-view', refBoost: 1 } });
  await done(first.messageId, first.job);
  const after = await t.ok<ChatNode>('GET', nodeUrl());
  expect(after.image).toEqual(before.image);
  expect(after.systemPromptName).toBe('il');
  expect(after.messages[first.messageId].parsed?.prompts[0].label).toBe('四视图');
  const second = await t.ok<{ job: ImageJob; messageId: string }>('POST', `${nodeUrl()}/four-view`, {
    reference: { kind: 'generated', messageId: first.messageId, jobId: first.job.id, seed: first.job.images[0].seed },
    extra: 'Use a white background.',
  });
  expect(second.messageId).toBe(first.messageId);
  await done(second.messageId, second.job);
  expect(Object.keys((await t.ok<ChatNode>('GET', nodeUrl())).messages)).toHaveLength(1);
});

it('缺少 Krea2Edit 插件时给出安装包名字，一张都不发；非法相似度不保存', async () => {
  const imageId = await t.addImage(canvasId, '#456789');
  await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
  await fetch(`${comfyUrl}/_hide-nodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types: ['Krea2EditModelPatch'] }) });
  const result = await t.ok<{ job: ImageJob; messageId: string }>('POST', `${nodeUrl()}/four-view`, { reference: { kind: 'slot', imageId } });
  await expect.poll(async () => (await t.ok<ChatNode>('GET', nodeUrl())).messages[result.messageId].images![0].images[0].error).toContain('ComfyUI-Krea2Edit');
  expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);
  expect((await t.call('PATCH', nodeUrl(), { image: { krea: { mode: 'four-view', reference: null, refBoost: 20, extra: '' } } })).status).toBe(400);
});

it('Krea2 预设单独保存模型和参数，去掉参考图；框输出用英文段落要求', async () => {
  const imageId = await t.addImage(canvasId, '#567890');
  const settings = {
    ...defaultImageSettings(FAMILY_DEFAULTS.Krea2, 'Krea2'),
    ...kreaDefaults('four-view'),
    krea: { mode: 'four-view', reference: { kind: 'slot', imageId }, refBoost: 4, extra: '' },
  };
  const preset = await t.ok<ImagePreset>('POST', '/image-presets', { name: '四视图', family: 'Krea2', settings });
  expect(preset.settings).toMatchObject({ textEncoder: 'qwen3vl_4b_fp8_scaled.safetensors', krea: { mode: 'four-view', reference: null, refBoost: 4 } });
  const events = await t.stream(`${nodeUrl()}/send`, { parentId: null, text: '写一个' });
  const reply = (events.at(-1) as { message: { parsed: { prompts: { text: string }[] } } }).message;
  expect(reply.parsed.prompts[0].text).toContain('An adult woman');
  expect(reply.parsed.prompts[0].text).not.toContain('1girl');
});
