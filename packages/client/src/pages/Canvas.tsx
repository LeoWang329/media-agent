import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AssetLibrary } from '../components/AssetLibrary';
import { CanvasView } from '../components/CanvasView';
import { ChatPanel } from '../components/ChatPanel';
import { CollageBoard } from '../components/CollageBoard';
import { useAssetStore } from '../store/assetStore';
import { useCanvasStore } from '../store/canvasStore';

const MIN_PANEL_WIDTH = 360;

export function Canvas() {
  const { id } = useParams();
  const title = useCanvasStore((s) => s.detail?.canvas.title);
  const error = useCanvasStore((s) => s.error);
  const { open, clearError, undo, redo } = useCanvasStore.getState();
  const collage = useAssetStore((s) => s.collage);
  const [assetsCollapsed, setAssetsCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(480);

  useEffect(() => {
    if (id) void open(id);
  }, [id, open]);

  // Ctrl+Z 撤销、Ctrl+Shift+Z 重做；在输入框、提示词编辑器里打字时不抢，那里有自己的撤销
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      void (e.shiftKey ? redo() : undo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // 拖面板左边缘改宽度
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (event: PointerEvent) =>
      setPanelWidth(Math.min(Math.max(window.innerWidth - event.clientX, MIN_PANEL_WIDTH), window.innerWidth - 400));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="canvas-page">
      <aside className={`asset-column${assetsCollapsed ? ' collapsed' : ''}`}>
        <button type="button" className="collapse-button" onClick={() => setAssetsCollapsed(!assetsCollapsed)}>
          {assetsCollapsed ? '›' : '‹ 收起'}
        </button>
        {!assetsCollapsed && <AssetLibrary />}
      </aside>
      <main className="canvas-main">
        <header className="canvas-header">
          <Link to="/">首页</Link>
          <h1>{title}</h1>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={clearError}>知道了</button>
          </div>
        )}
        <div className="canvas-area">
          <ReactFlowProvider>
            <CanvasView />
          </ReactFlowProvider>
          {collage && <CollageBoard />}
        </div>
      </main>
      <div className="panel-resizer" onPointerDown={startResize} />
      <section className="chat-panel" style={{ width: panelWidth }}>
        <ChatPanel />
      </section>
    </div>
  );
}
