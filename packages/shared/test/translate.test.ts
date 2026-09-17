import { describe, expect, it } from 'vitest';
import { editedPromptMessage, translateMessages, withTranslation } from '../src';
import type { Message, PromptTranslation } from '../src';

const translation = (promptIndex: number, language: PromptTranslation['language'], text: string): PromptTranslation => ({
  promptIndex,
  language,
  instruction: '',
  text,
  createdAt: '2026-09-17T00:00:00.000Z',
  modelConfigId: 'mock',
  modelName: 'mock-model',
});

const reply: Message = {
  id: 'a1',
  parentId: 'u1',
  role: 'assistant',
  createdAt: '2026-09-17T00:00:00.000Z',
  text: ['<prompt label="方向一">', 'summary:', '一', '</prompt>', '<prompt label="方向二">', 'summary:', '二', '</prompt>'].join('\n'),
  slotSnapshot: [],
  duration: 8,
  aspectRatio: '16:9',
};

describe('翻译提示词框', () => {
  it('系统消息换进语言，写了要求才接在最后；用户消息只有提示词原文', () => {
    const [system, user] = translateMessages('翻译成{语言}。{语言}以外不要。', '日文', '  台词也翻译 ', 'summary:\n一');
    expect(system).toEqual({ role: 'system', content: '翻译成日文。日文以外不要。\n\n用户对这次翻译的要求（和上面冲突时以这里为准）：\n台词也翻译' });
    expect(user).toEqual({ role: 'user', content: 'summary:\n一' });
    expect(translateMessages('翻译成{语言}。', '英文', '  ', 'x')[0].content).toBe('翻译成英文。');
  });

  it('同一个框同一种语言只留最新一份，别的框、别的语言不动', () => {
    let message = withTranslation(reply, translation(0, '英文', 'old'));
    message = withTranslation(message, translation(1, '英文', 'box 2'));
    message = withTranslation(message, translation(0, '日文', 'ja'));
    message = withTranslation(message, translation(0, '英文', 'new'));
    expect(message.translations!.map((t) => [t.promptIndex, t.language, t.text])).toEqual([
      [1, '英文', 'box 2'],
      [0, '日文', 'ja'],
      [0, '英文', 'new'],
    ]);
  });

  it('手动改了哪个框，那个框的译文不带到新版本，别的框的照旧', () => {
    const translated = withTranslation(withTranslation(reply, translation(0, '英文', 'one')), translation(1, '英文', 'two'));
    expect(editedPromptMessage(translated, 0, 'summary:\n改过', 'a2', '2026-09-17T01:00:00.000Z')!.translations).toEqual([translation(1, '英文', 'two')]);
    expect(editedPromptMessage(withTranslation(reply, translation(0, '英文', 'one')), 0, 'x', 'a3', '2026-09-17T01:00:00.000Z')).not.toHaveProperty('translations');
  });
});
