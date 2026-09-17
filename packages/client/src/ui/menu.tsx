import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useTopDialog } from './Dialog';
import { Icon, type IconName } from './Icon';

export type MenuItem =
  | { label: string; icon?: IconName; danger?: boolean; onClick: () => void }
  | { note: string }
  | { sep: true };

type OpenMenu = { anchor: DOMRect; items: MenuItem[]; align: 'left' | 'right'; id: number };

const useMenu = create<{ open: OpenMenu | null }>(() => ({ open: null }));
let seq = 0;

export const closeMenu = () => useMenu.setState({ open: null });

// 贴着按钮弹出的菜单：默认右边对齐，下面放不下就往上弹
export function showMenu(anchor: Element, items: MenuItem[], align: 'left' | 'right' = 'right') {
  useMenu.setState({ open: { anchor: anchor.getBoundingClientRect(), items, align, id: ++seq } });
}

// 右键菜单：贴着鼠标的位置弹出
export function showMenuAt(x: number, y: number, items: MenuItem[]) {
  useMenu.setState({ open: { anchor: new DOMRect(x, y, 0, 0), items, align: 'left', id: ++seq } });
}

export function MenuHost() {
  const open = useMenu((s) => s.open);
  const dialog = useTopDialog();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) return setPosition(null);
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    const r = open.anchor;
    const left = open.align === 'left' ? r.left : r.right - w;
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = r.top - h - 6;
    setPosition({ left: Math.max(8, Math.min(left, innerWidth - w - 8)), top: Math.max(8, top) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;
  const menu = (
    <div
      key={open.id}
      ref={ref}
      className="menu"
      role="menu"
      style={position ?? { left: 0, top: 0, visibility: 'hidden' }}
    >
      {open.items.map((item, i) => {
        if ('sep' in item) return <hr key={i} />;
        if ('note' in item) return <div key={i} className="menu-note">{item.note}</div>;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={item.danger ? 'is-danger' : undefined}
            onClick={(e) => {
              e.stopPropagation();
              closeMenu();
              item.onClick();
            }}
          >
            {item.icon && <Icon name={item.icon} />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
  // 从弹窗里点出来的菜单画进弹窗里，不然点不到
  return dialog ? createPortal(menu, dialog) : menu;
}
