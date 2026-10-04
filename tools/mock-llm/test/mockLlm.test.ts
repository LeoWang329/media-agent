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

  it('翻译：系统消息里写着「翻译成某种语言」时，第一行标出语言和要求，后面接原文', () => {
    const translate = (system: string) => planReply([{ role: 'system', content: system }, userMessage('summary:\n测试概述')]).reply;
    expect(translate('把用户发来的 MiniMax H3 视频提示词翻译成日文。')).toBe('译文（日文）\nsummary:\n测试概述');
    expect(translate('把用户发来的 MiniMax H3 视频提示词翻译成英文。\n\n用户对这次翻译的要求（和上面冲突时以这里为准）：\n台词也翻译')).toBe(
      '译文（英文），按要求：台词也翻译\nsummary:\n测试概述',
    );
  });

  it('生图：系统消息带着生图的格式要求时，标题是「测试图片」，框里是一串标签，「三个方向」出三个框；转标签只回四个标签', () => {
    const image: ChatMessage = { role: 'system', content: '输出格式要求：\n1. 框里只放英文标签，用英文逗号隔开。' };
    const one = planReply([image, userMessage('写一个')]).reply;
    expect(one).toContain('<title>测试图片</title>');
    expect(one).toContain('<prompt>\n1girl, solo, long hair, blond hair, goldish hair, smile, hatsune miku\n</prompt>');
    const three = planReply([image, userMessage('给我三个方向')]).reply;
    expect(three.match(/^<prompt label="方向.：[^"]+">\n1girl, solo/gm)).toHaveLength(3);

    const toTags = planReply([{ role: 'system', content: '把用户发来的中文描述转成 Danbooru 标签。' }, userMessage('坐在窗边看书')]);
    expect(toTags.reply).toBe('sitting, window, book, reading');
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

  it('思考：开着思考的参数先发 reasoning_content 再出正文，正文最后一行写出收到的参数；关着的参数只写这一行', async () => {
    const deltas = async (body: object) => {
      const raw = await (await complete({ messages: [userMessage('写一个')], stream: true, ...body })).text();
      return raw
        .split('\n')
        .filter((line) => line.startsWith('data: {'))
        .map((line) => JSON.parse(line.slice(6)).choices[0]?.delta ?? {});
    };

    const on = await deltas({ reasoning_effort: 'high' });
    const firstContent = on.findIndex((d) => d.content);
    expect(on.slice(0, firstContent).map((d) => d.reasoning_content).join('')).toBe('思考：先弄清用户要什么，再按要求的格式写出来。');
    expect(on.map((d) => d.content ?? '').join('')).toMatch(/\n思考参数：\{"reasoning_effort":"high"\}$/);

    const off = await deltas({ thinking: { type: 'disabled' } });
    expect(off.some((d) => d.reasoning_content)).toBe(false);
    expect(off.map((d) => d.content ?? '').join('')).toMatch(/\n思考参数：\{"thinking":\{"type":"disabled"\}\}$/);

    const reasoner = await deltas({ model: 'deepseek-reasoner' });
    expect(reasoner.some((d) => d.reasoning_content)).toBe(true);
  });
});
