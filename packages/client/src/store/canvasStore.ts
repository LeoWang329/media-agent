import {
  activePath,
  addMessage,
  hasUnsentSettings,
  pathSnapshot,
  switchVersion as switchVersionInTree,
  type CanvasDetail,
  type CanvasNodeLayout,
  type ChatNode,
  type Config,
  type ImageRecord,
  type ModelConfigWithKey,
} from '@media-agent/shared';
import { create } from 'zustand';
import { api, postStream, uploadImage } from '../api';

type Stream = { assistantId: string | null; text: string };

type NodePatch = Partial<Pick<ChatNode, 'title' | 'modelConfigId' | 'systemPromptName' | 'draft' | 'activeChildOf' | 'duration' | 'aspectRatio'>>;

export const MAX_SLOTS = 9;

type CanvasState = {
  canvasId: string | null;
  detail: CanvasDetail | null;
  selectedId: string | null;
  nodes: Record<string, ChatNode>;
  streams: Record<string, Stream>; // 正在生成回复的节点
  modelConfigs: ModelConfigWithKey[];
  promptNames: string[];
  renamingId: string | null;
  placing: number; // 正在放进槽位的图片张数
  error: string;

  open: (canvasId: string) => Promise<void>;
  refresh: () => Promise<void>;
  select: (nodeId: string | null) => Promise<void>;
  loadNode: (nodeId: string) => Promise<ChatNode>;
  createNode: (x: number, y: number) => Promise<void>;
  patchNode: (nodeId: string, patch: NodePatch) => Promise<void>;
  saveLayouts: (layouts: CanvasNodeLayout[]) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
  fork: (nodeId: string, messageId: string, draftPrefix?: string) => Promise<void>;
  forkFromLast: (nodeId: string) => Promise<void>;
  send: (nodeId: string, text: string) => Promise<void>;
  regenerate: (nodeId: string, messageId: string) => Promise<void>;
  edit: (nodeId: string, messageId: string, text: string) => Promise<void>;
  stop: (nodeId: string) => Promise<void>;
  star: (nodeId: string, messageId: string, promptIndex: number, on: boolean) => Promise<void>;
  editPrompt: (nodeId: string, messageId: string, promptIndex: number, text: string) => Promise<void>;
  switchVersion: (nodeId: string, messageId: string) => Promise<void>;
  placeImages: (nodeId: string, paths: string[], replaceIndex?: number) => Promise<string[]>; // 返回放进去的 imageId
  placeFiles: (nodeId: string, files: File[], replaceIndex?: number) => Promise<string[]>;
  removeSlot: (nodeId: string, index: number) => Promise<void>;
  moveSlot: (nodeId: string, from: number, to: number) => Promise<void>;
  setRenaming: (nodeId: string | null) => void;
  clearError: () => void;
};

export const useCanvasStore = create<CanvasState>((set, get) => {
  const canvasUrl = () => `/canvases/${get().canvasId}`;
  const nodeUrl = (nodeId: string) => `${canvasUrl()}/nodes/${nodeId}`;

  const setNode = (node: ChatNode) => set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }));
  const changeNode = (nodeId: string, change: (node: ChatNode) => ChatNode) =>
    set((s) => (s.nodes[nodeId] ? { nodes: { ...s.nodes, [nodeId]: change(s.nodes[nodeId]) } } : {}));

  // 出错时显示在画布顶上，不打断操作
  const attempt = async <T>(task: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await task();
    } catch (err) {
      set({ error: (err as Error).message });
      return undefined;
    }
  };

  // 槽位操作排队做，连续拖放、删除时后一个拿到的是前一个改完的槽位
  let slotQueue: Promise<unknown> = Promise.resolve();
  const queueSlots = <T>(task: () => Promise<T>) => {
    const run = slotQueue.then(() => attempt(task));
    slotQueue = run;
    return run;
  };

  const saveSlots = async (nodeId: string, slots: string[]) => {
    setNode(await api<ChatNode>(nodeUrl(nodeId), { method: 'PATCH', body: { slots } }));
    await get().refresh();
  };

  // 放进下一个空位；replaceIndex 指向已有图的槽位时，第一张替换它，其余接在后面。
  // 图要么来自资产库（有本机路径），要么是从 Windows 文件夹拖进来的（只有文件本身）
  const place = (nodeId: string, sources: ({ path: string } | { file: File })[], replaceIndex?: number): Promise<string[]> =>
    queueSlots(async () => {
      const slots = get().nodes[nodeId]?.slots;
      if (!slots) throw new Error('先在画布上点一个节点');
      const replacing = replaceIndex !== undefined && replaceIndex < slots.length;
      const accepted = sources.slice(0, MAX_SLOTS - slots.length + (replacing ? 1 : 0));
      set({ placing: accepted.length });
      const ids: string[] = [];
      try {
        for (const source of accepted) {
          const image =
            'path' in source
              ? await api<ImageRecord>(`${canvasUrl()}/images`, { method: 'POST', body: { path: source.path, nodeId } })
              : await uploadImage<ImageRecord>(get().canvasId!, nodeId, source.file);
          set((s) => (s.detail ? { detail: { ...s.detail, images: { ...s.detail.images, [image.id]: image } } } : {}));
          ids.push(image.id);
        }
        const current = get().nodes[nodeId].slots;
        const next = replacing
          ? [...current.slice(0, replaceIndex), ...ids.slice(0, 1), ...current.slice(replaceIndex! + 1), ...ids.slice(1)]
          : [...current, ...ids];
        if (ids.length) await saveSlots(nodeId, next);
      } finally {
        set({ placing: 0 });
      }
      if (accepted.length < sources.length) set({ error: `槽位最多 ${MAX_SLOTS} 张，多出的 ${sources.length - accepted.length} 张没有放进去` });
      return ids;
    }).then((ids) => ids ?? []);

  // 流式文字按帧合并后再更新界面，免得每收到一小段就重新渲染一次
  const pending: Record<string, string> = {};
  let frame = 0;
  const flush = () => {
    frame = 0;
    set((s) => {
      const streams = { ...s.streams };
      for (const [nodeId, text] of Object.entries(pending)) {
        if (streams[nodeId]) streams[nodeId] = { ...streams[nodeId], text: streams[nodeId].text + text };
        delete pending[nodeId];
      }
      return { streams };
    });
  };

  const runStream = (nodeId: string, url: string, body: unknown) =>
    attempt(async () => {
      if (get().streams[nodeId]) return;
      set((s) => ({ streams: { ...s.streams, [nodeId]: { assistantId: null, text: '' } } }));
      try {
        await postStream(url, body, (event) => {
          if (event.type === 'user') {
            changeNode(nodeId, (node) => ({ ...addMessage(node, event.message), draft: '' }));
          } else if (event.type === 'assistant-start') {
            changeNode(nodeId, (node) => addMessage(node, event.message));
            set((s) => ({ streams: { ...s.streams, [nodeId]: { assistantId: event.message.id, text: '' } } }));
          } else if (event.type === 'delta') {
            pending[nodeId] = (pending[nodeId] ?? '') + event.text;
            frame ||= requestAnimationFrame(flush);
          } else {
            changeNode(nodeId, (node) => ({ ...node, messages: { ...node.messages, [event.message.id]: event.message } }));
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
    });

  return {
    canvasId: null,
    detail: null,
    selectedId: null,
    nodes: {},
    streams: {},
    modelConfigs: [],
    promptNames: [],
    renamingId: null,
    placing: 0,
    error: '',

    open: (canvasId) =>
      attempt(async () => {
        set({ canvasId, detail: null, selectedId: null, nodes: {}, renamingId: null, error: '' });
        const [detail, config, promptNames] = await Promise.all([
          api<CanvasDetail>(`/canvases/${canvasId}`),
          api<Config>('/config'),
          api<string[]>('/prompts'),
        ]);
        set({ detail, modelConfigs: config.modelConfigs, promptNames });
      }),

    refresh: async () => {
      const canvasId = get().canvasId;
      const detail = await api<CanvasDetail>(`/canvases/${canvasId}`);
      if (get().canvasId === canvasId) set({ detail });
    },

    select: (nodeId) =>
      attempt(async () => {
        set({ selectedId: nodeId });
        if (nodeId && !get().nodes[nodeId]) await get().loadNode(nodeId);
      }),

    loadNode: async (nodeId) => {
      const node = await api<ChatNode>(nodeUrl(nodeId));
      setNode(node);
      return node;
    },

    createNode: (x, y) =>
      attempt(async () => {
        const node = await api<ChatNode>(`${canvasUrl()}/nodes`, { method: 'POST', body: { x, y } });
        setNode(node);
        await get().refresh();
        set({ selectedId: node.id });
      }),

    patchNode: (nodeId, patch) =>
      attempt(async () => {
        setNode(await api<ChatNode>(nodeUrl(nodeId), { method: 'PATCH', body: patch }));
        if (patch.title !== undefined) await get().refresh();
      }),

    saveLayouts: (layouts) =>
      attempt(async () => {
        set((s) => {
          if (!s.detail) return {};
          const byId = new Map(layouts.map((l) => [l.id, l]));
          return { detail: { ...s.detail, nodes: s.detail.nodes.map((n) => ({ ...n, ...byId.get(n.id) })) } };
        });
        await api(canvasUrl(), { method: 'PATCH', body: { nodes: layouts } });
      }),

    deleteNode: (nodeId) =>
      attempt(async () => {
        const { deleted } = await api<{ deleted: string[] }>(nodeUrl(nodeId), { method: 'DELETE' });
        set((s) => ({
          selectedId: s.selectedId && deleted.includes(s.selectedId) ? null : s.selectedId,
          nodes: Object.fromEntries(Object.entries(s.nodes).filter(([id]) => !deleted.includes(id))),
        }));
        await get().refresh();
      }),

    fork: (nodeId, messageId, draftPrefix) =>
      attempt(async () => {
        const node = await api<ChatNode>(`${nodeUrl(nodeId)}/fork`, { method: 'POST', body: { messageId, draftPrefix } });
        setNode(node);
        await get().refresh();
        set({ selectedId: node.id });
      }),

    forkFromLast: (nodeId) =>
      attempt(async () => {
        const last = activePath(await get().loadNode(nodeId)).at(-1);
        if (!last) throw new Error('这个节点还没有消息，没法 fork');
        await get().fork(nodeId, last.id);
      }),

    send: (nodeId, text) => {
      const parentId = activePath(get().nodes[nodeId]).at(-1)?.id ?? null;
      return runStream(nodeId, `${nodeUrl(nodeId)}/send`, { parentId, text });
    },

    regenerate: (nodeId, messageId) => runStream(nodeId, `${nodeUrl(nodeId)}/messages/${messageId}/regenerate`, {}),

    edit: (nodeId, messageId, text) => runStream(nodeId, `${nodeUrl(nodeId)}/messages/${messageId}/edit`, { text }),

    stop: (nodeId) =>
      attempt(async () => {
        await api(`${nodeUrl(nodeId)}/stop`, { method: 'POST' });
      }),

    // 切换版本后，槽位、时长、比例换成新路径最后一条消息当时的
    // 星打在提示词框上，卡片上的星跟着变，所以要重新读一遍画布
    star: (nodeId, messageId, promptIndex, on) =>
      attempt(async () => {
        setNode(await api<ChatNode>(`${nodeUrl(nodeId)}/messages/${messageId}/star`, { method: 'POST', body: { promptIndex, on } }));
        await get().refresh();
      }),

    // 手动改提示词：服务端新建一条回复的版本，不调模型
    editPrompt: (nodeId, messageId, promptIndex, text) =>
      attempt(async () => {
        setNode(await api<ChatNode>(`${nodeUrl(nodeId)}/messages/${messageId}/edit-prompt`, { method: 'POST', body: { promptIndex, text } }));
        await get().refresh();
      }),

    switchVersion: (nodeId, messageId) =>
      attempt(async () => {
        const current = get().nodes[nodeId];
        if (hasUnsentSettings(current) && !window.confirm('槽位、时长或比例有还没发出的改动，切换版本会换成那个版本当时的设置，继续吗？')) return;
        const node = switchVersionInTree(current, messageId);
        const snapshot = pathSnapshot(node)!;
        setNode({ ...node, ...snapshot });
        const key = node.messages[messageId].parentId ?? 'root';
        await api(nodeUrl(nodeId), { method: 'PATCH', body: { activeChildOf: { [key]: messageId }, ...snapshot } });
        await get().refresh();
      }),

    placeImages: (nodeId, paths, replaceIndex) => place(nodeId, paths.map((path) => ({ path })), replaceIndex),

    placeFiles: (nodeId, files, replaceIndex) => place(nodeId, files.map((file) => ({ file })), replaceIndex),

    removeSlot: (nodeId, index) => queueSlots(() => saveSlots(nodeId, get().nodes[nodeId].slots.filter((_, i) => i !== index))),

    moveSlot: (nodeId, from, to) =>
      queueSlots(async () => {
        const slots = [...get().nodes[nodeId].slots];
        const [moved] = slots.splice(from, 1);
        slots.splice(to, 0, moved);
        await saveSlots(nodeId, slots);
      }),

    setRenaming: (renamingId) => set({ renamingId }),
    clearError: () => set({ error: '' }),
  };
});
