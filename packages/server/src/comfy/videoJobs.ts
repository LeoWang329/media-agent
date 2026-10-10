import {
  addTiming,
  isLiveVideo as isLive,
  lengthProblem,
  MAX_SEGMENTS,
  mediaProblems,
  videoMediaOf,
  LATENT_DIR,
  LATENT_SAVE,
  selfliftClipGraph,
  selfliftClips,
  selfliftMergeGraph,
  stepsOf,
  reshootGraph,
  reshootPlan,
  missingNodeTypes,
  PLUGIN_OF,
  PREVIEW_NODE,
  splitSegments,
  videoGraph,
  videoParams,
  videoSettingsOf,
  videoImageUse,
  videoStage,
  workflowOf,
  type ComfyGraph,
  type MediaSlot,
  type VideoChain,
  type VideoChainClip,
  type VideoFiles,
  type VideoImages,
  type VideoImageUse,
  type VideoJob,
  type VideoJobEvent,
  type VideoJobParams,
  type VideoLatents,
  type VideoBoard,
  type VideoStage,
  type VideoTask,
  type VideoTiming,
} from '@media-agent/shared';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { comfyClientId, readComfyConfig, readConfig } from '../config';
import { HttpError } from '../httpError';
import { listNodes, readAllCanvases, readNode, updateNode } from '../store/canvases';
import { canvasImagePath, readImage } from '../store/images';
import { canvasMediaPath, readMediaRecords } from '../store/media';
import { readJson, writeJsonAtomic } from '../store/jsonFile';
import { withLock } from '../store/locks';
import { readSettings } from '../store/settings';
import { BootCancelled, type Autodl } from './autodl';
import * as comfy from './client';
import { saveVideoTemp } from './files';
import { connect as sshConnect, quote, run as sshRun } from './ssh';
import { loadObjectInfo } from './options';

// 一条视频挂在哪条回复下
export type VideoPlace = { work: string; canvasId: string; nodeId: string; messageId: string };

type Progress = Omit<Extract<VideoJobEvent, { type: 'progress' }>, 'type' | 'jobId'>;

// 发出去还没出完的一条，按 prompt_id 认；chunks 是分几段；stageAt 是每一步从什么时候开始的，passSteps 是一采、二采每段几步，出完记用时用
type Tracked = VideoPlace & {
  jobId: string;
  promptId: string;
  seed: number;
  params: VideoJobParams;
  chunks: number;
  url: string;
  startedAt?: number;
  finishing?: boolean;
  // 一采那份低清预览正在取，别重复取
  previewing?: boolean;
  position?: number;
  progress?: Progress;
  stageAt: Partial<Record<VideoStage, number>>;
  passSteps: Partial<Record<'pass1' | 'pass2', number>>;
  // 存档存在哪台实例上
  instance: string;
  // 传上去的图和视频在那台上的名字；接力那套每段都要用，接着发下一段时不用再传一遍
  files?: VideoFiles;
  // SelfLift 接续那套接力：一共几段、现在跑的是第几段（从 0 数；等于 total 时是在拼最后那一条）
  chain?: { total: number; clip: number };
  // 拼起来那一条跑完以后这条要写成什么：叫停留下的就是 { status: 'stopped', partial: true }
  ending?: Partial<VideoJob>;
};

type Ids = { canvasId: string; nodeId: string; messageId: string };

type ComfyMessage = { type: string; data?: Record<string, unknown> };

const RECONNECT_MS = 3000;
const EARLY_KEEP_MS = 60_000;
const HISTORY_TRIES = 10;
const HISTORY_WAIT_MS = 300;

// 视频任务小窗里「完了的」最多列几条
const FINISHED_KEPT = 10;
const timingsFile = (work: string) => path.join(work, 'video-timings.json');
// 删视频时那台关着、没删成的存档，下次开机删，见 docs/dev-plan.md 5.30
const latentTrashFile = (work: string) => path.join(work, 'video-latents-trash.json');
type LatentTrash = { instance: string; files: string[] }[];

const randomSeed = () => randomInt(0, 2 ** 32);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 生成视频那台的 ComfyUI 装在哪：SelfLift 接续那套要把上一段出的片子拷进 input 目录，下一段才读得到，见 docs/dev-plan.md 5.32。
// 这版 ComfyUI 的「文件名[output]」写法是坏的（annotated_filepath 少截一个字符），所以只能拷进 input
const COMFY_DIR = '/root/ComfyUI';
const COMFY_OUTPUT = `${COMFY_DIR}/output`;
const COMFY_INPUT = `${COMFY_DIR}/input`;

// 接力那套一段存一个名字：拷进那台 input 目录以后叫什么（下一段的 LoadVideo 和最后拼接都读它）
const chainName = (jobId: string, clip: number) => `media_agent_${jobId}_s${clip}.mp4`;

// 这条要分几段接力：两遍生成那套没有接力，返回 undefined
const chainOf = (params: VideoJobParams): VideoChain | undefined =>
  workflowOf(params) === 'selflift' ? { total: selfliftClips(params).lengths.length, clips: [] } : undefined;

// change 原样返回时不存盘
const UNCHANGED = new Error('没有要改的');

export type VideoAgain = { jobId: string; sameSeed: boolean };
// 重拍一截：在哪一版上重拍、第几帧到第几帧（不含）、种子（null 是随机）、改过的段（键是第几段，从 0 数），见 docs/dev-plan.md 5.30
export type VideoReshoot = { jobId: string; from: number; to: number; seed: number | null; prompts: Record<number, string> };

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
  // 视频任务小窗用，见 docs/dev-plan.md 5.29：在做的和排着的在哪；这次开程序以后完了的，新的在前
  const liveJobs = new Map<string, Ids>();
  const finished: (Ids & { jobId: string })[] = [];

  const emit = (event: VideoJobEvent) => {
    noteBoard(event);
    listeners.forEach((listener) => listener(event));
  };
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
  const ids = (place: VideoPlace): Ids => ({ canvasId: place.canvasId, nodeId: place.nodeId, messageId: place.messageId });

  // 一条变成没在做的了，从在做的挪到完了的；删掉的两边都去掉
  function noteBoard(event: VideoJobEvent): void {
    if (event.type === 'removed') {
      liveJobs.delete(event.jobId);
      const index = finished.findIndex((item) => item.jobId === event.jobId);
      if (index >= 0) finished.splice(index, 1);
      return;
    }
    if (event.type !== 'job') return;
    const where = { canvasId: event.canvasId, nodeId: event.nodeId, messageId: event.messageId };
    if (isLive(event.job)) return void liveJobs.set(event.job.id, where);
    if (!liveJobs.delete(event.job.id)) return;
    finished.unshift({ ...where, jobId: event.job.id });
    finished.splice(FINISHED_KEPT);
  }

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

  // 叫停算成什么：已经拿到一采那份低清版的就把它转正成这条的结果，能播能下载，不叫人白等一场，见 docs/dev-plan.md 5.27。
  // 叫停有三条路（还在排队的、正在跑被 ComfyUI 打断的、/history 里看到被打断的），都得走这一个
  const stoppedChange = (job: VideoJob | null | undefined): Partial<VideoJob> => ({ status: 'stopped', ...(job?.preview && { file: job.preview, partial: true }) });

  // ComfyUI 那边来的变化，只改还是这个 prompt_id、pick 说可以改的；节点或回复已经删了就算了
  const changeTracked = (t: Tracked, change: Partial<VideoJob>, pick: (job: VideoJob) => boolean = isLive) =>
    changeJob(t, t.jobId, (job) => (job.promptId === t.promptId && pick(job) ? { ...job, ...change } : job)).then(
      () => undefined,
      (err) => {
        if (!(err instanceof HttpError && err.status === 404)) console.error('更新生成视频的状态失败', err);
      },
    );

  // 点「生成视频」生成这个框，见 docs/dev-plan.md 5.27；again 是「同样参数再来」「只换种子再来」，照着那一条的参数；
  // reshoot 是在一条出完的视频上重拍一截，出的是原片的一个版本，见 5.30
  async function create(place: VideoPlace, promptIndex: number, again?: VideoAgain, reshoot?: VideoReshoot): Promise<VideoJob> {
    const settings = await readSettings(place.work);
    const { autodlToken } = await readComfyConfig(configDir);
    if (!(autodlToken && settings.comfy.videoAutodl.instanceUuid)) throw new HttpError(400, '先在设置里填 AutoDL 的开发者 Token、选好生成视频用的实例');
    const node = await readNode(place.work, place.canvasId, place.nodeId);
    if (node.kind !== 'video') throw new HttpError(400, '生图节点不能生成视频');
    const message = node.messages[place.messageId];
    if (message?.role !== 'assistant') throw new HttpError(404, '找不到这条回复');

    const fresh = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'queued' as const };
    let job: VideoJob;
    if (reshoot) {
      const base = message.videos?.find((j) => j.id === reshoot.jobId);
      if (!base) throw new HttpError(404, '找不到要重拍的那条视频');
      if (base.status !== 'done') throw new HttpError(400, '这条还没出完，出完了才能重拍');
      if (!base.latents) throw new HttpError(400, '这条出的时候没存一采、二采的结果，只能整条重出');
      if (workflowOf(base.params) === 'selflift') throw new HttpError(400, 'SelfLift 那套只有一遍、没存一采二采，不能重拍一截；要改就整条重出，或者用两遍生成那套');
      if (base.latents.instance !== settings.comfy.videoAutodl.instanceUuid) throw new HttpError(400, '那台上没有这条的存档了，只能整条重出');
      const plan = reshootPlan(base.params, reshoot.from, reshoot.to);
      if (plan.toLatent <= plan.fromLatent) throw new HttpError(400, '选的这一截太短了');
      const segments = base.params.segments.map((text, i) => (i >= plan.firstWindow && i <= plan.lastWindow && reshoot.prompts[i]?.trim() ? reshoot.prompts[i] : text));
      job = {
        ...fresh,
        promptIndex: base.promptIndex,
        parent: base.parent ?? base.id,
        reshoot: { base: base.id, from: plan.from, to: plan.to },
        params: { ...base.params, segments },
        seed: reshoot.seed ?? randomSeed(),
      };
    } else if (again) {
      const from = message.videos?.find((j) => j.id === again.jobId);
      if (!from) throw new HttpError(404, '找不到要照着再来的那条视频');
      job = { ...fresh, promptIndex: from.promptIndex, source: { jobId: from.id }, params: from.params, seed: again.sameSeed ? from.seed : randomSeed() };
    } else {
      const box = message.parsed?.prompts[promptIndex];
      if (!box) throw new HttpError(404, `这条回复里没有第 ${promptIndex + 1} 个提示词框`);
      const use = videoImageUse(message.systemPromptName);
      if (use === 'unsupported') throw new HttpError(400, '首尾帧、尾帧这两种提示词写的还不能生成视频，现在支持参考模式、图当首帧和纯文字');
      const segments = splitSegments(box.text);
      if (!segments.length) throw new HttpError(400, '这个框是空的');
      if (segments.length > MAX_SEGMENTS) throw new HttpError(400, `这个框分了 ${segments.length} 段，最多 ${MAX_SEGMENTS} 段`);
      // 段数写少了出来的片子会比要的短，这里拦下来，别白跑一趟，见 docs/dev-plan.md 5.24
      const length = lengthProblem(node.duration, segments.length);
      if (length) throw new HttpError(400, length);
      const video = videoSettingsOf(node.video);
      const images = await imagesOf(place, message.slotSnapshot, use);
      const media = await mediaOf(place, message.mediaSnapshot ?? [], use, images.refs.length);
      // 时长按节点现在的（面板上那个），不按写这条回复时记的：写完之后把时长拨大了再生成，出的就是拨大的那个，见 docs/dev-plan.md 5.24
      job = { ...fresh, promptIndex, params: videoParams(segments, node.duration, message.aspectRatio, video, images, media), seed: video.seed ?? randomSeed() };
    }

    // SelfLift 接续那套是分段接力的：先记上要分几段，一段一个任务发给 ComfyUI，见 docs/dev-plan.md 5.32
    const chain = chainOf(job.params);
    if (chain) job.chain = chain;
    await updateNode(place.work, place.canvasId, place.nodeId, (current) => {
      const target = current.messages[place.messageId];
      if (!target) throw new HttpError(404, '找不到这条回复');
      return { ...current, messages: { ...current.messages, [target.id]: { ...target, videos: [...(target.videos ?? []), job] } } };
    });
    emit({ type: 'job', ...ids(place), job });
    void submit(place, job.id);
    return job;
  }

  // 槽位的图怎么带，见 docs/dev-plan.md 5.26：参考模式的都当参考图；图当首帧的只带第一张，钉在第 0 帧，也当 <Picture 1>；纯文字的不带
  async function imagesOf(place: VideoPlace, slots: string[], use: VideoImageUse): Promise<VideoImages> {
    if (use === 'refs') return { refs: [...slots] };
    if (use !== 'first' || !slots.length) return { refs: [] };
    const record = await readImage(place.work, place.canvasId, slots[0]);
    return { refs: [record.id], firstFrame: { id: record.id, width: record.width, height: record.height } };
  }

  // 视频和音频怎么带，见 docs/dev-plan.md 5.31：参考的只在参考模式带，配音都带；超了上限的不发，说清楚哪条超了
  async function mediaOf(place: VideoPlace, snapshot: MediaSlot[], use: VideoImageUse, pictures: number) {
    const used = use === 'refs' ? snapshot : snapshot.filter((slot) => slot.use === 'dub');
    const problems = mediaProblems(used, pictures);
    if (problems.length) throw new HttpError(400, `视频和音频超了上限：${problems.join('；')}。删掉一段、改好再写一条`);
    const records = used.length ? await readMediaRecords(place.work, place.canvasId) : {};
    return videoMediaOf(used, (id) => records[id]);
  }

  // 带的视频和音频传给 ComfyUI，用画布里存的那份；返回读的节点要填的名字，顺序和 params.media 一样
  async function uploadMedia(place: VideoPlace, params: VideoJobParams, url: string): Promise<string[]> {
    const records = params.media?.length ? await readMediaRecords(place.work, place.canvasId) : {};
    const names = new Map<string, string>();
    for (const item of params.media ?? []) {
      if (names.has(item.mediaId)) continue;
      const record = records[item.mediaId];
      const file = record && canvasMediaPath(place.work, place.canvasId, record);
      if (!file || !(await fs.stat(file).catch(() => null))?.isFile()) throw new comfy.ComfyError(`带的${item.kind === 'video' ? '视频' : '音频'}找不到了：画布里存的那份被删掉了`);
      names.set(item.mediaId, await comfy.uploadFile(url, file));
    }
    return (params.media ?? []).map((item) => names.get(item.mediaId)!);
  }

  // 带的图传给 ComfyUI，用画布里存的那份；返回 LoadImage 要填的名字
  async function uploadImages(place: VideoPlace, params: VideoJobParams, url: string): Promise<VideoFiles> {
    const names = new Map<string, string>();
    for (const id of [...(params.refs ?? []), ...(params.firstFrame ? [params.firstFrame] : [])]) {
      if (names.has(id)) continue;
      const record = await readImage(place.work, place.canvasId, id).catch(() => null);
      const file = record && canvasImagePath(place.work, place.canvasId, record);
      if (!file || !(await fs.stat(file).catch(() => null))?.isFile()) {
        const n = (params.refs ?? []).indexOf(id) + 1;
        throw new comfy.ComfyError(`${n ? `第 ${n} 张参考图` : '首帧图'}找不到了：画布里存的那份被删掉了`);
      }
      names.set(id, await comfy.uploadFile(url, file));
    }
    return { refs: (params.refs ?? []).map((id) => names.get(id)!), ...(params.firstFrame && { firstFrame: names.get(params.firstFrame) }) };
  }

  // 等生成视频那台开好，对照它装了哪些节点，传图，发出去；发之前看一眼是不是已经叫停了
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
      const first = await readJob(place, jobId);
      const instance = (await readSettings(place.work)).comfy.videoAutodl.instanceUuid ?? '';
      // 重拍的：读回哪一版的存档，那台上还在不在
      const base = first.reshoot ? await readJob(place, first.reshoot.base).catch(() => null) : null;
      if (first.reshoot) {
        if (!base?.latents) throw new comfy.ComfyError('要重拍的那一版删掉了');
        await requireLatents(base.latents);
      }
      const graphOf = (job: VideoJob, files: VideoFiles) =>
        job.reshoot && base?.latents ? reshootGraph(job.params, job.seed, files, job.id, reshootPlan(job.params, job.reshoot.from, job.reshoot.to), base.latents) : videoGraph(job.params, job.seed, files, job.id);
      // 查缺不缺节点时 LoadImage 填什么都行，先拿图的 id 顶上。接力那套还要查最后把几段拼起来那条图里的节点
      await requireNodes(address, graphOf(first, { refs: first.params.refs ?? [], firstFrame: first.params.firstFrame }));
      if (first.chain) await requireNodes(address, selfliftMergeGraph([{ name: chainName(first.id, 0) }], first.id));
      const files = { ...(await uploadImages(place, first.params, address)), media: await uploadMedia(place, first.params, address) };
      const id = await (clientId ??= comfyClientId(configDir));
      await withLock(`video-job:${jobId}`, async () => {
        const job = await readJob(place, jobId);
        if (job.status !== 'queued' || job.promptId) return;
        const promptId = await comfy.queuePrompt(address, graphOf(job, files), id);
        await changeJob(place, jobId, (current) => ({ ...current, promptId }));
        // 接力那套：这个任务跑的是第几段（已经出完几段就是第几段，从 0 数）
        const chain = job.chain && { total: job.chain.total, clip: job.chain.clips.length };
        track({ ...place, jobId, promptId, seed: job.seed, params: job.params, chunks: chain ? chain.total : reshootChunks(job), url: address, stageAt: {}, passSteps: {}, instance, files, ...(chain && { chain }) });
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

  // 重拍的只算切出来的那几窗
  const reshootChunks = (job: VideoJob) => {
    if (!job.reshoot) return job.params.segments.length;
    const plan = reshootPlan(job.params, job.reshoot.from, job.reshoot.to);
    return plan.lastWindow - plan.firstWindow + 1;
  };

  // 重拍前看一眼存档还在不在那台上：换了实例、被删了的，只能整条重出
  async function requireLatents(latents: VideoLatents): Promise<void> {
    const conn = await sshConnect(await autodl.ssh());
    try {
      const ran = await sshRun(conn, `test -f ${quote(`${LATENT_DIR}/${latents.pass1}`)} && test -f ${quote(`${LATENT_DIR}/${latents.pass2}`)}`);
      if (ran.code !== 0) throw new comfy.ComfyError('那台上没有这条的存档了，只能整条重出');
    } finally {
      conn.end();
    }
  }

  // 删视频时一起删那台上的存档：开着就经 SSH 删，关着或者没删成的记下来，下次开机删
  async function dropLatents(work: string, all: VideoLatents[]): Promise<void> {
    if (!all.length) return;
    const files = new Map<string, string[]>();
    for (const latents of all) files.set(latents.instance, [...(files.get(latents.instance) ?? []), latents.pass1, latents.pass2]);
    const running = autodl.current();
    const here = running.state === 'running' ? running.instance?.uuid : undefined;
    const left: LatentTrash = [];
    for (const [instance, names] of files) {
      if (instance === here && (await removeLatentFiles(names))) continue;
      left.push({ instance, files: names });
    }
    if (left.length) await withLock('video-latents-trash', async () => writeJsonAtomic(latentTrashFile(work), [...((await readJson<LatentTrash>(latentTrashFile(work))) ?? []), ...left]));
  }

  async function removeLatentFiles(names: string[]): Promise<boolean> {
    try {
      const conn = await sshConnect(await autodl.ssh());
      try {
        return (await sshRun(conn, `rm -f ${names.map((name) => quote(`${LATENT_DIR}/${name}`)).join(' ')}`)).code === 0;
      } finally {
        conn.end();
      }
    } catch {
      return false;
    }
  }

  // 开机了：上次关着时没删成的、在这台上的存档删掉
  let flushing = false;
  async function flushLatentTrash(instance: string): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      const { workFolder: work } = await readConfig(configDir);
      if (!work) return;
      const trash = (await readJson<LatentTrash>(latentTrashFile(work))) ?? [];
      const mine = trash.filter((item) => item.instance === instance);
      if (!mine.length || !(await removeLatentFiles(mine.flatMap((item) => item.files)))) return;
      await withLock('video-latents-trash', async () => {
        const now = (await readJson<LatentTrash>(latentTrashFile(work))) ?? [];
        await writeJsonAtomic(latentTrashFile(work), now.filter((item) => !mine.some((done) => done.instance === item.instance && done.files.join() === item.files.join())));
      });
    } catch (err) {
      console.error('删生成视频那台上的存档失败', err);
    } finally {
      flushing = false;
    }
  }
  const stopFlushing = autodl.subscribe((state) => {
    if (state.state === 'running' && state.instance) void flushLatentTrash(state.instance.uuid);
  });

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
        // 编码完提示词之前是在加载文字编码器这些，算在编码提示词里；接力那套最后拼起来那一条没有编码，一上来就是存文件
        setStage(t, t.chain && t.chain.clip >= t.chain.total ? 'save' : 'encode');
      }
      const stage = type === 'executing' ? videoStage(String(data.node)) : null;
      if (stage) setStage(t, stage);
    } else if (type === 'progress') {
      onProgress(t, data);
    } else if (type === 'executed') {
      void takePreview(t, data);
    } else if (type === 'execution_success' || type === 'executing') {
      void finish(t);
    } else if (type === 'execution_error') {
      void end(t, { status: 'failed', error: comfy.describeExecutionError(data, '生成视频') });
    } else if (type === 'execution_interrupted') {
      void endStopped(t);
    }
  }

  // 正在跑的被叫停：已经拿到一采那份低清版就把它转正成这条的结果，见 docs/dev-plan.md 5.27。
  // 接力那套已经有出完的几段，就把这几段先拼起来留下
  async function endStopped(t: Tracked): Promise<void> {
    const job = await readJob(t, t.jobId).catch(() => null);
    const ending = stoppedChange(job);
    if (t.chain && job?.chain?.clips.length) return void (await salvage(t, ending));
    await end(t, ending);
  }

  // 到了哪一步；一采、二采从第 0 段算起，收到第一步时是第 1 段。
  // 接力那套一段一个任务，第几段是按已经发出去的任务数来的，不走步数往回跳那套
  function setStage(t: Tracked, stage: VideoStage): void {
    if (t.progress?.stage === stage) return;
    const since = Date.now();
    t.stageAt[stage] = since;
    t.progress = { stage, chunk: t.chain ? Math.min(t.chain.clip + 1, t.chain.total) : 0, chunks: t.chain?.total ?? t.chunks, step: 0, steps: 0, since };
    emit({ type: 'progress', jobId: t.jobId, ...t.progress });
  }

  // 一采、二采每段从第 1 步数到最后一步，步数变小了就是到了下一段。别的节点的进度不管。
  // 接力那套第几段是服务端自己记的（一段一个任务），这里只报步数
  function onProgress(t: Tracked, data: Record<string, unknown>): void {
    const stage = data.node === undefined || data.node === null ? t.progress?.stage : videoStage(String(data.node));
    if (stage !== 'pass1' && stage !== 'pass2') return;
    setStage(t, stage);
    const progress = t.progress!;
    const step = Number(data.value);
    if (!t.chain && (progress.chunk === 0 || step < progress.step)) progress.chunk = Math.min(progress.chunk + 1, progress.chunks);
    progress.step = step;
    progress.steps = Number(data.max);
    t.passSteps[stage] = progress.steps;
    emit({ type: 'progress', jobId: t.jobId, ...progress });
  }

  // 一采出完那份低清预览：这个节点一出完就取回来存进临时文件夹。二采还在跑，用户先看个大概；
  // 二采途中叫停，留下的就是这一份，见 docs/dev-plan.md 5.27
  async function takePreview(t: Tracked, data: Record<string, unknown>): Promise<void> {
    if (String(data.node) !== PREVIEW_NODE || t.previewing) return;
    const ref = (data.output as { images?: comfy.ImageRef[] } | undefined)?.images?.find((item) => /\.mp4$/i.test(item.filename));
    if (!ref) return;
    t.previewing = true;
    try {
      const file = await saveVideoTemp(t.work, t.seed, (target) => comfy.saveView(t.url, ref, target), new Date(), '-preview');
      await changeTracked(t, { preview: file });
    } catch (err) {
      // 取不到预览不算这条失败：二采照样在跑，最后成片还是照常取回来
      console.error('取一采的预览失败', err);
    }
  }

  // 出完了：接力那套接着发下一段（或者把几段拼起来），别的从 /history 找到 mp4 取回来
  async function finish(t: Tracked): Promise<void> {
    if (t.finishing) return;
    t.finishing = true;
    try {
      if (t.chain) return await advance(t);
      await end(t, await collect(t));
    } catch (err) {
      await end(t, { status: 'failed', error: (err as Error).message });
    }
  }

  // ComfyUI 先推「出完了」再写 /history，取不到就稍等再取
  async function waitHistory(t: Tracked): Promise<comfy.HistoryEntry | null> {
    let entry: comfy.HistoryEntry | null = null;
    for (let i = 0; i < HISTORY_TRIES && !entry; i += 1) {
      if (i) await sleep(HISTORY_WAIT_MS);
      entry = await comfy.history(t.url, t.promptId);
    }
    return entry;
  }

  // 这一条出的 mp4 在哪（两个存片的节点都记在 images 里）
  const mp4Of = (entry: comfy.HistoryEntry | null) =>
    Object.values(entry?.outputs ?? {})
      .flatMap((output) => output.images ?? [])
      .find((item) => /\.mp4$/i.test(item.filename));

  // 这一条失败了没有（/history 里记的出错）
  const errorOf = (entry: comfy.HistoryEntry | null) => {
    const failed = (entry?.status?.messages ?? []).find(([type]) => type === 'execution_error');
    return failed ? comfy.describeExecutionError(failed[1], '生成视频') : null;
  };

  // 一段（或者最后拼起来那一条）出完了。SelfLift 接续那套是分段接力的：
  // 这一段记下来、拷进那台的 input 目录，还有下一段就接着发；这一段是最后一段就把几段拼成一条，见 docs/dev-plan.md 5.32
  async function advance(t: Tracked): Promise<void> {
    const job = await readJob(t, t.jobId).catch(() => null);
    const at = t.chain!.clip;
    if (!job?.chain) return await end(t, { status: 'failed', error: '这条的分段接力记录丢了，只能整条重出' });
    const entry = await waitHistory(t);
    // 这一段是被叫停打断的（还没出完就不算了）：已经出完的几段拼起来留下，见 docs/dev-plan.md 5.32
    if ((entry?.status?.messages ?? []).some(([type]) => type === 'execution_interrupted')) return await endStopped(t);
    const error = errorOf(entry);
    if (error) return await end(t, { status: 'failed', error });
    const ref = mp4Of(entry);
    if (!ref) return await end(t, { status: 'failed', error: 'ComfyUI 说出完了，但没找到出的视频' });
    // 最后那一条是「把几段拼起来」，出完就是成片
    if (at >= job.chain.total) return await gotMerged(t, ref);
    // 程序重启前这一段可能已经记过了，别记两遍
    const known = job.chain.clips.length > at;
    const clip: VideoChainClip = known
      ? job.chain.clips[at]
      : {
          filename: ref.filename,
          subfolder: ref.subfolder ?? '',
          frames: selfliftClips(job.params).lengths[at] ?? 0,
          name: chainName(job.id, at),
        };
    if (!known) {
      await copyToInput(clip, clip.name);
      const chain: VideoChain = { ...job.chain, clips: [...job.chain.clips, clip] };
      await changeTracked(t, { chain });
    }
    // 第 1 段出完先取回来当预览：后面几段还在跑的时候就能看个大概，见 docs/dev-plan.md 5.27
    if (at === 0) void takeClipPreview(t, ref);
    const clips = known ? job.chain.clips : [...job.chain.clips, clip];
    if (clips.length < job.chain.total) return await send(t, selfliftClipGraph(job.params, job.seed, await filesOf(t, job), job.id, clips.length, clip.name), clips.length);
    // 最后一段也出完了：把各段拼成一条
    await send(t, selfliftMergeGraph(clips, job.id), job.chain.total);
  }

  // 拼起来那一条出完了：取回成片，这条就算完了。叫停时留下的（ending）也走这里：
  // 成片就是拼起来的这几段，状态照 ending 写，标记成 partial，见 docs/dev-plan.md 5.27、5.32
  async function gotMerged(t: Tracked, ref: comfy.ImageRef): Promise<void> {
    const file = await saveVideoTemp(t.work, t.seed, (target) => comfy.saveView(t.url, ref, target));
    const { size } = await fs.stat(path.join(t.work, file));
    await saveTiming(t, Date.now()).catch((err) => console.error('记生成视频的用时失败', err));
    const change: Partial<VideoJob> = { status: 'done', file, bytes: size, ...(t.startedAt && { ms: Date.now() - t.startedAt }) };
    if (t.ending) Object.assign(change, t.ending, { file, bytes: size, partial: true });
    await end(t, change);
    void dropChainInputs(t);
  }

  // 传上去的图和视频：接着发下一段时不用再传一遍；程序重启后接着跑的没记着，补传一次
  async function filesOf(t: Tracked, job: VideoJob): Promise<VideoFiles> {
    if (t.files) return t.files;
    t.files = { ...(await uploadImages(t, job.params, t.url)), media: await uploadMedia(t, job.params, t.url) };
    return t.files;
  }

  // 接着发下一个任务（下一段，或者最后拼起来那一条）：换 prompt_id、重新记进度、存进这条里
  async function send(t: Tracked, graph: ComfyGraph, clip: number): Promise<void> {
    const current = await readJob(t, t.jobId).catch(() => null);
    if (!current || !isLive(current)) return; // 期间被叫停了，别再发
    const id = await (clientId ??= comfyClientId(configDir));
    submitting.set(t.url, (submitting.get(t.url) ?? 0) + 1);
    try {
      const promptId = await comfy.queuePrompt(t.url, graph, id);
      await changeJob(t, t.jobId, (job) => ({ ...job, promptId, ...(job.chain && { chain: { ...job.chain, merging: clip >= job.chain.total } }) }));
      tracked.delete(t.promptId);
      t.promptId = promptId;
      t.finishing = false;
      t.startedAt = undefined;
      t.progress = undefined;
      t.position = undefined;
      t.stageAt = {};
      t.passSteps = {};
      if (t.chain) t.chain.clip = clip;
      track(t);
      void refreshQueue(t.url);
    } finally {
      submitting.set(t.url, submitting.get(t.url)! - 1);
      closeIfIdle(t.url);
    }
  }

  // 第 1 段出完先取回来当预览，见 docs/dev-plan.md 5.27
  async function takeClipPreview(t: Tracked, ref: comfy.ImageRef): Promise<void> {
    if (t.previewing || t.chain?.clip !== 0) return;
    t.previewing = true;
    try {
      const file = await saveVideoTemp(t.work, t.seed, (target) => comfy.saveView(t.url, ref, target), new Date(), '-preview');
      await changeTracked(t, { preview: file });
    } catch (err) {
      // 取不到预览不算这条失败
      console.error('取第 1 段的预览失败', err);
    }
  }

  // 把一段出的片子拷进那台的 input 目录：下一段的 LoadVideo 和最后拼接都读它，见 docs/dev-plan.md 5.32
  async function copyToInput(clip: Pick<VideoChainClip, 'filename' | 'subfolder'>, name: string): Promise<void> {
    const from = `${COMFY_OUTPUT}/${clip.subfolder ? `${clip.subfolder}/` : ''}${clip.filename}`;
    const conn = await sshConnect(await autodl.ssh());
    try {
      const ran = await sshRun(conn, `cp ${quote(from)} ${quote(`${COMFY_INPUT}/${name}`)}`);
      if (ran.code !== 0) throw new comfy.ComfyError(`把上一段拷进 ComfyUI 的 input 目录没成功${ran.err ? `：${ran.err.trim()}` : ''}`);
    } finally {
      conn.end();
    }
  }

  // 成片出来了，拷进 input 的那几份就没用了，顺手删掉（删不掉就算了）
  async function dropChainInputs(t: Tracked): Promise<void> {
    const names = (await readJob(t, t.jobId).catch(() => null))?.chain?.clips.map((clip) => clip.name) ?? [];
    if (!names.length) return;
    await removeFiles(names.map((name) => `${COMFY_INPUT}/${name}`));
  }

  // 那台上的文件删掉：开关着才删得掉，删不掉就下次删（跟存档一样）
  async function removeFiles(paths: string[]): Promise<boolean> {
    if (!paths.length) return true;
    try {
      const conn = await sshConnect(await autodl.ssh());
      try {
        return (await sshRun(conn, `rm -f ${paths.map((one) => quote(one)).join(' ')}`)).code === 0;
      } finally {
        conn.end();
      }
    } catch {
      return false;
    }
  }

  // 已经出完几段了，叫停时别白等：把这几段拼起来当这条的结果（partial），见 docs/dev-plan.md 5.27、5.32。
  // 拼起来要发一个新任务，可能从两条路进来（正在跑的被中断、界面点了叫停），这里一进来就把 ending 记上，只拼一次
  async function salvage(t: Tracked, ending: Partial<VideoJob>): Promise<void> {
    if (t.ending) return;
    t.ending = ending;
    const job = await readJob(t, t.jobId).catch(() => null);
    const clips = job?.chain?.clips ?? [];
    if (!job?.chain || !clips.length) {
      t.ending = undefined;
      return await end(t, ending);
    }
    t.finishing = true;
    try {
      await send(t, selfliftMergeGraph(clips, job.id), job.chain.total);
    } catch (err) {
      console.error('把已经出的几段拼起来失败', err);
      await end(t, ending);
    }
  }

  async function collect(t: Tracked): Promise<Partial<VideoJob>> {
    const entry = await waitHistory(t);
    const error = errorOf(entry);
    if (error) return { status: 'failed', error };
    if ((entry?.status?.messages ?? []).some(([type]) => type === 'execution_interrupted')) return stoppedChange(await readJob(t, t.jobId).catch(() => null));
    // MMH3StreamingSave 把 mp4 记在 images 里
    const ref = mp4Of(entry);
    if (!ref) return { status: 'failed', error: 'ComfyUI 说出完了，但没找到出的视频' };
    const file = await saveVideoTemp(t.work, t.seed, (target) => comfy.saveView(t.url, ref, target));
    const { size } = await fs.stat(path.join(t.work, file));
    await saveTiming(t, Date.now()).catch((err) => console.error('记生成视频的用时失败', err));
    // 一采、二采存下的文件名，重拍一截时读回来
    const saved = (id: string) => entry?.outputs?.[id]?.text?.[0];
    const [pass1, pass2] = [saved(LATENT_SAVE.pass1Path), saved(LATENT_SAVE.pass2Path)];
    return { status: 'done', file, bytes: size, ...(t.startedAt && { ms: Date.now() - t.startedAt }), ...(pass1 && pass2 && { latents: { pass1, pass2, instance: t.instance } }) };
  }

  // 出完记下各步用了多久，见 docs/dev-plan.md 5.29；有哪一步没看到（比如中间重启过）就不记。
  // SelfLift 接续那套没有放大这一步，而且一段一个任务：编码、采样、存片每个阶段都要走几遍，按段数乘上去；
  // 记的段数是分几段接力（估「还要多久」时只跟同样段数的比）
  async function saveTiming(t: Tracked, doneAt: number): Promise<void> {
    const { encode, pass1, upscale, pass2, save } = t.stageAt;
    if (!(encode && pass1 && save)) return;
    const selflift = workflowOf(t.params) === 'selflift';
    // 接力那套一段一个任务：编码、采样、存片每个阶段都要走「几段」遍，按这个乘；两遍生成是一条任务里跑完的，只乘一遍
    const repeat = t.chain?.total ?? 1;
    const steps = (pass: 'pass1' | 'pass2') => Math.max(1, (t.passSteps[pass] ?? stepsOf(t.params)[pass]) * (t.chain?.total ?? t.chunks));
    const shared = {
      at: new Date(doneAt).toISOString(),
      finalWidth: t.params.finalWidth,
      finalHeight: t.params.finalHeight,
      segments: t.chain?.total ?? t.chunks,
      encodeMs: (pass1 - encode) * repeat,
      saveMs: Math.max(0, doneAt - save) * repeat,
      workflow: workflowOf(t.params),
    };
    const timing: VideoTiming =
      selflift || !upscale || !pass2
        ? { ...shared, pass1StepMs: Math.round(((save - pass1) * repeat) / steps('pass1')), upscaleMs: 0, pass2StepMs: 0 }
        : { ...shared, pass1StepMs: Math.round((upscale - pass1) / steps('pass1')), upscaleMs: pass2 - upscale, pass2StepMs: Math.round((save - pass2) / steps('pass2')) };
    await withLock('video-timings', async () => writeJsonAtomic(timingsFile(t.work), addTiming((await readJson<VideoTiming[]>(timingsFile(t.work))) ?? [], timing)));
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

  // 叫停：还没发出去的和还在排队的直接算叫停；正在跑的让 ComfyUI 停，等它说停了；刚跑完的等它取回来。
  // 接力那套已经有出完的几段，就把那几段先拼起来留下（拼的那条出完才算叫停完），见 docs/dev-plan.md 5.32
  function stop(place: VideoPlace, jobId: string): Promise<VideoJob> {
    return withLock(`video-job:${jobId}`, async () => {
      const job = await readJob(place, jobId);
      if (!isLive(job)) return job;
      const t = job.promptId ? tracked.get(job.promptId) : undefined;
      const ending = stoppedChange(job);
      if (t) {
        if (t.chain && job.chain?.clips.length) {
          // 先把正在跑的那一段停掉（还在排队就撤下来），再把已经出的几段拼起来：拼的那条排在后头
          const state = await comfy.queueState(t.url).catch(() => null);
          if (state?.running.includes(t.promptId)) await comfy.interrupt(t.url, t.promptId).catch(() => {});
          else if (state?.pending.includes(t.promptId)) await comfy.deleteQueued(t.url, [t.promptId]).catch(() => {});
          await salvage(t, ending);
          return job;
        }
        // ComfyUI 连不上时直接算叫停
        const state = await comfy.queueState(t.url).catch(() => null);
        if (state && !state.pending.includes(t.promptId)) {
          if (state.running.includes(t.promptId)) await comfy.interrupt(t.url, t.promptId).catch(() => {});
          return job;
        }
        if (state) await comfy.deleteQueued(t.url, [t.promptId]).catch(() => {});
        untrack(t);
      }
      // 叫停时已经拿到一采那份低清版就留下它：整条的、能播能下载，不叫人白等一场，见 docs/dev-plan.md 5.27
      return changeJob(place, jobId, (current) => (isLive(current) ? { ...current, ...ending } : current));
    });
  }

  // 删一条：临时文件直接删，不进 .trash；下载过的那份不动。删原片时它重拍出的各个版本一起删；那台上的存档也删，见 docs/dev-plan.md 5.30。
  // 接力那套留在那台上的几段片子、拷进 input 的那几份也一起删，见 5.32
  function remove(place: VideoPlace, jobId: string): Promise<void> {
    return withLock(`video-job:${jobId}`, async () => {
      const job = await readJob(place, jobId);
      if (isLive(job)) throw new HttpError(409, '这条还没出完，先叫停');
      const all = (await readNode(place.work, place.canvasId, place.nodeId)).messages[place.messageId]?.videos ?? [];
      const doomed = [job, ...(job.parent ? [] : all.filter((j) => j.parent === job.id))];
      if (doomed.some(isLive)) throw new HttpError(409, '这条还有没出完的重拍，先叫停');
      const gone = new Set(doomed.map((j) => j.id));
      for (const one of doomed) if (one.file) await fs.rm(path.join(place.work, one.file), { force: true });
      // 一采那份预览是另存的一份，没转正成 file 的也要删
      for (const one of doomed) if (one.preview && one.preview !== one.file) await fs.rm(path.join(place.work, one.preview), { force: true });
      await updateNode(place.work, place.canvasId, place.nodeId, (node) => {
        const message = node.messages[place.messageId];
        if (!message) throw new HttpError(404, '找不到这条回复');
        return { ...node, messages: { ...node.messages, [message.id]: { ...message, videos: (message.videos ?? []).filter((j) => !gone.has(j.id)) } } };
      });
      for (const one of doomed) emit({ type: 'removed', ...ids(place), jobId: one.id });
      void dropLatents(place.work, doomed.flatMap((one) => (one.latents ? [one.latents] : []))).catch((err) => console.error('删生成视频的存档失败', err));
      void dropChainFiles(doomed).catch((err) => console.error('删接力留下的那几段失败', err));
    });
  }

  // 删一条时把接力留在那台上的东西也删掉：拷进 input 的那几份、一段一段出的那几个片子。那台关着就删不掉了，留在那台上
  async function dropChainFiles(jobs: VideoJob[]): Promise<void> {
    const paths: string[] = [];
    for (const job of jobs) {
      for (const clip of job.chain?.clips ?? []) {
        paths.push(`${COMFY_INPUT}/${clip.name}`, `${COMFY_OUTPUT}/${clip.subfolder ? `${clip.subfolder}/` : ''}${clip.filename}`);
      }
    }
    if (paths.length) await removeFiles(paths);
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
    liveJobs.set(job.id, ids(place));
    const lost = '程序重启时这条还没出完';
    if (!url || !job.promptId) {
      await changeJob(place, job.id, (current) => (isLive(current) ? { ...current, status: 'failed', error: lost } : current)).catch(() => {});
      return;
    }
    const instance = (await readSettings(place.work)).comfy.videoAutodl.instanceUuid ?? '';
    // 接力那套：现在跑的是第几段（正在拼最后那一条时算最后那一段）
    const chain = job.chain && { total: job.chain.total, clip: job.chain.merging ? job.chain.total : job.chain.clips.length };
    const t: Tracked = { ...place, jobId: job.id, promptId: job.promptId, seed: job.seed, params: job.params, chunks: chain ? chain.total : reshootChunks(job), url, stageAt: {}, passSteps: {}, instance, ...(chain && { chain }) };
    try {
      await connect(url);
      track(t);
      await check(t, lost);
    } catch (err) {
      await end(t, { status: 'failed', error: `程序重启后查不到这条出没出完：${(err as Error).message}` });
    }
  }

  // 视频任务小窗：在做的和排着的按点生成的先后，这次开程序以后完了的新的在前，带上画布名和节点标题；画布、节点、这条已经删了的不列
  async function board(): Promise<VideoBoard> {
    const { workFolder: work } = await readConfig(configDir);
    if (!work) return { live: [], done: [], timings: [] };
    const titles = new Map((await readAllCanvases(work).catch(() => [])).map((canvas) => [canvas.id, canvas.title]));
    const task = async (where: Ids, jobId: string): Promise<VideoTask | null> => {
      const canvasTitle = titles.get(where.canvasId);
      const node = canvasTitle === undefined ? null : await readNode(work, where.canvasId, where.nodeId).catch(() => null);
      const job = node?.messages[where.messageId]?.videos?.find((j) => j.id === jobId);
      return node && job ? { ...where, canvasTitle: canvasTitle!, nodeTitle: node.title, job } : null;
    };
    const present = (tasks: (VideoTask | null)[]) => tasks.filter((item): item is VideoTask => item !== null);
    const live = present(await Promise.all([...liveJobs].map(([jobId, where]) => task(where, jobId))))
      .filter((item) => isLive(item.job))
      .sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt));
    const done = present(await Promise.all(finished.map((item) => task(item, item.jobId))));
    return { live, done, timings: (await readJson<VideoTiming[]>(timingsFile(work))) ?? [] };
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
    stopFlushing();
    timers.forEach(clearTimeout);
    for (const socket of sockets.values()) socket.ws?.close();
    sockets.clear();
    tracked.clear();
    listeners.clear();
  }

  return { create, stop, remove, setSaved, board, subscribe, resume, close };
}
