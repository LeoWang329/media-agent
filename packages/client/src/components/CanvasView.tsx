import { Graph, layout } from '@dagrejs/dagre';
import { descendantIds, hiddenNodeIds } from '@media-agent/shared';
import { applyNodeChanges, Background, Panel, ReactFlow, useReactFlow, type Edge, type NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { NodeCard, type CardNode } from './NodeCard';

const nodeTypes = { card: NodeCard };
const CARD_WIDTH = 260;
const CARD_HEIGHT = 140; // 还没量到实际高度时用
// 缩放归位时最多放大到原始大小，只有一两个节点时卡片不会被放得很大
const FIT_VIEW = { maxZoom: 1, duration: 300 };

export function CanvasView() {
  const detail = useCanvasStore((s) => s.detail);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const { select, createNode, saveLayouts, deleteNode, forkFromLast, setRenaming } = useCanvasStore.getState();
  const { fitView, getNodes, screenToFlowPosition } = useReactFlow<CardNode>();
  const wrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<CardNode[]>([]);
  const [menu, setMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!detail) return;
    const hidden = hiddenNodeIds(detail.nodes);
    setNodes((previous) =>
      detail.nodes
        .filter((n) => !hidden.has(n.id))
        .map((n) => ({
          id: n.id,
          type: 'card',
          position: { x: n.x, y: n.y },
          selected: n.id === selectedId,
          measured: previous.find((p) => p.id === n.id)?.measured,
          data: { summary: n, hiddenCount: n.collapsed ? descendantIds(detail.nodes, n.id).length : 0 },
        })),
    );
  }, [detail, selectedId]);

  const edges = useMemo<Edge[]>(() => {
    const visible = new Set(nodes.map((n) => n.id));
    return (detail?.nodes ?? [])
      .filter((n) => n.parentNodeId && visible.has(n.id) && visible.has(n.parentNodeId))
      .map((n) => ({ id: `${n.parentNodeId}-${n.id}`, source: n.parentNodeId!, target: n.id }));
  }, [detail, nodes]);

  const layoutOf = (node: CardNode) => ({ id: node.id, x: node.position.x, y: node.position.y, collapsed: node.data.summary.collapsed });

  // 新节点放在画布可见区域中间，和已有卡片重叠就往下挪
  const addNode = () => {
    const rect = wrapper.current!.getBoundingClientRect();
    const center = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const spot = { x: center.x - CARD_WIDTH / 2, y: center.y - CARD_HEIGHT / 2 };
    const overlaps = () =>
      getNodes().some((n) => {
        const width = n.measured?.width ?? CARD_WIDTH;
        const height = n.measured?.height ?? CARD_HEIGHT;
        return spot.x < n.position.x + width + 20 && n.position.x < spot.x + CARD_WIDTH + 20 && spot.y < n.position.y + height + 20 && n.position.y < spot.y + CARD_HEIGHT + 20;
      });
    for (let i = 0; i < 50 && overlaps(); i += 1) spot.y += 60;
    void createNode(Math.round(spot.x), Math.round(spot.y));
  };

  // 自动排整齐：子节点排在父节点右边，兄弟节点从上到下
  const arrange = async () => {
    const graph = new Graph();
    graph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 });
    graph.setDefaultEdgeLabel(() => ({}));
    const visible = getNodes();
    for (const n of visible) graph.setNode(n.id, { width: n.measured?.width ?? CARD_WIDTH, height: n.measured?.height ?? CARD_HEIGHT });
    for (const e of edges) graph.setEdge(e.source, e.target);
    layout(graph);
    const layouts = visible.map((n) => {
      const { x, y, width, height } = graph.node(n.id);
      return { ...layoutOf(n), x: Math.round(x - width / 2), y: Math.round(y - height / 2) };
    });
    await saveLayouts(layouts);
    requestAnimationFrame(() => void fitView(FIT_VIEW));
  };

  const menuItems = (nodeId: string): MenuItem[] => {
    const all = detail?.nodes ?? [];
    const node = all.find((n) => n.id === nodeId)!;
    const children = descendantIds(all, nodeId);
    const items: MenuItem[] = [{ label: 'fork 到新节点', onSelect: () => void forkFromLast(nodeId) }];
    if (children.length) {
      items.push({
        label: node.collapsed ? '展开' : '折叠',
        onSelect: () => void saveLayouts([{ id: node.id, x: node.x, y: node.y, collapsed: !node.collapsed }]),
      });
    }
    items.push({ label: '重命名', onSelect: () => setRenaming(nodeId) });
    items.push({
      label: '删除',
      onSelect: () => {
        const message = `删除「${node.title}」？${children.length ? `连同 ${children.length} 个子节点一起删除。` : ''}删除的内容会移到工作文件夹的 .trash 里。`;
        if (window.confirm(message)) void deleteNode(nodeId);
      },
    });
    return items;
  };

  return (
    <div className="canvas-view" ref={wrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes: NodeChange<CardNode>[]) => setNodes((current) => applyNodeChanges(changes, current))}
        onNodeClick={(_e, node) => void select(node.id)}
        onNodeDragStop={(_e, _node, dragged) => void saveLayouts(dragged.map(layoutOf))}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          setMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
        }}
        nodesConnectable={false}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
      >
        <Background gap={24} />
        <Panel position="top-left" className="canvas-toolbar">
          <button type="button" onClick={addNode}>新建节点</button>
          <button type="button" onClick={() => void arrange()}>自动排整齐</button>
          <button type="button" onClick={() => void fitView(FIT_VIEW)}>缩放归位</button>
        </Panel>
      </ReactFlow>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.nodeId)} onClose={closeMenu} />}
    </div>
  );
}
