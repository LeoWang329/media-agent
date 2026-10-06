import { describe, expect, it } from 'vitest';
import {
  composeMessages,
  effectiveTurnLimit,
  hasUnsentSettings,
  JPEG_QUALITIES,
  imageSizeFits,
  MAX_IMAGE_BYTES,
  needsJpeg,
  pathSnapshot,
  planResize,
  recentTurns,
  slotDiff,
} from '../src';
import type { AspectRatio, ChatNode, Message } from '../src';

const snapshot = (slotSnapshot: string[], duration = 8, aspectRatio: AspectRatio = '16:9') => ({ slotSnapshot, duration, aspectRatio });
const settings = (slots: string[], duration = 8, aspectRatio: AspectRatio = '16:9') => ({ slots, duration, aspectRatio });

describe('slotDiff', () => {
  it('节点里还没有消息：带全部图，说明写张数、时长和比例；没有图时写本次没有参考图', () => {
    expect(slotDiff(null, settings(['a', 'b', 'c']))).toEqual({
      systemNote: '参考图共 3 张，编号如下。视频时长 8 秒，画面比例 16:9。',
      attachments: [
        { picture: 1, imageId: 'a' },
        { picture: 2, imageId: 'b' },
        { picture: 3, imageId: 'c' },
      ],
    });
    expect(slotDiff(null, settings([], 12, 'auto'))).toEqual({ systemNote: '本次没有参考图。视频时长 12 秒，画面比例 自动。', attachments: [] });
  });

  it('图没变：不带图；时长或比例变了才有说明，两句可以并列', () => {
    expect(slotDiff(snapshot(['a', 'b']), settings(['a', 'b']))).toEqual({ attachments: [] });
    expect(slotDiff(snapshot(['a', 'b']), settings(['a', 'b'], 12))).toEqual({ systemNote: '视频时长改为 12 秒。', attachments: [] });
    expect(slotDiff(snapshot(['a']), settings(['a'], 12, 'auto'))).toEqual({
      systemNote: '视频时长改为 12 秒。画面比例改为 自动。',
      attachments: [],
    });
  });

  it('生图节点：说明不写时长和比例，图的部分照旧', () => {
    expect(slotDiff(null, settings(['a']), 'image')).toEqual({ systemNote: '参考图共 1 张，编号如下。', attachments: [{ picture: 1, imageId: 'a' }] });
    expect(slotDiff(null, settings([]), 'image')).toEqual({ systemNote: '本次没有参考图。', attachments: [] });
    expect(slotDiff(snapshot(['a']), settings(['a'], 12, 'auto'), 'image')).toEqual({ attachments: [] });
    expect(slotDiff(snapshot(['a']), settings(['a', 'b'], 12), 'image')).toEqual({ systemNote: '新增参考图：<Picture 2>。', attachments: [{ picture: 2, imageId: 'b' }] });
  });

  it('在末尾追加：只带新的', () => {
    expect(slotDiff(snapshot(['a', 'b', 'c']), settings(['a', 'b', 'c', 'd', 'e']))).toEqual({
      systemNote: '新增参考图：<Picture 4>、<Picture 5>。',
      attachments: [
        { picture: 4, imageId: 'd' },
        { picture: 5, imageId: 'e' },
      ],
    });
  });

  it('长度相同只换了几张：只带换掉的，时长变化的句子接在后面', () => {
    expect(slotDiff(snapshot(['a', 'b', 'c']), settings(['a', 'x', 'y'], 10))).toEqual({
      systemNote: '<Picture 2>、<Picture 3> 换成了下面的新图，其他不变。视频时长改为 10 秒。',
      attachments: [
        { picture: 2, imageId: 'x' },
        { picture: 3, imageId: 'y' },
      ],
    });
  });

  it('删了图、调了顺序、既换又加：带全部并说明重新编号', () => {
    const renumbered = (count: number) => `参考图已重新编号，以下是当前全部 ${count} 张参考图，以此为准，之前的编号作废。`;
    expect(slotDiff(snapshot(['a', 'b', 'c']), settings(['b', 'c']))).toEqual({
      systemNote: renumbered(2),
      attachments: [
        { picture: 1, imageId: 'b' },
        { picture: 2, imageId: 'c' },
      ],
    });
    expect(slotDiff(snapshot(['a', 'b']), settings(['b', 'a'])).systemNote).toBe(renumbered(2));
    expect(slotDiff(snapshot(['a', 'b']), settings(['a', 'x', 'y'])).systemNote).toBe(renumbered(3));
    expect(slotDiff(snapshot(['a', 'b']), settings(['a', 'x', 'y'])).attachments).toHaveLength(3);
  });

  it('切换版本前判断有没有没发出的改动，切换后取新路径最后一条消息的快照', () => {
    const message = (id: string, parentId: string | null, slots: string[], duration = 8): Message => ({
      id,
      parentId,
      role: parentId ? 'assistant' : 'user',
      createdAt: '2026-09-15T00:00:00.000Z',
      text: id,
      ...snapshot(slots, duration),
    });
    const node: Pick<ChatNode, 'messages' | 'rootIds' | 'activeChildOf' | 'slots' | 'duration' | 'aspectRatio'> = {
      messages: { u1: message('u1', null, ['a']), a1: message('a1', 'u1', ['a']) },
      rootIds: ['u1'],
      activeChildOf: { root: 'u1', u1: 'a1' },
      ...settings(['a']),
    };
    expect(hasUnsentSettings(node)).toBe(false);
    expect(hasUnsentSettings({ ...node, slots: ['a', 'b'] })).toBe(true);
    expect(hasUnsentSettings({ ...node, duration: 12 })).toBe(true);
    expect(hasUnsentSettings({ ...node, messages: {}, rootIds: [], activeChildOf: {}, slots: ['b'] })).toBe(false);
    expect(pathSnapshot(node)).toEqual(settings(['a']));
  });
});

describe('composeMessages 带图', () => {
  it('第一条带全部图和说明；追问不带图；时长变化只有说明；content 顺序是说明、编号和图、用户输入', () => {
    const base = { createdAt: '2026-09-15T00:00:00.000Z', aspectRatio: '16:9' as const };
    const first = slotDiff(null, settings(['a', 'b']));
    const again = slotDiff(snapshot(['a', 'b']), settings(['a', 'b']));
    const longer = slotDiff(snapshot(['a', 'b']), settings(['a', 'b'], 12));
    const path: Message[] = [
      { ...base, id: 'u1', parentId: null, role: 'user', text: '写一个', slotSnapshot: ['a', 'b'], duration: 8, ...first },
      { ...base, id: 'a1', parentId: 'u1', role: 'assistant', text: '第一版', slotSnapshot: ['a', 'b'], duration: 8 },
      { ...base, id: 'u2', parentId: 'a1', role: 'user', text: '改一下', slotSnapshot: ['a', 'b'], duration: 8, ...again },
      { ...base, id: 'a2', parentId: 'u2', role: 'assistant', text: '第二版', slotSnapshot: ['a', 'b'], duration: 8 },
      { ...base, id: 'u3', parentId: 'a2', role: 'user', text: '长一点', slotSnapshot: ['a', 'b'], duration: 12, ...longer },
    ];
    const messages = composeMessages(path, '提示词', '格式', (id) => `data:${id}`);
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '参考图共 2 张，编号如下。视频时长 8 秒，画面比例 16:9。' },
        { type: 'text', text: '<Picture 1>' },
        { type: 'image_url', image_url: { url: 'data:a' } },
        { type: 'text', text: '<Picture 2>' },
        { type: 'image_url', image_url: { url: 'data:b' } },
        { type: 'text', text: '写一个' },
      ],
    });
    expect(messages[3]).toEqual({ role: 'user', content: [{ type: 'text', text: '改一下' }] });
    expect(messages[5]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '视频时长改为 12 秒。' },
        { type: 'text', text: '长一点' },
      ],
    });
  });
});

describe('只带最近几轮', () => {
  const base = { createdAt: '2026-10-06T00:00:00.000Z', aspectRatio: '16:9' as const };
  const user = (id: string, slots: string[], duration: number, diff: ReturnType<typeof slotDiff>): Message => ({
    ...base,
    id,
    parentId: null,
    role: 'user',
    text: id,
    slotSnapshot: slots,
    duration,
    ...diff,
  });
  const reply = (id: string, slots: string[], duration: number, extra: Partial<Message> = {}): Message => ({
    ...base,
    id,
    parentId: null,
    role: 'assistant',
    text: id,
    slotSnapshot: slots,
    duration,
    ...extra,
  });
  // 第一轮放了两张，第二轮加了一张，第三轮改了时长，第四轮什么都没改
  const path = [
    user('u1', ['a', 'b'], 8, slotDiff(null, settings(['a', 'b']))),
    reply('a1', ['a', 'b'], 8),
    user('u2', ['a', 'b', 'c'], 8, slotDiff(snapshot(['a', 'b']), settings(['a', 'b', 'c']))),
    reply('a2', ['a', 'b', 'c'], 8),
    reply('h2', ['a', 'b', 'c'], 8, { handwritten: true }),
    user('u3', ['a', 'b', 'c'], 12, slotDiff(snapshot(['a', 'b', 'c']), settings(['a', 'b', 'c'], 12))),
    reply('a3', ['a', 'b', 'c'], 12),
    user('u4', ['a', 'b', 'c'], 12, slotDiff(snapshot(['a', 'b', 'c'], 12), settings(['a', 'b', 'c'], 12))),
  ];

  it('全带或者没超过：原样发', () => {
    expect(recentTurns(path, 'all', 'video')).toEqual({ path, kept: 4, dropped: 0 });
    expect(recentTurns(path, 5, 'video')).toEqual({ path, kept: 4, dropped: 0 });
    expect(recentTurns(path, 4, 'video').path).toBe(path);
  });

  it('超过了：发的一条算一轮，从倒数第 N 条往后带；留下的第一条带上它发出时槽位里的全部图和完整说明，后面照存的发', () => {
    const { path: sent, kept, dropped } = recentTurns(path, 2, 'video');
    expect([kept, dropped]).toEqual([2, 2]);
    expect(sent.map((m) => m.id)).toEqual(['u3', 'a3', 'u4']);
    expect(sent[0]).toMatchObject({
      systemNote: '参考图共 3 张，编号如下。视频时长 12 秒，画面比例 16:9。',
      attachments: [
        { picture: 1, imageId: 'a' },
        { picture: 2, imageId: 'b' },
        { picture: 3, imageId: 'c' },
      ],
      text: 'u3',
    });
    expect(sent[2]).toBe(path[7]);
    // 存着的那条不改
    expect(path[5]).toMatchObject({ systemNote: '视频时长改为 12 秒。', attachments: [] });

    // 留下的第一条前面是自己写的框：框算在前一轮里，一起截掉
    expect(recentTurns(path, 3, 'video').path.map((m) => m.id)).toEqual(['u2', 'a2', 'h2', 'u3', 'a3', 'u4']);
    expect(recentTurns(path, 1, 'image').path).toEqual([{ ...path[7], systemNote: '参考图共 3 张，编号如下。', attachments: expect.any(Array) }]);
  });

  it('节点自己设了按节点的，没设或者跟设置按设置里的', () => {
    expect(effectiveTurnLimit({}, { turnLimit: 20 })).toBe(20);
    expect(effectiveTurnLimit({ turnLimit: 'follow' }, { turnLimit: 20 })).toBe(20);
    expect(effectiveTurnLimit({ turnLimit: 'all' }, { turnLimit: 20 })).toBe('all');
    expect(effectiveTurnLimit({ turnLimit: 5 }, { turnLimit: 'all' })).toBe(5);
  });
});

describe('imageRules', () => {
  it('长边超过 5760 缩到 5760；正好 5760 不动', () => {
    expect(planResize(6000, 4000)).toEqual({ width: 5760, height: 3840, reason: 'too-large' });
    expect(planResize(3000, 8000)).toEqual({ width: 2160, height: 5760, reason: 'too-large' });
    expect(planResize(5760, 4000)).toBeNull();
  });

  it('短边不到 256 放大到 256；正好 256 不动', () => {
    expect(planResize(200, 150)).toEqual({ width: 341, height: 256, reason: 'too-small' });
    expect(planResize(256, 256)).toBeNull();
  });

  it('两条冲突的极端长条图以不超过 5760 为准，处理后仍标成尺寸不符', () => {
    const wide = planResize(12000, 300)!;
    expect(wide).toEqual({ width: 5760, height: 144, reason: 'too-large' });
    expect(imageSizeFits(wide.width, wide.height)).toBe(false);
    const tall = planResize(100, 5000)!;
    expect(tall).toEqual({ width: 115, height: 5760, reason: 'too-small' });
    expect(imageSizeFits(tall.width, tall.height)).toBe(false);
    expect(planResize(5760, 200)).toBeNull();
    expect(imageSizeFits(800, 600)).toBe(true);
  });

  it('超过 30 MB 才转 JPEG，质量从 90 开始每次降 5', () => {
    expect(needsJpeg(MAX_IMAGE_BYTES)).toBe(false);
    expect(needsJpeg(MAX_IMAGE_BYTES + 1)).toBe(true);
    expect(JPEG_QUALITIES.slice(0, 3)).toEqual([90, 85, 80]);
    expect(JPEG_QUALITIES.at(-1)).toBe(5);
  });
});
