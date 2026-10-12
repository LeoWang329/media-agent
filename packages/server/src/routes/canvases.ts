import {
  addMessage,
  defaultImageSettings,
  descendantIds,
  editDiff,
  editedPromptMessage,
  editedUserMessage,
  editFnOf,
  editSettingsOf,
  handwrittenMessage,
  isTurnLimit,
  parentKey,
  promptNameForFn,
  slotDiff,
  TURN_LIMITS,
  videoSettingsOf,
  type ChatNode,
  type ImageSettings,
  type Message,
  type NodeKind,
} from '@media-agent/shared';
import express, { type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { readConfig, requireWorkFolder } from '../config';
import { thumbnail } from '../assets/thumbs';
import { imageFamily } from '../comfy/jobs';
import { HttpError } from '../httpError';
import { isGenerating, runGeneration, stopGeneration, stopGenerations } from '../llm/generation';
import { imageLongSide } from '../llm/imageLongSide';
import { translatePrompt } from '../llm/translate';
import { revealInFolder } from '../native/reveal';
import { allowedPath } from '../paths';
import {
  canvasDetail,
  createCanvas,
  createNode,
  forkNode,
  listNodes,
  readCanvas,
  readNode,
  restoreCanvas,
  trashCanvas,
  restoreNodes,
  trashNodes,
  updateCanvas,
  updateNode,
} from '../store/canvases';
import { homeData } from '../store/home';
import { canvasImagePath, checklistPath, importImage, readImage, storeDroppedImage } from '../store/images';
import { canvasLeadPath, importLead, readLead, storeUploadedLead } from '../store/leads';
import { canvasMediaPath, importMedia, readMedia, storeUploadedMedia } from '../store/media';
import { DEFAULT_PROMPT, defaultPromptFor, listPromptInfos, readPromptMeta } from '../store/prompts';
import { readSettings } from '../store/settings';
import * as v from './validate';

// 提示词选错类型时的说法，见 docs/dev-plan.md 5.39
const KIND_PROMPT_ERROR = {
  video: '视频节点只能选写视频提示词的系统提示词',
  image: '生图节点只能选生图用的系统提示词',
  edit: '图像编辑节点只能选图像编辑用的系统提示词',
} satisfies Record<NodeKind, string>;

export function canvasRoutes(configDir: string): express.Router {
  const router = express.Router();
  const work = () => requireWorkFolder(configDir);
  const ids = (req: Request) => ({ canvasId: v.uuid(req.params.canvasId), nodeId: v.uuid(req.params.nodeId) });

  router.get('/home', async (_req, res) => {
    res.json(await homeData(await work(), isGenerating));
  });

  // 撤销删除画布：trash 是删的时候返回的那个文件夹名
  router.post('/canvases/restore', async (req, res) => {
    res.json({ id: await restoreCanvas(await work(), v.trashName(req.body?.trash)) });
  });

  router.post('/canvases', async (req, res) => {
    res.status(201).json(await createCanvas(await work(), v.nonEmptyText(req.body?.title, '画布标题').trim()));
  });

  router.get('/canvases/:canvasId', async (req, res) => {
    res.json(await canvasDetail(await work(), v.uuid(req.params.canvasId), isGenerating));
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
    // 等生成收完尾再挪进回收站，不然收尾时写的节点文件会在原处重新建出这个画布的文件夹
    await stopGenerations((await readCanvas(w, canvasId)).nodes.map((layout) => layout.id));
    res.json({ trash: await trashCanvas(w, canvasId) });
  });

  // 新建空节点：视频节点、生图节点或图像编辑节点，不说是视频节点；模型配置取第一个，系统提示词取这种节点默认的那套
  router.post('/canvases/:canvasId/nodes', async (req, res) => {
    const w = await work();
    const kind = req.body?.kind === undefined ? 'video' : v.nodeKind(req.body.kind);
    const [{ modelConfigs }, prompt] = await Promise.all([readConfig(configDir), defaultPromptFor(w, kind)]);
    if (!prompt && kind === 'image') throw new HttpError(400, '设置里还没有生图用的系统提示词');
    if (!prompt && kind === 'edit') throw new HttpError(400, '设置里还没有图像编辑用的系统提示词');
    const node = await createNode(w, v.uuid(req.params.canvasId), {
      x: v.finiteNumber(req.body?.x, '节点位置'),
      y: v.finiteNumber(req.body?.y, '节点位置'),
      modelConfigId: modelConfigs[0]?.id ?? '',
      kind,
      systemPromptName: prompt ?? DEFAULT_PROMPT,
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
    let resetImage = false;
    const before = await readNode(w, canvasId, nodeId);
    // 图像编辑节点换了功能：系统提示词自己换成那个功能那一份（每份说明段里写着「功能: 」），见 docs/dev-plan.md 5.39。
    // 请求里明写了 systemPromptName 的照请求里的来
    if (body.edit !== undefined && body.systemPromptName === undefined && before.kind === 'edit') {
      const fn = editFnOf(v.editSettings(body.edit, editSettingsOf(before.edit, before.slots.length)).fn);
      const name = promptNameForFn(await listPromptInfos(w), fn);
      if (name && name !== before.systemPromptName) body.systemPromptName = name;
    }
    // 节点的类型建好就定了，系统提示词只能换成这种节点用的
    if (typeof body.systemPromptName === 'string') {
      const [node, meta] = await Promise.all([readNode(w, canvasId, nodeId), readPromptMeta(w, body.systemPromptName)]);
      if ((meta?.use ?? 'video') !== node.kind) throw new HttpError(400, KIND_PROMPT_ERROR[node.kind]);
      const old = await readPromptMeta(w, node.systemPromptName);
      resetImage = meta?.family !== old?.family && (meta?.family === 'Krea2' || old?.family === 'Krea2');
      if (resetImage && body.image === undefined) body.image = {};
    }
    // 改出图设置：节点还没改过的，先按它系列的默认值补全
    let imageBase: ImageSettings | undefined;
    if (body.image !== undefined) {
      const promptName = typeof body.systemPromptName === 'string' ? body.systemPromptName : before.systemPromptName;
      const family = await imageFamily(w, promptName);
      imageBase = defaultImageSettings((await readSettings(w)).defaults[family], family);
    }
    const node = await updateNode(w, canvasId, nodeId, (current) => applyNodePatch(resetImage ? { ...current, image: undefined } : current, body, imageBase));
    if (body.title !== undefined) await updateCanvas(w, canvasId, () => {});
    res.json(node);
  });

  router.delete('/canvases/:canvasId/nodes/:nodeId', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const w = await work();
    // 和删画布一样先等生成收完尾，撤销回来的回复才完整、带着「已叫停」
    await stopGenerations([nodeId, ...descendantIds(await listNodes(w, canvasId), nodeId)]);
    res.json(await trashNodes(w, canvasId, nodeId));
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
    const w = await work();
    await runGeneration({ configDir, work: w, canvasId, nodeId }, res, (node) => {
      const parent = parentId === null ? null : node.messages[parentId];
      if (parent === undefined) throw new HttpError(404, '找不到要接着回复的那条消息');
      // 和上一条消息记下的槽位、时长、比例比，算出这次带哪些图、加什么说明；生图节点不说时长和比例。
      // 图像编辑节点只把选中的那张发给模型（模型要看着它写「要改什么」），见 docs/dev-plan.md 5.39
      const { systemNote, attachments, frames } =
        node.kind === 'edit' ? editDiff(node.slots, editSettingsOf(node.edit, node.slots.length)) : slotDiff(parent, node, node.kind);
      const userMessage: Message = {
        id: randomUUID(),
        parentId,
        role: 'user',
        createdAt: new Date().toISOString(),
        text,
        slotSnapshot: [...node.slots],
        ...(node.media?.length && { mediaSnapshot: node.media.map((m) => ({ ...m })) }),
        duration: node.duration,
        aspectRatio: node.aspectRatio,
        ...(systemNote !== undefined && { systemNote }),
        attachments,
        ...(frames && { frames }),
      };
      return { node: { ...addMessage(node, userMessage), draft: '' }, userMessage, replyTo: userMessage };
    });
  });

  router.post('/canvases/:canvasId/nodes/:nodeId/messages/:messageId/regenerate', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    await runGeneration({ configDir, work: await work(), canvasId, nodeId }, res, (node) => {
      const target = node.messages[req.params.messageId];
      if (target?.role !== 'assistant' || !target.parentId) throw new HttpError(404, '找不到这条回复');
      if (target.handwritten) throw new HttpError(400, '这个框是自己写的，不是 AI 回的，没法重答');
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

  const llmLongSide = (w: string, canvasId: string, nodeId: unknown) => imageLongSide(configDir, w, canvasId, nodeId === undefined ? undefined : v.uuid(nodeId));

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

  // 视频和音频，见 docs/dev-plan.md 5.31：原样复制进画布；多长、宽高、有没有声音是浏览器读好发来的
  router.post('/canvases/:canvasId/media', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    await readCanvas(w, canvasId);
    const source = await allowedPath(configDir, req.body?.path);
    res.json(await importMedia(w, canvasId, source, v.mediaMeta(req.body ?? {})));
  });

  // 从文件夹拖进来的：请求体就是文件，边收边存，不整个读进内存
  router.post('/canvases/:canvasId/media/upload', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    await readCanvas(w, canvasId);
    res.json(await storeUploadedMedia(w, canvasId, v.fileName(req.query.name), req, v.mediaMeta(req.query as Record<string, unknown>)));
  });

  router.get('/canvases/:canvasId/media/:mediaId/file', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    res.sendFile(canvasMediaPath(w, canvasId, await readMedia(w, canvasId, v.uuid(req.params.mediaId))), { dotfiles: 'allow' });
  });

  // 「续写起点」的前一段视频，见 docs/dev-plan.md 5.35：从资产库或电脑上的文件复制进画布。
  // 和视频素材那套不一样：不读时长宽高（浏览器不一定读得出来，HEVC 就报不出宽高），规整是在那台上做的
  router.post('/canvases/:canvasId/leads', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    await readCanvas(w, canvasId);
    res.json(await importLead(w, canvasId, await allowedPath(configDir, req.body?.path)));
  });

  // 从文件夹拖进来的：请求体就是文件，边收边存，不整个读进内存
  router.post('/canvases/:canvasId/leads/upload', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    await readCanvas(w, canvasId);
    res.json(await storeUploadedLead(w, canvasId, v.fileName(req.query.name), req));
  });

  // 界面里试着播一下前一段视频（认不出来的编码播不了不要紧，能当起点用）
  router.get('/canvases/:canvasId/leads/:leadId/file', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    res.sendFile(canvasLeadPath(w, canvasId, await readLead(w, canvasId, v.uuid(req.params.leadId))), { dotfiles: 'allow' });
  });

  router.get('/canvases/:canvasId/images/:imageId/checklist-path', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    res.json(await checklistPath(w, canvasId, await readImage(w, canvasId, v.uuid(req.params.imageId))));
  });

  // 上传清单里的「在资源管理器里显示」：按图片查该传的那个文件，页面不传路径
  router.post('/canvases/:canvasId/images/:imageId/reveal', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    revealInFolder((await checklistPath(w, canvasId, await readImage(w, canvasId, v.uuid(req.params.imageId)))).path);
    res.status(204).end();
  });

  router.get('/canvases/:canvasId/images/:imageId/file', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    const file = canvasImagePath(w, canvasId, await readImage(w, canvasId, v.uuid(req.params.imageId)));
    res.sendFile(file, { dotfiles: 'allow' });
  });

  router.get('/canvases/:canvasId/images/:imageId/thumb', async (req, res) => {
    const canvasId = v.uuid(req.params.canvasId);
    const w = await work();
    const file = canvasImagePath(w, canvasId, await readImage(w, canvasId, v.uuid(req.params.imageId)));
    res.sendFile(await thumbnail(configDir, file), { dotfiles: 'allow' });
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

  // 自己写的框（生图节点的「写标签」）：接在 parentId 后面，不调模型
  router.post('/canvases/:canvasId/nodes/:nodeId/handwritten', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const text = v.nonEmptyText(req.body?.text, '标签');
    const parentId: string | null = req.body?.parentId ?? null;
    if (isGenerating(nodeId)) throw new HttpError(409, '这个节点正在生成回复，先停止或等它写完');
    res.status(201).json(
      await updateNode(await work(), canvasId, nodeId, (node) => {
        if (parentId !== null && !node.messages[parentId]) throw new HttpError(404, '找不到要接在后面的那条消息');
        return addMessage(node, handwrittenMessage(node, parentId, text, randomUUID(), new Date().toISOString()));
      }),
    );
  });

  // 翻译提示词框：问一次模型，译文存进这条回复，返回这份译文；同一个框同一种语言再翻就换掉旧的
  router.post('/canvases/:canvasId/nodes/:nodeId/messages/:messageId/translate', async (req, res) => {
    const { canvasId, nodeId } = ids(req);
    const promptIndex = v.index(req.body?.promptIndex, '提示词框');
    const language = v.language(req.body?.language);
    const instruction = req.body?.instruction === undefined ? '' : v.text(req.body.instruction, '翻译要求');
    res.json(await translatePrompt({ configDir, work: await work(), canvasId, nodeId, messageId: req.params.messageId, promptIndex }, language, instruction));
  });

  router.post('/canvases/:canvasId/nodes/:nodeId/stop', (req, res) => {
    res.json({ stopped: stopGeneration(ids(req).nodeId) });
  });

  return router;
}

function applyNodePatch(node: ChatNode, body: Record<string, unknown>, imageBase: ImageSettings | undefined): ChatNode {
  const next = { ...node };
  if (body.title !== undefined) {
    next.title = v.nonEmptyText(body.title, '节点标题').trim();
    next.titleIsManual = true;
  }
  if (body.modelConfigId !== undefined) next.modelConfigId = v.text(body.modelConfigId, '模型配置');
  if (body.systemPromptName !== undefined) next.systemPromptName = v.nonEmptyText(body.systemPromptName, '系统提示词');
  if (body.slots !== undefined) next.slots = v.slots(body.slots);
  if (body.media !== undefined) {
    const media = v.mediaSlots(body.media);
    if (media.length && node.kind !== 'video') throw new HttpError(400, '生图节点不能放视频和音频');
    next.media = media;
  }
  if (body.duration !== undefined) next.duration = v.duration(body.duration);
  if (body.aspectRatio !== undefined) next.aspectRatio = v.aspectRatio(body.aspectRatio);
  if (body.draft !== undefined) next.draft = v.text(body.draft, '输入框内容');
  if (body.turnLimit !== undefined) {
    if (body.turnLimit !== 'follow' && !isTurnLimit(body.turnLimit)) throw new HttpError(400, `最多带几轮只能是 follow、all、${TURN_LIMITS.join('、')}`);
    next.turnLimit = body.turnLimit;
  }
  // 节点存的出图设置里没有的项（后来加的）用系列的默认值补上
  if (body.image !== undefined) next.image = v.imageSettings(body.image, { ...imageBase!, ...node.image });
  // 图像编辑节点记住的功能、用哪张图、那句话，见 docs/dev-plan.md 5.39。
  // 走 editSettingsOf 补全：老节点缺 real / inpaint 两层时也得是完整的一份（不然存下去会缺字段）
  if (body.edit !== undefined) next.edit = v.editSettings(body.edit, editSettingsOf(node.edit, node.slots.length));
  if (body.video !== undefined) next.video = v.videoSettings(body.video, videoSettingsOf(node.video));
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
