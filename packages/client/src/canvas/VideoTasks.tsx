import { reshootText, videoRemainingMs, videoSecondsText, type VideoTask, type VideoTiming } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useNow } from '../components/ComfyPill';
import { useCanvasStore } from '../store/canvasStore';
import { useVideoStore, type VideoProgress } from '../store/videoStore';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { elapsedText, LiveState } from './VideoJobs';
import { showVideo, stopVideo } from './videoActions';

// 画布顶上视频那台的状态旁边的「视频任务」：列出所有画布的视频任务，见 docs/dev-plan.md 5.29

export function VideoTasksButton() {
  const autodl = useVideoStore((s) => s.autodl);
  const live = useVideoStore((s) => s.board?.live.length ?? 0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    void useVideoStore.getState().loadBoard();
  }, []);

  if (!autodl || autodl.state === 'unset') return null;
  return (
    <>
      <button
        type="button"
        className="cf-pill vt-btn"
        id="videoTasks"
        data-od-id="video-tasks"
        title="所有画布的视频任务：在做的、排着的和这次开程序以后完了的"
        onClick={(e) => {
          if (anchor) return setAnchor(null);
          setAnchor(e.currentTarget.getBoundingClientRect());
          void useVideoStore.getState().loadBoard();
        }}
      >
        <Icon name="film" className="icon-sm" />
        <span className="cf-txt">视频任务</span>
        {live > 0 && <b className="vt-count mono">{live}</b>}
        <Icon name="chev-down" className="icon-sm" />
      </button>
      {anchor && <VideoTasksPop anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}

// 每条还要多久：在做的按它自己做到哪；排着的再加上前面每条剩下的。前面有一条估不出，后面的也估不出
function remainingOf(live: VideoTask[], progress: Record<string, VideoProgress>, timings: VideoTiming[], now: number): (number | null)[] {
  let ahead: number | null = 0;
  return live.map(({ job }) => {
    const mine = videoRemainingMs(job.params, progress[job.id] ?? null, timings, now);
    const started = job.status === 'running';
    const total = mine === null ? null : started ? mine : ahead === null ? null : ahead + mine;
    ahead = mine === null || ahead === null ? null : ahead + mine;
    return total;
  });
}

function VideoTasksPop({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const board = useVideoStore((s) => s.board);
  const progress = useVideoStore((s) => s.progress);
  const now = useNow(Boolean(board?.live.length));
  const navigate = useNavigate();
  const live = board?.live ?? [];
  const done = board?.done ?? [];
  const left = remainingOf(live, progress, board?.timings ?? [], now);

  // 点一条：这个画布的直接打开节点，别的画布的先跳过去
  const open = (task: VideoTask) => {
    onClose();
    if (task.canvasId === useCanvasStore.getState().canvasId) return void showVideo(task.nodeId, task.job.id);
    navigate({ pathname: `/canvas/${task.canvasId}`, hash: `node=${task.nodeId}&video=${task.job.id}` });
  };

  return (
    <Popover anchor={anchor} align="right" className="cf-pop vt-pop" odId="video-tasks-popover" label="视频任务" onClose={onClose} keepOpen={(t) => Boolean(t.closest('#videoTasks'))}>
      <div className="cf-pop-head">
        <b>视频任务</b>
        <span className="meta">所有画布的，点一条跳到那个节点</span>
      </div>
      {!board ? (
        <p className="meta vt-empty">正在读…</p>
      ) : (
        <>
          <section className="vt-sec" data-od-id="video-tasks-live">
            <h4>在做的和排着的</h4>
            {live.length ? (
              live.map((task, i) => <Row key={task.job.id} task={task} left={left[i]} onOpen={() => open(task)} />)
            ) : (
              <p className="meta vt-empty">现在没有在做的</p>
            )}
          </section>
          <section className="vt-sec" data-od-id="video-tasks-done">
            <h4>完了的</h4>
            {done.length ? done.map((task) => <Row key={task.job.id} task={task} onOpen={() => open(task)} />) : <p className="meta vt-empty">这次开程序以后还没有</p>}
          </section>
        </>
      )}
    </Popover>
  );
}

// 一条：画布名、节点标题、第几个框、多长、出片宽高；在做什么、跑了多久、预计还要多久；在做的和排着的能叫停
function Row({ task, left, onOpen }: { task: VideoTask; left?: number | null; onOpen: () => void }) {
  const { job } = task;
  const live = job.status === 'queued' || job.status === 'running';
  return (
    <div className={`vt-row is-${job.status}`} data-task={job.id} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="vt-where">
        <span className="vt-canvas">{task.canvasTitle}</span>
        <span className="vt-node">{task.nodeTitle}</span>
        <span className="meta">第 {job.promptIndex + 1} 个框</span>
        {job.reshoot && <span className="meta">{reshootText(job.reshoot.from, job.reshoot.to)}</span>}
      </div>
      <div className="vt-meta meta">
        <span className="mono">{videoSecondsText(job.params.frames.total)}</span>
        <span className="mono">
          {job.params.finalWidth}×{job.params.finalHeight}
        </span>
      </div>
      <div className="vt-state">
        {live ? (
          <>
            <span className="vt-live">
              <LiveState job={job} />
            </span>
            <span className="vt-left meta">{left === null || left === undefined ? '第一次出这个大小，估不出' : `预计还要 ${elapsedText(left)}`}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              data-vact="stop"
              onClick={(e) => {
                e.stopPropagation();
                void stopVideo({ canvasId: task.canvasId, nodeId: task.nodeId, messageId: task.messageId }, job);
              }}
            >
              <Icon name="stop" />
              叫停
            </button>
          </>
        ) : job.status === 'done' ? (
          <span className="meta">出完了{job.ms !== undefined && ` · 用了 ${elapsedText(job.ms)}`}</span>
        ) : job.status === 'failed' ? (
          <span className="vt-failed">
            <Icon name="warn" className="icon-sm" />
            没生成出来
          </span>
        ) : (
          <span className="meta">
            <Icon name="stop" className="icon-sm" />
            已叫停
          </span>
        )}
      </div>
    </div>
  );
}
