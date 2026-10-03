import type { FragmentCategory } from '@media-agent/shared';
import express from 'express';
import { requireWorkFolder } from '../config';
import { HttpError } from '../httpError';
import { createFragment, deleteFragment, FRAGMENT_CATEGORIES, listFragments, updateFragment, type FragmentFields } from '../store/fragments';
import * as v from './validate';

// 只取请求里带了的项；新建时三项都要有
function fields(body: unknown, all: boolean): Partial<FragmentFields> {
  const input = (body ?? {}) as Record<string, unknown>;
  const result: Partial<FragmentFields> = {};
  if (all || input.name !== undefined) result.name = v.nonEmptyText(input.name, '片段名字').trim();
  if (all || input.category !== undefined) {
    if (!FRAGMENT_CATEGORIES.includes(input.category as FragmentCategory)) throw new HttpError(400, '分类只能是角色、画风、质量词、其他');
    result.category = input.category as FragmentCategory;
  }
  if (all || input.text !== undefined) result.text = v.nonEmptyText(input.text, '片段里的标签').trim();
  return result;
}

export function fragmentRoutes(configDir: string): express.Router {
  const router = express.Router();
  const work = () => requireWorkFolder(configDir);

  router.get('/fragments', async (_req, res) => {
    res.json(await listFragments(await work()));
  });

  router.post('/fragments', async (req, res) => {
    res.status(201).json(await createFragment(await work(), fields(req.body, true) as FragmentFields));
  });

  router.patch('/fragments/:id', async (req, res) => {
    res.json(await updateFragment(await work(), v.uuid(req.params.id), fields(req.body, false)));
  });

  router.delete('/fragments/:id', async (req, res) => {
    await deleteFragment(await work(), v.uuid(req.params.id));
    res.status(204).end();
  });

  return router;
}
