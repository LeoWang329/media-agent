import type { Message } from './types';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type ChatCompletionMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: ContentPart[] }
  | { role: 'assistant'; content: string };

// 系统提示词和固定格式要求之间空两行
export function systemMessageText(systemPrompt: string, formatRequirement: string): string {
  return `${systemPrompt.trimEnd()}\n\n\n${formatRequirement.trim()}`;
}

// path 是从第一条消息到本次要回复的那条 user 消息
export function composeMessages(path: Message[], systemPrompt: string, formatRequirement: string): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = [{ role: 'system', content: systemMessageText(systemPrompt, formatRequirement) }];
  for (const message of path) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: [{ type: 'text', text: message.text }] });
    } else if (!message.error && message.text) {
      // 失败的回复跳过；停得太早一个字都没收到的也跳过，空内容有的接口会报错
      messages.push({ role: 'assistant', content: message.text });
    }
  }
  return messages;
}
