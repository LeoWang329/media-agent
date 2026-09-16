import express from 'express';
import { folderTree, isSupportedImage, listFolder, searchAssets } from '../assets/scan';
import { thumbnail } from '../assets/thumbs';
import { addAssetFolder, readConfig, removeAssetFolder } from '../config';
import { HttpError } from '../httpError';
import { pickFolder } from '../native/pickFolder';
import { allowedPath } from '../paths';

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

  router.post('/assets/pick-folder', async (_req, res) => {
    if (process.platform !== 'win32') throw new HttpError(501, '这个系统不能弹窗选择，请直接填写路径');
    res.json({ path: await pickFolder() });
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
