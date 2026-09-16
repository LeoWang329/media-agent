import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_PROMPTS } from './prompts';

// 三套自带的系统提示词只维护 docs/prompts/ 里这三份：参考模式、图当首帧、纯文字
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
