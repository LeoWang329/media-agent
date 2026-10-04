import type { ImageTempInfo, ImageWhere, JobImage } from '@media-agent/shared';
import express, { type Request } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { thumbnail } from '../assets/thumbs';
import { copyToFolder, imageFile } from '../comfy/files';
import type { ImageJobs, JobPlace, Refine } from '../comfy/jobs';
import { readConfig, requireWorkFolder, setLastDownloadFolder } from '../config';
import { HttpError } from '../httpError';
import { openExternal } from '../native/openExternal';
import { revealInFolder } from '../native/reveal';
import { isInside } from '../paths';
import { readNode } from '../store/canvases';
import { chosenFolder } from './assets';
import * as v from './validate';

const isFile = async (file: string) => Boolean((await fs.stat(file).catch(() => null))?.isFile());

// 出图：建任务、叫停、删一张、打星、看图、下载、推送状态、临时文件夹，见 docs/dev-plan.md 5.19、5.20
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

  // again 是「同样参数再来」「只换种子再来」，照着那一张出一张；refine 是出完的图上补做放大和部位重绘
  router.post(base, async (req, res) => {
    const again = req.body?.again === undefined ? undefined : againOf(req.body.again);
    const refine = req.body?.refine === undefined ? undefined : refineOf(req.body.refine);
    const promptIndex = again || refine ? 0 : v.index(req.body?.promptIndex, '提示词框');
    res.status(201).json(await jobs.create(await place(req), promptIndex, { again, refine }));
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

  // 大图旁边显示文件在哪：临时文件夹里的、下载的那份还在不在
  router.get(`${base}/:jobId/:index/where`, async (req, res) => {
    const at = await place(req);
    const { image } = await jobImage(at, String(req.params.jobId), imageIndex(req));
    const temp = image.file ? path.join(at.work, image.file) : null;
    const where: ImageWhere = {
      temp: temp && (await isFile(temp)) ? temp : null,
      saved: image.savedPath && (await isFile(image.savedPath)) ? image.savedPath : null,
    };
    res.json(where);
  });

  router.post(`${base}/:jobId/:index/reveal`, async (req, res) => {
    revealInFolder((await findImage(await place(req), String(req.params.jobId), imageIndex(req))).file);
    res.status(204).end();
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

  // 设置里「出的图」：临时文件夹按日期分的子文件夹各有几张、多大；上次下载到哪、在不在资产库里
  router.get('/image-temp', async (_req, res) => {
    const work = await requireWorkFolder(configDir);
    const root = path.join(work, 'image-temp');
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const days = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const files = await fs.readdir(path.join(root, entry.name), { withFileTypes: true });
          const sizes = await Promise.all(files.filter((f) => f.isFile()).map((f) => fs.stat(path.join(root, entry.name, f.name)).then((st) => st.size, () => 0)));
          return { name: entry.name, count: sizes.length, bytes: sizes.reduce((a, b) => a + b, 0) };
        }),
    );
    const { lastDownloadFolder, assetFolders } = await readConfig(configDir);
    const info: ImageTempInfo = {
      path: root,
      days: days.sort((a, b) => b.name.localeCompare(a.name)),
      lastDownload: lastDownloadFolder ? { folder: lastDownloadFolder, inLibrary: assetFolders.some((r) => isInside(r, lastDownloadFolder)) } : null,
    };
    res.json(info);
  });

  // 还没出过图时文件夹不在，先建好再打开
  router.post('/image-temp/open', async (_req, res) => {
    const root = path.join(await requireWorkFolder(configDir), 'image-temp');
    await fs.mkdir(root, { recursive: true });
    openExternal(root);
    res.status(204).end();
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

async function jobImage(place: JobPlace, jobId: string, index: number): Promise<{ title: string; image: JobImage }> {
  const node = await readNode(place.work, place.canvasId, place.nodeId);
  const image = node.messages[place.messageId]?.images?.find((job) => job.id === jobId)?.images[index];
  if (!image) throw new HttpError(404, '找不到这张图');
  return { title: node.title, image };
}

async function findImage(place: JobPlace, jobId: string, index: number): Promise<{ title: string; seed: number; file: string }> {
  const { title, image } = await jobImage(place, jobId, index);
  const file = await imageFile(place.work, image);
  if (!file) throw new HttpError(404, '这张图已经清理掉了');
  return { title, seed: image.seed, file };
}

function againOf(value: unknown): { jobId: string; index: number; sameSeed: boolean } {
  const fields = (value ?? {}) as Record<string, unknown>;
  return { jobId: v.nonEmptyText(fields.jobId, '照着再来的那组图'), index: v.index(fields.index, '图片'), sameSeed: v.bool(fields.sameSeed, '同一个种子') };
}

function refineOf(value: unknown): Refine {
  const fields = (value ?? {}) as Record<string, unknown>;
  return {
    jobId: v.nonEmptyText(fields.jobId, '要补做的那组图'),
    index: v.index(fields.index, '图片'),
    upscale: v.upscaleSettings(fields.upscale),
    details: v.detailPasses(fields.details),
  };
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
