import { tempFolderName, type AutodlState, type ChatNode, type ComfyGraph, type Message, type VideoJob, type VideoJobEvent } from '@media-agent/shared';
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
const settledJob = async (jobId: string, messageId = replyId) => (await until(() => readJob(jobId, messageId), settled))!;
const lastGraph = async () => ((await (await fetch(`${comfyUrl}/_last-prompts`)).json()) as { prompt: ComfyGraph }[]).at(-1)!.prompt;
const ofType = (graph: ComfyGraph, type: string) => Object.values(graph).filter((node) => node.class_type === type);

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

  it('不能生成的：没选那台、框分了 5 段、回复带了图、生图节点', async () => {
    const none = await t.call('POST', videosUrl(), { promptIndex: 0 });
    expect(none).toMatchObject({ status: 400, body: { error: '先在设置里填 AutoDL 的开发者 Token、选好生成视频用的实例' } });
    await useVideoAutodl();
    const five = await edited(['一', '二', '三', '四', '五'].join('\n|\n'));
    expect(await t.call('POST', videosUrl(five), { promptIndex: 0 })).toMatchObject({ status: 400, body: { error: '这个框分了 5 段，最多 4 段' } });
    expect((await t.call('POST', videosUrl(), { promptIndex: 3 })).status).toBe(404);

    const imageId = await t.addImage(canvasId, '#336699');
    await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
    const withImage = ((await t.stream(`${nodeUrl()}/send`, { parentId: replyId, text: '再写一个' })).at(-1) as { message: Message }).message.id;
    expect(await t.call('POST', videosUrl(withImage), { promptIndex: 0 })).toMatchObject({ status: 400, body: { error: '带图的生成视频还没做' } });

    await t.ok('PUT', '/prompts/il', { text: '---\n用途: 生图\n底模: IL\n---\n只写标签' });
    const imageNode = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0, kind: 'image' })).id;
    const tags = ((await t.stream(`/canvases/${canvasId}/nodes/${imageNode}/send`, { parentId: null, text: '写一个' })).at(-1) as { message: Message }).message.id;
    const refused = await t.call('POST', `/canvases/${canvasId}/nodes/${imageNode}/messages/${tags}/videos`, { promptIndex: 0 });
    expect(refused).toMatchObject({ status: 400, body: { error: '生图节点不能生成视频' } });
    expect(mock.autodl.calls).toEqual([]);
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
    const slowId = await edited('慢慢地走');
    const running = await t.ok<VideoJob>('POST', videosUrl(slowId), { promptIndex: 0 });
    await until(() => readJob(running.id, slowId), (job) => job?.status === 'running');
    const waiting = await t.ok<VideoJob>('POST', videosUrl(slowId), { promptIndex: 0 });
    await until(() => readJob(waiting.id, slowId), (job) => Boolean(job?.promptId));

    expect(await t.ok<VideoJob>('POST', `${videosUrl(slowId)}/${waiting.id}/stop`)).toMatchObject({ status: 'stopped' });
    expect(await t.ok<VideoJob>('POST', `${videosUrl(slowId)}/${running.id}/stop`)).toMatchObject({ status: 'running' });
    expect(await settledJob(running.id, slowId)).toMatchObject({ status: 'stopped' });

    const brokenId = await edited('报错');
    const broken = await t.ok<VideoJob>('POST', videosUrl(brokenId), { promptIndex: 0 });
    expect(await settledJob(broken.id, brokenId)).toMatchObject({ status: 'failed', error: '生成视频出错（MMH3LoopingSampler）：mock-comfyui：提示词含「报错」，按约定出错' });
    const memoryId = await edited('显存');
    const memory = await t.ok<VideoJob>('POST', videosUrl(memoryId), { promptIndex: 0 });
    expect(await settledJob(memory.id, memoryId)).toMatchObject({ status: 'failed', error: '显存不够：CUDA out of memory. Tried to allocate 20.00 GiB' });
  });

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

    const slowId = await edited('慢慢地走');
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
    const slowId = await edited('慢慢地走');
    const job = await t.ok<VideoJob>('POST', videosUrl(slowId), { promptIndex: 0 });
    await until(() => readJob(job.id, slowId), (current) => current?.status === 'running');
    await t.restart();

    // 再塞一条还没发出去的
    const file = path.join(t.work, 'canvases', canvasId, 'nodes', `${nodeId}.json`);
    const node = JSON.parse(await fs.readFile(file, 'utf8')) as ChatNode;
    node.messages[slowId].videos!.push({ ...job, id: 'lost-job', status: 'queued' });
    await fs.writeFile(file, JSON.stringify(node));

    await t.videoJobs().resume();
    expect(await settledJob(job.id, slowId)).toMatchObject({ status: 'done', file: expect.stringMatching(/\.mp4$/) });
    expect(await readJob('lost-job', slowId)).toMatchObject({ status: 'failed', error: '程序重启时这条还没出完' });
  }, 15_000);

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

