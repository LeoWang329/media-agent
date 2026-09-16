import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AssetLibrary } from '../components/AssetLibrary';
import { CanvasView } from '../components/CanvasView';
import { ChatPanel } from '../components/ChatPanel';
import { useCanvasStore } from '../store/canvasStore';

const MIN_PANEL_WIDTH = 360;

export function Canvas() {
  const { id } = useParams();
  const title = useCanvasStore((s) => s.detail?.canvas.title);
  const error = useCanvasStore((s) => s.error);
  const { open, clearError } = useCanvasStore.getState();
  const [assetsCollapsed, setAssetsCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(480);

  useEffect(() => {
    if (id) void open(id);
  }, [id, open]);

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
        <ReactFlowProvider>
          <CanvasView />
        </ReactFlowProvider>
      </main>
      <div className="panel-resizer" onPointerDown={startResize} />
      <section className="chat-panel" style={{ width: panelWidth }}>
        <ChatPanel />
      </section>
    </div>
  );
}
