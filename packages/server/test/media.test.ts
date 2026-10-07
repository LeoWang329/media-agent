import type { AssetFile, CanvasDetail, ChatNode, MediaRecord, MediaSlot, Message } from '@media-agent/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

// 视频和音频参考，见 docs/dev-plan.md 5.31：资产库列出来、放进画布、节点的槽位、发给写提示词的模型的说明和截帧

const FIXTURES = new URL('../../../tests/fixtures/media/', import.meta.url);
const fixture = (name: string) => new URL(name, FIXTURES);

let t: TestApp;
let canvasId: string;
let nodeId: string;
let library: string;

const nodeUrl = () => `/canvases/${canvasId}/nodes/${nodeId}`;

beforeEach(async () => {
  t = await startTestApp();
  canvasId = (await t.ok('POST', '/canvases', { title: '视频音频' })).id;
  nodeId = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0 })).id;
  library = path.join(t.work, 'library');
  await fs.mkdir(library, { recursive: true });
  for (const name of ['talk.mp4', 'silent.mp4', 'voice.mp3']) await fs.copyFile(fixture(name), path.join(library, name));
  await fs.writeFile(path.join(library, 'notes.txt'), '不列');
  await t.ok('POST', '/assets/folders', { path: library });
});

afterEach(async () => {
  await t.cleanup();
});

const addMedia = (name: string, meta: Record<string, unknown>) => t.ok<MediaRecord>('POST', `/canvases/${canvasId}/media`, { path: path.join(library, name), ...meta });

async function send(text: string, parentId: string | null): Promise<{ user: Message; reply: Message }> {
  const events = (await t.stream(`${nodeUrl()}/send`, { parentId, text })) as { type: string; message: Message }[];
  return { user: events.find((e) => e.type === 'user')!.message, reply: events.at(-1)!.message };
}

describe('资产库里的视频和音频', () => {
  it('列出来，标着是视频还是音频；原文件能按 Range 取，图不从这里给', async () => {
    const files = await t.ok<AssetFile[]>('GET', `/assets/list?folder=${encodeURIComponent(library)}`);
    expect(files.map((f) => [f.name, f.kind, f.supported])).toEqual([
      ['silent.mp4', 'video', true],
      ['talk.mp4', 'video', true],
      ['voice.mp3', 'audio', true],
    ]);
    const res = await fetch(`${t.base}/assets/file?path=${encodeURIComponent(path.join(library, 'talk.mp4'))}`, { headers: { Range: 'bytes=0-99' } });
    expect(res.status).toBe(206);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    const image = await t.addImage(canvasId, '#123456');
    expect(image).toBeTruthy();
    const jpg = path.join(t.work, 'test-images', '123456-300x300.jpg');
    expect((await t.call('GET', `/assets/file?path=${encodeURIComponent(jpg)}`)).status).toBe(415);
  });
});

describe('放进画布', () => {
  it('按路径复制一份，同样内容复用；拖进来的边收边存；不到 2 秒的、不认识的格式不收；画布里那份能按 Range 取', async () => {
    const talk = await addMedia('talk.mp4', { seconds: 3, width: 160, height: 90, hasAudio: true });
    expect(talk).toMatchObject({ kind: 'video', ext: 'mp4', originalName: 'talk.mp4', seconds: 3, width: 160, height: 90, hasAudio: true });
    const stored = path.join(t.work, 'canvases', canvasId, 'media', `${talk.sha256}.mp4`);
    expect((await fs.readFile(stored)).equals(await fs.readFile(fixture('talk.mp4')))).toBe(true);
    expect((await addMedia('talk.mp4', { seconds: 3 })).id).toBe(talk.id);

    const body = await fs.readFile(fixture('voice.mp3'));
    const res = await fetch(`${t.base}/canvases/${canvasId}/media/upload?name=${encodeURIComponent('人声.mp3')}&seconds=4`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    });
    const voice = (await res.json()) as MediaRecord;
    expect(voice).toMatchObject({ kind: 'audio', ext: 'mp3', originalPath: '', originalName: '人声.mp3', seconds: 4, bytes: body.length });
    expect(voice.width).toBeUndefined();

    expect(await t.call('POST', `/canvases/${canvasId}/media`, { path: path.join(library, 'voice.mp3'), seconds: 1.4 })).toMatchObject({
      status: 400,
      body: { error: 'voice.mp3 只有 1.4 秒，不到 2 秒的用不了' },
    });
    expect((await t.call('POST', `/canvases/${canvasId}/media`, { path: path.join(library, 'notes.txt'), seconds: 3 })).status).toBe(400);

    const detail = await t.ok<CanvasDetail>('GET', `/canvases/${canvasId}`);
    expect(Object.keys(detail.media).sort()).toEqual([talk.id, voice.id].sort());
    const file = await fetch(`${t.base}/canvases/${canvasId}/media/${voice.id}/file`, { headers: { Range: 'bytes=10-19' } });
    expect(file.status).toBe(206);
    expect(Buffer.from(await file.arrayBuffer()).equals(body.subarray(10, 20))).toBe(true);
    // 临时文件都改了名，media 文件夹里只有这两个
    expect((await fs.readdir(path.join(t.work, 'canvases', canvasId, 'media'))).sort()).toEqual([`${talk.sha256}.mp4`, `${voice.sha256}.mp3`].sort());
  });
});

describe('节点的视频和音频槽位', () => {
  it('视频在前、音频在后；各最多 3 个；开始的秒数要在长度以内；生图节点不能放', async () => {
    const talk = await addMedia('talk.mp4', { seconds: 3, width: 160, height: 90, hasAudio: true });
    const voice = await addMedia('voice.mp3', { seconds: 4 });
    const audio: MediaSlot = { kind: 'audio', mediaId: voice.id, seconds: 4, start: 0, use: 'voice' };
    const video: MediaSlot = { kind: 'video', mediaId: talk.id, seconds: 3, start: 0.5, use: 'both' };
    const node = await t.ok<ChatNode>('PATCH', nodeUrl(), { media: [audio, video] });
    expect(node.media).toEqual([video, audio]);
    expect((await t.call('PATCH', nodeUrl(), { media: [audio, audio, audio, audio] })).body).toEqual({ error: '视频、音频各最多放 3 个' });
    expect((await t.call('PATCH', nodeUrl(), { media: [{ ...video, start: 3 }] })).body).toEqual({ error: '从第几秒开始要在 0 到这段的长度之间' });
    // 视频能填到第几秒：要比开始的秒数大，不超过这段的长度
    expect((await t.ok<ChatNode>('PATCH', nodeUrl(), { media: [{ ...video, end: 2.8 }] })).media).toEqual([{ ...video, end: 2.8 }]);
    for (const end of [0.5, 3.1]) expect((await t.call('PATCH', nodeUrl(), { media: [{ ...video, end }] })).body).toEqual({ error: '到第几秒要比开始的秒数大，不超过这段的长度' });
    expect((await t.call('PATCH', nodeUrl(), { media: [{ ...audio, use: 'both' }] })).body).toEqual({ error: '音频怎么用只能是 voice、dub' });

    const imageNode = (await t.ok('POST', `/canvases/${canvasId}/nodes`, { x: 0, y: 0, kind: 'image' })).id;
    expect((await t.call('PATCH', `/canvases/${canvasId}/nodes/${imageNode}`, { media: [audio] })).body).toEqual({ error: '生图节点不能放视频和音频' });
  });

  it('发给模型：第一条说清编号和取多少秒，截帧跟在后面；没变的不再说；变了把全部重说一遍；全删了说一声；切版本、岔出、撤回照槽位的办法', async () => {
    const talk = await addMedia('talk.mp4', { seconds: 3, width: 160, height: 90, hasAudio: true });
    const silent = await addMedia('silent.mp4', { seconds: 3, width: 160, height: 90, hasAudio: false });
    const voice = await addMedia('voice.mp3', { seconds: 4 });
    const frame = await t.addImage(canvasId, '#aa3300');
    const picture = await t.addImage(canvasId, '#0033aa');
    const media: MediaSlot[] = [
      { kind: 'video', mediaId: silent.id, seconds: 3, start: 0, use: 'picture' },
      { kind: 'video', mediaId: talk.id, seconds: 3, start: 0.5, use: 'both', frame },
      { kind: 'audio', mediaId: voice.id, seconds: 4, start: 1, use: 'voice' },
    ];
    await t.ok('PATCH', nodeUrl(), { slots: [picture], media });

    const first = await send('写一个', null);
    expect(first.user.systemNote).toBe(
      '参考图共 1 张，编号如下。视频时长 8 秒，画面比例 16:9。参考视频 2 段、参考音频 2 段：<Video 1> 取 2.3 秒，只用画面；<Video 2> 取 2.3 秒，画面和声音都用，它的声音是 <Audio 1>；<Audio 2> 取 3 秒。下面是 <Video 2> 各截的一帧。',
    );
    expect(first.user.frames).toEqual([{ video: 2, imageId: frame }]);
    expect(first.user.mediaSnapshot).toEqual(media);
    expect(first.reply.mediaSnapshot).toEqual(media);
    expect(first.reply.text).toContain('收到 2 张图：<Picture 1>、<Video 2>');

    const second = await send('再改改', first.reply.id);
    expect(second.user.systemNote).toBeUndefined();
    expect(second.user.frames).toBeUndefined();

    // 视频 1 改成只用声音，音频改成配音：编号跟着变
    const changed = [{ ...media[0], use: 'sound' }, media[1], { ...media[2], use: 'dub' }] as MediaSlot[];
    await t.ok('PATCH', nodeUrl(), { media: changed });
    const third = await send('换个用法', second.reply.id);
    expect(third.user.systemNote).toBe(
      '参考视频和音频改了，以下是现在全部的，以此为准。参考视频 1 段、参考音频 2 段：<Video 1> 取 2.3 秒，画面和声音都用，它的声音是 <Audio 1>；<Audio 2> 取 3 秒，是一段视频里的声音。配音：一段 3 秒的音频当整条视频的声音，人物跟着它对口型。下面是 <Video 1> 各截的一帧。',
    );
    expect(third.user.frames).toEqual([{ video: 1, imageId: frame }]);

    // 没发出去的改动算视频和音频；撤回照最后一条记下的
    await t.ok('PATCH', nodeUrl(), { media: [] });
    const fourth = await send('不要视频音频了', third.reply.id);
    expect(fourth.user.systemNote).toBe('参考视频和音频都去掉了。');
    expect(fourth.user.mediaSnapshot).toBeUndefined();

    // 从第一条回复岔出去：带着那时候的视频和音频
    const fork = await t.ok<ChatNode>('POST', `${nodeUrl()}/fork`, { messageId: first.reply.id });
    expect(fork.media).toEqual(media);
    // 编辑第一条：只改文字，视频音频、截帧照旧
    const events = (await t.stream(`${nodeUrl()}/messages/${first.user.id}/edit`, { text: '写一个别的' })) as { type: string; message: Message }[];
    const editedUser = events.find((e) => e.type === 'user')!.message;
    expect(editedUser).toMatchObject({ mediaSnapshot: media, frames: [{ video: 2, imageId: frame }], systemNote: first.user.systemNote });
  });
});
