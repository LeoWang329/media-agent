import { describe, expect, it } from 'vitest';
import { cardSummary, extractSummary, parseReply, titleAfterReply } from '../src';
import type { ChatNode, Message } from '../src';

const BOX = `subject_definitions:
<Subject 1> 是 <Picture 1> 里的女生。

summary:
[reference generation] 她在雨里跑，
引用了 <Picture 1>

detailed_description:
[Shot 1] 台词 <d>[中文] 快走。</d>`;

describe('parseReply', () => {
  it('取第一个标题，框外文字去掉标题，框内原样保留、去掉首尾空行', () => {
    const reply = `<title>雨中奔跑</title>\n我假设她穿红衣服。\n\n<prompt>\n\n${BOX}\n\n</prompt>\n<title>第二个标题</title>`;
    const parsed = parseReply(reply);
    expect(parsed.title).toBe('雨中奔跑');
    expect(parsed.prompts).toHaveLength(1);
    expect(parsed.prompts[0].text).toBe(BOX);
    expect(parsed.segments[0]).toEqual({ type: 'text', text: '我假设她穿红衣服。' });
    expect(parsed.segments).toHaveLength(2);
  });

  it('框里的 <Picture 1>、<Subject 1>、<d> 不被当成标签', () => {
    const { prompts } = parseReply(`<prompt>\n${BOX}\n</prompt>`);
    expect(prompts[0].text).toContain('<Subject 1> 是 <Picture 1> 里的女生。');
    expect(prompts[0].text).toContain('<d>[中文] 快走。</d>');
  });

  it('多个带标签的框按顺序编号', () => {
    const reply = ['说明', '<prompt label="方向一：慢推">', 'summary: 一', '</prompt>', '中间的话', '<prompt label="方向二：快切">', 'summary: 二', '</prompt>'].join('\n');
    const { prompts, segments } = parseReply(reply);
    expect(prompts.map((p) => [p.index, p.label, p.summary])).toEqual([[0, '方向一：慢推', '一'], [1, '方向二：快切', '二']]);
    expect(segments.map((s) => s.type)).toEqual(['text', 'prompt', 'text', 'prompt']);
  });

  it('标签和正文写在同一行也认：开始标签后面的算框里第一行，结束标签前面的算最后一行、后面的算框外的话', () => {
    const reply = ['说明', '<prompt label="方向一：慢推">subject_definitions:', '<Subject 1> 是 <Picture 1> 里的女生。', '', 'summary: 一</prompt>要改告诉我'].join('\n');
    const { prompts, segments } = parseReply(reply);
    expect(prompts).toEqual([{ index: 0, label: '方向一：慢推', text: 'subject_definitions:\n<Subject 1> 是 <Picture 1> 里的女生。\n\nsummary: 一', summary: '一' }]);
    expect(segments.map((s) => (s.type === 'text' ? s.text : s.type))).toEqual(['说明', 'prompt', '要改告诉我']);
    expect(parseReply('<prompt>summary: 一行写完</prompt>').prompts).toEqual([{ index: 0, text: 'summary: 一行写完', summary: '一行写完' }]);
  });

  it('没有框时只有正文', () => {
    const { prompts, segments, title } = parseReply('这是回答。');
    expect(title).toBeUndefined();
    expect(prompts).toEqual([]);
    expect(segments).toEqual([{ type: 'text', text: '这是回答。' }]);
  });

  it('流式收到一半：还没收到 </prompt> 的框标成未完成，不算进 prompts', () => {
    const { prompts, segments } = parseReply('<title>标</title>\n<prompt label="方向一">\nsubject_definitions:\n<Subject 1> 是');
    expect(prompts).toEqual([]);
    expect(segments).toEqual([{ type: 'prompt', index: 0, label: '方向一', text: 'subject_definitions:\n<Subject 1> 是', summary: 'subject_definitions:<Subject 1> 是', closed: false }]);
  });
});

describe('extractSummary', () => {
  it('取 summary: 后面到下一个部分名之间的文字，去掉换行', () => {
    expect(extractSummary(BOX)).toBe('[reference generation] 她在雨里跑，引用了 <Picture 1>');
    expect(extractSummary('SUMMARY: same line\nnext line\nretention_analysis:\nx')).toBe('same line next line');
  });

  it('没有 summary 行时取前两行非空文字', () => {
    expect(extractSummary('\n第一行\n\n第二行\n第三行')).toBe('第一行第二行');
  });
});

function message(id: string, parentId: string | null, role: Message['role'], text: string, extra: Partial<Message> = {}): Message {
  return { id, parentId, role, text, createdAt: `2026-09-15T00:00:0${id.length}.000Z`, slotSnapshot: [], duration: 8, aspectRatio: '16:9', ...extra };
}

function treeOf(messages: Message[]): Pick<ChatNode, 'messages' | 'rootIds' | 'activeChildOf'> {
  const activeChildOf: Record<string, string> = {};
  for (const m of messages) activeChildOf[m.parentId ?? 'root'] = m.id;
  return { messages: Object.fromEntries(messages.map((m) => [m.id, m])), rootIds: messages.filter((m) => !m.parentId).map((m) => m.id), activeChildOf };
}

describe('cardSummary 和 titleAfterReply', () => {
  const boxes = (count: number) => Array.from({ length: count }, (_, i) => ({ index: i, text: '', summary: `${'很长的概述'.repeat(20)}${i}` }));

  it('多个框时取第一个框的概述，截到 80 个字；最新一条没有框时往前找', () => {
    const tree = treeOf([
      message('u1', null, 'user', '写'),
      message('a1', 'u1', 'assistant', 'x', { parsed: { prompts: boxes(3) } }),
      message('u2', 'a1', 'user', '问'),
      message('a2', 'u2', 'assistant', '只回答', { parsed: { prompts: [] } }),
    ]);
    const { summary, directionCount } = cardSummary(tree);
    expect(Array.from(summary)).toHaveLength(80);
    expect(summary.startsWith('很长的概述')).toBe(true);
    expect(directionCount).toBe(3);
  });

  it('标题只取第一条成功回复的；手动改过的不动；没有标题时取概述前 12 个字', () => {
    const reply = message('a1', 'u1', 'assistant', 'x', { parsed: { title: '雨中奔跑', prompts: [] } });
    const fresh = { title: '新节点', titleIsManual: false, messages: { a1: reply } };
    expect(titleAfterReply(fresh, reply)).toBe('雨中奔跑');
    expect(titleAfterReply({ ...fresh, titleIsManual: true }, reply)).toBe('新节点');

    const earlier = message('a0', 'u0', 'assistant', '早先的回复');
    expect(titleAfterReply({ ...fresh, messages: { a0: earlier, a1: reply } }, reply)).toBe('新节点');

    const noTitle = message('a1', 'u1', 'assistant', 'x', { parsed: { prompts: [{ index: 0, text: '', summary: '[reference generation] 一个女生在雨中奔跑回头' }] } });
    expect(titleAfterReply({ ...fresh, messages: { a1: noTitle } }, noTitle)).toBe('一个女生在雨中奔跑回头');
  });
});
