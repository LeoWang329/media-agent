import type { AutodlState, ComfyOptions, ComfyStatus, ComfyTarget, Config, ImageJobEvent } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';
import { toast } from '../ui/toast';

// 出图用哪台 ComfyUI、局域网那台的状态、AutoDL 实例的状态和下拉选项，画布、首页、设置三页共用；
// 出图的进度、排第几和 AutoDL 的状态从 /image-jobs/events 收，不存盘，见 docs/dev-plan.md 5.17、5.19

// AutoDL 的状态带上收到的时间：还剩多久自动关机从这时往下数
export type AutodlNow = AutodlState & { at: number };

type ComfyState = {
  target: ComfyTarget | null; // 这台电脑出图用哪台，还没读到是 null
  status: ComfyStatus | null; // 局域网那台；还没问过是 null
  autodl: AutodlNow | null;
  checking: boolean;
  options: ComfyOptions | null;
  optionsError: string | null;
  loadingOptions: boolean;
  progress: Record<string, { step: number; total: number }>; // 键是「组 id:第几张」
  queue: Record<string, number>;
  checkStatus: () => Promise<ComfyStatus>;
  checkAutodl: () => Promise<void>;
  loadTarget: (fresh?: boolean) => Promise<void>; // fresh 是重读一次：别的页面可能改过
  setTarget: (target: ComfyTarget) => Promise<void>;
  power: (on: boolean) => Promise<void>;
  loadOptions: (refresh?: boolean) => Promise<ComfyOptions | null>;
};

export const imageKey = (jobId: string, index: number) => `${jobId}:${index}`;

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

export const useComfyStore = create<ComfyState>((set, get) => {
  let statusRun: Promise<ComfyStatus> | null = null;
  let autodlRun: Promise<void> | null = null;
  let targetRun: Promise<void> | null = null;
  let optionsRun: Promise<ComfyOptions | null> | null = null;
  return {
    target: null,
    status: null,
    autodl: null,
    checking: false,
    options: null,
    optionsError: null,
    loadingOptions: false,
    progress: {},
    queue: {},

    // 同时有几处要问时只问一次
    checkStatus: () =>
      (statusRun ??= (async () => {
        set({ checking: true });
        try {
          const status = await api<ComfyStatus>('/comfy/status').catch((err: Error): ComfyStatus => ({ ok: false, url: null, error: err.message }));
          set({ status });
          return status;
        } finally {
          set({ checking: false });
          statusRun = null;
        }
      })()),

    checkAutodl: () =>
      (autodlRun ??= api<AutodlState>('/comfy/status?target=autodl')
        .then(applyAutodl, () => undefined)
        .finally(() => {
          autodlRun = null;
        })),

    loadTarget: (fresh = false) =>
      (targetRun = (!fresh && targetRun) || api<Config>('/config').then(
        (config) => set({ target: config.comfyTarget }),
        () => {
          targetRun = null;
        },
      )),

    // 换了一台，下拉选项要从那台重新读
    setTarget: async (target) => {
      if (get().target === target) return;
      try {
        const config = await api<Config>('/config', { method: 'PUT', body: { comfyTarget: target } });
        set({ target: config.comfyTarget, options: null, optionsError: null });
        const autodl = get().autodl;
        toast(target === 'lan' ? '换成局域网那台出图' : `AutoDL 实例出图。${autodl?.state === 'off' ? '它现在关着，点生图时会先开机，要等一两分钟' : ''}`);
      } catch (err) {
        failed(err);
      }
    },

    // 开机、关机、正在开机时「别开了」
    power: async (on) => {
      try {
        const before = get().autodl?.state;
        applyAutodl(await api<AutodlState>('/comfy/autodl/power', { method: 'POST', body: { on } }));
        if (!on) toast(before === 'booting' ? '不开了。已经发出的开机请求会让它开好后马上关掉' : 'AutoDL 实例正在关机');
      } catch (err) {
        failed(err);
      }
    },

    // 服务端按地址缓存，refresh 时重读；读不到记下原因
    loadOptions: (refresh = false) => {
      if (optionsRun && !refresh) return optionsRun;
      const load = async () => {
        set({ loadingOptions: true });
        try {
          const options = await api<ComfyOptions>(`/comfy/options${refresh ? '?refresh=1' : ''}`);
          set({ options, optionsError: null });
          return options;
        } catch (err) {
          set({ optionsError: (err as Error).message });
          return get().options;
        }
      };
      const run: Promise<ComfyOptions | null> = load().finally(() => {
        if (optionsRun === run) {
          optionsRun = null;
          set({ loadingOptions: false });
        }
      });
      optionsRun = run;
      return run;
    },
  };
});

// AutoDL 的状态：开好了说一声，开着就在扣钱
function applyAutodl(state: AutodlState) {
  const before = useComfyStore.getState().autodl;
  useComfyStore.setState({ autodl: { ...state, at: Date.now() } });
  if (before?.state === 'booting' && state.state === 'running') {
    toast(`AutoDL 实例开好了，开着就按秒扣钱，空闲 ${state.idleMinutes} 分钟会自动关`);
  }
}

// 进度和排第几：一张出完、叫停、失败了就不用再记
export function applyProgress(event: ImageJobEvent) {
  if (event.type === 'progress') {
    const key = imageKey(event.jobId, event.index);
    useComfyStore.setState((s) => {
      const { [key]: _, ...queue } = s.queue;
      return { progress: { ...s.progress, [key]: { step: event.step, total: event.total } }, queue };
    });
  } else if (event.type === 'queue') {
    useComfyStore.setState((s) => ({ queue: { ...s.queue, [imageKey(event.jobId, event.index)]: event.position } }));
  } else if (event.type === 'autodl') {
    const { type: _, ...state } = event;
    applyAutodl(state);
  } else {
    const ended = event.job.images.flatMap((image, index) => (image.status === 'queued' || image.status === 'running' ? [] : [imageKey(event.job.id, index)]));
    if (!ended.some((key) => key in useComfyStore.getState().progress || key in useComfyStore.getState().queue)) return;
    useComfyStore.setState((s) => ({
      progress: Object.fromEntries(Object.entries(s.progress).filter(([key]) => !ended.includes(key))),
      queue: Object.fromEntries(Object.entries(s.queue).filter(([key]) => !ended.includes(key))),
    }));
  }
}

// 收出图的变化；返回断开用的函数。几处一起收时共用一个连接，EventSource 断了会自己重连
const listeners = new Set<(event: ImageJobEvent) => void>();
let source: EventSource | null = null;

export function watchImageJobs(onEvent?: (event: ImageJobEvent) => void): () => void {
  const listener = (event: ImageJobEvent) => onEvent?.(event);
  listeners.add(listener);
  if (!source) {
    source = new EventSource('/api/image-jobs/events');
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as ImageJobEvent;
      applyProgress(event);
      listeners.forEach((listener) => listener(event));
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    source?.close();
    source = null;
  };
}

// 还剩几分钟自动关机，向上取整
export const idleMinutesLeft = (autodl: AutodlNow, now = Date.now()) =>
  autodl.idleLeftMs === null ? null : Math.max(0, Math.ceil((autodl.idleLeftMs - (now - autodl.at)) / 60_000));

// 这组在等 AutoDL 开机：发给 AutoDL 的、还有没发出去的，实例正在开
export const waitingBoot = (target: ComfyTarget, images: { status: string; promptId?: string }[], autodl: AutodlNow | null) =>
  target === 'autodl' && autodl?.state === 'booting' && images.some((image) => image.status === 'queued' && !image.promptId);
