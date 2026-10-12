import type { AutodlState, VideoBoard, VideoJobEvent, VideoOptions } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';
import { toast } from '../ui/toast';
import type { AutodlNow } from './comfyStore';

// 生成视频那台 AutoDL 的状态、每条视频做到哪一步和排第几，从 /video-jobs/events 收，不存盘，见 docs/dev-plan.md 5.25、5.27；
// 视频任务小窗的列表从 /video-jobs 读，有一条变了再读一次，见 5.29；生成设置里的主模型和 LoRA 从生成视频那台读

export type VideoProgress = Omit<Extract<VideoJobEvent, { type: 'progress' }>, 'type' | 'jobId'>;

type VideoState = {
  autodl: AutodlNow | null; // 还没问过是 null
  progress: Record<string, VideoProgress>; // 键是视频的 id
  queue: Record<string, number>;
  board: VideoBoard | null; // 还没读过是 null
  flash: { jobId: string; seq: number } | null; // 从视频任务小窗点过来的那条，闪一下
  options: VideoOptions | null; // 还没读到是 null，读不到的原因在 optionsError
  optionsError: string | null;
  checkAutodl: () => Promise<void>;
  loadOptions: (refresh?: boolean) => Promise<void>;
  power: (on: boolean) => Promise<void>;
  loadBoard: () => Promise<void>;
  flashVideo: (jobId: string) => void;
};

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

export const useVideoStore = create<VideoState>((set, get) => {
  let autodlRun: Promise<void> | null = null;
  let boardRun: Promise<void> | null = null;
  let boardAgain = false;
  let flashSeq = 0;
  return {
    autodl: null,
    progress: {},
    queue: {},
    board: null,
    flash: null,
    options: null,
    optionsError: null,

    loadOptions: async (refresh = false) => {
      try {
        set({ options: await api<VideoOptions>(`/comfy/video/options${refresh ? '?refresh=1' : ''}`), optionsError: null });
      } catch (err) {
        set({ optionsError: (err as Error).message });
      }
    },

    // 正在读的时候又有变化，读完再读一次
    loadBoard: () => {
      if (boardRun) {
        boardAgain = true;
        return boardRun;
      }
      boardRun = (async () => {
        do {
          boardAgain = false;
          const board = await api<VideoBoard>('/video-jobs').catch(() => null);
          if (board) set({ board });
        } while (boardAgain);
      })().finally(() => {
        boardRun = null;
      });
      return boardRun;
    },

    flashVideo: (jobId) => {
      const seq = ++flashSeq;
      set({ flash: { jobId, seq } });
      setTimeout(() => get().flash?.seq === seq && set({ flash: null }), 1600);
    },

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
export function applyVideoEvent(event: VideoJobEvent) {
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
    if (useVideoStore.getState().board) void useVideoStore.getState().loadBoard();
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
const listeners = new Map<(event: VideoJobEvent) => void, (() => void) | undefined>();
let source: EventSource | null = null;

export function watchVideoJobs(onEvent?: (event: VideoJobEvent) => void, onConnected?: () => void): () => void {
  const listener = (event: VideoJobEvent) => onEvent?.(event);
  listeners.set(listener, onConnected);
  if (!source) {
    source = new EventSource('/api/video-jobs/events');
    // SSE 不会补发断线期间的 job 事件；重连时补读状态，不能只靠新进度判断完成。
    source.onopen = () => {
      if (useVideoStore.getState().board) void useVideoStore.getState().loadBoard();
      listeners.forEach((connected) => connected?.());
    };
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as VideoJobEvent;
      applyVideoEvent(event);
      listeners.forEach((_, one) => one(event));
    };
  } else if (source.readyState === EventSource.OPEN) onConnected?.();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    source?.close();
    source = null;
  };
}
