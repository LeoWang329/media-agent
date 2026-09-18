import express from 'express';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRICING } from '@media-agent/shared';
import { createMockLlmApp } from '../../../tools/mock-llm/src/app';
import { createApp } from '../src/app';

const REF_PROMPT = fileURLToPath(new URL('../../../docs/prompts/ref2va.md', import.meta.url));

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function baseUrlOf(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

let mockLlm: Server;
let unauthorized: Server;
let tmp: string;
let app: express.Express;

beforeAll(async () => {
  mockLlm = await listen(createMockLlmApp());
  const rejecting = express();
  rejecting.post('/v1/chat/completions', (_req, res) => {
    res.status(401).json({ error: { message: 'invalid api key' } });
  });
  unauthorized = await listen(rejecting);
});

afterAll(async () => {
  await close(mockLlm);
  await close(unauthorized);
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'media-agent-test-'));
  app = createApp({ configDir: path.join(tmp, 'config') });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function modelConfig(id: string, baseUrl: string, apiKey = 'sk-secret') {
  return { id, name: id, baseUrl, apiKey, model: 'mock-model', imageLongSide: 1600, pricing: DEFAULT_PRICING };
}

const readJsonFile = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));

describe('本机配置', () => {
  it('没有配置文件时返回空配置', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workFolder: null, modelConfigs: [], assetFolders: [], lastCollageFolder: null });
  });

  it('设工作文件夹：建好目录、复制默认提示词，再设一次不覆盖已改过的提示词', async () => {
    expect((await request(app).put('/api/config').send({ workFolder: 'relative/work' })).status).toBe(400);

    const workFolder = path.join(tmp, 'work');
    const res = await request(app).put('/api/config').send({ workFolder });
    expect(res.status).toBe(200);
    expect(res.body.workFolder).toBe(workFolder);

    const defaultPrompt = path.join(workFolder, 'prompts', 'ref2va.md');
    expect(await fs.readFile(defaultPrompt, 'utf8')).toBe(await fs.readFile(REF_PROMPT, 'utf8'));
    for (const name of ['i2v', 't2v']) expect((await fs.stat(path.join(workFolder, 'prompts', `${name}.md`))).isFile()).toBe(true);
    for (const dir of ['prompts/.history', 'canvases', '.trash']) {
      expect((await fs.stat(path.join(workFolder, dir))).isDirectory()).toBe(true);
    }
    expect((await readJsonFile(path.join(tmp, 'config', 'config.json'))).workFolder).toBe(workFolder);

    await fs.writeFile(defaultPrompt, '改过的提示词');
    await request(app).put('/api/config').send({ workFolder }).expect(200);
    expect(await fs.readFile(defaultPrompt, 'utf8')).toBe('改过的提示词');
  });

  it('工作文件夹状态：没设时 400；设好后能写入，数得出画布、系统提示词和模型配置', async () => {
    expect((await request(app).get('/api/work-folder')).status).toBe(400);

    const workFolder = path.join(tmp, 'work');
    await request(app).put('/api/config').send({ workFolder }).expect(200);
    await request(app).post('/api/canvases').send({ title: '一张画布' }).expect(201);
    await request(app).put('/api/config').send({ modelConfigs: [modelConfig('m1', 'http://x/v1')] }).expect(200);

    const res = await request(app).get('/api/work-folder');
    expect(res.body).toEqual({ path: workFolder, writable: true, canvases: 1, prompts: 5, modelConfigs: 1 });
    expect((await fs.readdir(workFolder)).some((name) => name.startsWith('.write-test'))).toBe(false);
  });

  it('模型配置存工作文件夹、key 按 id 存本机；读取时打码，提交打码值不改 key，删掉配置 key 也删掉', async () => {
    expect((await request(app).put('/api/config').send({ modelConfigs: [] })).status).toBe(400);

    const workFolder = path.join(tmp, 'work');
    await request(app).put('/api/config').send({ workFolder }).expect(200);
    const first = await request(app).put('/api/config').send({ modelConfigs: [modelConfig('m1', 'http://x/v1'), modelConfig('m2', 'http://y/v1', 'sk-2')] });
    expect(first.body.modelConfigs.map((m: { apiKey: string }) => m.apiKey)).toEqual(['******', '******']);

    expect(await readJsonFile(path.join(workFolder, 'model-configs.json'))).toEqual([
      { id: 'm1', name: 'm1', baseUrl: 'http://x/v1', model: 'mock-model', imageLongSide: 1600, pricing: DEFAULT_PRICING },
      { id: 'm2', name: 'm2', baseUrl: 'http://y/v1', model: 'mock-model', imageLongSide: 1600, pricing: DEFAULT_PRICING },
    ]);
    expect((await readJsonFile(path.join(tmp, 'config', 'config.json'))).apiKeys).toEqual({ m1: 'sk-secret', m2: 'sk-2' });

    const renamed = { ...modelConfig('m1', 'http://x/v1', '******'), name: '改名' };
    await request(app).put('/api/config').send({ modelConfigs: [renamed] }).expect(200);
    expect((await readJsonFile(path.join(workFolder, 'model-configs.json')))[0].name).toBe('改名');
    expect((await readJsonFile(path.join(tmp, 'config', 'config.json'))).apiKeys).toEqual({ m1: 'sk-secret' });

    const invalid = { ...modelConfig('m1', 'http://x/v1'), imageLongSide: null };
    expect((await request(app).put('/api/config').send({ modelConfigs: [invalid] })).status).toBe(400);
    const negative = { ...modelConfig('m1', 'http://x/v1'), pricing: { ...DEFAULT_PRICING, input: -1 } };
    expect((await request(app).put('/api/config').send({ modelConfigs: [negative] })).status).toBe(400);
  });

  it('换到另一个工作文件夹，读的是那里的模型配置，本机有这个 id 的 key 就带上', async () => {
    const workA = path.join(tmp, 'a');
    await request(app).put('/api/config').send({ workFolder: workA }).expect(200);
    await request(app).put('/api/config').send({ modelConfigs: [modelConfig('m1', 'http://x/v1')] }).expect(200);

    // 模拟同步盘：另一台机器上的工作文件夹里已经有同一份模型配置
    const workB = path.join(tmp, 'b');
    await fs.mkdir(workB);
    await fs.copyFile(path.join(workA, 'model-configs.json'), path.join(workB, 'model-configs.json'));
    const res = await request(app).put('/api/config').send({ workFolder: workB });
    expect(res.body.modelConfigs).toEqual([{ ...modelConfig('m1', 'http://x/v1'), apiKey: '******' }]);

    const otherMachine = createApp({ configDir: path.join(tmp, 'other-config') });
    const there = await request(otherMachine).put('/api/config').send({ workFolder: workB });
    expect(there.body.modelConfigs[0].apiKey).toBe('');
  });
});

describe('测试连接', () => {
  it('对 mock-llm 成功；连不上、返回错误码、找不到配置时报出原因', async () => {
    const closed = await listen(express());
    const closedBaseUrl = baseUrlOf(closed);
    await close(closed);

    await request(app).put('/api/config').send({ workFolder: path.join(tmp, 'work') }).expect(200);
    const modelConfigs = [
      modelConfig('mock', baseUrlOf(mockLlm)),
      modelConfig('refused', closedBaseUrl),
      modelConfig('unauthorized', baseUrlOf(unauthorized)),
    ];
    await request(app).put('/api/config').send({ modelConfigs }).expect(200);
    const test = (modelConfigId: string) => request(app).post('/api/llm/test').send({ modelConfigId });

    expect((await test('mock')).body).toEqual({ ok: true });

    const refused = await test('refused');
    expect(refused.body.ok).toBe(false);
    expect(refused.body.error).toContain('ECONNREFUSED');

    const rejected = await test('unauthorized');
    expect(rejected.body).toEqual({ ok: false, error: 'HTTP 401：{"error":{"message":"invalid api key"}}' });

    expect((await test('missing')).status).toBe(404);
  });
});
