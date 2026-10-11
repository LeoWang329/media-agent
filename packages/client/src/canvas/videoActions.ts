import { isLiveVideo, type VideoJob, type VideoJobEvent } from '@media-agent/shared';
import { api } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { useVideoStore } from '../store/videoStore';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';
import { selectNode } from './nodeActions';

// 视频节点上生成视频的操作：生成、再来、叫停、删掉，和服务端推来的变化，见 docs/dev-plan.md 5.27、5.28

// canvasId 不写是现在开着的画布；视频任务小窗里别的画布的写上
export type VideoPlace = { nodeId: string; messageId: string; canvasId?: string };

const jobsUrl = ({ nodeId, messageId, canvasId = useCanvasStore.getState().canvasId! }: VideoPlace) => `/canvases/${canvasId}/nodes/${nodeId}/messages/${messageId}/videos`;

// 播放的地址：临时文件清掉了服务端给下载的那份
export const videoSrc = (place: VideoPlace, job: VideoJob) => `/api${jobsUrl(place)}/${job.id}/file`;

// 二采还在跑时那份一采低清预览的地址，见 docs/dev-plan.md 5.27
export const previewSrc = (place: VideoPlace, job: VideoJob) => `/api${jobsUrl(place)}/${job.id}/preview`;

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

// 服务端回来的一条放进节点：已有的换掉，没有的接在后面；比节点里的旧就不要
export function putVideo({ nodeId, messageId }: VideoPlace, job: VideoJob) {
  useCanvasStore.setState((s) => {
    const node = s.nodes[nodeId];
    const message = node?.messages[messageId];
    if (!message) return {};
    const jobs = message.videos ?? [];
    const known = jobs.find((j) => j.id === job.id);
    if ((known?.rev ?? 0) > (job.rev ?? 0)) return {};
    const videos = known ? jobs.map((j) => (j.id === job.id ? job : j)) : [...jobs, job];
    return { nodes: { ...s.nodes, [nodeId]: { ...node, messages: { ...node.messages, [messageId]: { ...message, videos } } } } };
  });
}

function dropVideo({ nodeId, messageId }: VideoPlace, jobId: string) {
  useCanvasStore.setState((s) => {
    const node = s.nodes[nodeId];
    const message = node?.messages[messageId];
    if (!message?.videos?.some((j) => j.id === jobId)) return {};
    const videos = message.videos.filter((j) => j.id !== jobId);
    return { nodes: { ...s.nodes, [nodeId]: { ...node, messages: { ...node.messages, [messageId]: { ...message, videos } } } } };
  });
}

// 这个页面看着还在生成的：出完、失败时说一声
const watching = new Set<string>();

function finished(nodeId: string, job: VideoJob) {
  if (job.status === 'failed') return toast(`这条视频没生成出来：${job.error ?? ''}`, { tone: 'danger', ms: 6000 });
  const { selectedId, nodes } = useCanvasStore.getState();
  if (job.status === 'done' && selectedId !== nodeId && nodes[nodeId]) {
    toast(`「${nodes[nodeId].title}」的视频生成好了`, { action: '去看看', onAction: () => selectNode(nodeId) });
  }
}

// /video-jobs/events 推来的：别的画布的不管
export function onVideoEvent(event: VideoJobEvent) {
  if ((event.type !== 'job' && event.type !== 'removed') || event.canvasId !== useCanvasStore.getState().canvasId) return;
  if (event.type === 'removed') return dropVideo(event, event.jobId);
  putVideo(event, event.job);
  if (isLiveVideo(event.job)) watching.add(event.job.id);
  else if (watching.delete(event.job.id)) finished(event.nodeId, event.job);
}

// 发出去了返回 true
async function start(place: VideoPlace, body: unknown, started = '开始生成，一分钟的视频大约要半小时'): Promise<boolean> {
  try {
    // 生成设置是先改界面再排队存的：等刚改的存好再发
    await useCanvasStore.getState().patchesSaved();
    const job = await trackWrite(api<VideoJob>(jobsUrl(place), { method: 'POST', body }));
    putVideo(place, job);
    if (isLiveVideo(job)) watching.add(job.id);
    const running = useVideoStore.getState().autodl?.state === 'running';
    toast(running ? started : '生成视频用的 AutoDL 实例关着，先开机，开好了再生成。开机一般要一两分钟');
    return true;
  } catch (err) {
    failed(err);
    return false;
  }
}

// 点「生成视频」：按这条回复的时长、比例和节点现在的生成设置生成这个框
export const generateVideo = (place: VideoPlace, promptIndex: number) => start(place, { promptIndex });

// 同样参数再来（同一个种子）、只换种子再来
export const againVideo = (place: VideoPlace, job: VideoJob, sameSeed: boolean) => start(place, { again: { jobId: job.id, sameSeed } });

// 在这一版上重拍一截：起止帧、种子（null 是随机）、改过的段的提示词，见 docs/dev-plan.md 5.30
export type ReshootPick = { from: number; to: number; seed: number | null; prompts: Record<number, string> };
export const reshootVideo = (place: VideoPlace, job: VideoJob, pick: ReshootPick) => start(place, { reshoot: { jobId: job.id, ...pick } }, '开始重拍这一截');

// 接力那套从第 N 段起重出：前 N−1 段照旧留着，从第 N 段往后再跑一遍再拼起来；提示词照现在框里的，见 docs/dev-plan.md 5.34
export const rerunVideo = (place: VideoPlace, job: VideoJob, clip: number, prompts: string[]) =>
  start(place, { rerun: { jobId: job.id, clip, prompts } }, `从第 ${clip} 段起重出，前 ${clip - 1} 段照旧`);

export async function stopVideo(place: VideoPlace, job: VideoJob) {
  try {
    const stopped = await trackWrite(api<VideoJob>(`${jobsUrl(place)}/${job.id}/stop`, { method: 'POST' }));
    putVideo(place, stopped);
    toast(stopped.status === 'stopped' ? '叫停了' : '让 ComfyUI 停了，正在跑的这一步走完就停');
  } catch (err) {
    failed(err);
  }
}

// 视频任务小窗里点一条：打开那个节点，框下面那条视频闪一下；别的画布的先跳过去，见 docs/dev-plan.md 5.29
export async function showVideo(nodeId: string, jobId: string) {
  await selectNode(nodeId);
  useVideoStore.getState().flashVideo(jobId);
}

export async function removeVideo(place: VideoPlace, job: VideoJob) {
  try {
    await trackWrite(api(`${jobsUrl(place)}/${job.id}`, { method: 'DELETE' }));
    dropVideo(place, job.id);
    toast(job.savedPath ? '删掉了，下载过的那份还在' : '删掉了');
  } catch (err) {
    failed(err);
  }
}
