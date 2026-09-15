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

// 先写临时文件再改名，写到一半断电也不会留下半个文件
export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

export function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  return writeTextAtomic(file, JSON.stringify(data, null, 2));
}

export const trashName = (kind: string, name: string) => `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}-${name}`;
