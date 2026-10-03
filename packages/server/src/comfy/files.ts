import { downloadFileName, tempFileName, tempFolderName, type JobImage } from '@media-agent/shared';
import fs, { constants } from 'node:fs/promises';
import path from 'node:path';

// 出的图先存工作文件夹 image-temp/当天/，返回相对工作文件夹的路径，用 / 隔开，两台机器都认，见 docs/dev-plan.md 5.20
export async function saveTemp(work: string, data: Uint8Array, seed: number, when = new Date()): Promise<string> {
  const folder = tempFolderName(when);
  const dir = path.join(work, 'image-temp', folder);
  await fs.mkdir(dir, { recursive: true });
  const name = await writeNew(dir, tempFileName(when, seed), (target) => fs.writeFile(target, data, { flag: 'wx' }));
  return `image-temp/${folder}/${name}`;
}

// 下载：复制到选好的文件夹，文件名 <节点标题>-<种子>.png
export async function copyToFolder(source: string, folder: string, title: string, seed: number): Promise<string> {
  const name = await writeNew(folder, downloadFileName(title, seed), (target) => fs.copyFile(source, target, constants.COPYFILE_EXCL));
  return path.join(folder, name);
}

// 重名的换成 -2、-3，写的时候不覆盖已有的文件
async function writeNew(dir: string, name: string, write: (target: string) => Promise<void>): Promise<string> {
  const base = name.replace(/\.png$/, '');
  for (let i = 1; ; i += 1) {
    const candidate = i === 1 ? name : `${base}-${i}.png`;
    try {
      await write(path.join(dir, candidate));
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

// 这张图现在在哪：临时文件夹里的还在就用它，被清掉了用下载的那份，都不在是 null（界面上显示「已清理」）
export async function imageFile(work: string, image: JobImage): Promise<string | null> {
  for (const file of [image.file && path.join(work, image.file), image.savedPath]) {
    if (file && (await fs.stat(file).catch(() => null))?.isFile()) return file;
  }
  return null;
}
