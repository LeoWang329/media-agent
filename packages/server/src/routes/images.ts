import express, { type Request } from 'express';
import { thumbnail } from '../assets/thumbs';
import { copyToFolder, imageFile } from '../comfy/files';
import type { ImageJobs, JobPlace } from '../comfy/jobs';
import { readConfig, requireWorkFolder, setLastDownloadFolder } from '../config';
import { HttpError } from '../httpError';
import { isInside } from '../paths';
import { readNode } from '../store/canvases';
import { chosenFolder } from './assets';
import * as v from './validate';

// 出图：建任务、叫停、删一张、打星、看图、下载、推送状态，见 docs/dev-plan.md 5.19、5.20
export function imageRoutes(configDir: string, jobs: ImageJobs): express.Router {
  const router = express.Router();
  const base = '/canvases/:canvasId/nodes/:nodeId/messages/:messageId/images';
  const place = async (req: Request): Promise<JobPlace> => ({
    work: await requireWorkFolder(configDir),
    canvasId: v.uuid(req.params.canvasId),
    nodeId: v.uuid(req.params.nodeId),
    messageId: String(req.params.messageId),
  });
  const imageIndex = (req: Request) => v.index(Number(req.params.index), '图片');

  // again 是「同样参数再来」「只换种子再来」，照着那一张出一张
  router.post(base, async (req, res) => {
    const again = req.body?.again === undefined ? undefined : againOf(req.body.again);
    const promptIndex = again ? 0 : v.index(req.body?.promptIndex, '提示词框');
    res.status(201).json(await jobs.create(await place(req), promptIndex, again));
  });

  router.post(`${base}/:jobId/stop`, async (req, res) => {
    res.json(await jobs.stop(await place(req), String(req.params.jobId)));
  });

  router.delete(`${base}/:jobId/:index`, async (req, res) => {
    res.json(await jobs.removeImage(await place(req), String(req.params.jobId), imageIndex(req)));
  });

  router.post(`${base}/:jobId/:index/star`, async (req, res) => {
    res.json(await jobs.updateImage(await place(req), String(req.params.jobId), imageIndex(req), { starred: v.bool(req.body?.on, '星标') }));
  });

  // 临时文件夹里的被清掉了用下载的那份；都不在返回 404，界面上显示「已清理」
  router.get(`${base}/:jobId/:index/file`, async (req, res) => {
    res.sendFile((await findImage(await place(req), String(req.params.jobId), imageIndex(req))).file);
  });

  router.get(`${base}/:jobId/:index/thumb`, async (req, res) => {
    res.sendFile(await thumbnail(configDir, (await findImage(await place(req), String(req.params.jobId), imageIndex(req))).file));
  });

  // 下载：复制到选好的文件夹，记下存到哪；那个文件夹不在资产库里时 inLibrary 为假，界面上问要不要导入
  router.post('/images/download', async (req, res) => {
    const items = downloadItems(req.body?.items);
    const folder = await chosenFolder(configDir, req.body?.folder);
    const work = await requireWorkFolder(configDir);
    const found = await Promise.all(items.map((item) => findImage({ work, ...item }, item.jobId, item.index)));
    const paths: string[] = [];
    for (const [i, item] of items.entries()) {
      const { title, seed, file } = found[i];
      const saved = await copyToFolder(file, folder, title, seed);
      await jobs.updateImage({ work, ...item }, item.jobId, item.index, { savedPath: saved });
      paths.push(saved);
    }
    await setLastDownloadFolder(configDir, folder);
    const { assetFolders } = await readConfig(configDir);
    res.json({ paths, inLibrary: assetFolders.some((root) => isInside(root, folder)) });
  });

  router.get('/image-jobs/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const unsubscribe = jobs.subscribe((event) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    req.on('close', unsubscribe);
  });

  return router;
}

async function findImage(place: JobPlace, jobId: string, index: number): Promise<{ title: string; seed: number; file: string }> {
  const node = await readNode(place.work, place.canvasId, place.nodeId);
  const image = node.messages[place.messageId]?.images?.find((job) => job.id === jobId)?.images[index];
  if (!image) throw new HttpError(404, '找不到这张图');
  const file = await imageFile(place.work, image);
  if (!file) throw new HttpError(404, '这张图已经清理掉了');
  return { title: node.title, seed: image.seed, file };
}

function againOf(value: unknown): { jobId: string; index: number; sameSeed: boolean } {
  const fields = (value ?? {}) as Record<string, unknown>;
  return { jobId: v.nonEmptyText(fields.jobId, '照着再来的那组图'), index: v.index(fields.index, '图片'), sameSeed: v.bool(fields.sameSeed, '同一个种子') };
}

function downloadItems(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new HttpError(400, '没选要下载的图');
  return value.map((item) => {
    const fields = (item ?? {}) as Record<string, unknown>;
    return {
      canvasId: v.uuid(fields.canvasId),
      nodeId: v.uuid(fields.nodeId),
      messageId: v.nonEmptyText(fields.messageId, '消息 id'),
      jobId: v.nonEmptyText(fields.jobId, '这组图的 id'),
      index: v.index(fields.index, '图片'),
    };
  });
}
