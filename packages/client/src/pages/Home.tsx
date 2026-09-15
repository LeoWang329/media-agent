import type { CanvasListItem, Config } from '@media-agent/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { ContextMenu } from '../components/ContextMenu';

export function Home() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<Config | null>(null);
  const [canvases, setCanvases] = useState<CanvasListItem[]>([]);
  const [menu, setMenu] = useState<{ canvas: CanvasListItem; x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const closeMenu = useCallback(() => setMenu(null), []);

  const attempt = async (task: () => Promise<void>) => {
    try {
      setError('');
      await task();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const loadCanvases = () => attempt(async () => setCanvases(await api<CanvasListItem[]>('/canvases')));

  useEffect(() => {
    api<Config>('/config').then(
      (loaded) => {
        if (loaded.workFolder) {
          setConfig(loaded);
          void loadCanvases();
        } else {
          navigate('/settings', { replace: true });
        }
      },
      (err: Error) => setError(err.message),
    );
  }, [navigate]);

  const create = () =>
    attempt(async () => {
      const title = window.prompt('画布标题')?.trim();
      if (!title) return;
      const canvas = await api<{ id: string }>('/canvases', { method: 'POST', body: { title } });
      navigate(`/canvas/${canvas.id}`);
    });

  const rename = (canvas: CanvasListItem) =>
    attempt(async () => {
      const title = window.prompt('新的标题', canvas.title)?.trim();
      if (!title || title === canvas.title) return;
      await api(`/canvases/${canvas.id}`, { method: 'PATCH', body: { title } });
      await loadCanvases();
    });

  const remove = (canvas: CanvasListItem) =>
    attempt(async () => {
      if (!window.confirm(`删除画布「${canvas.title}」？会移到工作文件夹的 .trash 里。`)) return;
      await api(`/canvases/${canvas.id}`, { method: 'DELETE' });
      await loadCanvases();
    });

  const openMenu = (canvas: CanvasListItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ canvas, x: e.clientX, y: e.clientY });
  };

  if (!config) return error ? <main className="page"><p className="status error">{error}</p></main> : null;
  return (
    <main className="page">
      <header className="topbar">
        <h1>提示词画布</h1>
        <span className="muted">工作文件夹：{config.workFolder}</span>
        <Link to="/settings">设置</Link>
      </header>
      <div className="row">
        <button type="button" onClick={() => void create()}>新建画布</button>
      </div>
      {error && <p className="status error">{error}</p>}
      <ul className="canvas-list">
        {canvases.map((canvas) => (
          <li key={canvas.id} onContextMenu={(e) => openMenu(canvas, e)}>
            <Link to={`/canvas/${canvas.id}`} className="canvas-title">{canvas.title}</Link>
            <span className="muted">{new Date(canvas.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
            <span className="muted">{canvas.nodeCount} 个节点</span>
            <button type="button" aria-label={`${canvas.title} 的更多操作`} onClick={(e) => openMenu(canvas, e)}>⋯</button>
          </li>
        ))}
      </ul>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          items={[
            { label: '重命名', onSelect: () => void rename(menu.canvas) },
            { label: '删除', onSelect: () => void remove(menu.canvas) },
          ]}
        />
      )}
    </main>
  );
}
