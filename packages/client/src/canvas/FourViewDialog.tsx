import { useState } from 'react';
import { api } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';
import { useOverlays } from './overlays';

const close = () => useOverlays.setState({ fourView: null });

export function FourViewDialog() {
  const target = useOverlays((s) => s.fourView);
  return target ? <FourView key={JSON.stringify(target)} target={target} /> : null;
}

function FourView({ target }: { target: NonNullable<ReturnType<typeof useOverlays.getState>['fourView']> }) {
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const state = useCanvasStore.getState();
      await state.patchesSaved();
      await trackWrite(api(`/canvases/${state.canvasId}/nodes/${target.nodeId}/four-view`, { method: 'POST', body: { reference: target.reference, extra } }));
      await state.loadNode(target.nodeId);
      await state.refresh();
      close();
      toast('四视图已排队，结果挂在对应的提示词框下面');
    } catch (err) {
      toast((err as Error).message, { tone: 'danger', ms: 4500 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog label="做四视图" onClose={close}>
      <div className="dialog-head">
        <h2>做四视图</h2>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dialog-body stack">
        <p>照这张图里的角色，生成脸部特写、正面全身、侧面全身、背面全身四视图。</p>
        <label className="field">
          额外要求（可不填）
          <textarea
            className="input"
            rows={3}
            aria-label="额外要求"
            placeholder="用英文补充服装、背景或其他要求"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
        </label>
        <p className="hint">默认使用 Krea2 Turbo 四视图流程；Krea2 节点已选“四视图”时，使用该节点的出图设置。</p>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" onClick={close}>
          取消
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start()}>
          {busy ? '正在开始…' : '开始做四视图'}
        </button>
      </div>
    </Dialog>
  );
}
