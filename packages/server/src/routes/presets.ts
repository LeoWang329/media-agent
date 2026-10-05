import { defaultImageSettings, FAMILIES, FAMILY_DEFAULTS, type Family, type ImageSettings, type PresetSettings } from '@media-agent/shared';
import express from 'express';
import { requireWorkFolder } from '../config';
import { HttpError } from '../httpError';
import { createPreset, deletePreset, listPresets, updatePreset } from '../store/presets';
import * as v from './validate';

// 预设存张数、种子以外的全部出图设置，ControlNet 的参考图也不存，见 docs/dev-plan.md 5.21。按出图设置的规矩校验，没带的项用 base 的
function presetSettings(value: unknown, base: PresetSettings): PresetSettings {
  const { count: _count, seed: _seed, ...settings } = v.imageSettings(value, { ...base, count: 1, seed: null } satisfies ImageSettings);
  return { ...settings, controls: settings.controls.map((control) => ({ ...control, image: null })) };
}

function family(value: unknown): Family {
  if (!FAMILIES.includes(value as Family)) throw new HttpError(400, '系列只能是 IL 或 Pony');
  return value as Family;
}

const name = (value: unknown) => v.nonEmptyText(value, '预设的名字').trim();

export function presetRoutes(configDir: string): express.Router {
  const router = express.Router();
  const work = () => requireWorkFolder(configDir);

  router.get('/image-presets', async (_req, res) => {
    res.json(await listPresets(await work()));
  });

  router.post('/image-presets', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const which = family(body.family);
    const { count: _count, seed: _seed, ...base } = defaultImageSettings(FAMILY_DEFAULTS[which]);
    res.status(201).json(await createPreset(await work(), { name: name(body.name), family: which, settings: presetSettings(body.settings, base) }));
  });

  // 改名，或者用新的出图设置换掉原来的
  router.patch('/image-presets/:id', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(
      await updatePreset(await work(), v.uuid(req.params.id), (current) => ({
        ...(body.name !== undefined && { name: name(body.name) }),
        ...(body.settings !== undefined && { settings: presetSettings(body.settings, current.settings) }),
      })),
    );
  });

  router.delete('/image-presets/:id', async (req, res) => {
    await deletePreset(await work(), v.uuid(req.params.id));
    res.status(204).end();
  });

  return router;
}
