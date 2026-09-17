import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useTopDialog } from './Dialog';

type ToastOptions = { tone?: 'warn' | 'danger'; action?: string; onAction?: () => void; ms?: number };
type ToastItem = ToastOptions & { id: number; message: ReactNode; leaving: boolean };

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let seq = 0;

const remove = (id: number) => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }));

// 底部居中的提示条，几秒后淡出；可以带一个操作按钮（比如「撤销」）
export function toast(message: ReactNode, options: ToastOptions = {}) {
  const id = ++seq;
  useToasts.setState((s) => ({ items: [...s.items, { ...options, id, message, leaving: false }] }));
  setTimeout(() => {
    useToasts.setState((s) => ({ items: s.items.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    setTimeout(() => remove(id), 220);
  }, options.ms ?? 2800);
}

export function Toasts() {
  const items = useToasts((s) => s.items);
  const dialog = useTopDialog();
  if (!items.length) return null;
  const list = (
    <div className="toasts" role="status">
      {items.map((t) => (
        <div
          key={t.id}
          className={t.tone ? `toast is-${t.tone}` : 'toast'}
          style={t.leaving ? { transition: 'opacity .2s', opacity: 0 } : undefined}
        >
          <span className="toast-dot" />
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                t.onAction?.();
                remove(t.id);
              }}
            >
              {t.action}
            </button>
          )}
        </div>
      ))}
    </div>
  );
  // 弹窗开着时画进弹窗里，不然压在遮罩下面看不清、点不到
  return dialog ? createPortal(list, dialog) : list;
}
