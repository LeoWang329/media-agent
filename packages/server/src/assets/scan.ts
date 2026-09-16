import type { AssetFile, FolderTree } from '@media-agent/shared';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../httpError';

const SUPPORTED = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// 这些格式列出来但灰显「不支持」
const UNSUPPORTED = new Set(['.heic', '.heif', '.gif']);
// 超过 5 秒没扫过才重新扫
const RESCAN_AFTER = 5000;
export const SEARCH_LIMIT = 200;

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const byName = (a: { name: string; path: string }, b: { name: string; path: string }) =>
  collator.compare(a.name, b.name) || collator.compare(a.path, b.path);

const extension = (name: string) => path.extname(name).toLowerCase();
export const isSupportedImage = (name: string) => SUPPORTED.has(extension(name));
const isListed = (name: string) => SUPPORTED.has(extension(name)) || UNSUPPORTED.has(extension(name));

async function toAssetFile(file: string): Promise<AssetFile | null> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  const name = path.basename(file);
  return { path: file, name, size: stat.size, mtime: stat.mtimeMs, supported: isSupportedImage(name) };
}

const listings = new Map<string, { scannedAt: number; files: AssetFile[] }>();

// 一个文件夹下直接放着的图片，按文件名排序
export async function listFolder(folder: string, refresh: boolean): Promise<AssetFile[]> {
  const cached = listings.get(folder);
  if (cached && !refresh && Date.now() - cached.scannedAt < RESCAN_AFTER) return cached.files;
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    throw err.code === 'ENOENT' ? new HttpError(404, `找不到这个文件夹：${folder}`) : err;
  });
  const found = await Promise.all(entries.filter((e) => e.isFile() && isListed(e.name)).map((e) => toAssetFile(path.join(folder, e.name))));
  const files = found.filter((f): f is AssetFile => f !== null).sort(byName);
  listings.set(folder, { scannedAt: Date.now(), files });
  return files;
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
    for (const entry of entries) {
      if (entry.isFile() && isListed(entry.name)) files.push({ path: path.join(dir, entry.name), name: entry.name });
    }
    const folders = entries.filter((e) => e.isDirectory()).sort((a, b) => collator.compare(a.name, b.name));
    return { path: dir, name: path.basename(dir) || dir, children: await Promise.all(folders.map((e) => walk(path.join(dir, e.name)))) };
  };
  const index = { scannedAt: Date.now(), tree: await walk(root), files };
  indexes.set(root, index);
  return index;
}

export async function folderTree(root: string, refresh: boolean): Promise<FolderTree> {
  return (await indexRoot(root, refresh)).tree;
}

// 按文件名搜全部导入的文件夹：不区分大小写，子串匹配，最多 200 条
export async function searchAssets(roots: string[], query: string): Promise<AssetFile[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches = new Map<string, { path: string; name: string }>();
  for (const root of roots) {
    for (const file of (await indexRoot(root, false)).files) {
      if (file.name.toLowerCase().includes(needle)) matches.set(file.path, file);
    }
  }
  const top = [...matches.values()].sort(byName).slice(0, SEARCH_LIMIT);
  return (await Promise.all(top.map((f) => toAssetFile(f.path)))).filter((f): f is AssetFile => f !== null);
}
