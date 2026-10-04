import { imageErrorKind, isLiveImage, type DetailPass, type GeneratedRef, type ImageJob, type ImageJobEvent, type JobImage, type UpscaleSettings } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { useComfyStore } from '../store/comfyStore';
import { clock } from '../ui/format';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';
import { selectNode } from './nodeActions';

// 生图节点上出图的操作：生图、再来、叫停、删一张、打星，和服务端推来的变化

export type ImagePlace = { nodeId: string; messageId: string };
export type ImageAt = ImagePlace & { jobId: string; index: number };

const jobsUrl = ({ nodeId, messageId }: ImagePlace) => `/canvases/${useCanvasStore.getState().canvasId}/nodes/${nodeId}/messages/${messageId}/images`;
export const imageUrl = (at: ImageAt, what: 'file' | 'thumb' | 'where' | 'reveal' | 'star') => `${jobsUrl(at)}/${at.jobId}/${at.index}/${what}`;

// 缩略图和大图的地址：带上种子，删掉一张后后面的往前补位，地址一样也不会拿到浏览器里存着的那张
export const imageSrc = (at: ImageAt, seed: number, what: 'file' | 'thumb') => `/api${imageUrl(at, what)}?seed=${seed}`;

// 卡片和首页上出的图的缩略图（不在画布页时也能用）
export const generatedThumb = (canvasId: string, nodeId: string, ref: GeneratedRef) =>
  `/api/canvases/${canvasId}/nodes/${nodeId}/messages/${ref.messageId}/images/${ref.jobId}/${ref.index}/thumb?seed=${ref.seed}`;

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

// 服务端回来的一组放进节点：已有的换掉，一张不剩的去掉，没有的接在后面；比节点里的旧就不要
export function putJob({ nodeId, messageId }: ImagePlace, job: ImageJob) {
  useCanvasStore.setState((s) => {
    const node = s.nodes[nodeId];
    const message = node?.messages[messageId];
    if (!message) return {};
    const jobs = message.images ?? [];
    if ((jobs.find((j) => j.id === job.id)?.rev ?? 0) > (job.rev ?? 0)) return {};
    const images = jobs.some((j) => j.id === job.id)
      ? jobs.flatMap((j) => (j.id !== job.id ? [j] : job.images.length ? [job] : []))
      : job.images.length
        ? [...jobs, job]
        : jobs;
    return { nodes: { ...s.nodes, [nodeId]: { ...node, messages: { ...node.messages, [messageId]: { ...message, images } } } } };
  });
}

// 画布卡片上的出图进度由服务端算，变了以后隔一会儿读一次画布，连着变只读一次
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const refreshCards = () => {
  refreshTimer ??= setTimeout(() => {
    refreshTimer = null;
    void useCanvasStore.getState().refresh().catch(() => undefined);
  }, 600);
};

// 这个页面看着还在出的组：出完时说一声
const watching = new Set<string>();

const countOf = (images: JobImage[], status: JobImage['status']) => images.filter((image) => image.status === status).length;

// 一组出完（或者都停了、失败了）：没出成的说清楚原因；面板开着别的节点时说一声出完了
function finished(nodeId: string, job: ImageJob) {
  const failures = job.images.filter((image) => image.status === 'failed');
  const done = countOf(job.images, 'done');
  if (failures.length === job.images.length) {
    const kind = imageErrorKind(failures[0].error ?? '');
    const text = kind === 'down' ? '连不上 ComfyUI，这组没出成' : kind === 'checkpoint' ? '这台 ComfyUI 上找不到底模文件，这组没出成' : `这组没出成：${shortError(failures[0].error ?? '')}`;
    toast(text, { tone: 'danger', ms: 4500 });
    return;
  }
  if (failures.some((image) => imageErrorKind(image.error ?? '') === 'memory')) toast('显存不够，这组后面几张没出成', { tone: 'danger', ms: 4500 });
  const { selectedId, nodes } = useCanvasStore.getState();
  if (done && selectedId !== nodeId && nodes[nodeId]) {
    toast(`「${nodes[nodeId].title}」出完 ${done} 张`, { action: '去看看', onAction: () => selectNode(nodeId) });
  }
}

// /image-jobs/events 推来的：别的画布的不管
export function onImageEvent(event: ImageJobEvent) {
  if (event.type !== 'job' || event.canvasId !== useCanvasStore.getState().canvasId) return;
  putJob(event, event.job);
  refreshCards();
  if (event.job.images.some(isLiveImage)) watching.add(event.job.id);
  else if (watching.delete(event.job.id)) finished(event.nodeId, event.job);
}

const findJob = ({ nodeId, messageId }: ImagePlace, jobId: string) => useCanvasStore.getState().nodes[nodeId]?.messages[messageId]?.images?.find((j) => j.id === jobId);

async function start(place: ImagePlace, body: unknown): Promise<ImageJob | undefined> {
  try {
    // 出图设置是先改界面再排队存的：等刚改的存好再发，服务端按界面上看到的出
    await useCanvasStore.getState().patchesSaved();
    const job = await trackWrite(api<ImageJob>(jobsUrl(place), { method: 'POST', body }));
    putJob(place, job);
    // 推送先到、已经出完的，出完时的提示在 onImageEvent 里说过了
    if ((findJob(place, job.id) ?? job).images.some(isLiveImage)) watching.add(job.id);
    refreshCards();
    const booting = job.target === 'autodl' && useComfyStore.getState().autodl?.state !== 'running';
    toast(booting ? 'AutoDL 实例关着，先开机，开好了再出图。开机一般要一两分钟' : `开始出 ${job.images.length} 张，按顺序排进 ComfyUI 的队列`);
    return job;
  } catch (err) {
    failed(err);
    return undefined;
  }
}

// 点「生图」：按节点现在的出图设置出这个框
export const generate = (place: ImagePlace, promptIndex: number) => start(place, { promptIndex });

// 同样参数再来（同一个种子）、只换种子再来，都只出一张
export const again = (at: ImageAt, sameSeed: boolean) => start(at, { again: { jobId: at.jobId, index: at.index, sameSeed } });

// 出完的图上补做放大和部位重绘，见 docs/dev-plan.md 5.21
export const refine = (at: ImageAt, upscale: UpscaleSettings, details: DetailPass[]) => start(at, { refine: { jobId: at.jobId, index: at.index, upscale, details } });

export async function stopJob(place: ImagePlace, job: ImageJob) {
  try {
    putJob(place, await trackWrite(api<ImageJob>(`${jobsUrl(place)}/${job.id}/stop`, { method: 'POST' })));
    toast(`叫停了。出完的 ${countOf(job.images, 'done')} 张留着；正在出的那张也让 ComfyUI 停了`);
  } catch (err) {
    failed(err);
  }
}

export async function starImage(at: ImageAt, on: boolean): Promise<boolean> {
  try {
    putJob(at, await trackWrite(api<ImageJob>(imageUrl(at, 'star'), { method: 'POST', body: { on } })));
    refreshCards();
    toast(on ? '这张打了星。框下面和首页列图时排在前面' : '取消了这张的星');
    return true;
  } catch (err) {
    failed(err);
    return false;
  }
}

export async function removeImage(at: ImageAt): Promise<boolean> {
  try {
    putJob(at, await trackWrite(api<ImageJob>(`${jobsUrl(at)}/${at.jobId}/${at.index}`, { method: 'DELETE' })));
    usePicks.getState().drop(at.jobId);
    refreshCards();
    toast('删掉了');
    return true;
  } catch (err) {
    failed(err);
    return false;
  }
}

export async function revealImage(at: ImageAt) {
  await api(imageUrl(at, 'reveal'), { method: 'POST' }).catch(failed);
}

// 框下面选中的几张，一起下载；键是组 id，值是第几张
type Picks = { picked: Record<string, number[]>; toggle: (jobId: string, index: number) => void; drop: (jobId: string) => void };
export const usePicks = create<Picks>((set) => ({
  picked: {},
  toggle: (jobId, index) =>
    set((s) => {
      const list = s.picked[jobId] ?? [];
      return { picked: { ...s.picked, [jobId]: list.includes(index) ? list.filter((i) => i !== index) : [...list, index] } };
    }),
  drop: (jobId) =>
    set((s) => {
      const { [jobId]: _, ...picked } = s.picked;
      return { picked };
    }),
}));

// 格子上、提示条里说的失败原因，一两个词
export function shortError(error: string): string {
  return { down: '连不上', checkpoint: '底模文件不在', rejected: 'ComfyUI 不收', missing: '缺插件', memory: '显存不够', restart: '程序重启时没出完', boot: '开机失败', other: '出错了' }[
    imageErrorKind(error)
  ];
}

// 一组的叫法：照着哪张再来的、补做的是哪张，写清楚
export function jobLabel(job: ImageJob, jobs: ImageJob[]): string {
  const source = job.source;
  if (job.kind === 'refine') {
    const from = source && jobs.find((j) => j.id === source.jobId);
    if (!from) return '放大和重绘';
    const at = from.images.findIndex((image) => image.seed === source.seed);
    return `放大和重绘 · 来自 ${clock(from.createdAt)} 那组${at >= 0 ? `第 ${at + 1} 张` : ''}`;
  }
  if (!source) return '生图';
  if (job.images[0]?.seed === source.seed) return `同样参数再来 · 种子 ${source.seed}`;
  const from = jobs.find((j) => j.id === source.jobId);
  if (!from) return '只换种子再来';
  const at = from.images.findIndex((image) => image.seed === source.seed);
  return `只换种子再来 · 来自 ${clock(from.createdAt)} 那组${at >= 0 ? `第 ${at + 1} 张` : ''}`;
}
