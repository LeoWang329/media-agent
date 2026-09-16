import { COLLAGE_CELL_SIZES, isCollageGrid } from '@media-agent/shared';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeCollage, type CollageInput } from '../assets/collage';
import { folderTree, isSupportedImage, listFolder, searchAssets } from '../assets/scan';
import { thumbnail } from '../assets/thumbs';
import { addAssetFolder, readConfig, removeAssetFolder, setLastCollageFolder } from '../config';
import { HttpError } from '../httpError';
import { pickFolder } from '../native/pickFolder';
import { revealInFolder } from '../native/reveal';
import { allowedPath, isInside } from '../paths';
import { bool, finiteNumber, text } from './validate';

export function assetRoutes(configDir: string): express.Router {
  const router = express.Router();
  // 用户刚在系统窗口里选过的文件夹：拼图可以存进去，窗口本身就是他点开的
  const pickedFolders = new Set<string>();

  router.get('/assets/folders', async (_req, res) => {
    res.json((await readConfig(configDir)).assetFolders);
  });

  router.post('/assets/folders', async (req, res) => {
    res.json(await addAssetFolder(configDir, req.body?.path));
  });

  router.delete('/assets/folders', async (req, res) => {
    res.json(await removeAssetFolder(configDir, req.body?.path));
  });

  // start 是窗口一打开停在哪个文件夹
  router.post('/assets/pick-folder', async (req, res) => {
    if (process.platform !== 'win32') throw new HttpError(501, '这个系统不能弹窗选择，请直接填写路径');
    const picked = await pickFolder(typeof req.body?.start === 'string' ? req.body.start : undefined);
    if (picked) pickedFolders.add(path.resolve(picked));
    res.json({ path: picked });
  });

  // 拼图：把几张图拼成一张大图存进选好的文件夹
  router.post('/assets/collage', async (req, res) => {
    const input = collageInput(req.body);
    const files = await Promise.all(input.files.map((file) => (file === null ? null : allowedPath(configDir, file))));
    const folder = await collageFolder(configDir, pickedFolders, req.body?.folder);
    const made = await makeCollage(folder, { ...input, files });
    await setLastCollageFolder(configDir, folder);
    const { assetFolders } = await readConfig(configDir);
    res.json({ ...made, folder, inLibrary: assetFolders.some((root) => isInside(root, folder)) });
  });

  // 上传清单里的「在资源管理器中显示」
  router.post('/assets/reveal', async (req, res) => {
    revealInFolder(await allowedPath(configDir, req.body?.path));
    res.status(204).end();
  });

  router.get('/assets/tree', async (req, res) => {
    res.json(await folderTree(await allowedPath(configDir, req.query.root), req.query.refresh === '1'));
  });

  router.get('/assets/list', async (req, res) => {
    res.json(await listFolder(await allowedPath(configDir, req.query.folder), req.query.refresh === '1'));
  });

  router.get('/assets/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(await searchAssets((await readConfig(configDir)).assetFolders, query));
  });

  router.get('/assets/thumb', async (req, res) => {
    const file = await allowedPath(configDir, req.query.path);
    if (!isSupportedImage(file)) throw new HttpError(415, '不支持这种图片格式');
    res.sendFile(await thumbnail(configDir, file));
  });

  return router;
}

// 存到哪：刚在系统窗口里选的随便存；手填的只能填库里或工作文件夹里的
async function collageFolder(configDir: string, picked: Set<string>, value: unknown): Promise<string> {
  if (typeof value !== 'string' || !path.isAbsolute(value.trim())) throw new HttpError(400, '存到哪个文件夹要填完整路径');
  const folder = path.resolve(value.trim());
  if (!picked.has(folder)) await allowedPath(configDir, folder);
  const stat = await fs.stat(folder).catch(() => null);
  if (!stat?.isDirectory()) throw new HttpError(400, `找不到这个文件夹：${folder}`);
  return folder;
}

function collageInput(body: unknown): CollageInput {
  const fields = (body ?? {}) as Record<string, unknown>;
  const rows = finiteNumber(fields.rows, '行数');
  const columns = finiteNumber(fields.columns, '列数');
  if (!isCollageGrid(rows, columns)) throw new HttpError(400, '行数和列数各 1 到 3，而且不能都是 1');
  const cell = finiteNumber(fields.cell, '格子边长');
  if (!COLLAGE_CELL_SIZES.includes(cell)) throw new HttpError(400, `格子边长只能是 ${COLLAGE_CELL_SIZES.join(' 或 ')}`);
  if (!Array.isArray(fields.files) || fields.files.length !== rows * columns) throw new HttpError(400, '格子数量和行列对不上');
  const files = fields.files.map((file) => (file === null ? null : text(file, '图片路径')));
  if (!files.some(Boolean)) throw new HttpError(400, '格子里一张图都没有');
  return { files, rows, columns, cell, numbers: bool(fields.numbers, '加编号') };
}
