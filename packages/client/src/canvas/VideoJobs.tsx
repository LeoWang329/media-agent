import {
  isLiveVideo,
  mediaSummary,
  reshootText,
  splitSegments,
  VIDEO_FPS,
  videoFrames,
  videoSecondsText,
  videoImageUse,
  videoSettingsOf,
  videoSizes,
  videoMediaOf,
  type ChatNode,
  type MediaSlot,
  type Message,
  type VideoImageUse,
  type VideoJob,
  type VideoWorkflow,
} from '@media-agent/shared';
import { useEffect, useRef, useState } from 'react';
import { useVideoRatio } from './VideoSettings';
import { secondsSince, useNow } from '../components/ComfyPill';
import { useVideoStore, type VideoProgress } from '../store/videoStore';
import { clock, fmtSize } from '../ui/format';
import { Icon } from '../ui/Icon';
import { useOverlays } from './overlays';
import { againVideo, previewSrc, removeVideo, stopVideo, videoSrc } from './videoActions';
import { VideoReshoot } from './VideoReshoot';

// 框下面挂着的视频：点一次「生成视频」一条，按生成的先后排，见 docs/dev-plan.md 5.28；重拍一截出的版本挂在原片下面，见 5.30

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

// 槽位的图怎么带，见 docs/dev-plan.md 5.26；视频和音频参考只在参考模式带，配音都带，见 5.31
function carriesText(use: VideoImageUse, count: number, media: MediaSlot[]): string {
  const used = use === 'refs' ? media : media.filter((m) => m.use === 'dub');
  const parts = [use === 'refs' && count ? `${count} 张参考图` : '', ...mediaSummary(videoMediaOf(used, () => undefined))].filter(Boolean);
  const first = use === 'first' && count ? '，第 1 张图当首帧' : '';
  return `${first}${parts.length ? `，带 ${parts.join('、')}` : ''}`;
}

export function VideoJobs({ node, message, promptIndex, text, ro }: Props) {
  const jobs = boxVideos(message, promptIndex);
  const use = videoImageUse(message.systemPromptName);
  const sized = useVideoRatio(message.systemPromptName, message.aspectRatio, message.slotSnapshot[0]);
  if (!jobs.length) {
    if (ro) return null;
    if (use === 'unsupported') {
      return (
        <div className="ig-empty meta" data-od-id="video-empty">
          首尾帧、尾帧这两种提示词写的还不能生成视频，现在支持参考模式、图当首帧和纯文字。
        </div>
      );
    }
    const segments = Math.max(1, splitSegments(text).length);
    const settings = videoSettingsOf(node.video);
    const { finalWidth, finalHeight } = videoSizes(settings.megapixels, settings.upscale, sized);
    return (
      <div className="ig-empty meta" data-od-id="video-empty">
        还没生成过视频。点「生成视频」按节点的生成设置生成{carriesText(use, message.slotSnapshot.length, message.mediaSnapshot ?? [])}
        {segments > 1 ? `，分 ${segments} 段` : ''}，约{' '}
        <span className="mono">{videoSecondsText(videoFrames(node.duration, segments).total)}</span>，出片{' '}
        <span className="mono">
          {finalWidth}×{finalHeight}
        </span>
        。
      </div>
    );
  }
  return (
    <div className="ig-jobs" data-od-id="video-jobs">
      {jobs
        .filter((job) => !job.parent)
        .map((job) => (
          <Video key={job.id} node={node} message={message} root={job} versions={jobs.filter((j) => j.parent === job.id)} jobs={jobs} ro={ro} />
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

// 在做哪一步：一采、二采写第几段第几步；SelfLift 那套一段一个采样器，写成「生成」
export function stageText(progress: VideoProgress | undefined, workflow?: VideoWorkflow): string {
  if (!progress) return '正在跑';
  if (progress.stage === 'pass1' || progress.stage === 'pass2') {
    const name = workflow === 'selflift' ? '生成' : progress.stage === 'pass1' ? '一采' : '二采';
    return progress.chunk ? `${name} 第 ${progress.chunk}/${progress.chunks} 段 ${progress.step}/${progress.steps} 步` : name;
  }
  return STAGE_TEXT[progress.stage];
}

// 没出完的在做什么：等开机、准备发、排第几、做到哪一步，后面跟着从点生成到现在多久
export function LiveState({ job }: { job: VideoJob }) {
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
        {stageText(progress, job.params.workflow)}
      </span>
      {since}
    </>
  );
}

// 一条原片和它重拍出的各个版本：上面一排切换看哪一版，默认看最新的
function Video({ node, message, root, versions, jobs, ro }: { node: ChatNode; message: Message; root: VideoJob; versions: VideoJob[]; jobs: VideoJob[]; ro: boolean }) {
  const place = { nodeId: node.id, messageId: message.id };
  const all = [root, ...versions];
  const [picked, setPicked] = useState<string | null>(null);
  const job = all.find((j) => j.id === picked) ?? all.at(-1)!;
  const live = isLiveVideo(job);
  // 叫停时留下的一采低清版：整条的，能播能下载，见 docs/dev-plan.md 5.27
  const partial = job.status === 'stopped' && job.partial === true && Boolean(job.file);
  const playable = job.status === 'done' || partial;
  // 二采还在跑、一采那份已经取回来了：先给看个大概
  const preview = live && job.preview ? previewSrc(place, job) : null;
  // 播不了时看一眼文件还在不在：不在了是「已清理」。每一版各记各的
  const [problems, setProblems] = useState<Record<string, 'gone' | 'unplayable'>>({});
  const problem = problems[job.id] ?? null;
  const src = videoSrc(place, job);
  const { params } = job;
  const checkFile = () => {
    const id = job.id;
    const set = (kind: 'gone' | 'unplayable') => setProblems((p) => ({ ...p, [id]: kind }));
    void fetch(src, { method: 'HEAD' }).then((res) => set(res.status === 404 ? 'gone' : 'unplayable'), () => set('unplayable'));
  };
  const player = useRef<HTMLVideoElement>(null);
  const seek = (frame: number) => {
    if (!player.current) return;
    player.current.pause();
    player.current.currentTime = frame / VIDEO_FPS;
  };
  // 从视频任务小窗点过来的：切到那一版，滚到看得见，闪一下
  const flash = useVideoStore((s) => (s.flash && all.some((j) => j.id === s.flash!.jobId) ? s.flash : null));
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!flash) return;
    setPicked(flash.jobId);
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flash]);

  return (
    <section ref={ref} className={`ig-job vj-job is-${job.status}${flash ? ' is-flash' : ''}`} data-video={root.id} data-od-id="video-job">
      {versions.length > 0 && (
        <div className="vj-versions" role="tablist" aria-label="版本">
          {all.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={v.id === job.id} className="vj-ver" data-version={v.id} onClick={() => setPicked(v.id)}>
              {v.reshoot ? reshootText(v.reshoot.from, v.reshoot.to) : '原片'}
              {isLiveVideo(v) && <span className="dot dot-live" />}
              {v.status === 'failed' && <Icon name="warn" className="icon-sm" />}
            </button>
          ))}
        </div>
      )}
      <header className="ig-head">
        <span className={`ig-kind${job.source || job.reshoot ? ' is-derived' : ''}`}>{job.reshoot ? reshootText(job.reshoot.from, job.reshoot.to) : videoLabel(job, jobs)}</span>
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
      {preview && (
        <div className="vj-preview" data-od-id="video-preview">
          <video className="vj-player" controls preload="metadata" src={preview} style={{ aspectRatio: `${params.finalWidth} / ${params.finalHeight}` }} />
          <p className="hint">
            <Icon name="info" className="icon-sm" />
            {params.workflow === 'selflift'
              ? '这是第 1 段出的（后面的段还在跑、整条还没接起来）。看着不行就现在叫停：已经出的几段会接起来留一份，能播能下载'
              : '这是一采（低清）出的整条，二采还在跑。看着不行就现在叫停，这一版归你，能播能下载'}
          </p>
        </div>
      )}
      {playable &&
        (problem === 'gone' ? (
          <div className="vj-gone">
            <Icon name="trash" className="icon-sm" />
            已清理：临时文件被删了，也没下载过。参数还在，可以同样参数再来
          </div>
        ) : (
          <video
            ref={player}
            key={`player-${job.id}`}
            className="vj-player"
            controls
            preload="metadata"
            src={src}
            style={{ aspectRatio: `${params.finalWidth} / ${params.finalHeight}` }}
            onError={checkFile}
          />
        ))}
      {partial && problem !== 'gone' && (
        <p className="vj-partial hint">
          <Icon name="info" className="icon-sm" />
          {params.workflow === 'selflift' ? '这是叫停时把已经出的几段接起来留下的，后面的段没跑。想要整条，同样参数再来一遍' : '这是叫停时留下的一采低清版，二采没跑完。想要高清的，同样参数再来一遍'}
        </p>
      )}
      {!ro && job.status === 'done' && job.latents && problem !== 'gone' && <VideoReshoot key={`reshoot-${job.id}`} place={place} job={job} seek={seek} onStart={() => setPicked(null)} />}
      {playable && (
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
          {playable && problem !== 'gone' && (
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
          {!job.parent && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" data-vact="again" title="同一个种子，参数都照这一条" onClick={() => void againVideo(place, job, true)}>
                <Icon name="retry" />
                同样参数再来
              </button>
              <button type="button" className="btn btn-ghost btn-sm" data-vact="reseed" title="参数照这一条，随机换一个种子" onClick={() => void againVideo(place, job, false)}>
                <Icon name="sparkles" />
                只换种子再来
              </button>
            </>
          )}
          <span className="grow" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-vact="delete"
            title={versions.length && !job.parent ? '原片和重拍出的各个版本一起删掉；下载过的那份不动' : '临时文件直接删掉，下载过的那份不动'}
            onClick={() => {
              if (job.parent) setPicked(null);
              void removeVideo(place, job);
            }}
          >
            <Icon name="trash" />
            删掉
          </button>
        </div>
      )}
    </section>
  );
}
