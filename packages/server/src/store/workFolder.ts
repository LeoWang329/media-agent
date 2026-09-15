import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 默认系统提示词只维护 docs/prompts/default.md 这一份
const DEFAULT_PROMPT = fileURLToPath(new URL('../../../../docs/prompts/default.md', import.meta.url));

export async function initWorkFolder(root: string): Promise<void> {
  for (const dir of ['prompts/.history', 'canvases', '.trash']) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  try {
    await fs.copyFile(DEFAULT_PROMPT, path.join(root, 'prompts', 'default.md'), fs.constants.COPYFILE_EXCL);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}
