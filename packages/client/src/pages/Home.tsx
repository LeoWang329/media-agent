import type { CanvasListItem, Config } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, imageThumbUrl } from '../api';
import { confirmBox } from '../ui/confirm';
import { Dialog } from '../ui/Dialog';
import { relativeWhen } from '../ui/format';
import { Icon } from '../ui/Icon';
import { showMenu, showMenuAt, type MenuItem } from '../ui/menu';
import { RenameInput } from '../ui/RenameInput';
import { ThemeToggle } from '../ui/theme';
import { toast } from '../ui/toast';

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger' });

export function Home() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<Config | null>(null);
  const [canvases, setCanvases] = useState<CanvasListItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);

  const load = () => api<CanvasListItem[]>('/canvases').then(setCanvases, failed);

  useEffect(() => {
    document.title = '画布 · 提示词画布';
    api<Config>('/config').then((loaded) => {
      if (!loaded.workFolder) return navigate('/setup', { replace: true });
      setConfig(loaded);
      void load();
    }, failed);
  }, [navigate]);

  if (!config) return null;
  const work = config.workFolder!;
  const sep = work.includes('\\') ? '\\' : '/';

  const rename = async (canvas: CanvasListItem, next: string | null) => {
    setRenamingId(null);
    const title = next?.trim();
    if (!title || title === canvas.title) return;
    try {
      await api(`/canvases/${canvas.id}`, { method: 'PATCH', body: { title } });
      toast(`已改名为「${title}」`);
      await load();
    } catch (err) {
      failed(err);
    }
  };

  const remove = async (canvas: CanvasListItem) => {
    const ok = await confirmBox({
      title: `删除「${canvas.title}」？`,
      body: (
        <>
          里面的 {canvas.nodeCount} 个节点和图片副本会一起移到工作文件夹的回收站目录，不是真删：<br />
          <span className="mono" style={{ fontSize: 12 }}>{`${work}${sep}.trash`}</span>
        </>
      ),
      ok: '移到回收站',
      danger: true,
    });
    if (!ok) return;
    try {
      const { trash } = await api<{ trash: string }>(`/canvases/${canvas.id}`, { method: 'DELETE' });
      setCanvases((list) => list?.filter((c) => c.id !== canvas.id) ?? null);
      toast(`「${canvas.title}」已移到回收站`, {
        action: '撤销',
        onAction: () => {
          api('/canvases/restore', { method: 'POST', body: { trash } }).then(load, failed);
        },
      });
    } catch (err) {
      failed(err);
    }
  };

  const menuItems = (canvas: CanvasListItem): MenuItem[] => [
    { label: '打开', icon: 'arrow-right', onClick: () => navigate(`/canvas/${canvas.id}`) },
    { label: '重命名', icon: 'edit', onClick: () => setRenamingId(canvas.id) },
    { sep: true },
    { label: '删除（移到回收站）', icon: 'trash', danger: true, onClick: () => void remove(canvas) },
  ];

  return (
    <>
      <header className="appbar" data-od-id="home-appbar">
        <Link className="brand" to="/"><span className="brand-mark"><Icon name="logo" /></span>提示词画布</Link>
        <span className="spacer" />
        <Link className="path-pill hide-sm" to={{ pathname: '/settings', hash: 'workdir' }} title="工作文件夹，在设置里可以换" data-od-id="workdir-pill">
          <Icon name="folder" className="icon-sm" />
          <span>{work}</span>
        </Link>
        <ThemeToggle />
        <Link className="btn btn-ghost" to="/settings" data-od-id="link-settings"><Icon name="gear" /><span className="hide-sm">设置</span></Link>
      </header>

      <main className="page">
        <section className="page-head" data-od-id="home-head">
          <div>
            <h1>画布</h1>
            <p className="meta" id="count">{canvases ? `${canvases.length} 个画布 · 按最近动过排序` : ''}</p>
          </div>
          <button type="button" className="btn btn-primary btn-lg" id="btnNew" data-od-id="btn-new-canvas" onClick={() => setCreating(true)}>
            <Icon name="plus" />新建画布
          </button>
        </section>
        <section className="cv-grid" id="grid" data-od-id="canvas-list" aria-label="全部画布">
          {canvases?.map((canvas) => (
            <article
              key={canvas.id}
              className={`cv${canvas.id === freshId ? ' is-new' : ''}`}
              data-id={canvas.id}
              data-od-id={`canvas-card-${canvas.id}`}
              onContextMenu={(e) => {
                e.preventDefault();
                showMenuAt(e.clientX, e.clientY, menuItems(canvas));
              }}
            >
              <Link className="cv-link" to={`/canvas/${canvas.id}`} aria-label={`打开「${canvas.title}」`} />
              <div className="cv-cover">
                {canvas.cover ? (
                  <img src={imageThumbUrl(canvas.id, canvas.cover)} alt="" loading="lazy" />
                ) : (
                  <div className="cv-empty">{canvas.nodeCount ? '还没有参考图' : '还没有节点'}</div>
                )}
                {canvas.generating > 0 && (
                  <span className="tag live"><span className="dot dot-live" />{canvas.generating} 个节点正在生成</span>
                )}
              </div>
              <div className="cv-body">
                <div className="grow">
                  {renamingId === canvas.id ? (
                    <RenameInput value={canvas.title} className="cv-rename" maxLength={30} onDone={(next) => void rename(canvas, next)} />
                  ) : (
                    <h3 className="cv-title">{canvas.title}</h3>
                  )}
                  <div className="meta">
                    <span className="num">{canvas.nodeCount}</span> 个节点<span>·</span><span>{relativeWhen(canvas.updatedAt)}动过</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm cv-menu"
                  data-menu
                  aria-label="画布操作"
                  onClick={(e) => showMenu(e.currentTarget, menuItems(canvas))}
                >
                  <Icon name="more" />
                </button>
              </div>
            </article>
          ))}
        </section>
      </main>

      {creating && (
        <NewCanvasDialog
          onClose={() => setCreating(false)}
          onCreated={async (id, title) => {
            setCreating(false);
            setFreshId(id);
            await load();
            toast(`建好了「${title}」`);
          }}
        />
      )}
    </>
  );
}

function NewCanvasDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, title: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    const value = title.trim();
    if (!value) return setError('先起个名字');
    try {
      const canvas = await api<{ id: string }>('/canvases', { method: 'POST', body: { title: value } });
      await onCreated(canvas.id, value);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Dialog label="新建画布" odId="dialog-new-canvas" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="dialog-head"><h2>新建画布</h2></div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="newTitle">画布名字</label>
            <input
              className={`input${error ? ' is-error' : ''}`}
              id="newTitle"
              maxLength={30}
              placeholder="比如：春节回家短片"
              autoComplete="off"
              autoFocus
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError('');
              }}
            />
            <p className={error ? 'hint is-error' : 'hint'} id="newHint">{error || '一个创作项目一张画布，建好后在里面建节点。'}</p>
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="btn btn-primary" id="newOk">新建</button>
        </div>
      </form>
    </Dialog>
  );
}
