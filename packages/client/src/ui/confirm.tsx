import type { ReactNode } from 'react';
import { create } from 'zustand';
import { Dialog } from './Dialog';

type ConfirmOptions = { title: ReactNode; body: ReactNode; ok: string; cancel?: string; danger?: boolean };
type Pending = ConfirmOptions & { id: number; resolve: (ok: boolean) => void };

const useConfirm = create<{ pending: Pending | null }>(() => ({ pending: null }));
let seq = 0;

// 确认框：点确定返回 true，取消、Esc 返回 false
export function confirmBox(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ pending: { ...options, id: ++seq, resolve } }));
}

export function ConfirmHost() {
  const pending = useConfirm((s) => s.pending);
  if (!pending) return null;
  const finish = (ok: boolean) => {
    if (useConfirm.getState().pending?.id !== pending.id) return;
    useConfirm.setState({ pending: null });
    pending.resolve(ok);
  };
  return (
    <Dialog key={pending.id} label={typeof pending.title === 'string' ? pending.title : '确认'} onClose={() => finish(false)}>
      <div className="dialog-head">
        <h2>{pending.title}</h2>
      </div>
      <div className="dialog-body">
        <p className="muted" style={{ fontSize: '13.5px' }}>{pending.body}</p>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" onClick={() => finish(false)}>
          {pending.cancel ?? '取消'}
        </button>
        <button type="button" className={pending.danger ? 'btn btn-danger' : 'btn btn-primary'} data-autofocus onClick={() => finish(true)}>
          {pending.ok}
        </button>
      </div>
    </Dialog>
  );
}
