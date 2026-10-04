import type { AutodlState, ComfyOptions, ModelTransfer, RemoteModels } from '@media-agent/shared';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockComfy, type MockComfy } from '../../../tools/mock-comfyui/src/app';
import { MOCK_AUTODL_PATH, MOCK_AUTODL_TOKEN, MOCK_AUTODL_UUID } from '../../../tools/mock-comfyui/src/autodl';
import { MOCK_SSH_PASSWORD } from '../../../tools/mock-comfyui/src/ssh';
import { sleep, startTestApp, type TestApp } from './helpers';

// 往 AutoDL 那台传模型，见 docs/dev-plan.md 5.22。对 mock-comfyui 里假的 AutoDL 和它上面假的 SSH：
// 文件落在 mock 的临时文件夹里，开机 100 毫秒，隔 20 毫秒查一次

let t: TestApp;
let mock: MockComfy;
let comfyUrl: string;
const seen: unknown[] = [];

const LORAS = '/root/autodl-tmp/models/loras';
const UPSCALE = '/root/autodl-tmp/models/upscale_models';
const onRemote = (remote: string) => mock.ssh.local(remote);

beforeEach(async () => {
  mock = createMockComfy({ stepMs: 15, autodl: { bootMs: 100, stopMs: 50 } });
  await new Promise<void>((resolve) => mock.server.listen(0, '127.0.0.1', () => resolve()));
  await new Promise<void>((resolve) => mock.ssh.server.listen(0, '127.0.0.1', () => resolve()));
  comfyUrl = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
  t = await startTestApp({ autodl: { api: `${comfyUrl}${MOCK_AUTODL_PATH}`, pollMs: 20, bootTimeoutMs: 1500, minuteMs: 40 }, models: { pollMs: 20 } });
  await t.ok('PUT', '/config', { autodlToken: MOCK_AUTODL_TOKEN });
  await t.ok('PUT', '/settings', { comfy: { autodl: { instanceUuid: MOCK_AUTODL_UUID, idleMinutes: 5 } } });
  seen.length = 0;
});

afterEach(async () => {
  // 哪个返回里都不能带着 SSH 的密码
  expect(JSON.stringify(seen)).not.toContain(MOCK_SSH_PASSWORD);
  await t.cleanup();
  await mock.close();
});

async function call<T = any>(method: string, url: string, body?: unknown) {
  const res = await t.call<T>(method, url, body);
  seen.push(res.body);
  return res;
}

// 从电脑传：请求体就是文件
async function upload(id: string, params: Record<string, string>, body: NonNullable<RequestInit['body']>, size: number): Promise<{ status: number; body: any }> {
  const query = new URLSearchParams({ id, size: String(size), ...params });
  // 没收完文件就出错、停了的，服务回完话就断开连接，这边可能只拿到连接断了
  const res = await fetch(`${t.base}/comfy/autodl/models/upload?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body, duplex: 'half' } as RequestInit).catch(() => null);
  const result = res ? { status: res.status, body: await res.json() } : { status: 0, body: null };
  seen.push(result.body);
  return result;
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

const transfers = async () => (await call<ModelTransfer[]>('GET', '/comfy/autodl/models/transfers')).body;
const transferOf = async (id: string) => (await transfers()).find((one) => one.id === id)!;
const loras = async () => (await call<ComfyOptions>('GET', '/comfy/options?target=autodl')).body.loras;

describe('往 AutoDL 那台传模型', () => {
  it('实例关着时列不出来；从电脑传之前看一眼会先开机，同名的有没有、空间够不够', async () => {
    expect(await call('GET', '/comfy/autodl/models')).toEqual({ status: 409, body: { error: '实例关着，开机后才看得到' } });
    expect(await call('POST', '/comfy/autodl/models/check', { kind: 'lora', folder: 'IL', name: 'a.safetensors', size: 1000 })).toEqual({
      status: 200,
      body: { free: 14 * 1024 ** 3 },
    });
    expect(((await call<AutodlState>('GET', '/comfy/status?target=autodl')).body).state).toBe('running');

    fs.mkdirSync(onRemote(`${LORAS}/IL`), { recursive: true });
    fs.writeFileSync(onRemote(`${LORAS}/IL/a.safetensors`), 'old');
    expect(await call('POST', '/comfy/autodl/models/check', { kind: 'lora', folder: 'IL', name: 'a.safetensors', size: 1000 })).toEqual({
      status: 409,
      body: { error: '那台上已经有「IL/a.safetensors」了' },
    });
    expect((await call('POST', '/comfy/autodl/models/check', { kind: 'lora', folder: 'IL', name: 'a.safetensors', size: 1000, replace: true })).status).toBe(200);

    mock.ssh.state.free = 500 * 1024 ** 2;
    expect(await call('POST', '/comfy/autodl/models/check', { kind: 'checkpoint', folder: '', name: 'big.safetensors', size: 6.5 * 1024 ** 3 })).toEqual({
      status: 400,
      body: { error: '那台只剩 500.0 MB，这个文件 6.5 GB，还差 6.0 GB' },
    });
  });

  it('子文件夹和文件名带 ..、/ 开头、.part 结尾的不收；类型不对的不收', async () => {
    const check = (body: object) => call('POST', '/comfy/autodl/models/check', { kind: 'lora', folder: '', name: 'a.safetensors', size: 1, ...body });
    expect(await check({ folder: '../x' })).toEqual({ status: 400, body: { error: '子文件夹里不能有 ..、\\ 或空的一段' } });
    expect(await check({ folder: '/root' })).toEqual({ status: 400, body: { error: '子文件夹不能以 / 开头' } });
    expect(await check({ name: 'a/b.safetensors' })).toEqual({ status: 400, body: { error: '文件名里不能有 / 或 \\' } });
    expect(await check({ name: 'a.safetensors.part' })).toEqual({ status: 400, body: { error: '文件名不能以 .part 结尾，没传完的文件用这个' } });
    expect(await check({ kind: 'script' })).toEqual({ status: 400, body: { error: '模型类型不对' } });
    await t.ok('POST', '/comfy/autodl/power', { on: true });
    await until(async () => (await call<AutodlState>('GET', '/comfy/status?target=autodl')).body.state, (state) => state === 'running');
    expect(await call('DELETE', '/comfy/autodl/models', { kind: 'lora', path: '../../../etc/passwd' })).toEqual({ status: 400, body: { error: '子文件夹里不能有 ..、\\ 或空的一段' } });
  });

  it('从电脑传：先写成 .part 再改成真名字，列表里有、出图设置的 LoRA 里马上有；删掉以后都没了', async () => {
    const data = Buffer.alloc(300_000, 3);
    const res = await upload('upload-0001', { kind: 'lora', folder: 'IL', name: 'mine.safetensors' }, data, data.length);
    expect(res).toMatchObject({ status: 200, body: { id: 'upload-0001', way: 'upload', kind: 'lora', path: 'IL/mine.safetensors', done: data.length, total: data.length, state: 'done' } });
    expect(fs.readFileSync(onRemote(`${LORAS}/IL/mine.safetensors`)).equals(data)).toBe(true);
    expect(fs.existsSync(onRemote(`${LORAS}/IL/mine.safetensors.part`))).toBe(false);
    expect(mock.ssh.commands).toContain(`mkdir -p '${LORAS}/IL' && cat > '${LORAS}/IL/mine.safetensors.part'`);

    const listed = (await call<RemoteModels>('GET', '/comfy/autodl/models')).body;
    expect(listed.free).toBe(14 * 1024 ** 3);
    expect(listed.files).toEqual([{ kind: 'lora', path: 'IL/mine.safetensors', bytes: data.length, modifiedAt: expect.any(String), partial: false }]);
    // 传完服务端就重读了节点列表，不用点刷新
    expect(await loras()).toContain('IL/mine.safetensors');

    // 同名再传，不说换掉的不收；原因在传输列表里
    expect([0, 409]).toContain((await upload('upload-0002', { kind: 'lora', folder: 'IL', name: 'mine.safetensors' }, data, data.length)).status);
    expect(await transferOf('upload-0002')).toMatchObject({ state: 'failed', error: '那台上已经有「IL/mine.safetensors」了' });
    expect((await upload('upload-0003', { kind: 'lora', folder: 'IL', name: 'mine.safetensors', replace: '1' }, Buffer.alloc(10, 1), 10)).body.state).toBe('done');
    expect(fs.statSync(onRemote(`${LORAS}/IL/mine.safetensors`)).size).toBe(10);

    expect((await call('DELETE', '/comfy/autodl/models', { kind: 'lora', path: 'IL/mine.safetensors' })).status).toBe(204);
    expect(fs.existsSync(onRemote(`${LORAS}/IL/mine.safetensors`))).toBe(false);
    expect((await call<RemoteModels>('GET', '/comfy/autodl/models')).body.files).toEqual([]);
    await until(loras, (names) => !names.includes('IL/mine.safetensors'));
  });

  it('从电脑传到一半点停：删掉半截的，算停了；传的时候实例算忙，不会被空闲关机', async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await sleep(20);
        controller.enqueue(new Uint8Array(10_000));
        if ((sent += 1) === 200) controller.close();
      },
    });
    const pending = upload('upload-slow1', { kind: 'lora', folder: '', name: 'slow.safetensors' }, body as never, 2_000_000);
    await until(() => transferOf('upload-slow1'), (one) => Boolean(one) && one.done > 0);
    expect((await call<AutodlState>('GET', '/comfy/status?target=autodl')).body.busyWith).toEqual(['models']);
    expect((await call('POST', '/comfy/autodl/models/transfers/upload-slow1/stop')).status).toBe(200);
    await pending;
    expect(await until(() => transferOf('upload-slow1'), (one) => one.state !== 'running')).toMatchObject({ state: 'stopped' });
    await until(async () => fs.existsSync(onRemote(`${LORAS}/slow.safetensors.part`)), (exists) => !exists);
    expect(fs.existsSync(onRemote(`${LORAS}/slow.safetensors`))).toBe(false);
    expect((await call<AutodlState>('GET', '/comfy/status?target=autodl')).body.busyWith).toEqual([]);
  });

  it('给链接让那台下：一个一个下，有进度；HuggingFace 本站的换成国内镜像；连不上的说 curl 的原话', async () => {
    const link = `${comfyUrl}/_files/4x-mine.pth?bytes=50000&ms=200`;
    const first = await call<ModelTransfer>('POST', '/comfy/autodl/models/download', { kind: 'upscale', url: link, folder: '', name: '' });
    expect(first).toMatchObject({ status: 201, body: { way: 'download', kind: 'upscale', path: '4x-mine.pth', total: 50000, state: 'queued' } });
    const hf = await call<ModelTransfer>('POST', '/comfy/autodl/models/download', {
      kind: 'bbox',
      url: 'https://huggingface.co/Bingsu/adetailer/resolve/main/hand_yolov8s.pt',
      folder: '',
      name: '',
    });
    expect(hf).toMatchObject({ status: 201, body: { kind: 'bbox', path: 'hand_yolov8s.pt', url: 'https://hf-mirror.com/Bingsu/adetailer/resolve/main/hand_yolov8s.pt', total: 4096 } });

    const done = await until(transfers, (all) => all.every((one) => one.state === 'done'));
    expect(done.map((one) => [one.path, one.done])).toEqual([
      ['4x-mine.pth', 50000],
      ['hand_yolov8s.pt', 4096],
    ]);
    expect(fs.statSync(onRemote(`${UPSCALE}/4x-mine.pth`)).size).toBe(50000);
    expect(fs.existsSync(onRemote('/root/ComfyUI/models/ultralytics/bbox/hand_yolov8s.pt'))).toBe(true);
    const options = (await call<ComfyOptions>('GET', '/comfy/options?target=autodl')).body;
    expect(options.upscaleModels).toContain('4x-mine.pth');
    expect(options.detectors).toContain('bbox/hand_yolov8s.pt');
    // 第二个等第一个下完才开始
    const commands = mock.ssh.commands.filter((command) => command.includes('exec curl'));
    expect(commands).toEqual([
      `mkdir -p '${UPSCALE}' && exec curl -fsSL -o '${UPSCALE}/4x-mine.pth.part' '${link}'`,
      `mkdir -p '/root/ComfyUI/models/ultralytics/bbox' && exec curl -fsSL -o '/root/ComfyUI/models/ultralytics/bbox/hand_yolov8s.pt.part' 'https://hf-mirror.com/Bingsu/adetailer/resolve/main/hand_yolov8s.pt'`,
    ]);

    expect(await call('POST', '/comfy/autodl/models/download', { kind: 'lora', url: 'https://civitai.com/api/download/models/12345', folder: '', name: 'x.safetensors' })).toEqual({
      status: 502,
      body: { error: '那台下不了这个链接：curl: (28) Failed to connect to civitai.com port 443 after 30000 ms: Timeout was reached' },
    });
    expect(await call('POST', '/comfy/autodl/models/download', { kind: 'lora', url: 'ftp://x/y', folder: '', name: '' })).toEqual({
      status: 400,
      body: { error: '链接要以 http:// 或 https:// 开头' },
    });
  });

  it('给链接下到一半点停、下不了的：删掉半截的', async () => {
    const slow = await call<ModelTransfer>('POST', '/comfy/autodl/models/download', { kind: 'lora', url: `${comfyUrl}/_files/slow.safetensors?bytes=100000&ms=3000`, folder: '', name: '' });
    await until(() => transferOf(slow.body.id), (one) => one.done > 0);
    await call('POST', `/comfy/autodl/models/transfers/${slow.body.id}/stop`);
    expect(await until(() => transferOf(slow.body.id), (one) => one.state !== 'running')).toMatchObject({ state: 'stopped' });
    expect(fs.existsSync(onRemote(`${LORAS}/slow.safetensors.part`))).toBe(false);

    const missing = await call<ModelTransfer>('POST', '/comfy/autodl/models/download', { kind: 'lora', url: `${comfyUrl}/_files/gone.safetensors?status=404`, folder: '', name: '' });
    expect(missing.body.total).toBeNull();
    expect(await until(() => transferOf(missing.body.id), (one) => one.state !== 'queued' && one.state !== 'running')).toMatchObject({
      state: 'failed',
      error: '那台下不了这个链接：curl: (22) The requested URL returned error: 404',
    });
    expect(fs.existsSync(onRemote(`${LORAS}/gone.safetensors.part`))).toBe(false);
  });
});
