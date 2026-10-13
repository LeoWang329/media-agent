import { editSettingsOf, EDIT_FNS, type EditFnId, type EditSettings, type ImageTempInfo, type ImageWhere, type JobImage } from '@media-agent/shared';
import express, { type Request } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { thumbnail } from '../assets/thumbs';
import { copyToFolder, imageFile } from '../comfy/files';
import type { ImageJobs, EditJobRequest, InpaintRequest, JobPlace, Refine } from '../comfy/jobs';
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

  router.post('/canvases/:canvasId/nodes/:nodeId/four-view', async (req, res) => {
    const reference = v.refImage(req.body?.reference);
    if (!reference) throw new HttpError(400, '四视图还没选参考图');
    res.status(201).json(await jobs.fourView({ work: await requireWorkFolder(configDir), canvasId: v.uuid(req.params.canvasId), nodeId: v.uuid(req.params.nodeId) }, reference, v.text(req.body?.extra ?? '', '额外要求')));
  });

  // 图像编辑节点上点「开始」：走哪个功能、拿第几张图、要改什么，见 docs/dev-plan.md 5.39
  router.post('/canvases/:canvasId/nodes/:nodeId/edit', async (req, res) => {
    const work = await requireWorkFolder(configDir);
    const canvasId = v.uuid(req.params.canvasId);
    const nodeId = v.uuid(req.params.nodeId);
    // 底用节点上现在存的那份编辑设置，请求里的字段覆盖它 —— 只在请求里带一部分（比如只带 fn）时，
    // 才不会把用户选的反推 / 双图 / LoRA 悄悄换回默认值
    const node = await readNode(work, canvasId, nodeId);
    res.status(201).json(await jobs.editJob({ work, canvasId, nodeId }, editRequestOf(req, editSettingsOf(node.edit, node.slots.length))));
  });

  // again 是「同样参数再来」「只换种子再来」，照着那一张出一张；refine 是出完的图上补做放大和部位重绘
  router.post(base, async (req, res) => {
    const again = req.body?.again === undefined ? undefined : againOf(req.body.again);
    const refine = req.body?.refine === undefined ? undefined : refineOf(req.body.refine);
    const promptIndex = again || refine ? 0 : v.index(req.body?.promptIndex, '提示词框');
    res.status(201).json(await jobs.create(await place(req), promptIndex, { again, refine }));
  });

  // 局部重绘：掩码是把原图要重画的地方抠成透明的那张 PNG，见 docs/dev-plan.md 5.38
  router.post(`${base}/:jobId/:index/inpaint`, async (req, res) => {
    res.status(201).json(await jobs.create(await place(req), 0, { inpaint: inpaintOf(req) }));
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
    res.sendFile((await findImage(await place(req), String(req.params.jobId), imageIndex(req))).file, { dotfiles: 'allow' });
  });

  // 缩略图缓存在配置目录里，macOS / Linux 上是 ~/.media-agent；send 默认把点开头的目录当隐藏文件拒掉，得放开
  router.get(`${base}/:jobId/:index/thumb`, async (req, res) => {
    res.sendFile(await thumbnail(configDir, (await findImage(await place(req), String(req.params.jobId), imageIndex(req))).file), { dotfiles: 'allow' });
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

// 局部重绘的请求：这张图的序号在路径里，掩码是 base64 的 PNG，正面、负面可以不填（用原图那组的）
function inpaintOf(req: Request): InpaintRequest {
  const fields = (req.body ?? {}) as Record<string, unknown>;
  const denoise = v.finiteNumber(fields.denoise, '重绘强度');
  if (denoise <= 0 || denoise > 1) throw new HttpError(400, '重绘强度要大于 0、不超过 1');
  return {
    jobId: String(req.params.jobId),
    index: v.index(Number(req.params.index), '图片'),
    mask: v.pngBytes(fields.mask, '掩码'),
    positive: v.text(fields.positive ?? '', '要画成什么'),
    negative: v.text(fields.negative ?? '', '额外的负面词'),
    denoise,
  };
}

// 图像编辑节点「开始」的请求：用哪个功能、拿第几张图当原图、要改什么，见 docs/dev-plan.md 5.39。
// real / inpaint / depth / remix / upscale 几层收半份；base 是节点上现在存的那份设置，请求里没带的字段就用它
//（只带 fn 的请求也照节点走）。局部重绘在编辑节点里画的那份掩码跟大图窗口那条一样，是顶层一个 base64 PNG。
// 框上那个「开始」多带 messageId + promptIndex：服务端不新建回复，出的图挂在这条框下面，
// 见 docs/plan-image-edit-node-layout.md 第 4 节 ④
function editRequestOf(req: Request, base: EditSettings): EditJobRequest {
  const fields = (req.body ?? {}) as Record<string, unknown>;
  const fn = fields.fn ?? base.fn;
  // 认哪些功能照 EDIT_FNS 那张表来（别在这儿再抄一份名单，加功能时会漏）
  if (!EDIT_FNS.some((one) => one.id === fn)) throw new HttpError(400, '不认识这个编辑功能');
  const settings = v.editSettings(fields, base);
  return {
    fn: settings.fn as EditFnId,
    seed: settings.seed,
    candidate: settings.candidate,
    source: settings.source,
    outfitLora: settings.outfitLora,
    fourview: settings.fourview,
    slot: settings.slot,
    slotB: settings.slotB,
    text: settings.text,
    refBoost: settings.refBoost,
    real: settings.real,
    inpaint: settings.inpaint,
    depth: settings.depth,
    remix: settings.remix,
    upscale: settings.upscale,
    ...(fields.messageId !== undefined ? { messageId: v.nonEmptyText(fields.messageId, '消息 id') } : settings.candidate ? { messageId: settings.candidate.messageId } : {}),
    ...(fields.promptIndex !== undefined ? { promptIndex: v.index(fields.promptIndex, '提示词框') } : settings.candidate ? { promptIndex: settings.candidate.promptIndex } : {}),
    // 没带掩码：局部重绘这条路到 editParams 里会报「先在图上拖个框或者涂抹出要重画的地方」
    ...(fields.mask !== undefined && { maskBytes: v.pngBytes(fields.mask, '掩码') }),
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
