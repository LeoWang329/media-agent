import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type Theme = 'dark' | 'light';

const THEME_EVENT = 'pc-theme';

const current = (): Theme => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

// 明暗记在浏览器里；页面一打开就要用上，读取写在 index.html 里
export function setTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('pc-theme', theme);
  } catch {
    // 浏览器不让存就只管这一次
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export const toggleTheme = () => setTheme(current() === 'dark' ? 'light' : 'dark');

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setLocal] = useState(current);
  useEffect(() => {
    const sync = () => setLocal(current());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);
  const title = theme === 'dark' ? '切到亮色' : '切到暗色';
  return (
    <button type="button" className={`btn btn-ghost btn-icon${className ? ` ${className}` : ''}`} title={title} aria-label={title} onClick={toggleTheme}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
