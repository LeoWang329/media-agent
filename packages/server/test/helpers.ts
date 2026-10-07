import type { StreamEvent } from '@media-agent/shared';
import type express from 'express';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createMockLlmApp } from '../../../tools/mock-llm/src/app';
import { autodlOf, createApp, imageJobsOf, videoAutodlOf, videoJobsOf, type AppOptions } from '../src/app';

export function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

export async function close(server: Server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

export const urlOf = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 起一个用临时目录的服务，设好工作文件夹和指向 mock-llm 的模型配置
export async function startTestApp(options: Pick<AppOptions, 'tagSources' | 'autodl' | 'models'> = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'media-agent-test-'));
  const work = path.join(tmp, 'work');
  // 配置目录故意用点开头：macOS / Linux 上真实的配置目录就是 ~/.media-agent，
  // 这样缩略图缓存这类放在配置目录下的文件才会走和线上一样的路径形态
  const configDir = path.join(tmp, '.config');
  const mockLlm = await listen(createMockLlmApp());
  let app = createApp({ configDir, ...options });
  let server = await listen(app);
  let base = `${urlOf(server)}/api`;

  async function call<T = any>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }

  async function ok<T = any>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await call<T>(method, url, body);
    if (res.status >= 400) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  // 发一个会返回 SSE 的请求，读完整个流再返回全部事件
  async function stream<T = StreamEvent>(url: string, body: unknown): Promise<T[]> {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`POST ${url} → ${res.status} ${await res.text()}`);
    return (await res.text())
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice(6)));
  }

  // 在工作文件夹里生成一张 300×300 的图放进画布，返回 imageId；颜色不同内容就不同
  async function addImage(canvasId: string, color: string): Promise<string> {
    const file = path.join(work, 'test-images', `${color.slice(1)}.jpg`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, await sharp({ create: { width: 300, height: 300, channels: 3, background: color } }).jpeg().toBuffer());
    return (await ok('POST', `/canvases/${canvasId}/images`, { path: file })).id;
  }

  await ok('PUT', '/config', { workFolder: work });
  await ok('PUT', '/config', {
    modelConfigs: [{ id: 'mock', name: 'mock', baseUrl: `${urlOf(mockLlm)}/v1`, apiKey: 'test', model: 'mock-model', imageLongSide: 1600 }],
  });

  // 关掉服务、出图和生成视频任务的连接、两台 AutoDL 的计时
  async function shutdown() {
    imageJobsOf(app).close();
    autodlOf(app).close();
    videoJobsOf(app).close();
    videoAutodlOf(app).close();
    await close(server);
  }

  return {
    work,
    configDir,
    get base() {
      return base;
    },
    call,
    ok,
    stream,
    addImage,
    imageJobs: () => imageJobsOf(app),
    autodl: () => autodlOf(app),
    videoJobs: () => videoJobsOf(app),
    videoAutodl: () => videoAutodlOf(app),
    // 模拟程序重启：同一个本机配置目录、同一个工作文件夹，换一个新的服务
    async restart() {
      await shutdown();
      app = createApp({ configDir, ...options });
      server = await listen(app);
      base = `${urlOf(server)}/api`;
    },
    async cleanup() {
      await shutdown();
      await close(mockLlm);
      await fs.rm(tmp, { recursive: true, force: true });
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;
