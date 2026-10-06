import { ASSET_SORTS, COLLAGE_CELL_SIZES, isCollageGrid } from '@media-agent/shared';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeCollage, type CollageInput } from '../assets/collage';
import { folderTree, isSupportedImage, listFolder, searchAssets } from '../assets/scan';
import { thumbnail } from '../assets/thumbs';
import { addAssetFolder, readConfig, removeAssetFolder, requireWorkFolder, setLastCollageFolder } from '../config';
import { HttpError } from '../httpError';
import { imageLongSide } from '../llm/imageLongSide';
import { pickFolder } from '../native/pickFolder';
import { allowedPath, isInside } from '../paths';
import { readCanvas } from '../store/canvases';
import { importImage } from '../store/images';
import { bool, choice, fileName, finiteNumber, text, uuid } from './validate';

// 用户刚在系统窗口里选过的文件夹：拼图和下载的图可以存进去，窗口本身就是他点开的
const pickedFolders = new Set<string>();

export function assetRoutes(configDir: string): express.Router {
  const router = express.Router();

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

  // 拼图：把几张图拼成一张大图存进选好的文件夹。带了 canvasId 和 nodeId 时顺手复制进画布，前端再放进槽位
  router.post('/assets/collage', async (req, res) => {
    const input = collageInput(req.body);
    const files = await Promise.all(input.files.map((file) => (file === null ? null : allowedPath(configDir, file))));
    const folder = await chosenFolder(configDir, req.body?.folder);
    const name = req.body?.name === undefined ? undefined : collageName(req.body.name);
    const target = req.body?.canvasId === undefined ? null : { canvasId: uuid(req.body.canvasId), nodeId: uuid(req.body?.nodeId) };
    const work = target ? await requireWorkFolder(configDir) : null;
    if (target) await readCanvas(work!, target.canvasId);
    const made = await makeCollage(folder, { ...input, files }, name);
    await setLastCollageFolder(configDir, folder);
    const { assetFolders } = await readConfig(configDir);
    const image = target ? await importImage(work!, target.canvasId, made.path, await imageLongSide(configDir, work!, target.canvasId, target.nodeId)) : undefined;
    res.json({ ...made, folder, inLibrary: assetFolders.some((root) => isInside(root, folder)), ...(image && { image }) });
  });

  router.get('/assets/tree', async (req, res) => {
    res.json(await folderTree(await allowedPath(configDir, req.query.root), req.query.refresh === '1'));
  });

  // 列一个文件夹里（含子文件夹）的全部图
  router.get('/assets/list', async (req, res) => {
    const folder = await allowedPath(configDir, req.query.folder);
    const root = (await readConfig(configDir)).assetFolders.find((r) => isInside(r, folder)) ?? folder;
    res.json(await listFolder(root, folder, req.query.refresh === '1'));
  });

  router.get('/assets/search', async (req, res) => {
    // 不带排法是按文件名，见 docs/dev-plan.md 6.3
    const sort = req.query.sort === undefined ? 'name-asc' : choice(req.query.sort, '排序方式', ASSET_SORTS);
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(await searchAssets((await readConfig(configDir)).assetFolders, query, sort));
  });

  router.get('/assets/thumb', async (req, res) => {
    const file = await allowedPath(configDir, req.query.path);
    if (!isSupportedImage(file)) throw new HttpError(415, '不支持这种图片格式');
    res.sendFile(await thumbnail(configDir, file));
  });

  return router;
}

// 拼图、下载的图存到哪：刚在系统窗口里选的、上次存过的随便存；别的只能是库里或工作文件夹里的
export async function chosenFolder(configDir: string, value: unknown): Promise<string> {
  if (typeof value !== 'string' || !path.isAbsolute(value.trim())) throw new HttpError(400, '存到哪个文件夹要填完整路径');
  const folder = path.resolve(value.trim());
  const { lastCollageFolder, lastDownloadFolder } = await readConfig(configDir);
  if (!pickedFolders.has(folder) && folder !== lastCollageFolder && folder !== lastDownloadFolder) await allowedPath(configDir, folder);
  const stat = await fs.stat(folder).catch(() => null);
  if (!stat?.isDirectory()) throw new HttpError(400, `找不到这个文件夹：${folder}`);
  return folder;
}

// 拼图的文件名：不带路径，不是 .jpg 结尾就补上
function collageName(value: unknown): string {
  const name = fileName(value);
  if (/[<>:"|?*]/.test(name)) throw new HttpError(400, '文件名里不能有 < > : " | ? * 这些字符');
  return /\.jpe?g$/i.test(name) ? name.replace(/\.jpe?g$/i, '.jpg') : `${name}.jpg`;
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
