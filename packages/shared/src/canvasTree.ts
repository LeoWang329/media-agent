type TreeNode = { id: string; parentNodeId: string | null; collapsed?: boolean };

// 某个节点下面所有的子孙节点
export function descendantIds(nodes: TreeNode[], rootId: string): string[] {
  const result: string[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const node of nodes) {
      if (node.parentNodeId === id) {
        result.push(node.id);
        queue.push(node.id);
      }
    }
  }
  return result;
}

// 被折叠的节点收起来的全部子孙
export function hiddenNodeIds(nodes: TreeNode[]): Set<string> {
  const hidden = new Set<string>();
  for (const node of nodes) {
    if (node.collapsed) descendantIds(nodes, node.id).forEach((id) => hidden.add(id));
  }
  return hidden;
}
