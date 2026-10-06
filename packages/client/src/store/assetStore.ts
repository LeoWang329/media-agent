import { ASSET_SORTS, DEFAULT_ASSET_SORT, sortAssets, type AssetFile, type AssetSort, type FolderTree } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';

type AssetState = {
  roots: string[];
  trees: Record<string, FolderTree>; // 每个导入文件夹的子文件夹树，带张数
  scanning: Record<string, boolean>; // 正在扫的导入文件夹
  folder: string | null; // 网格里正在看的文件夹
  files: AssetFile[] | null; // null：还在读
  unreadable: string | null; // 读不了这个文件夹时的原因
  query: string;
  results: AssetFile[] | null; // 搜索结果；没在搜时为 null
  sort: AssetSort; // 网格、搜索结果、「@」选图那排、拼图窗口选图那栏都按它排

  load: () => Promise<void>;
  openFolder: (folder: string, refresh?: boolean) => Promise<boolean>; // 读不了时返回 false
  addFolder: (path: string) => Promise<void>;
  removeFolder: (root: string) => Promise<void>;
  rescan: (root: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  setSort: (sort: AssetSort) => void;
  refreshFolder: (folder: string) => Promise<void>; // 拼图存进库里之后，那个文件夹重新扫
};

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

const SORT_KEY = 'pc-asset-sort';

// 排法记在浏览器里，下次打开资产库照上次的
function readSort(): AssetSort {
  try {
    const saved = localStorage.getItem(SORT_KEY) as AssetSort | null;
    return saved && ASSET_SORTS.includes(saved) ? saved : DEFAULT_ASSET_SORT;
  } catch {
    return DEFAULT_ASSET_SORT;
  }
}

// folder 是 root 本身或它下面的子文件夹
export const isUnder = (root: string, folder: string) => {
  const a = root.replace(/[\\/]+$/, '').toLowerCase();
  const b = folder.toLowerCase();
  return b === a || b.startsWith(`${a}\\`) || b.startsWith(`${a}/`);
};

export const rootOf = (roots: string[], folder: string) => roots.find((root) => isUnder(root, folder));

// 树里所有文件夹，根在前、子文件夹按层级往下
export function flattenTree(tree: FolderTree): FolderTree[] {
  return [tree, ...tree.children.flatMap(flattenTree)];
}

export const useAssetStore = create<AssetState>((set, get) => {
  const loadTree = async (root: string, refresh = false) => {
    set((s) => ({ scanning: { ...s.scanning, [root]: true } }));
    try {
      const tree = await api<FolderTree>(`/assets/tree?${new URLSearchParams({ root, ...(refresh && { refresh: '1' }) })}`);
      set((s) => ({ trees: { ...s.trees, [root]: tree } }));
      return tree;
    } finally {
      set((s) => ({ scanning: { ...s.scanning, [root]: false } }));
    }
  };

  let listSeq = 0;
  let searchSeq = 0;

  return {
    roots: [],
    trees: {},
    scanning: {},
    folder: null,
    files: null,
    unreadable: null,
    query: '',
    results: null,
    sort: readSort(),

    // 打开资产库时读一遍导入过的文件夹；网格停在上次看的文件夹，没有就看第一个
    load: async () => {
      try {
        const roots = await api<string[]>('/assets/folders');
        set({ roots });
        await Promise.all(roots.map((root) => loadTree(root).catch(() => undefined)));
        const { folder } = get();
        if (folder && rootOf(roots, folder)) await get().openFolder(folder);
        else if (roots[0]) await get().openFolder(roots[0]);
        else set({ folder: null, files: [], unreadable: null });
      } catch (err) {
        failed(err);
      }
    },

    openFolder: async (folder, refresh = false) => {
      const seq = ++listSeq;
      set({ folder, unreadable: null, ...(get().folder !== folder && { files: null }) });
      try {
        const files = await api<AssetFile[]>(`/assets/list?${new URLSearchParams({ folder, ...(refresh && { refresh: '1' }) })}`);
        if (seq === listSeq) set({ files: sortAssets(files, get().sort) });
        return true;
      } catch (err) {
        if (seq === listSeq) set({ files: [], unreadable: (err as Error).message });
        return false;
      }
    },

    addFolder: async (path) => {
      const before = get().roots;
      const roots = await trackWrite(api<string[]>('/assets/folders', { method: 'POST', body: { path } }));
      const added = roots.find((root) => !before.includes(root)) ?? rootOf(roots, path) ?? path;
      set({ roots, folder: added, files: null, unreadable: null, query: '', results: null });
      const tree = await loadTree(added, true).catch(() => null);
      await get().openFolder(added, true);
      toast(`「${added}」导入好了，${tree?.count ?? get().files?.length ?? 0} 张图`);
    },

    removeFolder: async (root) => {
      try {
        const roots = await trackWrite(api<string[]>('/assets/folders', { method: 'DELETE', body: { path: root } }));
        set((s) => {
          const { [root]: _, ...trees } = s.trees;
          return { roots, trees };
        });
        const { folder } = get();
        if (!folder || isUnder(root, folder)) {
          if (roots[0]) await get().openFolder(roots[0]);
          else set({ folder: null, files: [], unreadable: null });
        }
        toast('已移除，文件都还在原处');
      } catch (err) {
        failed(err);
      }
    },

    rescan: async (root) => {
      try {
        await loadTree(root, true);
        const { folder } = get();
        if (folder && isUnder(root, folder)) await get().openFolder(folder, true);
      } catch (err) {
        failed(err);
      }
    },

    search: async (query) => {
      const q = query.trim();
      set({ query: q });
      if (!q) return set({ results: null });
      const seq = ++searchSeq;
      try {
        const results = await api<AssetFile[]>(`/assets/search?${new URLSearchParams({ q, sort: get().sort })}`);
        if (seq === searchSeq && get().query === q) set({ results });
      } catch (err) {
        failed(err);
      }
    },

    // 文件夹里的图已经全在手上，直接重排；搜索最多 200 条，手上的先重排，再让服务端按新排法重搜
    setSort: (sort) => {
      try {
        localStorage.setItem(SORT_KEY, sort);
      } catch {
        // 存不了就只管这一次
      }
      set((s) => ({ sort, files: s.files && sortAssets(s.files, sort), results: s.results && sortAssets(s.results, sort) }));
      const { query } = get();
      if (query) void get().search(query);
    },

    refreshFolder: async (folder) => {
      const root = rootOf(get().roots, folder);
      if (!root) return;
      await loadTree(root, true).catch(() => undefined);
      // 网格列的是文件夹连子文件夹的图，正在看的文件夹包含存图的文件夹才要重读
      const current = get().folder;
      if (current && isUnder(current, folder)) await get().openFolder(current, true);
    },
  };
});
