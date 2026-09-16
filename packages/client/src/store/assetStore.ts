import type { AssetFile, FolderTree } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';

type AssetState = {
  roots: string[];
  trees: Record<string, FolderTree>; // 展开过的根文件夹的子文件夹树
  expanded: Record<string, boolean>;
  folder: string | null; // 网格里正在看的文件夹
  files: AssetFile[];
  query: string;
  results: AssetFile[] | null; // 搜索结果；没在搜时为 null
  selected: string[]; // 选中的图，按选中的先后
  anchor: string | null; // Shift 连选的起点
  pathInput: boolean; // 弹不出系统窗口时改用路径输入框
  collage: boolean; // 拼图面板开着没有
  error: string;

  load: () => Promise<void>;
  pickFolder: () => Promise<void>;
  addFolder: (path: string) => Promise<void>;
  removeFolder: (root: string) => Promise<void>;
  toggleExpanded: (path: string, root: string) => Promise<void>;
  openFolder: (folder: string, refresh?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  setQuery: (query: string) => void;
  search: () => Promise<void>;
  select: (path: string, mode: 'single' | 'toggle' | 'range') => void;
  openCollage: () => void;
  closeCollage: () => void;
};

const folderQuery = (folder: string, refresh: boolean) => new URLSearchParams({ folder, ...(refresh && { refresh: '1' }) });

// folder 是 root 本身或它下面的子文件夹
export const isUnder = (root: string, folder: string) => folder === root || folder.startsWith(`${root}\\`) || folder.startsWith(`${root}/`);

export const useAssetStore = create<AssetState>((set, get) => {
  const attempt = async (task: () => Promise<void>) => {
    try {
      set({ error: '' });
      await task();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  };

  const loadTree = async (root: string, refresh = false) => {
    const tree = await api<FolderTree>(`/assets/tree?${new URLSearchParams({ root, ...(refresh && { refresh: '1' }) })}`);
    set((s) => ({ trees: { ...s.trees, [root]: tree } }));
  };

  let searchSeq = 0;

  return {
    roots: [],
    trees: {},
    expanded: {},
    folder: null,
    files: [],
    query: '',
    results: null,
    selected: [],
    anchor: null,
    pathInput: false,
    collage: false,
    error: '',

    // 打开画布页时读一次导入过的文件夹；网格默认显示第一个
    load: () =>
      attempt(async () => {
        const roots = await api<string[]>('/assets/folders');
        set({ roots });
        const { folder } = get();
        if (folder && roots.some((root) => isUnder(root, folder))) await get().openFolder(folder);
        else if (roots[0]) await get().openFolder(roots[0]);
        else set({ folder: null, files: [] });
      }),

    pickFolder: () =>
      attempt(async () => {
        try {
          const { path } = await api<{ path: string | null }>('/assets/pick-folder', { method: 'POST' });
          if (path) await get().addFolder(path);
        } catch (err) {
          set({ pathInput: true });
          throw err;
        }
      }),

    addFolder: (path) =>
      attempt(async () => {
        const before = get().roots;
        const roots = await api<string[]>('/assets/folders', { method: 'POST', body: { path } });
        set({ roots, pathInput: false });
        const added = roots.find((root) => !before.includes(root));
        if (added) await get().openFolder(added);
      }),

    removeFolder: (root) =>
      attempt(async () => {
        const roots = await api<string[]>('/assets/folders', { method: 'DELETE', body: { path: root } });
        set({ roots });
        const { folder } = get();
        if (folder && isUnder(root, folder)) {
          if (roots[0]) await get().openFolder(roots[0]);
          else set({ folder: null, files: [] });
        }
      }),

    toggleExpanded: (path, root) =>
      attempt(async () => {
        const open = !get().expanded[path];
        set((s) => ({ expanded: { ...s.expanded, [path]: open } }));
        if (open && !get().trees[root]) await loadTree(root);
      }),

    openFolder: (folder, refresh = false) =>
      attempt(async () => {
        set({ folder, query: '', results: null });
        const files = await api<AssetFile[]>(`/assets/list?${folderQuery(folder, refresh)}`);
        if (get().folder === folder) set({ files });
      }),

    // 「刷新」重新扫当前文件夹和它所在的那棵树
    refresh: () =>
      attempt(async () => {
        const { folder, roots, trees, query } = get();
        if (query.trim()) return get().search();
        if (!folder) return;
        const root = roots.find((r) => isUnder(r, folder));
        await Promise.all([get().openFolder(folder, true), root && trees[root] ? loadTree(root, true) : undefined]);
      }),

    setQuery: (query) => set(query.trim() ? { query } : { query, results: null }),

    // 按搜索框里现在的文字搜；输入框停手一会儿再调
    search: () =>
      attempt(async () => {
        const { query } = get();
        if (!query.trim()) return;
        const seq = ++searchSeq;
        const results = await api<AssetFile[]>(`/assets/search?${new URLSearchParams({ q: query })}`);
        if (seq === searchSeq && get().query === query) set({ results });
      }),

    // 单击只选这一张；Ctrl 加选或取消；Shift 从上次点的那张连选到这张
    select: (path, mode) =>
      set((s) => {
        if (mode === 'toggle') {
          const selected = s.selected.includes(path) ? s.selected.filter((p) => p !== path) : [...s.selected, path];
          return { selected, anchor: path };
        }
        if (mode === 'range' && s.anchor) {
          const list = (s.results ?? s.files).filter((f) => f.supported).map((f) => f.path);
          const from = list.indexOf(s.anchor);
          const to = list.indexOf(path);
          if (from >= 0 && to >= 0) return { selected: list.slice(Math.min(from, to), Math.max(from, to) + 1) };
        }
        return { selected: [path], anchor: path };
      }),

    openCollage: () => set({ collage: true }),
    closeCollage: () => set({ collage: false }),
  };
});
