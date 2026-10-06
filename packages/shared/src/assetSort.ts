import type { AssetFile, AssetSort } from './types';

// 资产库的排法，见 docs/dev-plan.md 6.3：默认修改时间新的在前；修改时间一样的按文件名，文件名里的数字按大小比
export const ASSET_SORT_LABELS: Record<AssetSort, string> = {
  'time-desc': '修改时间，新的在前',
  'time-asc': '修改时间，旧的在前',
  'name-asc': '文件名，A 到 Z',
  'name-desc': '文件名，Z 到 A',
};
export const ASSET_SORTS = Object.keys(ASSET_SORT_LABELS) as AssetSort[];
export const DEFAULT_ASSET_SORT: AssetSort = 'time-desc';

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

// 文件名一样的（不同文件夹里）再按路径
export const compareAssetNames = (a: { name: string; path: string }, b: { name: string; path: string }) =>
  collator.compare(a.name, b.name) || collator.compare(a.path, b.path);

// 排好放进新数组，原来的不动
export function sortAssets<T extends Pick<AssetFile, 'name' | 'path' | 'mtime'>>(files: T[], sort: AssetSort): T[] {
  const sign = sort.endsWith('desc') ? -1 : 1;
  const compare = sort.startsWith('time') ? (a: T, b: T) => sign * (a.mtime - b.mtime) || compareAssetNames(a, b) : (a: T, b: T) => sign * compareAssetNames(a, b);
  return [...files].sort(compare);
}
