import { builtinGraph, imageErrorKind, type AutodlState, type ChatNode, type ComfyOptions, type ImageJob, type ImageJobEvent, type Message } from '@media-agent/shared';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockComfy, type MockComfy } from '../../../tools/mock-comfyui/src/app';
import { MOCK_AUTODL_PATH, MOCK_AUTODL_TOKEN, MOCK_AUTODL_UUID, MOCK_AUTODL_VIDEO_UUID } from '../../../tools/mock-comfyui/src/autodl';
import { sleep, startTestApp, type TestApp } from './helpers';

// AutoDL：Token 和实例的设置、列实例、出图时自动开机、空闲到点自动关机、手动开关机、开机失败、退出时关机，见 docs/dev-plan.md 5.17。
// 用 mock-comfyui 里假的 AutoDL：开机 100 毫秒后变运行中。时间都调小了：隔 20 毫秒查一次，一「分钟」是 40 毫秒，开机最多等 1.5 秒

const MINUTE_MS = 40;

// AutoDL 边缘在老域名上回的那张 404 页，正文照真的抄（真的正文里有 autodl.com/docs/port 这个链接）
const EDGE_404 =
  '<!DOCTYPE html>\n<html>\n<head>\n<title>Not Found</title>\n<style>\nbody { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }\n</style>\n</head>\n<body>\n<h1>404 Not Found</h1>\n<p><a href="https://www.autodl.com/docs/port/">查看FAQ文档</a>.</p>\n</body>\n</html>';

let t: TestApp;
let mock: MockComfy;
let comfyUrl: string;
let canvasId: string;
let nodeId: string;
let replyId: string;
// AutoDL 快照里给的 6006 域名，默认指回 mock 自己；测换域名时改它
let where: { domain: string };
// 假的 AutoDL 边缘：老域名返回上面那张 404 页
let edge: http.Server | null = null;

const nodeUrl = () => `/canvases/${canvasId}/nodes/${nodeId}`;
const imagesUrl = () => `${nodeUrl()}/messages/${replyId}/images`;
const readJsonFile = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
const hostOf = (url: string) => url.replace(/^https?:\/\//, '');

// 老域名活着，但上面没有 ComfyUI：AutoDL 边缘替它回 404。返回它的地址（只有域名和端口）
function staleDomain(): Promise<string> {
  edge = http.createServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(EDGE_404);
  });
  return new Promise((resolve) => edge!.listen(0, '127.0.0.1', () => resolve(`127.0.0.1:${(edge!.address() as AddressInfo).port}`)));
}

beforeEach(async () => {
  where = { domain: '' };
  mock = createMockComfy({ stepMs: 15, slowStepMs: 100, autodl: { bootMs: 100, stopMs: 50, domain: () => where.domain } });
  await new Promise<void>((resolve) => mock.server.listen(0, '127.0.0.1', () => resolve()));
  comfyUrl = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
  where.domain = hostOf(comfyUrl);
  t = await startTestApp({ autodl: { api: `${comfyUrl}${MOCK_AUTODL_PATH}`, pollMs: 20, bootTimeoutMs: 1500, minuteMs: MINUTE_MS } });
  await fs.mkdir(path.join(t.work, 'tags'), { recursive: true });
  await fs.writeFile(path.join(t.work, 'tags', 'tags.csv'), 'tag,category,count,deprecated\n1girl,0,8000000,0\n');
  await fs.writeFile(path.join(t.work, 'tags', 'aliases.csv'), 'alias,tag\n');
  await fs.writeFile(path.join(t.work, 'tags', 'info.json'), '{ "updatedAt": "2026-09-01" }');
  await t.ok('PUT', '/prompts/il', { text: '---\n用途: 生图\n底模: IL\n---\n只写标签' });
  canvasId = (await t.ok('POST', '/canvases', { title: '出图' })).id;
  nodeId = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0, kind: 'image' })).id;
  replyId = ((await t.stream(`${nodeUrl()}/send`, { parentId: null, text: '写一个' })).at(-1) as { message: Message }).message.id;
  await t.ok('PATCH', nodeUrl(), { image: { checkpoint: 'il-test.safetensors', count: 1, seed: 100 } });
});

afterEach(async () => {
  if (edge) {
    edge.closeAllConnections();
    await new Promise((resolve) => edge!.close(resolve));
    edge = null;
  }
  await t.cleanup();
  await mock.close();
});

// 用 AutoDL 出图：填好 Token、选好实例，出图切到 AutoDL
async function useAutodl(idleMinutes = 5) {
  await t.ok('PUT', '/config', { autodlToken: MOCK_AUTODL_TOKEN, comfyTarget: 'autodl' });
  await t.ok('PUT', '/settings', { comfy: { autodl: { instanceUuid: MOCK_AUTODL_UUID, idleMinutes } } });
}

const status = () => t.ok<AutodlState>('GET', '/comfy/status?target=autodl');

async function readJob(jobId: string): Promise<ImageJob | undefined> {
  return (await t.ok<ChatNode>('GET', nodeUrl())).messages[replyId].images?.find((job) => job.id === jobId);
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等太久了：${JSON.stringify(value)}`);
    await sleep(10);
  }
}

const settled = (job: ImageJob | undefined) => Boolean(job?.images.every((image) => image.status !== 'queued' && image.status !== 'running'));

// 等这一组出完、停了或者失败了
const settledJob = async (jobId: string, timeoutMs?: number) => (await until(() => readJob(jobId), settled, timeoutMs))!;

// 收推来的 AutoDL 状态
async function watchAutodl() {
  const controller = new AbortController();
  const res = await fetch(`${t.base}/image-jobs/events`, { signal: controller.signal });
  const states: AutodlState[] = [];
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
        for (const block of blocks) {
          if (!block.startsWith('data: ')) continue;
          const event = JSON.parse(block.slice(6)) as ImageJobEvent;
          if (event.type === 'autodl') states.push(event);
        }
      }
    } catch {
      // 测试结束时断开
    }
  })();
  return { states, close: () => controller.abort() };
}

describe('AutoDL', () => {
  it('Token 和出图用哪台只存本机，GET 打码；实例和空闲多久关机存工作文件夹，分钟只能 5 到 240', async () => {
    await useAutodl(15);
    const config = await t.ok('GET', '/config');
    expect(config).toMatchObject({ comfyTarget: 'autodl', autodlToken: '******' });
    expect(await readJsonFile(path.join(t.configDir, 'config.json'))).toMatchObject({ comfyTarget: 'autodl', autodlToken: MOCK_AUTODL_TOKEN });
    const shared = await readJsonFile(path.join(t.work, 'settings.json'));
    expect(shared.comfy).toEqual({ lanUrl: null, autodl: { instanceUuid: MOCK_AUTODL_UUID, idleMinutes: 15 }, videoAutodl: { instanceUuid: null, idleMinutes: 15 } });
    expect(JSON.stringify(shared)).not.toContain(MOCK_AUTODL_TOKEN);

    // 打码的那串是没改，空着是清掉
    await t.ok('PUT', '/config', { autodlToken: '******' });
    expect((await readJsonFile(path.join(t.configDir, 'config.json'))).autodlToken).toBe(MOCK_AUTODL_TOKEN);
    await t.ok('PUT', '/config', { autodlToken: '' });
    expect((await t.ok('GET', '/config')).autodlToken).toBeNull();
    expect((await t.call('PUT', '/config', { comfyTarget: 'cloud' })).status).toBe(400);

    for (const idleMinutes of [4, 241, 7.5]) expect((await t.call('PUT', '/settings', { comfy: { autodl: { idleMinutes } } })).status).toBe(400);
    // 只改带了的项，局域网的地址不动
    await t.ok('PUT', '/settings', { comfy: { lanUrl: comfyUrl } });
    expect((await t.ok('PUT', '/settings', { comfy: { autodl: { idleMinutes: 30 } } })).comfy).toEqual({
      lanUrl: comfyUrl,
      autodl: { instanceUuid: MOCK_AUTODL_UUID, idleMinutes: 30 },
      videoAutodl: { instanceUuid: null, idleMinutes: 15 },
    });
  });

  it('列实例：没填 Token、Token 不对说清楚，带 AutoDL 的原话；对了列出名字、地区、显卡、每小时多少钱；实例不在了说不存在', async () => {
    expect((await t.call('GET', '/comfy/autodl/instances')).status).toBe(400);
    expect(await status()).toMatchObject({ state: 'unset' });

    await t.ok('PUT', '/config', { autodlToken: 'wrong-token' });
    const rejected = await t.call('GET', '/comfy/autodl/instances');
    expect(rejected.status).toBe(502);
    expect(rejected.body.error).toBe('Token 不对：AutoDL 返回「登录超时，请重新登录; 登录失败，请重试」。去设置里重新填开发者 Token');

    await t.ok('PUT', '/config', { autodlToken: MOCK_AUTODL_TOKEN });
    expect(await t.ok('GET', '/comfy/autodl/instances')).toEqual([
      {
        uuid: MOCK_AUTODL_UUID,
        name: 'ComfyUI-测试',
        region: '西北B区',
        gpu: 'vGPU-32GB',
        price: 1.68,
        status: 'shutdown',
        startedAt: null,
        stoppedAt: expect.any(String),
      },
      expect.objectContaining({ uuid: MOCK_AUTODL_VIDEO_UUID, name: 'H3-测试' }),
    ]);

    // 选了实例才查得到状态
    expect(await status()).toMatchObject({ state: 'unset' });
    await t.ok('PUT', '/settings', { comfy: { autodl: { instanceUuid: MOCK_AUTODL_UUID } } });
    expect(await status()).toMatchObject({ state: 'off', raw: 'shutdown', byApp: false, instance: { name: 'ComfyUI-测试', price: 1.68 } });

    await t.ok('PUT', '/settings', { comfy: { autodl: { instanceUuid: 'pro-gone' } } });
    expect(await status()).toMatchObject({ state: 'unknown', error: expect.stringContaining('实例不存在') });
  });

  it('出图时实例关着：先开机，开好了再发；推来正在开机、运行中；出完空闲到点自动关机', async () => {
    await useAutodl(5);
    const watcher = await watchAutodl();
    const job = await t.ok<ImageJob>('POST', imagesUrl(), { promptIndex: 0 });
    expect(job.target).toBe('autodl');

    const done = await settledJob(job.id);
    expect(done.images[0]).toMatchObject({ status: 'done' });
    expect(mock.autodl.calls[0]).toEqual({ action: 'power_on', body: { instance_uuid: MOCK_AUTODL_UUID, payload: 'gpu' } });
    const kinds = watcher.states.map((s) => s.state);
    expect(kinds.indexOf('booting')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('running')).toBeGreaterThan(kinds.indexOf('booting'));
    expect(watcher.states.find((s) => s.state === 'booting')?.since).toEqual(expect.any(Number));
    expect(watcher.states.find((s) => s.state === 'running')).toMatchObject({ byApp: true });

    // 出完了开始算空闲：5「分钟」后关机
    const idle = await until(status, (s) => s.state === 'running' && !s.busyWith.length && s.idleLeftMs !== null);
    expect(idle.idleLeftMs).toBeLessThanOrEqual(5 * MINUTE_MS);
    const off = await until(status, (s) => s.state === 'off');
    expect(off).toMatchObject({ byApp: false, idleLeftMs: null });
    expect(mock.autodl.calls.map((c) => c.action)).toEqual(['power_on', 'power_off']);
    watcher.close();
  });

  it('开着的直接用，不开机；出图时不算空闲，出完才开始算', async () => {
    await useAutodl(5);
    mock.autodl.instance.status = 'running';
    mock.autodl.instance.startedAt = new Date(Date.now() - 23 * 60_000).toISOString();
    expect(await status()).toMatchObject({ state: 'running', byApp: false, busyWith: [], upSince: Date.parse(mock.autodl.instance.startedAt) });

    await t.ok('PATCH', nodeUrl(), { image: { count: 3 } });
    const job = await t.ok<ImageJob>('POST', imagesUrl(), { promptIndex: 0 });
    const busy = await until(status, (s) => s.busyWith.includes('images'));
    expect(busy.idleLeftMs).toBeNull();
    await settledJob(job.id);
    expect((await readJob(job.id))!.images.map((image) => image.status)).toEqual(['done', 'done', 'done']);
    expect(mock.autodl.calls.filter((c) => c.action === 'power_on')).toEqual([]);
    await until(status, (s) => s.state === 'off');
  });

  it('AutoDL 换了 6006 的域名（重启、迁移都会换）：地址过期时说人话，点重读会重新问一次地址', async () => {
    await useAutodl(240);
    mock.autodl.instance.status = 'running';
    mock.autodl.instance.startedAt = new Date().toISOString();
    expect((await t.ok<ComfyOptions>('GET', '/comfy/options?target=autodl')).checkpoints.length).toBeGreaterThan(0);

    // 实例重启，AutoDL 分了个新域名，老的那个成了它边缘上的一张 404 页
    const stale = await staleDomain();
    where.domain = stale;
    mock.autodl.instance.startedAt = new Date(Date.now() + 60_000).toISOString();
    await status();

    // 开机时间变了：存的那个地址跟着作废，重新问了一次，打在老域名上。
    // 给用户看的得是人话，不是一堆 HTML
    const expired = await t.call('GET', '/comfy/options?target=autodl');
    expect(expired.status).toBe(502);
    expect(expired.body.error).toContain('AutoDL 的 6006 端口转发替它回了 404');
    expect(expired.body.error).not.toContain('<!DOCTYPE html>');

    // 又换了一次，这次开机时间没变，服务这边看不出来：不重读就还用存着的那个老地址
    where.domain = hostOf(comfyUrl);
    expect((await t.call('GET', '/comfy/options?target=autodl')).status).toBe(502);

    // 点「重新读底模和 LoRA 列表」：重新向 AutoDL 要一次地址，用新的那个
    expect((await t.ok<ComfyOptions>('GET', '/comfy/options?target=autodl&refresh=1')).checkpoints.length).toBeGreaterThan(0);
  });

  it('空闲到点时 ComfyUI 的队列里还有任务（比如在网页上直接出的图）就不关；队列空了，再空闲够了才关', async () => {
    await useAutodl(5);
    mock.autodl.instance.status = 'running';
    // 先用程序出一张，拿它的参数绕过程序直接往 ComfyUI 排一个慢的：5 步，一步 100 毫秒
    const job = await t.ok<ImageJob>('POST', imagesUrl(), { promptIndex: 0 });
    const { params } = await settledJob(job.id);
    const prompt = builtinGraph({ ...params, positive: `慢 ${params.positive}` }, 1);
    await fetch(`${comfyUrl}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: 'web' }) });

    // 过了 5「分钟」，那个任务还在跑，不关
    await sleep(6 * MINUTE_MS);
    expect(await status()).toMatchObject({ state: 'running' });
    expect(mock.autodl.calls).toEqual([]);

    // 它出完以后从头算空闲，又过了差不多 5「分钟」才关
    const queueEmpty = async () => {
      const queue = (await (await fetch(`${comfyUrl}/queue`)).json()) as { queue_running: unknown[]; queue_pending: unknown[] };
      return queue.queue_running.length + queue.queue_pending.length === 0;
    };
    await until(queueEmpty, Boolean);
    const emptyAt = Date.now();
    await until(status, (s) => s.state !== 'running');
    expect(Date.now() - emptyAt).toBeGreaterThanOrEqual(3 * MINUTE_MS);
    await until(status, (s) => s.state === 'off');
    expect(mock.autodl.calls.map((c) => c.action)).toEqual(['power_off']);
  });

  it('手动开机、关机；正在开机时点关机是「别开了」：等着开机的图算叫停，开好后马上关掉', async () => {
    await useAutodl(240);
    expect((await t.ok<AutodlState>('POST', '/comfy/autodl/power', { on: true })).state).toBe('booting');
    await until(status, (s) => s.state === 'running');
    expect((await t.ok<AutodlState>('POST', '/comfy/autodl/power', { on: false })).state).toBe('stopping');
    await until(status, (s) => s.state === 'off');
    expect(mock.autodl.calls.map((c) => c.action)).toEqual(['power_on', 'power_off']);

    const job = await t.ok<ImageJob>('POST', imagesUrl(), { promptIndex: 0 });
    // 开机请求发出去以后再点
    await until(async () => mock.autodl.calls.length, (n) => n === 3);
    await t.ok('POST', '/comfy/autodl/power', { on: false });
    const stopped = await settledJob(job.id, 1000);
    expect(stopped.images[0].status).toBe('stopped');
    await until(status, (s) => s.state === 'off');
    expect(mock.autodl.calls.map((c) => c.action)).toEqual(['power_on', 'power_off', 'power_on', 'power_off']);
    expect(mock.autodl.instance.status).toBe('shutdown');
  });

  it('开机失败：余额不够、等太久都说清楚，这组没发出去；失败的原因一直留着，下次开机才清掉', async () => {
    await useAutodl();
    mock.autodl.fail.power_on = { code: 'InsufficientBalance', msg: '账户余额不足，请充值后再开机' };
    const job = await t.ok<ImageJob>('POST', imagesUrl(), { promptIndex: 0 });
    const failed = await settledJob(job.id);
    expect(failed.images[0]).toMatchObject({ status: 'failed', error: 'AutoDL 开机失败：余额不够，开不了机：AutoDL 返回「账户余额不足，请充值后再开机」。充值后再开机' });
    expect(imageErrorKind(failed.images[0].error!)).toBe('boot');
    expect(await status()).toMatchObject({ state: 'failed', error: expect.stringContaining('余额不够') });

    // 一直在开机中：等到头算失败，说出 AutoDL 的状态原文
    mock.autodl.instance.status = 'starting';
    const slow = await t.ok<ImageJob>('POST', imagesUrl(), { promptIndex: 0 });
    const timedOut = await settledJob(slow.id);
    expect(timedOut.images[0].error).toBe('AutoDL 开机失败：等了 2 秒还没开好：实例状态一直是「starting」。可以再试一次，或者先用局域网那台');
  });

  it('开机时那台主机没有空闲的显卡：提示另选一台；说余额不足的不算', async () => {
    await useAutodl();
    mock.autodl.fail.power_on = { code: 'GpuNotEnough', msg: '主机GPU不足，请稍后再试' };
    const job = await t.ok<ImageJob>('POST', imagesUrl(), { promptIndex: 0 });
    const failed = await settledJob(job.id);
    expect(failed.images[0].error).toBe(
      'AutoDL 开机失败：这台所在的主机没有空闲的显卡，AutoDL 返回「主机GPU不足，请稍后再试」（GpuNotEnough）。去设置里另选一台实例，或者先用局域网那台，也可以过一会再开',
    );
    expect(imageErrorKind(failed.images[0].error!)).toBe('boot');

    mock.autodl.fail.power_on = { code: 'InternalError', msg: '当前算力规格暂无库存, 请修改配置或稍等再试' };
    const unavailable = await settledJob((await t.ok<ImageJob>('POST', imagesUrl(), { promptIndex: 0 })).id);
    expect(unavailable.images[0].error).toContain('这台所在的主机没有空闲的显卡');
    expect(unavailable.images[0].error).toContain('当前算力规格暂无库存');

    mock.autodl.fail.power_on = { code: 'Failed', msg: '账户余额不足，无法开启GPU实例' };
    const poor = await settledJob((await t.ok<ImageJob>('POST', imagesUrl(), { promptIndex: 0 })).id);
    expect(poor.images[0].error).toContain('余额不够，开不了机');
    expect(poor.images[0].error).not.toContain('显卡');
  });

  it('退出时：这次是程序开的机就关掉；不是程序开的不管', async () => {
    await useAutodl(240);
    await t.ok('POST', '/comfy/autodl/power', { on: true });
    await until(status, (s) => s.state === 'running');
    expect(await t.autodl().exit()).toBe('AutoDL 实例是程序开的，已经让它关机了');
    expect(mock.autodl.calls.map((c) => c.action)).toEqual(['power_on', 'power_off']);

    await t.restart();
    await until(async () => mock.autodl.instance.status, (s) => s === 'shutdown');
    mock.autodl.instance.status = 'running';
    expect(await status()).toMatchObject({ state: 'running', byApp: false });
    expect(await t.autodl().exit()).toBeNull();
    expect(mock.autodl.calls.map((c) => c.action)).toEqual(['power_on', 'power_off']);
  });
});
