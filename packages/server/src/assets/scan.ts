import { compareAssetNames, sortAssets, SUPPORTED_IMAGE_EXTENSIONS, type AssetFile, type AssetSort, type FolderTree } from '@media-agent/shared';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../httpError';
import { isInside } from '../paths';

const SUPPORTED = new Set(SUPPORTED_IMAGE_EXTENSIONS);
// 这些格式列出来但灰显「不支持」
const UNSUPPORTED = new Set(['.heic', '.heif', '.gif']);
// 超过 5 秒没扫过才重新扫
const RESCAN_AFTER = 5000;
export const SEARCH_LIMIT = 200;

const extension = (name: string) => path.extname(name).toLowerCase();
export const isSupportedImage = (name: string) => SUPPORTED.has(extension(name));
const isListed = (name: string) => SUPPORTED.has(extension(name)) || UNSUPPORTED.has(extension(name));

async function toAssetFile(file: string): Promise<AssetFile | null> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  const name = path.basename(file);
  return { path: file, name, size: stat.size, mtime: stat.mtimeMs, supported: isSupportedImage(name) };
}

type RootIndex = { scannedAt: number; tree: FolderTree; files: { path: string; name: string }[] };
const indexes = new Map<string, RootIndex>();

// 扫一遍根文件夹：子文件夹树，加上所有图片的路径（搜索用）。读不了的子文件夹跳过
async function indexRoot(root: string, refresh: boolean): Promise<RootIndex> {
  const cached = indexes.get(root);
  if (cached && !refresh && Date.now() - cached.scannedAt < RESCAN_AFTER) return cached;
  const files: RootIndex['files'] = [];
  const walk = async (dir: string): Promise<FolderTree> => {
    const entries: Dirent[] = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    let count = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !isListed(entry.name)) continue;
      files.push({ path: path.join(dir, entry.name), name: entry.name });
      count += 1;
    }
    const folders = entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort(compareAssetNames);
    const children = await Promise.all(folders.map((folder) => walk(folder.path)));
    count += children.reduce((sum, child) => sum + child.count, 0);
    return { path: dir, name: path.basename(dir) || dir, count, children };
  };
  const index = { scannedAt: Date.now(), tree: await walk(root), files };
  indexes.set(root, index);
  return index;
}

export async function folderTree(root: string, refresh: boolean): Promise<FolderTree> {
  return (await indexRoot(root, refresh)).tree;
}

const STAT_BATCH = 32;

// 一批一批查文件的大小和修改时间，查不到的（刚删掉的）不要
async function statFiles(paths: string[]): Promise<AssetFile[]> {
  const found: (AssetFile | null)[] = [];
  for (let i = 0; i < paths.length; i += STAT_BATCH) {
    found.push(...(await Promise.all(paths.slice(i, i + STAT_BATCH).map(toAssetFile))));
  }
  return found.filter((f): f is AssetFile => f !== null);
}

// 读文件夹出错时给人看的原因
function unreadable(folder: string, err: NodeJS.ErrnoException): HttpError {
  if (err.code === 'ENOENT') return new HttpError(404, `找不到这个文件夹：${folder}`);
  if (err.code === 'EPERM' || err.code === 'EACCES') {
    return new HttpError(403, `系统拒绝访问（${err.code}）。可能是同步盘还没把它下载到这台电脑，或者当前账户没有读取权限。`);
  }
  return new HttpError(500, `读不了这个文件夹：${err.message}`);
}

const listings = new Map<string, { scannedAt: number; files: AssetFile[] }>();

// 一个文件夹里（含子文件夹）的全部图片，按文件名排序，网格再按选的排法在浏览器里排。root 是它所在的导入文件夹，文件清单从 root 的索引里取
export async function listFolder(root: string, folder: string, refresh: boolean): Promise<AssetFile[]> {
  const cached = listings.get(folder);
  if (cached && !refresh && Date.now() - cached.scannedAt < RESCAN_AFTER) return cached.files;
  await fs.readdir(folder).catch((err: NodeJS.ErrnoException) => {
    throw unreadable(folder, err);
  });
  const inside = (await indexRoot(root, refresh)).files.filter((file) => isInside(folder, file.path));
  const files = (await statFiles(inside.map((file) => file.path))).sort(compareAssetNames);
  listings.set(folder, { scannedAt: Date.now(), files });
  return files;
}

// 按文件名搜全部导入的文件夹：不区分大小写，子串匹配，按选的排法取前 200 条。
// 按修改时间排的要先查到每个搜到的文件的修改时间；按文件名排的先排好，只查前 200 个。不带排法是按文件名
export async function searchAssets(roots: string[], query: string, sort: AssetSort = 'name-asc'): Promise<AssetFile[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches = new Map<string, { path: string; name: string }>();
  for (const root of roots) {
    for (const file of (await indexRoot(root, false)).files) {
      if (file.name.toLowerCase().includes(needle)) matches.set(file.path, file);
    }
  }
  const byName = [...matches.values()].sort(compareAssetNames);
  if (sort === 'name-desc') byName.reverse();
  const paths = sort.startsWith('time') ? [...matches.keys()] : byName.slice(0, SEARCH_LIMIT).map((file) => file.path);
  return sortAssets(await statFiles(paths), sort).slice(0, SEARCH_LIMIT);
}
