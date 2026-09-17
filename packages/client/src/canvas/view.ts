import { create } from 'zustand';

// 画布的平移缩放，照原型 canvas-graph.js 的算法
export const NODE_W = 264;

type View = { x: number; y: number; z: number; animating: boolean };

export const useView = create<View>(() => ({ x: 80, y: 180, z: 1, animating: false }));

type Box = { x: number; y: number; collapsed: boolean };

// 面板开着、屏幕又够宽时，画布只剩面板左边那一块
export function usableWidth(): number {
  if (!document.body.classList.contains('drawer-open') || innerWidth <= 1180) return innerWidth;
  return innerWidth - (document.getElementById('drawer')?.offsetWidth ?? 0);
}

let animationSeq = 0;
function animateTo(next: Pick<View, 'x' | 'y' | 'z'>) {
  const seq = ++animationSeq;
  useView.setState({ ...next, animating: true });
  setTimeout(() => seq === animationSeq && useView.setState({ animating: false }), 380);
}

export function zoomAt(factor: number, cx: number, cy: number) {
  const view = useView.getState();
  const z = Math.min(2, Math.max(0.3, view.z * factor));
  const k = z / view.z;
  useView.setState({ x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, z });
}

export const zoomBy = (factor: number) => zoomAt(factor, usableWidth() / 2, innerHeight / 2);

// minZ：打开页面时不缩到字看不清
export function fitAll(nodes: Box[], minZ = 0.3) {
  if (!nodes.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W + (n.collapsed ? 150 : 0));
    maxY = Math.max(maxY, n.y + 190);
  }
  const w = usableWidth() - 80;
  const h = innerHeight - 150;
  const z = Math.min(1.1, Math.max(minZ, Math.min(w / (maxX - minX), h / (maxY - minY))));
  // 放得下就居中；放不下就从左上角开始排，保证根节点在视野里
  animateTo({
    z,
    x: 40 + Math.max(0, (w - (maxX - minX) * z) / 2) - minX * z,
    y: 80 + Math.max(0, (h - (maxY - minY) * z) / 2) - minY * z,
  });
}

// 节点跑到屏幕外、或者被面板挡住时挪一挪
export function ensureVisible(n: { x: number; y: number }) {
  if (innerWidth <= 720) return;
  const view = useView.getState();
  let { x, y } = view;
  const sx = n.x * view.z + x;
  const sy = n.y * view.z + y;
  const w = NODE_W * view.z;
  const right = usableWidth();
  let moved = false;
  if (sx + w > right - 24) {
    x -= sx + w - (right - 48);
    moved = true;
  }
  if (sx < 24) {
    x += 48 - sx;
    moved = true;
  }
  if (sy < 70) {
    y += 90 - sy;
    moved = true;
  }
  if (sy + 180 * view.z > innerHeight - 60) {
    y -= sy + 180 * view.z - (innerHeight - 80);
    moved = true;
  }
  if (moved) animateTo({ x, y, z: view.z });
}
