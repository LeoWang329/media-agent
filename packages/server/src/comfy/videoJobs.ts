import {
  isLiveVideo as isLive,
  MAX_SEGMENTS,
  missingNodeTypes,
  PLUGIN_OF,
  splitSegments,
  videoGraph,
  videoParams,
  videoSettingsOf,
  videoStage,
  type ComfyGraph,
  type VideoJob,
  type VideoJobEvent,
  type VideoStage,
} from '@media-agent/shared';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { comfyClientId, readComfyConfig, readConfig } from '../config';
import { HttpError } from '../httpError';
import { listNodes, readAllCanvases, readNode, updateNode } from '../store/canvases';
import { withLock } from '../store/locks';
import { readSettings } from '../store/settings';
import { BootCancelled, type Autodl } from './autodl';
import * as comfy from './client';
import { saveVideoTemp } from './files';
import { loadObjectInfo } from './options';

// 一条视频挂在哪条回复下
export type VideoPlace = { work: string; canvasId: string; nodeId: string; messageId: string };

type Progress = Omit<Extract<VideoJobEvent, { type: 'progress' }>, 'type' | 'jobId'>;

// 发出去还没出完的一条，按 prompt_id 认；chunks 是分几段
type Tracked = VideoPlace & {
  jobId: string;
  promptId: string;
  seed: number;
  chunks: number;
  url: string;
  startedAt?: number;
  finishing?: boolean;
  position?: number;
  progress?: Progress;
};

type ComfyMessage = { type: string; data?: Record<string, unknown> };

const RECONNECT_MS = 3000;
const EARLY_KEEP_MS = 60_000;
const HISTORY_TRIES = 10;
const HISTORY_WAIT_MS = 300;

const randomSeed = () => randomInt(0, 2 ** 32);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// change 原样返回时不存盘
const UNCHANGED = new Error('没有要改的');

export type VideoAgain = { jobId: string; sameSeed: boolean };

export type VideoJobs = ReturnType<typeof createVideoJobs>;

// 生成视频任务，见 docs/dev-plan.md 5.27：点「生成视频」时建一条、存盘，等生成视频那台 AutoDL 开好，发给它上面的 ComfyUI；
// 开一个 WebSocket 收进度，出完把 mp4 取回来存进临时文件夹。状态变了推给 /video-jobs/events，那台 AutoDL 的状态也从这里推；
// 有视频在等开机、在跑时告诉它，空闲自动关机从出完算起
export function createVideoJobs(configDir: string, autodl: Autodl) {
  const tracked = new Map<string, Tracked>();
  // 发任务的回复还没回来、进度先到了的，先存着，记上 prompt_id 后再处理
  const early = new Map<string, { at: number; messages: ComfyMessage[] }>();
  const sockets = new Map<string, { ws?: WebSocket; ready: Promise<void> }>();
  const submitting = new Map<string, number>();
  const queueChecks = new Map<string, boolean>();
  const timers = new Set<NodeJS.Timeout>();
  const listeners = new Set<(event: VideoJobEvent) => void>();
  let clientId: Promise<string> | undefined;
  let closed = false;
  // 正在等开机或者正在发的条数
  let autodlWork = 0;

  const emit = (event: VideoJobEvent) => listeners.forEach((listener) => listener(event));
  const syncBusy = () => autodl.setBusy('videos', autodlWork > 0 || tracked.size > 0);
  const stopWatchingAutodl = autodl.subscribe((state) => emit({ type: 'autodl', ...state }));
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };
  const inUse = (url: string) => (submitting.get(url) ?? 0) > 0 || [...tracked.values()].some((t) => t.url === url);
  const ids = (place: VideoPlace) => ({ canvasId: place.canvasId, nodeId: place.nodeId, messageId: place.messageId });

  async function readJob(place: VideoPlace, jobId: string): Promise<VideoJob> {
    const node = await readNode(place.work, place.canvasId, place.nodeId);
    const job = node.messages[place.messageId]?.videos?.find((j) => j.id === jobId);
    if (!job) throw new HttpError(404, '找不到这条视频');
    return job;
  }

  // 改这一条、存盘、推给前端；change 原样返回的不存
  async function changeJob(place: VideoPlace, jobId: string, change: (job: VideoJob) => VideoJob): Promise<VideoJob> {
    let result!: VideoJob;
    let changed = false;
    try {
      await updateNode(place.work, place.canvasId, place.nodeId, (node) => {
        const message = node.messages[place.messageId];
        const job = message?.videos?.find((j) => j.id === jobId);
        if (!message || !job) throw new HttpError(404, '找不到这条视频');
        const next = change(job);
        result = job;
        if (next === job) throw UNCHANGED;
        result = { ...next, rev: (job.rev ?? 0) + 1 };
        changed = true;
        const videos = message.videos!.map((j) => (j.id === jobId ? result : j));
        return { ...node, messages: { ...node.messages, [message.id]: { ...message, videos } } };
      });
    } catch (err) {
      if (err !== UNCHANGED) throw err;
    }
    if (changed) emit({ type: 'job', ...ids(place), job: result });
    return result;
  }

  // ComfyUI 那边来的变化，只改还是这个 prompt_id、pick 说可以改的；节点或回复已经删了就算了
  const changeTracked = (t: Tracked, change: Partial<VideoJob>, pick: (job: VideoJob) => boolean = isLive) =>
    changeJob(t, t.jobId, (job) => (job.promptId === t.promptId && pick(job) ? { ...job, ...change } : job)).then(
      () => undefined,
      (err) => {
        if (!(err instanceof HttpError && err.status === 404)) console.error('更新生成视频的状态失败', err);
      },
    );

  // 点「生成视频」生成这个框，见 docs/dev-plan.md 5.27；again 是「同样参数再来」「只换种子再来」，照着那一条的参数
  async function create(place: VideoPlace, promptIndex: number, again?: VideoAgain): Promise<VideoJob> {
    const settings = await readSettings(place.work);
    const { autodlToken } = await readComfyConfig(configDir);
    if (!(autodlToken && settings.comfy.videoAutodl.instanceUuid)) throw new HttpError(400, '先在设置里填 AutoDL 的开发者 Token、选好生成视频用的实例');
    const node = await readNode(place.work, place.canvasId, place.nodeId);
    if (node.kind !== 'video') throw new HttpError(400, '生图节点不能生成视频');
    const message = node.messages[place.messageId];
    if (message?.role !== 'assistant') throw new HttpError(404, '找不到这条回复');

    const fresh = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'queued' as const };
    let job: VideoJob;
    if (again) {
      const from = message.videos?.find((j) => j.id === again.jobId);
      if (!from) throw new HttpError(404, '找不到要照着再来的那条视频');
      job = { ...fresh, promptIndex: from.promptIndex, source: { jobId: from.id }, params: from.params, seed: again.sameSeed ? from.seed : randomSeed() };
    } else {
      const box = message.parsed?.prompts[promptIndex];
      if (!box) throw new HttpError(404, `这条回复里没有第 ${promptIndex + 1} 个提示词框`);
      // 参考图和首帧 P20 才接，见 docs/dev-plan.md 5.26
      if (message.slotSnapshot.length) throw new HttpError(400, '带图的生成视频还没做');
      const segments = splitSegments(box.text);
      if (!segments.length) throw new HttpError(400, '这个框是空的');
      if (segments.length > MAX_SEGMENTS) throw new HttpError(400, `这个框分了 ${segments.length} 段，最多 ${MAX_SEGMENTS} 段`);
      const video = videoSettingsOf(node.video);
      job = { ...fresh, promptIndex, params: videoParams(segments, message.duration, message.aspectRatio, video), seed: video.seed ?? randomSeed() };
    }

    await updateNode(place.work, place.canvasId, place.nodeId, (current) => {
      const target = current.messages[place.messageId];
      if (!target) throw new HttpError(404, '找不到这条回复');
      return { ...current, messages: { ...current.messages, [target.id]: { ...target, videos: [...(target.videos ?? []), job] } } };
    });
    emit({ type: 'job', ...ids(place), job });
    void submit(place, job.id);
    return job;
  }

  // 等生成视频那台开好，对照它装了哪些节点，发出去；发之前看一眼是不是已经叫停了
  async function submit(place: VideoPlace, jobId: string): Promise<void> {
    autodlWork += 1;
    syncBusy();
    let url: string | null = null;
    try {
      const address = await autodl.ensureReady().catch((err) => {
        throw err instanceof BootCancelled ? err : new comfy.ComfyError(`AutoDL 开机失败：${(err as Error).message}`);
      });
      url = address;
      submitting.set(address, (submitting.get(address) ?? 0) + 1);
      await connect(address);
      await requireNodes(address, videoGraph((await readJob(place, jobId)).params, 0));
      const id = await (clientId ??= comfyClientId(configDir));
      await withLock(`video-job:${jobId}`, async () => {
        const job = await readJob(place, jobId);
        if (job.status !== 'queued' || job.promptId) return;
        const promptId = await comfy.queuePrompt(address, videoGraph(job.params, job.seed), id);
        await changeJob(place, jobId, (current) => ({ ...current, promptId }));
        track({ ...place, jobId, promptId, seed: job.seed, chunks: job.params.segments.length, url: address });
      });
      void refreshQueue(address);
    } catch (err) {
      // 连不上、AutoDL 没开成、缺插件、ComfyUI 不收：还没发出去的算失败；点了「别开了」的算叫停
      const change: Partial<VideoJob> = err instanceof BootCancelled ? { status: 'stopped' } : { status: 'failed', error: (err as Error).message };
      await changeJob(place, jobId, (job) => (job.status === 'queued' && !job.promptId ? { ...job, ...change } : job)).catch(() => {});
    } finally {
      if (url) {
        submitting.set(url, submitting.get(url)! - 1);
        closeIfIdle(url);
      }
      autodlWork -= 1;
      syncBusy();
    }
  }

  // 节点列表是缓存的，刚装了插件还没重读的话，重读一次再算
  async function requireNodes(url: string, graph: ComfyGraph): Promise<void> {
    let missing = missingNodeTypes(graph, Object.keys(await loadObjectInfo(url)));
    if (missing.length) missing = missingNodeTypes(graph, Object.keys(await loadObjectInfo(url, true)));
    if (!missing.length) return;
    const plugins = [...new Set(missing.flatMap((type) => (PLUGIN_OF[type] ? [PLUGIN_OF[type]] : [])))];
    throw new comfy.ComfyError(`这台 ComfyUI 缺插件：object_info 里没有 ${missing.join(', ')}${plugins.length ? `，要装 ${plugins.join('、')}` : ''}`);
  }

  function track(t: Tracked): void {
    tracked.set(t.promptId, t);
    syncBusy();
    const waiting = early.get(t.promptId);
    early.delete(t.promptId);
    for (const message of waiting?.messages ?? []) handle(t, message);
  }

  function untrack(t: Tracked): void {
    tracked.delete(t.promptId);
    syncBusy();
    closeIfIdle(t.url);
  }

  // 这台 ComfyUI 上没有要等的了，断开
  function closeIfIdle(url: string): void {
    if (inUse(url)) return;
    const socket = sockets.get(url);
    sockets.delete(url);
    socket?.ws?.close();
  }

  function connect(url: string): Promise<void> {
    const existing = sockets.get(url);
    if (existing) return existing.ready;
    const entry: { ws?: WebSocket; ready: Promise<void> } = { ready: Promise.resolve() };
    entry.ready = (clientId ??= comfyClientId(configDir)).then(
      (id) =>
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`${url.replace(/^http/i, 'ws')}/ws?clientId=${encodeURIComponent(id)}`);
          entry.ws = ws;
          ws.addEventListener('open', () => resolve());
          ws.addEventListener('error', () => reject(new comfy.ComfyError(`连不上 ComfyUI 的进度推送（${url}/ws）：地址不对，或者 ComfyUI 没开`)));
          ws.addEventListener('message', (event) => {
            // 预览图这类二进制的不管
            if (typeof event.data !== 'string') return;
            let message: ComfyMessage;
            try {
              message = JSON.parse(event.data);
            } catch {
              return;
            }
            onMessage(url, message);
          });
          ws.addEventListener('close', () => {
            if (sockets.get(url) === entry) sockets.delete(url);
            if (!closed && inUse(url)) later(() => void reconnect(url), RECONNECT_MS);
          });
        }),
    );
    entry.ready.catch(() => {
      if (sockets.get(url) === entry) sockets.delete(url);
    });
    sockets.set(url, entry);
    return entry.ready;
  }

  // 断了重连，连上后把断线期间的变化补上；连不上过一会儿再试
  async function reconnect(url: string): Promise<void> {
    if (closed || !inUse(url)) return;
    try {
      await connect(url);
    } catch {
      return;
    }
    for (const t of [...tracked.values()].filter((item) => item.url === url)) {
      await check(t, 'ComfyUI 那边找不到这条了，可能重启过').catch(() => {});
    }
  }

  function onMessage(url: string, message: ComfyMessage): void {
    if (message.type === 'status') return void refreshQueue(url);
    const promptId = message.data?.prompt_id;
    if (typeof promptId !== 'string') return;
    const t = tracked.get(promptId);
    if (t) return handle(t, message);
    const now = Date.now();
    for (const [id, entry] of early) if (now - entry.at > EARLY_KEEP_MS) early.delete(id);
    const entry = early.get(promptId) ?? { at: now, messages: [] };
    entry.messages.push(message);
    early.set(promptId, entry);
  }

  // ComfyUI 推来的事件：开始跑、跑到哪个节点、第几步、出完了（新版本发 execution_success，都会发 node 为 null 的 executing）、出错、被叫停
  function handle(t: Tracked, { type, data = {} }: ComfyMessage): void {
    if (type === 'execution_start' || (type === 'executing' && data.node !== null)) {
      if (!t.startedAt) {
        t.startedAt = Date.now();
        void changeTracked(t, { status: 'running' }, (job) => job.status === 'queued');
        // 编码完提示词之前是在加载文字编码器这些，算在编码提示词里
        setStage(t, 'encode');
      }
      const stage = type === 'executing' ? videoStage(String(data.node)) : null;
      if (stage) setStage(t, stage);
    } else if (type === 'progress') {
      onProgress(t, data);
    } else if (type === 'execution_success' || type === 'executing') {
      void finish(t);
    } else if (type === 'execution_error') {
      void end(t, { status: 'failed', error: comfy.describeExecutionError(data, '生成视频') });
    } else if (type === 'execution_interrupted') {
      void end(t, { status: 'stopped' });
    }
  }

  // 到了哪一步；一采、二采从第 0 段算起，收到第一步时是第 1 段
  function setStage(t: Tracked, stage: VideoStage): void {
    if (t.progress?.stage === stage) return;
    t.progress = { stage, chunk: 0, chunks: t.chunks, step: 0, steps: 0 };
    emit({ type: 'progress', jobId: t.jobId, ...t.progress });
  }

  // 一采、二采每段从第 1 步数到最后一步，步数变小了就是到了下一段。别的节点的进度不管
  function onProgress(t: Tracked, data: Record<string, unknown>): void {
    const stage = data.node === undefined || data.node === null ? t.progress?.stage : videoStage(String(data.node));
    if (stage !== 'pass1' && stage !== 'pass2') return;
    setStage(t, stage);
    const progress = t.progress!;
    const step = Number(data.value);
    if (progress.chunk === 0 || step < progress.step) progress.chunk = Math.min(progress.chunk + 1, progress.chunks);
    progress.step = step;
    progress.steps = Number(data.max);
    emit({ type: 'progress', jobId: t.jobId, ...progress });
  }

  // 出完了：从 /history 找到 mp4，取回来存进临时文件夹
  async function finish(t: Tracked): Promise<void> {
    if (t.finishing) return;
    t.finishing = true;
    try {
      await end(t, await collect(t));
    } catch (err) {
      await end(t, { status: 'failed', error: (err as Error).message });
    }
  }

  async function collect(t: Tracked): Promise<Partial<VideoJob>> {
    // ComfyUI 先推「出完了」再写 /history，取不到就稍等再取
    let entry: comfy.HistoryEntry | null = null;
    for (let i = 0; i < HISTORY_TRIES && !entry; i += 1) {
      if (i) await sleep(HISTORY_WAIT_MS);
      entry = await comfy.history(t.url, t.promptId);
    }
    const messages = entry?.status?.messages ?? [];
    const failed = messages.find(([type]) => type === 'execution_error');
    if (failed) return { status: 'failed', error: comfy.describeExecutionError(failed[1], '生成视频') };
    if (messages.some(([type]) => type === 'execution_interrupted')) return { status: 'stopped' };
    // MMH3StreamingSave 把 mp4 记在 images 里
    const ref = Object.values(entry?.outputs ?? {})
      .flatMap((output) => output.images ?? [])
      .find((item) => /\.mp4$/i.test(item.filename));
    if (!ref) return { status: 'failed', error: 'ComfyUI 说出完了，但没找到出的视频' };
    const file = await saveVideoTemp(t.work, t.seed, (target) => comfy.saveView(t.url, ref, target));
    const { size } = await fs.stat(path.join(t.work, file));
    return { status: 'done', file, bytes: size, ...(t.startedAt && { ms: Date.now() - t.startedAt }) };
  }

  async function end(t: Tracked, change: Partial<VideoJob>): Promise<void> {
    untrack(t);
    await changeTracked(t, change);
  }

  // 按 prompt_id 查一次：出完了就取视频；还在 ComfyUI 队列里接着等；都不在算失败
  async function check(t: Tracked, lost: string): Promise<void> {
    if (await comfy.history(t.url, t.promptId)) return finish(t);
    const { running, pending } = await comfy.queueState(t.url);
    if (running.includes(t.promptId) || pending.includes(t.promptId)) return;
    if (await comfy.history(t.url, t.promptId)) return finish(t);
    await end(t, { status: 'failed', error: lost });
  }

  // 排在第几：问一次 /queue；正在问的时候又有变化，问完再问一次
  async function refreshQueue(url: string): Promise<void> {
    if (queueChecks.has(url)) {
      queueChecks.set(url, true);
      return;
    }
    try {
      do {
        queueChecks.set(url, false);
        const waiting = [...tracked.values()].filter((t) => t.url === url);
        if (!waiting.length) break;
        const { pending } = await comfy.queueState(url);
        for (const t of waiting) {
          const position = pending.indexOf(t.promptId) + 1;
          if (position && position !== t.position) emit({ type: 'queue', jobId: t.jobId, position });
          t.position = position;
        }
      } while (queueChecks.get(url));
    } catch {
      // 问不到排第几不要紧，进度照样走
    } finally {
      queueChecks.delete(url);
    }
  }

  // 叫停：还没发出去的和还在排队的直接算叫停；正在跑的让 ComfyUI 停，等它说停了；刚跑完的等它取回来
  function stop(place: VideoPlace, jobId: string): Promise<VideoJob> {
    return withLock(`video-job:${jobId}`, async () => {
      const job = await readJob(place, jobId);
      if (!isLive(job)) return job;
      const t = job.promptId ? tracked.get(job.promptId) : undefined;
      if (t) {
        // ComfyUI 连不上时直接算叫停
        const state = await comfy.queueState(t.url).catch(() => null);
        if (state && !state.pending.includes(t.promptId)) {
          if (state.running.includes(t.promptId)) await comfy.interrupt(t.url, t.promptId).catch(() => {});
          return job;
        }
        if (state) await comfy.deleteQueued(t.url, [t.promptId]).catch(() => {});
        untrack(t);
      }
      return changeJob(place, jobId, (current) => (isLive(current) ? { ...current, status: 'stopped' } : current));
    });
  }

  // 删一条：临时文件直接删，不进 .trash；下载过的那份不动
  function remove(place: VideoPlace, jobId: string): Promise<void> {
    return withLock(`video-job:${jobId}`, async () => {
      const job = await readJob(place, jobId);
      if (isLive(job)) throw new HttpError(409, '这条还没出完，先叫停');
      if (job.file) await fs.rm(path.join(place.work, job.file), { force: true });
      await updateNode(place.work, place.canvasId, place.nodeId, (node) => {
        const message = node.messages[place.messageId];
        if (!message) throw new HttpError(404, '找不到这条回复');
        return { ...node, messages: { ...node.messages, [message.id]: { ...message, videos: (message.videos ?? []).filter((j) => j.id !== jobId) } } };
      });
      emit({ type: 'removed', ...ids(place), jobId });
    });
  }

  // 记下下载到哪
  function setSaved(place: VideoPlace, jobId: string, savedPath: string): Promise<VideoJob> {
    return withLock(`video-job:${jobId}`, () => changeJob(place, jobId, (job) => ({ ...job, savedPath })));
  }

  // 服务启动时：没出完的按 prompt_id 查一次，见 docs/dev-plan.md 5.27。只在生成视频那台开着时查得到
  async function resume(): Promise<void> {
    const { workFolder: work } = await readConfig(configDir);
    if (!work) return;
    let url: Promise<string | null> | undefined;
    for (const canvas of await readAllCanvases(work).catch(() => [])) {
      for (const node of await listNodes(work, canvas.id).catch(() => [])) {
        for (const message of Object.values(node.messages)) {
          for (const job of message.videos ?? []) {
            if (!isLive(job)) continue;
            const place = { work, canvasId: canvas.id, nodeId: node.id, messageId: message.id };
            await recover(place, job, await (url ??= autodl.address().catch(() => null)));
          }
        }
      }
    }
  }

  async function recover(place: VideoPlace, job: VideoJob, url: string | null): Promise<void> {
    const lost = '程序重启时这条还没出完';
    if (!url || !job.promptId) {
      await changeJob(place, job.id, (current) => (isLive(current) ? { ...current, status: 'failed', error: lost } : current)).catch(() => {});
      return;
    }
    const t: Tracked = { ...place, jobId: job.id, promptId: job.promptId, seed: job.seed, chunks: job.params.segments.length, url };
    try {
      await connect(url);
      track(t);
      await check(t, lost);
    } catch (err) {
      await end(t, { status: 'failed', error: `程序重启后查不到这条出没出完：${(err as Error).message}` });
    }
  }

  // 新连上的页面先拿到生成视频那台的状态、现在排第几、做到哪一步，之后再收变化
  function subscribe(listener: (event: VideoJobEvent) => void): () => void {
    listener({ type: 'autodl', ...autodl.current() });
    for (const t of tracked.values()) {
      if (t.position) listener({ type: 'queue', jobId: t.jobId, position: t.position });
      if (t.progress) listener({ type: 'progress', jobId: t.jobId, ...t.progress });
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // 测试收尾和服务退出时用：断开全部连接，不再重连
  function close(): void {
    closed = true;
    stopWatchingAutodl();
    timers.forEach(clearTimeout);
    for (const socket of sockets.values()) socket.ws?.close();
    sockets.clear();
    tracked.clear();
    listeners.clear();
  }

  return { create, stop, remove, setSaved, subscribe, resume, close };
}
