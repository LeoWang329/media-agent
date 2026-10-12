import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

const RENAME_RETRIES = [20, 40, 60, 80, 100];
const BUSY = ['EPERM', 'EACCES', 'EBUSY'];

// Windows 上杀毒软件、搜索索引会短暂占住刚写好的文件，这时候改名会失败，等一下再试
export async function renameFile(tmp: string, file: string): Promise<void> {
  for (let i = 0; ; i += 1) {
    try {
      return await fs.rename(tmp, file);
    } catch (err) {
      if (i >= RENAME_RETRIES.length || !BUSY.includes((err as NodeJS.ErrnoException).code ?? '')) throw err;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRIES[i]));
    }
  }
}

// 先写临时文件再改名，写到一半断电也不会留下半个文件。
// 往画布文件夹里写时 createDir 传 false：画布刚被挪进回收站的话直接报错，不在原处重新建出来
export async function writeFileAtomic(file: string, data: string | Uint8Array, createDir = true): Promise<void> {
  if (createDir) await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await renameFile(tmp, file);
}

export function writeJsonAtomic(file: string, data: unknown, createDir = true): Promise<void> {
  return writeFileAtomic(file, JSON.stringify(data, null, 2), createDir);
}

export const trashName = (kind: string, name: string) => `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}-${name}`;
