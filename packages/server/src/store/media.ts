import { MEDIA_LIMITS, mediaKindOf, type MediaKind, type MediaRecord } from '@media-agent/shared';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../httpError';
import { readJson, writeJsonAtomic } from './jsonFile';
import { withLock } from './locks';

// 放进画布的视频和音频，见 docs/dev-plan.md 5.31：原样复制一份到画布的 media/ 下，不转码、不截；同样内容的复用已有的 id

const mediaDir = (work: string, canvasId: string) => path.join(work, 'canvases', canvasId, 'media');
const mediaFile = (work: string, canvasId: string) => path.join(work, 'canvases', canvasId, 'media.json');
export const canvasMediaPath = (work: string, canvasId: string, record: MediaRecord) => path.join(mediaDir(work, canvasId), `${record.sha256}.${record.ext}`);

// 多长、宽高、有没有声音是浏览器读的，跟着文件一起发过来
export type MediaMeta = { seconds: number; width?: number; height?: number; hasAudio?: boolean };

export async function readMediaRecords(work: string, canvasId: string): Promise<Record<string, MediaRecord>> {
  return (await readJson<Record<string, MediaRecord>>(mediaFile(work, canvasId))) ?? {};
}

export async function readMedia(work: string, canvasId: string, mediaId: string): Promise<MediaRecord> {
  const record = (await readMediaRecords(work, canvasId))[mediaId];
  if (!record) throw new HttpError(404, '找不到这段视频或音频');
  return record;
}

function kindOf(name: string): MediaKind {
  const kind = mediaKindOf(name);
  if (!kind) throw new HttpError(400, '视频只收 mp4、mov、webm、m4v，音频只收 mp3、wav、m4a、aac、ogg、flac');
  return kind;
}

// 资产库或电脑里的文件，按路径复制
export async function importMedia(work: string, canvasId: string, source: string, meta: MediaMeta): Promise<MediaRecord> {
  const kind = kindOf(source);
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isFile()) throw new HttpError(404, `找不到这个文件：${source}`);
  return storeMedia(work, canvasId, createReadStream(source), { originalPath: source, originalName: path.basename(source), kind }, meta);
}

// 从文件夹直接拖进来的：浏览器只给文件名和内容，originalPath 存空
export async function storeUploadedMedia(work: string, canvasId: string, name: string, body: Readable, meta: MediaMeta): Promise<MediaRecord> {
  return storeMedia(work, canvasId, body, { originalPath: '', originalName: name, kind: kindOf(name) }, meta);
}

async function storeMedia(
  work: string,
  canvasId: string,
  input: Readable,
  from: { originalPath: string; originalName: string; kind: MediaKind },
  meta: MediaMeta,
): Promise<MediaRecord> {
  if (meta.seconds < MEDIA_LIMITS.minSeconds) throw new HttpError(400, `${from.originalName} 只有 ${Math.round(meta.seconds * 10) / 10} 秒，不到 ${MEDIA_LIMITS.minSeconds} 秒的用不了`);
  // 只建 media 这一层，画布文件夹不在就报错，不在原处重新建出来
  await fs.mkdir(mediaDir(work, canvasId)).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') throw new HttpError(404, '找不到这个画布');
    if (err.code !== 'EEXIST') throw err;
  });
  // 边复制边算内容的哈希，复制完再按哈希改名
  const temp = path.join(mediaDir(work, canvasId), `.${randomUUID()}.part`);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    await pipeline(
      input,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          hash.update(chunk);
          bytes += chunk.length;
          yield chunk;
        }
      },
      createWriteStream(temp),
    );
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
  const sha256 = hash.digest('hex');
  return withLock(`media:${canvasId}`, async () => {
    const records = await readMediaRecords(work, canvasId);
    const existing = Object.values(records).find((record) => record.sha256 === sha256);
    if (existing) {
      await fs.rm(temp, { force: true });
      return existing;
    }
    const record: MediaRecord = {
      id: randomUUID(),
      sha256,
      kind: from.kind,
      ext: path.extname(from.originalName).slice(1).toLowerCase(),
      originalPath: from.originalPath,
      originalName: from.originalName,
      seconds: meta.seconds,
      ...(from.kind === 'video' && meta.width && meta.height && { width: meta.width, height: meta.height }),
      ...(from.kind === 'video' && meta.hasAudio !== undefined && { hasAudio: meta.hasAudio }),
      bytes,
      addedAt: new Date().toISOString(),
    };
    await fs.rename(temp, canvasMediaPath(work, canvasId, record));
    await writeJsonAtomic(mediaFile(work, canvasId), { ...records, [record.id]: record }, false);
    return record;
  });
}
