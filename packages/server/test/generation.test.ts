import { activePath, directionDraft, type ChatNode, type HomeData, type Message, type NodeSummary, type PromptTranslation } from '@media-agent/shared';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sleep, startTestApp, type TestApp } from './helpers';

let t: TestApp;
let nodeUrl: string;
let canvasId: string;
let nodeId: string;

beforeEach(async () => {
  t = await startTestApp();
  canvasId = (await t.ok('POST', '/canvases', { title: '测试画布' })).id;
  nodeId = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 100, y: 50 })).id;
  nodeUrl = `/canvases/${canvasId}/nodes/${nodeId}`;
});

afterEach(async () => {
  await t.cleanup();
});

const getNode = (id = nodeId): Promise<ChatNode> => t.ok('GET', `/canvases/${canvasId}/nodes/${id}`);
const lastEvent = <T>(events: T[]) => events[events.length - 1];

async function send(text: string, parentId: string | null = null, url = nodeUrl) {
  const events = await t.stream(`${url}/send`, { parentId, text });
  const final = lastEvent(events) as { message: Message };
  return { events, reply: final.message };
}

describe('发送消息', () => {
  it('SSE 事件顺序、消息落盘、解析结果、标题写进节点、记下模型和系统提示词版本', async () => {
    const { events, reply } = await send('写一个');
    const types = events.map((e) => e.type);
    expect(types.slice(0, 2)).toEqual(['user', 'assistant-start']);
    expect(types.at(-1)).toBe('done');
    expect(types.filter((type) => type === 'delta').length).toBeGreaterThan(1);

    const deltas = events.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join('');
    expect(reply.text).toBe(deltas);
    expect(reply.text).toContain('说明：本次没有参考图。视频时长 8 秒，画面比例 16:9。');
    expect(reply.text).toContain('历史消息 1 条');
    expect(reply.parsed?.title).toBe('测试标题');
    expect(reply.parsed?.prompts).toHaveLength(1);
    expect(reply.parsed?.prompts[0].summary).toBe('[reference generation] 测试概述，引用了 <Picture 1>');
    expect(reply.usage?.completionTokens).toBeGreaterThan(0);

    const node = await getNode();
    expect(node.title).toBe('测试标题');
    expect(activePath(node).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(node.messages[reply.id]).toEqual(reply);

    const promptText = await fs.readFile(path.join(t.work, 'prompts', 'ref2va.md'), 'utf8');
    const hash = createHash('sha256').update(promptText).digest('hex');
    expect(reply).toMatchObject({ modelConfigId: 'mock', modelName: 'mock-model', systemPromptName: 'ref2va', systemPromptHash: hash });
    expect(await fs.readFile(path.join(t.work, 'prompts', '.history', `ref2va-${hash.slice(0, 12)}.md`), 'utf8')).toBe(promptText);

    const detail = await t.ok('GET', `/canvases/${canvasId}`);
    expect(detail.nodes[0]).toMatchObject({ id: nodeId, title: '测试标题', directionCount: 1, x: 100, y: 50 });
    expect(detail.nodes[0].summary).toContain('测试概述');
  });

  it('接着发：带上历史，第二次回复不改标题；手动改过的标题之后也不被覆盖', async () => {
    const first = await send('写一个');
    await t.ok('PATCH', nodeUrl, { title: '我的标题' });
    const second = await send('再来', first.reply.id);
    expect(second.reply.text).toContain('历史消息 3 条');
    const node = await getNode();
    expect(node).toMatchObject({ title: '我的标题', titleIsManual: true });
    expect(activePath(node)).toHaveLength(4);
  });

  it('重新生成是同一条 user 消息下的兄弟版本；编辑用户消息新建版本并照抄原消息的快照', async () => {
    const slots = [await t.addImage(canvasId, '#ff0000'), await t.addImage(canvasId, '#00ff00')];
    await t.ok('PATCH', nodeUrl, { slots, duration: 10, aspectRatio: '9:16' });
    const { events, reply } = await send('写一个');
    const user = (events[0] as { message: Message }).message;
    expect(user).toMatchObject({ slotSnapshot: slots, duration: 10, aspectRatio: '9:16' });

    const regenerated = lastEvent(await t.stream(`${nodeUrl}/messages/${reply.id}/regenerate`, {})) as { message: Message };
    expect(regenerated.message.parentId).toBe(user.id);
    let node = await getNode();
    expect(node.activeChildOf[user.id]).toBe(regenerated.message.id);

    await t.ok('PATCH', nodeUrl, { slots: [], duration: 8, aspectRatio: '16:9' });
    const edited = await t.stream(`${nodeUrl}/messages/${user.id}/edit`, { text: '写两个' });
    const editedUser = (edited[0] as { message: Message }).message;
    expect(editedUser).toMatchObject({ parentId: null, text: '写两个', slotSnapshot: slots, duration: 10, aspectRatio: '9:16', attachments: user.attachments });
    expect(lastEvent(edited).type).toBe('done');

    node = await getNode();
    expect(node.rootIds).toEqual([user.id, editedUser.id]);
    expect(activePath(node).map((m) => m.id)).toEqual([editedUser.id, (lastEvent(edited) as { message: Message }).message.id]);

    await t.ok('PATCH', nodeUrl, { activeChildOf: { root: user.id } });
    node = await getNode();
    expect(activePath(node).map((m) => m.id)).toEqual([user.id, regenerated.message.id]);
    expect((await t.call('PATCH', nodeUrl, { activeChildOf: { root: reply.id } })).status).toBe(400);
  });

  it('接口报错：回复记下状态码和返回内容、文字为空；重试成功', async () => {
    const { events, reply } = await send(`报错 ${Date.now()}`);
    expect(lastEvent(events).type).toBe('error');
    expect(reply.text).toBe('');
    expect(reply.error).toMatch(/^HTTP 500：.*报错/);
    expect((await getNode()).messages[reply.id].error).toBe(reply.error);
    const card = async () => (await t.ok('GET', `/canvases/${canvasId}`)).nodes.find((n: { id: string }) => n.id === nodeId);
    expect(await card()).toMatchObject({ failed: true, generating: false, duration: 8, aspectRatio: '16:9' });

    const retry = await t.stream(`${nodeUrl}/messages/${reply.id}/regenerate`, {});
    expect(lastEvent(retry).type).toBe('done');
    expect((lastEvent(retry) as { message: Message }).message.parsed?.title).toBe('测试标题');
    expect((await getNode()).title).toBe('测试标题');
    expect(await card()).toMatchObject({ failed: false });
  });

  it('停止：保留已收到的部分，不算失败，记下是叫停的；生成中再发返回 409，卡片和首页都知道在生成', async () => {
    const sending = send('慢一点');
    await sleep(1300);
    expect((await t.call('POST', `${nodeUrl}/send`, { parentId: null, text: '又一个' })).status).toBe(409);
    expect((await t.ok('GET', `/canvases/${canvasId}`)).nodes[0]).toMatchObject({ id: nodeId, generating: true });
    expect(await t.ok('GET', '/home')).toMatchObject({ canvases: [{ id: canvasId, generating: 1 }], recentNodes: [{ id: nodeId, generating: true }] });
    expect((await t.ok('POST', `${nodeUrl}/stop`)).stopped).toBe(true);

    const { events, reply } = await sending;
    expect(lastEvent(events).type).toBe('done');
    expect(reply.error).toBeUndefined();
    expect(reply.text.length).toBeGreaterThan(0);
    expect(reply.text).not.toContain('</prompt>');
    expect(reply.stopped).toBe(true);
    expect((await getNode()).messages[reply.id]).toMatchObject({ text: reply.text, stopped: true });
    expect((await t.ok('POST', `${nodeUrl}/stop`)).stopped).toBe(false);
  });
});

describe('fork', () => {
  it('从 assistant 消息 fork：复制链上的消息、槽位时长比例、父子关系，放在原节点右侧、已有子节点下方', async () => {
    const slots = [await t.addImage(canvasId, '#0000ff')];
    await t.ok('PATCH', nodeUrl, { slots, duration: 12, aspectRatio: '1:1' });
    const first = await send('三个方向');
    await t.ok('PATCH', nodeUrl, { slots: [], duration: 8 });

    const draftPrefix = directionDraft(1, first.reply.parsed!.prompts[1].label);
    const forked: ChatNode = await t.ok('POST', `${nodeUrl}/fork`, { messageId: first.reply.id, draftPrefix });
    expect(Object.keys(forked.messages)).toEqual((await getNode()).rootIds.flatMap((id) => [id, first.reply.id]));
    expect(forked).toMatchObject({
      parentNodeId: nodeId,
      forkedFromMessageId: first.reply.id,
      copiedCount: 2,
      title: '测试标题 · 分支',
      titleIsManual: false,
      modelConfigId: 'mock',
      systemPromptName: 'ref2va',
      slots,
      duration: 12,
      aspectRatio: '1:1',
      draft: '沿第 2 个方向（方向二：测试方向二）往下改：',
    });

    const second: ChatNode = await t.ok('POST', `${nodeUrl}/fork`, { messageId: first.reply.id });
    const detail = await t.ok('GET', `/canvases/${canvasId}`);
    const layout = (id: string) => detail.nodes.find((n: { id: string }) => n.id === id);
    expect([layout(forked.id).x, layout(forked.id).y]).toEqual([444, 50]);
    expect([layout(second.id).x, layout(second.id).y]).toEqual([444, 280]);

    const reply = await send('继续', first.reply.id, `/canvases/${canvasId}/nodes/${forked.id}`);
    expect(reply.reply.text).toContain('历史消息 3 条');
  });

  it('从 user 消息 fork：消息列表为空，文字放进输入框', async () => {
    const { events } = await send('写一个');
    const user = (events[0] as { message: Message }).message;
    const forked: ChatNode = await t.ok('POST', `${nodeUrl}/fork`, { messageId: user.id });
    expect([forked.messages, forked.rootIds, forked.draft, forked.copiedCount]).toEqual([{}, [], '写一个', 0]);
  });
});

describe('画布和节点的增删改查', () => {
  it('首页的画布带封面和生成数、改名、删除进 .trash、撤销删除', async () => {
    const canvases = async () => (await t.ok('GET', '/home')).canvases;
    await t.ok('PATCH', `/canvases/${canvasId}`, { title: '改过的画布' });
    expect(await canvases()).toMatchObject([{ id: canvasId, title: '改过的画布', nodeCount: 1, cover: null, generating: 0, stars: 0 }]);
    await t.addImage(canvasId, '#ff0000');
    await sleep(5);
    const latest = await t.addImage(canvasId, '#00ff00');
    expect((await canvases())[0].cover).toBe(latest);

    const { trash } = await t.ok('DELETE', `/canvases/${canvasId}`);
    expect(await canvases()).toEqual([]);
    expect(trash).toMatch(new RegExp(`-canvas-${canvasId}$`));
    expect(await fs.readdir(path.join(t.work, '.trash'))).toContain(trash);

    expect(await t.ok('POST', '/canvases/restore', { trash })).toEqual({ id: canvasId });
    expect(await canvases()).toMatchObject([{ id: canvasId, title: '改过的画布', nodeCount: 1 }]);
    expect((await t.call('POST', '/canvases/restore', { trash })).status).toBe(404);
    expect((await t.call('POST', '/canvases/restore', { trash: '../canvases' })).status).toBe(400);
    expect((await t.call('GET', '/canvases/not-a-uuid')).status).toBe(400);
  });

  it('生成中删画布：等回复存完再挪进回收站，原处不留文件夹，撤销后回复还在', async () => {
    const sending = send('慢一点');
    await sleep(1300);
    const { trash } = await t.ok('DELETE', `/canvases/${canvasId}`);
    const { reply } = await sending;
    expect(reply.stopped).toBe(true);
    await sleep(1100);
    expect(await fs.readdir(path.join(t.work, 'canvases'))).toEqual([]);
    expect(await t.ok('POST', '/canvases/restore', { trash })).toEqual({ id: canvasId });
    expect((await getNode()).messages[reply.id]).toMatchObject({ text: reply.text, stopped: true });
  });

  it('生成中删节点：等回复存完再挪进回收站，撤销后回复完整、标着叫停', async () => {
    const sending = send('慢一点');
    await sleep(1300);
    const { trash } = await t.ok('DELETE', nodeUrl);
    const { reply } = await sending;
    expect(reply.stopped).toBe(true);
    expect(await t.ok('POST', `/canvases/${canvasId}/nodes/restore`, { trash })).toEqual({ restored: [nodeId] });
    expect((await getNode()).messages[reply.id]).toMatchObject({ text: reply.text, stopped: true });
  });

  it('删除节点连同全部子孙移到 .trash，画布上的位置一起记下；折叠状态能保存', async () => {
    const { reply } = await send('写一个');
    const b: ChatNode = await t.ok('POST', `${nodeUrl}/fork`, { messageId: reply.id });
    await t.ok('POST', `${nodeUrl}/fork`, { messageId: reply.id });
    await t.ok('POST', `/canvases/${canvasId}/nodes/${b.id}/fork`, { messageId: reply.id });
    const other: ChatNode = await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 900 });

    await t.ok('PATCH', `/canvases/${canvasId}`, { nodes: [{ id: nodeId, x: 5, y: 6, collapsed: true }] });
    expect((await t.ok('GET', `/canvases/${canvasId}`)).nodes[0]).toMatchObject({ id: nodeId, x: 5, y: 6, collapsed: true });

    const { deleted } = await t.ok('DELETE', nodeUrl);
    expect(deleted).toHaveLength(4);
    expect((await t.ok('GET', `/canvases/${canvasId}`)).nodes.map((n: { id: string }) => n.id)).toEqual([other.id]);

    const folder = (await fs.readdir(path.join(t.work, '.trash'))).find((name) => name.endsWith(`-nodes-${nodeId}`))!;
    expect((await fs.readdir(path.join(t.work, '.trash', folder, 'nodes'))).sort()).toEqual(deleted.map((id: string) => `${id}.json`).sort());
    const manifest = JSON.parse(await fs.readFile(path.join(t.work, '.trash', folder, 'manifest.json'), 'utf8'));
    expect(manifest.layouts).toHaveLength(4);
  });
});

describe('首页', () => {
  it('最近动过的节点只算自己发过消息的；打过星的提示词带当时的图和译文，岔出去的节点复制来的只列一次', async () => {
    const image = await t.addImage(canvasId, '#0000ff');
    await t.ok('PATCH', nodeUrl, { slots: [image], duration: 12, aspectRatio: '1:1' });
    const { reply } = await send('三个方向');
    await t.ok('PATCH', nodeUrl, { slots: [] });
    await t.ok('POST', `${nodeUrl}/messages/${reply.id}/star`, { promptIndex: 1, on: true });
    for (const language of ['日文', '英文']) await t.ok('POST', `${nodeUrl}/messages/${reply.id}/translate`, { promptIndex: 1, language });
    const forked: ChatNode = await t.ok('POST', `${nodeUrl}/fork`, { messageId: reply.id });
    await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 900 });

    let home: HomeData = await t.ok('GET', '/home');
    expect(home.recentNodes).toMatchObject([{ id: nodeId, canvasId, title: '测试标题', directionCount: 3, slots: [], starred: true, generating: false, error: null }]);
    const box = reply.parsed!.prompts[1];
    expect(home.starred).toEqual([
      {
        canvasId,
        nodeId,
        nodeTitle: '测试标题',
        messageId: reply.id,
        promptIndex: 1,
        label: '方向二：测试方向二',
        text: box.text,
        summary: box.summary,
        images: [image],
        duration: 12,
        aspectRatio: '1:1',
        translations: [
          { language: '英文', text: `译文（英文）
${box.text}` },
          { language: '日文', text: `译文（日文）
${box.text}` },
        ],
        createdAt: reply.createdAt,
      },
    ]);
    expect(home.canvases).toMatchObject([{ id: canvasId, nodeCount: 3, cover: image, stars: 1 }]);
    expect(Object.keys(home.images[canvasId])).toEqual([image]);

    // 岔出去的节点发过消息才进「最近动过」；它复制来的星不算它的
    await send('继续', reply.id, `/canvases/${canvasId}/nodes/${forked.id}`);
    home = await t.ok('GET', '/home');
    expect(home.recentNodes.map((node) => [node.id, node.starred])).toEqual([
      [forked.id, false],
      [nodeId, true],
    ]);
    expect(home.starred.map((prompt) => prompt.nodeId)).toEqual([nodeId]);

    // 打星只改节点文件，画布也算动过；画布上的星按节点数
    const starred: ChatNode = await t.ok('POST', `${nodeUrl}/messages/${reply.id}/star`, { promptIndex: 0, on: true });
    home = await t.ok('GET', '/home');
    expect(home.recentNodes[0].id).toBe(nodeId);
    expect(home.starred).toHaveLength(2);
    expect(home.canvases).toMatchObject([{ updatedAt: starred.updatedAt, stars: 1 }]);
  });

  it('工作文件夹读不了时返回 503 和原因', async () => {
    await fs.rm(path.join(t.work, 'canvases'), { recursive: true });
    expect(await t.call('GET', '/home')).toEqual({ status: 503, body: { error: '找不到这个路径' } });
  });
});

describe('提示词框', () => {
  it('打星写进消息，卡片跟着显示星，取消后消失', async () => {
    const { reply } = await send('写一个');
    const starUrl = `${nodeUrl}/messages/${reply.id}/star`;
    const cardStarred = async () => (await t.ok('GET', `/canvases/${canvasId}`)).nodes[0].starred;

    let node: ChatNode = await t.ok('POST', starUrl, { promptIndex: 0, on: true });
    expect(node.messages[reply.id].stars).toEqual([0]);
    expect(await cardStarred()).toBe(true);

    node = await t.ok('POST', starUrl, { promptIndex: 0, on: false });
    expect(node.messages[reply.id].stars).toEqual([]);
    expect(await cardStarred()).toBe(false);
    expect((await t.call('POST', starUrl, { promptIndex: 0, on: 'yes' })).status).toBe(400);
  });

  it('岔出去的节点复制来的星不算它的，卡片上不显示；它自己回复里打的星照常显示', async () => {
    const { reply } = await send('写一个');
    await t.ok('POST', `${nodeUrl}/messages/${reply.id}/star`, { promptIndex: 0, on: true });
    const forked: ChatNode = await t.ok('POST', `${nodeUrl}/fork`, { messageId: reply.id });
    expect(forked.messages[reply.id].stars).toEqual([0]);
    const starredCards = async () => (await t.ok('GET', `/canvases/${canvasId}`)).nodes.filter((n: NodeSummary) => n.starred).map((n: NodeSummary) => n.id);
    expect(await starredCards()).toEqual([nodeId]);

    const forkUrl = `/canvases/${canvasId}/nodes/${forked.id}`;
    const { reply: own } = await send('继续', reply.id, forkUrl);
    await t.ok('POST', `${forkUrl}/messages/${own.id}/star`, { promptIndex: 0, on: true });
    expect(await starredCards()).toEqual([nodeId, forked.id]);
    expect((await t.ok('GET', '/home')).canvases[0].stars).toBe(2);
  });

  it('手动改提示词：同一位置多一个版本，正文和概述都换了，不调模型', async () => {
    const { reply } = await send('写一个');
    const node: ChatNode = await t.ok('POST', `${nodeUrl}/messages/${reply.id}/edit-prompt`, { promptIndex: 0, text: 'summary:\n改过的概述' });
    const versions = Object.values(node.messages).filter((m) => m.parentId === reply.parentId);
    expect(versions).toHaveLength(2);

    const edited = versions.find((m) => m.id !== reply.id)!;
    expect(edited.editedFromMessageId).toBe(reply.id);
    expect(edited.parsed?.prompts[0].text).toBe('summary:\n改过的概述');
    expect(edited.parsed?.title).toBe('测试标题');
    expect(edited.text).toContain('历史消息 1 条');
    expect(edited.usage).toBeUndefined();
    expect(node.activeChildOf[reply.parentId!]).toBe(edited.id);
    expect((await t.ok('GET', `/canvases/${canvasId}`)).nodes[0].summary).toBe('改过的概述');

    expect((await t.call('POST', `${nodeUrl}/messages/${reply.id}/edit-prompt`, { promptIndex: 3, text: 'x' })).status).toBe(404);
  });

  it('翻译：只把框里的提示词和要求发给模型，译文存进回复；同一个框同一种语言再翻就换掉；手动改了这个框，新版本不带它的译文', async () => {
    const { reply } = await send('写一个');
    const url = `${nodeUrl}/messages/${reply.id}/translate`;
    const box = reply.parsed!.prompts[0].text;

    const first: PromptTranslation = await t.ok('POST', url, { promptIndex: 0, language: '英文', instruction: ' 台词也翻译 ' });
    expect(first).toMatchObject({ promptIndex: 0, language: '英文', instruction: '台词也翻译', modelConfigId: 'mock', modelName: 'mock-model' });
    expect(first.text).toBe(`译文（英文），按要求：台词也翻译\n${box}`);
    expect(first.usage?.completionTokens).toBeGreaterThan(0);

    await t.ok('POST', url, { promptIndex: 0, language: '日文' });
    const again: PromptTranslation = await t.ok('POST', url, { promptIndex: 0, language: '英文' });
    expect(again.text).toBe(`译文（英文）\n${box}`);
    expect((await getNode()).messages[reply.id].translations!.map((tr) => [tr.language, tr.text])).toEqual([
      ['日文', `译文（日文）\n${box}`],
      ['英文', `译文（英文）\n${box}`],
    ]);

    expect((await t.call('POST', url, { promptIndex: 3, language: '英文' })).status).toBe(404);
    expect((await t.call('POST', url, { promptIndex: 0, language: '法文' })).status).toBe(400);

    const node: ChatNode = await t.ok('POST', `${nodeUrl}/messages/${reply.id}/edit-prompt`, { promptIndex: 0, text: 'summary:\n改过的概述' });
    const edited = Object.values(node.messages).find((m) => m.editedFromMessageId === reply.id)!;
    expect(edited.translations).toBeUndefined();
    expect(node.messages[reply.id].translations).toHaveLength(2);
  });

  it('回复角落点提示词名，读到的是发这条时的那一版，之后改了也不影响', async () => {
    const { reply } = await send('写一个');
    const original = await fs.readFile(path.join(t.work, 'prompts', 'ref2va.md'), 'utf8');
    expect((await t.ok('GET', `/prompts/ref2va/history/${reply.systemPromptHash}`)).text).toBe(original);

    await t.ok('PUT', '/prompts/ref2va', { text: '新版提示词' });
    expect((await t.ok('GET', `/prompts/ref2va/history/${reply.systemPromptHash}`)).text).toBe(original);
    expect((await t.call('GET', '/prompts/ref2va/history/zzz')).status).toBe(400);
    expect((await t.call('GET', `/prompts/ref2va/history/${'0'.repeat(12)}`)).status).toBe(404);
  });
});
