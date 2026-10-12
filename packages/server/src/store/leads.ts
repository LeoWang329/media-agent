import type { LeadRecord } from '@media-agent/shared';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../httpError';
import { readJson, writeJsonAtomic } from './jsonFile';
import { withLock } from './locks';

// 「续写起点」传上来的前一段视频，见 docs/dev-plan.md 5.35：SelfLift 那套从这段接着往下出。
// 和放进画布的视频素材分开存（那个要读时长宽高、要截帧，是给写提示词和参考用的）：
// 这里只按内容存一份，什么都不探测——浏览器读不出宽高（HEVC 就是）也照样能当起点，
// 规整成出片大小、补静音是在生成视频那台上用 ffmpeg 做的

const leadsDir = (work: string, canvasId: string) => path.join(work, 'canvases', canvasId, 'leads');
const leadsFile = (work: string, canvasId: string) => path.join(work, 'canvases', canvasId, 'leads.json');
export const canvasLeadPath = (work: string, canvasId: string, record: LeadRecord) => path.join(leadsDir(work, canvasId), `${record.sha256}.${record.ext}`);

// 只收视频（音频、图不能当续写起点）
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'];

function extOf(name: string): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!VIDEO_EXT.includes(ext)) throw new HttpError(400, `续写起点要 mp4、mov、webm、m4v、mkv、avi 的视频，${name} 这个格式不行`);
  return ext;
}

export async function readLeadRecords(work: string, canvasId: string): Promise<Record<string, LeadRecord>> {
  return (await readJson<Record<string, LeadRecord>>(leadsFile(work, canvasId))) ?? {};
}

export async function readLead(work: string, canvasId: string, leadId: string): Promise<LeadRecord> {
  const record = (await readLeadRecords(work, canvasId))[leadId];
  if (!record) throw new HttpError(404, '找不到这段前一段视频');
  return record;
}

// 资产库或电脑里的文件，按路径复制一份
export async function importLead(work: string, canvasId: string, source: string): Promise<LeadRecord> {
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isFile()) throw new HttpError(404, `找不到这个文件：${source}`);
  return storeLead(work, canvasId, createReadStream(source), { originalPath: source, originalName: path.basename(source) });
}

// 从文件夹直接拖进来的：浏览器只给文件名和内容，originalPath 存空
export async function storeUploadedLead(work: string, canvasId: string, name: string, body: Readable): Promise<LeadRecord> {
  return storeLead(work, canvasId, body, { originalPath: '', originalName: name });
}

async function storeLead(work: string, canvasId: string, input: Readable, from: { originalPath: string; originalName: string }): Promise<LeadRecord> {
  const ext = extOf(from.originalName);
  // 只建 leads 这一层，画布文件夹不在就报错，不在原处重新建出来
  await fs.mkdir(leadsDir(work, canvasId)).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') throw new HttpError(404, '找不到这个画布');
    if (err.code !== 'EEXIST') throw err;
  });
  // 边收边算内容的哈希，收完再按哈希改名；同样的文件传几次都是同一个 id
  const temp = path.join(leadsDir(work, canvasId), `.${randomUUID()}.part`);
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
  if (!bytes) {
    await fs.rm(temp, { force: true });
    throw new HttpError(400, '这个文件是空的');
  }
  const sha256 = hash.digest('hex');
  return withLock(`leads:${canvasId}`, async () => {
    const records = await readLeadRecords(work, canvasId);
    const existing = Object.values(records).find((record) => record.sha256 === sha256);
    if (existing) {
      await fs.rm(temp, { force: true });
      return existing;
    }
    const record: LeadRecord = {
      id: randomUUID(),
      sha256,
      ext,
      originalPath: from.originalPath,
      originalName: from.originalName,
      bytes,
      addedAt: new Date().toISOString(),
    };
    await fs.rename(temp, canvasLeadPath(work, canvasId, record));
    await writeJsonAtomic(leadsFile(work, canvasId), { ...records, [record.id]: record }, false);
    return record;
  });
}
