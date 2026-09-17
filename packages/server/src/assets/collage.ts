import { centerIn, collageFileName, collageLayout, COLLAGE_JPEG_QUALITY, fitInside, type CollageBadge } from '@media-agent/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { writeFileAtomic } from '../store/jsonFile';

export type CollageInput = { files: (string | null)[]; rows: number; columns: number; cell: number; numbers: boolean };

// 编号小框画成一整张 SVG 盖在最上面：白底圆角，黑字居中
function badgeLayer(width: number, height: number, badges: CollageBadge[]): Buffer {
  const shapes = badges.map((b) =>
    [
      `<rect x="${b.left}" y="${b.top}" width="${b.width}" height="${b.height}" rx="${b.radius}" ry="${b.radius}" fill="#ffffff"/>`,
      `<text x="${b.left + b.width / 2}" y="${b.top + b.height / 2}" font-size="${b.fontSize}" font-family="Arial, sans-serif"`,
      ` fill="#000000" text-anchor="middle" dominant-baseline="central">${b.number}</text>`,
    ].join(''),
  );
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes.join('')}</svg>`);
}

// 已经有同名文件时，名字后面加 -2、-3
async function freeName(folder: string, name: string): Promise<string> {
  const base = name.slice(0, -'.jpg'.length);
  for (let i = 1; ; i += 1) {
    const target = path.join(folder, i === 1 ? name : `${base}-${i}.jpg`);
    if (!(await fs.stat(target).catch(() => null))) return target;
  }
}

// name 是存成的文件名（以 .jpg 结尾），不给就按时间起名
export async function makeCollage(folder: string, input: CollageInput, name?: string): Promise<{ path: string; width: number; height: number }> {
  const layout = collageLayout(input.rows, input.columns, input.cell, input.numbers);
  const layers: OverlayOptions[] = [];
  for (const [index, file] of input.files.entries()) {
    const box = layout.cells[index];
    if (!file || !box) continue;
    const data = await fs.readFile(file);
    const { autoOrient } = await sharp(data).metadata();
    const size = fitInside(autoOrient.width, autoOrient.height, box.width);
    const resized = await sharp(data).rotate().resize(size.width, size.height).toBuffer();
    layers.push({ input: resized, ...centerIn(box, size) });
  }
  if (layout.badges.length) layers.push({ input: badgeLayer(layout.width, layout.height, layout.badges), left: 0, top: 0 });

  // 空格子和图片放不满的地方留白
  const jpeg = await sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: '#ffffff' } })
    .composite(layers)
    .jpeg({ quality: COLLAGE_JPEG_QUALITY })
    .toBuffer();
  const target = await freeName(folder, name ?? collageFileName(new Date()));
  await writeFileAtomic(target, jpeg);
  return { path: target, width: layout.width, height: layout.height };
}
