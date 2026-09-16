import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// 测试图片：五张 800×600 纯色带编号、一张 6000×4000、一张 200×150、一个空的 .heic
export const FIXTURES = {
  first: '01-red.jpg',
  second: '02-green.jpg',
  third: '03-blue.jpg',
  fourth: '04-orange.jpg',
  fifth: '05-紫色.jpg',
  big: 'big-6000x4000.jpg',
  small: 'small-200x150.jpg',
  heic: 'photo.heic',
};

export const FIXTURES_DIR = path.join(import.meta.dirname, 'images');

async function solid(file: string, width: number, height: number, color: string, text: string) {
  const size = Math.round(Math.min(width, height) / 3);
  const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="50%" y="50%" font-size="${size}" font-family="Arial, sans-serif" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`;
  const data = await sharp({ create: { width, height, channels: 3, background: color } })
    .composite([{ input: Buffer.from(label) }])
    .jpeg({ quality: 90 })
    .toBuffer();
  await fs.writeFile(file, data);
}

export async function makeFixtureImages(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const at = (name: string) => path.join(dir, name);
  await solid(at(FIXTURES.first), 800, 600, '#d9534f', '1');
  await solid(at(FIXTURES.second), 800, 600, '#5cb85c', '2');
  await solid(at(FIXTURES.third), 800, 600, '#428bca', '3');
  await solid(at(FIXTURES.fourth), 800, 600, '#f0ad4e', '4');
  await solid(at(FIXTURES.fifth), 800, 600, '#8e44ad', '5');
  await solid(at(FIXTURES.big), 6000, 4000, '#34495e', 'BIG');
  await solid(at(FIXTURES.small), 200, 150, '#16a085', 'S');
  await fs.writeFile(at(FIXTURES.heic), '');
}
