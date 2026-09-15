import express from 'express';
import { requireWorkFolder } from '../config';
import { openExternal } from '../native/openExternal';
import { createPrompt, listPrompts, promptFile, readFormatRequirement, readPrompt, savePrompt, trashPrompt } from '../store/prompts';
import * as v from './validate';

export function promptRoutes(configDir: string): express.Router {
  const router = express.Router();
  const work = () => requireWorkFolder(configDir);

  router.get('/prompts', async (_req, res) => {
    res.json(await listPrompts(await work()));
  });

  router.post('/prompts', async (req, res) => {
    const name = v.nonEmptyText(req.body?.name, '名字').trim();
    const text = v.text(req.body?.text ?? '', '内容');
    await createPrompt(await work(), name, text);
    res.status(201).json({ name, text });
  });

  router.get('/prompts/:name', async (req, res) => {
    res.json({ name: req.params.name, text: await readPrompt(await work(), req.params.name) });
  });

  router.put('/prompts/:name', async (req, res) => {
    const text = v.text(req.body?.text, '内容');
    await savePrompt(await work(), req.params.name, text);
    res.json({ name: req.params.name, text });
  });

  router.delete('/prompts/:name', async (req, res) => {
    await trashPrompt(await work(), req.params.name);
    res.status(204).end();
  });

  router.post('/prompts/:name/open', async (req, res) => {
    const w = await work();
    await readPrompt(w, req.params.name);
    openExternal(promptFile(w, req.params.name));
    res.status(204).end();
  });

  router.get('/format-requirement', async (_req, res) => {
    res.json({ text: await readFormatRequirement() });
  });

  return router;
}
