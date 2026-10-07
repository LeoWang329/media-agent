import { COLLAGE_CELL_SIZES, DEFAULT_COLLAGE_CELL, sortAssets, type AssetFile, type Config, type ImageRecord } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { api, assetThumbUrl, COLLAGE_DRAG_TYPE } from '../api';
import { flattenTree, rootOf, useAssetStore } from '../store/assetStore';
import { useCanvasStore } from '../store/canvasStore';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';
import { useOverlays } from './overlays';

type Made = { path: string; folder: string; width: number; height: number; inLibrary: boolean; image?: ImageRecord };

const PICK_OTHER = '<pick-other>'; // 下拉框里「选别的文件夹…」那一项，不会和真实路径重名
const ROW = ['第一排', '第二排', '第三排'];
const COL = ['左边', '中间', '右边'];

export function CollageDialog() {
  const open = useOverlays((s) => s.collage);
  return open ? <Collage /> : null;
}

const close = () => useOverlays.setState({ collage: false });

// 拼图：几张图拼成一张宫格图，只占一个槽位
function Collage() {
  const node = useCanvasStore((s) => (s.selectedId ? s.nodes[s.selectedId] : undefined));
  const canvasId = useCanvasStore((s) => s.canvasId);
  const { roots, trees } = useAssetStore();
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [side, setSide] = useState(DEFAULT_COLLAGE_CELL);
  const [numbered, setNumbered] = useState(true);
  const [cells, setCells] = useState<(AssetFile | null)[]>([null, null, null, null]);
  const [active, setActive] = useState(0);
  const [dest, setDest] = useState('');
  const [outside, setOutside] = useState<string[]>([]); // 不在资产库里、但能存的文件夹：上次存过的、刚在窗口里选的
  const [name, setName] = useState('分镜-新-2x2.jpg');
  const [pickFolder, setPickFolder] = useState('');
  const [pickFiles, setPickFiles] = useState<AssetFile[]>([]);
  const [dragFrom, setDragFrom] = useState<{ cell: number } | { file: AssetFile } | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // 存到哪：默认上次存过的文件夹，没有就是资产库第一个文件夹
  useEffect(() => {
    void (async () => {
      await useAssetStore.getState().load();
      const { roots: loaded, folder } = useAssetStore.getState();
      setPickFolder(folder ?? loaded[0] ?? '');
      const config = await api<Config>('/config').catch(() => null);
      const last = config?.lastCollageFolder;
      if (last && !rootOf(loaded, last)) setOutside([last]);
      setDest(last ?? loaded[0] ?? '');
    })();
  }, []);

  useEffect(() => {
    if (!pickFolder) return setPickFiles([]);
    let dropped = false;
    api<AssetFile[]>(`/assets/list?${new URLSearchParams({ folder: pickFolder })}`).then(
      (files) => !dropped && setPickFiles(sortAssets(files.filter((f) => f.supported && f.kind === 'image'), useAssetStore.getState().sort)),
      (err: Error) => !dropped && (setPickFiles([]), toast(err.message, { tone: 'danger' })),
    );
    return () => {
      dropped = true;
    };
  }, [pickFolder]);

  // 导入的文件夹互相包含时，里面那个会列两遍
  const libraryFolders = [...new Set(roots.flatMap((root) => (trees[root] ? flattenTree(trees[root]).map((f) => f.path) : [root])))];
  const inLibrary = Boolean(dest && rootOf(roots, dest));
  const count = rows * cols;
  const one = rows === 1 && cols === 1;
  const filled = cells.filter(Boolean).length;
  const bad = one || !filled || !dest;

  const pos = (i: number) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (rows === 2 && cols === 2) return (r ? '下' : '上') + (c ? '右' : '左');
    const rowName = rows === 1 ? '' : ROW[r];
    const colName = cols === 1 ? '' : cols === 2 ? ['左边', '右边'][c] : COL[c];
    return rowName + colName || '整张';
  };

  const resize = (nextRows: number, nextCols: number) => {
    const r = Math.min(3, Math.max(1, nextRows));
    const c = Math.min(3, Math.max(1, nextCols));
    setRows(r);
    setCols(c);
    setCells((list) => Array.from({ length: r * c }, (_, i) => list[i] ?? null));
    setActive((a) => (a >= r * c ? 0 : a));
    setName((n) => n.replace(/\d+x\d+/, `${r}x${c}`));
  };

  const put = (file: AssetFile) => {
    const next = cells.map((cell, i) => (i === active ? file : cell));
    setCells(next);
    const empty = next.indexOf(null);
    if (empty >= 0) setActive(empty);
  };

  const chooseDest = async (value: string) => {
    if (value !== PICK_OTHER) return setDest(value);
    try {
      const { path } = await api<{ path: string | null }>('/assets/pick-folder', { method: 'POST', body: { start: dest || undefined } });
      if (!path) return;
      if (!rootOf(roots, path)) setOutside((list) => (list.includes(path) ? list : [...list, path]));
      setDest(path);
    } catch (err) {
      toast(`${(err as Error).message}。可以先把要存的文件夹导入资产库，再从这里选`, { tone: 'danger', ms: 4500 });
    }
  };

  const save = async (toSlot: boolean) => {
    setSaving(true);
    try {
      const made = await trackWrite(
        api<Made>('/assets/collage', {
          method: 'POST',
          body: {
            files: cells.map((file) => file?.path ?? null),
            rows,
            columns: cols,
            cell: side,
            numbers: numbered,
            folder: dest,
            name,
            ...(toSlot && node && { canvasId, nodeId: node.id }),
          },
        }),
      );
      close();
      let slotText = '';
      if (toSlot && node && made.image) {
        const saved = await useCanvasStore.getState().addImages(node.id, [made.image]);
        const index = useCanvasStore.getState().nodes[node.id]?.slots.indexOf(made.image.id) ?? -1;
        slotText = index >= 0 ? `，放进了 ${index + 1} 号槽位` : saved ? '，槽位满了，没放进去' : '，没放进槽位';
      }
      if (made.inLibrary) {
        void useAssetStore.getState().refreshFolder(made.folder);
        toast(`拼图存到了 ${made.path}${slotText}，资产库里已经能看到`, { ms: 4500 });
      } else {
        // 存到了资产库以外的文件夹：顺手问一句要不要导入
        const folder = made.folder;
        toast(`拼图存到了 ${made.path}${slotText}。这个文件夹不在资产库里`, { ms: 6000, action: '导入资产库', onAction: () => void useAssetStore.getState().addFolder(folder).catch((err: Error) => toast(err.message, { tone: 'danger', ms: 4500 })) });
      }
    } catch (err) {
      toast((err as Error).message, { tone: 'danger', ms: 4500 });
    } finally {
      setSaving(false);
    }
  };

  const stepper = (label: string, value: number, change: (n: number) => void) => (
    <div className="row-between">
      <span className="label">{label}</span>
      <div className="stepper">
        <button type="button" aria-label={`${label}减一`} disabled={value <= 1} onClick={() => change(value - 1)}>
          −
        </button>
        <output>{value}</output>
        <button type="button" aria-label={`${label}加一`} disabled={value >= 3} onClick={() => change(value + 1)}>
          +
        </button>
      </div>
    </div>
  );

  const folderLabel = (path: string) => {
    const root = rootOf(roots, path);
    return root && root !== path ? path.slice(root.length).replace(/^[\\/]+/, '') : path;
  };

  return (
    <Dialog className="dialog-wide" label="拼图" odId="dialog-collage" onClose={close}>
      <div className="dialog-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>拼图</h2>
          <span className="meta">几张图拼成一张宫格图，只占一个槽位</span>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="cl-body">
        <aside className="cl-settings" id="clSettings">
          {stepper('行数', rows, (n) => resize(n, cols))}
          {stepper('列数', cols, (n) => resize(rows, n))}
          {one && (
            <p className="hint is-error" style={{ marginTop: -8 }}>
              1×1 不算拼图，至少要 2 格
            </p>
          )}
          <div className="field">
            <span className="label">每格边长</span>
            <div className="seg">
              {COLLAGE_CELL_SIZES.map((size) => (
                <button key={size} type="button" aria-pressed={side === size} onClick={() => setSide(size)}>
                  {size}
                </button>
              ))}
            </div>
            <p className="hint">
              格子是正方形，整张输出{' '}
              <span className="mono">
                {cols * side}×{rows * side}
              </span>
            </p>
          </div>
          <div className="field">
            <label className="switch">
              <input type="checkbox" id="clNum" checked={numbered} onChange={(e) => setNumbered(e.target.checked)} />
              <span className="track" />
              每格左上角加编号
            </label>
            <p className="hint">
              {numbered
                ? '加了编号时，在提示词里用「2 号格」这样的说法指某一格，并提醒视频画面里不要出现这些数字。'
                : `不加编号时，在提示词里用「${pos(0)}」「${pos(Math.min(count - 1, cols + 1))}」这样的说法指某一格。`}
            </p>
          </div>
          <div className="field">
            <label htmlFor="clDest">存到</label>
            <select className="select" id="clDest" value={dest} onChange={(e) => void chooseDest(e.target.value)}>
              {!dest && <option value="">（还没有能存的文件夹）</option>}
              {libraryFolders.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
              {outside
                .filter((path) => !libraryFolders.includes(path))
                .map((path) => (
                  <option key={path} value={path}>
                    {path}（不在资产库里）
                  </option>
                ))}
              <option value={PICK_OTHER}>选别的文件夹…</option>
            </select>
            <p className="hint">{inLibrary ? '这个文件夹在资产库里，存好马上能看到。' : '这个文件夹没导入资产库，存好后在库里看不到。'}</p>
          </div>
          <div className="field">
            <label htmlFor="clName">文件名</label>
            <input className="input mono" id="clName" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </aside>
        <section className="cl-stage">
          <div
            className="cl-board"
            id="clBoard"
            style={{ gridTemplateColumns: `repeat(${cols},1fr)`, gridTemplateRows: `repeat(${rows},1fr)`, aspectRatio: `${cols} / ${rows}` }}
          >
            {cells.map((file, i) => (
              <div
                key={i}
                className={`cl-cell${i === active ? ' is-active' : ''}${dropAt === i ? ' is-drop' : ''}`}
                data-cell={i}
                data-testid="collage-cell"
                draggable={Boolean(file)}
                title={pos(i)}
                onClick={() => setActive(i)}
                onDragStart={(e) => {
                  setDragFrom({ cell: i });
                  e.dataTransfer.setData(COLLAGE_DRAG_TYPE, 'cell'); // 自定义类型：落在文件名框里也不会插进文字
                }}
                onDragOver={(e) => {
                  if (!dragFrom) return;
                  e.preventDefault();
                  setDropAt(i);
                }}
                onDragLeave={() => setDropAt((at) => (at === i ? null : at))}
                onDrop={(e) => {
                  if (!dragFrom) return;
                  e.preventDefault();
                  setCells((list) => {
                    const next = [...list];
                    if ('file' in dragFrom) next[i] = dragFrom.file;
                    else [next[i], next[dragFrom.cell]] = [list[dragFrom.cell], list[i]];
                    return next;
                  });
                  setActive(i);
                  setDragFrom(null);
                  setDropAt(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDropAt(null);
                }}
              >
                {file ? (
                  <img src={assetThumbUrl(file.path, file.mtime)} alt={file.name} />
                ) : (
                  <div className="cl-empty">
                    {pos(i)}
                    <br />
                    点右边的图放进来
                  </div>
                )}
                {numbered && <span className="cl-no">{i + 1}</span>}
                {file && (
                  <button
                    type="button"
                    className="cl-x"
                    aria-label="清空这格"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCells((list) => list.map((cell, j) => (j === i ? null : cell)));
                      setActive(i);
                    }}
                  >
                    <Icon name="x" className="icon-sm" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="meta cl-tip" id="clTip">
            选中的格子（{pos(active)}）会放进你点的图；格子之间拖动可以互换位置。图完整放进格子，空的地方是白的。
          </p>
        </section>
        <aside className="cl-pick" id="clPick">
          <select className="select select-sm" id="clPickFolder" aria-label="从哪个文件夹挑图" style={{ width: '100%' }} value={pickFolder} onChange={(e) => setPickFolder(e.target.value)}>
            {libraryFolders.map((path) => (
              <option key={path} value={path}>
                {folderLabel(path)}
              </option>
            ))}
          </select>
          <div className="cl-pick-grid">
            {pickFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                draggable
                title={file.name}
                onClick={() => put(file)}
                onDragStart={(e) => {
                  setDragFrom({ file });
                  e.dataTransfer.setData(COLLAGE_DRAG_TYPE, 'pick');
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDropAt(null);
                }}
              >
                <img className="im" src={assetThumbUrl(file.path, file.mtime)} alt={file.name} loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        </aside>
      </div>
      <div className="dialog-foot">
        <span className="meta grow" id="clFoot">
          输出{' '}
          <span className="mono">
            {cols * side}×{rows * side}
          </span>{' '}
          JPG · {count} 格，已放 {filled} 张
        </span>
        <button type="button" className="btn btn-secondary" onClick={close}>
          取消
        </button>
        <button type="button" className="btn btn-secondary" id="clSave" disabled={bad || saving} onClick={() => void save(false)}>
          只保存
        </button>
        <button type="button" className="btn btn-primary" id="clSaveSlot" disabled={bad || saving || !node} onClick={() => void save(true)}>
          保存并放进槽位
        </button>
      </div>
    </Dialog>
  );
}
