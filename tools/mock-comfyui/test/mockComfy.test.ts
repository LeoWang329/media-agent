import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createMockComfy, type MockComfy } from '../src/app';

let mock: MockComfy;
let base: string;

beforeEach(async () => {
  mock = createMockComfy({ stepMs: 10, slowStepMs: 200 });
  await new Promise<void>((resolve) => mock.server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await mock.close();
});

const graph = (positive: string, ckpt = 'il-test.safetensors') => ({
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
  '2': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
  '3': { class_type: 'EmptyLatentImage', inputs: { width: 640, height: 512, batch_size: 1 } },
  '4': { class_type: 'KSampler', inputs: { seed: 9, sampler_name: 'euler', scheduler: 'normal', positive: ['2', 0], latent_image: ['3', 0] } },
  '5': { class_type: 'PreviewImage', inputs: { images: ['4', 0] } },
});

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();
const get = (path: string) => json(fetch(`${base}${path}`));

// 连上 WebSocket，收下全部消息
async function listen(clientId: string) {
  const messages: { type: string; data: Record<string, unknown> }[] = [];
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?clientId=${clientId}`);
  ws.on('message', (data) => messages.push(JSON.parse(String(data))));
  await new Promise((resolve) => ws.once('open', resolve));
  const until = async (done: () => boolean) => {
    while (!done()) await new Promise((resolve) => setTimeout(resolve, 10));
  };
  return { messages, ws, until };
}

describe('mock-comfyui', () => {
  it('object_info 两种下拉写法都有，system_stats 照真的格式', async () => {
    const info = await get('/object_info');
    expect(info.CheckpointLoaderSimple.input.required.ckpt_name[0]).toEqual(['il-test.safetensors', 'pony-test.safetensors']);
    expect(info.KSampler.input.required.sampler_name[0]).toBe('COMBO');
    const stats = await get('/system_stats');
    expect(stats.system.comfyui_version).toBeTruthy();
    expect(stats.devices[0].vram_total).toBeGreaterThan(0);
  });

  it('底模不在列表里返回 node_errors；没有的节点类型返回 invalid_prompt', async () => {
    const bad = await post('/prompt', { prompt: graph('1girl', 'missing.safetensors'), client_id: 'x' });
    expect(bad.status).toBe(400);
    const body = await json(bad);
    expect(body.node_errors['1'].class_type).toBe('CheckpointLoaderSimple');
    expect(body.node_errors['1'].errors[0].details).toContain("ckpt_name: 'missing.safetensors' not in");

    const unknown = await post('/prompt', { prompt: { '1': { class_type: 'NoSuchNode', inputs: {} } }, client_id: 'x' });
    expect((await json(unknown)).error.type).toBe('invalid_prompt');
  });

  it('跑一个任务：按真的顺序推送，出完的图在 history 里，按尺寸画好', async () => {
    const { messages, ws, until } = await listen('client-a');
    const { prompt_id } = await json(post('/prompt', { prompt: graph('1girl, smile'), client_id: 'client-a' }));
    await until(() => messages.some((m) => m.type === 'executing' && m.data.node === null));
    ws.close();

    const types = messages.filter((m) => m.data.prompt_id === prompt_id).map((m) => (m.type === 'executing' ? `executing:${m.data.node}` : m.type));
    expect(types).toEqual([
      'execution_start',
      'execution_cached',
      'executing:4',
      'progress',
      'progress',
      'progress',
      'progress',
      'progress',
      'executing:5',
      'executed',
      'execution_success',
      'executing:null',
    ]);
    const entry = (await get(`/history/${prompt_id}`))[prompt_id];
    expect(entry.status).toMatchObject({ status_str: 'success', completed: true });
    const ref = entry.outputs['5'].images[0];
    const image = await fetch(`${base}/view?${new URLSearchParams(ref)}`);
    expect(await sharp(Buffer.from(await image.arrayBuffer())).metadata()).toMatchObject({ format: 'png', width: 640, height: 512 });
  });

  it('队列里的能删，正在跑的能停；出错的写进 history', async () => {
    const { messages, ws, until } = await listen('client-b');
    const first = (await json(post('/prompt', { prompt: graph('慢'), client_id: 'client-b' }))).prompt_id;
    const second = (await json(post('/prompt', { prompt: graph('慢'), client_id: 'client-b' }))).prompt_id;
    const queue = await get('/queue');
    expect(queue.queue_pending.map((row: unknown[]) => row[1])).toContain(second);

    await post('/queue', { delete: [second] });
    await until(() => messages.some((m) => m.type === 'progress' && m.data.prompt_id === first));
    await post('/interrupt', { prompt_id: first });
    await until(() => messages.some((m) => m.type === 'execution_interrupted'));
    expect(await get('/queue')).toEqual({ queue_running: [], queue_pending: [] });

    const failed = (await json(post('/prompt', { prompt: graph('显存'), client_id: 'client-b' }))).prompt_id;
    await until(() => messages.some((m) => m.type === 'execution_error'));
    ws.close();
    expect(messages.find((m) => m.type === 'execution_error')?.data.exception_message).toContain('CUDA out of memory');
    const entry = (await get(`/history/${failed}`))[failed];
    expect(entry.status.status_str).toBe('error');
    expect(await get('/_last-prompts')).toHaveLength(3);
  });
});
