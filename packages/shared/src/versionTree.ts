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
    ...(original.mediaSnapshot !== undefined && { mediaSnapshot: original.mediaSnapshot.map((m) => ({ ...m })) }),
    duration: original.duration,
    aspectRatio: original.aspectRatio,
    ...(original.systemNote !== undefined && { systemNote: original.systemNote }),
    ...(original.attachments !== undefined && { attachments: original.attachments.map((a) => ({ ...a })) }),
    ...(original.frames !== undefined && { frames: original.frames.map((f) => ({ ...f })) }),
  };
}

// 自己写的框：不调模型，接在 parentId 后面的一条回复，里面只有这一个框。槽位、时长、比例照节点现在的；
// 记下节点现在用的系统提示词，之后编辑这个框时按它的系列查标签
export function handwrittenMessage(
  node: Pick<ChatNode, 'slots' | 'media' | 'duration' | 'aspectRatio' | 'systemPromptName'>,
  parentId: string | null,
  promptText: string,
  id: string,
  createdAt: string,
): Message {
  const text = ['<prompt>', ...promptText.split(/\r?\n/), '</prompt>'].join('\n');
  return {
    id,
    parentId,
    role: 'assistant',
    createdAt,
    text,
    slotSnapshot: [...node.slots],
    ...(node.media?.length && { mediaSnapshot: node.media.map((m) => ({ ...m })) }),
    duration: node.duration,
    aspectRatio: node.aspectRatio,
    systemPromptName: node.systemPromptName,
    parsed: { prompts: parseReply(text).prompts },
    handwritten: true,
  };
}

// 手动改提示词：同一个父消息下新建一条 assistant 版本，正文是把那个框换掉之后的全文，不调模型。
// usage、思考原文和思考时间不带过来，这一版没调模型；出的图和视频是照原来的框出的，也不带；改的那个框的译文对不上了，也不带；
// 框里的星、别的框的译文、当时用的模型和提示词版本照旧
export function editedPromptMessage(original: Message, promptIndex: number, promptText: string, id: string, createdAt: string): Message | null {
  const text = replacePromptText(original.text, promptIndex, promptText);
  if (text === null) return null;
  const { title, prompts } = parseReply(text);
  const edited: Message = { ...original, id, createdAt, text, parsed: { ...(title !== undefined && { title }), prompts }, editedFromMessageId: original.id };
  delete edited.usage;
  delete edited.reasoning;
  delete edited.thinkingMs;
  delete edited.images;
  delete edited.videos;
  const translations = original.translations?.filter((t) => t.promptIndex !== promptIndex);
  if (translations?.length) edited.translations = translations;
  else delete edited.translations;
  return edited;
}
