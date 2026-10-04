import type { ModelKind, ModelTransfer, RemoteModels } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';
import { useComfyStore } from './comfyStore';

// 往 AutoDL 那台传模型：那台上自己传的、在传的和排着的，见 docs/dev-plan.md 5.22。
// 从电脑传的在这里排队，一次发一个，文件由浏览器一边读一边发，传完前页面不能关；给链接下的由服务那边排

export type Waiting = { id: string; file: File; kind: ModelKind; folder: string; name: string; replace: boolean };

type ModelState = {
  remote: RemoteModels | null;
  listError: string | null;
  transfers: ModelTransfer[];
  waiting: Waiting[];
  load: () => Promise<void>;
  watch: () => void;
  enqueue: (item: Waiting) => void;
  stop: (id: string) => Promise<void>;
};

const active = (transfer: ModelTransfer) => transfer.state === 'queued' || transfer.state === 'running';

export const useModelStore = create<ModelState>((set, get) => {
  let sending = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  // 有在传、排着的就每秒看一次进度；有传完的，重读列表和出图设置的下拉
  async function look(): Promise<void> {
    const before = get().transfers;
    const transfers = await api<ModelTransfer[]>('/comfy/autodl/models/transfers').catch(() => before);
    set({ transfers });
    // 上次没看到它、或者上次还在传的：刚传完、刚停或者刚失败
    const finished = transfers.some((one) => !active(one) && before.find((old) => old.id === one.id)?.state !== one.state);
    if (finished) {
      void get().load();
      void useComfyStore.getState().loadOptions();
    }
    if (!sending && !get().waiting.length && !transfers.some(active) && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // 请求体就是文件本身。传失败的原因记在服务那边的传输列表里，这里不另外报
  async function send(item: Waiting): Promise<void> {
    const query = new URLSearchParams({ id: item.id, kind: item.kind, folder: item.folder, name: item.name, size: String(item.file.size) });
    if (item.replace) query.set('replace', '1');
    await fetch(`/api/comfy/autodl/models/upload?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: item.file }).catch(() => null);
  }

  async function pump(): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      for (let next = get().waiting[0]; next; next = get().waiting[0]) {
        set((s) => ({ waiting: s.waiting.slice(1) }));
        await send(next);
        await look();
      }
    } finally {
      sending = false;
    }
  }

  return {
    remote: null,
    listError: null,
    transfers: [],
    waiting: [],

    load: async () => {
      try {
        set({ remote: await api<RemoteModels>('/comfy/autodl/models'), listError: null });
      } catch (err) {
        set({ remote: null, listError: (err as Error).message });
      }
    },

    watch: () => {
      timer ??= setInterval(() => void look(), 1000);
      void look();
    },

    enqueue: (item) => {
      set((s) => ({ waiting: [...s.waiting, item] }));
      get().watch();
      void pump();
    },

    // 排在这里还没发的直接去掉；发出去的让服务那边停
    stop: async (id) => {
      if (get().waiting.some((item) => item.id === id)) {
        set((s) => ({ waiting: s.waiting.filter((item) => item.id !== id) }));
        return;
      }
      await api(`/comfy/autodl/models/transfers/${id}/stop`, { method: 'POST' });
      await look();
    },
  };
});
