import type { AspectRatio, ChatNode, Message } from './types';
import { ancestorsOf, ROOT_KEY } from './versionTree';

export type ForkChain = {
  messages: Record<string, Message>;
  rootIds: string[];
  activeChildOf: Record<string, string>;
  slots: string[];
  duration: number;
  aspectRatio: AspectRatio;
  draft: string;
};

// 出的图和视频属于出它的那个节点，复制消息时不带过去，免得两个节点删同一个临时文件、等同一个任务
const withoutImages = ({ images: _, videos: __, ...message }: Message): Message => message;

// 从 assistant 消息 fork：链含这条消息；从 user 消息 fork：链到它的上一条，它的文字放进输入框。
// 只复制链上的消息，id 和 parentId 不变
export function forkChain(source: Pick<ChatNode, 'messages' | 'rootIds' | 'activeChildOf'>, messageId: string, draftPrefix?: string): ForkChain {
  const target = source.messages[messageId];
  if (!target) throw new Error(`message ${messageId} not found`);
  const ancestors = ancestorsOf(source, messageId);
  const chain = target.role === 'assistant' ? ancestors : ancestors.slice(0, -1);
  const snapshotFrom = chain.at(-1) ?? target;

  const activeChildOf: Record<string, string> = {};
  chain.forEach((m, i) => {
    activeChildOf[i === 0 ? ROOT_KEY : chain[i - 1].id] = m.id;
  });

  return {
    messages: Object.fromEntries(chain.map((m) => [m.id, withoutImages(m)])),
    rootIds: chain.length ? [chain[0].id] : [],
    activeChildOf,
    slots: [...snapshotFrom.slotSnapshot],
    duration: snapshotFrom.duration,
    aspectRatio: snapshotFrom.aspectRatio,
    draft: target.role === 'user' ? target.text : (draftPrefix ?? ''),
  };
}

// 「沿第 N 个方向往下改」预填的文字，index 从 0 开始
export function directionDraft(index: number, label?: string): string {
  return `沿第 ${index + 1} 个方向${label ? `（${label}）` : ''}往下改：`;
}

export const forkTitle = (title: string) => `${title} · 分支`;
