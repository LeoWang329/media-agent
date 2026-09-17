import { describe, expect, it } from 'vitest';
import { editedPromptMessage, parseReply, referencedPictures, replacePromptText } from '../src';
import type { Message } from '../src';

const reply = [
  '<title>雨中奔跑</title>',
  '我假设她穿红衣服。',
  '',
  '<prompt label="方向一">',
  'summary:',
  '第一个方向，引用了 <Picture 1>',
  '</prompt>',
  '',
  '<prompt label="方向二">',
  'summary:',
  '第二个方向',
  '</prompt>',
].join('\n');

const message = (extra: Partial<Message> = {}): Message => ({
  id: 'a1',
  parentId: 'u1',
  role: 'assistant',
  createdAt: '2026-09-15T00:00:00.000Z',
  text: reply,
  slotSnapshot: ['img-1', 'img-2'],
  duration: 8,
  aspectRatio: '16:9',
  modelName: 'mock-model',
  systemPromptName: 'default',
  parsed: parseReply(reply),
  ...extra,
});

describe('手动改提示词', () => {
  it('只换那个框里的内容，框外文字、别的框、标签都不动', () => {
    const changed = replacePromptText(reply, 1, 'summary:\n改过的第二个方向');
    expect(changed).toContain('<prompt label="方向二">\nsummary:\n改过的第二个方向\n</prompt>');
    expect(changed).toContain('第一个方向，引用了 <Picture 1>');
    expect(changed).toContain('我假设她穿红衣服。');
  });

  it('标签和正文写在同一行的框也能换，换完开始、结束标签各占一行', () => {
    const inline = ['<prompt label="方向一">summary:', '第一个方向</prompt>', '后面的话'].join('\n');
    expect(replacePromptText(inline, 0, 'summary:\n改过的')).toBe('<prompt label="方向一">\nsummary:\n改过的\n</prompt>\n后面的话');
  });

  it('没有这个框时返回 null；没收尾的框不算一个框', () => {
    expect(replacePromptText(reply, 2, 'x')).toBeNull();
    expect(replacePromptText('<prompt>\n还没写完', 0, 'x')).toBeNull();
  });

  it('生成新版本：正文是换过的全文，重新解析，记下改自哪条，usage 不带过来', () => {
    const original = message({ usage: { promptTokens: 10, completionTokens: 20 }, stars: [0] });
    const edited = editedPromptMessage(original, 0, 'summary:\n改过的第一个方向', 'a2', '2026-09-15T01:00:00.000Z')!;
    expect(edited.id).toBe('a2');
    expect(edited.parentId).toBe('u1');
    expect(edited.editedFromMessageId).toBe('a1');
    expect(edited.parsed?.prompts[0].text).toBe('summary:\n改过的第一个方向');
    expect(edited.parsed?.prompts[1].summary).toBe('第二个方向');
    expect(edited.parsed?.title).toBe('雨中奔跑');
    expect(edited.usage).toBeUndefined();
    expect(edited.stars).toEqual([0]);
    expect(edited.slotSnapshot).toEqual(['img-1', 'img-2']);
  });
});

describe('提示词里引用了哪几张图', () => {
  it('去重、排序、不区分大小写', () => {
    expect(referencedPictures('<Picture 2> 和 <Picture 1>，再提一次 <picture 2>')).toEqual([1, 2]);
    expect(referencedPictures('<Subject 1> 不算')).toEqual([]);
    expect(referencedPictures('只有 3 张却写了 <Picture 5>')).toEqual([5]);
  });
});
