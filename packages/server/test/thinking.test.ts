import type { Config, Message, PromptTranslation, SharedSettings, StreamEvent, ThinkingStyle } from '@media-agent/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
let nodeUrl: string;

beforeEach(async () => {
  t = await startTestApp();
  const canvasId = (await t.ok('POST', '/canvases', { title: '思考' })).id;
  nodeUrl = `/canvases/${canvasId}/nodes/${(await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0 })).id}`;
});

afterEach(async () => {
  await t.cleanup();
});

// 给 mock 那套模型配置换一种思考写法；GET 回来的密钥是打码的，原样送回表示不改
async function setStyle(thinkingStyle: ThinkingStyle, thinkingModel = '') {
  const config = await t.ok<Config>('GET', '/config');
  await t.ok('PUT', '/config', { modelConfigs: config.modelConfigs.map((m) => ({ ...m, thinkingStyle, thinkingModel })) });
}

const setThinking = (thinking: Partial<SharedSettings['thinking']>) => t.ok<SharedSettings>('PUT', '/settings', { thinking });

async function send(text: string) {
  const events = await t.stream(`${nodeUrl}/send`, { parentId: null, text });
  return { events, reply: (events.at(-1) as { message: Message }).message };
}

describe('思考的设置', () => {
  it('默认总档位关，写提示词跟总档位，翻译和转标签关；只改带了的项，存进工作文件夹；档位不对返回 400', async () => {
    expect((await t.ok<SharedSettings>('GET', '/settings')).thinking).toEqual({ level: 'off', chat: 'follow', translate: 'off', tagging: 'off' });
    expect((await setThinking({ level: 'medium' })).thinking).toEqual({ level: 'medium', chat: 'follow', translate: 'off', tagging: 'off' });
    expect((await setThinking({ translate: 'follow' })).thinking).toMatchObject({ level: 'medium', translate: 'follow' });
    expect(JSON.parse(await fs.readFile(path.join(t.work, 'settings.json'), 'utf8')).thinking).toMatchObject({ level: 'medium', translate: 'follow' });

    expect((await t.call('PUT', '/settings', { thinking: { chat: 'max' } })).status).toBe(400);
    expect((await t.call('PUT', '/settings', { thinking: { level: 'follow' } })).status).toBe(400);
  });

  it('模型配置的思考写法存进工作文件夹；界面上没带这两项时沿用原来的；写法不对返回 400', async () => {
    expect((await t.ok<Config>('GET', '/config')).modelConfigs[0]).toMatchObject({ thinkingStyle: 'none', thinkingModel: '' });
    await setStyle('model-switch', 'deepseek-reasoner');
    const saved = JSON.parse(await fs.readFile(path.join(t.work, 'model-configs.json'), 'utf8'));
    expect(saved[0]).toMatchObject({ thinkingStyle: 'model-switch', thinkingModel: 'deepseek-reasoner' });

    const config = await t.ok<Config>('GET', '/config');
    const withoutThinking = config.modelConfigs.map(({ thinkingStyle: _, thinkingModel: __, ...rest }) => ({ ...rest, name: '改了名' }));
    await t.ok('PUT', '/config', { modelConfigs: withoutThinking });
    expect((await t.ok<Config>('GET', '/config')).modelConfigs[0]).toMatchObject({ name: '改了名', thinkingStyle: 'model-switch', thinkingModel: 'deepseek-reasoner' });

    const bad = config.modelConfigs.map((m) => ({ ...m, thinkingStyle: 'always' }));
    expect((await t.call('PUT', '/config', { modelConfigs: bad })).status).toBe(400);
  });
});

describe('发消息时的思考', () => {
  it('开了思考：发出参数，思考原文一段段推给前端、存进回复，记下等了多久才出正文', async () => {
    await setStyle('reasoning-effort');
    await setThinking({ level: 'medium' });
    const { events, reply } = await send('写一个');

    const types = events.map((e) => e.type);
    expect(types.indexOf('reasoning')).toBeGreaterThan(types.indexOf('assistant-start'));
    expect(types.indexOf('reasoning')).toBeLessThan(types.indexOf('delta'));
    const streamed = events.flatMap((e: StreamEvent) => (e.type === 'reasoning' ? [e.text] : [])).join('');
    expect(streamed).toBe('思考：先弄清用户要什么，再按要求的格式写出来。');
    expect(reply.reasoning).toBe(streamed);
    expect(reply.text).toMatch(/\n思考参数：\{"reasoning_effort":"medium"\}$/);
    expect(reply.thinkingMs).toBeGreaterThanOrEqual(900);
    expect(reply.parsed?.prompts).toHaveLength(1);
    expect((await t.ok('GET', nodeUrl)).messages[reply.id]).toEqual(reply);
  });

  it('关的时候按写法发「关」，不记思考时间；换模型名的写法开思考时换模型，回复记的是实际用的模型', async () => {
    await setStyle('enable-thinking');
    const off = (await send('写一个')).reply;
    expect(off.text).toMatch(/\n思考参数：\{"enable_thinking":false\}$/);
    expect(off).not.toHaveProperty('reasoning');
    expect(off).not.toHaveProperty('thinkingMs');

    await setStyle('model-switch', 'deepseek-reasoner');
    await setThinking({ level: 'high' });
    const on = (await send('再来')).reply;
    expect(on.modelName).toBe('deepseek-reasoner');
    expect(on.text).toContain('思考参数：{"model":"deepseek-reasoner"}');
    expect(on.reasoning).toBeTruthy();
    expect(on.thinkingMs).toBeGreaterThan(0);
  });

  it('写法是不支持时，档位开着也什么都不发', async () => {
    await setThinking({ level: 'high' });
    const { events, reply } = await send('写一个');
    expect(events.some((e) => e.type === 'reasoning')).toBe(false);
    expect(reply.text).not.toContain('思考参数');
    expect(reply).not.toHaveProperty('thinkingMs');
  });

  it('翻译用自己的档位：总档位开着，翻译默认照样发「关」；单独调成高才开', async () => {
    await setStyle('thinking-type');
    await setThinking({ level: 'high' });
    const { reply } = await send('写一个');
    const translate = () =>
      t.ok<PromptTranslation>('POST', `${nodeUrl}/messages/${reply.id}/translate`, { promptIndex: 0, language: '英文' });

    expect((await translate()).text).toMatch(/\n思考参数：\{"thinking":\{"type":"disabled"\}\}$/);
    await setThinking({ translate: 'high' });
    expect((await translate()).text).toMatch(/\n思考参数：\{"thinking":\{"type":"enabled"\}\}$/);
  });
});
