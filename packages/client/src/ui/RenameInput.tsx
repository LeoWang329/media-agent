import { useRef } from 'react';

type Props = { value: string; className: string; maxLength: number; onDone: (next: string | null) => void };

// 就地改名的输入框：回车或点别处保存，Esc 放弃（onDone 收到 null）
export function RenameInput({ value, className, maxLength, onDone }: Props) {
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input
      className={`input ${className}`}
      defaultValue={value}
      maxLength={maxLength}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
