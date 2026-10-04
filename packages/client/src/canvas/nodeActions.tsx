import { activePath, type CanvasNodeLayout, type NodeKind, type NodeSummary } from '@media-agent/shared';
import { create } from 'zustand';
import { useCanvasStore } from '../store/canvasStore';
import { confirmBox } from '../ui/confirm';
import type { MenuItem } from '../ui/menu';
import { toast } from '../ui/toast';
import { ensureVisible } from './view';

// 画布卡片和面板顶上共用的节点操作

const store = () => useCanvasStore.getState();
const summaries = () => store().detail?.nodes ?? [];
const summaryOf = (id: string) => summaries().find((n) => n.id === id);

export const childrenOf = (nodes: NodeSummary[], id: string) => nodes.filter((n) => n.parentNodeId === id).sort((a, b) => a.y - b.y);

// 子孙节点，按「子节点、它的子孙、下一个子节点」的顺序
export function descendantsOf(nodes: NodeSummary[], id: string): NodeSummary[] {
  return childrenOf(nodes, id).flatMap((child) => [child, ...descendantsOf(nodes, child.id)]);
}

// 正在改哪个节点的名字，在卡片上改还是在面板顶上改
export const useRenaming = create<{ nodeId: string | null; where: 'card' | 'drawer' | null }>(() => ({ nodeId: null, where: null }));

export const startRename = (nodeId: string, where: 'card' | 'drawer') => useRenaming.setState({ nodeId, where });

export async function finishRename(nodeId: string, next: string | null) {
  useRenaming.setState({ nodeId: null, where: null });
  const title = next?.trim();
  const summary = summaryOf(nodeId);
  if (!title || !summary || title === summary.title) return;
  // 撤销要记下改之前的名字，节点没打开过就先读一下
  if (!store().nodes[nodeId]) await store().loadNode(nodeId).catch(() => undefined);
  if (await store().patchNode(nodeId, { title })) toast('已改名。之后 AI 不会再覆盖这个标题');
}

export function selectNode(nodeId: string) {
  void store().select(nodeId);
  setTimeout(() => {
    const summary = summaryOf(nodeId);
    if (summary) ensureVisible(summary);
  }, 30);
}

export const closeDrawer = () => {
  if (store().selectedId) void store().select(null);
};

export function toggleCollapse(nodeId: string) {
  const summary = summaryOf(nodeId);
  if (!summary) return;
  const layout: CanvasNodeLayout = { id: summary.id, x: summary.x, y: summary.y, collapsed: !summary.collapsed };
  void store().saveLayouts([layout], summary.collapsed ? '展开子节点' : '折叠子节点');
  const selected = store().selectedId;
  if (!summary.collapsed && selected && descendantsOf(summaries(), nodeId).some((n) => n.id === selected)) closeDrawer();
}

export async function deleteNodeFlow(nodeId: string) {
  const node = summaryOf(nodeId);
  if (!node) return;
  const descendants = descendantsOf(summaries(), nodeId);
  const ok = await confirmBox({
    title: `删除「${node.title}」？`,
    body: descendants.length ? (
      <>
        会连同它下面的 <b>{descendants.length} 个子节点</b>一起删掉，一共 {descendants.length + 1} 个节点：
        {[node, ...descendants].map((n) => `「${n.title}」`).join('、')}。<br />
        <br />
        删掉后可以按 Ctrl+Z 撤销。
      </>
    ) : (
      '这个节点没有子节点。删掉后可以按 Ctrl+Z 撤销。'
    ),
    ok: descendants.length ? `删除 ${descendants.length + 1} 个节点` : '删除',
    danger: true,
  });
  if (ok) await store().deleteNode(nodeId);
}

export function cardMenu(nodeId: string): MenuItem[] {
  const summary = summaryOf(nodeId);
  if (!summary) return [];
  const items: MenuItem[] = [
    { label: '打开对话', icon: 'panel', onClick: () => selectNode(nodeId) },
    { label: '重命名', icon: 'edit', onClick: () => startRename(nodeId, 'card') },
  ];
  if (childrenOf(summaries(), nodeId).length) {
    items.push({
      label: summary.collapsed ? '展开子节点' : `折叠子节点（${descendantsOf(summaries(), nodeId).length} 个）`,
      icon: summary.collapsed ? 'expand' : 'collapse',
      onClick: () => toggleCollapse(nodeId),
    });
  }
  items.push({ sep: true }, { label: '删除节点', icon: 'trash', danger: true, onClick: () => void deleteNodeFlow(nodeId) });
  return items;
}

export function drawerMenu(nodeId: string): MenuItem[] {
  const summary = summaryOf(nodeId);
  const node = store().nodes[nodeId];
  if (!summary || !node) return [];
  const last = activePath(node).at(-1);
  const items: MenuItem[] = [{ label: '重命名', icon: 'edit', onClick: () => startRename(nodeId, 'drawer') }];
  if (last) items.push({ label: '从最后一条消息岔出', icon: 'branch', onClick: () => void store().fork(nodeId, last.id) });
  if (childrenOf(summaries(), nodeId).length) {
    items.push({
      label: summary.collapsed ? '展开子节点' : '折叠子节点',
      icon: summary.collapsed ? 'expand' : 'collapse',
      onClick: () => toggleCollapse(nodeId),
    });
  }
  items.push({ sep: true }, { label: '删除节点', icon: 'trash', danger: true, onClick: () => void deleteNodeFlow(nodeId) });
  return items;
}

// 新建的根节点排在最下面那个根节点下方，建好后挪进视野
export async function addRootNode(kind: NodeKind) {
  const roots = summaries().filter((n) => !n.parentNodeId);
  const y = roots.reduce((max, n) => Math.max(max, n.y), 0) + 260;
  const node = await store().createNode(0, y, kind);
  if (node) setTimeout(() => ensureVisible({ x: 0, y }), 60);
}

// 自动排整齐：子节点在父节点右边，兄弟节点上下排，父节点对着子节点的中间
export async function autoLayout() {
  const nodes = summaries();
  if (!nodes.length) return;
  const GAP_X = 344;
  let cursor = 0;
  const placed = new Map<string, CanvasNodeLayout>();
  const heightOf = (id: string) => (document.querySelector<HTMLElement>(`.gnode[data-id="${id}"]`)?.offsetHeight ?? 180) + 40;
  const place = (n: NodeSummary, depth: number) => {
    const x = depth * GAP_X;
    const kids = n.collapsed ? [] : childrenOf(nodes, n.id);
    if (!kids.length) {
      placed.set(n.id, { id: n.id, x, y: cursor, collapsed: n.collapsed });
      cursor += heightOf(n.id);
      return;
    }
    kids.forEach((kid) => place(kid, depth + 1));
    const y = Math.round((placed.get(kids[0].id)!.y + placed.get(kids.at(-1)!.id)!.y) / 2);
    placed.set(n.id, { id: n.id, x, y, collapsed: n.collapsed });
  };
  nodes
    .filter((n) => !n.parentNodeId)
    .sort((a, b) => a.y - b.y)
    .forEach((root) => {
      place(root, 0);
      cursor += 40;
    });
  const layouts = [...placed.values()];
  // 本来就排整齐了，这次没记进撤销，提示条上不给撤销
  const moved = layouts.some((l) => nodes.some((n) => n.id === l.id && (n.x !== l.x || n.y !== l.y)));
  const saving = store().saveLayouts(layouts, '自动排整齐');
  const undo = store().undoOption(); // 这一步刚记进撤销栈
  if (await saving) toast('已排整齐：子节点在父节点右边，兄弟节点上下排', moved ? undo : {});
}
