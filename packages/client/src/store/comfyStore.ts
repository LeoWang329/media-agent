import type { ComfyOptions, ComfyStatus, ImageJobEvent } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';

// 局域网那台 ComfyUI 的状态和下拉选项，画布、首页、设置三页共用；
// 出图的进度和排第几从 /image-jobs/events 收，不存盘，见 docs/dev-plan.md 5.19

type ComfyState = {
  status: ComfyStatus | null; // 还没问过是 null
  checking: boolean;
  options: ComfyOptions | null;
  optionsError: string | null;
  loadingOptions: boolean;
  progress: Record<string, { step: number; total: number }>; // 键是「组 id:第几张」
  queue: Record<string, number>;
  checkStatus: () => Promise<ComfyStatus>;
  loadOptions: (refresh?: boolean) => Promise<ComfyOptions | null>;
};

export const imageKey = (jobId: string, index: number) => `${jobId}:${index}`;

export const useComfyStore = create<ComfyState>((set, get) => {
  let statusRun: Promise<ComfyStatus> | null = null;
  let optionsRun: Promise<ComfyOptions | null> | null = null;
  return {
    status: null,
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
  } else {
    const ended = event.job.images.flatMap((image, index) => (image.status === 'queued' || image.status === 'running' ? [] : [imageKey(event.job.id, index)]));
    if (!ended.some((key) => key in useComfyStore.getState().progress || key in useComfyStore.getState().queue)) return;
    useComfyStore.setState((s) => ({
      progress: Object.fromEntries(Object.entries(s.progress).filter(([key]) => !ended.includes(key))),
      queue: Object.fromEntries(Object.entries(s.queue).filter(([key]) => !ended.includes(key))),
    }));
  }
}

// 收出图的变化；返回断开用的函数。EventSource 断了会自己重连
export function watchImageJobs(onEvent: (event: ImageJobEvent) => void): () => void {
  const source = new EventSource('/api/image-jobs/events');
  source.onmessage = (e) => {
    const event = JSON.parse(e.data) as ImageJobEvent;
    applyProgress(event);
    onEvent(event);
  };
  return () => source.close();
}
