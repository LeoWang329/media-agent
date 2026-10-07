import express, { type Request } from 'express';
import { copyVideoToFolder, videoFile } from '../comfy/files';
import type { VideoAgain, VideoJobs, VideoPlace, VideoReshoot } from '../comfy/videoJobs';
import { requireWorkFolder, setLastDownloadFolder } from '../config';
import { HttpError } from '../httpError';
import { readNode } from '../store/canvases';
import { chosenFolder } from './assets';
import * as v from './validate';

// 生成视频：建任务、叫停、删掉、看视频、下载、推送状态，见 docs/dev-plan.md 5.27、5.28
export function videoRoutes(configDir: string, jobs: VideoJobs): express.Router {
  const router = express.Router();
  const base = '/canvases/:canvasId/nodes/:nodeId/messages/:messageId/videos';
  const place = async (req: Request): Promise<VideoPlace> => ({
    work: await requireWorkFolder(configDir),
    canvasId: v.uuid(req.params.canvasId),
    nodeId: v.uuid(req.params.nodeId),
    messageId: String(req.params.messageId),
  });

  // again 是「同样参数再来」「只换种子再来」，照着那一条的参数；reshoot 是在一条出完的视频上重拍一截，见 docs/dev-plan.md 5.30
  router.post(base, async (req, res) => {
    const again = req.body?.again === undefined ? undefined : againOf(req.body.again);
    const reshoot = req.body?.reshoot === undefined ? undefined : reshootOf(req.body.reshoot);
    const promptIndex = again || reshoot ? 0 : v.index(req.body?.promptIndex, '提示词框');
    res.status(201).json(await jobs.create(await place(req), promptIndex, again, reshoot));
  });

  router.post(`${base}/:jobId/stop`, async (req, res) => {
    res.json(await jobs.stop(await place(req), String(req.params.jobId)));
  });

  router.delete(`${base}/:jobId`, async (req, res) => {
    await jobs.remove(await place(req), String(req.params.jobId));
    res.status(204).end();
  });

  // 临时文件清掉了用下载的那份；都不在返回 404，界面上显示「已清理」。sendFile 认 Range，能拖进度条
  router.get(`${base}/:jobId/file`, async (req, res) => {
    res.sendFile((await findVideo(await place(req), String(req.params.jobId))).file, { dotfiles: 'allow' });
  });

  // 下载：复制到选好的文件夹，记下存到哪。视频不进资产库，不问要不要导入
  router.post('/videos/download', async (req, res) => {
    const item = downloadItem(req.body?.item);
    const folder = await chosenFolder(configDir, req.body?.folder);
    const at = { work: await requireWorkFolder(configDir), ...item };
    const { title, seed, file } = await findVideo(at, item.jobId);
    const saved = await copyVideoToFolder(file, folder, title, seed);
    await jobs.setSaved(at, item.jobId, saved);
    await setLastDownloadFolder(configDir, folder);
    res.json({ path: saved });
  });

  // 视频任务小窗：所有画布在做的、排着的和这次开程序以后完了的，见 docs/dev-plan.md 5.29
  router.get('/video-jobs', async (_req, res) => {
    res.json(await jobs.board());
  });

  router.get('/video-jobs/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const unsubscribe = jobs.subscribe((event) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    req.on('close', unsubscribe);
  });

  return router;
}

async function findVideo(place: VideoPlace, jobId: string): Promise<{ title: string; seed: number; file: string }> {
  const node = await readNode(place.work, place.canvasId, place.nodeId);
  const job = node.messages[place.messageId]?.videos?.find((j) => j.id === jobId);
  if (!job) throw new HttpError(404, '找不到这条视频');
  const file = await videoFile(place.work, job);
  if (!file) throw new HttpError(404, '这条视频已经清理掉了');
  return { title: node.title, seed: job.seed, file };
}

function againOf(value: unknown): VideoAgain {
  const fields = (value ?? {}) as Record<string, unknown>;
  return { jobId: v.nonEmptyText(fields.jobId, '照着再来的那条视频'), sameSeed: v.bool(fields.sameSeed, '同一个种子') };
}

function reshootOf(value: unknown): VideoReshoot {
  const fields = (value ?? {}) as Record<string, unknown>;
  const prompts: Record<number, string> = {};
  if (fields.prompts !== undefined) {
    if (typeof fields.prompts !== 'object' || fields.prompts === null) throw new HttpError(400, '改过的提示词格式不对');
    for (const [key, text] of Object.entries(fields.prompts)) prompts[v.index(Number(key), '提示词的段')] = v.text(text, '改过的提示词');
  }
  return {
    jobId: v.nonEmptyText(fields.jobId, '要重拍的那条视频'),
    from: v.index(fields.from, '重拍的开头帧'),
    to: v.index(fields.to, '重拍的结尾帧'),
    seed: fields.seed === null || fields.seed === undefined ? null : v.integer(fields.seed, '种子', 0),
    prompts,
  };
}

function downloadItem(value: unknown) {
  const fields = (value ?? {}) as Record<string, unknown>;
  return {
    canvasId: v.uuid(fields.canvasId),
    nodeId: v.uuid(fields.nodeId),
    messageId: v.nonEmptyText(fields.messageId, '消息 id'),
    jobId: v.nonEmptyText(fields.jobId, '这条视频的 id'),
  };
}
