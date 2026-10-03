import {
  activePath,
  cardImageInfo,
  cardSummary,
  isOwnMessage,
  starredBoxes,
  TRANSLATE_LANGUAGES,
  type Canvas,
  type ChatNode,
  type HomeData,
  type ImageRecord,
  type PromptMeta,
  type StarredPrompt,
} from '@media-agent/shared';
import { HttpError } from '../httpError';
import { listNodes, readAllCanvases } from './canvases';
import { readImages } from './images';
import { promptMetaReader } from './prompts';

const RECENT_NODES = 8;
const UNREADABLE = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'];

type Loaded = { canvas: Canvas; images: Record<string, ImageRecord>; nodes: ChatNode[] };

// 画布封面：最近放进槽位的那张图
const coverOf = (images: Record<string, ImageRecord>) => Object.values(images).sort((a, b) => b.addedAt.localeCompare(a.addedAt))[0]?.id ?? null;

// 首页要的数据：读一遍所有画布和节点。工作文件夹读不了（同步盘没连上、文件夹挪走了）返回 503
export async function homeData(work: string, isGenerating: (nodeId: string) => boolean): Promise<HomeData> {
  const loaded = await readEverything(work).catch((err: NodeJS.ErrnoException) => {
    if (!UNREADABLE.includes(err.code ?? '')) throw err;
    throw new HttpError(503, err.code === 'EACCES' || err.code === 'EPERM' ? '没有权限读这个文件夹' : '找不到这个路径');
  });

  const metaOf = promptMetaReader(work);
  const starred = await starredPrompts(loaded, metaOf);
  // 「打过星」按上面列出来的算，和画布卡片一样：岔出去的节点复制来的星不算它的
  const starredNodes = new Set(starred.map((prompt) => prompt.nodeId));

  const canvases = loaded
    .map(({ canvas, images, nodes }) => ({
      id: canvas.id,
      title: canvas.title,
      updatedAt: [canvas.updatedAt, ...nodes.map((node) => node.updatedAt)].sort().at(-1)!,
      nodeCount: canvas.nodes.length,
      cover: coverOf(images),
      generating: nodes.filter((node) => isGenerating(node.id)).length,
      stars: nodes.filter((node) => starredNodes.has(node.id)).length,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // 最近动过的节点：自己发过消息的才算，岔出来还没发过的不算
  const recent = loaded
    .flatMap(({ canvas, nodes }) => nodes.map((node) => ({ canvasId: canvas.id, node })))
    .filter(({ node }) => Object.values(node.messages).some((message) => isOwnMessage(node, message)))
    .sort((a, b) => b.node.updatedAt.localeCompare(a.node.updatedAt))
    .slice(0, RECENT_NODES);
  const metas = await Promise.all(recent.map(({ node }) => metaOf(node.systemPromptName)));
  const recentNodes = recent.map(({ canvasId, node }, i) => ({
    id: node.id,
    canvasId,
    title: node.title,
    ...cardSummary(node),
    slots: node.slots,
    duration: node.duration,
    aspectRatio: node.aspectRatio,
    image: cardImageInfo(node, metas[i]),
    starred: starredNodes.has(node.id),
    generating: isGenerating(node.id),
    error: activePath(node).at(-1)?.error ?? null,
    updatedAt: node.updatedAt,
  }));

  // 只带节点和提示词用到的图
  const images: HomeData['images'] = {};
  const use = (canvasId: string, ids: string[]) => {
    const all = loaded.find((c) => c.canvas.id === canvasId)!.images;
    for (const id of ids) if (all[id]) (images[canvasId] ??= {})[id] = all[id];
  };
  recentNodes.forEach((node) => use(node.canvasId, node.slots));
  starred.forEach((prompt) => use(prompt.canvasId, prompt.images));

  return { canvases, recentNodes, starred, images };
}

// 打过星的提示词，所有版本都算，新写的在前
// 生图的框（看写这条回复时用的系统提示词）带上系列
async function starredPrompts(loaded: Loaded[], metaOf: (name: string) => Promise<PromptMeta | null>): Promise<StarredPrompt[]> {
  const boxes = loaded.flatMap(({ canvas, nodes }) => starredBoxes(nodes).map((starred) => ({ canvas, ...starred })));
  const metas = await Promise.all(boxes.map(({ message }) => metaOf(message.systemPromptName ?? '')));
  return boxes
    .map(({ canvas, node, message, promptIndex, box }, i) => ({
      canvasId: canvas.id,
      nodeId: node.id,
      nodeTitle: node.title,
      messageId: message.id,
      promptIndex,
      ...(box.label !== undefined && { label: box.label }),
      text: box.text,
      summary: box.summary,
      images: message.slotSnapshot,
      duration: message.duration,
      aspectRatio: message.aspectRatio,
      translations: (message.translations ?? [])
        .filter((t) => t.promptIndex === promptIndex)
        .sort((a, b) => TRANSLATE_LANGUAGES.indexOf(a.language) - TRANSLATE_LANGUAGES.indexOf(b.language))
        .map((t) => ({ language: t.language, text: t.text })),
      image: metas[i]?.use === 'image' ? { family: metas[i]!.family } : null,
      createdAt: message.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// 每个画布连同它的图和节点；只要画布上还摆着的节点，和画布页一样
async function readEverything(work: string): Promise<Loaded[]> {
  return Promise.all(
    (await readAllCanvases(work)).map(async (canvas) => {
      const [images, nodes] = await Promise.all([readImages(work, canvas.id), listNodes(work, canvas.id)]);
      const placed = new Set(canvas.nodes.map((layout) => layout.id));
      return { canvas, images, nodes: nodes.filter((node) => placed.has(node.id)) };
    }),
  );
}
