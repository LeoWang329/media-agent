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

// user 消息的 content：说明、每张图前面标一行 <Picture N>、用户输入
export function userContent(message: Message, imageUrl: (imageId: string) => string): ContentPart[] {
  return [
    ...(message.systemNote ? [{ type: 'text' as const, text: message.systemNote }] : []),
    ...(message.attachments ?? []).flatMap((a): ContentPart[] => [
      { type: 'text', text: `<Picture ${a.picture}>` },
      { type: 'image_url', image_url: { url: imageUrl(a.imageId) } },
    ]),
    { type: 'text', text: message.text },
  ];
}

// path 是从第一条消息到本次要回复的那条 user 消息；imageUrl 把 imageId 换成发给模型的图片地址
export function composeMessages(
  path: Message[],
  systemPrompt: string,
  formatRequirement: string,
  imageUrl: (imageId: string) => string,
): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = [{ role: 'system', content: systemMessageText(systemPrompt, formatRequirement) }];
  for (const message of path) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: userContent(message, imageUrl) });
    } else if (!message.error && message.text) {
      // 失败的回复跳过；停得太早一个字都没收到的也跳过，空内容有的接口会报错
      messages.push({ role: 'assistant', content: message.text });
    }
  }
  return messages;
}
