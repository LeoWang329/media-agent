import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { HttpError } from '../httpError';
import { writeFileAtomic } from '../store/jsonFile';

const THUMB_SIDE = 256;
const THUMB_QUALITY = 80;

// 缩略图存本机缓存，文件名是 sha1(路径 + 修改时间 + 大小)，原图改过就会换一张
export async function thumbnail(configDir: string, file: string): Promise<string> {
  const stat = await fs.stat(file).catch(() => {
    throw new HttpError(404, `找不到这张图：${file}`);
  });
  const key = createHash('sha1').update(`${file}${stat.mtimeMs}${stat.size}`).digest('hex');
  const target = path.join(configDir, 'thumbs', `${key}.jpg`);
  if (await fs.stat(target).catch(() => null)) return target;
  const data = await sharp(await fs.readFile(file))
    .rotate()
    .resize(THUMB_SIDE, THUMB_SIDE, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();
  await writeFileAtomic(target, data);
  return target;
}
