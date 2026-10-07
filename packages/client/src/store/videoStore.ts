import type { AutodlState, VideoJobEvent } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';
import { toast } from '../ui/toast';
import type { AutodlNow } from './comfyStore';

// 生成视频那台 AutoDL 的状态、每条视频做到哪一步和排第几，从 /video-jobs/events 收，不存盘，见 docs/dev-plan.md 5.25、5.27

export type VideoProgress = Omit<Extract<VideoJobEvent, { type: 'progress' }>, 'type' | 'jobId'>;

type VideoState = {
  autodl: AutodlNow | null; // 还没问过是 null
  progress: Record<string, VideoProgress>; // 键是视频的 id
  queue: Record<string, number>;
  checkAutodl: () => Promise<void>;
  power: (on: boolean) => Promise<void>;
};

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

export const useVideoStore = create<VideoState>((_set, get) => {
  let autodlRun: Promise<void> | null = null;
  return {
    autodl: null,
    progress: {},
    queue: {},

    checkAutodl: () =>
      (autodlRun ??= api<AutodlState>('/comfy/video/status')
        .then(applyAutodl, () => undefined)
        .finally(() => {
          autodlRun = null;
        })),

    // 开机、关机、正在开机时「别开了」
    power: async (on) => {
      try {
        const before = get().autodl?.state;
        applyAutodl(await api<AutodlState>('/comfy/video/power', { method: 'POST', body: { on } }));
        if (!on) toast(before === 'booting' ? '不开了。已经发出的开机请求会让它开好后马上关掉' : '生成视频用的 AutoDL 实例正在关机');
      } catch (err) {
        failed(err);
      }
    },
  };
});

function applyAutodl(state: AutodlState) {
  const before = useVideoStore.getState().autodl;
  useVideoStore.setState({ autodl: { ...state, at: Date.now() } });
  if (before?.state === 'booting' && state.state === 'running') {
    toast(`生成视频用的 AutoDL 实例开好了，开着就按秒扣钱，空闲 ${state.idleMinutes} 分钟会自动关`);
  }
}

// 进度和排第几：出完、叫停、失败了、删掉了就不用再记
function applyEvent(event: VideoJobEvent) {
  if (event.type === 'progress') {
    const { type: _, jobId, ...progress } = event;
    useVideoStore.setState((s) => {
      const { [jobId]: __, ...queue } = s.queue;
      return { progress: { ...s.progress, [jobId]: progress }, queue };
    });
  } else if (event.type === 'queue') {
    useVideoStore.setState((s) => ({ queue: { ...s.queue, [event.jobId]: event.position } }));
  } else if (event.type === 'autodl') {
    const { type: _, ...state } = event;
    applyAutodl(state);
  } else {
    const jobId = event.type === 'removed' ? event.jobId : event.job.id;
    const ended = event.type === 'removed' || (event.job.status !== 'queued' && event.job.status !== 'running');
    const { progress, queue } = useVideoStore.getState();
    if (!ended || !(jobId in progress || jobId in queue)) return;
    useVideoStore.setState((s) => {
      const { [jobId]: _, ...restProgress } = s.progress;
      const { [jobId]: __, ...restQueue } = s.queue;
      return { progress: restProgress, queue: restQueue };
    });
  }
}

// 收生成视频的变化；返回断开用的函数。几处一起收时共用一个连接，EventSource 断了会自己重连
const listeners = new Set<(event: VideoJobEvent) => void>();
let source: EventSource | null = null;

export function watchVideoJobs(onEvent?: (event: VideoJobEvent) => void): () => void {
  const listener = (event: VideoJobEvent) => onEvent?.(event);
  listeners.add(listener);
  if (!source) {
    source = new EventSource('/api/video-jobs/events');
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as VideoJobEvent;
      applyEvent(event);
      listeners.forEach((one) => one(event));
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    source?.close();
    source = null;
  };
}
