import type { ChatCompletionMessage } from './compose';
import type { Message, PromptTranslation, TranslateLanguage } from './types';

export const TRANSLATE_LANGUAGES: TranslateLanguage[] = ['英文', '中文', '日文', '韩文'];

// 用户写了翻译要求时，接在翻译说明最后的那段话
export const TRANSLATE_REQUIREMENT_LEAD = '用户对这次翻译的要求（和上面冲突时以这里为准）：';

// 翻译一个提示词框只问一次：系统消息是翻译说明（{语言} 换成选中的语言，写了要求接在最后），用户消息是提示词原文
export function translateMessages(instructions: string, language: TranslateLanguage, requirement: string, promptText: string): ChatCompletionMessage[] {
  const extra = requirement.trim() ? `\n\n${TRANSLATE_REQUIREMENT_LEAD}\n${requirement.trim()}` : '';
  return [
    { role: 'system', content: instructions.replaceAll('{语言}', language) + extra },
    { role: 'user', content: promptText },
  ];
}

// 存进一份译文：同一个框同一种语言的旧译文换掉
export function withTranslation(message: Message, translation: PromptTranslation): Message {
  const others = (message.translations ?? []).filter((t) => t.promptIndex !== translation.promptIndex || t.language !== translation.language);
  return { ...message, translations: [...others, translation] };
}
