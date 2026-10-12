import { editFnOf, editSettingsOf, editTextBlock, imageErrorKind, isLiveImage, type ChatNode, type DetailPass, type GeneratedRef, type ImageJob, type ImageJobEvent, type JobImage, type PartialEditSettings, type UpscaleSettings } from '@media-agent/shared';
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

async function start(place: ImagePlace, body: unknown, options: { path?: string; note?: string } = {}): Promise<ImageJob | undefined> {
  try {
    // 出图设置是先改界面再排队存的：等刚改的存好再发，服务端按界面上看到的出
    await useCanvasStore.getState().patchesSaved();
    const job = await trackWrite(api<ImageJob>(options.path ?? jobsUrl(place), { method: 'POST', body }));
    putJob(place, job);
    // 推送先到、已经出完的，出完时的提示在 onImageEvent 里说过了
    if ((findJob(place, job.id) ?? job).images.some(isLiveImage)) watching.add(job.id);
    refreshCards();
    const booting = job.target === 'autodl' && useComfyStore.getState().autodl?.state !== 'running';
    toast(booting ? 'AutoDL 实例关着，先开机，开好了再出图。开机一般要一两分钟' : options.note ?? `开始出 ${job.images.length} 张，按顺序排进 ComfyUI 的队列`);
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

// 在一张出的图上局部重绘，见 docs/dev-plan.md 5.35：mask 是那张抠过透明的 PNG（data URL），只出一张
export const inpaint = (at: ImageAt, body: { mask: string; positive: string; negative: string; denoise: number }) =>
  start(at, body, { path: `${jobsUrl(at)}/${at.jobId}/${at.index}/inpaint`, note: '开始重绘这一块，出完挂在同一个框下面' });

// 图像编辑节点「开始」之前还差什么：差什么就返回一句话，都够了返回 null。
// 「还没做」的功能拦住（框上那个「开始」是照回复上记的功能来的，可能是老回复时记下的）；
// 放大 / 高清不看提示词、四视图的主指令是固定的（框里那句只当额外要求）、转真人开着反推时那句由反推模型跑图时现写，
// 这三条不要求写字（editTextBlock）；「换脸」还要第二张图当真人参考。
// 局部重绘那句「先在图上拖个框」跟画没画掩码有关，那块形状在面板里，所以由面板先问一遍（EditPanel），
// 这儿只管节点上存着的那几项，见 docs/plan-image-edit-node-layout.md 第 4.2、4.4 节
export function editStartBlock(node: ChatNode, edit = editSettingsOf(node.edit, node.slots.length)): string | null {
  const fn = editFnOf(edit.fn);
  if (!fn.ready) return `「${fn.name}」还没做，下一批上`;
  if (!node.slots[edit.slot]) return `还没选图：先在下面点一张${fn.role}`;
  if (fn.id === 'real') return edit.real.dual && node.slots.length < 2 ? `换脸要 2 张图，现在只有 ${node.slots.length} 张` : null;
  return editTextBlock(edit);
}

// 框上那个「开始」用的：出的图挂在 target.messageId 的第 target.promptIndex 个框下面（服务端不新建回复），
// change 是这条框自己那套（功能、图、那句话）——只换这几项，别的参数照节点上现在那份
export type EditStartOptions = {
  mask?: string;
  target?: { messageId: string; promptIndex: number };
  change?: PartialEditSettings;
};

// 图像编辑节点上点「开始」：服务端自己造一条回复把出的图挂上去（照「做四视图」那套），
// 回来的节点和任务直接放进画布，见 docs/dev-plan.md 5.36。
// 局部重绘时 mask 那份掩码也一起发出去（服务端落成临时文件，再传给 ComfyUI），见 docs/dev-plan.md 5.35。
// 框上那个「开始」和面板底部的「开始」共用这一条（服务端路径只有一条 POST /edit），见 layout 第 4 节 ④
export async function startEdit(nodeId: string, options: EditStartOptions = {}) {
  const canvasId = useCanvasStore.getState().canvasId;
  if (!useCanvasStore.getState().nodes[nodeId]) return;
  try {
    // 编辑栏是先改界面再排队存的：等刚改的存好再发，服务端按界面上看到的做。
    // 存完再取一次节点——不然拿的是改之前那份（清空那句话之后马上点开始，发出去的还是旧那句）
    await useCanvasStore.getState().patchesSaved();
    const node = useCanvasStore.getState().nodes[nodeId];
    if (!node) return;
    const edit = editSettingsOf({ ...node.edit, ...options.change }, node.slots.length);
    const block = editStartBlock(node, edit) ?? (edit.fn === 'inpaint' && !options.mask ? '先在图上拖个框或者涂抹出要重画的地方' : null);
    if (block) return failed(new Error(block));
    // 整份编辑设置都发出去（缺的字段服务端按默认值补），转真人那套在 real 里、局部重绘的掩码在 mask 里，
    // 深度迁移的控制强度、风格 Remix 的 LoRA、放大 / 高清的倍数和模型在 depth / remix / upscale 里
    const body = {
      fn: edit.fn, slot: edit.slot, slotB: edit.slotB, text: edit.text, refBoost: edit.refBoost,
      real: edit.real, inpaint: edit.inpaint, depth: edit.depth, remix: edit.remix, upscale: edit.upscale,
      mask: options.mask,
      ...(options.target && { messageId: options.target.messageId, promptIndex: options.target.promptIndex }),
    };
    const res = await trackWrite(api<{ node: ChatNode; job: ImageJob; messageId: string }>(
      `/canvases/${canvasId}/nodes/${nodeId}/edit`,
      { method: 'POST', body },
    ));
    useCanvasStore.setState((s) => ({ nodes: { ...s.nodes, [nodeId]: res.node } }));
    if (res.job.images.some(isLiveImage)) watching.add(res.job.id);
    refreshCards();
    const note =
      edit.fn === 'real'
        ? '开始转真人'
        : edit.fn === 'inpaint'
          ? '开始重绘这一块'
          : edit.fn === 'depth'
            ? '开始按深度结构重画'
            : edit.fn === 'remix'
              ? '开始 Remix'
              : edit.fn === 'upscale'
                ? '开始放大这张图'
                : edit.fn === 'fourview'
                  ? '开始做四视图'
                  : '开始改这张图';
    toast(`${note}，出 ${res.job.images.length} 张，按顺序排进 ComfyUI 的队列`);
    return res.job;
  } catch (err) {
    failed(err);
    return undefined;
  }
}

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
  if (job.kind === 'four-view') return '四视图';
  if (job.kind === 'edit') return '编辑';
  const source = job.source;
  if (job.kind === 'refine') {
    // 没有「照着哪张补做」的是编辑节点那条「放大 / 高清」：原图是槽位里那张，不是这个节点出过的图
    if (!source && job.params.upscaleFrom) return '放大 / 高清';
    const from = source && jobs.find((j) => j.id === source.jobId);
    if (!from) return '放大和重绘';
    const at = from.images.findIndex((image) => image.seed === source.seed);
    return `放大和重绘 · 来自 ${clock(from.createdAt)} 那组${at >= 0 ? `第 ${at + 1} 张` : ''}`;
  }
  if (job.kind === 'inpaint') {
    const from = source && jobs.find((j) => j.id === source.jobId);
    if (!from) return '局部重绘';
    const at = from.images.findIndex((image) => image.seed === source.seed);
    return `局部重绘 · 来自 ${clock(from.createdAt)} 那组${at >= 0 ? `第 ${at + 1} 张` : ''}`;
  }
  if (!source) return '生图';
  if (job.images[0]?.seed === source.seed) return `同样参数再来 · 种子 ${source.seed}`;
  const from = jobs.find((j) => j.id === source.jobId);
  if (!from) return '只换种子再来';
  const at = from.images.findIndex((image) => image.seed === source.seed);
  return `只换种子再来 · 来自 ${clock(from.createdAt)} 那组${at >= 0 ? `第 ${at + 1} 张` : ''}`;
}
