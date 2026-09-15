import { addMessage, editedUserMessage, parentKey, type ChatNode, type Message } from '@media-agent/shared';
import express, { type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { readConfig, requireWorkFolder } from '../config';
import { HttpError } from '../httpError';
import { runGeneration, stopGeneration } from '../llm/generation';
import {
  canvasDetail,
  createCanvas,
  createNode,
  forkNode,
  listCanvases,
  readNode,
  trashCanvas,
  trashNodes,
  updateCanvas,
  updateNode,
} from '../store/canvases';
import { listPrompts } from '../store/prompts';
import * as v from './validate';

export function canvasRoutes(configDir: string): express.Router {
  const router = express.Router();
  const work = () => requireWorkFolder(configDir);
  const ids = (req: Request) => ({ canvasId: v.uuid(req.params.canvasId), nodeId: v.uuid(req.params.nodeId) });

  router.get('/canvases', async (_req, res) => {
    res.json(await listCanvases(await work()));
  });

  router.post('/canvases', async (req, res) => {
    res.status(201).json(await createCanvas(await work(), v.nonEmptyText(req.body?.title, '画布标题').trim()));
  });

  router.get('/canvases/:canvasId', async (req, res) => {
    res.json(await canvasDetail(await work(), v.uuid(req.params.canvasId)));
  });

  router.patch('/canvases/:canvasId', async (req, res) => {
    const { title, nodes } = req.body ?? {};
    const canvas = await updateCanvas(await work(), v.uuid(req.params.canvasId), (canvas) => {
      if (title !== undefined) canvas.title = v.nonEmptyText(title, '画布标题').trim();
      if (nodes !== undefined) {
        for (const item of v.layouts(nodes)) {
          const layout = canvas.nodes.find((l) => l.id === item.id);
          if (layout) Object.assign(layout, item);
        }
      }
    });
    res.json(canvas);
  });

  router.delete('/canvases/:canvasId', async (req, res) => {
    const w = await work();
    const canvasId = v.uuid(req.params.canvasId);
    (await canvasDetail(w, canvasId)).nodes.forEach((node) => stopGeneration(node.id));
    await trashCanvas(w, canvasId);
    res.status(204).end();
  });

  // 新建空节点：模型配置取第一个，系统提示词取 default
  router.post('/canvases/:canvasId/nodes', async (req, res) => {
    const w = await work();
    const [{ modelConfigs }, prompts] = await Promise.all([readConfig(configDir), listPrompts(w)]);
    const node = await createNode(w, v.uuid(req.params.canvasId), {
      x: v.finiteNumber(req.body?.x, '节点位置'),
      y: v.finiteNumber(req.body?.y, '节点位置'),
      modelConfigId: modelConfigs[0]?.id ?? '',
      systemPromptName: prompts.includes('default') ? 'default' : (prompts[0] ?? 'default'),
    });
    res.status(201).json(node);
  });

  router.get('/canvases/:canvasId/nodes/:nodeId', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    res.json(await readNode(await work(), canvasId, nodeId));
  });

  router.patch('/canvases/:canvasId/nodes/:nodeId', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const w = await work();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const node = await updateNode(w, canvasId, nodeId, (current) => applyNodePatch(current, body));
    if (body.title !== undefined) await updateCanvas(w, canvasId, () => {});
    res.json(node);
  });

  router.delete('/canvases/:canvasId/nodes/:nodeId', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const deleted = await trashNodes(await work(), canvasId, nodeId);
    deleted.forEach(stopGeneration);
    res.json({ deleted });
  });

  router.post('/canvases/:canvasId/nodes/:nodeId/fork', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const messageId = v.nonEmptyText(req.body?.messageId, '消息 id');
    const draftPrefix = req.body?.draftPrefix === undefined ? undefined : v.text(req.body.draftPrefix, '预填文字');
    res.status(201).json(await forkNode(await work(), canvasId, nodeId, messageId, draftPrefix));
  });

  router.post('/canvases/:canvasId/nodes/:nodeId/send', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const text = v.nonEmptyText(req.body?.text, '消息');
    const parentId: string | null = req.body?.parentId ?? null;
    await runGeneration({ configDir, work: await work(), canvasId, nodeId }, res, (node) => {
      if (parentId !== null && !node.messages[parentId]) throw new HttpError(404, '找不到要接着回复的那条消息');
      const userMessage: Message = {
        id: randomUUID(),
        parentId,
        role: 'user',
        createdAt: new Date().toISOString(),
        text,
        slotSnapshot: [...node.slots],
        duration: node.duration,
        aspectRatio: node.aspectRatio,
      };
      return { node: { ...addMessage(node, userMessage), draft: '' }, userMessage, replyTo: userMessage };
    });
  });

  router.post('/canvases/:canvasId/nodes/:nodeId/messages/:messageId/regenerate', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    await runGeneration({ configDir, work: await work(), canvasId, nodeId }, res, (node) => {
      const target = node.messages[req.params.messageId];
      if (target?.role !== 'assistant' || !target.parentId) throw new HttpError(404, '找不到这条回复');
      return { node, replyTo: node.messages[target.parentId] };
    });
  });

  router.post('/canvases/:canvasId/nodes/:nodeId/messages/:messageId/edit', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const text = v.nonEmptyText(req.body?.text, '消息');
    await runGeneration({ configDir, work: await work(), canvasId, nodeId }, res, (node) => {
      const original = node.messages[req.params.messageId];
      if (original?.role !== 'user') throw new HttpError(404, '找不到这条消息');
      const userMessage = editedUserMessage(original, text, randomUUID(), new Date().toISOString());
      return { node: addMessage(node, userMessage), userMessage, replyTo: userMessage };
    });
  });

  router.post('/canvases/:canvasId/nodes/:nodeId/stop', (req, res) => {
    res.json({ stopped: stopGeneration(ids(req).nodeId) });
  });

  return router;
}

function applyNodePatch(node: ChatNode, body: Record<string, unknown>): ChatNode {
  const next = { ...node };
  if (body.title !== undefined) {
    next.title = v.nonEmptyText(body.title, '节点标题').trim();
    next.titleIsManual = true;
  }
  if (body.modelConfigId !== undefined) next.modelConfigId = v.text(body.modelConfigId, '模型配置');
  if (body.systemPromptName !== undefined) next.systemPromptName = v.nonEmptyText(body.systemPromptName, '系统提示词');
  if (body.slots !== undefined) next.slots = v.slots(body.slots);
  if (body.duration !== undefined) next.duration = v.duration(body.duration);
  if (body.aspectRatio !== undefined) next.aspectRatio = v.aspectRatio(body.aspectRatio);
  if (body.draft !== undefined) next.draft = v.text(body.draft, '输入框内容');
  if (body.activeChildOf !== undefined) {
    const entries = Object.entries((body.activeChildOf ?? {}) as Record<string, unknown>);
    next.activeChildOf = { ...node.activeChildOf };
    for (const [key, id] of entries) {
      const message = typeof id === 'string' ? node.messages[id] : undefined;
      if (!message || parentKey(message.parentId) !== key) throw new HttpError(400, '要切换的版本不存在');
      next.activeChildOf[key] = message.id;
    }
  }
  return next;
}
