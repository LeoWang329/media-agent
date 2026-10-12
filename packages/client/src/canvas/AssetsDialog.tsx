import { ASSET_SORT_LABELS, ASSET_SORTS, type AssetFile, type AssetSort, type FolderTree } from '@media-agent/shared';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api, assetFileUrl, assetThumbUrl } from '../api';
import { isUnder, useAssetStore } from '../store/assetStore';
import { MAX_SLOTS, useCanvasStore } from '../store/canvasStore';
import { confirmBox } from '../ui/confirm';
import { fmtNum } from '../ui/copy';
import { Dialog } from '../ui/Dialog';
import { fmtSize } from '../ui/format';
import { Icon } from '../ui/Icon';
import { showMenu } from '../ui/menu';
import { toast } from '../ui/toast';
import { closeAssets, useOverlays, type AssetsMode } from './overlays';
import { referLibraryImage } from './RefPicker';
import { ZoomView } from './ZoomDialog';

const PAGE = 120;

const extension = (name: string) => (name.split('.').pop() ?? '').toUpperCase();
const parentFolder = (path: string) => path.replace(/[\\/][^\\/]*$/, '');
const pressEnter = (action: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter') action();
};

export function AssetsDialog() {
  const state = useOverlays((s) => s.assets);
  const hasNode = useCanvasStore((s) => Boolean(s.selectedId && s.nodes[s.selectedId]));
  if (!state) return null;
  // 没选节点时只能看看
  const mode: AssetsMode = hasNode ? state.mode : 'browse';
  return <AssetsBody key={`${mode}-${state.slot ?? ''}`} mode={mode} slot={state.slot} />;
}

function AssetsBody({ mode, slot }: { mode: AssetsMode; slot?: number }) {
  const node = useCanvasStore((s) => (s.selectedId ? s.nodes[s.selectedId] : undefined));
  const images = useCanvasStore((s) => s.detail?.images);
  const records = useCanvasStore((s) => s.detail?.media);
  const { roots, trees, scanning, folder, files, unreadable, query, results, sort } = useAssetStore();
  const [typed, setTyped] = useState('');
  const [selected, setSelected] = useState<AssetFile[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [importing, setImporting] = useState(false);
  const [zoomed, setZoomed] = useState<AssetFile | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void useAssetStore.getState().search('');
    void useAssetStore.getState().load();
  }, []);

  // 搜索框停手 150 毫秒再搜
  useEffect(() => {
    const timer = setTimeout(() => void useAssetStore.getState().search(typed), 150);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    setLimit(PAGE);
    if (grid.current) grid.current.scrollTop = 0;
  }, [folder, query, sort]);

  // 槽位里的图是从哪个文件放进去的，用来标「在 N 号」
  const slotOfPath = new Map<string, number>();
  node?.slots.forEach((id, i) => {
    const path = images?.[id]?.originalPath;
    if (path) slotOfPath.set(path, i);
  });

  // 已经放进视频和音频那一排的文件
  const placedMedia = new Set((node?.media ?? []).map((m) => records?.[m.mediaId]?.originalPath).filter(Boolean));

  const openFolder = (path: string) => {
    setTyped('');
    void useAssetStore.getState().search('');
    void useAssetStore.getState().openFolder(path);
  };

  const pick = (file: AssetFile) => {
    if (mode === 'browse') return toast(`${file.name} · ${fmtSize(file.size)}`);
    // 续写起点只能挑视频，见 docs/dev-plan.md 5.35
    if (mode === 'lead') {
      if (file.kind !== 'video') return toast('续写起点要一段视频', { tone: 'warn' });
      closeAssets();
      if (node) void useCanvasStore.getState().useLead(node.id, { path: file.path, name: file.name, mtime: file.mtime });
      return;
    }
    if (file.kind !== 'image' && mode !== 'slots') return toast('这里只能挑图', { tone: 'warn' });
    if (mode === 'slots') {
      setSelected((list) => (list.some((f) => f.path === file.path) ? list.filter((f) => f.path !== file.path) : [...list, file]));
      return;
    }
    closeAssets();
    // 等弹窗关掉再插：弹窗开着时输入框拿不到焦点
    if (mode === 'ref') return void setTimeout(() => void referLibraryImage(file));
    const at = slotOfPath.get(file.path);
    if (at !== undefined) return toast(`这张图已经在 ${at + 1} 号了`, { tone: 'warn' });
    if (node && slot !== undefined) void useCanvasStore.getState().place(node.id, [{ path: file.path, name: file.name, mtime: file.mtime }], { replaceIndex: slot });
  };

  const removeRoot = async (root: string) => {
    const ok = await confirmBox({
      title: '从资产库移除这个文件夹？',
      body: (
        <>
          <span className="mono">{root}</span>
          <br />
          <br />
          只是不在资产库里显示了，电脑上的文件不会动。已经放进槽位的图不受影响。
        </>
      ),
      ok: '移除',
      danger: true,
    });
    if (ok) await useAssetStore.getState().removeFolder(root);
  };

  const titles: Record<AssetsMode, [string, string]> = {
    slots: ['资产库', node ? `选几张放进「${node.title}」的槽位` : ''],
    browse: ['资产库', '图片原地引用，不会复制到别处'],
    replace: [`换掉 ${(slot ?? 0) + 1} 号槽位的图`, `挑一张，编号还是 ${(slot ?? 0) + 1} 号`],
    ref: ['挑一张图插进句子里', '不在槽位里的图会先放进下一个空槽位'],
    lead: ['挑一段当续写起点', '只能挑视频。点一个就直接用，不用读多长、多宽——规整到出片大小是在那台上做的'],
  };

  const tile = (file: AssetFile) => {
    const sub = query ? <div className="tile-path">{parentFolder(file.path)}</div> : null;
    if (!file.supported) {
      const format = extension(file.name);
      return (
        <div key={file.path} className="tile is-unsupported" title={`${file.name} 是 ${format} 格式，H3 只收 jpg、png、webp`} data-testid="asset-tile">
          <div className="tile-img">
            <div className="fmt">
              <b>{format}</b>这个格式用不了
            </div>
          </div>
          <div className="tile-name">{file.name}</div>
          {sub}
        </div>
      );
    }
    const order = selected.findIndex((f) => f.path === file.path);
    const at = slotOfPath.get(file.path);
    // 视频显示开头的画面，音频是个图标，见 docs/dev-plan.md 5.31
    if (file.kind !== 'image') {
      return (
        <button
          key={file.path}
          type="button"
          className={`tile is-${file.kind}${order >= 0 ? ' is-selected' : ''}`}
          title={`${file.name} · ${fmtSize(file.size)}`}
          data-od-id="asset-tile"
          data-testid="asset-tile"
          onClick={() => pick(file)}
        >
          <div className="tile-img">
            {file.kind === 'video' ? (
              <video className="im" src={`${assetFileUrl(file.path, file.mtime)}#t=0.1`} preload="metadata" muted />
            ) : (
              <span className="tile-audio">
                <Icon name="music" />
              </span>
            )}
            <span className="tag tile-kind">{file.kind === 'video' ? '视频' : '音频'}</span>
            {mode === 'slots' && <span className="check">{order >= 0 ? order + 1 : ''}</span>}
            {placedMedia.has(file.path) && <span className="tag in-slot">已放进来</span>}
          </div>
          <div className="tile-name">{file.name}</div>
          {sub}
        </button>
      );
    }
    return (
      <button
        key={file.path}
        type="button"
        className={`tile${order >= 0 ? ' is-selected' : ''}`}
        title={`${file.name} · ${fmtSize(file.size)}`}
        data-od-id="asset-tile"
        data-testid="asset-tile"
        onClick={() => pick(file)}
      >
        <div className="tile-img">
          <img className="im" src={assetThumbUrl(file.path, file.mtime)} alt={file.name} loading="lazy" draggable={false} />
          {mode === 'slots' && <span className="check">{order >= 0 ? order + 1 : ''}</span>}
          {at !== undefined && <span className="tag in-slot">在 {at + 1} 号</span>}
          {/* 在格子按钮里面，不能再套按钮，用 span 接点击 */}
          <span
            className="tile-zoom"
            role="button"
            tabIndex={0}
            aria-label="放大看"
            title="放大看"
            onClick={(e) => {
              e.stopPropagation();
              setZoomed(file);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              setZoomed(file);
            }}
          >
            <Icon name="expand" className="icon-sm" />
          </span>
        </div>
        <div className="tile-name">{file.name}</div>
        {sub}
      </button>
    );
  };

  let crumb = '';
  let count = '';
  let body: ReactNode;
  if (query) {
    crumb = `在全部 ${roots.length} 个文件夹里搜「${query}」`;
    count = results ? `${results.length} 个结果` : '';
    body = results && (results.length ? results.map(tile) : <div className="as-empty">没有文件名包含「{query}」的图</div>);
  } else if (!roots.length) {
    body = <div className="as-empty">还没有导入文件夹</div>;
  } else if (unreadable) {
    crumb = folder ?? '';
    body = (
      <div className="as-empty">
        <div style={{ color: 'var(--danger)', display: 'inline-grid', placeItems: 'center', marginBottom: 10 }}>
          <Icon name="lock" />
        </div>
        <h3 style={{ color: 'var(--fg)' }}>读不了这个文件夹</h3>
        <p style={{ margin: '6px auto 14px', maxWidth: '44ch', fontSize: 13 }}>{unreadable}</p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          id="asRetry"
          onClick={async () => {
            if (folder && !(await useAssetStore.getState().openFolder(folder, true))) {
              toast(`还是读不了：${useAssetStore.getState().unreadable?.split('。')[0] ?? ''}`, { tone: 'danger' });
            }
          }}
        >
          <Icon name="retry" />
          重试
        </button>
      </div>
    );
  } else {
    crumb = folder ?? '';
    const total = files?.length ?? 0;
    count = files ? `已加载 ${Math.min(limit, total)} / ${fmtNum(total)} 张` : '';
    const skeletons = Array.from({ length: 6 }, (_, i) => (
      <div key={`skeleton-${i}`} className="tile" aria-hidden="true">
        <div className="tile-img skeleton" />
        <div className="tile-name skeleton" style={{ height: 10, borderRadius: 4, marginTop: 8, width: '70%' }} />
      </div>
    ));
    body = !files ? (
      skeletons
    ) : !total ? (
      <div className="as-empty">这个文件夹里没有图</div>
    ) : (
      <>
        {files.slice(0, limit).map(tile)}
        {total > limit && (
          <>
            {skeletons}
            <div className="as-more meta">往下滚继续加载缩略图</div>
          </>
        )}
      </>
    );
  }

  const room = node ? MAX_SLOTS - node.slots.length : 0;
  const fresh = selected.filter((f) => !slotOfPath.has(f.path)).length;
  let foot: ReactNode = '';
  if (mode === 'browse') foot = node ? '' : '在画布上选一个节点，就能把图放进它的槽位';
  else if (mode === 'replace') foot = '点一张图直接替换';
  else if (mode === 'ref') foot = '点一张图就好';
  else if (mode === 'lead') foot = '点一段视频就好，哪个文件夹里的都行';
  else if (selected.length) {
    foot = (
      <>
        已选 <b className="mono">{selected.length}</b> 张，按点选顺序放进 {(node?.slots.length ?? 0) + 1} 号往后 · 槽位还剩 <span className="mono">{room}</span> 个
        {fresh > room && (
          <>
            {' · '}
            <span style={{ color: 'var(--warn)' }}>多出来的 {fresh - room} 张放不进去</span>
          </>
        )}
      </>
    );
  } else {
    foot = (
      <>
        点图多选 · 槽位还剩 <span className="mono">{room}</span> 个
      </>
    );
  }

  const renderChildren = (tree: FolderTree, depth: number): ReactNode[] =>
    tree.children.flatMap((child) => [
      <div
        key={child.path}
        className={`as-folder is-child${folder === child.path && !query ? ' is-active' : ''}`}
        role="button"
        tabIndex={0}
        style={depth > 1 ? { paddingLeft: 30 + (depth - 1) * 14 } : undefined}
        onClick={() => openFolder(child.path)}
        onKeyDown={pressEnter(() => openFolder(child.path))}
      >
        <span className="nm">{child.name}</span>
        <span className="ct">{fmtNum(child.count)}</span>
      </div>,
      // 更深的子文件夹，点到哪层展开到哪层
      ...(folder && isUnder(child.path, folder) ? renderChildren(child, depth + 1) : []),
    ]);

  return (
    <Dialog className="dialog-wide" label="资产库" odId="dialog-assets" onClose={closeAssets}>
      <div className="dialog-head as-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id="asTitle">{titles[mode][0]}</h2>
          <span className="meta" id="asSub">
            {titles[mode][1]}
          </span>
        </div>
        <label className="as-search">
          <Icon name="search" className="icon-sm" />
          <input className="input" id="asSearch" type="search" placeholder="按文件名搜索全部导入过的文件夹" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={closeAssets}>
          <Icon name="x" />
        </button>
      </div>
      <div className="as-body">
        <nav className="as-side" id="asSide" aria-label="导入的文件夹">
          <div className="panel-title" style={{ padding: '0 8px 6px' }}>
            导入的文件夹
          </div>
          {roots.map((root) => (
            <Fragment key={root}>
              <div
                className={`as-folder${folder === root && !query ? ' is-active' : ''}`}
                role="button"
                tabIndex={0}
                title={root}
                onClick={() => openFolder(root)}
                onKeyDown={pressEnter(() => openFolder(root))}
              >
                <Icon name="folder" className="icon-sm" />
                <span className="nm mono">{root}</span>
                <span className="ct">{scanning[root] ? <span className="spinner" style={{ width: 11, height: 11 }} /> : trees[root] ? fmtNum(trees[root].count) : ''}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm more"
                  aria-label="文件夹操作"
                  onClick={(e) => {
                    e.stopPropagation();
                    showMenu(e.currentTarget, [
                      { note: root },
                      // 文件夹里刚加了图、还没过自动重扫的几秒时，手动扫一遍
                      { label: '重新扫描', icon: 'retry', onClick: () => void useAssetStore.getState().rescan(root) },
                      { label: '从资产库移除', icon: 'x', danger: true, onClick: () => void removeRoot(root) },
                    ]);
                  }}
                >
                  <Icon name="more" />
                </button>
              </div>
              {trees[root] && renderChildren(trees[root], 1)}
            </Fragment>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" id="asImport" style={{ margin: '10px 8px 0' }} onClick={() => setImporting(true)}>
            <Icon name="folder-plus" />
            导入文件夹
          </button>
          <p className="hint" style={{ padding: '8px 8px 0' }}>
            只记路径，不复制文件。移除文件夹也不会动你电脑上的图。
          </p>
        </nav>
        <section className="as-main">
          <div className="as-crumb row-between">
            <span id="asCrumb" className="mono meta">
              {crumb}
            </span>
            <span className="row as-tools">
              <span className="meta" id="asCount">
                {count}
              </span>
              <select className="select select-sm" id="asSort" aria-label="排序" value={sort} onChange={(e) => useAssetStore.getState().setSort(e.target.value as AssetSort)}>
                {ASSET_SORTS.map((value) => (
                  <option key={value} value={value}>
                    {ASSET_SORT_LABELS[value]}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div
            className="as-grid"
            id="asGrid"
            ref={grid}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (!query && files && limit < files.length && el.scrollTop + el.clientHeight > el.scrollHeight - 240) setLimit((n) => n + PAGE);
            }}
          >
            {body}
          </div>
        </section>
      </div>
      <div className="dialog-foot as-foot">
        <span className="meta grow" id="asSel">
          {foot}
        </span>
        <button type="button" className="btn btn-secondary" onClick={closeAssets}>
          取消
        </button>
        {mode === 'slots' && (
          <button
            type="button"
            className="btn btn-primary"
            id="asConfirm"
            disabled={!selected.length}
            onClick={() => {
              closeAssets();
              if (node) void useCanvasStore.getState().place(node.id, selected.map((f) => ({ path: f.path, name: f.name, mtime: f.mtime })));
            }}
          >
            {selected.length ? `放进槽位（${selected.length}）` : '放进槽位'}
          </button>
        )}
      </div>
      {importing && <ImportFolder onClose={() => setImporting(false)} />}
      {zoomed && <ZoomView key={zoomed.path} src={assetFileUrl(zoomed.path, zoomed.mtime)} title={zoomed.name} meta={fmtSize(zoomed.size)} onClose={() => setZoomed(null)} />}
    </Dialog>
  );
}

// 导入文件夹：可以直接填路径，也可以点「选择…」弹系统窗口
function ImportFolder({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState('');

  const browse = async () => {
    try {
      const { path: picked } = await api<{ path: string | null }>('/assets/pick-folder', { method: 'POST', body: { start: path || undefined } });
      if (picked) setPath(picked);
    } catch (err) {
      toast((err as Error).message, { tone: 'danger' });
    }
  };

  const submit = async () => {
    const value = path.trim();
    if (!value) return;
    onClose();
    try {
      await useAssetStore.getState().addFolder(value);
    } catch (err) {
      toast((err as Error).message, { tone: 'danger', ms: 4500 });
    }
  };

  return (
    <Dialog label="导入文件夹" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog-head">
          <h2>导入文件夹</h2>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="impPath">文件夹路径</label>
            <div className="input-group">
              <input className="input mono" id="impPath" autoFocus value={path} onChange={(e) => setPath(e.target.value)} />
              <button type="button" className="btn btn-secondary" id="impBrowse" onClick={() => void browse()}>
                <Icon name="folder" />
                选择…
              </button>
            </div>
            <p className="hint">只记下路径，图还放在原处。子文件夹会一起列出来。</p>
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary">
            导入
          </button>
        </div>
      </form>
    </Dialog>
  );
}
