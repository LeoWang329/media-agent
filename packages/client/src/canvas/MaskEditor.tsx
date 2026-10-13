import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toast } from '../ui/toast';
import { Icon } from '../ui/Icon';
import { inpaint, type ImageAt } from './imageActions';
// 局部重绘的掩码编辑器：拖框 + 涂抹两个工具，能擦、能清空、能撤销、能叠加，见 docs/dev-plan.md 5.38。
// 画布按**原图像素**尺寸建，显示时缩到框里，导出的就是原图尺寸的 PNG，坐标不用换算两次。
// 导出那张 PNG 里「要重画的地方」alpha=0、别处 255 —— 底图和掩码是同一张，ComfyUI 那边 LoadImage 的第二个输出就是它的 alpha 通道。

export type MaskPoint = { x: number; y: number };
// eraser 是擦（把已经画上的去掉），size 是笔刷粗细，按原图像素算
export type MaskStroke = { eraser: boolean; size: number; points: MaskPoint[] };
export type MaskRect = { x: number; y: number; width: number; height: number };
// rect 是拖出来的框（同一时刻只有一个，能拖能拉角），strokes 是涂抹和擦的笔迹，按先后叠在框上面
export type MaskShapes = { rect: MaskRect | null; strokes: MaskStroke[] };

export const EMPTY_MASK: MaskShapes = { rect: null, strokes: [] };
export const maskIsEmpty = (mask: MaskShapes) => !mask.rect && mask.strokes.length === 0;

const MASK_FILL = 'rgba(255, 74, 74, .42)';
const MASK_EDGE = 'rgba(255, 255, 255, .95)';
const MASK_SOLID = '#ffffff';

// 把形状画到画布上（先清空）：白 = 要重画。框先画，笔迹按先后盖上去，擦的用 destination-out 挖掉。
// 框再描一圈白边、笔迹描一圈深边，压在什么颜色的图上都看得见
function paintShapes(ctx: CanvasRenderingContext2D, shapes: MaskShapes, color: string, edge?: string) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const thin = Math.max(1.5, Math.min(ctx.canvas.width, ctx.canvas.height) / 500);
  if (shapes.rect) {
    ctx.fillStyle = color;
    ctx.fillRect(shapes.rect.x, shapes.rect.y, shapes.rect.width, shapes.rect.height);
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = thin;
      ctx.setLineDash([thin * 5, thin * 4]);
      ctx.strokeRect(shapes.rect.x, shapes.rect.y, shapes.rect.width, shapes.rect.height);
      ctx.setLineDash([]);
    }
  }
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [i, stroke] of shapes.strokes.entries()) {
    ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
    ctx.lineWidth = stroke.size;
    const path = () => {
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      stroke.points.forEach((point, at) => (at ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.stroke();
    };
    path();
    // 最后画的那一笔描个边，正画着的时候看得见
    if (edge && !stroke.eraser && i === shapes.strokes.length - 1 && ctx.globalCompositeOperation === 'source-over') {
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(thin, stroke.size + thin * 2);
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = 'destination-over';
      path();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
  }
  ctx.restore();
}

// 导出给服务端的那张 PNG：原图尺寸，要重画的地方 alpha=0，颜色照留。
// 先单独画一张「哪里要重画」的掩码，再把它从原图上挖掉 —— 擦的笔迹在掩码里是挖掉，在这里才不会反过来挖原图
export async function maskPng(src: string, shapes: MaskShapes): Promise<string | null> {
  const image = await loadImage(src);
  if (!image) return null;
  const { width, height } = image;
  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const maskCtx = mask.getContext('2d');
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const outCtx = out.getContext('2d');
  if (!maskCtx || !outCtx) return null;
  paintShapes(maskCtx, shapes, MASK_SOLID);
  outCtx.drawImage(image, 0, 0);
  outCtx.globalCompositeOperation = 'destination-out';
  outCtx.drawImage(mask, 0, 0);
  return out.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

type Tool = 'rect' | 'brush' | 'eraser';
// 正在做的手势：拖框是新建一个框，移动和拉角是在已有的框上改，涂抹是接一笔新的
type Gesture =
  | { kind: 'new'; from: MaskPoint }
  | { kind: 'move'; from: MaskPoint; start: MaskRect }
  | { kind: 'resize'; corner: 'nw' | 'ne' | 'sw' | 'se'; start: MaskRect }
  | { kind: 'stroke' };

const HANDLE = 7;

export function MaskEditor({ src, value, onChange, initialTool = 'rect' }: { src: string; value: MaskShapes; onChange: (next: MaskShapes) => void; initialTool?: Tool }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [tool, setTool] = useState<Tool>(initialTool);
  const [brush, setBrush] = useState(0);
  const [draft, setDraft] = useState<MaskShapes | null>(null);
  const [history, setHistory] = useState<MaskShapes[]>([]);
  const [future, setFuture] = useState<MaskShapes[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(1);
  const shown = draft ?? value;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) paintShapes(ctx, shown, MASK_FILL, MASK_EDGE);
  }, [shown, natural]);

  // 画布是缩着显示的（原图可能比屏幕大），笔刷的光标圈按这个比缩
  useEffect(() => {
    const board = boxRef.current;
    if (!board) return;
    const observer = new ResizeObserver(() => setScale(board.clientWidth / Math.max(1, natural?.width ?? board.clientWidth)));
    observer.observe(board);
    setScale(board.clientWidth / Math.max(1, natural?.width ?? board.clientWidth));
    return () => observer.disconnect();
  }, [natural]);

  useEffect(() => {
    if (natural && !brush) setBrush(Math.max(8, Math.round(Math.min(natural.width, natural.height) * 0.05)));
  }, [natural, brush]);

  // 指针位置换成原图像素：画布是缩着显示的，按显示框和画布实际尺寸的比换算
  const at = (e: ReactPointerEvent<HTMLCanvasElement>): MaskPoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * e.currentTarget.width) / rect.width, y: ((e.clientY - rect.top) * e.currentTarget.height) / rect.height };
  };
  // 手柄多大按显示尺寸算，缩得越小手柄在原图里就得留得越大，不然点不着
  const handle = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return (HANDLE * e.currentTarget.width) / rect.width;
  };
  const cornerAt = (point: MaskPoint, handleSize: number): Gesture | null => {
    const rect = value.rect;
    if (!rect) return null;
    const corners: ['nw' | 'ne' | 'sw' | 'se', MaskPoint][] = [
      ['nw', { x: rect.x, y: rect.y }],
      ['ne', { x: rect.x + rect.width, y: rect.y }],
      ['sw', { x: rect.x, y: rect.y + rect.height }],
      ['se', { x: rect.x + rect.width, y: rect.y + rect.height }],
    ];
    const hit = corners.find(([, at]) => Math.abs(point.x - at.x) <= handleSize && Math.abs(point.y - at.y) <= handleSize);
    return hit ? { kind: 'resize', corner: hit[0], start: rect } : null;
  };
  const inside = (point: MaskPoint, rect: MaskRect) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!natural) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = at(e);
    const before = value;
    if (tool === 'rect') {
      const on = cornerAt(point, handle(e));
      gesture.current = on ?? (value.rect && inside(point, value.rect) ? { kind: 'move', from: point, start: value.rect } : { kind: 'new', from: point });
      setDraft(gesture.current.kind === 'new' ? { ...before, rect: { x: point.x, y: point.y, width: 0, height: 0 } } : before);
      return;
    }
    gesture.current = { kind: 'stroke' };
    setDraft({ ...before, strokes: [...before.strokes, { eraser: tool === 'eraser', size: brush, points: [point] }] });
  };

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!natural) return;
    const point = at(e);
    const rect = e.currentTarget.getBoundingClientRect();
    setCursor({ x: ((e.clientX - rect.left) * natural.width) / rect.width, y: ((e.clientY - rect.top) * natural.height) / rect.height });
    const active = gesture.current;
    if (!active) return;
    const before = value;
    if (active.kind === 'stroke') {
      setDraft((current) => {
        if (!current) return current;
        const strokes = current.strokes.slice();
        strokes[strokes.length - 1] = { ...strokes[strokes.length - 1], points: [...strokes[strokes.length - 1].points, point] };
        return { ...current, strokes };
      });
      return;
    }
    if (active.kind === 'new') {
      setDraft({ ...before, rect: { x: Math.min(active.from.x, point.x), y: Math.min(active.from.y, point.y), width: Math.abs(point.x - active.from.x), height: Math.abs(point.y - active.from.y) } });
      return;
    }
    if (active.kind === 'move') {
      const dx = point.x - active.from.x;
      const dy = point.y - active.from.y;
      setDraft({ ...before, rect: { ...active.start, x: active.start.x + dx, y: active.start.y + dy } });
      return;
    }
    const { start, corner } = active;
    const left = corner === 'nw' || corner === 'sw' ? point.x : start.x;
    const top = corner === 'nw' || corner === 'ne' ? point.y : start.y;
    const right = corner === 'ne' || corner === 'se' ? point.x : start.x + start.width;
    const bottom = corner === 'sw' || corner === 'se' ? point.y : start.y + start.height;
    setDraft({ ...before, rect: { x: Math.min(left, right), y: Math.min(top, bottom), width: Math.abs(right - left), height: Math.abs(bottom - top) } });
  };

  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current;
    gesture.current = null;
    if (!active || !draft) {
      setDraft(null);
      return;
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const next = draft.rect && (draft.rect.width < 2 || draft.rect.height < 2) && active.kind === 'new' ? { ...draft, rect: null } : draft;
    setHistory((past) => [...past, value].slice(-20));
    setFuture([]);
    setDraft(null);
    onChange(next);
  };

  const undo = () => {
    const past = history.slice(0, -1);
    const back = history[history.length - 1];
    if (!back) return;
    setHistory(past);
    setFuture((next) => [value, ...next]);
    onChange(back);
  };

  const redo = () => {
    if (!future.length) return;
    setHistory((past) => [...past, value].slice(-20));
    setFuture(future.slice(1));
    onChange(future[0]);
  };

  const clear = () => {
    setHistory((past) => [...past, value].slice(-20));
    setFuture([]);
    onChange(EMPTY_MASK);
  };

  return (
    <div className="mask-wrap" data-od-id="mask-editor" onKeyDown={(e) => {
      if (!(e.ctrlKey || e.metaKey) || !['z', 'y'].includes(e.key.toLowerCase())) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
    }}>
      <div className="mask-tools">
        <div className="seg" role="group" aria-label="掩码工具">
          {(['rect', 'brush', 'eraser'] as const).map((name) => (
            <button key={name} type="button" aria-pressed={tool === name} onClick={() => setTool(name)}>
              {name === 'rect' ? '拖框' : name === 'brush' ? '涂抹' : '擦'}
            </button>
          ))}
        </div>
        {tool !== 'rect' && (
          <label className="field mask-brush">
            笔刷
            <input type="range" aria-label="笔刷大小" min={4} max={natural ? Math.round(Math.max(natural.width, natural.height) / 2) : 400} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
            <span className="meta mono">{brush}</span>
          </label>
        )}
        <button type="button" className="btn btn-ghost btn-sm" id="maskUndo" disabled={!history.length} onClick={undo}>
          <Icon name="undo" />
          撤销
        </button>
        <button type="button" className="btn btn-ghost btn-sm" id="maskClear" disabled={maskIsEmpty(value)} onClick={clear}>
          清空
        </button>
        <button type="button" className="btn btn-ghost btn-sm" id="maskRedo" disabled={!future.length} onClick={redo}>
          重做
        </button>
        <span className="meta">{tool === 'rect' ? '按住拖一个框，能拖动、能拉四个角' : tool === 'brush' ? '按住涂要改的地方' : '按住擦掉画过的'}</span>
      </div>
      <div className="mask-board" ref={boxRef}>
        <img src={src} alt="" draggable={false} onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />
        {natural && (
          <canvas
            ref={canvasRef}
            width={natural.width}
            height={natural.height}
            className="mask-canvas"
            tabIndex={0}
            aria-label="掩码画布，按住拖动涂抹，Ctrl Z 撤销，Ctrl Shift Z 重做"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={() => setCursor(null)}
          />
        )}
        {tool !== 'rect' && cursor && scale && (
          <span className="mask-cursor" style={{ left: cursor.x * scale, top: cursor.y * scale, width: brush * scale, height: brush * scale }} />
        )}
      </div>
    </div>
  );
}

// 大图窗口里那块表单：这块要画成什么、额外的负面词、重绘强度，点「开始重绘」才把掩码导出来发给服务端
export function InpaintForm({ at, src, mask, text, onCancel, onSent }: { at: ImageAt; src: string; mask: MaskShapes; text: string; onCancel: () => void; onSent: () => void }) {
  const [positive, setPositive] = useState(text);
  const [negative, setNegative] = useState('');
  const [denoise, setDenoise] = useState('1');
  const [busy, setBusy] = useState(false);
  const strength = Number(denoise);
  const unit = mask.strokes.length ? (mask.rect ? '涂过和框里的地方' : '涂过的地方') : '框里的地方';
  const ready = !maskIsEmpty(mask) && Number.isFinite(strength) && strength > 0 && strength <= 1;

  const go = async () => {
    setBusy(true);
    const png = await maskPng(src, mask).finally(() => setBusy(false));
    if (!png) {
      toast('这张图读不出来，没法重绘', { tone: 'danger' });
      return;
    }
    onSent();
    void inpaint(at, { mask: png, positive, negative, denoise: strength });
  };

  return (
    <div className="ib-form ib-inpaint" data-od-id="image-inpaint">
      <span className="ib-form-k">局部重绘 · {unit}重画，别处一个像素不动</span>
      <label className="field gc-wide">
        这块画成什么
        <textarea className="input" id="ibInpaintPositive" rows={3} value={positive} onChange={(e) => setPositive(e.target.value)} />
      </label>
      <label className="field">
        额外的负面词
        <input className="input mono" id="ibInpaintNegative" value={negative} onChange={(e) => setNegative(e.target.value)} />
      </label>
      <label className="field">
        重绘强度
        <input className="input mono" id="ibInpaintDenoise" type="number" min="0.05" max="1" step="0.05" value={denoise} onChange={(e) => setDenoise(e.target.value)} />
      </label>
      <p className="hint">1 是完全重画，0.5 到 0.8 保留原来的轮廓、只改细节。要在这台 ComfyUI 上装 ComfyUI-Inpaint-CropAndStitch 插件。</p>
      <span className="grow" />
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
        取消
      </button>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        id="ibInpaintGo"
        disabled={!ready || busy}
        title={maskIsEmpty(mask) ? '先在图上拖个框，或者涂一块' : undefined}
        onClick={() => void go()}
      >
        {busy ? '正在准备…' : '开始重绘'}
      </button>
    </div>
  );
}
