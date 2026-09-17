import { useState } from 'react';
import { imageFileUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { useOverlays, type ZoomTarget } from './overlays';

const close = () => useOverlays.setState({ zoom: null });

export function ZoomDialog() {
  const zoom = useOverlays((s) => s.zoom);
  const canvasId = useCanvasStore((s) => s.canvasId);
  if (!zoom || !canvasId) return null;
  return <Zoom key={zoom.imageId} zoom={zoom} canvasId={canvasId} />;
}

// 放大看槽位里的图（画布里存的那份）：先整张放进窗口，点图看原始大小，再点缩回去；点图外面的空白关掉
function Zoom({ zoom, canvasId }: { zoom: ZoomTarget; canvasId: string }) {
  const image = useCanvasStore((s) => s.detail?.images[zoom.imageId]);
  const [actual, setActual] = useState(false);

  return (
    <Dialog className="dialog-zoom" label="放大看图" odId="dialog-zoom" onClose={close}>
      <div className="zoom-head">
        <span className="grow zoom-title">
          {zoom.title}
          {image && <span className="mono muted"> · {image.width}×{image.height}</span>}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" id="zoomToggle" onClick={() => setActual((on) => !on)}>
          <Icon name={actual ? 'collapse' : 'expand'} />
          {actual ? '整张放进窗口' : '看原始大小'}
        </button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div
        className={`zoom-stage${actual ? ' is-actual' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <img src={imageFileUrl(canvasId, zoom.imageId)} alt={zoom.title} draggable={false} onClick={() => setActual((on) => !on)} />
      </div>
    </Dialog>
  );
}
