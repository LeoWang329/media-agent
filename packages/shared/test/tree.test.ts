import { describe, expect, it } from 'vitest';
import { activePath, addMessage, composeMessages, directionDraft, editedPromptMessage, editedUserMessage, forkChain, handwrittenMessage, parseReply, switchVersion, versionsOf } from '../src';
import type { ChatNode, Message } from '../src';

let clock = 0;
function message(id: string, parentId: string | null, role: Message['role'], extra: Partial<Message> = {}): Message {
  clock += 1;
  return { id, parentId, role, text: id, createdAt: new Date(Date.UTC(2026, 8, 15, 0, 0, clock)).toISOString(), slotSnapshot: [], duration: 8, aspectRatio: '16:9', ...extra };
}

type Tree = Pick<ChatNode, 'messages' | 'rootIds' | 'activeChildOf'>;
const empty = (): Tree => ({ messages: {}, rootIds: [], activeChildOf: {} });
const build = (...messages: Message[]) => messages.reduce(addMessage, empty());
const ids = (messages: Message[]) => messages.map((m) => m.id);

describe('versionTree', () => {
  it('当前路径沿 activeChildOf 往下走；新消息成为当前版本', () => {
    const tree = build(message('u1', null, 'user'), message('a1', 'u1', 'assistant'), message('u2', 'a1', 'user'));
    expect(ids(activePath(tree))).toEqual(['u1', 'a1', 'u2']);
    expect(tree.rootIds).toEqual(['u1']);

    const regenerated = addMessage(tree, message('a1b', 'u1', 'assistant'));
    expect(regenerated.activeChildOf.u1).toBe('a1b');
    expect(ids(activePath(regenerated))).toEqual(['u1', 'a1b']);
    expect(ids(versionsOf(regenerated, regenerated.messages.a1))).toEqual(['a1', 'a1b']);
  });

  it('切换版本不影响更深层，切回来后面的对话原样恢复', () => {
    let tree = build(message('u1', null, 'user'), message('a1', 'u1', 'assistant'), message('u2', 'a1', 'user'), message('a2', 'u2', 'assistant'));
    tree = addMessage(tree, message('u1b', null, 'user'));
    tree = addMessage(tree, message('a1c', 'u1b', 'assistant'));
    expect(ids(activePath(tree))).toEqual(['u1b', 'a1c']);
    expect(tree.rootIds).toEqual(['u1', 'u1b']);

    tree = switchVersion(tree, 'u1');
    expect(ids(activePath(tree))).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(tree.activeChildOf.u1b).toBe('a1c');
  });

  it('编辑用户消息：新文字，快照、时长、比例、附图、说明照抄原来那条', () => {
    const original = message('u1', 'a0', 'user', {
      slotSnapshot: ['img1', 'img2'],
      duration: 12,
      aspectRatio: '9:16',
      systemNote: '参考图共 2 张',
      attachments: [{ picture: 1, imageId: 'img1' }],
    });
    const edited = editedUserMessage(original, '改过的', 'u1b', '2026-09-15T01:00:00.000Z');
    expect(edited).toEqual({ ...original, id: 'u1b', text: '改过的', createdAt: '2026-09-15T01:00:00.000Z' });
  });
});

describe('forkChain', () => {
  const tree = build(
    message('u1', null, 'user', { slotSnapshot: ['a'], duration: 6 }),
    message('a1', 'u1', 'assistant', { slotSnapshot: ['a'], duration: 6 }),
    message('u2', 'a1', 'user', { slotSnapshot: ['a', 'b'], duration: 10, aspectRatio: '1:1' }),
    message('a2', 'u2', 'assistant', { slotSnapshot: ['a', 'b'], duration: 10, aspectRatio: '1:1' }),
  );
  const withSibling = addMessage(switchVersion(tree, 'a1'), message('a1x', 'u1', 'assistant'));

  it('从 assistant 消息 fork：链含这条消息，只复制链上的，槽位时长比例取链上最后一条', () => {
    const fork = forkChain(switchVersion(withSibling, 'a1'), 'a2', '沿第 1 个方向往下改：');
    expect(Object.keys(fork.messages)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(fork.messages.u2.parentId).toBe('a1');
    expect(fork.rootIds).toEqual(['u1']);
    expect(ids(activePath(fork))).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect([fork.slots, fork.duration, fork.aspectRatio, fork.draft]).toEqual([['a', 'b'], 10, '1:1', '沿第 1 个方向往下改：']);
  });

  it('从 user 消息 fork：链到上一条为止，文字放进输入框；链为空时快照取这条消息的', () => {
    const fork = forkChain(tree, 'u2');
    expect(Object.keys(fork.messages)).toEqual(['u1', 'a1']);
    expect([fork.draft, fork.slots, fork.duration]).toEqual(['u2', ['a'], 6]);

    const fromFirst = forkChain(tree, 'u1');
    expect([fromFirst.messages, fromFirst.rootIds, fromFirst.activeChildOf]).toEqual([{}, [], {}]);
    expect([fromFirst.draft, fromFirst.slots, fromFirst.duration]).toEqual(['u1', ['a'], 6]);
  });

  it('沿第 N 个方向的预填文字', () => {
    expect(directionDraft(1, '方向二：快切')).toBe('沿第 2 个方向（方向二：快切）往下改：');
    expect(directionDraft(0)).toBe('沿第 1 个方向往下改：');
  });
});

describe('composeMessages', () => {
  it('system 是提示词加两个空行加格式要求；失败和空的回复跳过；user 的 content 是数组', () => {
    const path = [
      message('u1', null, 'user', { text: '写一个' }),
      message('a1', 'u1', 'assistant', { text: '', error: 'HTTP 500：x' }),
      message('a1b', 'u1', 'assistant', { text: '第一版' }),
      message('u2', 'a1b', 'user', { text: '改一下' }),
    ];
    expect(composeMessages(path, {}, '系统提示词\n', '\n格式要求\n', (id) => id)).toEqual([
      { role: 'system', content: '系统提示词\n\n\n格式要求' },
      { role: 'user', content: [{ type: 'text', text: '写一个' }] },
      { role: 'assistant', content: '第一版' },
      { role: 'user', content: [{ type: 'text', text: '改一下' }] },
    ]);
  });

  it('自己写的框：一条回复里只有这个框，标着自己写的；发给模型时当成用户说的话', () => {
    const node = { slots: ['img1'], duration: 8, aspectRatio: '16:9' as const, systemPromptName: 'il' };
    const written = handwrittenMessage(node, 'a1', '1girl, solo,\nred hair', 'h1', '2026-10-04T00:00:00.000Z');
    expect(written).toMatchObject({ role: 'assistant', parentId: 'a1', slotSnapshot: ['img1'], systemPromptName: 'il', handwritten: true });
    expect(written.parsed?.prompts).toEqual([{ index: 0, text: '1girl, solo,\nred hair', summary: expect.any(String) }]);

    const path = [message('u1', null, 'user', { text: '写一个' }), message('a1', 'u1', 'assistant', { text: '第一版' }), written, message('u2', 'h1', 'user', { text: '优化一下' })];
    expect(composeMessages(path, {}, '系统提示词', '格式要求', (id) => id).slice(2)).toEqual([
      { role: 'assistant', content: '第一版' },
      { role: 'user', content: '我自己写了一个框：\n<prompt>\n1girl, solo,\nred hair\n</prompt>' },
      { role: 'user', content: [{ type: 'text', text: '优化一下' }] },
    ]);
  });

  it('手动改过的框：先发模型写的那一版，再当成用户说的话发改过的框全文；改过几次的和模型写的那版比', () => {
    const reply = ['<title>两个方向</title>', '<prompt label="方向一">', '镜头贴地仰拍', '</prompt>', '<prompt label="方向二">', '正面中景', '</prompt>', '要改告诉我'].join('\n');
    const original = message('a1', 'u1', 'assistant', { text: reply, parsed: parseReply(reply) });
    const once = editedPromptMessage(original, 0, '镜头从脚边升到上身', 'a1e', '2026-10-07T00:00:00.000Z')!;
    const twice = editedPromptMessage(once, 1, '正面中景\n她捂住胸口', 'a1f', '2026-10-07T00:00:01.000Z')!;
    const tree = build(message('u1', null, 'user', { text: '写两个' }), original, once, twice, message('u2', 'a1f', 'user', { text: '第二个再慌一点' }));
    expect(composeMessages(activePath(tree), tree.messages, '系统提示词', '格式要求', (id) => id).slice(2)).toEqual([
      { role: 'assistant', content: reply },
      {
        role: 'user',
        content: [
          '我手动改了你上面这条回复里的框，改完是这样：',
          '第 1 个框（方向一）：\n<prompt>\n镜头从脚边升到上身\n</prompt>',
          '第 2 个框（方向二）：\n<prompt>\n正面中景\n她捂住胸口\n</prompt>',
          '之后在我改的这一版上接着改，我改过的地方不要改回去。',
        ].join('\n\n'),
      },
      { role: 'user', content: [{ type: 'text', text: '第二个再慌一点' }] },
    ]);

    // 改回和原来一样，就不多发那一条
    const back = editedPromptMessage(original, 0, '镜头贴地仰拍', 'a1g', '2026-10-07T00:00:02.000Z')!;
    expect(composeMessages([back], { a1: original, a1g: back }, '', '', (id) => id).slice(1)).toEqual([{ role: 'assistant', content: reply }]);
  });
});
