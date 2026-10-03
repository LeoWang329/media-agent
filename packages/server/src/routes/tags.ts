import { FAMILIES, familyWords, type Family, type TagUpdateEvent } from '@media-agent/shared';
import express from 'express';
import { requireWorkFolder } from '../config';
import { HttpError } from '../httpError';
import { convertToTags } from '../llm/toTags';
import { readSettings } from '../store/settings';
import { loadLibrary } from '../tags/library';
import { checkTag, searchTags } from '../tags/search';
import { stopTagUpdate, TagUpdateStopped, tagUpdateRunning, updateTagLibrary, type TagSources } from '../tags/update';
import * as v from './validate';

export function tagRoutes(configDir: string, sources: TagSources): express.Router {
  const router = express.Router();
  const work = () => requireWorkFolder(configDir);

  router.get('/tags/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(searchTags(await loadLibrary(await work()), q));
  });

  // family 给了的话，这个系列固定开头和评级词里的词（照设置里的写法）也算认识
  router.post('/tags/check', async (req, res) => {
    const tags: unknown = req.body?.tags;
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) throw new HttpError(400, 'tags 要是一组文字');
    const family: unknown = req.body?.family;
    if (family !== undefined && !FAMILIES.includes(family as Family)) throw new HttpError(400, '系列只能是 IL 或 Pony');
    const w = await work();
    const known = family ? familyWords((await readSettings(w)).defaults[family as Family]) : undefined;
    const library = await loadLibrary(w);
    res.json(tags.map((tag: string) => checkTag(library, tag, known)));
  });

  // 标签编辑窗里「让 AI 转成标签」，等模型写完才返回
  router.post('/tags/convert', async (req, res) => {
    const canvasId = v.uuid(req.body?.canvasId);
    const nodeId = v.uuid(req.body?.nodeId);
    const text = v.nonEmptyText(req.body?.text, '要转的中文').trim();
    res.json(await convertToTags({ configDir, work: await work(), canvasId, nodeId }, text));
  });

  router.get('/tags/info', async (_req, res) => {
    res.json((await loadLibrary(await work())).info);
  });

  // 一页一页下，大约 4 分钟，进度用 SSE 推给前端；前端断开了照样下完
  router.post('/tags/update', async (_req, res) => {
    const w = await work();
    if (tagUpdateRunning()) throw new HttpError(409, '词库正在更新，等这一次下完');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (event: TagUpdateEvent) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      send({ type: 'done', info: await updateTagLibrary(w, sources, send) });
    } catch (err) {
      send(err instanceof TagUpdateStopped ? { type: 'stopped' } : { type: 'error', message: (err as Error).message });
    }
    res.end();
  });

  router.post('/tags/update/stop', (_req, res) => {
    stopTagUpdate();
    res.status(204).end();
  });

  return router;
}
