import { parseReply, replacePromptText } from './parse';
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

// 手动改提示词：同一个父消息下新建一条 assistant 版本，正文是把那个框换掉之后的全文，不调模型。
// usage 不带过来，这一版没花 token；框里的星、当时用的模型和提示词版本照旧
export function editedPromptMessage(original: Message, promptIndex: number, promptText: string, id: string, createdAt: string): Message | null {
  const text = replacePromptText(original.text, promptIndex, promptText);
  if (text === null) return null;
  const { title, prompts } = parseReply(text);
  const edited: Message = { ...original, id, createdAt, text, parsed: { ...(title !== undefined && { title }), prompts }, editedFromMessageId: original.id };
  delete edited.usage;
  return edited;
}
