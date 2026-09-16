import type { AssetFile, FolderTree } from '@media-agent/shared';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ASSET_DRAG_TYPE, assetThumbUrl } from '../api';
import { useAssetStore } from '../store/assetStore';
import { useCanvasStore } from '../store/canvasStore';
import { ContextMenu } from './ContextMenu';

const MIN_TILE_WIDTH = 84;
const ROW_HEIGHT = 104;

const baseName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;

export function AssetLibrary() {
  const roots = useAssetStore((s) => s.roots);
  const folder = useAssetStore((s) => s.folder);
  const files = useAssetStore((s) => s.files);
  const query = useAssetStore((s) => s.query);
  const results = useAssetStore((s) => s.results);
  const pathInput = useAssetStore((s) => s.pathInput);
  const error = useAssetStore((s) => s.error);
  const { load, pickFolder, addFolder, setQuery, search, refresh } = useAssetStore.getState();
  const [typedPath, setTypedPath] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  // 搜索框停手 300 毫秒再搜
  useEffect(() => {
    const timer = setTimeout(() => void search(), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <div className="asset-library">
      <div className="asset-toolbar">
        <input type="search" aria-label="搜索资产库" placeholder="按文件名搜" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" onClick={() => void pickFolder()}>导入文件夹</button>
      </div>
      {pathInput && (
        <form
          className="asset-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (typedPath.trim()) void addFolder(typedPath.trim());
          }}
        >
          <input aria-label="要导入的文件夹路径" placeholder="粘贴文件夹的完整路径" value={typedPath} onChange={(e) => setTypedPath(e.target.value)} />
          <button type="submit">导入</button>
        </form>
      )}
      {error && <p className="asset-error">{error}</p>}
      {roots.length > 0 && (
        <div className="folder-tree">
          {roots.map((root) => (
            <FolderNode key={root} root={root} path={root} name={baseName(root)} depth={0} />
          ))}
        </div>
      )}
      <div className="asset-grid-head">
        <span title={results ? undefined : (folder ?? undefined)}>
          {results ? `搜索结果 ${results.length} 个` : folder ? baseName(folder) : '还没有导入文件夹'}
        </span>
        <button type="button" disabled={!folder && !results} onClick={() => void refresh()}>刷新</button>
      </div>
      <AssetGrid key={results ? `search:${query}` : (folder ?? '')} files={results ?? files} />
    </div>
  );
}

function FolderNode({ root, path, name, depth }: { root: string; path: string; name: string; depth: number }) {
  const expanded = useAssetStore((s) => Boolean(s.expanded[path]));
  const current = useAssetStore((s) => s.folder === path && !s.results);
  const tree = useAssetStore((s) => s.trees[root]);
  const { toggleExpanded, openFolder, removeFolder } = useAssetStore.getState();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const node = tree && findFolder(tree, path);
  // 根文件夹的树还没读过时不知道有没有子文件夹，先显示展开按钮
  const children = node?.children ?? [];
  const canExpand = !node || children.length > 0;

  return (
    <>
      <div
        className={`folder-row${current ? ' current' : ''}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        onContextMenu={(e) => {
          if (depth > 0) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button type="button" className="folder-toggle" aria-label={expanded ? `收起 ${name}` : `展开 ${name}`} disabled={!canExpand} onClick={() => void toggleExpanded(path, root)}>
          {canExpand ? (expanded ? '▾' : '▸') : ''}
        </button>
        <button type="button" className="folder-name" title={path} onClick={() => void openFolder(path)}>
          {name}
        </button>
      </div>
      {expanded && children.map((child) => <FolderNode key={child.path} root={root} path={child.path} name={child.name} depth={depth + 1} />)}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={[{ label: '移除（不动文件）', onSelect: () => void removeFolder(root) }]} onClose={() => setMenu(null)} />
      )}
    </>
  );
}

function findFolder(tree: FolderTree, path: string): FolderTree | undefined {
  if (tree.path === path) return tree;
  for (const child of tree.children) {
    const found = findFolder(child, path);
    if (found) return found;
  }
  return undefined;
}

// 只渲染看得见的几行，文件夹里图多也不卡
function AssetGrid({ files }: { files: AssetFile[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor(size.width / MIN_TILE_WIDTH));
  const tileWidth = size.width / columns;
  const rows = Math.ceil(files.length / columns);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + size.height) / ROW_HEIGHT) + 2);

  return (
    <div className="asset-grid" ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ position: 'relative', height: rows * ROW_HEIGHT }}>
        {files.slice(firstRow * columns, lastRow * columns).map((file, i) => {
          const index = firstRow * columns + i;
          const style = { left: (index % columns) * tileWidth, top: Math.floor(index / columns) * ROW_HEIGHT, width: tileWidth, height: ROW_HEIGHT };
          return <AssetTile key={file.path} file={file} style={style} />;
        })}
      </div>
    </div>
  );
}

function AssetTile({ file, style }: { file: AssetFile; style: CSSProperties }) {
  const selected = useAssetStore((s) => s.selected.includes(file.path));
  const { select } = useAssetStore.getState();

  // 点中了某个槽位就替换它，没点就放进下一个空位
  const place = () => {
    const { selectedId, pickedSlot, placeImages } = useCanvasStore.getState();
    if (selectedId) void placeImages(selectedId, [file.path], pickedSlot ?? undefined);
    else useCanvasStore.setState({ error: '先在画布上点一个节点，再往槽位里放图' });
  };

  return (
    <div
      className={`asset-tile${selected ? ' selected' : ''}${file.supported ? '' : ' unsupported'}`}
      style={style}
      data-testid="asset-tile"
      title={file.path}
      draggable={file.supported}
      onClick={(e) => file.supported && select(file.path, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single')}
      onDoubleClick={() => file.supported && place()}
      onDragStart={(e) => {
        const current = useAssetStore.getState().selected;
        if (!current.includes(file.path)) select(file.path, 'single');
        e.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(current.includes(file.path) ? current : [file.path]));
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <div className="asset-thumb">
        {file.supported ? <img src={assetThumbUrl(file.path, file.mtime)} alt="" loading="lazy" draggable={false} /> : <span>不支持</span>}
      </div>
      <div className="asset-name">{file.name}</div>
    </div>
  );
}
