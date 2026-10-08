import { imageErrorKind, isLiveImage, scaledSize, type ChatNode, type ComfyTarget, type ImageJob, type JobImage, type Message } from '@media-agent/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { secondsSince, useNow } from '../components/ComfyPill';
import { imageKey, useComfyStore, waitingBoot } from '../store/comfyStore';
import { clock } from '../ui/format';
import { Icon } from '../ui/Icon';
import { generate, imageSrc, jobLabel, shortError, stopJob, usePicks, type ImageAt } from './imageActions';
import { imageSize, sizeText } from './imageNode';
import { useOverlays } from './overlays';

// 框下面挂着的出图记录：一次生图一组，按时间排，新的在下面；只显示最近 3 组

const SHOWN = 3;
// 没选的组用同一个空列表：选择器每次返回新数组会让组件一直重渲染
const NONE: number[] = [];

type Props = { node: ChatNode; message: Message; promptIndex: number; ro: boolean };

// 一组里的格子：打过星的排在前面（见 docs/dev-plan.md 5.20），其余照原来的顺序
export const cellOrder = (job: ImageJob) =>
  job.images.map((image, index) => ({ image, index })).sort((a, b) => Number(Boolean(b.image.starred)) - Number(Boolean(a.image.starred)));

// 这个框出过的所有组
export const boxJobs = (message: Message, promptIndex: number) => (message.images ?? []).filter((job) => job.promptIndex === promptIndex);

export function ImageJobs({ node, message, promptIndex, ro }: Props) {
  const [all, setAll] = useState(false);
  const jobs = boxJobs(message, promptIndex);
  if (!jobs.length) {
    return ro ? null : (
      <div className="ig-empty meta">
        还没出过图。点「生图」按节点的出图设置出 <span className="mono">{imageSize(node).count}</span> 张。
      </div>
    );
  }
  const hidden = all ? 0 : Math.max(0, jobs.length - SHOWN);
  return (
    <div className="ig-jobs" data-od-id="image-jobs">
      {hidden > 0 && (
        <button type="button" className="ig-older" onClick={() => setAll(true)}>
          <Icon name="chev-right" className="icon-sm" />
          更早的 {hidden} 组（{jobs.slice(0, hidden).reduce((sum, job) => sum + job.images.filter((i) => i.status === 'done').length, 0)} 张图）
        </button>
      )}
      {jobs.slice(hidden).map((job) => (
        <Job key={job.id} node={node} message={message} job={job} jobs={jobs} ro={ro} />
      ))}
    </div>
  );
}

// 一组的状态：等 AutoDL 开机、正在出、全失败、出完几张几张失败几张叫停
function JobState({ job, booting }: { job: ImageJob; booting: boolean }) {
  const since = useComfyStore((s) => s.autodl?.since ?? null);
  const now = useNow(booting);
  const count = (status: JobImage['status']) => job.images.filter((image) => image.status === status).length;
  const [done, failed, stopped, queued] = [count('done'), count('failed'), count('stopped'), count('queued')];
  const total = job.images.length;
  if (booting) {
    return (
      <>
        <span className="spinner" />
        AutoDL 正在开机，等了 <span className="mono">{secondsSince(since, now)} 秒</span>，开好了再排队
      </>
    );
  }
  if (job.images.some(isLiveImage)) {
    return (
      <>
        <span className="dot dot-live" />
        正在出 · 出完 <span className="mono">{done}/{total}</span>
        {queued > 0 && (
          <>
            {' '}
            · 还有 <span className="mono">{queued}</span> 张在排队
          </>
        )}
      </>
    );
  }
  if (failed === total) {
    return (
      <>
        <Icon name="warn" className="icon-sm" />
        <span className="mono">{failed}</span> 张都失败了
      </>
    );
  }
  return (
    <>
      出完 <span className="mono">{done}/{total}</span>
      {failed > 0 && (
        <>
          {' · '}
          <span className="ig-bad">{failed} 张失败</span>
        </>
      )}
      {stopped > 0 && ` · ${stopped} 张叫停了`}
    </>
  );
}

function Job({ node, message, job, jobs, ro }: { node: ChatNode; message: Message; job: ImageJob; jobs: ImageJob[]; ro: boolean }) {
  const picked = usePicks((s) => s.picked[job.id] ?? NONE);
  const booting = useComfyStore((s) => waitingBoot(job.target, job.images, s.autodl));
  const [gone, setGone] = useState<number[]>([]);
  const place = { nodeId: node.id, messageId: message.id };
  const live = job.images.some(isLiveImage);
  const failedOnes = job.images.filter((image) => image.status === 'failed');
  const label = jobLabel(job, jobs);
  const done = job.images.flatMap((image, index) => (image.status === 'done' ? [index] : []));
  // 选了的只下选了的；没选就下这组出完、还找得到图的
  const toDownload = (picked.length ? picked : done.filter((index) => !gone.includes(index) || job.images[index].savedPath)).filter((index) => job.images[index]?.status === 'done');

  return (
    <section className={`ig-job${live ? ' is-live' : failedOnes.length === job.images.length ? ' is-failed' : ''}`} data-job={job.id} data-od-id="image-job">
      <header className="ig-head">
        <span className={`ig-kind${job.source ? ' is-derived' : ''}`}>{label}</span>
        <span className="ig-meta meta">
          <span className="mono">{clock(job.createdAt)}</span>
          <span>{job.images.length} 张</span>
          <span>{job.target === 'autodl' ? 'AutoDL' : '局域网'}</span>
          {job.params.workflow.id && <span>工作流「{job.params.workflow.name}」</span>}
          <span className="mono">{sizeText(job.params.upscale ? scaledSize(job.params, job.params.upscale.scale) : job.params)}</span>
        </span>
        <span className="grow" />
        <span className="ig-state">
          <JobState job={job} booting={booting} />
        </span>
        {!ro && live && (
          <button type="button" className="btn btn-ghost btn-sm" data-jact="stop" onClick={() => void stopJob(place, job)}>
            <Icon name="stop" />
            叫停
          </button>
        )}
        {!ro && done.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-jact="dl"
            title={picked.length ? `下载选中的 ${picked.length} 张` : `把这组出完的 ${done.length} 张都下载`}
            disabled={!toDownload.length}
            onClick={() =>
              useOverlays.setState({
                download: { nodeId: node.id, title: node.title, items: toDownload.map((index) => ({ ...place, jobId: job.id, index, seed: job.images[index].seed })) },
              })
            }
          >
            <Icon name="download" />
            {picked.length ? `下载选中的 ${picked.length} 张` : '下载'}
          </button>
        )}
      </header>
      <div className="ig-grid" style={{ ['--ar' as string]: `${job.params.width}/${job.params.height}` }}>
        {cellOrder(job).map(({ image, index }) => (
          <Cell
            key={`${index}-${image.seed}`}
            at={{ ...place, jobId: job.id, index }}
            image={image}
            ro={ro}
            picked={picked.includes(index)}
            gone={gone.includes(index)}
            onGone={() => setGone((list) => [...list, index])}
            steps={job.params.steps ?? 0}
            booting={booting}
          />
        ))}
      </div>
      {failedOnes[0]?.error && <JobError node={node} message={message} job={job} error={failedOnes[0].error} ro={ro} />}
    </section>
  );
}

type CellProps = { at: ImageAt; image: JobImage; ro: boolean; picked: boolean; gone: boolean; onGone: () => void; steps: number; booting: boolean };

function Cell({ at, image, ro, picked, gone, onGone, steps, booting }: CellProps) {
  const key = imageKey(at.jobId, at.index);
  const progress = useComfyStore((s) => s.progress[key]);
  const position = useComfyStore((s) => s.queue[key]);
  const toggle = usePicks((s) => s.toggle);
  const clickable = image.status === 'done' || image.status === 'failed' || image.status === 'stopped';
  const open = () => useOverlays.setState({ viewer: at });
  let inner;
  if (image.status === 'done') {
    inner = (
      <>
        {gone ? (
          <span className="ig-ph">
            <Icon name="trash" className="icon-sm" />
            已清理
            <small>
              临时文件被删了
              <br />
              参数还在
            </small>
          </span>
        ) : (
          <img src={imageSrc(at, image.seed, 'thumb')} alt={`第 ${at.index + 1} 张`} loading="lazy" draggable={false} onError={onGone} />
        )}
        <span className="ig-badges">
          {image.starred && (
            <span className="ig-star" title="打过星：这张好">
              <Icon name="star" className="icon-fill icon-sm" />
            </span>
          )}
        </span>
        {image.savedPath && (
          <span className="ig-dl" title={`已下载到 ${image.savedPath}`}>
            <Icon name="download" className="icon-sm" />
            已下载
          </span>
        )}
        {!ro && (
          <span
            className={`ig-pick${picked ? ' is-on' : ''}`}
            role="checkbox"
            aria-checked={picked}
            title="选中，一起下载"
            onClick={(e) => {
              e.stopPropagation();
              toggle(at.jobId, at.index);
            }}
          >
            <Icon name="check" className="icon-sm" />
          </span>
        )}
      </>
    );
  } else if (image.status === 'running') {
    // 导入的工作流不知道一共几步，等 ComfyUI 推来第一步再写
    const total = progress?.total || steps;
    const step = progress?.step ?? 0;
    inner = (
      <>
        <span className="ig-ph">
          {total > 0 && (
            <span className="mono">
              {step}/{total} 步
            </span>
          )}
          <small>正在出</small>
        </span>
        <span className="ig-bar">
          <i style={{ width: `${total ? Math.round((step / total) * 100) : 0}%` }} />
        </span>
      </>
    );
  } else if (image.status === 'queued' && booting && !image.promptId) {
    inner = (
      <span className="ig-ph">
        <small>等开机</small>
      </span>
    );
  } else if (image.status === 'queued') {
    inner = (
      <span className="ig-ph">
        {position ? (
          <span>
            排第 <b className="mono">{position}</b>
          </span>
        ) : (
          <span>排队中</span>
        )}
        <small>ComfyUI 一次出一张</small>
      </span>
    );
  } else if (image.status === 'failed') {
    inner = (
      <span className="ig-ph">
        <Icon name="warn" className="icon-sm" />
        失败
        <small>{shortError(image.error ?? '')}</small>
      </span>
    );
  } else {
    inner = (
      <span className="ig-ph">
        <Icon name="stop" className="icon-sm" />
        已叫停
      </span>
    );
  }
  return (
    <div className="ig-item">
      <div
        className={`ig-cell is-${image.status}${gone ? ' is-cleared' : ''}`}
        data-sel={picked || undefined}
        data-cell={clickable ? `${at.jobId}:${at.index}` : undefined}
        tabIndex={clickable ? 0 : undefined}
        role={clickable ? 'button' : undefined}
        aria-label={clickable ? `第 ${at.index + 1} 张，看大图和参数` : undefined}
        onClick={clickable ? open : undefined}
        onKeyDown={(e) => {
          if (clickable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            open();
          }
        }}
      >
        {inner}
      </div>
      <span className="ig-seed mono" title="种子">
        {image.seed}
      </span>
      {!ro && !gone && image.status === 'done' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => useOverlays.setState({ fourView: { nodeId: at.nodeId, reference: { kind: 'generated', messageId: at.messageId, jobId: at.jobId, seed: image.seed } } })}>做四视图</button>}
    </div>
  );
}

// 没出成的原因：标题、说人话的解释、ComfyUI 的原话
export function errorParts(error: string, checkpoint: string, target: ComfyTarget): { title: string; text: string; raw: string } {
  const after = (mark: string) => (error.includes(mark) ? error.slice(error.indexOf(mark) + mark.length) : '');
  switch (imageErrorKind(error)) {
    case 'down': {
      const url = target === 'autodl' ? 'AutoDL 实例的访问地址' : (error.match(/（(https?:\/\/[^）]+?)(\/ws)?）/)?.[1] ?? 'ComfyUI 的地址');
      return { title: '连不上 ComfyUI', text: `${url} 没有响应。地址不对，或者那台电脑上 ComfyUI 没开。`, raw: after('原话：') };
    }
    case 'boot':
      return { title: 'AutoDL 开机失败，这组没有发出去', text: after('AutoDL 开机失败：'), raw: '' };
    case 'checkpoint':
      return {
        title: '底模文件不在',
        text: `这台 ComfyUI 上找不到 ${checkpoint}。可能那台机器上删了或改了名。去出图设置里换一个底模，或者在设置里重新读底模列表。`,
        raw: after('ComfyUI 不收这个任务：'),
      };
    case 'rejected':
      return { title: 'ComfyUI 不收这个任务', text: '这台 ComfyUI 检查参数时没通过，下面是它的原话。', raw: after('ComfyUI 不收这个任务：') };
    case 'missing': {
      const raw = after('缺插件：');
      const types = raw.replace(/^object_info 里没有 /, '').split(', ');
      return { title: '这台 ComfyUI 缺插件，没有发出去', text: `工作流要用 ${types.join('、')}，这台 ComfyUI 上没有这几种节点。装好对应的插件、重启 ComfyUI 后再出。`, raw };
    }
    case 'memory':
      return { title: '显存不够', text: 'ComfyUI 出图时报了 out of memory。可以把尺寸调小、少挂几个 LoRA。出完的那几张留着。', raw: after('显存不够：') };
    case 'restart':
      return { title: '程序重启时这张还没出完', text: 'ComfyUI 的队列和历史里都找不到它了。参数还在，可以同样参数再来。', raw: after('：') };
    default:
      return { title: '出错了', text: error, raw: '' };
  }
}

function JobError({ node, message, job, error, ro }: { node: ChatNode; message: Message; job: ImageJob; error: string; ro: boolean }) {
  const parts = errorParts(error, job.params.checkpoint ?? '', job.target);
  const retry = () => void generate({ nodeId: node.id, messageId: message.id }, job.promptIndex);
  return (
    <div className="ig-err" data-od-id="image-job-error">
      <Icon name="warn" />
      <div className="grow">
        <b>{parts.title}</b>
        <p>{parts.text}</p>
        {parts.raw && <code className="ig-raw">{parts.raw}</code>}
      </div>
      {!ro && (
        <div className="ig-err-acts">
          {imageErrorKind(error) === 'checkpoint' && (
            <button type="button" className="btn btn-secondary btn-sm" data-jact="settings" onClick={() => useOverlays.setState({ genSettings: node.id })}>
              <Icon name="sliders" />
              换底模
            </button>
          )}
          {imageErrorKind(error) === 'boot' && (
            <>
              <Link className="btn btn-secondary btn-sm" to={{ pathname: '/settings', hash: 'comfy' }}>
                <Icon name="gear" />
                去设置
              </Link>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-jact="useLan"
                onClick={() => void useComfyStore.getState().setTarget('lan').then(retry)}
              >
                <Icon name="server" />
                改用局域网那台
              </button>
            </>
          )}
          <button type="button" className="btn btn-secondary btn-sm" data-jact="retry" onClick={retry}>
            <Icon name="retry" />
            再出一次
          </button>
        </div>
      )}
    </div>
  );
}
