import {
  BUILTIN_WORKFLOW,
  builtinGraph,
  checkpointFamily,
  composeChecked,
  CONTROL_LABELS,
  familyWords,
  imageSettingsOf,
  importedGraph,
  isLiveImage as isLive,
  jobSeeds,
  missingNodeTypes,
  negativePrompt,
  parsePromptMeta,
  PLUGIN_OF,
  positivePrompt,
  splitTags,
  type ChatNode,
  type ComfyGraph,
  type ComfyTarget,
  type ControlSettings,
  type DetailPass,
  type Family,
  type FamilyDefaults,
  type ImageJob,
  type ImageJobEvent,
  type ImageJobParams,
  type ImageRating,
  type JobImage,
  type RefImage,
  type SharedSettings,
  type UpscaleSettings,
} from '@media-agent/shared';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { comfyClientId, readComfyConfig, readConfig } from '../config';
import { HttpError } from '../httpError';
import { listNodes, readAllCanvases, readNode, updateNode } from '../store/canvases';
import { withLock } from '../store/locks';
import { canvasImagePath, readImage } from '../store/images';
import { readPrompt } from '../store/prompts';
import { readSettings } from '../store/settings';
import { readWorkflow } from '../store/workflows';
import { loadLibrary } from '../tags/library';
import { checkTag } from '../tags/search';
import { BootCancelled, type Autodl } from './autodl';
import * as comfy from './client';
import { imageFile, saveTemp } from './files';
import { comfyCheckpoints, loadObjectInfo } from './options';

// 一组图挂在哪条回复下
export type JobPlace = { work: string; canvasId: string; nodeId: string; messageId: string };

// 发出去还没出完的一张，按 prompt_id 认；index 是它在这一组里排第几，推进度时用
type Tracked = JobPlace & {
  jobId: string;
  promptId: string;
  seed: number;
  index: number;
  url: string;
  target: ComfyTarget;
  startedAt?: number;
  finishing?: boolean;
  position?: number;
  progress?: { step: number; total: number };
};

type ComfyMessage = { type: string; data?: Record<string, unknown> };

const RECONNECT_MS = 3000;
const EARLY_KEEP_MS = 60_000;
const HISTORY_TRIES = 10;
const HISTORY_WAIT_MS = 300;

const randomSeed = () => randomInt(0, 2 ** 32);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 节点用的系统提示词开头写着「用途: 生图」才是生图节点，系列看「底模」
export async function imageFamily(work: string, promptName: string): Promise<Family> {
  const meta = parsePromptMeta(await readPrompt(work, promptName));
  if (meta.use !== 'image') throw new HttpError(400, '这个节点用的不是生图提示词');
  if (!meta.family) throw new HttpError(400, `系统提示词「${promptName}」开头没写底模是 IL 还是 Pony`);
  return meta.family;
}

// 节点选的导入的工作流；已经删了的当没选，用内置流程
const chosenWorkflow = (work: string, id: string | null) =>
  id
    ? readWorkflow(work, id).catch((err) => {
        if (err instanceof HttpError && err.status === 404) return null;
        throw err;
      })
    : null;

// 框里的标签拼成发出去的那串：别名换成标准名、括号转义，见 docs/dev-plan.md 5.15
async function tagComposer(work: string, defaults: FamilyDefaults): Promise<(text: string) => string> {
  const library = await loadLibrary(work);
  const known = familyWords(defaults);
  return (text) => {
    const items = splitTags(text);
    return composeChecked(items, items.map((item) => checkTag(library, item.name, known)));
  };
}

// 放大和部位重绘开着的才记，见 docs/dev-plan.md 5.21。部位重绘这道写了正面就换掉框里的标签、写了负面就换掉额外的负面词，
// 系列固定开头、评级词、默认负面词照加；没写的空着，出图时用原图的
function stagesFor(
  upscale: UpscaleSettings,
  details: DetailPass[],
  defaults: FamilyDefaults,
  rating: ImageRating,
  compose: (text: string) => string,
): Pick<ImageJobParams, 'upscale' | 'details'> {
  if (upscale.on && !upscale.model) throw new HttpError(400, '放大还没选放大模型，在出图设置里选一个');
  details.forEach((pass, i) => {
    if (pass.on && !pass.detector) throw new HttpError(400, `部位重绘第 ${i + 1} 道还没选检测模型`);
  });
  const passes = details
    .filter((pass) => pass.on)
    .map((pass) => ({
      ...pass,
      positive: pass.positive.trim() ? positivePrompt(defaults, rating, compose(pass.positive)) : '',
      negative: pass.negative.trim() ? negativePrompt(defaults, pass.negative) : '',
    }));
  return { ...(upscale.on && { upscale }), ...(passes.length > 0 && { details: passes }) };
}

// 开着的 ControlNet 才记，见 docs/dev-plan.md 5.21；参考图、模型没选的不让出。第几个按出图设置里的列表数
function controlsFor(controls: ControlSettings[]): Pick<ImageJobParams, 'controls'> {
  controls.forEach((control, i) => {
    if (control.on && !control.image) throw new HttpError(400, `ControlNet 第 ${i + 1} 个还没选参考图`);
    if (control.on && !control.model) throw new HttpError(400, `ControlNet 第 ${i + 1} 个还没选模型`);
  });
  const on = controls.filter((control) => control.on);
  return on.length ? { controls: on } : {};
}

// E02 的几样里 VAE、权重算法、LoRA 作用在哪，不是默认的才记，见 docs/dev-plan.md 5.21
const e02Params = ({ vae, weighting, loraTarget }: Pick<ImageJobParams, 'vae' | 'weighting' | 'loraTarget'>): Pick<ImageJobParams, 'vae' | 'weighting' | 'loraTarget'> => ({
  ...(vae && { vae }),
  ...(weighting === 'a1111' && { weighting }),
  ...(loraTarget === 'model' && { loraTarget }),
});

// 按节点现在的出图设置和这个框拼参数，见 docs/dev-plan.md 5.18。用导入的工作流时底模、LoRA、步数这些照工作流里的，不记
async function paramsFor(work: string, node: ChatNode, text: string, settings: SharedSettings): Promise<{ params: ImageJobParams; seeds: number[] }> {
  const family = await imageFamily(work, node.systemPromptName);
  const defaults = settings.defaults[family];
  const image = imageSettingsOf(node.image, defaults);
  const compose = await tagComposer(work, defaults);
  const workflow = await chosenWorkflow(work, image.workflowId);
  const prompts = { family, positive: positivePrompt(defaults, image.rating, compose(text)), negative: negativePrompt(defaults, image.negativeExtra) };
  return {
    params: workflow
      ? { ...prompts, workflow: { id: workflow.id, name: workflow.name, hash: workflow.hash }, width: image.width, height: image.height }
      : {
          ...prompts,
          workflow: BUILTIN_WORKFLOW,
          width: image.width,
          height: image.height,
          checkpoint: image.checkpoint,
          loras: image.loras,
          steps: image.steps,
          cfg: image.cfg,
          sampler: image.sampler,
          scheduler: image.scheduler,
          clipSkip: defaults.clipSkip,
          ...e02Params(image),
          ...controlsFor(image.controls),
          ...stagesFor(image.upscale, image.details, defaults, image.rating, compose),
        },
    seeds: jobSeeds(image.seed ?? randomSeed(), image.count),
  };
}

// 出完的图上补做放大和部位重绘，见 docs/dev-plan.md 5.21：提示词、底模、VAE、LoRA、种子这些用原图那一组记的，
// 原图是导入的工作流出的，底模这些用节点现在的出图设置；尺寸是原图的
async function refineParams(work: string, node: ChatNode, from: ImageJobParams, image: JobImage, refine: Refine, settings: SharedSettings): Promise<ImageJobParams> {
  if (!refine.upscale.on && !refine.details.some((pass) => pass.on)) throw new HttpError(400, '放大和部位重绘至少开一样');
  const defaults = settings.defaults[from.family];
  const current = imageSettingsOf(node.image, defaults);
  const model = from.workflow.id
    ? { checkpoint: current.checkpoint, loras: current.loras, steps: current.steps, cfg: current.cfg, sampler: current.sampler, scheduler: current.scheduler, clipSkip: defaults.clipSkip, ...e02Params(current) }
    : { checkpoint: from.checkpoint, loras: from.loras, steps: from.steps, cfg: from.cfg, sampler: from.sampler, scheduler: from.scheduler, clipSkip: from.clipSkip, ...e02Params(from) };
  return {
    family: from.family,
    positive: from.positive,
    negative: from.negative,
    workflow: BUILTIN_WORKFLOW,
    width: image.width ?? from.width,
    height: image.height ?? from.height,
    ...model,
    ...stagesFor(refine.upscale, refine.details, defaults, current.rating, await tagComposer(work, defaults)),
  };
}

export type Again = { jobId: string; index: number; sameSeed: boolean };
export type Refine = { jobId: string; index: number; upscale: UpscaleSettings; details: DetailPass[] };

export type ImageJobs = ReturnType<typeof createImageJobs>;

// 出图任务，见 docs/dev-plan.md 5.19：点生图时建一组、存盘，再逐张发给 ComfyUI；
// 每台 ComfyUI 开一个 WebSocket 收进度，出完一张取回来存进临时文件夹。状态变了推给 /image-jobs/events。
// 用 AutoDL 的先等实例开好，AutoDL 的状态也从这里推；有图在 AutoDL 上出时告诉它，空闲自动关机从出完算起
export function createImageJobs(configDir: string, autodl: Autodl) {
  const tracked = new Map<string, Tracked>();
  // 发任务的回复还没回来、进度先到了的，先存着，记上 prompt_id 后再处理
  const early = new Map<string, { at: number; messages: ComfyMessage[] }>();
  const sockets = new Map<string, { ws?: WebSocket; ready: Promise<void> }>();
  const submitting = new Map<string, number>();
  const queueChecks = new Map<string, boolean>();
  const timers = new Set<NodeJS.Timeout>();
  const listeners = new Set<(event: ImageJobEvent) => void>();
  let clientId: Promise<string> | undefined;
  let closed = false;
  // 正在等 AutoDL 开机或者正在往它上面发的组数
  let autodlWork = 0;

  const emit = (event: ImageJobEvent) => listeners.forEach((listener) => listener(event));
  const syncBusy = () => autodl.setBusy('images', autodlWork > 0 || [...tracked.values()].some((t) => t.target === 'autodl'));
  const stopWatchingAutodl = autodl.subscribe((state) => emit({ type: 'autodl', ...state }));
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };
  const inUse = (url: string) => (submitting.get(url) ?? 0) > 0 || [...tracked.values()].some((t) => t.url === url);

  async function readJob(place: JobPlace, jobId: string): Promise<ImageJob> {
    const node = await readNode(place.work, place.canvasId, place.nodeId);
    const job = node.messages[place.messageId]?.images?.find((j) => j.id === jobId);
    if (!job) throw new HttpError(404, '找不到这一组图');
    return job;
  }

  // 改这一组、存盘、推给前端；一张都不剩了整组去掉
  async function changeJob(place: JobPlace, jobId: string, change: (job: ImageJob) => ImageJob): Promise<ImageJob> {
    let changed!: ImageJob;
    await updateNode(place.work, place.canvasId, place.nodeId, (node) => {
      const message = node.messages[place.messageId];
      const job = message?.images?.find((j) => j.id === jobId);
      if (!message || !job) throw new HttpError(404, '找不到这一组图');
      changed = { ...change(job), rev: (job.rev ?? 0) + 1 };
      const images = message.images!.flatMap((j) => (j.id !== jobId ? [j] : changed.images.length ? [changed] : []));
      return { ...node, messages: { ...node.messages, [message.id]: { ...message, images } } };
    });
    emit({ type: 'job', canvasId: place.canvasId, nodeId: place.nodeId, messageId: place.messageId, job: changed });
    return changed;
  }

  const changeImages = (place: JobPlace, jobId: string, pick: (image: JobImage, index: number) => boolean, change: Partial<JobImage>) =>
    changeJob(place, jobId, (job) => ({ ...job, images: job.images.map((image, index) => (pick(image, index) ? { ...image, ...change } : image)) }));

  // ComfyUI 那边来的变化；节点或回复已经删了就算了
  const changeTracked = (t: Tracked, change: Partial<JobImage>, only: (image: JobImage) => boolean = () => true) =>
    changeImages(t, t.jobId, (image) => image.promptId === t.promptId && only(image), change).then(
      () => undefined,
      (err) => {
        if (!(err instanceof HttpError && err.status === 404)) console.error('更新出图状态失败', err);
      },
    );

  // 点「生图」出这个框；again 是「同样参数再来」「只换种子再来」，refine 是出完的图上补做放大和部位重绘
  async function create(place: JobPlace, promptIndex: number, { again, refine }: { again?: Again; refine?: Refine } = {}): Promise<ImageJob> {
    const settings = await readSettings(place.work);
    const { comfyTarget: target, autodlToken } = await readComfyConfig(configDir);
    const lanUrl = settings.comfy.lanUrl;
    if (target === 'lan' && !lanUrl) throw new HttpError(400, '先在设置里填局域网 ComfyUI 的地址');
    if (target === 'autodl' && !(autodlToken && settings.comfy.autodl.instanceUuid)) throw new HttpError(400, '先在设置里填 AutoDL 的开发者 Token、选好实例');
    const node = await readNode(place.work, place.canvasId, place.nodeId);
    const message = node.messages[place.messageId];
    if (message?.role !== 'assistant') throw new HttpError(404, '找不到这条回复');

    let source: { promptIndex: number; kind: ImageJob['kind']; params: ImageJobParams; seeds: number[]; from?: ImageJob['source'] };
    if (again) {
      // 「同样参数再来」用同一个种子，「只换种子再来」随机一个，都只出一张；记下照着哪张出的。
      // 补做出的图再来，是把原来那张原图再补做一次
      const job = message.images?.find((j) => j.id === again.jobId);
      const image = job?.images[again.index];
      if (!job || !image) throw new HttpError(404, '找不到要照着再来的那张图');
      source = {
        promptIndex: job.promptIndex,
        kind: job.kind,
        params: job.params,
        seeds: [again.sameSeed ? image.seed : randomSeed()],
        from: job.kind === 'refine' ? job.source : { kind: 'generated', jobId: job.id, seed: image.seed },
      };
    } else if (refine) {
      const job = message.images?.find((j) => j.id === refine.jobId);
      const image = job?.images[refine.index];
      if (!job || image?.status !== 'done') throw new HttpError(404, '找不到要补做的那张图');
      if (!(await imageFile(place.work, image))) throw new HttpError(409, '这张图的临时文件清掉了，也没下载过，没法补做');
      source = {
        promptIndex: job.promptIndex,
        kind: 'refine',
        params: await refineParams(place.work, node, job.params, image, refine, settings),
        seeds: [image.seed],
        from: { kind: 'generated', jobId: job.id, seed: image.seed },
      };
    } else {
      const box = message.parsed?.prompts[promptIndex];
      if (!box) throw new HttpError(404, `这条回复里没有第 ${promptIndex + 1} 个提示词框`);
      source = { promptIndex, kind: 'txt2img', ...(await paramsFor(place.work, node, box.text, settings)) };
    }

    const job: ImageJob = {
      id: randomUUID(),
      promptIndex: source.promptIndex,
      createdAt: new Date().toISOString(),
      kind: source.kind,
      ...(source.from && { source: source.from }),
      target,
      params: source.params,
      images: source.seeds.map((seed) => ({ seed, status: 'queued' })),
    };
    await updateNode(place.work, place.canvasId, place.nodeId, (current) => {
      const target = current.messages[place.messageId];
      if (!target) throw new HttpError(404, '找不到这条回复');
      return { ...current, messages: { ...current.messages, [target.id]: { ...target, images: [...(target.images ?? []), job] } } };
    });
    emit({ type: 'job', canvasId: place.canvasId, nodeId: place.nodeId, messageId: place.messageId, job });
    void submit(place, job.id, target === 'lan' ? lanUrl : null);
    return job;
  }

  // 逐张发给 ComfyUI；每张发之前看一眼是不是已经叫停了。lanUrl 是 null 的发给 AutoDL，先等它开好
  async function submit(place: JobPlace, jobId: string, lanUrl: string | null): Promise<void> {
    const target: ComfyTarget = lanUrl ? 'lan' : 'autodl';
    if (target === 'autodl') {
      autodlWork += 1;
      syncBusy();
    }
    let url: string | null = null;
    try {
      const address =
        lanUrl ??
        (await autodl.ensureReady().catch((err) => {
          throw err instanceof BootCancelled ? err : new comfy.ComfyError(`AutoDL 开机失败：${(err as Error).message}`);
        }));
      url = address;
      submitting.set(address, (submitting.get(address) ?? 0) + 1);
      await connect(address);
      await chooseCheckpoint(place, jobId, address);
      const graphFor = await graphMaker(place, jobId, address);
      const id = await (clientId ??= comfyClientId(configDir));
      for (let more = true; more; ) {
        more = await withLock(`image-job:${jobId}`, async () => {
          const job = await readJob(place, jobId);
          const index = job.images.findIndex((image) => image.status === 'queued' && !image.promptId);
          if (index < 0) return false;
          const { seed } = job.images[index];
          const pick = (image: JobImage) => image.seed === seed && !image.promptId;
          try {
            const promptId = await comfy.queuePrompt(address, graphFor(job.params, seed), id);
            await changeImages(place, jobId, pick, { promptId });
            track({ ...place, jobId, promptId, seed, index, url: address, target });
          } catch (err) {
            await changeImages(place, jobId, pick, { status: 'failed', error: (err as Error).message });
          }
          return true;
        }).catch(() => false);
      }
      void refreshQueue(address);
    } catch (err) {
      // 连不上、AutoDL 没开成、这台 ComfyUI 上没有这个系列的底模、缺插件：没发出去的都算失败；点了「别开了」的算叫停
      const change: Partial<JobImage> = err instanceof BootCancelled ? { status: 'stopped' } : { status: 'failed', error: (err as Error).message };
      await changeImages(place, jobId, (image) => image.status === 'queued' && !image.promptId, change).catch(() => {});
    } finally {
      if (url) {
        submitting.set(url, submitting.get(url)! - 1);
        closeIfIdle(url);
      }
      if (target === 'autodl') {
        autodlWork -= 1;
        syncBusy();
      }
    }
  }

  // 节点还没选过底模：用这台 ComfyUI 上这个系列的第一个，记进这一组的参数。导入的工作流用它自己的底模
  async function chooseCheckpoint(place: JobPlace, jobId: string, url: string): Promise<void> {
    const { params } = await readJob(place, jobId);
    if (params.checkpoint || params.workflow.id) return;
    const marked = (await readSettings(place.work)).checkpoints;
    const info = await loadObjectInfo(url);
    const names = comfyCheckpoints(info);
    const name = names.find((n) => checkpointFamily(n, marked).family === params.family);
    if (!name) throw new comfy.ComfyError(`这台 ComfyUI 上没有 ${params.family} 系列的底模。去设置「底模和默认值」里看看底模各标成了哪个系列`);
    await changeJob(place, jobId, (job) => ({ ...job, params: { ...job.params, checkpoint: name } }));
  }

  // 怎么拼发出去的流程，见 docs/dev-plan.md 5.18、5.21：先对照这台 ComfyUI 装了哪些节点，缺的说清楚，一张都不发。
  // 出完的图上补做的，先把原图传上去；用了 ControlNet 的，先把参考图传上去
  async function graphMaker(place: JobPlace, jobId: string, url: string): Promise<(params: ImageJobParams, seed: number) => ComfyGraph> {
    const job = await readJob(place, jobId);
    const { params } = job;
    if (!params.workflow.id) {
      const refine = job.kind === 'refine';
      await requireNodes(url, builtinGraph(params, 0, refine ? { image: '' } : {}));
      const uploaded = refine ? { image: await uploadSource(place, job, url) } : { controls: await uploadControls(place, params.controls ?? [], url) };
      return (jobParams, seed) => builtinGraph(jobParams, seed, uploaded);
    }
    const workflow = await chosenWorkflow(place.work, params.workflow.id);
    if (!workflow) throw new comfy.ComfyError(`工作流「${params.workflow.name}」已经删了，在出图设置里换一个再出`);
    await requireNodes(url, workflow.graph);
    return (jobParams, seed) => importedGraph(workflow, jobParams, seed);
  }

  // 节点列表是缓存的，刚装了插件还没重读的话，重读一次再算
  async function requireNodes(url: string, graph: ComfyGraph): Promise<void> {
    let missing = missingNodeTypes(graph, Object.keys(await loadObjectInfo(url)));
    if (missing.length) missing = missingNodeTypes(graph, Object.keys(await loadObjectInfo(url, true)));
    if (!missing.length) return;
    const plugins = [...new Set(missing.flatMap((type) => (PLUGIN_OF[type] ? [PLUGIN_OF[type]] : [])))];
    throw new comfy.ComfyError(`这台 ComfyUI 缺插件：object_info 里没有 ${missing.join(', ')}${plugins.length ? `，要装 ${plugins.join('、')}` : ''}`);
  }

  // 补做的原图传给 ComfyUI；文件名按内容算，同一张传几次都是同一个名字
  async function uploadSource(place: JobPlace, job: ImageJob, url: string): Promise<string> {
    const node = await readNode(place.work, place.canvasId, place.nodeId);
    const from = node.messages[place.messageId]?.images
      ?.find((j) => j.id === job.source?.jobId)
      ?.images.find((image) => image.seed === job.source?.seed && image.status === 'done');
    const file = from && (await imageFile(place.work, from));
    if (!file) throw new comfy.ComfyError('要补做的那张原图找不到了：删掉了，或者临时文件清掉了又没下载过');
    return comfy.uploadFile(url, file);
  }

  // ControlNet 的参考图传给 ComfyUI：槽位里的用画布里存的那份，出过的图用临时文件或下载的那份
  async function uploadControls(place: JobPlace, controls: ControlSettings[], url: string): Promise<string[]> {
    if (!controls.length) return [];
    const node = await readNode(place.work, place.canvasId, place.nodeId);
    const names: string[] = [];
    for (const control of controls) {
      const file = control.image && (await refFile(place, node, control.image));
      if (!file) throw new comfy.ComfyError(`ControlNet「${CONTROL_LABELS[control.type]}」的参考图找不到了：删掉了，或者临时文件清掉了又没下载过`);
      names.push(await comfy.uploadFile(url, file));
    }
    return names;
  }

  async function refFile(place: JobPlace, node: ChatNode, ref: RefImage): Promise<string | null> {
    if (ref.kind === 'generated') {
      const image = node.messages[ref.messageId]?.images?.find((job) => job.id === ref.jobId)?.images.find((item) => item.seed === ref.seed && item.status === 'done');
      return image ? imageFile(place.work, image) : null;
    }
    const record = await readImage(place.work, place.canvasId, ref.imageId).catch(() => null);
    const file = record && canvasImagePath(place.work, place.canvasId, record);
    return file && (await fs.stat(file).catch(() => null))?.isFile() ? file : null;
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
      await check(t, 'ComfyUI 那边找不到这张了，可能重启过').catch(() => {});
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

  // ComfyUI 推来的事件：开始跑、第几步、出完了（新版本发 execution_success，都会发 node 为 null 的 executing）、出错、被叫停
  function handle(t: Tracked, { type, data = {} }: ComfyMessage): void {
    if (type === 'execution_start' || (type === 'executing' && data.node !== null)) {
      if (t.startedAt) return;
      t.startedAt = Date.now();
      void changeTracked(t, { status: 'running' }, (image) => image.status === 'queued');
    } else if (type === 'progress') {
      t.progress = { step: Number(data.value), total: Number(data.max) };
      emit({ type: 'progress', jobId: t.jobId, index: t.index, ...t.progress });
    } else if (type === 'execution_success' || type === 'executing') {
      void finish(t);
    } else if (type === 'execution_error') {
      void end(t, { status: 'failed', error: comfy.describeExecutionError(data) });
    } else if (type === 'execution_interrupted') {
      void end(t, { status: 'stopped' });
    }
  }

  // 出完了：从 /history 找到图，取回来存进临时文件夹
  async function finish(t: Tracked): Promise<void> {
    if (t.finishing) return;
    t.finishing = true;
    try {
      await end(t, await collect(t));
    } catch (err) {
      await end(t, { status: 'failed', error: (err as Error).message });
    }
  }

  async function collect(t: Tracked): Promise<Partial<JobImage>> {
    // ComfyUI 先推「出完了」再写 /history，取不到就稍等再取
    let entry: comfy.HistoryEntry | null = null;
    for (let i = 0; i < HISTORY_TRIES && !entry; i += 1) {
      if (i) await sleep(HISTORY_WAIT_MS);
      entry = await comfy.history(t.url, t.promptId);
    }
    const messages = entry?.status?.messages ?? [];
    const failed = messages.find(([type]) => type === 'execution_error');
    if (failed) return { status: 'failed', error: comfy.describeExecutionError(failed[1]) };
    if (messages.some(([type]) => type === 'execution_interrupted')) return { status: 'stopped' };
    // 导入的工作流可能既有预览又有存图：取最后一张存下来的，没有存图的取最后一张预览
    const refs = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? []);
    const saved = refs.filter((ref) => ref.type === 'output');
    const ref = (saved.length ? saved : refs).at(-1);
    if (!ref) return { status: 'failed', error: 'ComfyUI 说出完了，但没找到出的图' };
    const data = await comfy.viewImage(t.url, ref);
    const { width, height } = await sharp(data).metadata();
    const file = await saveTemp(t.work, data, t.seed);
    return { status: 'done', file, width, height, ...(t.startedAt && { ms: Date.now() - t.startedAt }) };
  }

  async function end(t: Tracked, change: Partial<JobImage>): Promise<void> {
    untrack(t);
    await changeTracked(t, change);
  }

  // 按 prompt_id 查一次：出完了就取图；还在 ComfyUI 队列里接着等；都不在算失败
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
          if (position && position !== t.position) emit({ type: 'queue', jobId: t.jobId, index: t.index, position });
          t.position = position;
        }
      } while (queueChecks.get(url));
    } catch {
      // 问不到排第几不要紧，进度照样走
    } finally {
      queueChecks.delete(url);
    }
  }

  // 叫停：还没发出去的和还在排队的直接算叫停；正在跑的让 ComfyUI 停，等它说停了。已经出完的留着
  function stop(place: JobPlace, jobId: string): Promise<ImageJob> {
    return withLock(`image-job:${jobId}`, async () => {
      const job = await readJob(place, jobId);
      const live = job.images.flatMap((image) => (isLive(image) && image.promptId && tracked.has(image.promptId) ? [tracked.get(image.promptId)!] : []));
      const url = live[0]?.url;
      // ComfyUI 连不上时全部算叫停
      const state = url ? await comfy.queueState(url).catch(() => null) : null;
      const dropped = live.filter((t) => !state || state.pending.includes(t.promptId));
      if (url && state) {
        await comfy.deleteQueued(url, dropped.map((t) => t.promptId)).catch(() => {});
        for (const t of live) if (state.running.includes(t.promptId)) await comfy.interrupt(url, t.promptId).catch(() => {});
      }
      dropped.forEach(untrack);
      const droppedIds = new Set(dropped.map((t) => t.promptId));
      return changeImages(place, jobId, (image) => isLive(image) && (!image.promptId || droppedIds.has(image.promptId)), { status: 'stopped' });
    });
  }

  // 删一张：临时文件直接删，不进 .trash；下载过的那份不动
  function removeImage(place: JobPlace, jobId: string, index: number): Promise<ImageJob> {
    return withLock(`image-job:${jobId}`, async () => {
      const image = (await readJob(place, jobId)).images[index];
      if (!image) throw new HttpError(404, '找不到这张图');
      if (isLive(image)) throw new HttpError(409, '这张还没出完，先叫停');
      if (image.file) await fs.rm(path.join(place.work, image.file), { force: true });
      for (const t of tracked.values()) if (t.jobId === jobId && t.index > index) t.index -= 1;
      return changeJob(place, jobId, (job) => ({ ...job, images: job.images.filter((_, i) => i !== index) }));
    });
  }

  // 打星、记下下载到哪
  function updateImage(place: JobPlace, jobId: string, index: number, change: Partial<JobImage>): Promise<ImageJob> {
    return withLock(`image-job:${jobId}`, async () => {
      if (!(await readJob(place, jobId)).images[index]) throw new HttpError(404, '找不到这张图');
      return changeImages(place, jobId, (_, i) => i === index, change);
    });
  }

  // 服务启动时：没出完的按 prompt_id 查一次，见 docs/dev-plan.md 5.19。AutoDL 的只在实例开着时查得到
  async function resume(): Promise<void> {
    const { workFolder: work } = await readConfig(configDir);
    if (!work) return;
    const lanUrl = (await readSettings(work)).comfy.lanUrl;
    let autodlUrl: Promise<string | null> | undefined;
    for (const canvas of await readAllCanvases(work).catch(() => [])) {
      for (const node of await listNodes(work, canvas.id).catch(() => [])) {
        for (const message of Object.values(node.messages)) {
          for (const job of message.images ?? []) {
            const place = { work, canvasId: canvas.id, nodeId: node.id, messageId: message.id };
            for (const [index, image] of job.images.entries()) {
              if (!isLive(image)) continue;
              const url = job.target === 'autodl' ? await (autodlUrl ??= autodl.address().catch(() => null)) : lanUrl;
              await recover(place, job.id, index, image, url, job.target);
            }
          }
        }
      }
    }
  }

  async function recover(place: JobPlace, jobId: string, index: number, image: JobImage, url: string | null, target: ComfyTarget): Promise<void> {
    const lost = '程序重启时这张还没出完';
    if (!url || !image.promptId) {
      const pick = (item: JobImage) => (image.promptId ? item.promptId === image.promptId : item.seed === image.seed && !item.promptId);
      await changeImages(place, jobId, pick, { status: 'failed', error: lost }).catch(() => {});
      return;
    }
    const t: Tracked = { ...place, jobId, promptId: image.promptId, seed: image.seed, index, url, target };
    try {
      await connect(url);
      track(t);
      await check(t, lost);
    } catch (err) {
      await end(t, { status: 'failed', error: `程序重启后查不到这张出没出完：${(err as Error).message}` });
    }
  }

  // 新连上的页面先拿到 AutoDL 的状态、现在排第几、走到第几步，之后再收变化
  function subscribe(listener: (event: ImageJobEvent) => void): () => void {
    listener({ type: 'autodl', ...autodl.current() });
    for (const t of tracked.values()) {
      if (t.position) listener({ type: 'queue', jobId: t.jobId, index: t.index, position: t.position });
      if (t.progress) listener({ type: 'progress', jobId: t.jobId, index: t.index, ...t.progress });
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

  return { create, stop, removeImage, updateImage, subscribe, resume, close };
}
