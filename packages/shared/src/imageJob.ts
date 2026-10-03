import type { FamilyDefaults, ImageRating } from './types';

// 正面 = 系列固定开头 + 评级词（选了才加）+ 框里的标签；负面 = 系列默认负面词 + 节点的额外负面词，见 docs/dev-plan.md 5.18
export function positivePrompt(defaults: FamilyDefaults, rating: ImageRating, tags: string): string {
  return [defaults.prefix, rating === 'none' ? '' : defaults.rating[rating], tags]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

export function negativePrompt(defaults: FamilyDefaults, extra: string): string {
  return [defaults.negative, extra]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

// 出几张就发几个任务，种子依次加 1
export const jobSeeds = (first: number, count: number): number[] => Array.from({ length: count }, (_, i) => first + i);

const pad = (n: number) => String(n).padStart(2, '0');

// 出的图先放工作文件夹 image-temp/YYYY-MM-DD/HHmmss-<种子>.png，按本机时间，见 docs/dev-plan.md 5.20
export const tempFolderName = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const tempFileName = (date: Date, seed: number) => `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${seed}.png`;

// 下载的文件名：<节点标题>-<种子>.png，文件名里不能用的字符换成 _
export const downloadFileName = (title: string, seed: number) => `${title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}-${seed}.png`;
