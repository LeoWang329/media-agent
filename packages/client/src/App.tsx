import { useEffect } from 'react';
import { Route, Routes } from 'react-router';
import { Canvas } from './pages/Canvas';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { ConfirmHost } from './ui/confirm';
import { MenuHost } from './ui/menu';
import { Toasts } from './ui/toast';

export function App() {
  // 从文件夹拖图进来没对准槽位时，浏览器默认会把图片当页面打开，把画布顶掉
  useEffect(() => {
    const ignore = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', ignore);
    window.addEventListener('drop', ignore);
    return () => {
      window.removeEventListener('dragover', ignore);
      window.removeEventListener('drop', ignore);
    };
  }, []);

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/canvas/:id" element={<Canvas />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <MenuHost />
      <ConfirmHost />
      <Toasts />
    </>
  );
}
