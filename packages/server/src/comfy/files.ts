import { downloadFileName, maskFileName, tempFileName, tempFolderName, videoDownloadName, videoTempFileName, type JobImage, type VideoJob } from '@media-agent/shared';
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

// 局部重绘那张抠过透明的 PNG，存进同一个临时文件夹，「已清理」那套逻辑跟着适用，见 docs/dev-plan.md 5.35
export async function saveMaskTemp(work: string, data: Uint8Array, when = new Date()): Promise<string> {
  const folder = tempFolderName(when);
  const dir = path.join(work, 'image-temp', folder);
  await fs.mkdir(dir, { recursive: true });
  const name = await writeNew(dir, maskFileName(when), (target) => fs.writeFile(target, data, { flag: 'wx' }));
  return `image-temp/${folder}/${name}`;
}

// 出的视频存工作文件夹 video-temp/当天/，write 往给的路径写，见 docs/dev-plan.md 5.27。
// tail 给一采那份低清预览用「-preview」，免得和成片重名
export async function saveVideoTemp(work: string, seed: number, write: (target: string) => Promise<void>, when = new Date(), tail = ''): Promise<string> {
  const folder = tempFolderName(when);
  const dir = path.join(work, 'video-temp', folder);
  await fs.mkdir(dir, { recursive: true });
  const name = await writeNew(dir, videoTempFileName(when, seed, tail), write);
  return `video-temp/${folder}/${name}`;
}

// 下载：复制到选好的文件夹，文件名 <节点标题>-<种子>.png，视频是 .mp4
export const copyToFolder = (source: string, folder: string, title: string, seed: number) => copyAs(source, folder, downloadFileName(title, seed));
export const copyVideoToFolder = (source: string, folder: string, title: string, seed: number) => copyAs(source, folder, videoDownloadName(title, seed));

async function copyAs(source: string, folder: string, name: string): Promise<string> {
  const saved = await writeNew(folder, name, (target) => fs.copyFile(source, target, constants.COPYFILE_EXCL));
  return path.join(folder, saved);
}

// 重名的换成 -2、-3，写的时候不覆盖已有的文件
async function writeNew(dir: string, name: string, write: (target: string) => Promise<void>): Promise<string> {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i += 1) {
    const candidate = i === 1 ? name : `${base}-${i}${ext}`;
    try {
      await write(path.join(dir, candidate));
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

// 这张图现在在哪：临时文件夹里的还在就用它，被清掉了用下载的那份，都不在是 null（界面上显示「已清理」）。视频也一样
export async function imageFile(work: string, image: Pick<JobImage, 'file' | 'savedPath'>): Promise<string | null> {
  for (const file of [image.file && path.join(work, image.file), image.savedPath]) {
    if (file && (await fs.stat(file).catch(() => null))?.isFile()) return file;
  }
  return null;
}

export const videoFile = (work: string, job: VideoJob) => imageFile(work, job);
