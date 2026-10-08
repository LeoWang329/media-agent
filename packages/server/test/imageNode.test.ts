import type { CanvasDetail, ChatNode, Config, Fragment, HomeData, Message, TagCheck, TagConvertResult } from '@media-agent/shared';
import express from 'express';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { close, listen, startTestApp, urlOf, type TestApp } from './helpers';

// 小词库：转标签回来的四个都认识
const LIBRARY: Record<string, string> = {
  'tags.csv': 'tag,category,count,deprecated\n1girl,0,8000000,0\nsitting,0,3000000,0\nwindow,0,900000,0\nbook,0,800000,0\nreading,0,300000,0\n',
  'aliases.csv': 'alias,tag\n',
  'info.json': '{ "updatedAt": "2026-09-01" }',
};

let t: TestApp;
let canvasId: string;
let nodeId: string;
const nodeUrl = () => `/canvases/${canvasId}/nodes/${nodeId}`;

beforeEach(async () => {
  t = await startTestApp();
  for (const [file, text] of Object.entries(LIBRARY)) {
    await fs.mkdir(path.join(t.work, 'tags'), { recursive: true });
    await fs.writeFile(path.join(t.work, 'tags', file), text);
  }
  canvasId = (await t.ok('POST', '/canvases', { title: '生图' })).id;
  nodeId = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0 })).id;
});

afterEach(async () => {
  await t.cleanup();
});

// 在同一个画布上新建一个生图节点（用 il），后面的请求都对着它
async function useImageNode(): Promise<void> {
  nodeId = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 300, kind: 'image' })).id;
}

async function send(text: string): Promise<Message> {
  const events = await t.stream(`${nodeUrl()}/send`, { parentId: null, text });
  return (events.at(-1) as { message: Message }).message;
}

describe('生图节点', () => {
  it('发给模型的系统消息去掉开头的说明段，接生图的格式要求；说明不写时长和比例', async () => {
    // 换一个记下请求的假接口，看程序发了什么
    const requests: { messages: { role: string; content: unknown }[] }[] = [];
    const llm = express();
    llm.use(express.json({ limit: '10mb' }));
    llm.post('/v1/chat/completions', (req, res) => {
      requests.push(req.body);
      res.type('text/event-stream').end(`data: ${JSON.stringify({ choices: [{ delta: { content: '<prompt>\n1girl\n</prompt>' } }] })}\n\ndata: [DONE]\n\n`);
    });
    const server: Server = await listen(llm);
    try {
      const config = await t.ok<Config>('GET', '/config');
      await t.ok('PUT', '/config', { modelConfigs: [...config.modelConfigs, { ...config.modelConfigs[0], id: 'capture', name: 'capture', baseUrl: `${urlOf(server)}/v1` }] });
      await useImageNode();
      await t.ok('PATCH', nodeUrl(), { modelConfigId: 'capture', duration: 12 });
      await send('写一个');

      const [system, user] = requests[0].messages;
      const il = await fs.readFile(path.join(t.work, 'prompts', 'il.md'), 'utf8');
      expect(system.content).not.toContain('用途: 生图');
      expect(system.content).toContain('# Danbooru 标签写手（IL 系列底模）');
      expect(system.content).toContain('框里只放英文标签');
      expect(system.content).not.toContain('概括这条视频的内容');
      expect(il.startsWith('---\n用途: 生图\n底模: IL\n---\n')).toBe(true);
      expect(user.content).toEqual([{ type: 'text', text: '本次没有参考图。' }, { type: 'text', text: '写一个' }]);
    } finally {
      await close(server);
    }
  });

  it('mock 回一串标签；改了时长再发，说明里也不提时长；视频节点的说明照旧写时长', async () => {
    const reply = async (parentId: string, text: string) =>
      ((await t.stream(`${nodeUrl()}/send`, { parentId, text })).at(-1) as { message: Message }).message;
    const videoId = nodeId;
    await useImageNode();
    const first = await send('写一个');
    expect(first.parsed).toMatchObject({ title: '测试图片', prompts: [{ text: '1girl, solo, long hair, blond hair, goldish hair, smile, hatsune miku' }] });

    await t.ok('PATCH', nodeUrl(), { duration: 12 });
    const second = await reply(first.id, '改一下');
    expect(second.text).toContain('说明：改一下');

    nodeId = videoId;
    await t.ok('PATCH', nodeUrl(), { duration: 10 });
    const video = await send('写一个视频');
    expect(video.text).toContain('<title>测试标题</title>');
    expect(video.text).toContain('说明：本次没有参考图。视频时长 10 秒');
  });

  it('卡片上生图节点带系列和尺寸，没改过的是 832×1216；视频节点没有；首页最近动过的节点和打过星的框也带', async () => {
    const card = async () => (await t.ok<CanvasDetail>('GET', `/canvases/${canvasId}`)).nodes.find((n) => n.id === nodeId)!.image;
    expect(await card()).toBeNull();
    await useImageNode();
    expect(await card()).toEqual({ family: 'IL', width: 832, height: 1216 });
    await t.ok('PATCH', nodeUrl(), { systemPromptName: 'pony' });
    expect(await card()).toEqual({ family: 'Pony', width: 832, height: 1216 });
    await t.ok('PATCH', nodeUrl(), { image: { width: 1216, height: 832 } });
    expect(await card()).toEqual({ family: 'Pony', width: 1216, height: 832 });

    const reply = await send('写一个');
    await t.ok('POST', `${nodeUrl()}/messages/${reply.id}/star`, { promptIndex: 0, on: true });
    const home = await t.ok<HomeData>('GET', '/home');
    expect(home.recentNodes[0].image).toEqual({ family: 'Pony', width: 1216, height: 832 });
    // 打过星的框看写它时用的提示词：这条回复是 pony 写的；尺寸是节点现在的，还没出过图
    expect(home.starred.map((prompt) => prompt.image)).toEqual([{ family: 'Pony', width: 1216, height: 832, generated: [] }]);

    // 提示词删掉了：还是生图节点，看不出系列
    await t.ok('DELETE', '/prompts/pony');
    expect(await card()).toEqual({ family: null, width: 1216, height: 832 });
  });

  it('自己写的框：不调模型，接在最后，标着自己写的，不能重答；之后发消息时当成用户说的话发给模型', async () => {
    const requests: { messages: { role: string; content: unknown }[] }[] = [];
    const llm = express();
    llm.use(express.json({ limit: '10mb' }));
    llm.post('/v1/chat/completions', (req, res) => {
      requests.push(req.body);
      res.type('text/event-stream').end(`data: ${JSON.stringify({ choices: [{ delta: { content: '<prompt>\n1girl, night\n</prompt>' } }] })}\n\ndata: [DONE]\n\n`);
    });
    const server: Server = await listen(llm);
    try {
      const config = await t.ok<Config>('GET', '/config');
      await t.ok('PUT', '/config', { modelConfigs: [...config.modelConfigs, { ...config.modelConfigs[0], id: 'capture', name: 'capture', baseUrl: `${urlOf(server)}/v1` }] });
      await useImageNode();
      await t.ok('PATCH', nodeUrl(), { modelConfigId: 'capture' });

      const node = await t.ok<ChatNode>('POST', `${nodeUrl()}/handwritten`, { parentId: null, text: '1girl, solo, red hair' });
      const written = node.messages[node.activeChildOf.root];
      expect(written).toMatchObject({ role: 'assistant', parentId: null, handwritten: true, systemPromptName: 'il', parsed: { prompts: [{ index: 0, text: '1girl, solo, red hair' }] } });
      expect(requests).toEqual([]);
      expect((await t.call('POST', `${nodeUrl()}/handwritten`, { parentId: 'gone', text: 'x' })).status).toBe(404);
      expect((await t.call('POST', `${nodeUrl()}/handwritten`, { parentId: written.id, text: '  ' })).status).toBe(400);

      const reply = ((await t.stream(`${nodeUrl()}/send`, { parentId: written.id, text: '优化上面这个框' })).at(-1) as { message: Message }).message;
      const [, mine, ask] = requests[0].messages;
      expect(mine).toEqual({ role: 'user', content: '我自己写了一个框：\n<prompt>\n1girl, solo, red hair\n</prompt>' });
      expect(ask.role).toBe('user');
      expect(JSON.stringify(ask.content)).toContain('优化上面这个框');

      // 回复后面再写一个：接在回复后面；自己写的不能重答
      const again = await t.ok<ChatNode>('POST', `${nodeUrl()}/handwritten`, { parentId: reply.id, text: 'blonde hair' });
      const second = again.messages[again.activeChildOf[reply.id]];
      expect(second).toMatchObject({ parentId: reply.id, handwritten: true });
      const regenerate = await t.call('POST', `${nodeUrl()}/messages/${second.id}/regenerate`, {});
      expect(regenerate.status).toBe(400);
      expect(regenerate.body.error).toBe('这个框是自己写的，不是 AI 回的，没法重答');
      expect(requests).toHaveLength(1);
    } finally {
      await close(server);
    }
  });
});

describe('节点类型', () => {
  it('新建时定类型：不说是视频节点，用 ref2va；生图节点用 il，il 删了用排在最前的生图提示词，一套都没有建不了', async () => {
    const create = (body: object) => t.call<ChatNode>('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0, ...body });
    expect(await t.ok<ChatNode>('GET', nodeUrl())).toMatchObject({ kind: 'video', systemPromptName: 'ref2va' });
    expect((await create({ kind: 'image' })).body).toMatchObject({ kind: 'image', systemPromptName: 'il' });
    await t.ok('DELETE', '/prompts/il');
    expect((await create({ kind: 'image' })).body).toMatchObject({ kind: 'image', systemPromptName: 'pony' });
    await t.ok('DELETE', '/prompts/pony');
    expect((await create({ kind: 'image' })).body).toMatchObject({ kind: 'image', systemPromptName: 'krea2' });
    await t.ok('DELETE', '/prompts/krea2');
    expect(await create({ kind: 'image' })).toMatchObject({ status: 400, body: { error: '设置里还没有生图用的系统提示词' } });
    expect(await create({ kind: 'audio' })).toMatchObject({ status: 400, body: { error: '节点类型只能是 video 或 image' } });
  });

  it('系统提示词只能换成同一种的；岔出来的节点和原节点同一种', async () => {
    expect(await t.call('PATCH', nodeUrl(), { systemPromptName: 'il' })).toMatchObject({ status: 400, body: { error: '视频节点只能选写视频提示词的系统提示词' } });
    await t.ok('PATCH', nodeUrl(), { systemPromptName: 't2v' });
    await useImageNode();
    expect(await t.call('PATCH', nodeUrl(), { systemPromptName: 'ref2va' })).toMatchObject({ status: 400, body: { error: '生图节点只能选生图用的系统提示词' } });
    expect(await t.ok<ChatNode>('PATCH', nodeUrl(), { systemPromptName: 'pony' })).toMatchObject({ kind: 'image', systemPromptName: 'pony' });
    const reply = await send('写一个');
    expect(await t.ok<ChatNode>('POST', `${nodeUrl()}/fork`, { messageId: reply.id })).toMatchObject({ kind: 'image', systemPromptName: 'pony' });
  });

  it('没记类型的老节点按现在用的系统提示词归类，下次存的时候写进文件；提示词已经不在了的算视频节点', async () => {
    const file = path.join(t.work, 'canvases', canvasId, 'nodes', `${nodeId}.json`);
    const old = async (systemPromptName: string) => {
      const { kind, ...rest } = JSON.parse(await fs.readFile(file, 'utf8')) as ChatNode;
      await fs.writeFile(file, JSON.stringify({ ...rest, systemPromptName }));
    };
    await old('pony');
    expect(await t.ok<ChatNode>('GET', nodeUrl())).toMatchObject({ kind: 'image' });
    expect((await t.ok<CanvasDetail>('GET', `/canvases/${canvasId}`)).nodes[0].image).toEqual({ family: 'Pony', width: 832, height: 1216 });
    await t.ok('PATCH', nodeUrl(), { title: '老节点' });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).kind).toBe('image');

    await old('gone');
    expect(await t.ok<ChatNode>('GET', nodeUrl())).toMatchObject({ kind: 'video' });
  });
});

describe('标签', () => {
  it('校验时这个系列的固定开头和评级词算认识，中文那行写质量词、评级词', async () => {
    const checks = await t.ok<TagCheck[]>('POST', '/tags/check', { tags: ['score_9', 'rating_safe', 'sitting', 'masterpiece'], family: 'Pony' });
    expect(checks.map((check) => [check.status, check.zh])).toEqual([
      ['ok', '质量词'],
      ['ok', '评级词'],
      ['ok', ''],
      ['unknown', undefined],
    ]);
  });

  it('让模型把中文转成标签：系统消息是 to-tags.md 里 --- 下面那段，回来的逐个校验；思考按「转标签」那档；视频节点不行', async () => {
    const convert = (text: string) => t.call<TagConvertResult>('POST', '/tags/convert', { canvasId, nodeId, text });
    expect((await convert('坐在窗边看书')).body).toEqual({ error: '这个节点用的不是生图提示词' });

    await useImageNode();
    const { body } = await convert('坐在窗边看书');
    expect(body.text).toBe('sitting, window, book, reading');
    expect(body.checks.map((check) => [check.status, check.tag])).toEqual([
      ['ok', 'sitting'],
      ['ok', 'window'],
      ['ok', 'book'],
      ['ok', 'reading'],
    ]);

    const config = await t.ok<Config>('GET', '/config');
    await t.ok('PUT', '/config', { modelConfigs: config.modelConfigs.map((m) => ({ ...m, thinkingStyle: 'reasoning-effort' })) });
    await t.ok('PUT', '/settings', { thinking: { level: 'high', chat: 'follow', tagging: 'medium' } });
    expect((await convert('看书')).body.text).toContain('思考参数：{"reasoning_effort":"medium"}');

    expect((await convert('  ')).status).toBe(400);
  });
});

describe('片段库', () => {
  it('新建、列出、改名改分类改内容、删除；名字重了 409，分类不对 400，存在工作文件夹 fragments.json', async () => {
    const created = await t.ok<Fragment>('POST', '/fragments', { name: '测试角色', category: 'character', text: 'hatsune miku, long hair' });
    expect(created).toMatchObject({ name: '测试角色', category: 'character', text: 'hatsune miku, long hair' });
    expect((await t.call('POST', '/fragments', { name: '测试角色', category: 'style', text: 'x' })).status).toBe(409);
    expect((await t.call('POST', '/fragments', { name: '画风', category: 'pose', text: 'x' })).status).toBe(400);
    expect((await t.call('POST', '/fragments', { name: '空的', category: 'other', text: ' ' })).status).toBe(400);

    const style = await t.ok<Fragment>('POST', '/fragments', { name: '我的画风', category: 'style', text: 'watercolor \\(medium\\)' });
    expect((await t.call('PATCH', `/fragments/${style.id}`, { name: '测试角色' })).status).toBe(409);
    const renamed = await t.ok<Fragment>('PATCH', `/fragments/${created.id}`, { name: '初音', category: 'other', text: 'hatsune miku' });
    expect(renamed).toMatchObject({ id: created.id, name: '初音', category: 'other', text: 'hatsune miku', createdAt: created.createdAt });
    expect(JSON.parse(await fs.readFile(path.join(t.work, 'fragments.json'), 'utf8'))).toEqual([renamed, style]);

    expect((await t.call('DELETE', `/fragments/${created.id}`)).status).toBe(204);
    expect(await t.ok<Fragment[]>('GET', '/fragments')).toEqual([style]);
    expect((await t.call('DELETE', `/fragments/${created.id}`)).status).toBe(404);
    expect((await t.call('PATCH', '/fragments/not-a-uuid', { name: 'x' })).status).toBe(400);
  });
});
