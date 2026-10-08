import type { CardGenerated, ChatNode, FamilyDefaults, GeneratedRef, ImageRating, JobImage, Message } from './types';

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

// 还在排队或者正在出
export const isLiveImage = (image: JobImage) => image.status === 'queued' || image.status === 'running';

// 这几条回复出完的图：新的一组在前，同一组里按顺序。starFirst 时打过星的排最前（首页列图时，见 docs/dev-plan.md 5.20）。
// 给了 promptIndex 只算这个框出的
export function generatedImages(messages: Message[], options: { promptIndex?: number; starFirst?: boolean } = {}): GeneratedRef[] {
  const found = messages.flatMap((message) =>
    (message.images ?? [])
      .filter((job) => options.promptIndex === undefined || job.promptIndex === options.promptIndex)
      .flatMap((job) =>
        job.images.flatMap((image, index) =>
          image.status === 'done'
            ? [{ createdAt: job.createdAt, ref: { messageId: message.id, jobId: job.id, index, seed: image.seed, starred: Boolean(image.starred) } }]
            : [],
        ),
      ),
  );
  found.sort((a, b) => (options.starFirst ? Number(b.ref.starred) - Number(a.ref.starred) : 0) || b.createdAt.localeCompare(a.createdAt));
  return found.map((item) => item.ref);
}

// 卡片上出图的情况：最近出的 max 张；正在出的几组一共出完几张、一共几张；最近一组是不是全失败了。没出过图是 null
export function cardGenerated(node: Pick<ChatNode, 'messages'>, max: number, starFirst = false): CardGenerated | null {
  const messages = Object.values(node.messages);
  const jobs = messages.flatMap((message) => message.images ?? []);
  if (!jobs.length) return null;
  const liveJobs = jobs.filter((job) => job.images.some(isLiveImage));
  const live = liveJobs.flatMap((job) => job.images);
  const boot = liveJobs.some((job) => job.target === 'autodl' && job.images.some((image) => image.status === 'queued' && !image.promptId));
  const latest = jobs.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return {
    images: generatedImages(messages, { starFirst }).slice(0, max),
    live: live.length ? { done: live.filter((image) => image.status === 'done').length, total: live.length, boot } : null,
    failed: latest.images.every((image) => image.status === 'failed'),
  };
}

// 一张图没出成是哪一种，界面上按种类说清楚，见 docs/dev-plan.md 5.19：
// 连不上、底模文件不在（ComfyUI 不收，说的是底模那一项）、ComfyUI 不收（别的原因）、缺插件（导入的工作流用到这台没装的节点）、显存不够、程序重启时没出完、别的
export type ImageErrorKind = 'down' | 'checkpoint' | 'rejected' | 'missing' | 'memory' | 'restart' | 'boot' | 'other';

export function imageErrorKind(error: string): ImageErrorKind {
  if (error.startsWith('连不上 ComfyUI')) return 'down';
  if (error.startsWith('ComfyUI 不收这个任务')) return /CheckpointLoaderSimple[\s\S]*ckpt_name|UNETLoader[\s\S]*unet_name/.test(error) ? 'checkpoint' : 'rejected';
  if (error.startsWith('这台 ComfyUI 缺插件')) return 'missing';
  if (error.startsWith('显存不够')) return 'memory';
  if (error.startsWith('程序重启')) return 'restart';
  if (error.startsWith('AutoDL 开机失败')) return 'boot';
  return 'other';
}
