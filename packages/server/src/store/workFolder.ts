import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readAllCanvases } from './canvases';
import { copyBuiltinPrompts, listPrompts } from './prompts';

export async function initWorkFolder(root: string): Promise<void> {
  for (const dir of ['prompts/.history', 'canvases', '.trash']) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  await copyBuiltinPrompts(root, true);
}

// 设置页上显示的：能不能写进去、里面有几个画布几套提示词。写不写得进去只能真写一个文件试
export async function workFolderStatus(root: string): Promise<{ writable: boolean; canvases: number; prompts: number }> {
  const probe = path.join(root, `.write-test-${randomUUID()}`);
  let writable = true;
  try {
    await fs.writeFile(probe, '');
    await fs.rm(probe, { force: true });
  } catch {
    writable = false;
  }
  const [canvases, prompts] = await Promise.all([readAllCanvases(root).catch(() => []), listPrompts(root).catch(() => [])]);
  return { writable, canvases: canvases.length, prompts: prompts.length };
}
