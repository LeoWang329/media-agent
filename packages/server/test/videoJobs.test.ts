import {
  tempFolderName,
  VIDEO_MODEL,
  type AutodlState,
  type ChatNode,
  type ComfyGraph,
  type MediaRecord,
  type MediaSlot,
  type Message,
  type ModelTransfer,
  type RemoteModels,
  type VideoBoard,
  type VideoJob,
  type VideoJobEvent,
  type VideoOptions,
} from '@media-agent/shared';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockComfy, type MockComfy } from '../../../tools/mock-comfyui/src/app';
import { MOCK_AUTODL_PATH, MOCK_AUTODL_TOKEN, MOCK_AUTODL_UUID, MOCK_AUTODL_VIDEO_UUID } from '../../../tools/mock-comfyui/src/autodl';
import { sleep, startTestApp, type TestApp } from './helpers';

// 生成视频，见 docs/dev-plan.md 5.24 到 5.28：生成视频用的那台 AutoDL、任务的全过程、叫停、出错、再来、删掉、下载、看视频、重启后接着等。
// 用 mock-comfyui 里假的 AutoDL 和 ComfyUI：开机 100 毫秒；长视频每步 5 毫秒，含「慢」的每步 150 毫秒；一「分钟」是 40 毫秒

const MINUTE_MS = 40;
const FIXTURE = new URL('../../../tools/mock-comfyui/fixtures/video.mp4', import.meta.url);

let t: TestApp;
let mock: MockComfy;
let comfyUrl: string;
let canvasId: string;
let nodeId: string;
let replyId: string;

const nodeUrl = () => `/canvases/${canvasId}/nodes/${nodeId}`;
const videosUrl = (messageId = replyId) => `${nodeUrl()}/messages/${messageId}/videos`;

beforeEach(async () => {
  mock = createMockComfy({ stepMs: 15, slowStepMs: 150, videoStepMs: 5, autodl: { bootMs: 100, stopMs: 50 } });
  await new Promise<void>((resolve) => mock.server.listen(0, '127.0.0.1', () => resolve()));
  await new Promise<void>((resolve) => mock.ssh.server.listen(0, '127.0.0.1', () => resolve()));
  comfyUrl = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
  t = await startTestApp({ autodl: { api: `${comfyUrl}${MOCK_AUTODL_PATH}`, pollMs: 20, bootTimeoutMs: 1500, minuteMs: MINUTE_MS } });
  canvasId = (await t.ok('POST', '/canvases', { title: '视频' })).id;
  nodeId = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0 })).id;
  await t.ok('PATCH', nodeUrl(), { duration: 60 });
  replyId = ((await t.stream(`${nodeUrl()}/send`, { parentId: null, text: '写一个' })).at(-1) as { message: Message }).message.id;
});

afterEach(async () => {
  await t.cleanup();
  await mock.close();
});

// 填好 Token、选好生成视频用的那台
async function useVideoAutodl(idleMinutes = 5) {
  await t.ok('PUT', '/config', { autodlToken: MOCK_AUTODL_TOKEN });
  await t.ok('PUT', '/settings', { comfy: { videoAutodl: { instanceUuid: MOCK_AUTODL_VIDEO_UUID, idleMinutes } } });
}

// 框换成这段文字（手动改提示词，生成新版本），返回新版本的 id
async function edited(text: string): Promise<string> {
  const node = await t.ok<ChatNode>('POST', `${nodeUrl()}/messages/${replyId}/edit-prompt`, { promptIndex: 0, text });
  return Object.values(node.messages).find((m) => m.editedFromMessageId === replyId && m.parsed?.prompts[0]?.text === text)!.id;
}

// 接着 parentId 发一句，返回回复的 id
async function send(text: string, parentId: string): Promise<string> {
  return ((await t.stream(`${nodeUrl()}/send`, { parentId, text })).at(-1) as { message: Message }).message.id;
}

// 手动改的框也得分段写：beforeEach 把时长设成 60，一段最长 15 秒，写少了会被拦下来，见 docs/dev-plan.md 5.24
const fourWay = (first: string) => [first, '第二段', '第三段', '第四段'].join('\n|\n');

// 画布里存的那份图在哪、内容的 sha256
async function canvasImageFile(imageId: string): Promise<string> {
  const records = JSON.parse(await fs.readFile(path.join(t.work, 'canvases', canvasId, 'images.json'), 'utf8')) as Record<string, { sha256: string; ext: string }>;
  return path.join(t.work, 'canvases', canvasId, 'images', `${records[imageId].sha256}.${records[imageId].ext}`);
}
const sha256Of = async (imageId: string) => createHash('sha256').update(await fs.readFile(await canvasImageFile(imageId))).digest('hex');

async function readJob(jobId: string, messageId = replyId): Promise<VideoJob | undefined> {
  return (await t.ok<ChatNode>('GET', nodeUrl())).messages[messageId].videos?.find((job) => job.id === jobId);
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等太久了：${JSON.stringify(value)}`);
    await sleep(10);
  }
}

const settled = (job: VideoJob | undefined) => job?.status !== 'queued' && job?.status !== 'running';
const settledJob = async (jobId: string, messageId = replyId, timeoutMs?: number) => (await until(() => readJob(jobId, messageId), settled, timeoutMs))!;
const lastGraph = async () => ((await (await fetch(`${comfyUrl}/_last-prompts`)).json()) as { prompt: ComfyGraph }[]).at(-1)!.prompt;
const ofType = (graph: ComfyGraph, type: string) => Object.values(graph).filter((node) => node.class_type === type);
const from = (graph: ComfyGraph, value: unknown) => graph[String((value as [string, number])[0])];
// 遮罩每一块：保留（0）还是重画（1）、多少帧
const maskRuns = (graph: ComfyGraph) =>
  ofType(graph, 'RepeatImageBatch').map((node) => [from(graph, from(graph, node.inputs.image).inputs.mask).inputs.value, node.inputs.amount]);
// 存档在假的那台上的哪里
const latentFile = (name: string) => mock.ssh.local(`/root/ComfyUI/output/MiniMaxH3/latent_checkpoints/${name}`);
const exists = (file: string) => fs.stat(file).then(() => true, () => false);

// 测试用的小视频、小音频复制进工作文件夹再放进画布，返回记录
async function addMedia(name: string, meta: Record<string, unknown>): Promise<MediaRecord> {
  const file = path.join(t.work, 'test-media', name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.copyFile(new URL(`../../../tests/fixtures/media/${name}`, import.meta.url), file);
  return t.ok<MediaRecord>('POST', `/canvases/${canvasId}/media`, { path: file, ...meta });
}
const fileSha = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const uploadedName = async (sha: string) => ((await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string; sha256: string }[]).find((u) => u.sha256 === sha)?.name;

// 收 /video-jobs/events 推来的事件
async function watch() {
  const controller = new AbortController();
  const res = await fetch(`${t.base}/video-jobs/events`, { signal: controller.signal });
  const events: VideoJobEvent[] = [];
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop()!;
        for (const block of blocks) if (block.startsWith('data: ')) events.push(JSON.parse(block.slice(6)));
      }
    } catch {
      // 测试结束时断开
    }
  })();
  return { events, close: () => controller.abort() };
}

describe('生成视频用的那台 AutoDL', () => {
  it('另外选一台，存 comfy.videoAutodl；和出图那台选同一个返回 400；没选时状态是还没设置', async () => {
    await t.ok('PUT', '/config', { autodlToken: MOCK_AUTODL_TOKEN });
    expect(await t.ok<AutodlState>('GET', '/comfy/video/status')).toMatchObject({ state: 'unset' });
    await t.ok('PUT', '/settings', { comfy: { autodl: { instanceUuid: MOCK_AUTODL_UUID } } });
    const same = await t.call('PUT', '/settings', { comfy: { videoAutodl: { instanceUuid: MOCK_AUTODL_UUID } } });
    expect(same).toMatchObject({ status: 400, body: { error: '出图和生成视频不能用同一台 AutoDL 实例' } });

    const saved = await t.ok('PUT', '/settings', { comfy: { videoAutodl: { instanceUuid: MOCK_AUTODL_VIDEO_UUID, idleMinutes: 30 } } });
    expect(saved.comfy).toEqual({
      lanUrl: null,
      autodl: { instanceUuid: MOCK_AUTODL_UUID, idleMinutes: 15 },
      videoAutodl: { instanceUuid: MOCK_AUTODL_VIDEO_UUID, idleMinutes: 30 },
    });
    expect(await t.ok<AutodlState>('GET', '/comfy/video/status')).toMatchObject({ state: 'off', idleMinutes: 30, instance: { name: 'H3-测试' } });
    expect(await t.ok<AutodlState>('GET', '/comfy/status?target=autodl')).toMatchObject({ state: 'off', idleMinutes: 15, instance: { name: 'ComfyUI-测试' } });
    expect((await t.call('POST', '/comfy/video/power', {})).status).toBe(400);
  });
});

describe('生成视频任务', () => {
  it('时长 60 秒的回复分 4 段；生成时自动开机，推各步进度，出完 mp4 存进 video-temp/当天/；出图那台不动；空闲到点关机', async () => {
    const user = Object.values((await t.ok<ChatNode>('GET', nodeUrl())).messages).find((m) => m.role === 'user')!;
    expect(user.systemNote).toContain('视频时长 60 秒，分 4 段生成，每段约 15 秒');
    await useVideoAutodl();
    const watching = await watch();

    const job = await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 });
    expect(job).toMatchObject({ promptIndex: 0, status: 'queued', params: { seconds: 60, aspectRatio: '16:9', width: 864, height: 480, finalWidth: 1728, finalHeight: 960 } });
    expect(job.params.segments).toHaveLength(4);
    expect(job.params.segments[1]).toContain('第 2 段');
    const done = await settledJob(job.id);
    watching.close();

    expect(done).toMatchObject({ status: 'done', bytes: (await fs.stat(FIXTURE)).size, ms: expect.any(Number) });
    expect(done.file).toMatch(new RegExp(`^video-temp/${tempFolderName(new Date())}/\\d{6}-${job.seed}\\.mp4$`));
    expect(await fs.readFile(path.join(t.work, done.file!))).toEqual(await fs.readFile(FIXTURE));

    const graph = await lastGraph();
    expect(ofType(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ width: 864, height: 480, length: 1382 });
    expect(String(ofType(graph, 'MMH3ReferenceMultiPrompt')[0].inputs.prompts).split('\n|\n')).toHaveLength(4);
    expect(ofType(graph, 'MMH3LoopingSampler').map((node) => node.inputs.chunk_frames)).toEqual([362, 362]);
    expect(ofType(graph, 'RandomNoise')[0].inputs.noise_seed).toBe(job.seed);

    // 先开机，再走编码、一采第 1 到 4 段、放大、二采、存文件
    const progress = watching.events.flatMap((event) => (event.type === 'progress' && event.jobId === job.id ? [event] : []));
    const stages = progress.map((event) => event.stage).filter((stage, i, all) => stage !== all[i - 1]);
    expect(stages).toEqual(['encode', 'pass1', 'upscale', 'pass2', 'save']);
    expect(progress.filter((event) => event.stage === 'pass1' && event.step === 10).map((event) => event.chunk)).toEqual([1, 2, 3, 4]);
    expect(progress.filter((event) => event.stage === 'pass2' && event.step > 0).at(-1)).toMatchObject({ chunk: 4, chunks: 4, step: 3, steps: 3 });
    const autodl = watching.events.flatMap((event) => (event.type === 'autodl' ? [event.state] : []));
    expect(autodl).toContain('booting');
    expect(autodl).toContain('running');
    expect(mock.autodl.calls).toEqual([{ action: 'power_on', body: { instance_uuid: MOCK_AUTODL_VIDEO_UUID, payload: 'gpu' } }]);
    expect(mock.autodl.instance.status).toBe('shutdown');

    // 空闲 5「分钟」后关机
    await until(async () => mock.autodl.instances[MOCK_AUTODL_VIDEO_UUID].status, (status) => status === 'shutdown', 3000);
    expect(mock.autodl.calls.map((call) => call.action)).toEqual(['power_on', 'power_off']);
  });

  it('不能生成的：没选那台、框分了 5 段、首尾帧和尾帧写的、生图节点', async () => {
    const none = await t.call('POST', videosUrl(), { promptIndex: 0 });
    expect(none).toMatchObject({ status: 400, body: { error: '先在设置里填 AutoDL 的开发者 Token、选好生成视频用的实例' } });
    await useVideoAutodl();
    const five = await edited(['一', '二', '三', '四', '五'].join('\n|\n'));
    expect(await t.call('POST', videosUrl(five), { promptIndex: 0 })).toMatchObject({ status: 400, body: { error: '这个框分了 5 段，最多 4 段' } });

    // 时长 60 秒要 4 段，框里只写了 1 段：拦下来，别白跑一趟，见 docs/dev-plan.md 5.24
    await t.ok('PATCH', nodeUrl(), { duration: 60 });
    const oneSegment = await edited('就一段，没有分隔线');
    const short = await t.call('POST', videosUrl(oneSegment), { promptIndex: 0 });
    expect(short).toMatchObject({ status: 400 });
    expect(short.body.error).toBe('时长 60 秒至少要分 4 段（一段最长 15 秒），这个框里只写了 1 段，这样出来只有 15.1 秒。让模型照 60 秒重写这个框，或者把时长改成 15 秒');
    await t.ok('PATCH', nodeUrl(), { duration: 8 });
    expect((await t.call('POST', videosUrl(), { promptIndex: 3 })).status).toBe(404);

    for (const prompt of ['fl2va', 'l2va']) {
      await t.ok('PATCH', nodeUrl(), { systemPromptName: prompt });
      const reply = await send('再写一个', replyId);
      const refused = await t.call('POST', videosUrl(reply), { promptIndex: 0 });
      expect(refused).toMatchObject({ status: 400, body: { error: '首尾帧、尾帧这两种提示词写的还不能生成视频，现在支持参考模式、图当首帧和纯文字' } });
    }

    await t.ok('PUT', '/prompts/il', { text: '---\n用途: 生图\n底模: IL\n---\n只写标签' });
    const imageNode = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0, kind: 'image' })).id;
    const tags = ((await t.stream(`/canvases/${canvasId}/nodes/${imageNode}/send`, { parentId: null, text: '写一个' })).at(-1) as { message: Message }).message.id;
    const refused = await t.call('POST', `/canvases/${canvasId}/nodes/${imageNode}/messages/${tags}/videos`, { promptIndex: 0 });
    expect(refused).toMatchObject({ status: 400, body: { error: '生图节点不能生成视频' } });
    expect(mock.autodl.calls).toEqual([]);
  });

  it('参考模式写的：槽位的图都传上去，按 <Picture N> 的顺序接成一串进编码提示词，每段都带；首帧不钉', async () => {
    await useVideoAutodl();
    const images = [await t.addImage(canvasId, '#336699'), await t.addImage(canvasId, '#993366'), await t.addImage(canvasId, '#669933')];
    await t.ok('PATCH', nodeUrl(), { slots: images, duration: 30 });
    const reply = await send('照这三张图写', replyId);
    const job = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    expect(job.params).toMatchObject({ refs: images, aspectRatio: '16:9', width: 864, height: 480 });
    expect(job.params.firstFrame).toBeUndefined();
    expect(await settledJob(job.id, reply)).toMatchObject({ status: 'done' });

    const graph = await lastGraph();
    const uploads = (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string; sha256: string }[];
    const hashes = await Promise.all(images.map(sha256Of));
    const names = hashes.map((hash) => uploads.find((u) => u.sha256 === hash)?.name);
    expect(names.every(Boolean)).toBe(true);
    // 30 号起三个 LoadImage，40、41 号把它们接成一串，编码提示词接最后一个
    expect([30, 31, 32].map((id) => graph[id].inputs.image)).toEqual(names);
    expect(graph[40].inputs).toEqual({ image1: ['30', 0], image2: ['31', 0] });
    expect(graph[41].inputs).toEqual({ image1: ['40', 0], image2: ['32', 0] });
    expect(ofType(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ ref_images: ['41', 0], ref_image_size: 'match' });
    expect(ofType(graph, 'MMH3LoopingSampler').map((node) => node.inputs.keyframes)).toEqual([undefined, undefined]);
  });

  it('图当首帧写的：只带第一张，钉在一采第 0 帧，也当 <Picture 1>；比例自动的按这张图；纯文字写的不带图', async () => {
    await useVideoAutodl();
    const tall = await t.addImage(canvasId, '#336699', 600, 900);
    const other = await t.addImage(canvasId, '#993366');
    await t.ok('PATCH', nodeUrl(), { systemPromptName: 'i2v', slots: [tall, other], aspectRatio: 'auto', duration: 15 });
    const reply = await send('从这张图开始', replyId);
    const job = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    // 2:3 的图、0.4 百万像素是 544×800，放大 2 倍出 1088×1600
    expect(job.params).toMatchObject({ refs: [tall], firstFrame: tall, aspectRatio: 'image', width: 544, height: 800, finalWidth: 1088, finalHeight: 1600 });
    await settledJob(job.id, reply);
    const graph = await lastGraph();
    expect(ofType(graph, 'LoadImage')).toHaveLength(1);
    const [pass1, pass2] = ofType(graph, 'MMH3LoopingSampler');
    expect(pass1.inputs).toMatchObject({ keyframes: ['30', 0], keyframe_indices: '0' });
    expect(pass2.inputs.keyframes).toBeUndefined();
    expect(ofType(graph, 'MMH3ReferenceMultiPrompt')[0].inputs.ref_images).toEqual(['30', 0]);

    // 比例选了固定的就照选的，图会被拉成这个比例
    await t.ok('PATCH', nodeUrl(), { aspectRatio: '16:9' });
    const fixed = await send('换成横屏', reply);
    expect((await t.ok<VideoJob>('POST', videosUrl(fixed), { promptIndex: 0 })).params).toMatchObject({ aspectRatio: '16:9', width: 864, height: 480 });

    await t.ok('PATCH', nodeUrl(), { systemPromptName: 't2v' });
    const text = await send('不用图了', fixed);
    const plain = await t.ok<VideoJob>('POST', videosUrl(text), { promptIndex: 0 });
    expect(plain.params.refs).toBeUndefined();
    expect(plain.params.firstFrame).toBeUndefined();
    await settledJob(plain.id, text);
    expect(ofType(await lastGraph(), 'LoadImage')).toEqual([]);
  });

  it('传图前发现画布里存的那份没了：这条没生成，说是第几张', async () => {
    await useVideoAutodl();
    const image = await t.addImage(canvasId, '#336699');
    await t.ok('PATCH', nodeUrl(), { slots: [image] });
    const reply = await send('照这张图写', replyId);
    await fs.rm(await canvasImageFile(image));
    const job = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    expect(await settledJob(job.id, reply)).toMatchObject({ status: 'failed', error: '第 1 张参考图找不到了：画布里存的那份被删掉了' });
  });

  it('那台 ComfyUI 缺 MMH3 节点：不发，说要装哪个插件', async () => {
    await useVideoAutodl();
    await fetch(`${comfyUrl}/_hide-nodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types: ['MMH3LoopingSampler'] }) });
    const job = await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 });
    const failed = await settledJob(job.id);
    expect(failed).toMatchObject({ status: 'failed', error: '这台 ComfyUI 缺插件：object_info 里没有 MMH3LoopingSampler，要装 ComfyUI-MMH3Tools' });
    expect(await (await fetch(`${comfyUrl}/_last-prompts`)).json()).toEqual([]);
  });

  it('开机时那台主机没有空闲的显卡：这条没生成，提示把生成视频用的实例换成另一台', async () => {
    await useVideoAutodl();
    mock.autodl.fail.power_on = { code: 'GpuNotEnough', msg: '主机GPU不足' };
    const job = await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 });
    const failed = await until(() => readJob(job.id), (j) => j?.status === 'failed');
    const said = '这台所在的主机没有空闲的显卡，AutoDL 返回「主机GPU不足」（GpuNotEnough）。去设置里把「生成视频用的实例」换成另一台，也可以过一会再开';
    expect(failed!.error).toBe(`AutoDL 开机失败：${said}`);
    expect(await t.ok('GET', '/comfy/video/status')).toMatchObject({ state: 'failed', error: said });
  });

  it('叫停：在 ComfyUI 排队的直接停，正在跑的等 ComfyUI 说停了；出错的写原因', async () => {
    await useVideoAutodl();
    const slowId = await edited(fourWay('慢慢地走'));
    const running = await t.ok<VideoJob>('POST', videosUrl(slowId), { promptIndex: 0 });
    await until(() => readJob(running.id, slowId), (job) => job?.status === 'running');
    const waiting = await t.ok<VideoJob>('POST', videosUrl(slowId), { promptIndex: 0 });
    await until(() => readJob(waiting.id, slowId), (job) => Boolean(job?.promptId));

    expect(await t.ok<VideoJob>('POST', `${videosUrl(slowId)}/${waiting.id}/stop`)).toMatchObject({ status: 'stopped' });
    expect(await t.ok<VideoJob>('POST', `${videosUrl(slowId)}/${running.id}/stop`)).toMatchObject({ status: 'running' });
    expect(await settledJob(running.id, slowId)).toMatchObject({ status: 'stopped' });

    const brokenId = await edited(fourWay('报错'));
    const broken = await t.ok<VideoJob>('POST', videosUrl(brokenId), { promptIndex: 0 });
    expect(await settledJob(broken.id, brokenId)).toMatchObject({ status: 'failed', error: '生成视频出错（MMH3LoopingSampler）：mock-comfyui：提示词含「报错」，按约定出错' });
    const memoryId = await edited(fourWay('显存'));
    const memory = await t.ok<VideoJob>('POST', videosUrl(memoryId), { promptIndex: 0 });
    expect(await settledJob(memory.id, memoryId)).toMatchObject({ status: 'failed', error: '显存不够：CUDA out of memory. Tried to allocate 20.00 GiB' });
  });

  it('一采出完先出一版低清预览（二采还在跑），叫停时这一版转正成结果，能播能下载', async () => {
    await useVideoAutodl();
    const slowId = await edited(fourWay('慢慢地走'));
    const job = await t.ok<VideoJob>('POST', videosUrl(slowId), { promptIndex: 0 });

    // 一采跑完、二采还在跑：预览有了，成片还没
    const withPreview = (await until(() => readJob(job.id, slowId), (current) => Boolean(current?.preview) && current?.status === 'running', 30_000))!;
    expect(withPreview.file).toBeUndefined();
    expect(withPreview.partial).toBeUndefined();
    expect(withPreview.preview).toMatch(/^video-temp\/\d{4}-\d{2}-\d{2}\/\d{6}-\d+-preview\.mp4$/);
    // 文件真在临时文件夹里，能播
    expect((await fs.stat(path.join(t.work, withPreview.preview!))).isFile()).toBe(true);
    const preview = await fetch(`${t.base}${videosUrl(slowId)}/${job.id}/preview`);
    expect(preview.status).toBe(200);
    expect(Number(preview.headers.get('content-length'))).toBeGreaterThan(0);

    // 二采途中叫停：这一版留下当结果
    await t.ok('POST', `${videosUrl(slowId)}/${job.id}/stop`);
    const stopped = await settledJob(job.id, slowId, 30_000);
    expect(stopped).toMatchObject({ status: 'stopped', partial: true, file: withPreview.preview });
    // 转正以后 /file 认了，下载也照样能用
    expect((await fetch(`${t.base}${videosUrl(slowId)}/${job.id}/file`)).status).toBe(200);
    const folder = path.join(t.work, 'downloads');
    await fs.mkdir(folder, { recursive: true });
    const item = { canvasId, nodeId, messageId: slowId, jobId: job.id };
    expect(await t.ok('POST', '/videos/download', { item, folder })).toEqual({ path: path.join(folder, `测试标题-${job.seed}.mp4`) });
  }, 90_000);

  it('同样参数再来用同一个种子，只换种子再来换一个；删掉：临时文件直接删，下载过的那份不动；没出完的不让删', async () => {
    await useVideoAutodl();
    await t.ok('PATCH', nodeUrl(), { video: { megapixels: 0.3, upscale: 2, seed: 77 } });
    const first = await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 });
    expect(first).toMatchObject({ seed: 77, params: { width: 736, height: 416, finalWidth: 1472, finalHeight: 832 } });
    await settledJob(first.id);

    const same = await t.ok<VideoJob>('POST', videosUrl(), { again: { jobId: first.id, sameSeed: true } });
    expect(same).toMatchObject({ seed: 77, source: { jobId: first.id }, params: first.params });
    const other = await t.ok<VideoJob>('POST', videosUrl(), { again: { jobId: first.id, sameSeed: false } });
    expect(other.seed).not.toBe(77);
    expect(other.params).toEqual(first.params);
    await settledJob(same.id);
    await settledJob(other.id);
    expect((await t.ok<ChatNode>('GET', nodeUrl())).messages[replyId].videos!.map((job) => job.id)).toEqual([first.id, same.id, other.id]);

    const done = (await readJob(first.id))!;
    const folder = path.join(t.work, 'downloads');
    await fs.mkdir(folder);
    const item = { canvasId, nodeId, messageId: replyId, jobId: first.id };
    expect(await t.ok('POST', '/videos/download', { item, folder })).toEqual({ path: path.join(folder, '测试标题-77.mp4') });
    expect(await t.ok('POST', '/videos/download', { item, folder })).toEqual({ path: path.join(folder, '测试标题-77-2.mp4') });
    expect((await readJob(first.id))!.savedPath).toBe(path.join(folder, '测试标题-77-2.mp4'));

    expect((await t.call('DELETE', `${videosUrl()}/${first.id}`)).status).toBe(204);
    await expect(fs.stat(path.join(t.work, done.file!))).rejects.toThrow();
    expect((await fs.stat(path.join(folder, '测试标题-77.mp4'))).isFile()).toBe(true);
    expect((await readJob(first.id))).toBeUndefined();

    const slowId = await edited(fourWay('慢慢地走'));
    const slow = await t.ok<VideoJob>('POST', videosUrl(slowId), { promptIndex: 0 });
    expect((await t.call('DELETE', `${videosUrl(slowId)}/${slow.id}`)).status).toBe(409);
    await t.ok('POST', `${videosUrl(slowId)}/${slow.id}/stop`);
    await settledJob(slow.id, slowId);
  });

  it('看视频：带 Range 的回 206；临时文件清掉了用下载的那份，都没了是已清理', async () => {
    await useVideoAutodl();
    const job = await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 });
    const done = await settledJob(job.id);
    const fileUrl = `${t.base}${videosUrl()}/${job.id}/file`;
    const part = await fetch(fileUrl, { headers: { Range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-type')).toBe('video/mp4');
    expect((await part.arrayBuffer()).byteLength).toBe(100);

    const folder = path.join(t.work, 'downloads');
    await fs.mkdir(folder);
    const { path: saved } = await t.ok('POST', '/videos/download', { item: { canvasId, nodeId, messageId: replyId, jobId: job.id }, folder });
    await fs.rm(path.join(t.work, done.file!));
    expect((await fetch(fileUrl)).status).toBe(200);
    await fs.rm(saved);
    const gone = await fetch(fileUrl);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: '这条视频已经清理掉了' });
  });

  it('服务重启后：还在跑的接着等，出完照样取回来；还没发出去的标失败', async () => {
    await useVideoAutodl();
    const slowId = await edited(fourWay('慢慢地走'));
    const job = await t.ok<VideoJob>('POST', videosUrl(slowId), { promptIndex: 0 });
    await until(() => readJob(job.id, slowId), (current) => current?.status === 'running');
    await t.restart();

    // 再塞一条还没发出去的
    const file = path.join(t.work, 'canvases', canvasId, 'nodes', `${nodeId}.json`);
    const node = JSON.parse(await fs.readFile(file, 'utf8')) as ChatNode;
    node.messages[slowId].videos!.push({ ...job, id: 'lost-job', status: 'queued' });
    await fs.writeFile(file, JSON.stringify(node));

    await t.videoJobs().resume();
    // 含「慢」的四段要跑一阵，等久一点
    expect(await settledJob(job.id, slowId, 30_000)).toMatchObject({ status: 'done', file: expect.stringMatching(/\.mp4$/) });
    expect(await readJob('lost-job', slowId)).toMatchObject({ status: 'failed', error: '程序重启时这条还没出完' });
  }, 45_000);

  it('视频任务小窗：所有画布在做的、排着的按先后，完了的新的在前；出完记下各步用时，同样大小的只留 5 条', async () => {
    await useVideoAutodl();
    const otherCanvas = (await t.ok('POST', '/canvases', { title: '另一个画布' })).id;
    const otherNode = (await t.ok('POST', `/canvases/${otherCanvas}/nodes`, { x: 0, y: 0 })).id;
    const otherReply = ((await t.stream(`/canvases/${otherCanvas}/nodes/${otherNode}/send`, { parentId: null, text: '写一个' })).at(-1) as { message: Message }).message.id;

    const slowId = await edited(fourWay('慢慢地走'));
    const running = await t.ok<VideoJob>('POST', videosUrl(slowId), { promptIndex: 0 });
    await until(() => readJob(running.id, slowId), (job) => job?.status === 'running');
    const waiting = await t.ok<VideoJob>('POST', `/canvases/${otherCanvas}/nodes/${otherNode}/messages/${otherReply}/videos`, { promptIndex: 0 });
    await until(
      () => t.ok<VideoBoard>('GET', '/video-jobs'),
      (board) => board.live.length === 2,
    );
    const board = await t.ok<VideoBoard>('GET', '/video-jobs');
    expect(board.live.map((task) => [task.canvasTitle, task.nodeTitle, task.job.id])).toEqual([
      ['视频', '测试标题', running.id],
      ['另一个画布', '测试标题', waiting.id],
    ]);
    expect(board.done).toEqual([]);
    expect(board.timings).toEqual([]);

    await t.ok('POST', `/canvases/${otherCanvas}/nodes/${otherNode}/messages/${otherReply}/videos/${waiting.id}/stop`);
    // 含「慢」的四段要跑一阵，等久一点
    await settledJob(running.id, slowId, 30_000);
    const after = await t.ok<VideoBoard>('GET', '/video-jobs');
    expect(after.live).toEqual([]);
    expect(after.done.map((task) => [task.job.id, task.job.status])).toEqual([
      [running.id, 'done'],
      [waiting.id, 'stopped'],
    ]);
    expect(after.timings).toEqual([
      expect.objectContaining({ finalWidth: 1728, finalHeight: 960, segments: 4, encodeMs: expect.any(Number), pass1StepMs: expect.any(Number), saveMs: expect.any(Number) }),
    ]);
    expect(JSON.parse(await fs.readFile(path.join(t.work, 'video-timings.json'), 'utf8'))).toEqual(after.timings);

    // 删掉的不列
    await t.call('DELETE', `${videosUrl(slowId)}/${running.id}`);
    expect((await t.ok<VideoBoard>('GET', '/video-jobs')).done.map((task) => task.job.id)).toEqual([waiting.id]);
  }, 45_000);

  it('重拍一截：出片时存下一采、二采；只切这一截所在的窗，按遮罩重画，再拼回整条；出完是原片的一个版本', async () => {
    await useVideoAutodl();
    await t.ok('PATCH', nodeUrl(), { duration: 30 });
    const reply = await send('写一个 30 秒的', replyId);
    const orig = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    const done = await settledJob(orig.id, reply);
    expect(done.latents).toEqual({
      pass1: expect.stringMatching(new RegExp(`^media_agent_${orig.id}_pass1_[0-9a-f]{12}\\.h3latent\\.safetensors$`)),
      pass2: expect.stringMatching(new RegExp(`^media_agent_${orig.id}_pass2_[0-9a-f]{12}\\.h3latent\\.safetensors$`)),
      instance: MOCK_AUTODL_VIDEO_UUID,
    });
    expect(ofType(await lastGraph(), 'MiniMaxH3NativeLatentCheckpointSaveT8Advanced').map((node) => node.inputs.filename_prefix)).toEqual([`media_agent_${orig.id}_pass1`, `media_agent_${orig.id}_pass2`]);
    expect(await exists(latentFile(done.latents!.pass1))).toBe(true);

    // 第 8 到 11 秒，在第 1 段；第 1 段的提示词改了
    const redo = await t.ok<VideoJob>('POST', videosUrl(reply), { reshoot: { jobId: orig.id, from: 192, to: 264, seed: 9, prompts: { 0: '第一段改过', 1: '不在这一截里的不改' } } });
    expect(redo).toMatchObject({ parent: orig.id, reshoot: { base: orig.id, from: 192, to: 264 }, seed: 9 });
    expect(redo.params.segments).toEqual(['第一段改过', done.params.segments[1]]);
    const redone = await settledJob(redo.id, reply);
    expect(redone).toMatchObject({ status: 'done', latents: { pass1: expect.stringContaining(redo.id) } });

    let graph = await lastGraph();
    expect(ofType(graph, 'MiniMaxH3NativeLatentCheckpointLoadT8Advanced').map((node) => node.inputs.checkpoint_path)).toEqual([done.latents!.pass1, done.latents!.pass2]);
    // 两段 30 秒一共 207 个潜空间帧，只切第 1 窗（第 0 到 106 个）
    const trims = ofType(graph, 'MMH3TrimAV').map((node) => [node.inputs.trim_head_latents, node.inputs.trim_tail_latents]);
    expect(trims.slice(0, 2)).toEqual([
      [0, 100],
      [0, 100],
    ]);
    expect(maskRuns(graph)).toEqual([
      [0, 192],
      [1, 72],
      [0, 98],
    ]);
    expect(ofType(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ prompts: '第一段改过', length: 362 });
    expect(ofType(graph, 'LatentCut')[0].inputs).toMatchObject({ dim: 't', index: 57, amount: 21 });
    // 后面从第 2 窗开头接上，去掉重叠的 7 个
    expect(ofType(graph, 'MMH3ConcatAV').map((node) => [from(graph, node.inputs.latent_b).inputs.trim_head_latents, node.inputs.trim_b_latents])).toEqual([
      [100, 7],
      [100, 7],
    ]);

    // 在重拍出的这一版上再选一截，在第 2 段：读回的是这一版的存档，前面从存档接上
    const again = await t.ok<VideoJob>('POST', videosUrl(reply), { reshoot: { jobId: redo.id, from: 480, to: 528, seed: null } });
    expect(again).toMatchObject({ parent: orig.id, reshoot: { base: redo.id, from: 481, to: 528 } });
    await settledJob(again.id, reply);
    graph = await lastGraph();
    expect(ofType(graph, 'MiniMaxH3NativeLatentCheckpointLoadT8Advanced').map((node) => node.inputs.checkpoint_path)).toEqual([redone.latents!.pass1, redone.latents!.pass2]);
    expect(ofType(graph, 'MMH3ReferenceMultiPrompt')[0].inputs.prompts).toBe(done.params.segments[1]);
    expect(maskRuns(graph)).toEqual([
      [0, 141],
      [1, 47],
      [0, 174],
    ]);
    expect(ofType(graph, 'MMH3ConcatAV').map((node) => [from(graph, node.inputs.latent_a).inputs.trim_tail_latents, node.inputs.trim_b_latents])).toEqual([
      [100, 7],
      [100, 7],
    ]);

    // 删掉原片：各个版本和那台上的存档都没了
    const files = [done, redone, (await readJob(again.id, reply))!].flatMap((job) => [job.latents!.pass1, job.latents!.pass2]).map(latentFile);
    expect((await t.call('DELETE', `${videosUrl(reply)}/${orig.id}`)).status).toBe(204);
    expect((await t.ok<ChatNode>('GET', nodeUrl())).messages[reply].videos).toEqual([]);
    await until(async () => Promise.all(files.map(exists)), (all) => all.every((there) => !there), 5000);
  }, 20_000);

  it('重拍不了的：没出完、没存档、换了实例；那台上的存档被删了的，这一版没生成出来，说只能整条重出', async () => {
    await useVideoAutodl();
    const job = await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 });
    const reshoot = (jobId: string) => t.call('POST', videosUrl(), { reshoot: { jobId, from: 24, to: 48, seed: null } });
    expect(await reshoot(job.id)).toMatchObject({ status: 400, body: { error: '这条还没出完，出完了才能重拍' } });
    const done = await settledJob(job.id);

    // 那台上的存档被删了
    await fs.rm(latentFile(done.latents!.pass2));
    const lost = await reshoot(job.id);
    expect(lost.status).toBe(201);
    expect(await settledJob(lost.body.id)).toMatchObject({ status: 'failed', error: '那台上没有这条的存档了，只能整条重出' });

    // 没存档的老视频、换了实例的
    const file = path.join(t.work, 'canvases', canvasId, 'nodes', `${nodeId}.json`);
    const node = JSON.parse(await fs.readFile(file, 'utf8')) as ChatNode;
    node.messages[replyId].videos!.push({ ...done, id: 'old-job', latents: undefined }, { ...done, id: 'moved-job', latents: { ...done.latents!, instance: 'pro-other' } });
    await fs.writeFile(file, JSON.stringify(node));
    expect(await reshoot('old-job')).toMatchObject({ status: 400, body: { error: '这条出的时候没存一采、二采的结果，只能整条重出' } });
    expect(await reshoot('moved-job')).toMatchObject({ status: 400, body: { error: '那台上没有这条的存档了，只能整条重出' } });
  });

  it('删视频时那台关着：存档记下来，下次开机删', async () => {
    await useVideoAutodl();
    const job = await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 });
    const done = await settledJob(job.id);
    await t.ok('POST', '/comfy/video/power', { on: false });
    await until(() => t.ok<AutodlState>('GET', '/comfy/video/status'), (state) => state.state === 'off', 3000);
    expect((await t.call('DELETE', `${videosUrl()}/${job.id}`)).status).toBe(204);
    const trash = path.join(t.work, 'video-latents-trash.json');
    await until(() => exists(trash), Boolean, 3000);
    expect(JSON.parse(await fs.readFile(trash, 'utf8'))).toEqual([{ instance: MOCK_AUTODL_VIDEO_UUID, files: [done.latents!.pass1, done.latents!.pass2] }]);
    expect(await exists(latentFile(done.latents!.pass1))).toBe(true);

    await t.ok('POST', '/comfy/video/power', { on: true });
    await until(async () => exists(latentFile(done.latents!.pass1)), (there) => !there, 5000);
    await until(async () => JSON.parse(await fs.readFile(trash, 'utf8')), (left: unknown[]) => left.length === 0, 3000);
  });

  it('主模型和 LoRA：列表从生成视频那台读，主模型只列 minimax/ 下的；换主模型、挂两个 LoRA，接在主模型和注意力节点之间', async () => {
    await useVideoAutodl();
    expect(await t.call('GET', '/comfy/video/options')).toMatchObject({ status: 400, body: { error: '生成视频那台关着，开机后才读得到主模型和 LoRA' } });
    await t.ok('POST', '/comfy/video/power', { on: true });
    await until(() => t.ok<AutodlState>('GET', '/comfy/video/status'), (state) => state.state === 'running', 3000);
    const options = await t.ok<VideoOptions>('GET', '/comfy/video/options');
    expect(options.models).toEqual([VIDEO_MODEL, 'minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors', 'minimax/minimax_h3_ref2va_int8_convrot.safetensors']);
    expect(options.loras).toEqual(['detail-test.safetensors', 'IL/anime-style-test.safetensors', 'IL/detail-tweaker-test.safetensors', 'krea2/krea2_4panel.safetensors', 'krea2/krea2_darkbrush.safetensors', 'krea2/DynamicCharacterSheet_krea2_v1.safetensors']);

    expect(await t.call('PATCH', nodeUrl(), { video: { loras: [{ name: 'detail-test.safetensors' }] } })).toMatchObject({ status: 400, body: { error: 'LoRA 强度格式不对' } });
    const loras = [
      { name: 'detail-test.safetensors', strength: 0.8 },
      { name: 'IL/anime-style-test.safetensors', strength: 0.5 },
    ];
    await t.ok('PATCH', nodeUrl(), { video: { model: options.models[2], loras } });
    const job = await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 });
    expect(job.params).toMatchObject({ model: options.models[2], loras });
    expect(await settledJob(job.id)).toMatchObject({ status: 'done' });
    const graph = await lastGraph();
    expect(ofType(graph, 'UNETLoader')[0].inputs.unet_name).toBe(options.models[2]);
    expect(Object.entries(graph).filter(([, node]) => node.class_type === 'LoraLoaderModelOnly').map(([id, node]) => [id, node.inputs])).toEqual([
      ['70', { model: ['1', 0], lora_name: 'detail-test.safetensors', strength_model: 0.8 }],
      ['71', { model: ['70', 0], lora_name: 'IL/anime-style-test.safetensors', strength_model: 0.5 }],
    ]);
    expect(ofType(graph, 'ModelAttentionBackend')[0].inputs.model).toEqual(['71', 0]);

    // 没挂 LoRA 的：主模型直接接注意力节点
    await t.ok('PATCH', nodeUrl(), { video: { loras: [] } });
    await settledJob((await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 })).id);
    expect(ofType(await lastGraph(), 'LoraLoaderModelOnly')).toEqual([]);
    expect(ofType(await lastGraph(), 'ModelAttentionBackend')[0].inputs.model).toEqual(['1', 0]);
  });

  it('不加速：每段的步数记进参数，一采 20 步、二采 6 步；进度照这个数；同样参数再来照样不加速', async () => {
    await useVideoAutodl();
    expect(await t.call('PATCH', nodeUrl(), { video: { speed: 'slow' } })).toMatchObject({ status: 400, body: { error: '加速还是不加速只能是 fast、full' } });
    await t.ok('PATCH', nodeUrl(), { duration: 15, video: { speed: 'full', model: 'minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors' } });
    const reply = await send('写一个 15 秒的', replyId);
    const steps: string[] = [];
    const stop = t.videoJobs().subscribe((event: VideoJobEvent) => {
      if (event.type === 'progress' && (event.stage === 'pass1' || event.stage === 'pass2') && event.chunk) steps.push(`${event.stage} ${event.step}/${event.steps}`);
    });
    const job = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    expect(job.params).toMatchObject({ model: 'minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors', steps: { pass1: 20, pass2: 6 } });
    await settledJob(job.id, reply);
    stop();
    expect(ofType(await lastGraph(), 'BasicScheduler').map((node) => node.inputs.steps)).toEqual([20, 6]);
    expect(steps).toContain('pass1 20/20');
    expect(steps).toContain('pass2 6/6');
    const again = await t.ok<VideoJob>('POST', videosUrl(reply), { again: { jobId: job.id, sameSeed: true } });
    expect(again.params.steps).toEqual({ pass1: 20, pass2: 6 });
    await settledJob(again.id, reply);
  });

  it('一采、二采的步数能自己改：改完照改的走，进度和流程都用它；越界、不是整数都拦；切预设会把改的覆盖掉', async () => {
    await useVideoAutodl();
    for (const bad of [{ pass1: 0, pass2: 3 }, { pass1: 51, pass2: 3 }, { pass1: 10, pass2: 21 }, { pass1: 2.5, pass2: 3 }, { pass1: '10', pass2: 3 }]) {
      expect((await t.call('PATCH', nodeUrl(), { video: { steps: bad } })).status).toBe(400);
    }
    expect(await t.call('PATCH', nodeUrl(), { video: { steps: { pass1: 14 } } })).toMatchObject({ status: 400, body: { error: '二采步数要是 1 到 20 的整数' } });

    await t.ok('PATCH', nodeUrl(), { duration: 15, video: { steps: { pass1: 14, pass2: 5 } } });
    const reply = await send('写一个 15 秒的', replyId);
    const seen: string[] = [];
    const stop = t.videoJobs().subscribe((event: VideoJobEvent) => {
      if (event.type === 'progress' && (event.stage === 'pass1' || event.stage === 'pass2') && event.chunk) seen.push(`${event.stage} ${event.step}/${event.steps}`);
    });
    const job = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    expect(job.params.steps).toEqual({ pass1: 14, pass2: 5 });
    await settledJob(job.id, reply);
    stop();
    expect(ofType(await lastGraph(), 'BasicScheduler').map((node) => node.inputs.steps)).toEqual([14, 5]);
    expect(seen).toContain('pass1 14/14');
    expect(seen).toContain('pass2 5/5');

    // 切一次预设：改过的被预设覆盖掉
    await t.ok('PATCH', nodeUrl(), { video: { speed: 'full', model: 'minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors', steps: { pass1: 20, pass2: 6 } } });
    const after = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    expect(after.params.steps).toEqual({ pass1: 20, pass2: 6 });
    await settledJob(after.id, reply);
  });

  it('走哪套流程能自己选：SelfLift 那套一段一个采样器、没有放大二采；二采重画多少放开能改；这套不能重拍一截', async () => {
    await useVideoAutodl();
    // 校验：流程只认那两套；denoise 有范围；低分辨率那几步要比总步数少至少 1
    expect(await t.call('PATCH', nodeUrl(), { video: { workflow: 'one-pass' } })).toMatchObject({ status: 400, body: { error: '走哪套流程只能是 two-pass、selflift' } });
    expect(await t.call('PATCH', nodeUrl(), { video: { denoise: 1.5 } })).toMatchObject({ status: 400, body: { error: '二采重画多少要在 0.05 到 1 之间' } });
    expect(await t.call('PATCH', nodeUrl(), { video: { selflift: { steps: 8, transitionStep: 8, lowresScale: 0.5, upscaler: 'none' } } })).toMatchObject({ status: 400 });
    expect(await t.call('PATCH', nodeUrl(), { video: { selflift: { steps: 8, transitionStep: 6, lowresScale: 2, upscaler: 'none' } } })).toMatchObject({ status: 400 });

    await t.ok('PATCH', nodeUrl(), { duration: 15, video: { workflow: 'selflift', denoise: 0.4, selflift: { steps: 8, transitionStep: 6, lowresScale: 0.65, upscaler: 'none' } } });
    const reply = await send('写一个 15 秒的', replyId);
    const chunks: number[] = [];
    const stop = t.videoJobs().subscribe((event: VideoJobEvent) => {
      if (event.type === 'progress' && event.stage === 'pass1' && event.chunk) chunks.push(event.chunk);
    });
    const job = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    expect(job.params).toMatchObject({ workflow: 'selflift', denoise: 0.4, selflift: { steps: 8, transitionStep: 6, lowresScale: 0.65, upscaler: 'none' } });
    const done = await settledJob(job.id, reply);
    stop();
    expect(done).toMatchObject({ status: 'done' });
    const graph = await lastGraph();
    expect(ofType(graph, 'SelfLiftH3Sampler')).toHaveLength(1);
    expect(ofType(graph, 'MMH3LoopingSampler')).toEqual([]);
    expect(ofType(graph, 'SelfLiftH3Sampler')[0].inputs).toMatchObject({ cfg: 1, transition_step: 6, lowres_scale: 0.65, rho: 0.6, w_min: 1, w_max: 1, upscaler_model: 'none' });
    expect(ofType(graph, 'BasicScheduler').map((node) => node.inputs)).toEqual([expect.objectContaining({ steps: 8, denoise: 1 })]);
    expect(chunks).toContain(1);

    // 这条没存一采二采，重拍一截要被拦住；同样参数再来照旧
    expect(await t.call('POST', videosUrl(reply), { reshoot: { jobId: job.id, from: 0, to: 24, prompts: [] } })).toMatchObject({ status: 400, body: { error: '这条出的时候没存一采、二采的结果，只能整条重出' } });
    const again = await t.ok<VideoJob>('POST', videosUrl(reply), { again: { jobId: job.id, sameSeed: true } });
    expect(again.params.workflow).toBe('selflift');
    await settledJob(again.id, reply);

    // 切回两遍生成：二采的 denoise 照填的走，SelfLift 那几项不影响
    await t.ok('PATCH', nodeUrl(), { video: { workflow: 'two-pass', denoise: 0.4 } });
    const two = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    await settledJob(two.id, reply);
    expect(ofType(await lastGraph(), 'MMH3LoopingSampler')).toHaveLength(2);
    expect(ofType(await lastGraph(), 'BasicScheduler').map((node) => node.inputs.denoise)).toEqual([1, 0.4]);
    expect(ofType(await lastGraph(), 'SelfLiftH3Sampler')).toEqual([]);
  });

  it('设置「AutoDL 上的模型」切到生成视频那台：只能传 LoRA，传完列得出、生成设置里选得到', async () => {
    await useVideoAutodl();
    expect(await t.call('POST', '/comfy/video/models/check', { kind: 'checkpoint', folder: '', name: 'a.safetensors', size: 10 })).toMatchObject({ status: 400, body: { error: '这台只能传 LoRA' } });
    expect(await t.call('POST', '/comfy/video/models/check', { kind: 'lora', folder: 'H3', name: 'mine.safetensors', size: 10 })).toMatchObject({ status: 200 });
    const data = Buffer.from('0123456789');
    const query = new URLSearchParams({ id: 'video-lora-1', kind: 'lora', folder: 'H3', name: 'mine.safetensors', size: String(data.length) });
    const res = await fetch(`${t.base}/comfy/video/models/upload?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
    expect(((await res.json()) as ModelTransfer).state).toBe('done');
    expect(await fs.readFile(mock.ssh.local('/root/autodl-tmp/models/loras/H3/mine.safetensors'), 'utf8')).toBe('0123456789');
    expect((await t.ok<RemoteModels>('GET', '/comfy/video/models')).files).toEqual([expect.objectContaining({ kind: 'lora', path: 'H3/mine.safetensors', bytes: 10 })]);
    expect((await t.ok<ModelTransfer[]>('GET', '/comfy/video/models/transfers')).map((one) => one.path)).toEqual(['H3/mine.safetensors']);
    // 出图那台的传输列表是另一份
    expect(await t.ok<ModelTransfer[]>('GET', '/comfy/autodl/models/transfers')).toEqual([]);
    await until(() => t.ok<VideoOptions>('GET', '/comfy/video/options'), (options) => options.loras.includes('H3/mine.safetensors'), 3000);
  });

  it('参考模式带视频和音频：文件传上去；用画面的视频按 24 帧读、跳过开头，声音接 ref_video_audios；声音参考接 ref_audios；配音接 audio', async () => {
    await useVideoAutodl();
    const big = await addMedia('talk.mp4', { seconds: 3, width: 1920, height: 1080, hasAudio: true });
    const voice = await addMedia('voice.mp3', { seconds: 4 });
    const dubFile = await addMedia('short.mp3', { seconds: 9.5 });
    const media: MediaSlot[] = [
      { kind: 'video', mediaId: big.id, seconds: 3, start: 0.5, use: 'both' },
      { kind: 'audio', mediaId: dubFile.id, seconds: 9.5, start: 1, use: 'dub' },
      { kind: 'audio', mediaId: voice.id, seconds: 4, start: 1, use: 'voice' },
    ];
    await t.ok('PATCH', nodeUrl(), { duration: 15, media });
    const reply = await send('照着视频和声音写', replyId);
    const job = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    expect(job.params.media).toEqual([
      { kind: 'video', mediaId: big.id, use: 'both', start: 0.5, take: 2.33, width: 1920, height: 1080 },
      { kind: 'audio', mediaId: voice.id, use: 'voice', start: 1, take: 3 },
      { kind: 'audio', mediaId: dubFile.id, use: 'dub', start: 1, take: 8.5 },
    ]);
    expect(await settledJob(job.id, reply)).toMatchObject({ status: 'done' });

    const graph = await lastGraph();
    const names = await Promise.all([big, voice, dubFile].map((record) => uploadedName(record.sha256)));
    expect(names.every(Boolean)).toBe(true);
    // 取 2.5 秒按 H3 的 17 帧一档砍成 56 帧
    expect(graph[200]).toMatchObject({
      class_type: 'VHS_LoadVideo',
      inputs: { video: names[0], force_rate: 24, custom_width: 0, custom_height: 480, frame_load_cap: 56, skip_first_frames: 12, select_every_nth: 1, format: 'None' },
    });
    expect(graph[201]).toMatchObject({ class_type: 'LoadAudio', inputs: { audio: names[1] } });
    expect(graph[202]).toMatchObject({ class_type: 'TrimAudioDuration', inputs: { audio: ['201', 0], start_index: 1, duration: 3 } });
    expect(graph[203]).toMatchObject({ class_type: 'LoadAudio', inputs: { audio: names[2] } });
    // 配音取到视频结束多留一秒：15 秒的视频取 8.5 秒就够了
    expect(graph[204]).toMatchObject({ class_type: 'TrimAudioDuration', inputs: { audio: ['203', 0], start_index: 1, duration: 8.5 } });
    // 配音比视频短，后面接静音补到视频结束多一秒
    expect(graph[205]).toMatchObject({ class_type: 'EmptyAudio', inputs: { duration: 8.5 } });
    expect(graph[206]).toMatchObject({ class_type: 'AudioConcat', inputs: { audio1: ['204', 0], audio2: ['205', 0], direction: 'after' } });
    expect(ofType(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({
      'ref_videos.ref_video_0': ['200', 0],
      'ref_video_audios.ref_video_audio_0': ['200', 2],
      'ref_audios.ref_audio_0': ['202', 0],
      audio: ['206', 0],
      use_input_audio: true,
    });
    // 有配音的，一采、二采存档之前去掉遮罩，二采拿的还是一采原样的
    const saves = ofType(graph, 'MiniMaxH3NativeLatentCheckpointSaveT8Advanced');
    expect(saves.map((save) => from(graph, save.inputs.av_latent))).toEqual([
      expect.objectContaining({ class_type: 'RemoveNoiseMask', inputs: { samples: ['14', 0] } }),
      expect.objectContaining({ class_type: 'RemoveNoiseMask', inputs: { samples: ['19', 0] } }),
    ]);
    expect(from(graph, from(graph, ofType(graph, 'LTXVConcatAVLatent')[0].inputs.audio_latent).inputs.av_latent)).toBe(ofType(graph, 'MMH3LoopingSampler')[0]);

    // 同样参数再来照样带
    const again = await t.ok<VideoJob>('POST', videosUrl(reply), { again: { jobId: job.id, sameSeed: false } });
    expect(again.params.media).toEqual(job.params.media);
  });

  it('视频和音频超了上限的不发，说哪条超了；图当首帧、纯文字写的只带配音', async () => {
    await useVideoAutodl();
    const talk = await addMedia('talk.mp4', { seconds: 3, width: 160, height: 90, hasAudio: true });
    const voice = await addMedia('voice.mp3', { seconds: 4 });
    const slot = (use: 'voice' | 'dub', start = 0): MediaSlot => ({ kind: 'audio', mediaId: voice.id, seconds: 4, start, use });
    await t.ok('PATCH', nodeUrl(), { duration: 15, media: [{ kind: 'video', mediaId: talk.id, seconds: 3, start: 0, use: 'both' }, slot('voice'), slot('voice', 1), slot('voice', 2)] });
    const reply = await send('四段声音', replyId);
    expect(await t.call('POST', videosUrl(reply), { promptIndex: 0 })).toMatchObject({
      status: 400,
      body: { error: '视频和音频超了上限：参考音频有 4 段（视频里的声音也算），最多 3 段。删掉一段、改好再写一条' },
    });

    await t.ok('PATCH', nodeUrl(), { systemPromptName: 'i2v', slots: [await t.addImage(canvasId, '#336699')], media: [{ kind: 'video', mediaId: talk.id, seconds: 3, start: 0, use: 'picture' }, slot('dub')] });
    const first = await send('从这张图开始', reply);
    const job = await t.ok<VideoJob>('POST', videosUrl(first), { promptIndex: 0 });
    expect(job.params.media).toEqual([{ kind: 'audio', mediaId: voice.id, use: 'dub', start: 0, take: 4 }]);
    await settledJob(job.id, first);
    const graph = await lastGraph();
    expect(ofType(graph, 'VHS_LoadVideo')).toEqual([]);
    expect(ofType(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ audio: ['203', 0], use_input_audio: true });
  });

  it('重拍有配音的：声音整条钉住不重画，编码提示词那里不再写配音', async () => {
    await useVideoAutodl();
    const voice = await addMedia('voice.mp3', { seconds: 4 });
    await t.ok('PATCH', nodeUrl(), { duration: 30, media: [{ kind: 'audio', mediaId: voice.id, seconds: 4, start: 0, use: 'dub' }] });
    const reply = await send('配音的 30 秒', replyId);
    const orig = await t.ok<VideoJob>('POST', videosUrl(reply), { promptIndex: 0 });
    await settledJob(orig.id, reply);
    const redo = await t.ok<VideoJob>('POST', videosUrl(reply), { reshoot: { jobId: orig.id, from: 192, to: 264, seed: 9, prompts: {} } });
    expect(await settledJob(redo.id, reply)).toMatchObject({ status: 'done' });
    const graph = await lastGraph();
    for (const type of ['LoadAudio', 'TrimAudioDuration', 'EmptyAudio', 'AudioConcat', 'RemoveNoiseMask']) expect(ofType(graph, type)).toEqual([]);
    const prompts = ofType(graph, 'MMH3ReferenceMultiPrompt')[0].inputs;
    expect(prompts.audio).toBeUndefined();
    expect(prompts.use_input_audio).toBe(false);
    // 画面照选的这一截重画，声音那个遮罩整窗都是 0
    const [pass1] = ofType(graph, 'MMH3LoopingSampler');
    const audioMask = from(graph, pass1.inputs.audio_denoise_mask);
    expect(audioMask.inputs.image).not.toEqual(from(graph, pass1.inputs.denoise_mask).inputs.image);
    const strip = from(graph, audioMask.inputs.image);
    expect(strip.inputs.amount).toBe(362);
    expect(from(graph, from(graph, strip.inputs.image).inputs.mask).inputs.value).toBe(0);
  }, 20_000);

  it('岔出去的节点、手动改提示词生成的新版本都不带原来的视频', async () => {
    await useVideoAutodl();
    const job = await t.ok<VideoJob>('POST', videosUrl(), { promptIndex: 0 });
    await settledJob(job.id);
    const forked = await t.ok<ChatNode>('POST', `${nodeUrl()}/fork`, { messageId: replyId });
    expect(forked.messages[replyId].videos).toBeUndefined();
    const editedId = await edited('改过的一段');
    expect((await t.ok<ChatNode>('GET', nodeUrl())).messages[editedId].videos).toBeUndefined();
  });
});

