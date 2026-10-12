import { aspectRatioText, hiddenNodeIds, type NodeSummary } from '@media-agent/shared';
import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { imageThumbUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { useComfyStore } from '../store/comfyStore';
import { Icon } from '../ui/Icon';
import { showMenu, showMenuAt } from '../ui/menu';
import { RenameInput } from '../ui/RenameInput';
import { generatedThumb } from './imageActions';
import { cardMenu, closeDrawer, descendantsOf, finishRename, selectNode, toggleCollapse, useRenaming } from './nodeActions';
import { NODE_W, useView, zoomAt } from './view';

type Point = { x: number; y: number };
type Gesture = {
  pointers: Map<number, Point>;
  pinch: { d: number; z: number } | null;
  pan: { sx: number; sy: number; ox: number; oy: number; moved: boolean } | null;
  drag: { id: string; sx: number; sy: number; ox: number; oy: number; x: number; y: number; moved: boolean } | null;
};

const EDGE_OFFSET = 4000;

// 画布：节点卡片、连线、拖动、平移缩放。照原型 canvas-graph.js 搬的
export function Graph() {
  const detail = useCanvasStore((s) => s.detail);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const streams = useCanvasStore((s) => s.streams);
  const layoutSeq = useCanvasStore((s) => s.layoutSeq);
  const view = useView();
  const viewport = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture>({ pointers: new Map(), pinch: null, pan: null, drag: null });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const elements = useRef(new Map<string, HTMLDivElement>());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  // 撤销、排整齐、折叠改了位置：这一轮渲染带上动画，过一会儿去掉
  const [settledSeq, setSettledSeq] = useState(layoutSeq);
  const animating = layoutSeq !== settledSeq;

  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => setSettledSeq(layoutSeq), 420);
    return () => clearTimeout(timer);
  }, [animating, layoutSeq]);

  const nodes = detail?.nodes ?? [];
  const hidden = hiddenNodeIds(nodes);
  const visible = nodes.filter((n) => !hidden.has(n.id)).map((n) => (drag?.id === n.id ? { ...n, x: drag.x, y: drag.y } : n));
  const byId = new Map(visible.map((n) => [n.id, n]));

  // 卡片高度跟着内容变，连线要对准卡片中间
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    let changed = false;
    for (const [id, el] of elements.current) {
      next[id] = el.offsetHeight;
      if (heights[id] !== next[id]) changed = true;
    }
    if (changed || Object.keys(next).length !== Object.keys(heights).length) setHeights(next);
  });

  // 新出现的卡片（新建、岔出、展开）淡入一下；刚打开画布时的那一批不算
  useLayoutEffect(() => {
    if (!detail) return;
    const ids = new Set(visible.map((n) => n.id));
    if (known.current) {
      const added = [...ids].filter((id) => !known.current!.has(id));
      if (added.length) {
        setFresh((s) => new Set([...s, ...added]));
        setTimeout(() => setFresh((s) => new Set([...s].filter((id) => !added.includes(id)))), 400);
      }
    }
    known.current = ids;
  });

  useEffect(() => {
    const el = viewport.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || (Math.abs(e.deltaY) >= 40 && e.deltaX === 0)) zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
      else {
        const { x, y } = useView.getState();
        useView.setState({ x: x - e.deltaX, y: y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    const g = gesture.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: useView.getState().z };
      g.pan = null;
      g.drag = null;
      setDrag(null);
      return;
    }
    if (e.button !== 0) return;
    const target = e.target as Element;
    const card = target.closest<HTMLElement>('.gnode');
    if (card) {
      if (target.closest('button, input')) return;
      const summary = byId.get(card.dataset.id!);
      if (!summary) return;
      g.drag = { id: summary.id, sx: e.clientX, sy: e.clientY, ox: summary.x, oy: summary.y, x: summary.x, y: summary.y, moved: false };
      card.setPointerCapture(e.pointerId);
      return;
    }
    const { x, y } = useView.getState();
    g.pan = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false };
    viewport.current!.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (g.pointers.has(e.pointerId)) g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pinch && g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((g.pinch.z * d) / g.pinch.d / useView.getState().z, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (g.drag) {
      const { z } = useView.getState();
      const dx = (e.clientX - g.drag.sx) / z;
      const dy = (e.clientY - g.drag.sy) / z;
      if (!g.drag.moved && Math.hypot(dx, dy) < 4) return;
      g.drag.moved = true;
      g.drag.x = Math.round(g.drag.ox + dx);
      g.drag.y = Math.round(g.drag.oy + dy);
      setDrag({ id: g.drag.id, x: g.drag.x, y: g.drag.y });
    } else if (g.pan) {
      const mx = e.clientX - g.pan.sx;
      const my = e.clientY - g.pan.sy;
      if (!g.pan.moved && Math.hypot(mx, my) < 3) return;
      g.pan.moved = true;
      setPanning(true);
      useView.setState({ x: g.pan.ox + mx, y: g.pan.oy + my });
    }
  };

  const endPointer = (e: ReactPointerEvent) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size < 2) g.pinch = null;
    if (g.drag) {
      const { id, moved, x, y } = g.drag;
      g.drag = null;
      const summary = nodes.find((n) => n.id === id);
      if (moved && summary) {
        void useCanvasStore.getState().saveLayouts([{ id, x, y, collapsed: summary.collapsed }], '移动节点');
      } else if (!moved && e.type === 'pointerup') {
        selectNode(id);
      }
      setDrag(null);
    }
    if (g.pan) {
      setPanning(false);
      if (!g.pan.moved && e.type === 'pointerup' && innerWidth > 720) closeDrawer();
      g.pan = null;
    }
  };

  const edges = visible.flatMap((n) => {
    const parent = n.parentNodeId ? byId.get(n.parentNodeId) : undefined;
    if (!parent) return [];
    const x1 = parent.x + NODE_W + EDGE_OFFSET;
    const y1 = parent.y + (heights[parent.id] ?? 170) / 2 + EDGE_OFFSET;
    const x2 = n.x + EDGE_OFFSET;
    const y2 = n.y + (heights[n.id] ?? 170) / 2 + EDGE_OFFSET;
    const dx = Math.max(40, (x2 - x1) / 2);
    const active = selectedId === n.id || selectedId === parent.id;
    return [<path key={n.id} className={active ? 'is-active' : ''} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} />];
  });

  return (
    <main
      ref={viewport}
      className={`ws-viewport${panning ? ' is-panning' : ''}`}
      id="viewport"
      data-od-id="canvas-viewport"
      aria-label="节点画布"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div
        className={`ws-world${animating ? ' is-animating' : ''}`}
        id="world"
        style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.z})`, transition: view.animating ? 'transform .35s var(--ease)' : undefined }}
      >
        <svg className="ws-edges" id="edges" aria-hidden="true">
          {edges}
        </svg>
        <div id="nodes">
          {visible.map((n) => (
            <GraphNode
              key={n.id}
              summary={n}
              canvasId={detail!.canvas.id}
              selected={selectedId === n.id}
              dragging={drag?.id === n.id}
              fresh={fresh.has(n.id)}
              generating={n.generating || Boolean(streams[n.id])}
              hiddenCount={n.collapsed ? descendantsOf(nodes, n.id).length : 0}
              register={(el) => (el ? elements.current.set(n.id, el) : elements.current.delete(n.id))}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

type NodeProps = {
  summary: NodeSummary;
  canvasId: string;
  selected: boolean;
  dragging: boolean;
  fresh: boolean;
  generating: boolean;
  hiddenCount: number;
  register: (el: HTMLDivElement | null) => void;
};

const GraphNode = memo(
  function GraphNode({ summary: n, canvasId, selected, dragging, fresh, generating, hiddenCount, register }: NodeProps) {
    const renaming = useRenaming((s) => s.nodeId === n.id && s.where === 'card');
    const autodlBooting = useComfyStore((s) => s.autodl?.state === 'booting');
    const shown = n.slots.slice(0, 5);
    return (
      <div
        ref={register}
        className={`gnode${n.image ? ' is-image' : ''}${n.kind === 'edit' ? ' is-edit' : ''}${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${fresh ? ' is-new' : ''}`}
        data-id={n.id}
        data-od-id={`graph-node-${n.id}`}
        data-testid="node-card"
        tabIndex={0}
        style={{ transform: `translate(${n.x}px,${n.y}px)` }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) selectNode(n.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          showMenuAt(e.clientX, e.clientY, cardMenu(n.id));
        }}
      >
        <div className="gn-top">
          {renaming ? (
            <RenameInput value={n.title} className="ws-rename" maxLength={24} onDone={(next) => void finishRename(n.id, next)} />
          ) : (
            <div className="gn-title">{n.title}</div>
          )}
          {n.starred && (
            <span className="gn-star" title="有打星的版本">
              <Icon name="star" className="icon-fill" />
            </span>
          )}
          <button type="button" className="btn btn-ghost btn-icon btn-sm gn-menu" aria-label="节点操作" onClick={(e) => showMenu(e.currentTarget, cardMenu(n.id))}>
            <Icon name="more" />
          </button>
        </div>
        <div className="gn-sum">{n.summary || '还没有提示词'}</div>
        <div className={`gn-slots${n.generated?.images.length ? ' is-gen' : ''}`}>
          {n.generated?.images.length ? (
            // 出过图的：缩略图换成最近出的图
            n.generated.images.map((ref) => <GeneratedSlot key={`${ref.jobId}:${ref.index}:${ref.seed}`} src={generatedThumb(canvasId, n.id, ref)} starred={ref.starred} />)
          ) : n.slots.length ? (
            <>
              {shown.map((id, i) => (
                <div key={`${i}-${id}`} className="gn-slot">
                  <img className="im" src={imageThumbUrl(canvasId, id)} alt="" loading="lazy" draggable={false} />
                  <span className="num-badge">{i + 1}</span>
                </div>
              ))}
              {n.slots.length > 5 && <div className="gn-slot gn-slot-more">+{n.slots.length - 5}</div>}
            </>
          ) : (
            <span className="gn-noimg">没有参考图</span>
          )}
        </div>
        <div className="gn-foot">
          {n.kind === 'edit' ? (
            <span className="tag tag-outline gn-kind">
              <Icon name="wand" />
              编辑
            </span>
          ) : n.image ? (
            <span className="tag tag-outline gn-kind">
              <Icon name="sparkles" />
              生图{n.image.family ? ` · ${n.image.family}` : ''}
            </span>
          ) : (
            <span className="tag tag-outline gn-kind">
              <Icon name="film" />
              视频
            </span>
          )}
          {n.generated?.live ? (
            <span className="tag tag-accent">
              <span className="dot dot-live" />
              {n.generated.live.boot && autodlBooting ? '等开机' : `出图 ${n.generated.live.done}/${n.generated.live.total}`}
            </span>
          ) : (
            n.generated?.failed && (
              <span className="tag tag-danger">
                <Icon name="warn" />
                出图失败
              </span>
            )
          )}
          {generating && (
            <span className="tag tag-accent">
              <span className="dot dot-live" />
              生成中
            </span>
          )}
          {n.failed && !generating && (
            <span className="tag tag-danger">
              <Icon name="warn" />
              请求失败
            </span>
          )}
          {n.directionCount > 0 && <span className="tag">{n.directionCount} 个方向</span>}
          <span className="grow" />
          <span className="meta">
            {n.kind === 'edit'
              // 编辑节点不吃时长和比例，看的是放进来几张图
              ? `${n.slots.length} 张图`
              : n.image
                ? `${n.image.width}×${n.image.height}${n.image.family ? ` · ${n.image.family}` : ''}`
                : `${n.duration}秒 · ${aspectRatioText(n.aspectRatio)}`}
          </span>
        </div>
        {hiddenCount > 0 && (
          <button type="button" className="gn-collapsed" title="展开" onClick={() => toggleCollapse(n.id)}>
            <Icon name="chev-right" className="icon-sm" />
            收起了 {hiddenCount} 个节点
          </button>
        )}
      </div>
    );
  },
  (a, b) =>
    a.summary === b.summary &&
    a.canvasId === b.canvasId &&
    a.selected === b.selected &&
    a.dragging === b.dragging &&
    a.fresh === b.fresh &&
    a.generating === b.generating &&
    a.hiddenCount === b.hiddenCount,
);

// 卡片上出的一张图；临时文件清掉了、也没下载过的显示斜线底
function GeneratedSlot({ src, starred }: { src: string; starred: boolean }) {
  const [gone, setGone] = useState(false);
  return (
    <div className={`gn-slot gn-gen${gone ? ' is-cleared' : ''}`}>
      {!gone && <img className="im" src={src} alt="" loading="lazy" draggable={false} onError={() => setGone(true)} />}
      {starred && (
        <span className="gn-gstar">
          <Icon name="star" className="icon-fill" />
        </span>
      )}
    </div>
  );
}
