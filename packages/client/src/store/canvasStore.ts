import {
  activePath,
  addMessage,
  defaultImageSettings,
  FAMILY_DEFAULTS,
  hiddenNodeIds,
  isSupportedImageName,
  pathSnapshot,
  switchVersion as switchVersionInTree,
  withTranslation,
  type CanvasDetail,
  type CanvasImage,
  type CanvasNodeLayout,
  type ChatNode,
  type Config,
  type Family,
  type FamilyDefaults,
  type ImageRecord,
  type ImageSettings,
  type ModelConfigWithKey,
  type PromptInfo,
  type PromptTranslation,
  type SharedSettings,
  type SlotSettings,
  type ThinkingSettings,
  type TranslateLanguage,
} from '@media-agent/shared';
import { create } from 'zustand';
import { api, assetThumbUrl, postStream, uploadImage } from '../api';
import { extensionOf, processedNote } from '../canvas/imageInfo';
import { ensureVisible } from '../canvas/view';
import { markSaved, trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';

// 正在收的回复：正文、思考原文，和第一个正文字到的时间（算思考了多久）
export type Stream = { assistantId: string | null; text: string; reasoning: string; firstTextAt: number | null };

const emptyStream = (assistantId: string | null): Stream => ({ assistantId, text: '', reasoning: '', firstTextAt: null });

// image 只带要改的几项，服务端按节点原来的（没改过的按系列的默认值）补全
type NodePatch = Partial<Pick<ChatNode, 'title' | 'modelConfigId' | 'systemPromptName' | 'draft' | 'duration' | 'aspectRatio' | 'slots'>> & {
  image?: Partial<ImageSettings>;
};

export const MAX_SLOTS = 9;

// 往槽位里放的图：资产库里的（有本机路径），或者从电脑里直接拿来的文件
export type ImageSource = { path: string; name: string; mtime: number } | { file: File; name: string };

// 放完之后每个来源对应的图；added 为假是这张图本来就在槽位里
export type Placed = { id: string; name: string; added: boolean };

// 正在放进槽位的图：槽位上先占好位置，盖一层「处理中」
export type Placing = { nodeId: string; replaceIndex: number | null; thumbs: string[] };

// 编号变了的槽位闪一下
export type Flash = { nodeId: string; indexes: number[]; seq: number };

type PlaceOptions = { replaceIndex?: number; quiet?: boolean };

type CanvasState = {
  canvasId: string | null;
  detail: CanvasDetail | null;
  selectedId: string | null;
  nodes: Record<string, ChatNode>;
  streams: Record<string, Stream>; // 这个页面上正在收回复的节点
  modelConfigs: ModelConfigWithKey[];
  prompts: PromptInfo[];
  thinking: ThinkingSettings | null; // 设置里的思考档位，打开画布时读一次
  defaults: Record<Family, FamilyDefaults>; // 设置里两个系列的默认值，打开画布时读一次
  placing: Placing | null;
  flash: Flash | null;
  undoLabels: string[]; // 撤销栈里每一步叫什么，最后一个是下一次撤销的
  redoLabels: string[];
  layoutSeq: number; // 节点位置被整体改过（撤销、排整齐、折叠）时加一，画布借此播一下挪动的动画
  composerFocus: { nodeId: string; seq: number } | null; // 岔出新节点后把光标放进输入框

  open: (canvasId: string) => Promise<void>;
  refresh: () => Promise<void>;
  select: (nodeId: string | null) => Promise<void>;
  loadNode: (nodeId: string) => Promise<ChatNode>;
  renameCanvas: (title: string) => Promise<void>;
  createNode: (x: number, y: number) => Promise<ChatNode | undefined>;
  // 下面几个返回服务端改成没有，改成了再弹提示
  patchNode: (nodeId: string, patch: NodePatch) => Promise<boolean>;
  saveLayouts: (layouts: CanvasNodeLayout[], label: string) => Promise<boolean>;
  deleteNode: (nodeId: string) => Promise<number | undefined>; // 返回一共删了几个节点
  fork: (nodeId: string, messageId: string, draftPrefix?: string) => Promise<ChatNode | undefined>;
  // 下面三个返回服务端有没有收下（收下以后才开始回复）；onAccepted 在收下那一刻调
  send: (nodeId: string, text: string) => Promise<boolean>;
  regenerate: (nodeId: string, messageId: string) => Promise<boolean>;
  edit: (nodeId: string, messageId: string, text: string, onAccepted?: () => void) => Promise<boolean>;
  stop: (nodeId: string) => Promise<boolean>;
  star: (nodeId: string, messageId: string, promptIndex: number, on: boolean) => Promise<boolean>;
  editPrompt: (nodeId: string, messageId: string, promptIndex: number, text: string) => Promise<boolean>;
  translate: (nodeId: string, messageId: string, promptIndex: number, language: TranslateLanguage, instruction: string) => Promise<PromptTranslation>;
  switchVersion: (nodeId: string, messageId: string) => Promise<boolean>;
  place: (nodeId: string, sources: ImageSource[], options?: PlaceOptions) => Promise<Placed[]>;
  addImages: (nodeId: string, images: ImageRecord[]) => Promise<boolean>; // 已经复制进画布的图（拼图）；槽位满了没放也算成
  removeSlot: (nodeId: string, index: number) => Promise<boolean>; // 返回删掉了没有
  moveSlot: (nodeId: string, from: number, to: number) => Promise<void>;
  revertSettings: (nodeId: string) => Promise<void>;
  undo: (only?: UndoToken) => Promise<void>; // 传了 only：只有它还是最近一步时才撤（提示条上的「撤销」）
  redo: () => Promise<void>;
  undoOption: () => { action: string; onAction: () => void }; // 提示条上撤销最近这一步的按钮
};

export type UndoToken = object;

// 撤销栈里的一步：叫什么、怎么退回去、怎么再做一遍
type UndoStep = { label: string; nodeId?: string; at: number; undo: () => Promise<unknown>; redo: () => Promise<unknown> };

const UNDO_LIMIT = 50;
// 连着点时长的加减，1.2 秒内算一步
const MERGE_MS = 1200;

// patchNode 里这几个字段的改动进撤销栈
const UNDOABLE_FIELDS = ['title', 'duration', 'aspectRatio'] as const;
// 这几个字段改了，画布卡片上显示的东西跟着变，要重新读一遍画布
const CARD_FIELDS = ['title', 'slots', 'duration', 'aspectRatio', 'systemPromptName', 'image'] as const;

const sameSettings = (a: SlotSettings, b: SlotSettings) =>
  a.duration === b.duration && a.aspectRatio === b.aspectRatio && a.slots.length === b.slots.length && a.slots.every((id, i) => id === b.slots[i]);

// 切到这个版本后，槽位、时长、比例变回那个版本最后一条消息当时的样子；和节点现在的一样就不用变
export function switchChangesSettings(node: ChatNode, messageId: string): SlotSettings | null {
  const after = pathSnapshot(switchVersionInTree(node, messageId));
  const now: SlotSettings = { slots: node.slots, duration: node.duration, aspectRatio: node.aspectRatio };
  return after && !sameSettings(now, after) ? after : null;
}

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

export const useCanvasStore = create<CanvasState>((set, get) => {
  const canvasUrl = () => `/canvases/${get().canvasId}`;
  const nodeUrl = (nodeId: string) => `${canvasUrl()}/nodes/${nodeId}`;
  const write = <T>(path: string, method: string, body?: unknown) => trackWrite(api<T>(path, { method, body }));

  const setNode = (node: ChatNode) => set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }));
  const changeNode = (nodeId: string, change: (node: ChatNode) => ChatNode) =>
    set((s) => (s.nodes[nodeId] ? { nodes: { ...s.nodes, [nodeId]: change(s.nodes[nodeId]) } } : {}));
  // 服务端回来的节点只取这次改的字段：生成中的回复在本地更新得比服务端快，整个换掉会退回去
  const mergeFields = (nodeId: string, server: ChatNode, keys: string[]) =>
    changeNode(nodeId, (node) => ({
      ...node,
      ...Object.fromEntries(keys.map((key) => [key, server[key as keyof ChatNode]])),
      titleIsManual: server.titleIsManual,
    }));
  const imageName = (imageId: string) => get().detail?.images[imageId]?.originalName ?? '这张图';
  // 节点现在的出图设置：改过的用节点自己的，没改过的按系列的默认值，和服务端一样
  const imageSettingsOf = (node: ChatNode): ImageSettings =>
    node.image ?? defaultImageSettings(get().defaults[get().prompts.find((p) => p.name === node.systemPromptName)?.family ?? 'IL']);

  // 卡片上的标题、概述、槽位缩略图由服务端算，改完重新读一遍画布；读不到只提示，不算这次操作失败
  const refreshCanvas = () => get().refresh().catch(failed);
  // 先画上去的改动服务端没收下：按服务端的重新读，界面和服务端对上
  const resync = (nodeId: string) => Promise.all([get().loadNode(nodeId), get().refresh()]).catch(() => undefined);
  // 岔出、「去看看」之后，面板打开那一下再把节点挪进视野
  const reveal = (nodeId: string) =>
    setTimeout(() => {
      const summary = get().detail?.nodes.find((n) => n.id === nodeId);
      if (summary) ensureVisible(summary);
    }, 30);

  // 出错时弹提示条，不打断操作
  const attempt = async <T>(task: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await task();
    } catch (err) {
      failed(err);
      return undefined;
    }
  };

  // 槽位操作排队做，连续放图、删除时后一个拿到的是前一个改完的槽位
  let slotQueue: Promise<unknown> = Promise.resolve();
  const queueSlots = <T>(task: () => Promise<T>) => {
    const run = slotQueue.then(() => attempt(task));
    slotQueue = run;
    return run;
  };

  let flashSeq = 0;
  const flashSlots = (nodeId: string, indexes: number[]) => {
    if (!indexes.length) return;
    const seq = ++flashSeq;
    set({ flash: { nodeId, indexes, seq } });
    setTimeout(() => get().flash?.seq === seq && set({ flash: null }), 1100);
  };

  // 撤销栈：只记画布和槽位上的操作，发出去的消息不进来。
  // 撤销和重做都走下面几个 apply，那几个不记栈，所以不会把自己又记进去
  let undoStack: UndoStep[] = [];
  let redoStack: UndoStep[] = [];
  // 栈被别处改过（记了新的一步、拿掉了一步、换了画布）就加一，撤销、重做没做成时凭它决定还放不放回去
  let stackEpoch = 0;
  const syncLabels = () => set({ undoLabels: undoStack.map((s) => s.label), redoLabels: redoStack.map((s) => s.label) });
  const remember = (step: Omit<UndoStep, 'at'>): UndoStep => {
    const recorded = { ...step, at: Date.now() };
    undoStack = [...undoStack.slice(1 - UNDO_LIMIT), recorded];
    redoStack = [];
    stackEpoch += 1;
    syncLabels();
    return recorded;
  };
  // 刚记下的这一步没做成：拿掉，免得之后撤销、重做的是没发生过的改动
  const forget = (step: UndoStep) => {
    undoStack = undoStack.filter((s) => s !== step);
    redoStack = redoStack.filter((s) => s !== step);
    stackEpoch += 1;
    syncLabels();
  };
  // 提示条上的「撤销」只撤它说的那一步
  const undoAction = (step: UndoStep | undefined) => ({ action: '撤销', onAction: () => void get().undo(step) });

  // 撤销、重做排队做，前一步做完再做下一步，两个栈才对得上
  let undoQueue: Promise<unknown> = Promise.resolve();
  const queueUndo = (task: () => Promise<void>) => {
    const run = undoQueue.then(() => attempt(task));
    undoQueue = run;
    return run.then(() => undefined);
  };

  // 同一个字段后面还有改动在排队时，先回来的结果不盖到界面上，免得连点时长加减被拉回去
  const queued = new Map<string, number>();
  const countQueued = (key: string, delta: number) => {
    const next = (queued.get(key) ?? 0) + delta;
    if (next) queued.set(key, next);
    else queued.delete(key);
  };

  // 改节点字段排队发，前一个回来再发下一个，服务端收到的顺序和点的顺序一致。失败时抛出去
  let patchQueue: Promise<unknown> = Promise.resolve();
  const applyPatch = (nodeId: string, patch: NodePatch): Promise<void> => {
    const keys = Object.keys(patch);
    keys.forEach((key) => countQueued(`${nodeId}:${key}`, 1));
    const { image, ...fields } = patch;
    changeNode(nodeId, (node) => ({ ...node, ...fields, ...(image && { image: { ...imageSettingsOf(node), ...image } }) }));
    const run = patchQueue.then(async () => {
      let server: ChatNode;
      try {
        server = await write<ChatNode>(nodeUrl(nodeId), 'PATCH', patch);
      } finally {
        keys.forEach((key) => countQueued(`${nodeId}:${key}`, -1));
      }
      mergeFields(nodeId, server, keys.filter((key) => !queued.has(`${nodeId}:${key}`)));
      if (CARD_FIELDS.some((key) => key in patch)) await refreshCanvas();
    });
    patchQueue = run.catch(() => undefined);
    return run.catch(async (err) => {
      await resync(nodeId);
      throw err;
    });
  };

  // 位置改动先画上去再写；还没写完、或者读画布的那段时间里写完了，读回来的位置都不算数，用本地的
  let layoutVersion = 0;
  let layoutsInFlight = 0;
  const applyLayouts = async (layouts: CanvasNodeLayout[], animate: boolean) => {
    layoutVersion += 1;
    layoutsInFlight += 1;
    set((s) => {
      if (!s.detail) return {};
      const byId = new Map(layouts.map((l) => [l.id, l]));
      const nodes = s.detail.nodes.map((n) => ({ ...n, ...byId.get(n.id) }));
      // 撤销、重做把面板里的节点折起来了：收起面板
      const hidden = s.selectedId && hiddenNodeIds(nodes).has(s.selectedId);
      return {
        detail: { ...s.detail, nodes },
        ...(animate && { layoutSeq: s.layoutSeq + 1 }),
        ...(hidden && { selectedId: null }),
      };
    });
    let saved = false;
    try {
      await write(canvasUrl(), 'PATCH', { nodes: layouts });
      saved = true;
    } finally {
      layoutsInFlight -= 1;
      layoutVersion += 1;
      if (!saved) await get().refresh().catch(() => undefined);
    }
  };

  const applyFields = async (nodeId: string, fields: Partial<SlotSettings>) => {
    changeNode(nodeId, (node) => ({ ...node, ...fields }));
    try {
      mergeFields(nodeId, await write<ChatNode>(nodeUrl(nodeId), 'PATCH', fields), Object.keys(fields));
    } catch (err) {
      await resync(nodeId);
      throw err;
    }
    await refreshCanvas();
  };

  // 先记再改：界面在服务端答完就变了，这中间按 Ctrl+Z 不能退到上一步去
  const saveSlots = async (nodeId: string, slots: string[], label: string) => {
    const before = get().nodes[nodeId]?.slots ?? [];
    const step = remember({ label, nodeId, undo: () => applyFields(nodeId, { slots: before }), redo: () => applyFields(nodeId, { slots }) });
    try {
      await applyFields(nodeId, { slots });
    } catch (err) {
      forget(step);
      throw err;
    }
    return step;
  };

  // 删除节点：撤销时从 .trash 里挪回来；再删一次会进新的 .trash 文件夹，名字要更新
  const removeNode = async (nodeId: string): Promise<{ deleted: string[]; trash: string }> => {
    const result = await write<{ deleted: string[]; trash: string }>(nodeUrl(nodeId), 'DELETE');
    set((s) => ({
      selectedId: s.selectedId && result.deleted.includes(s.selectedId) ? null : s.selectedId,
      nodes: Object.fromEntries(Object.entries(s.nodes).filter(([id]) => !result.deleted.includes(id))),
      detail: s.detail && { ...s.detail, nodes: s.detail.nodes.filter((n) => !result.deleted.includes(n.id)) },
    }));
    return result;
  };

  // 流式文字按帧合并后再更新界面，免得每收到一小段就重新渲染一次。
  // 第一个正文字到的时间收到就记下：页面在后台时不出帧，等到合并时再记就晚了
  const pending: Record<string, { text: string; reasoning: string; firstTextAt?: number }> = {};
  let frame = 0;
  const flush = () => {
    frame = 0;
    set((s) => {
      const streams = { ...s.streams };
      for (const [nodeId, add] of Object.entries(pending)) {
        const stream = streams[nodeId];
        if (stream) {
          streams[nodeId] = {
            ...stream,
            text: stream.text + add.text,
            reasoning: stream.reasoning + add.reasoning,
            firstTextAt: stream.firstTextAt ?? add.firstTextAt ?? null,
          };
        }
        delete pending[nodeId];
      }
      return { streams };
    });
  };
  const receive = (nodeId: string, part: 'text' | 'reasoning', text: string) => {
    const add = (pending[nodeId] ??= { text: '', reasoning: '' });
    add[part] += text;
    if (part === 'text') add.firstTextAt ??= Date.now();
    frame ||= requestAnimationFrame(flush);
  };

  const runStream = async (nodeId: string, url: string, body: unknown, onAccepted?: () => void): Promise<boolean> => {
    let accepted = false;
    const accept = () => {
      if (accepted) return;
      accepted = true;
      onAccepted?.();
    };
    await attempt(async () => {
      if (get().streams[nodeId]) return;
      set((s) => ({ streams: { ...s.streams, [nodeId]: emptyStream(null) } }));
      let outcome: 'done' | 'error' | null = null;
      try {
        await postStream(url, body, (event) => {
          if (event.type === 'user' || event.type === 'assistant-start') accept();
          if (event.type === 'user') {
            changeNode(nodeId, (node) => ({ ...addMessage(node, event.message), draft: '' }));
            markSaved();
          } else if (event.type === 'assistant-start') {
            changeNode(nodeId, (node) => addMessage(node, event.message));
            set((s) => ({ streams: { ...s.streams, [nodeId]: emptyStream(event.message.id) } }));
          } else if (event.type === 'delta') {
            receive(nodeId, 'text', event.text);
          } else if (event.type === 'reasoning') {
            receive(nodeId, 'reasoning', event.text);
          } else {
            outcome = event.type;
            changeNode(nodeId, (node) => ({ ...node, messages: { ...node.messages, [event.message.id]: event.message } }));
            markSaved();
          }
        });
      } finally {
        delete pending[nodeId];
        set((s) => {
          const { [nodeId]: _, ...streams } = s.streams;
          return { streams };
        });
        // 标题、卡片概述由服务端算好，重新拿一次
        if (get().nodes[nodeId]) await Promise.all([get().loadNode(nodeId), get().refresh()]).catch(() => {});
      }
      // 面板开着别的节点时，在提示条上说一声
      const node = get().nodes[nodeId];
      if (node && outcome && get().selectedId !== nodeId) {
        toast(`「${node.title}」${outcome === 'error' ? '请求失败了' : '回复完了'}`, {
          tone: outcome === 'error' ? 'danger' : undefined,
          action: '去看看',
          onAction: () => {
            void get().select(nodeId);
            reveal(nodeId);
          },
        });
      }
    });
    return accepted;
  };

  // 放图：先复制进画布文件夹（程序按 H3 的要求处理），再一次改好槽位。
  // 换图（replaceIndex 指着已有的图）只用第一张
  const place = (nodeId: string, sources: ImageSource[], { replaceIndex, quiet }: PlaceOptions = {}) =>
    queueSlots(async () => {
      const slots = get().nodes[nodeId]?.slots;
      if (!slots) throw new Error('先在画布上点一个节点');
      const replacing = replaceIndex !== undefined && replaceIndex < slots.length;
      const unsupported = sources.filter((s) => !isSupportedImageName(s.name));
      const usable = sources.filter((s) => isSupportedImageName(s.name)).slice(0, replacing ? 1 : undefined);
      // 资产库里已经在槽位里的图不占空位，剩下的按空位数放
      const inSlots = (s: ImageSource) => 'path' in s && slots.some((id) => get().detail?.images[id]?.originalPath === s.path);
      let room = MAX_SLOTS - slots.length;
      const accepted = replacing ? usable : usable.filter((s) => inSlots(s) || room-- > 0);
      const thumbs = accepted.filter((s) => replacing || !inSlots(s)).map((s) => ('path' in s ? assetThumbUrl(s.path, s.mtime) : URL.createObjectURL(s.file)));
      set({ placing: accepted.length ? { nodeId, replaceIndex: replacing ? replaceIndex! : null, thumbs } : null });
      const placed: Placed[] = [];
      const added: CanvasImage[] = [];
      const duplicates: string[] = [];
      try {
        for (const source of accepted) {
          const image =
            'path' in source
              ? await write<ImageRecord>(`${canvasUrl()}/images`, 'POST', { path: source.path, nodeId })
              : await trackWrite(uploadImage<ImageRecord>(get().canvasId!, nodeId, source.file));
          set((s) => (s.detail ? { detail: { ...s.detail, images: { ...s.detail.images, [image.id]: { ...s.detail.images[image.id], ...image } } } } : {}));
          const others = get().nodes[nodeId].slots.filter((_, i) => !(replacing && i === replaceIndex));
          const already = others.includes(image.id) || added.some((a) => a.id === image.id);
          placed.push({ id: image.id, name: image.originalName, added: !already });
          if (already) duplicates.push(image.originalName);
          else added.push(image);
        }
        const current = get().nodes[nodeId].slots;
        if (added.length) {
          const ids = added.map((image) => image.id);
          const next = replacing ? current.map((id, i) => (i === replaceIndex ? ids[0] : id)) : [...current, ...ids];
          await saveSlots(nodeId, next, replacing ? '替换槽位里的图' : '放图进槽位');
          if (replacing) {
            flashSlots(nodeId, [replaceIndex!]);
            toast(`${replaceIndex! + 1} 号换成了 ${added[0].originalName}，编号不变`);
          } else if (!quiet) {
            toast(`放进了 ${ids.length} 张，编号 ${current.length + 1}${ids.length > 1 ? `–${current.length + ids.length}` : ''} 号`);
          }
        }
      } finally {
        thumbs.forEach((thumb) => thumb.startsWith('blob:') && URL.revokeObjectURL(thumb));
        set({ placing: null });
      }

      if (usable.length > accepted.length) {
        toast(`槽位满了，只放进去 ${added.length} 张，另外 ${usable.length - accepted.length} 张没放`, { tone: 'warn', ms: 4000 });
      }
      if (unsupported.length) {
        toast(`没放进去：${unsupported.map((s) => `${s.name}（${extensionOf(s.name)} 格式用不了）`).join('、')}`, { tone: 'danger', ms: 4500 });
      }
      if (duplicates.length && !quiet) toast(`${duplicates.join('、')} 已经在槽位里了`, { tone: 'warn' });
      const processed = added.filter((image) => image.processed);
      if (processed.length) {
        toast(`${processed.map((image) => image.originalName).join('、')} 已处理：${processedNote(processed[0])}。上传时要传处理过的那份`, { ms: 4500 });
      }
      return placed;
    }).then((placed) => placed ?? []);

  return {
    canvasId: null,
    detail: null,
    selectedId: null,
    nodes: {},
    streams: {},
    modelConfigs: [],
    prompts: [],
    thinking: null,
    defaults: FAMILY_DEFAULTS,
    placing: null,
    flash: null,
    undoLabels: [],
    redoLabels: [],
    layoutSeq: 0,
    composerFocus: null,

    open: (canvasId) =>
      attempt(async () => {
        undoStack = [];
        redoStack = [];
        stackEpoch += 1;
        set({ canvasId, detail: null, selectedId: null, nodes: {}, placing: null, flash: null, undoLabels: [], redoLabels: [] });
        const [detail, config, prompts, settings] = await Promise.all([
          api<CanvasDetail>(`/canvases/${canvasId}`),
          api<Config>('/config'),
          api<PromptInfo[]>('/prompts'),
          api<SharedSettings>('/settings'),
        ]);
        if (get().canvasId === canvasId) set({ detail, modelConfigs: config.modelConfigs, prompts, thinking: settings.thinking, defaults: settings.defaults });
      }),

    refresh: async () => {
      const canvasId = get().canvasId;
      const version = layoutVersion;
      const writing = layoutsInFlight > 0;
      const detail = await api<CanvasDetail>(`/canvases/${canvasId}`);
      if (get().canvasId !== canvasId) return;
      if (!writing && version === layoutVersion) return set({ detail });
      // 读的这段时间里挪过节点，或者位置还没写完：位置用本地的，其他用读回来的
      const local = new Map((get().detail?.nodes ?? []).map((n) => [n.id, n]));
      set({
        detail: {
          ...detail,
          nodes: detail.nodes.map((n) => {
            const mine = local.get(n.id);
            return mine ? { ...n, x: mine.x, y: mine.y, collapsed: mine.collapsed } : n;
          }),
        },
      });
    },

    select: (nodeId) =>
      attempt(async () => {
        const previous = get().selectedId;
        set({ selectedId: nodeId });
        if (!nodeId || get().nodes[nodeId]) return;
        try {
          await get().loadNode(nodeId);
        } catch (err) {
          // 读不出来：面板还开着上一个节点，选中也退回它，引用图片、资产库、拼图才和面板对得上
          if (get().selectedId === nodeId) set({ selectedId: previous && get().nodes[previous] ? previous : null });
          throw err;
        }
      }),

    loadNode: async (nodeId) => {
      const node = await api<ChatNode>(nodeUrl(nodeId));
      setNode(node);
      return node;
    },

    renameCanvas: (title) =>
      attempt(async () => {
        const canvas = await write<CanvasDetail['canvas']>(canvasUrl(), 'PATCH', { title });
        set((s) => (s.detail ? { detail: { ...s.detail, canvas: { ...s.detail.canvas, title: canvas.title, updatedAt: canvas.updatedAt } } } : {}));
      }),

    createNode: (x, y) =>
      attempt(async () => {
        const node = await write<ChatNode>(`${canvasUrl()}/nodes`, 'POST', { x, y });
        setNode(node);
        await refreshCanvas();
        set({ selectedId: node.id });
        return node;
      }),

    // 改名、时长、比例能撤销；模型配置、系统提示词、草稿这些不算
    patchNode: (nodeId, patch) => {
      const node = get().nodes[nodeId];
      const changed = UNDOABLE_FIELDS.filter((key) => key in patch && node && patch[key] !== node[key]);
      let step: UndoStep | undefined;
      if (node && changed.length) {
        const pick = (from: NodePatch) => Object.fromEntries(changed.map((key) => [key, from[key]])) as NodePatch;
        const before = pick(node);
        const after = pick(patch);
        const label = changed.includes('title') ? '改名' : changed.includes('duration') ? '改时长' : '改比例';
        const top = undoStack.at(-1);
        if (label === '改时长' && changed.length === 1 && top?.label === label && top.nodeId === nodeId && Date.now() - top.at < MERGE_MS) {
          top.redo = () => applyPatch(nodeId, after);
          top.at = Date.now();
          redoStack = [];
          syncLabels();
        } else {
          step = remember({ label, nodeId, undo: () => applyPatch(nodeId, before), redo: () => applyPatch(nodeId, after) });
        }
      }
      return attempt(async () => {
        await applyPatch(nodeId, patch);
        return true;
      }).then((ok) => {
        if (!ok && step) forget(step);
        return Boolean(ok);
      });
    },

    // 拖动节点、折叠、自动排整齐都走这里
    saveLayouts: (layouts, label) => {
      const before = (get().detail?.nodes ?? [])
        .filter((n) => layouts.some((l) => l.id === n.id))
        .map(({ id, x, y, collapsed }) => ({ id, x, y, collapsed }));
      // 点一下没真拖动也会来一次，这种不记
      const moved = before.some((was) => {
        const now = layouts.find((l) => l.id === was.id)!;
        return now.x !== was.x || now.y !== was.y || now.collapsed !== was.collapsed;
      });
      if (!moved) return Promise.resolve(true);
      const step = remember({ label, undo: () => applyLayouts(before, true), redo: () => applyLayouts(layouts, true) });
      return attempt(async () => {
        await applyLayouts(layouts, label !== '移动节点');
        return true;
      }).then((ok) => {
        if (!ok) forget(step);
        return Boolean(ok);
      });
    },

    // 删掉就记进撤销栈，之后读画布出错也撤得回来
    deleteNode: (nodeId) =>
      attempt(async () => {
        let { deleted, trash } = await removeNode(nodeId);
        const step = remember({
          label: '删除节点',
          undo: async () => {
            await write(`${canvasUrl()}/nodes/restore`, 'POST', { trash });
            await refreshCanvas();
          },
          redo: async () => {
            ({ trash } = await removeNode(nodeId));
            await refreshCanvas();
          },
        });
        toast(`已删除 ${deleted.length} 个节点`, undoAction(step));
        await refreshCanvas();
        return deleted.length;
      }),

    fork: (nodeId, messageId, draftPrefix) =>
      attempt(async () => {
        const node = await write<ChatNode>(`${nodeUrl(nodeId)}/fork`, 'POST', { messageId, draftPrefix });
        setNode(node);
        await refreshCanvas();
        set((s) => ({ selectedId: node.id, composerFocus: { nodeId: node.id, seq: (s.composerFocus?.seq ?? 0) + 1 } }));
        reveal(node.id);
        toast(`已岔出新节点，复制了前 ${Object.keys(node.messages).length} 条消息`);
        return node;
      }),

    send: (nodeId, text) => {
      const parentId = activePath(get().nodes[nodeId]).at(-1)?.id ?? null;
      return runStream(nodeId, `${nodeUrl(nodeId)}/send`, { parentId, text });
    },

    regenerate: (nodeId, messageId) => runStream(nodeId, `${nodeUrl(nodeId)}/messages/${messageId}/regenerate`, {}),

    edit: (nodeId, messageId, text, onAccepted) => runStream(nodeId, `${nodeUrl(nodeId)}/messages/${messageId}/edit`, { text }, onAccepted),

    stop: (nodeId) =>
      attempt(async () => {
        await api(`${nodeUrl(nodeId)}/stop`, { method: 'POST' });
        return true;
      }).then(Boolean),

    // 星打在提示词框上，卡片上的星跟着变，所以要重新读一遍画布
    star: (nodeId, messageId, promptIndex, on) =>
      attempt(async () => {
        const node = await write<ChatNode>(`${nodeUrl(nodeId)}/messages/${messageId}/star`, 'POST', { promptIndex, on });
        mergeFields(nodeId, node, ['messages']);
        await refreshCanvas();
        return true;
      }).then(Boolean),

    // 手动改提示词：服务端新建一条回复的版本，不调模型
    editPrompt: (nodeId, messageId, promptIndex, text) =>
      attempt(async () => {
        const node = await write<ChatNode>(`${nodeUrl(nodeId)}/messages/${messageId}/edit-prompt`, 'POST', { promptIndex, text });
        mergeFields(nodeId, node, ['messages', 'rootIds', 'activeChildOf']);
        await refreshCanvas();
        return true;
      }).then(Boolean),

    // 翻译提示词框：要等模型写完，不算进顶上的「正在写入」。译文只并进那条回复，别的消息用本地的。
    // 出错往外抛，翻译窗口提示的时候带上是哪个框
    translate: async (nodeId, messageId, promptIndex, language, instruction) => {
      const translation = await api<PromptTranslation>(`${nodeUrl(nodeId)}/messages/${messageId}/translate`, {
        method: 'POST',
        body: { promptIndex, language, instruction },
      });
      changeNode(nodeId, (node) =>
        node.messages[messageId] ? { ...node, messages: { ...node.messages, [messageId]: withTranslation(node.messages[messageId], translation) } } : node,
      );
      return translation;
    },

    // 切换版本；槽位、时长、比例跟着换成那个版本当时的（有没发出的改动时面板上先问过）。
    // 切版本本身不进撤销栈，换掉的槽位、时长、比例进，免得之后撤销槽位操作时把切过来的设置盖掉
    switchVersion: (nodeId, messageId) =>
      attempt(async () => {
        const current = get().nodes[nodeId];
        const settings = switchChangesSettings(current, messageId);
        const node = switchVersionInTree(current, messageId);
        setNode({ ...node, ...settings });
        let step: UndoStep | undefined;
        if (settings) {
          const before: SlotSettings = { slots: current.slots, duration: current.duration, aspectRatio: current.aspectRatio };
          step = remember({ label: '切版本时换了槽位', nodeId, undo: () => applyFields(nodeId, before), redo: () => applyFields(nodeId, settings) });
        }
        const key = node.messages[messageId].parentId ?? 'root';
        try {
          await write(nodeUrl(nodeId), 'PATCH', { activeChildOf: { [key]: messageId }, ...settings });
        } catch (err) {
          if (step) forget(step);
          await resync(nodeId);
          throw err;
        }
        await refreshCanvas();
        return true;
      }).then(Boolean),

    place,

    addImages: (nodeId, images) =>
      queueSlots(async () => {
        set((s) => (s.detail ? { detail: { ...s.detail, images: { ...s.detail.images, ...Object.fromEntries(images.map((i) => [i.id, i])) } } } : {}));
        const current = get().nodes[nodeId]?.slots;
        if (!current) return false;
        const ids = images.map((i) => i.id).filter((id) => !current.includes(id)).slice(0, MAX_SLOTS - current.length);
        if (ids.length) await saveSlots(nodeId, [...current, ...ids], '放图进槽位');
        return true;
      }).then(Boolean),

    removeSlot: (nodeId, index) =>
      queueSlots(async () => {
        const slots = get().nodes[nodeId].slots;
        const imageId = slots[index];
        const step = await saveSlots(nodeId, slots.filter((_, i) => i !== index), '删掉槽位里的图');
        const followers = Array.from({ length: slots.length - 1 - index }, (_, i) => index + i);
        flashSlots(nodeId, followers);
        const tail = followers.length ? `后面的往前补位：原来的 ${index + 2} 号现在是 ${index + 1} 号` : '';
        toast(`删掉了 ${index + 1} 号 ${imageName(imageId)}。${tail}`, { tone: followers.length ? 'warn' : undefined, ms: 4500, ...undoAction(step) });
        return true;
      }).then(Boolean),

    moveSlot: (nodeId, from, to) =>
      queueSlots(async () => {
        if (from === to) return;
        const slots = [...get().nodes[nodeId].slots];
        const [moved] = slots.splice(from, 1);
        slots.splice(to, 0, moved);
        await saveSlots(nodeId, slots, '调整槽位顺序');
        flashSlots(nodeId, Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => Math.min(from, to) + i));
        toast(`${imageName(moved)} 从 ${from + 1} 号挪到 ${to + 1} 号，中间的编号跟着变了`, { tone: 'warn', ms: 4000 });
      }).then(() => undefined),

    // 撤回没发出的改动：槽位、时长、比例回到当前路径最后一条消息当时的样子
    revertSettings: (nodeId) =>
      queueSlots(async () => {
        const node = get().nodes[nodeId];
        const snapshot = pathSnapshot(node);
        if (!snapshot) return;
        const before: SlotSettings = { slots: node.slots, duration: node.duration, aspectRatio: node.aspectRatio };
        const step = remember({ label: '撤回没发出的改动', nodeId, undo: () => applyFields(nodeId, before), redo: () => applyFields(nodeId, snapshot) });
        try {
          await applyFields(nodeId, snapshot);
        } catch (err) {
          forget(step);
          throw err;
        }
        toast('已回到上次发出时的样子', undoAction(step));
      }).then(() => undefined),

    // 先挪到另一个栈再发请求，和普通操作「先记再改」一样：请求还在路上时又做了新操作，重做栈照常清掉；
    // 连点时长也不会并进正在撤销的这一步。没做成就挪回来，可以再按一次；这期间栈被改过就不挪了
    undo: (only) =>
      queueUndo(async () => {
        const step = undoStack.at(-1);
        if (!step) return;
        if (only && only !== step) {
          toast('这一步已经撤销过了，或者之后又有别的改动，没有再撤销', { tone: 'warn' });
          return;
        }
        undoStack = undoStack.slice(0, -1);
        redoStack = [...redoStack, step];
        syncLabels();
        const epoch = stackEpoch;
        try {
          await step.undo();
        } catch (err) {
          if (epoch === stackEpoch) {
            redoStack = redoStack.filter((s) => s !== step);
            undoStack = [...undoStack, step];
            syncLabels();
          }
          throw err;
        }
        toast(`已撤销：${step.label}${undoStack.length ? `（还能撤销 ${undoStack.length} 步）` : ''}`);
      }),

    redo: () =>
      queueUndo(async () => {
        const step = redoStack.at(-1);
        if (!step) return;
        redoStack = redoStack.slice(0, -1);
        undoStack = [...undoStack, step];
        syncLabels();
        const epoch = stackEpoch;
        try {
          await step.redo();
        } catch (err) {
          if (epoch === stackEpoch) {
            undoStack = undoStack.filter((s) => s !== step);
            redoStack = [...redoStack, step];
            syncLabels();
          }
          throw err;
        }
        toast(`已重做：${step.label}`);
      }),

    undoOption: () => undoAction(undoStack.at(-1)),
  };
});
