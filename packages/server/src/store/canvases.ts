import {
  cardSummary,
  descendantIds,
  forkChain,
  forkTitle,
  isStarred,
  type Canvas,
  type CanvasDetail,
  type CanvasListItem,
  type CanvasNodeLayout,
  type ChatNode,
} from '@media-agent/shared';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../httpError';
import { readImages } from './images';
import { readJson, trashName, writeJsonAtomic } from './jsonFile';
import { withLock } from './locks';

// fork 出的节点放在原节点右侧、已有子节点的下方
const FORK_OFFSET_X = 320;
const FORK_OFFSET_Y = 240;

const now = () => new Date().toISOString();
const canvasDir = (work: string, canvasId: string) => path.join(work, 'canvases', canvasId);
const canvasFile = (work: string, canvasId: string) => path.join(canvasDir(work, canvasId), 'canvas.json');
const nodesDir = (work: string, canvasId: string) => path.join(canvasDir(work, canvasId), 'nodes');
const nodeFile = (work: string, canvasId: string, nodeId: string) => path.join(nodesDir(work, canvasId), `${nodeId}.json`);

export async function listCanvases(work: string): Promise<CanvasListItem[]> {
  const entries = await fs.readdir(path.join(work, 'canvases'), { withFileTypes: true });
  const items: CanvasListItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const canvas = await readJson<Canvas>(canvasFile(work, entry.name));
    if (canvas) items.push({ id: canvas.id, title: canvas.title, updatedAt: canvas.updatedAt, nodeCount: canvas.nodes.length });
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createCanvas(work: string, title: string): Promise<Canvas> {
  const time = now();
  const canvas: Canvas = { id: randomUUID(), title, createdAt: time, updatedAt: time, nodes: [] };
  await fs.mkdir(nodesDir(work, canvas.id), { recursive: true });
  await writeJsonAtomic(canvasFile(work, canvas.id), canvas);
  return canvas;
}

export async function readCanvas(work: string, canvasId: string): Promise<Canvas> {
  const canvas = await readJson<Canvas>(canvasFile(work, canvasId));
  if (!canvas) throw new HttpError(404, '找不到这个画布');
  return canvas;
}

export function updateCanvas(work: string, canvasId: string, change: (canvas: Canvas) => void | Promise<void>): Promise<Canvas> {
  return withLock(`canvas:${canvasId}`, async () => {
    const canvas = await readCanvas(work, canvasId);
    await change(canvas);
    canvas.updatedAt = now();
    await writeJsonAtomic(canvasFile(work, canvasId), canvas);
    return canvas;
  });
}

export async function listNodes(work: string, canvasId: string): Promise<ChatNode[]> {
  const dir = nodesDir(work, canvasId);
  const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.json'));
  const nodes = await Promise.all(files.map((file) => readJson<ChatNode>(path.join(dir, file))));
  return nodes.filter((node): node is ChatNode => node !== null);
}

export async function canvasDetail(work: string, canvasId: string): Promise<CanvasDetail> {
  const canvas = await readCanvas(work, canvasId);
  const nodes = new Map((await listNodes(work, canvasId)).map((node) => [node.id, node]));
  return {
    canvas,
    images: await readImages(work, canvasId),
    nodes: canvas.nodes.flatMap((layout) => {
      const node = nodes.get(layout.id);
      if (!node) return [];
      return [{ ...layout, title: node.title, parentNodeId: node.parentNodeId, slots: node.slots, ...cardSummary(node), starred: isStarred(node) }];
    }),
  };
}

export async function trashCanvas(work: string, canvasId: string): Promise<void> {
  await readCanvas(work, canvasId);
  await withLock(`canvas:${canvasId}`, () => fs.rename(canvasDir(work, canvasId), path.join(work, '.trash', trashName('canvas', canvasId))));
}

export async function readNode(work: string, canvasId: string, nodeId: string): Promise<ChatNode> {
  const node = await readJson<ChatNode>(nodeFile(work, canvasId, nodeId));
  if (!node) throw new HttpError(404, '找不到这个节点');
  return node;
}

export function updateNode(work: string, canvasId: string, nodeId: string, change: (node: ChatNode) => ChatNode): Promise<ChatNode> {
  return withLock(`node:${nodeId}`, async () => {
    const next = { ...change(await readNode(work, canvasId, nodeId)), updatedAt: now() };
    await writeJsonAtomic(nodeFile(work, canvasId, nodeId), next);
    return next;
  });
}

export async function createNode(
  work: string,
  canvasId: string,
  fields: { x: number; y: number; modelConfigId: string; systemPromptName: string },
): Promise<ChatNode> {
  await readCanvas(work, canvasId);
  const time = now();
  const node: ChatNode = {
    id: randomUUID(),
    canvasId,
    title: '新节点',
    titleIsManual: false,
    parentNodeId: null,
    forkedFromMessageId: null,
    modelConfigId: fields.modelConfigId,
    systemPromptName: fields.systemPromptName,
    slots: [],
    duration: 8,
    aspectRatio: '16:9',
    messages: {},
    rootIds: [],
    activeChildOf: {},
    draft: '',
    createdAt: time,
    updatedAt: time,
  };
  await writeJsonAtomic(nodeFile(work, canvasId, node.id), node);
  await updateCanvas(work, canvasId, (canvas) => {
    canvas.nodes.push({ id: node.id, x: fields.x, y: fields.y, collapsed: false });
  });
  return node;
}

export async function forkNode(work: string, canvasId: string, sourceId: string, messageId: string, draftPrefix?: string): Promise<ChatNode> {
  const source = await readNode(work, canvasId, sourceId);
  if (!source.messages[messageId]) throw new HttpError(404, '找不到这条消息');
  const chain = forkChain(source, messageId, draftPrefix);
  const time = now();
  const node: ChatNode = {
    id: randomUUID(),
    canvasId,
    title: forkTitle(source.title),
    titleIsManual: false,
    parentNodeId: source.id,
    forkedFromMessageId: messageId,
    modelConfigId: source.modelConfigId,
    systemPromptName: source.systemPromptName,
    slots: chain.slots,
    duration: chain.duration,
    aspectRatio: chain.aspectRatio,
    messages: chain.messages,
    rootIds: chain.rootIds,
    activeChildOf: chain.activeChildOf,
    draft: chain.draft,
    createdAt: time,
    updatedAt: time,
  };
  await writeJsonAtomic(nodeFile(work, canvasId, node.id), node);
  await updateCanvas(work, canvasId, async (canvas) => {
    const siblingIds = (await listNodes(work, canvasId)).filter((n) => n.parentNodeId === source.id && n.id !== node.id).map((n) => n.id);
    const parent = canvas.nodes.find((layout) => layout.id === source.id);
    const siblings = canvas.nodes.filter((layout) => siblingIds.includes(layout.id));
    // 原节点折叠着的话展开，不然新节点看不见
    if (parent) parent.collapsed = false;
    canvas.nodes.push({
      id: node.id,
      x: (parent?.x ?? 0) + FORK_OFFSET_X,
      y: siblings.length ? Math.max(...siblings.map((s) => s.y)) + FORK_OFFSET_Y : (parent?.y ?? 0),
      collapsed: false,
    });
  });
  return node;
}

type NodeTrash = { canvasId: string; deletedAt: string; layouts: CanvasNodeLayout[] };

// 删除节点连同子孙：节点文件和它们在画布上的位置一起移到 .trash，返回删掉的 id 和回收站里那个文件夹的名字
export async function trashNodes(work: string, canvasId: string, nodeId: string): Promise<{ deleted: string[]; trash: string }> {
  const nodes = await listNodes(work, canvasId);
  if (!nodes.some((node) => node.id === nodeId)) throw new HttpError(404, '找不到这个节点');
  const ids = [nodeId, ...descendantIds(nodes, nodeId)];
  const trash = trashName('nodes', nodeId);
  const target = path.join(work, '.trash', trash);
  await fs.mkdir(path.join(target, 'nodes'), { recursive: true });

  let layouts: CanvasNodeLayout[] = [];
  await updateCanvas(work, canvasId, (canvas) => {
    layouts = canvas.nodes.filter((layout) => ids.includes(layout.id));
    canvas.nodes = canvas.nodes.filter((layout) => !ids.includes(layout.id));
  });
  for (const id of ids) {
    await withLock(`node:${id}`, () => fs.rename(nodeFile(work, canvasId, id), path.join(target, 'nodes', `${id}.json`)));
  }
  await writeJsonAtomic(path.join(target, 'manifest.json'), { canvasId, deletedAt: now(), layouts } satisfies NodeTrash);
  return { deleted: ids, trash };
}

// 撤销删除：把 .trash 里那一份挪回来，位置也照原样放回画布
export async function restoreNodes(work: string, canvasId: string, trash: string): Promise<string[]> {
  const dir = path.join(work, '.trash', trash);
  const manifest = await readJson<NodeTrash>(path.join(dir, 'manifest.json'));
  if (!manifest || manifest.canvasId !== canvasId) throw new HttpError(404, '回收站里找不到要恢复的节点');
  const files = (await fs.readdir(path.join(dir, 'nodes'))).filter((file) => file.endsWith('.json'));
  for (const file of files) {
    const id = path.basename(file, '.json');
    await withLock(`node:${id}`, () => fs.rename(path.join(dir, 'nodes', file), nodeFile(work, canvasId, id)));
  }
  await updateCanvas(work, canvasId, (canvas) => {
    for (const layout of manifest.layouts) {
      if (!canvas.nodes.some((node) => node.id === layout.id)) canvas.nodes.push(layout);
    }
  });
  await fs.rm(dir, { recursive: true, force: true });
  return manifest.layouts.map((layout) => layout.id);
}
