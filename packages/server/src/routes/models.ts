import type { ModelKind } from '@media-agent/shared';
import express from 'express';
import type { ModelTransfers } from '../comfy/models';
import { HttpError } from '../httpError';

// 往 AutoDL 那台传模型：列出来、从电脑传之前看一眼、从电脑传、给链接下、停、删，见 docs/dev-plan.md 5.22。
// 出图那台在 /comfy/autodl/models 下；生成视频那台在 /comfy/video/models 下，只能传 LoRA
export function modelRoutes(models: ModelTransfers, base = '/comfy/autodl/models'): express.Router {
  const router = express.Router();

  const kindOf = (value: unknown): ModelKind => {
    if (!models.kinds.includes(value as ModelKind)) throw new HttpError(400, models.kinds.length === 1 ? '这台只能传 LoRA' : '模型类型不对');
    return value as ModelKind;
  };
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const sizeOf = (value: unknown) => {
    const size = Number(value);
    if (!Number.isSafeInteger(size) || size < 0) throw new HttpError(400, '文件大小不对');
    return size;
  };

  router.get(base, async (_req, res) => {
    res.json(await models.list());
  });

  router.post(`${base}/check`, async (req, res) => {
    const body = req.body ?? {};
    res.json(await models.check(kindOf(body.kind), text(body.folder), text(body.name), sizeOf(body.size), body.replace === true));
  });

  // 请求体就是文件本身，别的放在地址里；传完才返回。停了、出错时请求体还没收完的，回完话就断开，不再收剩下的
  router.post(`${base}/upload`, async (req, res) => {
    const { id, kind, folder, name, size, replace } = req.query;
    if (typeof id !== 'string' || !/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, '缺这次传输的 id');
    res.on('finish', () => {
      if (!req.complete) req.destroy();
    });
    res.json(await models.upload(req, { id, kind: kindOf(kind), folder: text(folder), name: text(name), size: sizeOf(size), replace: replace === '1' }));
  });

  router.post(`${base}/download`, async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.url !== 'string' || !body.url.trim()) throw new HttpError(400, '先填链接');
    res.status(201).json(await models.download({ kind: kindOf(body.kind), url: body.url, folder: text(body.folder), name: text(body.name), replace: body.replace === true }));
  });

  router.get(`${base}/transfers`, (_req, res) => {
    res.json(models.transfers());
  });

  router.post(`${base}/transfers/:id/stop`, (req, res) => {
    res.json(models.stop(String(req.params.id)));
  });

  router.delete(base, async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.path !== 'string' || !body.path) throw new HttpError(400, '要说删哪个');
    await models.remove(kindOf(body.kind), body.path);
    res.status(204).end();
  });

  return router;
}
