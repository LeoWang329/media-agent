import {
  isLiveVideo,
  splitSegments,
  videoFrames,
  videoSecondsText,
  videoSettingsOf,
  videoSizes,
  type ChatNode,
  type Message,
  type VideoJob,
} from '@media-agent/shared';
import { useState } from 'react';
import { secondsSince, useNow } from '../components/ComfyPill';
import { useVideoStore, type VideoProgress } from '../store/videoStore';
import { clock, fmtSize } from '../ui/format';
import { Icon } from '../ui/Icon';
import { useOverlays } from './overlays';
import { againVideo, removeVideo, stopVideo, videoSrc } from './videoActions';

// 框下面挂着的视频：点一次「生成视频」一条，按生成的先后排，见 docs/dev-plan.md 5.28

type Props = { node: ChatNode; message: Message; promptIndex: number; text: string; ro: boolean };

const boxVideos = (message: Message, promptIndex: number) => (message.videos ?? []).filter((job) => job.promptIndex === promptIndex);

// 用了多久、跑了多久：不到一分钟写秒，不到一小时写分和秒
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

export function VideoJobs({ node, message, promptIndex, text, ro }: Props) {
  const jobs = boxVideos(message, promptIndex);
  if (!jobs.length) {
    if (ro) return null;
    const segments = Math.max(1, splitSegments(text).length);
    const settings = videoSettingsOf(node.video);
    const { finalWidth, finalHeight } = videoSizes(settings.megapixels, settings.upscale, message.aspectRatio);
    return (
      <div className="ig-empty meta" data-od-id="video-empty">
        还没生成过视频。点「生成视频」按节点的生成设置生成{segments > 1 ? `，分 ${segments} 段` : ''}，约{' '}
        <span className="mono">{videoSecondsText(videoFrames(message.duration, segments).total)}</span>，出片{' '}
        <span className="mono">
          {finalWidth}×{finalHeight}
        </span>
        。
      </div>
    );
  }
  return (
    <div className="ig-jobs" data-od-id="video-jobs">
      {jobs.map((job) => (
        <Video key={job.id} node={node} message={message} job={job} jobs={jobs} ro={ro} />
      ))}
    </div>
  );
}

// 一条的叫法：照着哪条再来的写清楚
function videoLabel(job: VideoJob, jobs: VideoJob[]): string {
  if (!job.source) return '生成视频';
  const from = jobs.find((j) => j.id === job.source!.jobId);
  if (from?.seed === job.seed) return `同样参数再来 · 种子 ${job.seed}`;
  return from ? `只换种子再来 · 来自 ${clock(from.createdAt)} 那条` : '只换种子再来';
}

const STAGE_TEXT = { encode: '编码提示词', upscale: '放大', save: '存文件' };

// 在做哪一步：一采、二采写第几段第几步
function stageText(progress: VideoProgress | undefined): string {
  if (!progress) return '正在跑';
  if (progress.stage === 'pass1' || progress.stage === 'pass2') {
    const name = progress.stage === 'pass1' ? '一采' : '二采';
    return progress.chunk ? `${name} 第 ${progress.chunk}/${progress.chunks} 段 ${progress.step}/${progress.steps} 步` : name;
  }
  return STAGE_TEXT[progress.stage];
}

// 没出完的在做什么：等开机、准备发、排第几、做到哪一步，后面跟着从点生成到现在多久
function LiveState({ job }: { job: VideoJob }) {
  const progress = useVideoStore((s) => s.progress[job.id]);
  const position = useVideoStore((s) => s.queue[job.id]);
  const autodl = useVideoStore((s) => s.autodl);
  const now = useNow(true);
  const since = ` · 已经 ${elapsedText(now - Date.parse(job.createdAt))}`;
  if (job.status === 'queued' && !job.promptId) {
    if (autodl?.state === 'booting') {
      return (
        <>
          <span className="spinner" />
          生成视频那台正在开机，等了 <span className="mono">{secondsSince(autodl.since, now)} 秒</span>
        </>
      );
    }
    return (
      <>
        <span className="spinner" />
        正在发给 ComfyUI{since}
      </>
    );
  }
  if (job.status === 'queued') {
    return (
      <>
        <span className="dot dot-live" />
        {position ? (
          <>
            排第 <b className="mono">{position}</b>
          </>
        ) : (
          '排队中'
        )}
        {since}
      </>
    );
  }
  return (
    <>
      <span className="dot dot-live" />
      <span className="mono" data-stage={progress?.stage}>
        {stageText(progress)}
      </span>
      {since}
    </>
  );
}

function Video({ node, message, job, jobs, ro }: { node: ChatNode; message: Message; job: VideoJob; jobs: VideoJob[]; ro: boolean }) {
  const place = { nodeId: node.id, messageId: message.id };
  const live = isLiveVideo(job);
  // 播不了时看一眼文件还在不在：不在了是「已清理」
  const [problem, setProblem] = useState<'gone' | 'unplayable' | null>(null);
  const src = videoSrc(place, job);
  const { params } = job;
  const checkFile = () => void fetch(src, { method: 'HEAD' }).then((res) => setProblem(res.status === 404 ? 'gone' : 'unplayable'), () => setProblem('unplayable'));

  return (
    <section className={`ig-job vj-job is-${job.status}`} data-video={job.id} data-od-id="video-job">
      <header className="ig-head">
        <span className={`ig-kind${job.source ? ' is-derived' : ''}`}>{videoLabel(job, jobs)}</span>
        <span className="ig-meta meta">
          <span className="mono">{clock(job.createdAt)}</span>
          {params.segments.length > 1 && <span>{params.segments.length} 段</span>}
          <span className="mono">{videoSecondsText(params.frames.total)}</span>
          <span className="mono">
            {params.finalWidth}×{params.finalHeight}
          </span>
        </span>
        <span className="grow" />
        <span className="ig-state" data-vstate={job.status}>
          {live ? (
            <LiveState job={job} />
          ) : job.status === 'done' ? (
            job.ms !== undefined && `用了 ${elapsedText(job.ms)}`
          ) : job.status === 'failed' ? (
            <>
              <Icon name="warn" className="icon-sm" />
              没生成出来
            </>
          ) : (
            <>
              <Icon name="stop" className="icon-sm" />
              已叫停
            </>
          )}
        </span>
        {!ro && live && (
          <button type="button" className="btn btn-ghost btn-sm" data-vact="stop" onClick={() => void stopVideo(place, job)}>
            <Icon name="stop" />
            叫停
          </button>
        )}
      </header>
      {job.status === 'done' &&
        (problem === 'gone' ? (
          <div className="vj-gone">
            <Icon name="trash" className="icon-sm" />
            已清理：临时文件被删了，也没下载过。参数还在，可以同样参数再来
          </div>
        ) : (
          <video className="vj-player" controls preload="metadata" src={src} style={{ aspectRatio: `${params.finalWidth} / ${params.finalHeight}` }} onError={checkFile} />
        ))}
      {job.status === 'done' && (
        <div className="vj-info meta">
          <span className="mono">
            {params.finalWidth}×{params.finalHeight}
          </span>
          <span className="mono">{videoSecondsText(params.frames.total)}</span>
          {job.bytes !== undefined && <span className="mono">{fmtSize(job.bytes)}</span>}
          <span>
            种子 <span className="mono">{job.seed}</span>
          </span>
          {problem === 'unplayable' && <span>浏览器播不了，下载下来用播放器看</span>}
          {job.savedPath && (
            <span className="ig-dl" title={`已下载到 ${job.savedPath}`}>
              <Icon name="download" className="icon-sm" />
              已下载
            </span>
          )}
        </div>
      )}
      {job.status === 'failed' && job.error && (
        <div className="ig-err" data-od-id="video-job-error">
          <Icon name="warn" />
          <div className="grow">
            <p className="vj-error">{job.error}</p>
          </div>
        </div>
      )}
      {!ro && !live && (
        <div className="vj-acts">
          {job.status === 'done' && problem !== 'gone' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-vact="download"
              onClick={() => useOverlays.setState({ videoDownload: { ...place, jobId: job.id, title: node.title, seed: job.seed } })}
            >
              <Icon name="download" />
              下载
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" data-vact="again" title="同一个种子，参数都照这一条" onClick={() => void againVideo(place, job, true)}>
            <Icon name="retry" />
            同样参数再来
          </button>
          <button type="button" className="btn btn-ghost btn-sm" data-vact="reseed" title="参数照这一条，随机换一个种子" onClick={() => void againVideo(place, job, false)}>
            <Icon name="sparkles" />
            只换种子再来
          </button>
          <span className="grow" />
          <button type="button" className="btn btn-ghost btn-sm" data-vact="delete" title="临时文件直接删掉，下载过的那份不动" onClick={() => void removeVideo(place, job)}>
            <Icon name="trash" />
            删掉
          </button>
        </div>
      )}
    </section>
  );
}
