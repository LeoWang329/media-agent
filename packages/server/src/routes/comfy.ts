import type { ComfyStatus } from '@media-agent/shared';
import express from 'express';
import { systemStats } from '../comfy/client';
import { comfyOptions, loadObjectInfo } from '../comfy/options';
import { requireWorkFolder } from '../config';
import { HttpError } from '../httpError';
import { readSettings } from '../store/settings';

// 局域网那台 ComfyUI：测试连接、读下拉选项，见 docs/dev-plan.md 5.17
export function comfyRoutes(configDir: string): express.Router {
  const router = express.Router();
  const settings = async () => readSettings(await requireWorkFolder(configDir));

  router.get('/comfy/status', async (_req, res) => {
    const url = (await settings()).comfy.lanUrl;
    let status: ComfyStatus;
    if (!url) status = { ok: false, url: null, error: '还没填局域网 ComfyUI 的地址' };
    else {
      try {
        const stats = await systemStats(url);
        const device = stats.devices?.[0];
        status = {
          ok: true,
          url,
          version: stats.system?.comfyui_version ?? '',
          // 「cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync」只留显卡名
          gpu: (device?.name ?? '').replace(/^\S+:\d+\s+/, '').replace(/\s+:\s+\S+$/, ''),
          vramTotal: device?.vram_total ?? 0,
          vramFree: device?.vram_free ?? 0,
        };
      } catch (err) {
        status = { ok: false, url, error: (err as Error).message };
      }
    }
    res.json(status);
  });

  // refresh=1 重读，不然用缓存
  router.get('/comfy/options', async (req, res) => {
    const { comfy, checkpoints } = await settings();
    if (!comfy.lanUrl) throw new HttpError(400, '还没填局域网 ComfyUI 的地址');
    const info = await loadObjectInfo(comfy.lanUrl, req.query.refresh === '1').catch((err: Error) => {
      throw new HttpError(502, err.message);
    });
    res.json(comfyOptions(info, checkpoints));
  });

  return router;
}
