import {
  BUILTIN_WORKFLOW,
  builtinGraph,
  defaultImageSettings,
  FAMILY_DEFAULTS,
  importedGraph,
  inpaintGraph,
  type CanvasDetail,
  type ChatNode,
  type ComfyGraph,
  type ComfyOptions,
  type ComfyStatus,
  type Config,
  type ControlSettings,
  type HomeData,
  type ImageJob,
  type ImageJobEvent,
  type ImagePreset,
  type ImageTempInfo,
  type ImageWhere,
  type ImportedWorkflow,
  type Message,
  type RefImage,
  type SharedSettings,
} from '@media-agent/shared';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockComfy, type MockComfy } from '../../../tools/mock-comfyui/src/app';
import { sleep, startTestApp, type TestApp } from './helpers';

// 小词库：blond hair 是别名，golden hair 不认识
const LIBRARY: Record<string, string> = {
  'tags.csv': 'tag,category,count,deprecated\n1girl,0,8000000,0\nblonde_hair,0,2000000,0\nsmile,0,4000000,0\n',
  'aliases.csv': 'alias,tag\nblond_hair,blonde_hair\n',
  'info.json': '{ "updatedAt": "2026-09-01" }',
};

let t: TestApp;
let mock: MockComfy;
let comfyUrl: string;
let canvasId: string;
let nodeId: string;
let replyId: string;

const nodeUrl = () => `/canvases/${canvasId}/nodes/${nodeId}`;
const imagesUrl = (messageId: string) => `${nodeUrl()}/messages/${messageId}/images`;

beforeEach(async () => {
  mock = createMockComfy({ stepMs: 15, slowStepMs: 150 });
  await new Promise<void>((resolve) => mock.server.listen(0, '127.0.0.1', () => resolve()));
  comfyUrl = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;

  t = await startTestApp();
  for (const [file, text] of Object.entries(LIBRARY)) {
    await fs.mkdir(path.join(t.work, 'tags'), { recursive: true });
    await fs.writeFile(path.join(t.work, 'tags', file), text);
  }
  await t.ok('PUT', '/settings', { comfy: { lanUrl: comfyUrl } });
  await t.ok('PUT', '/prompts/il', { text:'---\n用途: 生图\n底模: IL\n---\n只写标签' });
  canvasId = (await t.ok('POST', '/canvases', { title: '出图' })).id;
  nodeId = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0, kind: 'image' })).id;
  const events = await t.stream(`${nodeUrl()}/send`, { parentId: null, text: '写一个' });
  replyId = (events.at(-1) as { message: Message }).message.id;
});

afterEach(async () => {
  await t.cleanup();
  await mock.close();
});

// 框里换成这些标签（手动改提示词，生成新版本），节点的出图设置改成这样；返回新版本的 id
async function prepare(tags: string, image: Record<string, unknown> = {}): Promise<string> {
  const node = await t.ok<ChatNode>('POST', `${nodeUrl()}/messages/${replyId}/edit-prompt`, { promptIndex: 0, text: tags });
  await t.ok('PATCH', nodeUrl(), { image: { checkpoint: 'il-test.safetensors', count: 1, seed: 100, ...image } });
  return Object.values(node.messages).find((m) => m.editedFromMessageId === replyId && m.parsed?.prompts[0]?.text === tags)!.id;
}

async function readJob(messageId: string, jobId: string): Promise<ImageJob | undefined> {
  return (await t.ok<ChatNode>('GET', nodeUrl())).messages[messageId].images?.find((job) => job.id === jobId);
}

// 反复读节点，直到这一组满足条件
async function until(messageId: string, jobId: string, done: (job: ImageJob) => boolean, timeoutMs = 8000): Promise<ImageJob> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await readJob(messageId, jobId);
    if (job && done(job)) return job;
    if (Date.now() > deadline) throw new Error(`等太久了：${JSON.stringify(job)}`);
    await sleep(20);
  }
}

const settled = (job: ImageJob) => job.images.every((image) => image.status !== 'queued' && image.status !== 'running');

// 收 /image-jobs/events 推来的事件
async function watch() {
  const controller = new AbortController();
  const res = await fetch(`${t.base}/image-jobs/events`, { signal: controller.signal });
  const events: ImageJobEvent[] = [];
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

const lastPrompts = async () => (await (await fetch(`${comfyUrl}/_last-prompts`)).json()) as { prompt: unknown; client_id: string }[];
const tempFiles = async () => (await fs.readdir(path.join(t.work, 'image-temp'), { recursive: true })).filter((name) => name.endsWith('.png'));

describe('出图任务', () => {
  it('点生图：建一组排队的，逐张发给 ComfyUI，进度和排第几推给前端，出完的图存进临时文件夹', async () => {
    const watcher = await watch();
    // 「慢」让第一张跑得久一点，第二张排着队
    const messageId = await prepare('1girl, blond hair, golden hair, (smile:1.2), 慢', { count: 2 });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });

    expect(job.images).toEqual([
      { seed: 100, status: 'queued' },
      { seed: 101, status: 'queued' },
    ]);
    expect(job.params).toEqual({
      family: 'IL',
      positive: 'masterpiece, best quality, 1girl, blonde hair, golden hair, (smile:1.2), 慢',
      negative: FAMILY_DEFAULTS.IL.negative,
      workflow: { id: null, name: '内置流程', hash: '' },
      width: 832,
      height: 1216,
      checkpoint: 'il-test.safetensors',
      loras: [],
      steps: 28,
      cfg: 5,
      sampler: 'euler_ancestral',
      scheduler: 'normal',
      clipSkip: 2,
    });

    const done = await until(messageId, job.id, settled);
    for (const [index, image] of done.images.entries()) {
      expect(image).toMatchObject({ seed: 100 + index, status: 'done', width: 832, height: 1216 });
      expect(image.file).toMatch(new RegExp(`^image-temp/\\d{4}-\\d{2}-\\d{2}/\\d{6}-${100 + index}\\.png$`));
      expect(image.ms).toBeGreaterThan(0);
      expect(await sharp(path.join(t.work, image.file!)).metadata()).toMatchObject({ format: 'png', width: 832, height: 1216 });
    }

    // 发出去的就是内置流程拼的 JSON，带着本机固定的 client_id
    const prompts = await lastPrompts();
    const { comfyClientId } = JSON.parse(await fs.readFile(path.join(t.configDir, 'config.json'), 'utf8'));
    expect(prompts.map((body) => body.prompt)).toEqual([builtinGraph(job.params, 100), builtinGraph(job.params, 101)]);
    expect(prompts.every((body) => body.client_id === comfyClientId)).toBe(true);

    const file = await fetch(`${t.base}${imagesUrl(messageId)}/${job.id}/1/file`);
    expect(file.headers.get('content-type')).toBe('image/png');
    const thumb = await fetch(`${t.base}${imagesUrl(messageId)}/${job.id}/1/thumb`);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');

    watcher.close();
    const { events } = watcher;
    const statuses = events.flatMap((e) => (e.type === 'job' && e.job.id === job.id ? [e.job.images[0].status] : []));
    expect(statuses).toContain('running');
    expect(statuses.at(-1)).toBe('done');
    expect(events.filter((e) => e.type === 'progress' && e.jobId === job.id && e.index === 0).map((e) => e.type === 'progress' && e.step)).toEqual([1, 2, 3, 4, 5]);
    expect(events).toContainEqual({ type: 'queue', jobId: job.id, index: 1, position: 1 });
  });

  it('后连上的页面先拿到现在排第几、走到第几步', async () => {
    const first = await watch();
    const messageId = await prepare('1girl, 慢', { count: 2 });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    for (const deadline = Date.now() + 8000; !first.events.some((e) => e.type === 'progress' && e.jobId === job.id) || !first.events.some((e) => e.type === 'queue'); ) {
      if (Date.now() > deadline) throw new Error('等不到进度');
      await sleep(20);
    }
    first.close();
    const later = await watch();
    await sleep(50);
    later.close();
    expect(later.events).toContainEqual({ type: 'queue', jobId: job.id, index: 1, position: 1 });
    expect(later.events).toContainEqual(expect.objectContaining({ type: 'progress', jobId: job.id, index: 0, total: 5 }));
    await t.ok('POST', `${imagesUrl(messageId)}/${job.id}/stop`);
    await until(messageId, job.id, settled);
  });

  it('叫停：排队的从 ComfyUI 队列里删掉，正在跑的让它停；已经出完的留着', async () => {
    const messageId = await prepare('1girl, 慢', { count: 3 });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    await until(messageId, job.id, (j) => j.images[0].status === 'done' && j.images[1].status === 'running');

    const stopped = await t.ok<ImageJob>('POST', `${imagesUrl(messageId)}/${job.id}/stop`);
    expect(stopped.images[2].status).toBe('stopped');
    const final = await until(messageId, job.id, settled);
    expect(final.images.map((image) => image.status)).toEqual(['done', 'stopped', 'stopped']);
    expect(await (await fetch(`${comfyUrl}/queue`)).json()).toEqual({ queue_running: [], queue_pending: [] });
    expect(await tempFiles()).toHaveLength(1);
  });

  it('几种失败的说法：底模不在、执行出错、显存不够、连不上', { timeout: 20_000 }, async () => {
    const fail = async (tags: string, image: Record<string, unknown> = {}) => {
      const messageId = await prepare(tags, image);
      const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
      return (await until(messageId, job.id, settled, 15_000)).images[0];
    };

    const missing = await fail('1girl', { checkpoint: 'missing.safetensors' });
    expect(missing.status).toBe('failed');
    expect(missing.error).toContain("ComfyUI 不收这个任务：CheckpointLoaderSimple（1 号节点）ckpt_name: 'missing.safetensors' not in");
    expect((await fail('1girl, 报错')).error).toBe('出图出错（KSampler）：mock-comfyui：正面提示词含「报错」，按约定出错');
    expect((await fail('1girl, 显存')).error).toMatch(/^显存不够：CUDA out of memory/);

    // 一个刚关掉的端口：ComfyUI 没开
    const probe = http.createServer();
    const closed = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    await t.ok('PUT', '/settings', { comfy: { lanUrl: `http://127.0.0.1:${closed}` } });
    const unreachable = await fail('1girl');
    expect(unreachable.status).toBe('failed');
    expect(unreachable.error).toBe(`连不上 ComfyUI 的进度推送（http://127.0.0.1:${closed}/ws）：地址不对，或者 ComfyUI 没开`);
  });

  it('同样参数再来用同一个种子、只换种子再来随机一个，都只出一张；参数照原来那组，不跟节点现在的设置', async () => {
    const messageId = await prepare('1girl');
    const first = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    await until(messageId, first.id, settled);
    await t.ok('PATCH', nodeUrl(), { image: { steps: 10 } });

    const same = await t.ok<ImageJob>('POST', imagesUrl(messageId), { again: { jobId: first.id, index: 0, sameSeed: true } });
    const other = await t.ok<ImageJob>('POST', imagesUrl(messageId), { again: { jobId: first.id, index: 0, sameSeed: false } });
    expect(same.params).toEqual(first.params);
    expect(same.images).toEqual([{ seed: 100, status: 'queued' }]);
    expect(other.images).toHaveLength(1);
    expect(other.images[0].seed).not.toBe(100);
    // 记下照着哪张出的：那一组和那张的种子
    expect(same.source).toEqual({ kind: 'generated', jobId: first.id, seed: 100 });
    expect(other.source).toEqual({ kind: 'generated', jobId: first.id, seed: 100 });
    expect(first.source).toBeUndefined();
    await until(messageId, same.id, settled);
    await until(messageId, other.id, settled);
    expect((await t.ok<ChatNode>('GET', nodeUrl())).messages[messageId].images!.map((job) => job.id)).toEqual([first.id, same.id, other.id]);
  });

  it('节点还没选过底模：用这台 ComfyUI 上这个系列的第一个，记进这一组；这个系列一个底模都没有算失败', async () => {
    const messageId = await prepare('1girl', { checkpoint: '' });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect(job.params.checkpoint).toBe('');
    const done = await until(messageId, job.id, settled);
    expect(done.params.checkpoint).toBe('il-test.safetensors');
    expect(done.images[0].status).toBe('done');
    expect((await lastPrompts()).at(-1)!.prompt).toEqual(builtinGraph(done.params, 100));

    // 两个底模都标成 Pony：IL 节点没得选
    await t.ok('PUT', '/settings', { checkpoints: { 'il-test.safetensors': 'Pony' } });
    const none = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect((await until(messageId, none.id, settled)).images[0]).toEqual({
      seed: 100,
      status: 'failed',
      error: '这台 ComfyUI 上没有 IL 系列的底模。去设置「底模和默认值」里看看底模各标成了哪个系列',
    });
  });

  it('卡片和首页带上出的图：画布卡片最近的在前，首页打过星的在前；正在出的算进度；最近一组全失败标出来', async () => {
    const messageId = await prepare('1girl', { count: 2 });
    const first = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    await until(messageId, first.id, settled);
    const second = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    await until(messageId, second.id, settled);
    await t.ok('POST', `${imagesUrl(messageId)}/${first.id}/1/star`, { on: true });
    await t.ok('POST', `${nodeUrl()}/messages/${messageId}/star`, { promptIndex: 0, on: true });

    const ref = (job: ImageJob, index: number, starred = false) => ({ messageId, jobId: job.id, index, seed: 100 + index, starred });
    const card = async () => (await t.ok<CanvasDetail>('GET', `/canvases/${canvasId}`)).nodes[0].generated;
    expect(await card()).toEqual({ images: [ref(second, 0), ref(second, 1), ref(first, 0), ref(first, 1, true)], live: null, failed: false });
    const home = await t.ok<HomeData>('GET', '/home');
    expect(home.recentNodes[0].generated).toEqual({ images: [ref(first, 1, true), ref(second, 0), ref(second, 1), ref(first, 0)], live: null, failed: false });
    expect(home.starred[0].image).toEqual({ family: 'IL', width: 832, height: 1216, generated: [ref(first, 1, true), ref(second, 0), ref(second, 1), ref(first, 0)] });

    // 正在出：出完几张、一共几张
    const slowId = await prepare('1girl, 慢', { count: 2 });
    const slow = await t.ok<ImageJob>('POST', imagesUrl(slowId), { promptIndex: 0 });
    expect((await card())!.live).toEqual({ done: 0, total: 2, boot: false });
    await t.ok('POST', `${imagesUrl(slowId)}/${slow.id}/stop`);
    await until(slowId, slow.id, settled);
    expect((await card())!.failed).toBe(false);
    // 最近一组全失败
    await t.ok('PATCH', nodeUrl(), { image: { checkpoint: 'missing.safetensors' } });
    const broken = await t.ok<ImageJob>('POST', imagesUrl(slowId), { promptIndex: 0 });
    await until(slowId, broken.id, settled);
    expect(await card()).toMatchObject({ live: null, failed: true });
  });

  it('大图旁边的文件在哪；设置里的临时文件夹：按日期分的子文件夹各有几张多大，上次下载到哪', async () => {
    const messageId = await prepare('1girl', { count: 2 });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    const done = await until(messageId, job.id, settled);
    const temp = path.join(t.work, done.images[0].file!);
    const whereUrl = `${imagesUrl(messageId)}/${job.id}/0/where`;
    expect(await t.ok<ImageWhere>('GET', whereUrl)).toEqual({ temp, saved: null });

    const info = await t.ok<ImageTempInfo>('GET', '/image-temp');
    const bytes = (await Promise.all(done.images.map((image) => fs.stat(path.join(t.work, image.file!))))).reduce((sum, st) => sum + st.size, 0);
    expect(info).toEqual({ path: path.join(t.work, 'image-temp'), days: [{ name: path.basename(path.dirname(temp)), count: 2, bytes }], lastDownload: null });

    const folder = path.join(t.work, 'downloads');
    await fs.mkdir(folder);
    const { paths } = await t.ok('POST', '/images/download', { items: [{ canvasId, nodeId, messageId, jobId: job.id, index: 0 }], folder });
    await fs.rm(temp);
    expect(await t.ok<ImageWhere>('GET', whereUrl)).toEqual({ temp: null, saved: paths[0] });
    expect((await t.ok<ImageTempInfo>('GET', '/image-temp')).lastDownload).toEqual({ folder, inLibrary: false });
  });

  it('打星；删一张：临时文件直接删，下载过的那份不动，一张不剩整组去掉；没出完的不让删', async () => {
    const messageId = await prepare('1girl', { count: 2 });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    const done = await until(messageId, job.id, settled);
    expect((await t.ok<ImageJob>('POST', `${imagesUrl(messageId)}/${job.id}/1/star`, { on: true })).images[1].starred).toBe(true);

    const folder = path.join(t.work, 'downloads');
    await fs.mkdir(folder);
    const { paths } = await t.ok('POST', '/images/download', { items: [{ canvasId, nodeId, messageId, jobId: job.id, index: 0 }], folder });

    const left = await t.ok<ImageJob>('DELETE', `${imagesUrl(messageId)}/${job.id}/0`);
    expect(left.images).toEqual([expect.objectContaining({ seed: 101, starred: true })]);
    await expect(fs.stat(path.join(t.work, done.images[0].file!))).rejects.toThrow();
    expect((await fs.stat(paths[0])).isFile()).toBe(true);
    await t.ok('DELETE', `${imagesUrl(messageId)}/${job.id}/0`);
    expect((await t.ok<ChatNode>('GET', nodeUrl())).messages[messageId].images).toEqual([]);

    const slowId = await prepare('1girl, 慢');
    const slow = await t.ok<ImageJob>('POST', imagesUrl(slowId), { promptIndex: 0 });
    expect(await t.call('DELETE', `${imagesUrl(slowId)}/${slow.id}/0`)).toEqual({ status: 409, body: { error: '这张还没出完，先叫停' } });
    await t.ok('POST', `${imagesUrl(slowId)}/${slow.id}/stop`);
    await until(slowId, slow.id, settled);
  });

  it('下载：复制过去，文件名是节点标题加种子，重名加序号；文件夹不在资产库时 inLibrary 为假；临时文件清了用下载的那份', async () => {
    const messageId = await prepare('1girl');
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    const done = await until(messageId, job.id, settled);
    const folder = path.join(t.work, 'downloads');
    await fs.mkdir(folder);
    const items = [{ canvasId, nodeId, messageId, jobId: job.id, index: 0 }];

    expect(await t.ok('POST', '/images/download', { items, folder })).toEqual({ paths: [path.join(folder, '测试图片-100.png')], inLibrary: false });
    expect((await t.ok('POST', '/images/download', { items, folder })).paths).toEqual([path.join(folder, '测试图片-100-2.png')]);
    expect((await readJob(messageId, job.id))!.images[0].savedPath).toBe(path.join(folder, '测试图片-100-2.png'));
    expect((await t.ok<Config>('GET', '/config')).lastDownloadFolder).toBe(folder);

    await t.ok('POST', '/assets/folders', { path: folder });
    expect((await t.ok('POST', '/images/download', { items, folder })).inLibrary).toBe(true);

    const elsewhere = path.join(path.dirname(t.work), 'elsewhere');
    await fs.mkdir(elsewhere);
    expect((await t.call('POST', '/images/download', { items, folder: elsewhere })).status).toBe(403);

    // 临时文件清了，看图用下载的那份；那份也没了是「已清理」
    await fs.rm(path.join(t.work, done.images[0].file!));
    const fileUrl = `${t.base}${imagesUrl(messageId)}/${job.id}/0/file`;
    expect((await fetch(fileUrl)).status).toBe(200);
    await fs.rm(path.join(folder, '测试图片-100-3.png'));
    const gone = await fetch(fileUrl);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: '这张图已经清理掉了' });
  });

  it('服务重启后：出完的取回来，还在跑的接着等，ComfyUI 那边没有的标失败', async () => {
    const messageId = await prepare('1girl, 慢', { count: 2 });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    await until(messageId, job.id, (j) => j.images[0].status === 'running' && Boolean(j.images[1].promptId));
    await t.restart();

    // 再塞一组：一张 ComfyUI 不认识，一张还没发出去
    const file = path.join(t.work, 'canvases', canvasId, 'nodes', `${nodeId}.json`);
    const node = JSON.parse(await fs.readFile(file, 'utf8')) as ChatNode;
    const lost: ImageJob = {
      ...job,
      id: 'lost-job',
      images: [
        { seed: 1, promptId: 'no-such-prompt', status: 'running' },
        { seed: 2, status: 'queued' },
      ],
    };
    node.messages[messageId].images!.push(lost);
    await fs.writeFile(file, JSON.stringify(node));

    await t.imageJobs().resume();
    const resumed = await until(messageId, job.id, settled);
    expect(resumed.images.map((image) => image.status)).toEqual(['done', 'done']);
    expect((await readJob(messageId, 'lost-job'))!.images).toEqual([
      { seed: 1, promptId: 'no-such-prompt', status: 'failed', error: '程序重启时这张还没出完' },
      { seed: 2, status: 'failed', error: '程序重启时这张还没出完' },
    ]);
  });
});

describe('出图设置', () => {
  it('ComfyUI 地址存进工作文件夹，去掉末尾斜杠；底模的系列和各系列默认值只改带了的项；格式不对返回 400', async () => {
    const settings = await t.ok<SharedSettings>('GET', '/settings');
    expect(settings).toMatchObject({ comfy: { lanUrl: comfyUrl }, checkpoints: {}, defaults: FAMILY_DEFAULTS });

    expect((await t.ok<SharedSettings>('PUT', '/settings', { comfy: { lanUrl: 'http://192.168.1.20:8188/' } })).comfy.lanUrl).toBe('http://192.168.1.20:8188');
    expect((await t.ok<SharedSettings>('PUT', '/settings', { comfy: { lanUrl: '' } })).comfy.lanUrl).toBeNull();
    expect((await t.call('PUT', '/settings', { comfy: { lanUrl: '192.168.1.20' } })).status).toBe(400);

    await t.ok('PUT', '/settings', { checkpoints: { 'a.safetensors': 'Pony' } });
    expect((await t.ok<SharedSettings>('PUT', '/settings', { checkpoints: { 'b.safetensors': 'IL' } })).checkpoints).toEqual({ 'a.safetensors': 'Pony', 'b.safetensors': 'IL' });
    expect((await t.call('PUT', '/settings', { checkpoints: { 'c.safetensors': 'SD' } })).status).toBe(400);

    const defaults = (await t.ok<SharedSettings>('PUT', '/settings', { defaults: { IL: { steps: 30 } } })).defaults;
    expect(defaults).toEqual({ IL: { ...FAMILY_DEFAULTS.IL, steps: 30 }, Pony: FAMILY_DEFAULTS.Pony, Krea2: FAMILY_DEFAULTS.Krea2 });
    expect((await t.call('PUT', '/settings', { defaults: { IL: { steps: 0 } } })).status).toBe(400);
    expect(JSON.parse(await fs.readFile(path.join(t.work, 'settings.json'), 'utf8')).defaults.IL.steps).toBe(30);
  });

  it('测试连接显示版本、显卡、显存；下拉选项从 object_info 读，两种写法都认，底模带系列', async () => {
    expect(await t.ok<ComfyStatus>('GET', '/comfy/status')).toEqual({
      ok: true,
      url: comfyUrl,
      version: '0.3.60',
      gpu: 'NVIDIA GeForce RTX 4090',
      vramTotal: 25757220864,
      vramFree: 24000000000,
    });
    const options = await t.ok<ComfyOptions>('GET', '/comfy/options');
    expect(options.checkpoints).toEqual([
      { name: 'il-test.safetensors', family: 'IL', guessed: true },
      { name: 'pony-test.safetensors', family: 'Pony', guessed: true },
    ]);
    expect(options).toMatchObject({ loras: ['detail-test.safetensors', 'IL/anime-style-test.safetensors', 'IL/detail-tweaker-test.safetensors', 'krea2/krea2_4panel.safetensors', 'krea2/krea2_identity_edit_v1_1.safetensors', 'krea2/krea2_identity_edit_v1_2.safetensors', 'krea2/krea_outfittransfer.safetensors', 'krea2/Krea2_Anything2RealCharacters-V1.safetensors', 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', 'krea2/krea2_darkbrush.safetensors', 'krea2/DynamicCharacterSheet_krea2_v1.safetensors', 'krea2/Krea2_DreamCos_Realism.safetensors', 'krea2/Krea2-realism-V2.safetensors', 'krea2/krea2-Cc风情万种-人像.safetensors', 'krea2/krea2-Cc风情万种-风格.safetensors', 'krea2/krea2-Cc-天魔-身材.safetensors', 'krea2/Nick_baotunqun_Krea2.safetensors', 'krea2/Nick_leggings_Krea2.safetensors', 'krea2/krea2_reid_rank32.safetensors', 'krea2/Krea2-depth-control-lora.safetensors', 'krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors'], clipVisions: ['clip-vision-test.safetensors'], taggers: ['wd-v1-4-moat-tagger-v2'] });
    expect(options.samplers).toContain('euler_ancestral');

    await t.ok('PUT', '/settings', { checkpoints: { 'il-test.safetensors': 'Pony' } });
    expect((await t.ok<ComfyOptions>('GET', '/comfy/options')).checkpoints[0]).toEqual({ name: 'il-test.safetensors', family: 'Pony', guessed: false });
    // null 是两个系列都不是
    await t.ok('PUT', '/settings', { checkpoints: { 'il-test.safetensors': null } });
    expect((await t.ok<ComfyOptions>('GET', '/comfy/options')).checkpoints[0]).toEqual({ name: 'il-test.safetensors', family: null, guessed: false });
    expect((await t.call('PUT', '/settings', { checkpoints: { 'il-test.safetensors': 'SD15' } })).status).toBe(400);

    await t.ok('PUT', '/settings', { comfy: { lanUrl: null } });
    expect(await t.ok('GET', '/comfy/status')).toEqual({ ok: false, url: null, error: '还没填局域网 ComfyUI 的地址' });
  });

  it('节点的出图设置：只有生图节点能改，没改过的按系列默认值补全，宽高是 64 到 2048 之间 8 的倍数；岔出去的节点带着', async () => {
    const video = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 400, y: 0 })).id;
    expect(await t.call('PATCH', `/canvases/${canvasId}/nodes/${video}`, { image: { count: 2 } })).toEqual({ status: 400, body: { error: '这个节点用的不是生图提示词' } });

    const node = await t.ok<ChatNode>('PATCH', nodeUrl(), { image: { count: 2, loras: [{ name: 'detail-test.safetensors', strength: 0.7 }] } });
    expect(node.image).toEqual({
      width: 832,
      height: 1216,
      count: 2,
      workflowId: null,
      checkpoint: '',
      vae: '',
      loras: [{ name: 'detail-test.safetensors', strength: 0.7 }],
      loraTarget: 'both',
      weighting: 'comfy',
      steps: 28,
      cfg: 5,
      sampler: 'euler_ancestral',
      scheduler: 'normal',
      seed: null,
      rating: 'none',
      negativeExtra: '',
      upscale: { on: false, model: '', scale: 2, denoise: 0.35 },
      details: [],
      controls: [],
    });
    expect(await t.call('PATCH', nodeUrl(), { image: { width: 1001 } })).toEqual({ status: 400, body: { error: '宽要是 64 到 2048 之间 8 的倍数' } });
    expect((await t.call('PATCH', nodeUrl(), { image: { height: 2056 } })).status).toBe(400);
    expect((await t.call('PATCH', nodeUrl(), { image: { count: 9 } })).status).toBe(400);
    expect((await t.ok<ChatNode>('PATCH', nodeUrl(), { image: { width: 864, height: 1280 } })).image).toMatchObject({ width: 864, height: 1280 });
    expect((await t.ok<ChatNode>('PATCH', nodeUrl(), { image: { width: 1216, height: 832 } })).image).toMatchObject({ width: 1216, height: 832, count: 2 });

    const fork = await t.ok<ChatNode>('POST', `${nodeUrl()}/fork`, { messageId: replyId });
    expect(fork.image).toMatchObject({ width: 1216, height: 832, count: 2 });
  });
});

describe('放大、部位重绘、出完的图上补做、预设', () => {
  const face = { on: true, detector: 'bbox/face_yolov8m.pt', sam: '', threshold: 0.3, denoise: 0.4, guideSize: 1024, positive: '', negative: '' };
  const hideNodes = (types: string[]) => fetch(`${comfyUrl}/_hide-nodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types }) });

  it('检测模型只列 .pt 的：同一个文件夹里的 SAM 不列，SAM 另列', async () => {
    const options = await t.ok<ComfyOptions>('GET', '/comfy/options');
    expect(options.detectors).toEqual(['bbox/face_yolov8m.pt', 'bbox/hand_yolov8s.pt', 'segm/person_yolov8m-seg.pt']);
    expect(options.sams).toEqual(['sam_vit_b_01ec64.pth']);
  });

  it('出图时放大、部位重绘：只记开着的，部位重绘写了的提示词拼上固定开头和默认负面词；出的图是放大后的尺寸', async () => {
    const messageId = await prepare('1girl, smile', {
      upscale: { on: true, model: '4x-test.pth', scale: 2, denoise: 0 },
      details: [face, { ...face, detector: 'bbox/hand_yolov8s.pt', positive: 'detailed hands', negative: 'extra fingers' }, { ...face, on: false, detector: 'segm/person_yolov8m-seg.pt' }],
    });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect(job.params.upscale).toEqual({ on: true, model: '4x-test.pth', scale: 2, denoise: 0 });
    expect(job.params.details).toEqual([
      face,
      { ...face, detector: 'bbox/hand_yolov8s.pt', positive: 'masterpiece, best quality, detailed hands', negative: `${FAMILY_DEFAULTS.IL.negative}, extra fingers` },
    ]);
    const done = await until(messageId, job.id, settled);
    expect(done.images[0]).toMatchObject({ status: 'done', width: 1664, height: 2432 });
    expect((await lastPrompts()).map((body) => body.prompt)).toEqual([builtinGraph(job.params, 100)]);
  });

  it('放大没选模型、开着的部位重绘没选检测模型，不让出', async () => {
    const messageId = await prepare('1girl', { upscale: { on: true, model: '', scale: 2, denoise: 0.35 } });
    expect(await t.call('POST', imagesUrl(messageId), { promptIndex: 0 })).toEqual({ status: 400, body: { error: '放大还没选放大模型，在出图设置里选一个' } });
    await t.ok('PATCH', nodeUrl(), { image: { upscale: { on: false, model: '', scale: 2, denoise: 0.35 }, details: [face, { ...face, detector: '' }] } });
    expect(await t.call('POST', imagesUrl(messageId), { promptIndex: 0 })).toEqual({ status: 400, body: { error: '部位重绘第 2 道还没选检测模型' } });
    await t.ok('PATCH', nodeUrl(), { image: { details: [face, { ...face, on: false, detector: '' }] } });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect(job.params.details).toEqual([face]);
    await until(messageId, job.id, settled);
  });

  it('这台 ComfyUI 没装 Impact Pack：开了部位重绘的一张都不发，说要装哪个插件', async () => {
    await hideNodes(['FaceDetailer']);
    const messageId = await prepare('1girl', { details: [face] });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    const done = await until(messageId, job.id, settled);
    expect(done.images[0]).toMatchObject({ status: 'failed', error: '这台 ComfyUI 缺插件：object_info 里没有 FaceDetailer，要装 ComfyUI-Impact-Pack' });
    expect(await lastPrompts()).toEqual([]);
  });

  it('出完的图上补做：传上去的是那张图，流程从 LoadImage 开始，挂在同一个框下；补做出的图再来，还是补做原来那张', async () => {
    const messageId = await prepare('1girl, smile');
    const first = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    const original = (await until(messageId, first.id, settled)).images[0];
    const refine = { jobId: first.id, index: 0, upscale: { on: true, model: '4x-test.pth', scale: 1.5, denoise: 0.3 }, details: [face] };
    expect(await t.call('POST', imagesUrl(messageId), { refine: { ...refine, upscale: { ...refine.upscale, on: false }, details: [] } })).toEqual({
      status: 400,
      body: { error: '放大和部位重绘至少开一样' },
    });

    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { refine });
    expect(job).toMatchObject({ kind: 'refine', promptIndex: 0, source: { kind: 'generated', jobId: first.id, seed: 100 }, images: [{ seed: 100, status: 'queued' }] });
    expect(job.params).toMatchObject({ positive: first.params.positive, negative: first.params.negative, checkpoint: 'il-test.safetensors', width: 832, height: 1216, upscale: refine.upscale, details: [face] });
    const done = await until(messageId, job.id, settled);
    expect(done.images[0]).toMatchObject({ status: 'done', width: 1248, height: 1824 });

    const sha = createHash('sha256')
      .update(await fs.readFile(path.join(t.work, original.file!)))
      .digest('hex');
    const uploads = (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string; bytes: number; sha256: string }[];
    expect(uploads).toEqual([{ name: `media-agent-${sha.slice(0, 16)}.png`, bytes: expect.any(Number), sha256: sha }]);
    expect((await lastPrompts()).at(-1)!.prompt).toEqual(builtinGraph(job.params, 100, { image: uploads[0].name }));

    const again = await t.ok<ImageJob>('POST', imagesUrl(messageId), { again: { jobId: job.id, index: 0, sameSeed: true } });
    expect(again).toMatchObject({ kind: 'refine', source: { kind: 'generated', jobId: first.id, seed: 100 }, params: job.params });
    await until(messageId, again.id, settled);
    expect((await lastPrompts()).at(-1)!.prompt).toEqual(builtinGraph(job.params, 100, { image: uploads[0].name }));

    // 原图的临时文件清掉了又没下载过：补做不了
    await fs.rm(path.join(t.work, original.file!));
    expect(await t.call('POST', imagesUrl(messageId), { refine })).toEqual({ status: 409, body: { error: '这张图的临时文件清掉了，也没下载过，没法补做' } });
  });

  it('预设：按系列存，同一个系列名字不能重；不存张数和种子；改名、换设置、删除', async () => {
    const settings = { ...defaultImageSettings(FAMILY_DEFAULTS.IL), checkpoint: 'il-test.safetensors', count: 3, seed: 5, upscale: { on: true, model: '4x-test.pth', scale: 2, denoise: 0 }, details: [face] };
    const { count: _count, seed: _seed, ...stored } = settings;
    const created = await t.ok<ImagePreset>('POST', '/image-presets', { name: 'E02', family: 'IL', settings });
    expect(created).toMatchObject({ name: 'E02', family: 'IL', settings: stored });
    expect(created.settings).not.toHaveProperty('count');
    expect(created.settings).not.toHaveProperty('seed');
    expect(await t.call('POST', '/image-presets', { name: 'E02', family: 'IL', settings })).toEqual({ status: 409, body: { error: 'IL 系列已经有叫「E02」的预设' } });
    expect((await t.call('POST', '/image-presets', { name: 'E02', family: 'Pony', settings })).status).toBe(201);
    expect((await t.call('POST', '/image-presets', { name: '尺寸不对', family: 'IL', settings: { ...settings, width: 1001 } })).status).toBe(400);
    expect((await t.call('POST', '/image-presets', { name: '倍数不对', family: 'IL', settings: { ...settings, upscale: { ...settings.upscale, scale: 3 } } })).status).toBe(400);

    expect((await t.ok<ImagePreset>('PATCH', `/image-presets/${created.id}`, { name: 'E02 新' })).name).toBe('E02 新');
    expect((await t.ok<ImagePreset>('PATCH', `/image-presets/${created.id}`, { settings: { steps: 20 } })).settings).toMatchObject({ steps: 20, checkpoint: 'il-test.safetensors', details: [face] });
    expect(await t.ok<ImagePreset[]>('GET', '/image-presets')).toHaveLength(2);
    await t.ok('DELETE', `/image-presets/${created.id}`);
    expect((await t.ok<ImagePreset[]>('GET', '/image-presets')).map((preset) => preset.family)).toEqual(['Pony']);
    expect(JSON.parse(await fs.readFile(path.join(t.work, 'image-presets.json'), 'utf8'))).toHaveLength(1);
  });
});

describe('局部重绘', () => {
  // 要重画的地方做成透明的 PNG：底图和掩码是同一张，只改透明度、颜色照留
  async function maskPng(width: number, height: number, hole: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        raw[i] = 51;
        raw[i + 1] = 102;
        raw[i + 2] = 204;
        raw[i + 3] = x >= hole.x && x < hole.x + hole.width && y >= hole.y && y < hole.y + hole.height ? 0 : 255;
      }
    }
    return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  }

  const uploads = async () => (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string; bytes: number; sha256: string }[];
  const inpaintUrl = (messageId: string, jobId: string, index = 0) => `${imagesUrl(messageId)}/${jobId}/${index}/inpaint`;

  it('在一张出的图上拖框重绘：掩码原样落盘、传上去的是它，流程照 E05，挂在同一个框下，参数里记着从哪张来', async () => {
    const messageId = await prepare('1girl, smile');
    const first = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    const original = (await until(messageId, first.id, settled)).images[0];
    expect(original).toMatchObject({ status: 'done', width: 832, height: 1216 });

    const png = await maskPng(832, 1216, { x: 100, y: 120, width: 200, height: 160 });
    const job = await t.ok<ImageJob>('POST', inpaintUrl(messageId, first.id), { mask: png.toString('base64'), positive: '1girl, smile', negative: 'nsfw', denoise: 0.8 });
    expect(job).toMatchObject({ kind: 'inpaint', promptIndex: 0, source: { kind: 'generated', jobId: first.id, seed: 100 }, images: [{ status: 'queued' }] });
    expect(job.params).toMatchObject({
      family: 'IL',
      positive: 'masterpiece, best quality, 1girl, smile',
      negative: `${FAMILY_DEFAULTS.IL.negative}, nsfw`,
      checkpoint: 'il-test.safetensors',
      width: 832,
      height: 1216,
      inpaint: { denoise: 0.8 },
    });
    // 那张 PNG 落在临时文件夹里（「已清理」那套跟着适用），内容一个字节都没动
    expect(job.params.inpaint!.mask).toMatch(/^image-temp\/\d{4}-\d{2}-\d{2}\/\d{6}-mask\.png$/);
    expect(await fs.readFile(path.join(t.work, job.params.inpaint!.mask))).toEqual(png);

    const done = await until(messageId, job.id, settled);
    expect(done.images[0]).toMatchObject({ status: 'done', width: 832, height: 1216 });
    const sent = await uploads();
    // 两张：掩码那张，和原图（大图窗口那条的底图就是出过的那张）；合成一张的话要重画那块会变黑
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ name: `media-agent-${createHash('sha256').update(png).digest('hex').slice(0, 16)}.png`, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') });
    expect((await lastPrompts()).at(-1)!.prompt).toEqual(inpaintGraph(job.params, done.images[0].seed, { mask: sent[0].name, image: sent[1].name }));

    // 「只换种子再来」重新上传存下的那张（按内容算名字，还是同一个），不用再涂
    const again = await t.ok<ImageJob>('POST', imagesUrl(messageId), { again: { jobId: job.id, index: 0, sameSeed: false } });
    expect(again).toMatchObject({ kind: 'inpaint', params: job.params, source: { kind: 'generated', jobId: first.id, seed: 100 } });
    const second = await until(messageId, again.id, settled);
    expect(second.images[0].seed).not.toBe(done.images[0].seed);
    const resent = await uploads();
    expect(resent).toHaveLength(2);
    expect((await lastPrompts()).at(-1)!.prompt).toEqual(inpaintGraph(job.params, second.images[0].seed, { mask: resent[0].name, image: resent[1].name }));
  });

  it('正面、负面空着就用原图那组的；掩码不是 PNG、强度超出、那张图找不到都拦下来', async () => {
    const messageId = await prepare('1girl, smile');
    const first = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    const original = (await until(messageId, first.id, settled)).images[0];
    const png = (await maskPng(832, 1216, { x: 10, y: 10, width: 40, height: 40 })).toString('base64');

    const job = await t.ok<ImageJob>('POST', inpaintUrl(messageId, first.id), { mask: png, denoise: 1 });
    expect(job.params).toMatchObject({ positive: first.params.positive, negative: first.params.negative, inpaint: { denoise: 1 } });
    await until(messageId, job.id, settled);

    expect(await t.call('POST', inpaintUrl(messageId, first.id), { mask: '不是图', denoise: 1 })).toEqual({ status: 400, body: { error: '掩码要是 base64 的 PNG' } });
    expect(await t.call('POST', inpaintUrl(messageId, first.id), { mask: Buffer.from('不是 PNG 的字节').toString('base64'), denoise: 1 })).toEqual({ status: 400, body: { error: '掩码要是 base64 的 PNG' } });
    expect(await t.call('POST', inpaintUrl(messageId, first.id), { mask: png, denoise: 0 })).toEqual({ status: 400, body: { error: '重绘强度要大于 0、不超过 1' } });
    expect(await t.call('POST', inpaintUrl(messageId, first.id), { mask: png, denoise: 1.5 })).toEqual({ status: 400, body: { error: '重绘强度要大于 0、不超过 1' } });
    expect(await t.call('POST', inpaintUrl(messageId, first.id, 3), { mask: png, denoise: 1 })).toMatchObject({ status: 404 });

    // 原图的临时文件清掉了又没下载过：重绘不了
    await fs.rm(path.join(t.work, original.file!));
    expect(await t.call('POST', inpaintUrl(messageId, first.id), { mask: png, denoise: 1 })).toEqual({ status: 409, body: { error: '这张图的临时文件清掉了，也没下载过，没法重绘' } });
  });

  it('缺 ComfyUI-Inpaint-CropAndStitch 时一张都不发，说要装哪个插件', async () => {
    const messageId = await prepare('1girl, smile');
    const first = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    await until(messageId, first.id, settled);
    const png = (await maskPng(832, 1216, { x: 10, y: 10, width: 40, height: 40 })).toString('base64');
    await fetch(`${comfyUrl}/_hide-nodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types: ['InpaintCropImproved'] }) });
    // 刚装了插件、刚卸了插件，界面上点「刷新」重读一次节点列表（见 5.18）
    await t.ok('GET', '/comfy/options?refresh=1');

    const job = await t.ok<ImageJob>('POST', inpaintUrl(messageId, first.id), { mask: png, denoise: 1 });
    const failed = await until(messageId, job.id, settled);
    expect(failed.images[0].error).toContain('InpaintCropImproved');
    expect(failed.images[0].error).toContain('ComfyUI-Inpaint-CropAndStitch');
    expect(await uploads()).toEqual([]);
  });
});

describe('ControlNet', () => {
  const hideNodes = (types: string[]) => fetch(`${comfyUrl}/_hide-nodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types }) });
  const uploads = async () => (await (await fetch(`${comfyUrl}/_uploads`)).json()) as { name: string; bytes: number; sha256: string }[];
  const sha256 = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const depth = (image: RefImage | null): ControlSettings => ({ on: true, type: 'depth', image, preprocessor: 'MiDaS-DepthMapPreprocessor', model: 'depth-test.safetensors', strength: 1, start: 0, end: 1 });

  it('槽位里的图做参考：传上去的是画布里存的那张，流程里先提取再接 ControlNet，记进这一组；同样参数再来时再传一次', async () => {
    const options = await t.ok<ComfyOptions>('GET', '/comfy/options');
    expect(options.controlnets).toEqual(['openpose-test.safetensors', 'depth-test.safetensors', 'union-test.safetensors']);
    expect(options.preprocessors).toContain('MiDaS-DepthMapPreprocessor');

    const imageId = await t.addImage(canvasId, '#3366cc');
    await t.ok('PATCH', nodeUrl(), { slots: [imageId] });
    const messageId = await prepare('1girl, smile', { controls: [depth({ kind: 'slot', imageId })] });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect(job.params.controls).toEqual([depth({ kind: 'slot', imageId })]);
    expect((await until(messageId, job.id, settled)).images[0]).toMatchObject({ status: 'done', width: 832, height: 1216 });

    const record = (await t.ok<CanvasDetail>('GET', `/canvases/${canvasId}`)).images[imageId];
    const sha = await sha256(path.join(t.work, 'canvases', canvasId, 'images', `${record.sha256}.${record.ext}`));
    const name = `media-agent-${sha.slice(0, 16)}.jpg`;
    expect(await uploads()).toEqual([{ name, bytes: expect.any(Number), sha256: sha }]);
    const sent = (await lastPrompts()).at(-1)!.prompt;
    expect(sent).toEqual(builtinGraph(job.params, 100, { controls: [name] }));

    const again = await t.ok<ImageJob>('POST', imagesUrl(messageId), { again: { jobId: job.id, index: 0, sameSeed: true } });
    expect(again.params.controls).toEqual(job.params.controls);
    await until(messageId, again.id, settled);
    expect((await lastPrompts()).at(-1)!.prompt).toEqual(sent);
  });

  it('出过的图做参考、选了不提取、模型是 union 的：直接用那张，告诉 union 是哪种', async () => {
    const messageId = await prepare('1girl');
    const first = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    const original = (await until(messageId, first.id, settled)).images[0];
    const ref: RefImage = { kind: 'generated', messageId, jobId: first.id, seed: 100 };
    await t.ok('PATCH', nodeUrl(), { image: { controls: [{ ...depth(ref), type: 'pose', preprocessor: 'none', model: 'union-test.safetensors' }] } });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect((await until(messageId, job.id, settled)).images[0]).toMatchObject({ status: 'done' });

    const sent = Object.values((await lastPrompts()).at(-1)!.prompt as ComfyGraph);
    expect(sent.some((node) => node.class_type === 'AIO_Preprocessor')).toBe(false);
    expect(sent.find((node) => node.class_type === 'SetUnionControlNetType')!.inputs.type).toBe('openpose');
    expect((await uploads()).at(-1)!.sha256).toBe(await sha256(path.join(t.work, original.file!)));
  });

  it('开着的没选参考图、没选模型不让出，关着的不管；起点比终点大、强度超出、类型不对的不收；预设不存参考图', async () => {
    const messageId = await prepare('1girl', { controls: [depth({ kind: 'slot', imageId: 'x' }), depth(null)] });
    expect(await t.call('POST', imagesUrl(messageId), { promptIndex: 0 })).toEqual({ status: 400, body: { error: 'ControlNet 第 2 个还没选参考图' } });
    await t.ok('PATCH', nodeUrl(), { image: { controls: [{ ...depth({ kind: 'slot', imageId: 'x' }), model: '' }] } });
    expect(await t.call('POST', imagesUrl(messageId), { promptIndex: 0 })).toEqual({ status: 400, body: { error: 'ControlNet 第 1 个还没选模型' } });
    expect(await t.call('PATCH', nodeUrl(), { image: { controls: [{ ...depth(null), start: 0.8, end: 0.2 }] } })).toEqual({ status: 400, body: { error: 'ControlNet 的起点不能比终点大' } });
    expect((await t.call('PATCH', nodeUrl(), { image: { controls: [{ ...depth(null), strength: 3 }] } })).status).toBe(400);
    expect((await t.call('PATCH', nodeUrl(), { image: { controls: [{ ...depth(null), type: 'style' }] } })).status).toBe(400);

    await t.ok('PATCH', nodeUrl(), { image: { controls: [{ ...depth(null), on: false }] } });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect(job.params).not.toHaveProperty('controls');
    await until(messageId, job.id, settled);

    const preset = await t.ok<ImagePreset>('POST', '/image-presets', { name: '深度', family: 'IL', settings: { controls: [depth({ kind: 'slot', imageId: 'x' })] } });
    expect(preset.settings.controls).toEqual([depth(null)]);
    // P15 之前存的预设没有 ControlNet，读的时候补成空的
    const file = path.join(t.work, 'image-presets.json');
    const [stored] = JSON.parse(await fs.readFile(file, 'utf8')) as ImagePreset[];
    const { controls: _controls, ...older } = stored.settings;
    await fs.writeFile(file, JSON.stringify([{ ...stored, settings: older }]));
    expect((await t.ok<ImagePreset[]>('GET', '/image-presets'))[0].settings.controls).toEqual([]);
  });

  it('参考图找不到了，这组算失败，说是哪个 ControlNet；没装 AIO_Preprocessor，要提取的一张都不发，说要装哪个插件，不提取的照发', async () => {
    const messageId = await prepare('1girl', { controls: [depth({ kind: 'slot', imageId: 'gone' })] });
    const lost = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect((await until(messageId, lost.id, settled)).images[0]).toMatchObject({
      status: 'failed',
      error: 'ControlNet「深度」的参考图找不到了：删掉了，或者临时文件清掉了又没下载过',
    });

    await hideNodes(['AIO_Preprocessor']);
    await t.ok('GET', '/comfy/options?refresh=1');
    const imageId = await t.addImage(canvasId, '#cc6633');
    await t.ok('PATCH', nodeUrl(), { image: { controls: [depth({ kind: 'slot', imageId })] } });
    const missing = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect((await until(messageId, missing.id, settled)).images[0]).toMatchObject({
      status: 'failed',
      error: '这台 ComfyUI 缺插件：object_info 里没有 AIO_Preprocessor，要装 comfyui_controlnet_aux',
    });
    expect(await lastPrompts()).toEqual([]);

    await t.ok('PATCH', nodeUrl(), { image: { controls: [{ ...depth({ kind: 'slot', imageId }), preprocessor: 'none' }] } });
    const plain = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect((await until(messageId, plain.id, settled)).images[0]).toMatchObject({ status: 'done' });
  });
});

describe('E02 的几样', () => {
  const face = { on: true, detector: 'bbox/face_yolov8m.pt', sam: 'sam_vit_b_01ec64.pth', threshold: 0.2, denoise: 0.5, guideSize: 1024, positive: '', negative: '' };
  const e02 = {
    width: 864,
    height: 1280,
    vae: 'sdxl_vae.safetensors',
    loras: [{ name: 'detail-test.safetensors', strength: 1 }],
    loraTarget: 'model',
    weighting: 'a1111',
    details: [face],
  };
  const hideNodes = (types: string[]) => fetch(`${comfyUrl}/_hide-nodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types }) });

  it('默认的不记；都打开：记进这一组，流程里换成单独的 VAE、只作用在画图模型上的 LoRA、A1111 的编码、SAM，尺寸 864×1280；同样参数再来、补做照用', async () => {
    const options = await t.ok<ComfyOptions>('GET', '/comfy/options');
    expect(options.vaes).toContain('sdxl_vae.safetensors');

    const plainId = await prepare('1girl');
    const plain = await t.ok<ImageJob>('POST', imagesUrl(plainId), { promptIndex: 0 });
    for (const key of ['vae', 'loraTarget', 'weighting']) expect(plain.params).not.toHaveProperty(key);
    await until(plainId, plain.id, settled);

    const messageId = await prepare('1girl, (smile:1.2)', e02);
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect(job.params).toMatchObject({ width: 864, height: 1280, vae: 'sdxl_vae.safetensors', loraTarget: 'model', weighting: 'a1111', details: [face] });
    expect((await until(messageId, job.id, settled)).images[0]).toMatchObject({ status: 'done', width: 864, height: 1280 });
    const sent = (await lastPrompts()).at(-1)!.prompt as ComfyGraph;
    expect(sent).toEqual(builtinGraph(job.params, 100));
    const types = Object.values(sent).map((node) => node.class_type);
    for (const type of ['VAELoader', 'LoraLoaderModelOnly', 'BNK_CLIPTextEncodeAdvanced', 'SAMLoader']) expect(types).toContain(type);
    expect(Object.values(sent).find((node) => node.class_type === 'EmptyLatentImage')!.inputs).toMatchObject({ width: 864, height: 1280 });

    const again = await t.ok<ImageJob>('POST', imagesUrl(messageId), { again: { jobId: job.id, index: 0, sameSeed: true } });
    expect(again.params).toEqual(job.params);
    await until(messageId, again.id, settled);
    expect((await lastPrompts()).at(-1)!.prompt).toEqual(sent);

    // 节点改回默认的以后，在那张上补做：底模、VAE、LoRA 和权重算法用那张图的
    await t.ok('PATCH', nodeUrl(), { image: { vae: '', loraTarget: 'both', weighting: 'comfy' } });
    const refined = await t.ok<ImageJob>('POST', imagesUrl(messageId), { refine: { jobId: job.id, index: 0, upscale: { on: false, model: '', scale: 2, denoise: 0.35 }, details: [face] } });
    expect(refined.params).toMatchObject({ vae: 'sdxl_vae.safetensors', loraTarget: 'model', weighting: 'a1111', width: 864, height: 1280 });
    await until(messageId, refined.id, settled);
  });

  it('权重算法、LoRA 作用在哪只能是那两种，部位重绘的每道要带 SAM（空着是不用）；预设能存自己填的尺寸，P16 之前存的预设按默认的补上', async () => {
    expect(await t.call('PATCH', nodeUrl(), { image: { weighting: 'compel' } })).toEqual({ status: 400, body: { error: '权重算法只能是 comfy、a1111' } });
    expect(await t.call('PATCH', nodeUrl(), { image: { loraTarget: 'clip' } })).toEqual({ status: 400, body: { error: 'LoRA 作用在哪只能是 both、model' } });
    expect((await t.call('PATCH', nodeUrl(), { image: { vae: null } })).status).toBe(400);
    const { sam: _sam, ...noSam } = face;
    expect(await t.call('PATCH', nodeUrl(), { image: { details: [noSam] } })).toEqual({ status: 400, body: { error: 'SAM 模型格式不对' } });

    const settings = { ...defaultImageSettings(FAMILY_DEFAULTS.IL), checkpoint: 'il-test.safetensors', ...e02 };
    const preset = await t.ok<ImagePreset>('POST', '/image-presets', { name: 'E02', family: 'IL', settings });
    expect(preset.settings).toMatchObject(e02);

    const file = path.join(t.work, 'image-presets.json');
    const [stored] = JSON.parse(await fs.readFile(file, 'utf8')) as ImagePreset[];
    const { vae: _vae, loraTarget: _loraTarget, weighting: _weighting, ...older } = stored.settings;
    await fs.writeFile(file, JSON.stringify([{ ...stored, settings: { ...older, details: [noSam] } }]));
    expect((await t.ok<ImagePreset[]>('GET', '/image-presets'))[0].settings).toMatchObject({ vae: '', loraTarget: 'both', weighting: 'comfy', details: [{ ...face, sam: '' }] });
  });

  it('选了 A1111 的权重算法、这台 ComfyUI 没装那个插件：一张都不发，说要装哪个插件', async () => {
    await hideNodes(['BNK_CLIPTextEncodeAdvanced']);
    const messageId = await prepare('1girl', { weighting: 'a1111' });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect((await until(messageId, job.id, settled)).images[0]).toMatchObject({
      status: 'failed',
      error: '这台 ComfyUI 缺插件：object_info 里没有 BNK_CLIPTextEncodeAdvanced，要装 ComfyUI_ADV_CLIP_emb',
    });
    expect(await lastPrompts()).toEqual([]);
  });
});

// ComfyUI 自带的文生图「导出（API）」的样子，最后存图
const API_WORKFLOW: ComfyGraph = {
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 5, steps: 20, cfg: 8, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    _meta: { title: 'KSampler' },
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'pony-test.safetensors' }, _meta: { title: 'Load Checkpoint' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 }, _meta: { title: 'Empty Latent Image' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'beautiful scenery', clip: ['4', 1] }, _meta: { title: '正面' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'text, watermark', clip: ['4', 1] }, _meta: { title: '负面' } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['8', 0] } },
};
const FILL = {
  positive: { node: '6', input: 'text' },
  negative: { node: '7', input: 'text' },
  seed: { node: '3', input: 'seed' },
  width: { node: '5', input: 'width' },
  height: { node: '5', input: 'height' },
};

describe('导入的工作流', () => {
  const create = (body: Record<string, unknown> = {}) => t.ok<ImportedWorkflow>('POST', '/workflows', { name: '基础文生图', file: 'basic-api.json', graph: API_WORKFLOW, fill: FILL, ...body });

  it('导入存进工作文件夹 workflows；名字重了、普通格式、往哪填对不上的不收；能改名、重新指定往哪填；删除挪进回收站', async () => {
    const workflow = await create();
    expect(workflow).toMatchObject({ name: '基础文生图', file: 'basic-api.json', graph: API_WORKFLOW, fill: FILL });
    expect(workflow.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(await fs.readFile(path.join(t.work, 'workflows', `${workflow.id}.json`), 'utf8'))).toEqual(workflow);
    expect(await t.ok('GET', '/workflows')).toEqual([workflow]);

    expect(await t.call('POST', '/workflows', { name: '基础文生图', file: 'a.json', graph: API_WORKFLOW, fill: FILL })).toEqual({
      status: 409,
      body: { error: '已经有叫「基础文生图」的工作流，换一个名字' },
    });
    expect((await t.call('POST', '/workflows', { name: '普通格式', file: 'a.json', graph: { nodes: [], links: [] }, fill: FILL })).body).toEqual({
      error: '这是普通的工作流文件，不是 API 格式。请在 ComfyUI 里用「导出（API）」再存一份',
    });
    expect((await t.call('POST', '/workflows', { name: '对不上', file: 'a.json', graph: API_WORKFLOW, fill: { ...FILL, seed: { node: '6', input: 'text' } } })).body).toEqual({
      error: '种子要填的 6 号节点的 text 在工作流里不是数',
    });
    expect((await t.call('POST', '/workflows', { name: '没有正面', file: 'a.json', graph: API_WORKFLOW, fill: { ...FILL, positive: null } })).status).toBe(400);

    const renamed = await t.ok<ImportedWorkflow>('PATCH', `/workflows/${workflow.id}`, { name: '改过名的', fill: { ...FILL, negative: null, width: null, height: null } });
    expect(renamed).toEqual({ ...workflow, name: '改过名的', fill: { ...FILL, negative: null, width: null, height: null } });

    await t.ok('DELETE', `/workflows/${workflow.id}`);
    expect(await t.ok('GET', '/workflows')).toEqual([]);
    expect((await fs.readdir(path.join(t.work, '.trash'))).some((name) => name.endsWith(`-workflow-${workflow.id}.json`))).toBe(true);
    expect((await t.call('DELETE', `/workflows/${workflow.id}`)).status).toBe(404);
  });

  it('选导入的工作流出图：只换正面、负面、种子、尺寸，别的照原样；参数里记工作流，不记底模这些；取存下来的那张', async () => {
    const workflow = await create();
    const messageId = await prepare('1girl, smile', { workflowId: workflow.id, count: 2 });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect(job.params).toEqual({
      family: 'IL',
      positive: 'masterpiece, best quality, 1girl, smile',
      negative: FAMILY_DEFAULTS.IL.negative,
      workflow: { id: workflow.id, name: '基础文生图', hash: workflow.hash },
      width: 832,
      height: 1216,
    });
    const done = await until(messageId, job.id, settled);
    expect(done.images.map((image) => [image.status, image.width, image.height])).toEqual([
      ['done', 832, 1216],
      ['done', 832, 1216],
    ]);
    expect(done.params.checkpoint).toBeUndefined();
    expect((await lastPrompts()).map((body) => body.prompt)).toEqual([importedGraph(workflow, job.params, 100), importedGraph(workflow, job.params, 101)]);
  });

  it('缺插件的一张都不发，说出缺哪几种节点；工作流删了，节点换回内置流程，照着它出的图再来就说删了', async () => {
    const lacking = await create({ name: '缺插件的', graph: { ...API_WORKFLOW, '10': { class_type: 'NotInstalledTestNode', inputs: { image: ['8', 0] } } } });
    const messageId = await prepare('1girl', { workflowId: lacking.id });
    const job = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect((await until(messageId, job.id, settled)).images).toEqual([{ seed: 100, status: 'failed', error: '这台 ComfyUI 缺插件：object_info 里没有 NotInstalledTestNode' }]);
    expect(await lastPrompts()).toEqual([]);

    const workflow = await create();
    await t.ok('PATCH', nodeUrl(), { image: { workflowId: workflow.id } });
    const first = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    await until(messageId, first.id, settled);
    await t.ok('DELETE', `/workflows/${workflow.id}`);

    const again = await t.ok<ImageJob>('POST', imagesUrl(messageId), { again: { jobId: first.id, index: 0, sameSeed: true } });
    expect((await until(messageId, again.id, settled)).images[0].error).toBe('工作流「基础文生图」已经删了，在出图设置里换一个再出');
    const builtin = await t.ok<ImageJob>('POST', imagesUrl(messageId), { promptIndex: 0 });
    expect(builtin.params.workflow).toEqual(BUILTIN_WORKFLOW);
    const done = await until(messageId, builtin.id, settled);
    expect((await lastPrompts()).at(-1)!.prompt).toEqual(builtinGraph(done.params, 100));
  });
});
