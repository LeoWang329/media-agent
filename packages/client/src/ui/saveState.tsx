import { useEffect } from 'react';
import { create } from 'zustand';

const useSaveState = create<{ writing: number; savedAt: Date | null }>(() => ({ writing: 0, savedAt: null }));

const pad = (n: number) => String(n).padStart(2, '0');
export const clockTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const MIN_WRITING_MS = 650;

// 往工作文件夹写东西时包一层：顶栏显示「正在写入」，写完显示时间。
// 本机写得很快，「正在写入」至少留 0.65 秒，不然只闪一下
export async function trackWrite<T>(task: Promise<T>): Promise<T> {
  const started = Date.now();
  useSaveState.setState((s) => ({ writing: s.writing + 1 }));
  try {
    const result = await task;
    useSaveState.setState({ savedAt: new Date() });
    return result;
  } finally {
    setTimeout(() => useSaveState.setState((s) => ({ writing: s.writing - 1 })), Math.max(0, started + MIN_WRITING_MS - Date.now()));
  }
}

// 服务端自己在写（比如回复写完落盘）：顶栏闪一下「正在写入」再显示时间
export function markSaved() {
  useSaveState.setState((s) => ({ writing: s.writing + 1 }));
  setTimeout(() => useSaveState.setState((s) => ({ writing: s.writing - 1, savedAt: new Date() })), MIN_WRITING_MS);
}

// idle：这次打开页面后还没写过东西时显示的话
export function SaveState({ idle, className }: { idle: string; className?: string }) {
  const { writing, savedAt } = useSaveState();
  // 换了页面，上一个页面写入的时间不算
  useEffect(() => useSaveState.setState({ savedAt: null }), []);
  const text = writing ? '正在写入工作文件夹…' : savedAt ? `已写入 ${clockTime(savedAt)}` : idle;
  return (
    <span className={`save-state${writing ? ' is-writing' : ''}${className ? ` ${className}` : ''}`} data-od-id="save-state">
      <span className="dot dot-ok" />
      <span className="save-text">{text}</span>
    </span>
  );
}
