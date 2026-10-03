import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTopDialog } from './Dialog';

type Props = {
  anchor: DOMRect;
  align?: 'left' | 'right'; // 和按钮的左边还是右边对齐
  className: string;
  odId?: string;
  label?: string;
  onClose: () => void;
  // 点在这些地方不算点外面（比如再点一次打开它的那个小块，由小块自己处理）
  keepOpen?: (target: Element) => boolean;
  children: ReactNode;
};

// 贴着一个东西弹出的小窗：下面放不下就往上弹；点外面或按 Esc 关掉。开着弹窗时画进最上面那个弹窗里
export function Popover({ anchor, align = 'left', className, odId, label, onClose, keepOpen, children }: Props) {
  const dialog = useTopDialog();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const latest = useRef({ onClose, keepOpen });
  latest.current = { onClose, keepOpen };

  useLayoutEffect(() => {
    const { offsetWidth: w, offsetHeight: h } = ref.current!;
    const left = align === 'left' ? anchor.left : anchor.right - w;
    let top = anchor.bottom + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, anchor.top - h - 6);
    setPosition({ left: Math.max(8, Math.min(left, innerWidth - w - 8)), top });
  }, [anchor, align]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element;
      if (ref.current?.contains(target) || latest.current.keepOpen?.(target)) return;
      latest.current.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 在弹窗里时只关小窗，不关弹窗
      e.preventDefault();
      e.stopPropagation();
      latest.current.onClose();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const pop = (
    <div ref={ref} className={`img-pop ${className}`} data-od-id={odId} role="dialog" aria-label={label} style={position ?? { left: 0, top: 0, visibility: 'hidden' }}>
      {children}
    </div>
  );
  return createPortal(pop, dialog ?? document.body);
}
