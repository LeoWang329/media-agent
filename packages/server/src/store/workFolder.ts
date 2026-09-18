import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAllCanvases } from './canvases';
import { BUILTIN_PROMPTS, listPrompts } from './prompts';

// 自带的五套系统提示词只维护 docs/prompts/ 里这五份：参考模式、图当首帧、纯文字、首尾帧、尾帧图
const builtinFile = (name: string) => fileURLToPath(new URL(`../../../../docs/prompts/${name}.md`, import.meta.url));

export async function initWorkFolder(root: string): Promise<void> {
  for (const dir of ['prompts/.history', 'canvases', '.trash']) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  // 已经有同名的就不覆盖，用户改过的那份留着
  for (const name of BUILTIN_PROMPTS) {
    try {
      await fs.copyFile(builtinFile(name), path.join(root, 'prompts', `${name}.md`), fs.constants.COPYFILE_EXCL);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
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
