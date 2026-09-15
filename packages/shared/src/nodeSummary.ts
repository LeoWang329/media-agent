import type { ChatNode, Message } from './types';
import { activePath } from './versionTree';

export const CARD_SUMMARY_LENGTH = 80;

const firstChars = (text: string, count: number) => Array.from(text).slice(0, count).join('');

// 卡片上的概述：当前路径上最新一条带提示词框的回复，取第一个框的概述
export function cardSummary(node: Pick<ChatNode, 'messages' | 'rootIds' | 'activeChildOf'>): { summary: string; directionCount: number } {
  const latest = activePath(node)
    .reverse()
    .find((m) => m.role === 'assistant' && m.parsed?.prompts.length);
  if (!latest?.parsed) return { summary: '', directionCount: 0 };
  return { summary: firstChars(latest.parsed.prompts[0].summary, CARD_SUMMARY_LENGTH), directionCount: latest.parsed.prompts.length };
}

// 节点标题取这个节点第一条成功回复里的 <title>；没有标题取概述前 12 个字（去掉开头的 [任务类型]）；再没有就不变
export function titleAfterReply(node: Pick<ChatNode, 'title' | 'titleIsManual' | 'messages'>, reply: Message): string {
  if (node.titleIsManual || reply.error) return node.title;
  const hasEarlierReply = Object.values(node.messages).some((m) => m.role === 'assistant' && m.id !== reply.id && !m.error && m.text);
  if (hasEarlierReply) return node.title;
  const summary = reply.parsed?.prompts[0]?.summary.replace(/^\[[^\]]*\]\s*/, '') ?? '';
  return reply.parsed?.title || firstChars(summary, 12) || node.title;
}

export const isStarred = (node: Pick<ChatNode, 'messages'>) => Object.values(node.messages).some((m) => m.stars?.length);
