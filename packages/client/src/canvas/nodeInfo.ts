import { activePath, formatCost, messageCost, type ChatNode, type Message, type ModelConfigWithKey } from '@media-agent/shared';

// 岔出来的节点里，从原节点复制来的那几条：当前路径开头那几条。
// 岔出时记下了条数就用它；之前岔出的节点没记，按「比节点建得早」算
export function copiedCount(node: ChatNode, path: Message[]): number {
  if (!node.parentNodeId) return 0;
  if (node.copiedCount !== undefined) return Math.min(node.copiedCount, path.length);
  let count = 0;
  while (count < path.length && path[count].createdAt <= node.createdAt) count += 1;
  return count;
}

// 从原节点第几条消息岔出：从回复岔出时就是复制来的最后一条；从需求岔出时是那句需求本身（没复制过来，放进了输入框）
export const forkedAt = (node: ChatNode, copied: number) =>
  node.forkedFromMessageId && node.messages[node.forkedFromMessageId] ? copied : copied + 1;

// 下一次回复写完会不会给节点起标题：没手动改过名，也还没有过写成功的回复
export const isUntitled = (node: ChatNode) =>
  !node.titleIsManual && !Object.values(node.messages).some((m) => m.role === 'assistant' && !m.error && m.text);

// 节点自己花的钱（不算复制来的），所有版本都算，翻译提示词框花的也算；一分钱都没算出来时返回 null
export function nodeCost(node: ChatNode, configs: ModelConfigWithKey[]): string | null {
  const path = activePath(node);
  const copied = new Set(path.slice(0, copiedCount(node, path)).map((m) => m.id));
  const spent: { usage: NonNullable<Message['usage']>; modelConfigId?: string }[] = [];
  for (const message of Object.values(node.messages)) {
    if (message.role !== 'assistant') continue;
    const fromParent = copied.has(message.id);
    if (!fromParent && message.usage && !message.error) spent.push({ usage: message.usage, modelConfigId: message.modelConfigId });
    // 复制来的回复上，岔出以后才翻的算这个节点的
    for (const t of message.translations ?? []) {
      if (t.usage && (!fromParent || t.createdAt > node.createdAt)) spent.push({ usage: t.usage, modelConfigId: t.modelConfigId });
    }
  }
  let total = 0;
  let currency = '';
  for (const { usage, modelConfigId } of spent) {
    const pricing = configs.find((c) => c.id === modelConfigId)?.pricing;
    const cost = pricing ? messageCost(usage, pricing) : null;
    if (cost === null) continue;
    total += cost;
    currency ||= pricing!.currency;
  }
  return total > 0 ? formatCost(total, currency) : null;
}

// 服务端记下的错误是「HTTP 500：原因」这种，拆成编号和原因分开显示
export function splitError(error: string): { code: string; reason: string } {
  const match = error.match(/^HTTP (\d+)[：:]\s*([\s\S]*)$/);
  return match ? { code: match[1], reason: match[2] } : { code: '', reason: error };
}
