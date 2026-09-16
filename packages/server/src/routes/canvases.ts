import { addMessage, DEFAULT_IMAGE_LONG_SIDE, editedPromptMessage, editedUserMessage, parentKey, slotDiff, type ChatNode, type Message } from '@media-agent/shared';
import express, { type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { readConfig, requireWorkFolder } from '../config';
import { thumbnail } from '../assets/thumbs';
import { HttpError } from '../httpError';
import { runGeneration, stopGeneration } from '../llm/generation';
import { allowedPath } from '../paths';
import {
  canvasDetail,
  createCanvas,
  createNode,
  forkNode,
  listCanvases,
  readCanvas,
  readNode,
  trashCanvas,
  restoreNodes,
  trashNodes,
  updateCanvas,
  updateNode,
} from '../store/canvases';
import { canvasImagePath, checklistPath, importImage, readImage, storeDroppedImage } from '../store/images';
import { DEFAULT_PROMPT, listPrompts } from '../store/prompts';
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
      systemPromptName: prompts.includes(DEFAULT_PROMPT) ? DEFAULT_PROMPT : (prompts[0] ?? DEFAULT_PROMPT),
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
    const { deleted, trash } = await trashNodes(await work(), canvasId, nodeId);
    deleted.forEach(stopGeneration);
    res.json({ deleted, trash });
  });

  // 撤销删除节点：trash 是删的时候返回的那个文件夹名
  router.post('/canvases/:canvasId/nodes/restore', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    res.json({ restored: await restoreNodes(await work(), canvasId, v.trashName(req.body?.trash)) });
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
      const parent = parentId === null ? null : node.messages[parentId];
      if (parent === undefined) throw new HttpError(404, '找不到要接着回复的那条消息');
      // 和上一条消息记下的槽位、时长、比例比，算出这次带哪些图、加什么说明
      const { systemNote, attachments } = slotDiff(parent, node);
      const userMessage: Message = {
        id: randomUUID(),
        parentId,
        role: 'user',
        createdAt: new Date().toISOString(),
        text,
        slotSnapshot: [...node.slots],
        duration: node.duration,
        aspectRatio: node.aspectRatio,
        ...(systemNote !== undefined && { systemNote }),
        attachments,
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

  // 发给模型的小图按节点所选模型配置的发图长边缩
  const llmLongSide = async (w: string, canvasId: string, nodeId: unknown) => {
    if (nodeId === undefined) return DEFAULT_IMAGE_LONG_SIDE;
    const node = await readNode(w, canvasId, v.uuid(nodeId));
    return (await readConfig(configDir)).modelConfigs.find((m) => m.id === node.modelConfigId)?.imageLongSide ?? DEFAULT_IMAGE_LONG_SIDE;
  };

  // 放进槽位的图先复制进画布文件夹
  router.post('/canvases/:canvasId/images', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    await readCanvas(w, canvasId);
    const source = await allowedPath(configDir, req.body?.path);
    res.json(await importImage(w, canvasId, source, await llmLongSide(w, canvasId, req.body?.nodeId)));
  });

  // 从 Windows 文件夹拖进槽位的图：没有本机路径，浏览器直接把内容传上来
  router.post('/canvases/:canvasId/images/upload', express.raw({ type: '*/*', limit: '64mb' }), async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    await readCanvas(w, canvasId);
    const name = v.fileName(req.query.name);
    res.json(await storeDroppedImage(w, canvasId, name, req.body as Buffer, await llmLongSide(w, canvasId, req.query.nodeId)));
  });

  router.get('/canvases/:canvasId/images/:imageId/checklist-path', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    res.json(await checklistPath(w, canvasId, await readImage(w, canvasId, v.uuid(req.params.imageId))));
  });

  router.get('/canvases/:canvasId/images/:imageId/file', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    res.sendFile(canvasImagePath(w, canvasId, await readImage(w, canvasId, v.uuid(req.params.imageId))));
  });

  router.get('/canvases/:canvasId/images/:imageId/thumb', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    res.sendFile(await thumbnail(configDir, canvasImagePath(w, canvasId, await readImage(w, canvasId, v.uuid(req.params.imageId)))));
  });

  // 星打在提示词框上，卡片按「这个节点有没有星」显示
  router.post('/canvases/:canvasId/nodes/:nodeId/messages/:messageId/star', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const promptIndex = v.index(req.body?.promptIndex, '提示词框');
    const on = v.bool(req.body?.on, '星标');
    res.json(
      await updateNode(await work(), canvasId, nodeId, (node) => {
        const message = node.messages[req.params.messageId];
        if (message?.role !== 'assistant') throw new HttpError(404, '找不到这条回复');
        const stars = new Set(message.stars ?? []);
        if (on) stars.add(promptIndex);
        else stars.delete(promptIndex);
        return { ...node, messages: { ...node.messages, [message.id]: { ...message, stars: [...stars].sort((a, b) => a - b) } } };
      }),
    );
  });

  // 手动改提示词：新建一条回复的版本，不调模型
  router.post('/canvases/:canvasId/nodes/:nodeId/messages/:messageId/edit-prompt', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const promptIndex = v.index(req.body?.promptIndex, '提示词框');
    const text = v.text(req.body?.text, '提示词');
    res.json(
      await updateNode(await work(), canvasId, nodeId, (node) => {
        const original = node.messages[req.params.messageId];
        if (original?.role !== 'assistant') throw new HttpError(404, '找不到这条回复');
        const edited = editedPromptMessage(original, promptIndex, text, randomUUID(), new Date().toISOString());
        if (!edited) throw new HttpError(404, '这条回复里没有第 ' + (promptIndex + 1) + ' 个提示词框');
        return addMessage(node, edited);
      }),
    );
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
