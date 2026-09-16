import {
  collageLayout,
  COLLAGE_CELL_SIZES,
  COLLAGE_MAX_GRID,
  DEFAULT_COLLAGE_CELL,
  isCollageGrid,
  type Config,
} from '@media-agent/shared';
import { useEffect, useState, type DragEvent } from 'react';
import { api, ASSET_DRAG_TYPE, assetThumbUrl, COLLAGE_DRAG_TYPE } from '../api';
import { useAssetStore } from '../store/assetStore';

type Made = { path: string; folder: string; width: number; height: number; inLibrary: boolean };

const SIDES = Array.from({ length: COLLAGE_MAX_GRID }, (_, i) => i + 1);

// 把几张图拼成一张宫格大图。盖在画布上，左边资产库照样能拖
export function CollageBoard() {
  const { closeCollage, addFolder, openFolder } = useAssetStore.getState();
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [cell, setCell] = useState(DEFAULT_COLLAGE_CELL);
  const [numbers, setNumbers] = useState(false);
  const [files, setFiles] = useState<(string | null)[]>(Array.from({ length: 4 }, () => null));
  const [lastFolder, setLastFolder] = useState('');
  const [folderInput, setFolderInput] = useState<string | null>(null); // 弹不出系统窗口时改成填路径
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  // 上次存到哪：弹窗从那里开始，填路径时也预填上
  useEffect(() => {
    void api<Config>('/config')
      .then((config) => setLastFolder(config.lastCollageFolder ?? ''))
      .catch(() => undefined);
  }, []);

  const size = (next: { rows?: number; columns?: number }) => {
    const grid = { rows, columns, ...next };
    setRows(grid.rows);
    setColumns(grid.columns);
    setFiles((prev) => Array.from({ length: grid.rows * grid.columns }, (_, i) => prev[i] ?? null));
    setSaved('');
  };

  const drop = (e: DragEvent, index: number) => {
    e.preventDefault();
    const assets = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    const from = e.dataTransfer.getData(COLLAGE_DRAG_TYPE);
    setSaved('');
    if (assets) {
      const paths = JSON.parse(assets) as string[];
      setFiles((prev) => prev.map((file, i) => (i >= index && i - index < paths.length ? paths[i - index] : file)));
    } else if (from !== '') {
      // 格子之间拖动：两格换一下
      setFiles((prev) => prev.map((file, i) => (i === index ? prev[Number(from)] : i === Number(from) ? prev[index] : file)));
    }
  };

  const pickFolder = async (): Promise<string | null> => {
    try {
      return (await api<{ path: string | null }>('/assets/pick-folder', { method: 'POST', body: { start: lastFolder } })).path;
    } catch (err) {
      setError((err as Error).message);
      setFolderInput(lastFolder);
      return null;
    }
  };

  const save = async (picked?: string) => {
    setError('');
    setSaved('');
    const folder = picked ?? (await pickFolder());
    if (!folder) return;
    setSaving(true);
    try {
      const made = await api<Made>('/assets/collage', { method: 'POST', body: { files, rows, columns, cell, numbers, folder } });
      setSaved(made.path);
      setFolderInput(null);
      setLastFolder(made.folder);
      if (made.inLibrary) await openFolder(made.folder, true);
      else if (window.confirm(`存好了：${made.path}\n\n这个文件夹不在资产库里，要导入吗？`)) await addFolder(made.folder);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const layout = collageLayout(rows, columns, cell, numbers);
  const ready = isCollageGrid(rows, columns) && files.some(Boolean);

  return (
    <div className="collage-board" role="dialog" aria-label="拼图">
      <div className="picker-head">
        <span>拼图</span>
        <button type="button" onClick={closeCollage}>关闭</button>
      </div>
      <div className="collage-controls">
        <label>
          行数
          <select aria-label="行数" value={rows} onChange={(e) => size({ rows: Number(e.target.value) })}>
            {SIDES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          列数
          <select aria-label="列数" value={columns} onChange={(e) => size({ columns: Number(e.target.value) })}>
            {SIDES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          格子边长
          <select aria-label="格子边长" value={cell} onChange={(e) => setCell(Number(e.target.value))}>
            {COLLAGE_CELL_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" aria-label="加编号" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} />
          加编号
        </label>
        <span className="muted">拼出来 {layout.width}×{layout.height} 像素</span>
      </div>
      <div className="collage-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {files.map((file, index) => (
          <div
            key={index}
            className={`collage-cell${file ? ' filled' : ''}`}
            data-testid="collage-cell"
            title={file ?? undefined}
            draggable={Boolean(file)}
            onDragStart={(e) => {
              e.dataTransfer.setData(COLLAGE_DRAG_TYPE, String(index));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE) || e.dataTransfer.types.includes(COLLAGE_DRAG_TYPE)) e.preventDefault();
            }}
            onDrop={(e) => drop(e, index)}
          >
            {file ? <img src={assetThumbUrl(file, 0)} alt="" draggable={false} /> : <span className="muted">从左边拖图进来</span>}
            {numbers && <span className="collage-number">{index + 1}</span>}
          </div>
        ))}
      </div>
      <div className="collage-foot">
        {error && <span className="asset-error">{error}</span>}
        {saved && <span className="muted">存好了：{saved}</span>}
        {!isCollageGrid(rows, columns) && <span className="muted">至少两格</span>}
        <button type="button" disabled={!ready || saving} onClick={() => void save()}>
          {saving ? '正在拼…' : '保存'}
        </button>
      </div>
      {folderInput !== null && (
        <form
          className="collage-foot"
          onSubmit={(e) => {
            e.preventDefault();
            if (folderInput.trim()) void save(folderInput.trim());
          }}
        >
          <input
            aria-label="存到哪个文件夹"
            placeholder="粘贴文件夹的完整路径"
            value={folderInput}
            onChange={(e) => setFolderInput(e.target.value)}
          />
          <button type="submit" disabled={saving}>存这里</button>
        </form>
      )}
    </div>
  );
}
