import type { AssetFile, FolderTree } from '@media-agent/shared';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
let tmp: string;

beforeEach(async () => {
  t = await startTestApp();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'media-agent-assets-'));
});

afterEach(async () => {
  await t.cleanup();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function image(file: string, width = 40, height = 30) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const format = path.extname(file).slice(1).toLowerCase();
  const pipeline = sharp({ create: { width, height, channels: 3, background: '#888888' } });
  await fs.writeFile(file, await (format === 'png' ? pipeline.png() : format === 'webp' ? pipeline.webp() : pipeline.jpeg()).toBuffer());
}

const query = (url: string, params: Record<string, string>) => `${url}?${new URLSearchParams(params)}`;

describe('资产库', () => {
  it('导入文件夹要完整路径且存在；重复导入只记一次；移除只改列表不动文件', async () => {
    expect((await t.call('POST', '/assets/folders', { path: 'relative/folder' })).status).toBe(400);
    expect((await t.call('POST', '/assets/folders', { path: path.join(tmp, 'missing') })).status).toBe(400);
    expect(await t.ok('POST', '/assets/folders', { path: tmp })).toEqual([tmp]);
    expect(await t.ok('POST', '/assets/folders', { path: `${tmp}${path.sep}` })).toEqual([tmp]);
    expect((await t.ok('GET', '/config')).assetFolders).toEqual([tmp]);
    expect(await t.ok('DELETE', '/assets/folders', { path: tmp })).toEqual([]);
    expect((await fs.stat(tmp)).isDirectory()).toBe(true);
  });

  it('列文件夹：只列支持的格式和 heic（标不支持），按文件名排序；新加的文件刷新后出现；子文件夹树', async () => {
    const root = path.join(tmp, 'root');
    await image(path.join(root, 'b10.jpg'));
    await image(path.join(root, 'b2.PNG'));
    await image(path.join(root, 'a.webp'));
    await fs.writeFile(path.join(root, 'photo.heic'), '');
    await fs.writeFile(path.join(root, 'notes.txt'), 'x');
    await image(path.join(root, 'sub', 'deeper', 'c.jpg'));
    await fs.mkdir(path.join(root, 'empty'));
    await t.ok('POST', '/assets/folders', { path: root });

    const files = await t.ok<AssetFile[]>('GET', query('/assets/list', { folder: root }));
    expect(files.map((f) => [f.name, f.supported])).toEqual([
      ['a.webp', true],
      ['b2.PNG', true],
      ['b10.jpg', true],
      ['photo.heic', false],
    ]);
    expect(files[0]).toMatchObject({ path: path.join(root, 'a.webp'), size: expect.any(Number), mtime: expect.any(Number) });

    await image(path.join(root, 'new.jpg'));
    expect((await t.ok<AssetFile[]>('GET', query('/assets/list', { folder: root }))).map((f) => f.name)).not.toContain('new.jpg');
    expect((await t.ok<AssetFile[]>('GET', query('/assets/list', { folder: root, refresh: '1' }))).map((f) => f.name)).toContain('new.jpg');

    const tree = await t.ok<FolderTree>('GET', query('/assets/tree', { root }));
    const names = (node: FolderTree): unknown => [node.name, node.children.map(names)];
    expect(names(tree)).toEqual(['root', [['empty', []], ['sub', [['deeper', []]]]]]);
  });

  it('搜索跨全部导入的文件夹，按文件名不区分大小写', async () => {
    await image(path.join(tmp, 'one', 'Cat-1.jpg'));
    await image(path.join(tmp, 'two', 'nested', 'cat-2.png'));
    await image(path.join(tmp, 'two', 'dog.jpg'));
    await t.ok('POST', '/assets/folders', { path: path.join(tmp, 'one') });
    await t.ok('POST', '/assets/folders', { path: path.join(tmp, 'two') });
    const results = await t.ok<AssetFile[]>('GET', query('/assets/search', { q: 'CAT' }));
    expect(results.map((f) => f.path)).toEqual([path.join(tmp, 'one', 'Cat-1.jpg'), path.join(tmp, 'two', 'nested', 'cat-2.png')]);
  });

  it('缩略图长边 256；不在导入的文件夹里的路径返回 403', async () => {
    const root = path.join(tmp, 'root');
    await image(path.join(root, 'wide.jpg'), 1000, 500);
    await image(path.join(tmp, 'outside', 'secret.jpg'));
    await t.ok('POST', '/assets/folders', { path: root });

    const res = await fetch(`${t.base}${query('/assets/thumb', { path: path.join(root, 'wide.jpg') })}`);
    expect(res.status).toBe(200);
    expect(await sharp(Buffer.from(await res.arrayBuffer())).metadata()).toMatchObject({ format: 'jpeg', width: 256, height: 128 });

    const outside = path.join(tmp, 'outside', 'secret.jpg');
    expect((await t.call('GET', query('/assets/thumb', { path: outside }))).status).toBe(403);
    expect((await t.call('GET', query('/assets/thumb', { path: path.join(root, '..', 'outside', 'secret.jpg') }))).status).toBe(403);
    expect((await t.call('GET', query('/assets/list', { folder: path.join(tmp, 'outside') }))).status).toBe(403);
    expect((await t.call('GET', query('/assets/tree', { root: tmp }))).status).toBe(403);
  });
});
