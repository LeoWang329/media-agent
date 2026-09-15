import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockLlmApp } from '../src/app';
import { planReply, type ChatMessage, type ContentPart } from '../src/reply';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const s = createMockLlmApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const SYSTEM: ChatMessage = { role: 'system', content: '系统提示词' };

function userMessage(text: string, note?: string, pictures = 0): ChatMessage {
  const content: ContentPart[] = note ? [{ type: 'text', text: note }] : [];
  for (let n = 1; n <= pictures; n += 1) {
    content.push({ type: 'text', text: `<Picture ${n}>` }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
  }
  content.push({ type: 'text', text });
  return { role: 'user', content };
}

function complete(body: object, signal?: AbortSignal) {
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mock-model', ...body }),
    signal,
  });
}

describe('mock-llm', () => {
  it('默认回复：标题、收到几张图、说明、历史消息条数和一个六部分的提示词框', async () => {
    const note = '参考图共 2 张，编号如下。视频时长 8 秒，画面比例 16:9。';
    const res = await complete({ messages: [SYSTEM, userMessage('写一个', note, 2)] });
    const body = (await res.json()) as { choices: { message: { content: string } }[]; usage: { completion_tokens: number } };
    const text = body.choices[0].message.content;

    expect(text).toContain('<title>测试标题</title>');
    expect(text).toContain('收到 2 张图：<Picture 1>、<Picture 2>');
    expect(text).toContain(`说明：${note}`);
    expect(text).toContain('历史消息 1 条');
    expect(text.match(/^<prompt>$/gm)).toHaveLength(1);
    expect(text).toContain('summary:\n[reference generation] 测试概述，引用了 <Picture 1>');
    for (const part of ['subject_definitions:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:']) {
      expect(text).toContain(part);
    }
    expect(body.usage.completion_tokens).toBeGreaterThan(0);
  });

  it('流式：分段发出同样的内容，最后是 usage 和 [DONE]', async () => {
    const messages = [SYSTEM, userMessage('写一个'), { role: 'assistant', content: '上一版' }, userMessage('改一下')];
    const raw = await (await complete({ messages, stream: true })).text();
    const payloads = raw.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6));

    expect(payloads.at(-1)).toBe('[DONE]');
    const chunks = payloads.slice(0, -1).map((p) => JSON.parse(p));
    const text = chunks.map((c) => c.choices[0]?.delta?.content ?? '').join('');
    expect(text).toBe(planReply(messages).reply);
    expect(text).toContain('收到 0 张图');
    expect(text).toContain('历史消息 3 条');
    expect(chunks.at(-1).usage.total_tokens).toBeGreaterThan(0);
  });

  it('「三个方向」出三个带标签的框，「只回答」不出框，「报错」第一次返回 500、同样的文字再请求正常回复', async () => {
    const three = planReply([userMessage('给我三个方向')]).reply;
    expect(three.match(/^<prompt label="方向.：[^"]+">$/gm)).toHaveLength(3);

    expect(planReply([userMessage('只回答，这是什么')]).reply).not.toContain('<prompt');

    const messages = [userMessage(`报错 ${Date.now()}`)];
    expect((await complete({ messages })).status).toBe(500);
    expect((await complete({ messages })).status).toBe(200);
  });

  it('「慢」每段间隔 500 毫秒，客户端断开后服务照常工作', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const res = await complete({ messages: [userMessage('慢一点')], stream: true }, controller.signal);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    while ((received.match(/^data: /gm) ?? []).length < 2) {
      const { value } = await reader.read();
      received += decoder.decode(value, { stream: true });
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    controller.abort();

    const models = (await (await fetch(`${baseUrl}/models`)).json()) as { data: { id: string }[] };
    expect(models.data[0].id).toBe('mock-model');
  });
});
