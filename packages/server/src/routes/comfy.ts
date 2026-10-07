import type { ComfyStatus } from '@media-agent/shared';
import express from 'express';
import type { Autodl } from '../comfy/autodl';
import { systemStats } from '../comfy/client';
import { comfyOptions, hasObjectInfo, loadObjectInfo, videoOptions } from '../comfy/options';
import { readComfyConfig, requireWorkFolder } from '../config';
import { HttpError } from '../httpError';
import { readSettings } from '../store/settings';

// 局域网那台 ComfyUI 和 AutoDL 实例：测试连接、读下拉选项、列实例、开机关机，见 docs/dev-plan.md 5.17。
// videoAutodl 是生成视频用的那台，见 docs/dev-plan.md 5.25
export function comfyRoutes(configDir: string, autodl: Autodl, videoAutodl: Autodl): express.Router {
  const router = express.Router();
  const settings = async () => readSettings(await requireWorkFolder(configDir));

  // target=autodl 回 AutoDL 实例的状态；别的回局域网那台连不连得上
  router.get('/comfy/status', async (req, res) => {
    if (req.query.target === 'autodl') {
      res.json(await autodl.refresh());
      return;
    }
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

  // 没说哪台就用这台电脑出图用的那台。refresh=1 重读，不然用缓存；AutoDL 关着时读过的照样给
  router.get('/comfy/options', async (req, res) => {
    const { comfy, checkpoints } = await settings();
    const target = req.query.target ?? (await readComfyConfig(configDir)).comfyTarget;
    const refresh = req.query.refresh === '1';
    let url: string | null;
    if (target === 'autodl') {
      url = await autodl.address();
      const last = autodl.lastAddress();
      if (!url && !refresh && last && hasObjectInfo(last)) url = last;
      if (!url) {
        throw new HttpError(400, autodl.current().state === 'unset' ? '先在设置里填 AutoDL 的开发者 Token、选好实例' : 'AutoDL 实例关着，开机后才读得到底模和 LoRA 列表');
      }
    } else {
      url = comfy.lanUrl;
      if (!url) throw new HttpError(400, '还没填局域网 ComfyUI 的地址');
    }
    const info = await loadObjectInfo(url, refresh).catch((err: Error) => {
      throw new HttpError(502, err.message);
    });
    res.json(comfyOptions(info, checkpoints));
  });

  router.get('/comfy/autodl/instances', async (_req, res) => {
    res.json(await autodl.instances());
  });

  router.post('/comfy/autodl/power', async (req, res) => {
    res.json(await autodl.power(powerOn(req.body)));
  });

  router.get('/comfy/video/status', async (_req, res) => {
    res.json(await videoAutodl.refresh());
  });

  router.post('/comfy/video/power', async (req, res) => {
    res.json(await videoAutodl.power(powerOn(req.body)));
  });

  // 生成设置里的主模型和 LoRA：从生成视频那台读，关着时读过的照样给，refresh=1 重读
  router.get('/comfy/video/options', async (req, res) => {
    const refresh = req.query.refresh === '1';
    let url = await videoAutodl.address();
    const last = videoAutodl.lastAddress();
    if (!url && !refresh && last && hasObjectInfo(last)) url = last;
    if (!url) throw new HttpError(400, videoAutodl.current().state === 'unset' ? '先在设置里选好生成视频用的实例' : '生成视频那台关着，开机后才读得到主模型和 LoRA');
    const info = await loadObjectInfo(url, refresh).catch((err: Error) => {
      throw new HttpError(502, err.message);
    });
    res.json(videoOptions(info));
  });

  return router;
}

function powerOn(body: unknown): boolean {
  const on = (body as { on?: unknown } | undefined)?.on;
  if (typeof on !== 'boolean') throw new HttpError(400, '要说开机还是关机：{on: true} 或 {on: false}');
  return on;
}
