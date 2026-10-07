import { JPEG_QUALITIES, needsJpeg, planResize, type ChecklistPath, type ImageRecord, type Message } from '@media-agent/shared';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { isSupportedImage } from '../assets/scan';
import { HttpError } from '../httpError';
import { readJson, writeFileAtomic, writeJsonAtomic } from './jsonFile';
import { withLock } from './locks';

const RESIZED_QUALITY = 90; // 缩放后按原格式重新编码时的质量
const LLM_QUALITY = 85;
const FORMATS = { jpeg: 'jpg', png: 'png', webp: 'webp' } as const;

const imagesDir = (work: string, canvasId: string) => path.join(work, 'canvases', canvasId, 'images');
const imagesFile = (work: string, canvasId: string) => path.join(work, 'canvases', canvasId, 'images.json');
export const canvasImagePath = (work: string, canvasId: string, image: ImageRecord) => path.join(imagesDir(work, canvasId), `${image.sha256}.${image.ext}`);
const llmImagePath = (work: string, canvasId: string, image: ImageRecord) => path.join(imagesDir(work, canvasId), `${image.sha256}.llm.jpg`);

export async function readImages(work: string, canvasId: string): Promise<Record<string, ImageRecord>> {
  return (await readJson<Record<string, ImageRecord>>(imagesFile(work, canvasId))) ?? {};
}

export async function readImage(work: string, canvasId: string, imageId: string): Promise<ImageRecord> {
  const image = (await readImages(work, canvasId))[imageId];
  if (!image) throw new HttpError(404, '找不到这张图');
  return image;
}

// 放进槽位：复制一份到画布文件夹并按 H3 的要求处理，另存一张发给模型用的小图。同样内容的图复用已有的 id
export async function importImage(work: string, canvasId: string, source: string, llmLongSide: number): Promise<ImageRecord> {
  if (!isSupportedImage(source)) throw new HttpError(400, '只支持 jpg、jpeg、png、webp 格式的图片');
  const original = await fs.readFile(source).catch((err: NodeJS.ErrnoException) => {
    throw err.code === 'ENOENT' ? new HttpError(404, `找不到这张图：${source}`) : err;
  });
  return storeImage(work, canvasId, original, source, path.basename(source), llmLongSide);
}

// 从 Windows 文件夹直接拖进来的图：浏览器只给文件名和内容，没有本机路径，originalPath 存空
export async function storeDroppedImage(work: string, canvasId: string, name: string, original: Buffer, llmLongSide: number): Promise<ImageRecord> {
  if (!isSupportedImage(name)) throw new HttpError(400, '只支持 jpg、jpeg、png、webp 格式的图片');
  return storeImage(work, canvasId, original, '', name, llmLongSide);
}

async function storeImage(
  work: string,
  canvasId: string,
  original: Buffer,
  originalPath: string,
  originalName: string,
  llmLongSide: number,
): Promise<ImageRecord> {
  const sha256 = createHash('sha256').update(original).digest('hex');
  return withLock(`images:${canvasId}`, async () => {
    const images = await readImages(work, canvasId);
    const existing = Object.values(images).find((image) => image.sha256 === sha256);
    if (existing) return existing;

    const copy = await processForH3(original);
    const image: ImageRecord = {
      id: randomUUID(),
      sha256,
      ext: copy.ext,
      originalPath,
      originalName,
      width: copy.width,
      height: copy.height,
      processed: copy.processed,
      addedAt: new Date().toISOString(),
    };
    const llm = await sharp(copy.data)
      .rotate()
      .resize(llmLongSide, llmLongSide, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: LLM_QUALITY })
      .toBuffer();
    // 处理图的这段时间里画布可能被删了：只建 images 这一层，画布文件夹不在就报错，不在原处重新建出来
    await fs.mkdir(imagesDir(work, canvasId)).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') throw new HttpError(404, '找不到这个画布');
      if (err.code !== 'EEXIST') throw err;
    });
    await writeFileAtomic(canvasImagePath(work, canvasId, image), copy.data, false);
    await writeFileAtomic(llmImagePath(work, canvasId, image), llm, false);
    await writeJsonAtomic(imagesFile(work, canvasId), { ...images, [image.id]: image }, false);
    return image;
  });
}

// 5.7 上传清单里这张图该传哪个文件：没处理过、原文件还在就用原文件，否则用画布副本；顺带给出文件大小
export async function checklistPath(work: string, canvasId: string, image: ImageRecord): Promise<ChecklistPath> {
  const original = image.originalPath;
  const originalStat = !image.processed && original ? await fs.stat(original).catch(() => null) : null;
  if (originalStat) return { path: original, kind: 'original', size: originalStat.size };
  const note = image.processed ? '已处理，请上传这份' : original ? '原图不在了，用这份' : '拖进来的图，用这份';
  const copy = canvasImagePath(work, canvasId, image);
  const copyStat = await fs.stat(copy).catch(() => null);
  if (!copyStat) throw new HttpError(404, originalStat === null && original && !image.processed ? '原文件和程序存的那份都找不到了' : '程序存的那份找不到了');
  return { path: copy, kind: 'canvas', note, size: copyStat.size };
}

// 5.6：长边超过 5760 缩小、短边不到 256 放大；处理后仍超过 30 MB 转 JPEG 逐步降质量。没触发任何条件就原样复制
async function processForH3(original: Buffer): Promise<{ data: Buffer; ext: ImageRecord['ext']; width: number; height: number; processed: ImageRecord['processed'] }> {
  // sharp 遇到空文件会在创建时直接抛错，放进 then 里一起按「读不出来」处理
  const meta = await Promise.resolve()
    .then(() => sharp(original).metadata())
    .catch(() => {
      throw new HttpError(400, '这张图读不出来');
    });
  const format = FORMATS[meta.format as keyof typeof FORMATS];
  if (!format) throw new HttpError(400, '只支持 jpg、png、webp 格式的图片');
  // 手机照片常带旋转标记，宽高按转正以后算
  const turned = (meta.orientation ?? 1) >= 5;
  const originalWidth = turned ? meta.height : meta.width;
  const originalHeight = turned ? meta.width : meta.height;

  const resize = planResize(originalWidth, originalHeight);
  const pipeline = (): Sharp => {
    const image = sharp(original).rotate();
    return resize ? image.resize(resize.width, resize.height, { fit: 'fill' }) : image;
  };
  let data = original;
  let ext: ImageRecord['ext'] = format;
  if (resize) {
    const image = pipeline();
    data = await (format === 'jpg' ? image.jpeg({ quality: RESIZED_QUALITY }) : format === 'webp' ? image.webp({ quality: RESIZED_QUALITY }) : image.png()).toBuffer();
  }
  let reason: NonNullable<ImageRecord['processed']>['reason'] | null = resize?.reason ?? null;
  if (needsJpeg(data.length)) {
    for (const quality of JPEG_QUALITIES) {
      data = await pipeline().flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer();
      if (!needsJpeg(data.length)) break;
    }
    ext = 'jpg';
    reason ??= 'file-too-big';
  }
  return {
    data,
    ext,
    width: resize?.width ?? originalWidth,
    height: resize?.height ?? originalHeight,
    processed: reason ? { reason, originalWidth, originalHeight } : null,
  };
}

// 发给模型前把路径上所有 user 消息带的图读成 data URL
export async function llmImageUrls(work: string, canvasId: string, messages: Message[]): Promise<(imageId: string) => string> {
  const images = await readImages(work, canvasId);
  const urls = new Map<string, string>();
  const all = messages.flatMap((m) => [
    ...(m.attachments ?? []).map((a) => ({ imageId: a.imageId, label: `<Picture ${a.picture}> 这张图` })),
    ...(m.frames ?? []).map((f) => ({ imageId: f.imageId, label: `<Video ${f.video}> 的截帧` })),
  ]);
  for (const attachment of all) {
    if (urls.has(attachment.imageId)) continue;
    const image = images[attachment.imageId];
    if (!image) throw new Error(`找不到${attachment.label}的记录`);
    const data = await fs.readFile(llmImagePath(work, canvasId, image));
    urls.set(attachment.imageId, `data:image/jpeg;base64,${data.toString('base64')}`);
  }
  return (imageId) => urls.get(imageId)!;
}
