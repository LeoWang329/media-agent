import { slotDiff } from './slotDiff';
import type { ChatNode, Message, NodeKind, SharedSettings, TurnLimit } from './types';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type ChatCompletionMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
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

export const TURN_LIMITS = [5, 10, 20, 30, 50];
export const DEFAULT_TURN_LIMIT: TurnLimit = 'all';
export const isTurnLimit = (value: unknown): value is TurnLimit => value === 'all' || TURN_LIMITS.includes(value as number);

// 节点自己设了就按节点的，没设或选了「跟设置」按设置里的
export const effectiveTurnLimit = (node: Pick<ChatNode, 'turnLimit'>, settings: Pick<SharedSettings, 'turnLimit'>): TurnLimit =>
  node.turnLimit === undefined || node.turnLimit === 'follow' ? settings.turnLimit : node.turnLimit;

// 只带最近 limit 轮，见 docs/dev-plan.md 5.4：发的一条 user 消息算一轮，这次发的也算。
// 留下的第一条 user 消息改带它发出时槽位里的全部图和完整说明，编号不乱。kept 是带了几轮，dropped 是前面没带的轮数
export function recentTurns(path: Message[], limit: TurnLimit, kind: NodeKind): { path: Message[]; kept: number; dropped: number } {
  const starts = path.flatMap((message, i) => (message.role === 'user' ? [i] : []));
  const dropped = limit === 'all' ? 0 : starts.length - limit;
  if (dropped <= 0) return { path, kept: starts.length, dropped: 0 };
  const first = path[starts[dropped]];
  const { systemNote, attachments } = slotDiff(null, { slots: first.slotSnapshot, duration: first.duration, aspectRatio: first.aspectRatio }, kind);
  return { path: [{ ...first, systemNote, attachments }, ...path.slice(starts[dropped] + 1)], kept: starts.length - dropped, dropped };
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
    } else if (message.handwritten) {
      // 自己写的框不是模型写的，当成用户说的话发，模型才知道是用户写的
      messages.push({ role: 'user', content: `我自己写了一个框：\n${message.text}` });
    } else if (!message.error && message.text) {
      // 失败的回复跳过；停得太早一个字都没收到的也跳过，空内容有的接口会报错
      messages.push({ role: 'assistant', content: message.text });
    }
  }
  return messages;
}
