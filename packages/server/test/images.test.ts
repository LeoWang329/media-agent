import type { ChatNode, ImageRecord, Message } from '@media-agent/shared';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES, makeFixtureImages } from '../../../tests/fixtures/makeImages';
import { startTestApp, type TestApp } from './helpers';

let fixtures: string;
let t: TestApp;
let canvasId: string;
let nodeUrl: string;

beforeAll(async () => {
  fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'media-agent-fixtures-'));
  await makeFixtureImages(fixtures);
});

afterAll(async () => {
  await fs.rm(fixtures, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await startTestApp();
  await t.ok('POST', '/assets/folders', { path: fixtures });
  canvasId = (await t.ok('POST', '/canvases', { title: '图片' })).id;
  nodeUrl = `/canvases/${canvasId}/nodes/${(await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0 })).id}`;
});

afterEach(async () => {
  await t.cleanup();
});

const importImage = (name: string): Promise<ImageRecord> => t.ok('POST', `/canvases/${canvasId}/images`, { path: path.join(fixtures, name), nodeId: nodeUrl.split('/').at(-1) });
const imagesDir = () => path.join(t.work, 'canvases', canvasId, 'images');
const size = async (file: string) => {
  const { width, height } = await sharp(await fs.readFile(file)).metadata();
  return [width, height];
};

describe('放进槽位的图', () => {
  it('正常图原样复制；同一文件再放一次复用 id；发给模型的小图不放大；画布详情和缩略图接口能拿到', async () => {
    const image = await importImage(FIXTURES.first);
    expect(image).toMatchObject({ ext: 'jpg', width: 800, height: 600, processed: null, originalName: FIXTURES.first });
    expect(image.originalPath).toBe(path.join(fixtures, FIXTURES.first));
    const copy = await fs.readFile(path.join(imagesDir(), `${image.sha256}.jpg`));
    expect(copy.equals(await fs.readFile(path.join(fixtures, FIXTURES.first)))).toBe(true);
    expect(await size(path.join(imagesDir(), `${image.sha256}.llm.jpg`))).toEqual([800, 600]);

    expect((await importImage(FIXTURES.first)).id).toBe(image.id);
    const records = JSON.parse(await fs.readFile(path.join(t.work, 'canvases', canvasId, 'images.json'), 'utf8'));
    expect(Object.keys(records)).toEqual([image.id]);
    expect((await t.ok('GET', `/canvases/${canvasId}`)).images).toEqual({ [image.id]: image });

    const thumb = await fetch(`${t.base}/canvases/${canvasId}/images/${image.id}/thumb`);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect(await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).toMatchObject({ width: 256, height: 192 });
    const file = await fetch(`${t.base}/canvases/${canvasId}/images/${image.id}/file`);
    expect(Buffer.from(await file.arrayBuffer()).equals(copy)).toBe(true);
  });

  it('6000 像素宽的图：画布副本长边 5760、记下原尺寸和原因；发给模型的小图长边 1600', async () => {
    const image = await importImage(FIXTURES.big);
    expect(image).toMatchObject({ width: 5760, height: 3840, processed: { reason: 'too-large', originalWidth: 6000, originalHeight: 4000 } });
    expect(await size(path.join(imagesDir(), `${image.sha256}.jpg`))).toEqual([5760, 3840]);
    expect(await size(path.join(imagesDir(), `${image.sha256}.llm.jpg`))).toEqual([1600, 1067]);
  });

  it('200 像素宽的图放大到短边 256', async () => {
    const image = await importImage(FIXTURES.small);
    expect(image).toMatchObject({ width: 341, height: 256, processed: { reason: 'too-small', originalWidth: 200, originalHeight: 150 } });
    expect(await size(path.join(imagesDir(), `${image.sha256}.jpg`))).toEqual([341, 256]);
  });

  // 生成一张超过 30 MB 的测试图、再逐级压缩要几十秒，这条改为手动验收（11.1 第 7 条）
  it.skip('处理后仍超过 30 MB 的图转成 JPEG，质量逐级降到不超过 30 MB', () => {});

  it('路径不在导入的文件夹里返回 403；读不出来的图返回 400', async () => {
    const outside = path.join(os.tmpdir(), `media-agent-outside-${Date.now()}.jpg`);
    await fs.copyFile(path.join(fixtures, FIXTURES.first), outside);
    try {
      expect((await t.call('POST', `/canvases/${canvasId}/images`, { path: outside })).status).toBe(403);
    } finally {
      await fs.rm(outside, { force: true });
    }
    expect((await t.call('POST', `/canvases/${canvasId}/images`, { path: path.join(fixtures, FIXTURES.heic) })).status).toBe(400);
    expect((await t.call('POST', `/canvases/${canvasId}/images`, { path: path.join(fixtures, '..', FIXTURES.first) })).status).toBe(403);
  });
});

describe('发消息带上槽位里的图', () => {
  async function sendWith(text: string, patch: Partial<Pick<ChatNode, 'slots' | 'duration'>>) {
    const node = await t.ok<ChatNode>('PATCH', nodeUrl, patch);
    const messages = Object.values(node.messages);
    const last = messages.length ? messages.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)) : null;
    const events = await t.stream(`${nodeUrl}/send`, { parentId: last?.id ?? null, text });
    const user = (events[0] as { message: Message }).message;
    const reply = (events.at(-1) as { message: Message }).message;
    return { user, reply: reply.text };
  }

  it('第一条带全部图；换图只带换掉的；删图重新编号；只改时长不带图', async () => {
    const [a, b, big, d] = [await importImage(FIXTURES.first), await importImage(FIXTURES.second), await importImage(FIXTURES.big), await importImage(FIXTURES.fourth)];

    const first = await sendWith('写一个', { slots: [a.id, b.id, big.id] });
    expect(first.user.attachments).toEqual([
      { picture: 1, imageId: a.id },
      { picture: 2, imageId: b.id },
      { picture: 3, imageId: big.id },
    ]);
    expect(first.reply).toContain('收到 3 张图：<Picture 1>、<Picture 2>、<Picture 3>');
    expect(first.reply).toContain('说明：参考图共 3 张，编号如下。视频时长 8 秒，画面比例 16:9。');

    const replaced = await sendWith('改一下', { slots: [a.id, d.id, big.id] });
    expect(replaced.reply).toContain('收到 1 张图：<Picture 2>');
    expect(replaced.reply).toContain('说明：<Picture 2> 换成了下面的新图，其他不变。');
    expect(replaced.reply).toContain('历史消息 3 条');

    const removed = await sendWith('再改', { slots: [d.id, big.id] });
    expect(removed.reply).toContain('收到 2 张图：<Picture 1>、<Picture 2>');
    expect(removed.reply).toContain('重新编号');

    const longer = await sendWith('长一点', { duration: 12 });
    expect(longer.user).toMatchObject({ systemNote: '视频时长改为 12 秒。', attachments: [] });
    expect(longer.reply).toContain('收到 0 张图');
    expect(longer.reply).toContain('说明：视频时长改为 12 秒。');
  });
});
