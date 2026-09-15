import type { ChatNode, Message } from './types';

type Tree = Pick<ChatNode, 'messages' | 'rootIds' | 'activeChildOf'>;

export const ROOT_KEY = 'root';

export const parentKey = (parentId: string | null) => parentId ?? ROOT_KEY;

// 当前显示的路径：从 activeChildOf.root 开始一路往下走
export function activePath(tree: Tree): Message[] {
  const path: Message[] = [];
  let parentId: string | null = null;
  for (;;) {
    const id: string | undefined = tree.activeChildOf[parentKey(parentId)];
    const message: Message | undefined = id ? tree.messages[id] : undefined;
    if (!message || message.parentId !== parentId) return path;
    path.push(message);
    parentId = message.id;
  }
}

// 从第一条消息到这条消息（含）
export function ancestorsOf(tree: Tree, messageId: string): Message[] {
  const chain: Message[] = [];
  for (let m: Message | undefined = tree.messages[messageId]; m; m = m.parentId ? tree.messages[m.parentId] : undefined) {
    chain.unshift(m);
  }
  return chain;
}

// 同一位置的各个版本，按创建先后
export function versionsOf(tree: Tree, message: Message): Message[] {
  if (message.parentId === null) return tree.rootIds.map((id) => tree.messages[id]).filter(Boolean);
  return Object.values(tree.messages)
    .filter((m) => m.parentId === message.parentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

// 新消息挂在父消息下，并成为那个位置当前显示的版本
export function addMessage<T extends Tree>(tree: T, message: Message): T {
  return {
    ...tree,
    messages: { ...tree.messages, [message.id]: message },
    rootIds: message.parentId === null && !tree.rootIds.includes(message.id) ? [...tree.rootIds, message.id] : tree.rootIds,
    activeChildOf: { ...tree.activeChildOf, [parentKey(message.parentId)]: message.id },
  };
}

// 切换版本只改这一层，更深层的选择不动，切回来时后面的对话原样恢复
export function switchVersion<T extends Tree>(tree: T, messageId: string): T {
  const message = tree.messages[messageId];
  return { ...tree, activeChildOf: { ...tree.activeChildOf, [parentKey(message.parentId)]: messageId } };
}

// 编辑用户消息：只改文字，槽位快照、时长、比例、附图和说明沿用原来那条
export function editedUserMessage(original: Message, text: string, id: string, createdAt: string): Message {
  return {
    id,
    parentId: original.parentId,
    role: 'user',
    createdAt,
    text,
    slotSnapshot: [...original.slotSnapshot],
    duration: original.duration,
    aspectRatio: original.aspectRatio,
    ...(original.systemNote !== undefined && { systemNote: original.systemNote }),
    ...(original.attachments !== undefined && { attachments: original.attachments.map((a) => ({ ...a })) }),
  };
}
