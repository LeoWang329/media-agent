import type { ChatNode, Message, PromptBox } from './types';
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

// 岔出来的节点里，复制来的消息比节点建得早，自己发的比节点建得晚
export const isOwnMessage = (node: Pick<ChatNode, 'parentNodeId' | 'createdAt'>, message: Pick<Message, 'createdAt'>) =>
  !node.parentNodeId || message.createdAt > node.createdAt;

export type StarredBox = { node: ChatNode; message: Message; promptIndex: number; box: PromptBox };

// 一张画布上打过星的框。岔出去的节点连星一起复制了回复，复制来的星不算它的：同一个框只算一次，
// 算在写出这条回复的节点上（那个节点不在了才算在先读到的那份复制品上）。画布卡片和首页都按这个显示星
export function starredBoxes(nodes: ChatNode[]): StarredBox[] {
  const found = new Map<string, StarredBox & { own: boolean }>();
  for (const node of nodes) {
    for (const message of Object.values(node.messages)) {
      if (message.role !== 'assistant') continue;
      const own = isOwnMessage(node, message);
      for (const promptIndex of message.stars ?? []) {
        const box = message.parsed?.prompts[promptIndex];
        const seen = found.get(`${message.id}/${promptIndex}`);
        if (!box || (seen && (seen.own || !own))) continue;
        found.set(`${message.id}/${promptIndex}`, { node, message, promptIndex, box, own });
      }
    }
  }
  return [...found.values()].map(({ own: _, ...starred }) => starred);
}
