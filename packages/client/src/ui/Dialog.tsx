import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { create } from 'zustand';

// 开着的模态弹窗，后打开的在最上面。弹窗外的东西都点不到、还压在遮罩下面，
// 所以菜单和提示条要画进最上面那个弹窗里
const useOpenDialogs = create<{ stack: HTMLDialogElement[] }>(() => ({ stack: [] }));
export const useTopDialog = () => useOpenDialogs((s) => s.stack.at(-1) ?? null);

type Props = {
  className?: string;
  style?: CSSProperties;
  label: string;
  odId?: string;
  onClose: () => void;
  children: ReactNode;
};

// 系统自带的模态弹窗：挂上就打开，按 Esc 或点「关闭」都走 onClose，由外面决定卸载。
// 打开时焦点放在带 data-autofocus 的元素上（React 的 autoFocus 跑在打开之前，不算数）
export function Dialog({ className, style, label, odId, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    useOpenDialogs.setState((s) => ({ stack: [...s.stack, dialog] }));
    const onCancel = (e: Event) => {
      e.preventDefault();
      latestClose.current();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      useOpenDialogs.setState((s) => ({ stack: s.stack.filter((d) => d !== dialog) }));
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog ref={ref} className={className ? `dialog ${className}` : 'dialog'} style={style} aria-label={label} data-od-id={odId}>
      {children}
    </dialog>
  );
}
