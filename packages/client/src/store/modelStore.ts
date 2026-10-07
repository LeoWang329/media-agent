import type { ModelKind, ModelTransfer, RemoteModels } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';
import { useComfyStore } from './comfyStore';
import { useVideoStore } from './videoStore';

// 往 AutoDL 那台传模型：那台上自己传的、在传的和排着的，见 docs/dev-plan.md 5.22。
// 从电脑传的在这里排队，一次发一个，文件由浏览器一边读一边发，传完前页面不能关；给链接下的由服务那边排。
// host 是看哪台：出图那台，或者生成视频那台（只能传 LoRA）

export type ModelHost = 'autodl' | 'video';
export const modelsUrl = (host: ModelHost) => (host === 'video' ? '/comfy/video/models' : '/comfy/autodl/models');

// 传完、删了，那台的下拉重读
export function reloadOptions(host: ModelHost): void {
  if (host === 'video') void useVideoStore.getState().loadOptions();
  else void useComfyStore.getState().loadOptions();
}

export type Waiting = { id: string; host: ModelHost; file: File; kind: ModelKind; folder: string; name: string; replace: boolean };

type ModelState = {
  host: ModelHost;
  setHost: (host: ModelHost) => void;
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
    const { host, transfers: before } = get();
    const transfers = await api<ModelTransfer[]>(`${modelsUrl(host)}/transfers`).catch(() => before);
    // 看的时候换了一台：这份不是现在这台的
    if (get().host !== host) return;
    set({ transfers });
    // 上次没看到它、或者上次还在传的：刚传完、刚停或者刚失败
    const finished = transfers.some((one) => !active(one) && before.find((old) => old.id === one.id)?.state !== one.state);
    if (finished) {
      void get().load();
      reloadOptions(host);
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
    await fetch(`/api${modelsUrl(item.host)}/upload?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: item.file }).catch(() => null);
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
    host: 'autodl',
    remote: null,
    listError: null,
    transfers: [],
    waiting: [],

    // 换一台看：列表、传输都换成那台的；排着没发的照样发
    setHost: (host) => {
      if (host === get().host) return;
      set({ host, remote: null, listError: null, transfers: [] });
      get().watch();
    },

    load: async () => {
      const { host } = get();
      try {
        const remote = await api<RemoteModels>(modelsUrl(host));
        if (get().host === host) set({ remote, listError: null });
      } catch (err) {
        if (get().host === host) set({ remote: null, listError: (err as Error).message });
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
      await api(`${modelsUrl(get().host)}/transfers/${id}/stop`, { method: 'POST' });
      await look();
    },
  };
});
