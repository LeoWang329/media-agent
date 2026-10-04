import { type Family, type FamilyDefaults, type ImageJob, type ImageWhere } from '@media-agent/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { useComfyStore } from '../store/comfyStore';
import { confirmBox } from '../ui/confirm';
import { copyText } from '../ui/copy';
import { dayTime } from '../ui/format';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { again, imageSrc, imageUrl, jobLabel, removeImage, revealImage, shortError, starImage, type ImageAt } from './imageActions';
import { boxJobs, cellOrder } from './ImageJobs';
import { shortCheckpoint } from './imageNode';
import { useOverlays, type ImageTarget } from './overlays';

// 看大图和参数：这个框出过的图一张张翻，能下载、打星、删、在资源管理器里显示、再来

const close = () => useOverlays.setState({ viewer: null });
const show = (at: ImageTarget) => useOverlays.setState({ viewer: at });

// 出图用了多久：12.3 秒、1 分 5 秒
const seconds = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒` : `${(ms / 1000).toFixed(1).replace(/\.0$/, '')} 秒`);

export function ImageViewer() {
  const target = useOverlays((s) => s.viewer);
  const node = useCanvasStore((s) => (target ? s.nodes[target.nodeId] : undefined));
  if (!target || !node) return null;
  return <Viewer target={target} />;
}

// 正面提示词里程序加的那段（固定开头、评级词）单独标出来；对不上（后来改过默认值）就整串照写
function splitPositive(positive: string, defaults: FamilyDefaults): { fixed: { text: string; title: string }[]; rest: string } {
  const fixed: { text: string; title: string }[] = [];
  let rest = positive;
  const take = (word: string, title: string) => {
    if (word && (rest === word || rest.startsWith(`${word}, `))) {
      fixed.push({ text: rest === word ? word : `${word}, `, title });
      rest = rest.slice(Math.min(rest.length, word.length + 2));
    }
  };
  take(defaults.prefix, '程序按系列自动加的固定开头');
  const rating = Object.values(defaults.rating).find((word) => word && (rest === word || rest.startsWith(`${word}, `)));
  if (rating && fixed.length) take(rating, '评级词');
  return { fixed, rest };
}

function Kv({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="ib-kv">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

function Viewer({ target }: { target: ImageTarget }) {
  const node = useCanvasStore((s) => s.nodes[target.nodeId]);
  const message = node.messages[target.messageId];
  const job = message?.images?.find((j) => j.id === target.jobId);
  const status = useComfyStore((s) => s.status);
  const [where, setWhere] = useState<ImageWhere | null>(null);

  // 这个框出过的图，按框下面显示的顺序；还在出的不算
  const jobs = message && job ? boxJobs(message, job.promptIndex) : [];
  const list = jobs.flatMap((j) => cellOrder(j).flatMap(({ image, index }) => (image.status === 'done' || image.status === 'failed' || image.status === 'stopped' ? [{ job: j, index }] : [])));
  const at = list.findIndex((item) => item.job.id === target.jobId && item.index === target.index);
  const image = job?.images[target.index];
  const done = image?.status === 'done';

  useEffect(() => {
    setWhere(null);
    if (!done) return;
    let dropped = false;
    api<ImageWhere>(imageUrl(target, 'where')).then(
      (found) => !dropped && setWhere(found),
      () => undefined,
    );
    return () => {
      dropped = true;
    };
  }, [target.nodeId, target.messageId, target.jobId, target.index, done, image?.savedPath]);

  useEffect(() => {
    if (at < 0) close();
  }, [at]);

  if (!job || !image || at < 0) return null;

  const go = (step: number) => {
    const next = list[at + step];
    if (next) show({ ...target, jobId: next.job.id, index: next.index });
  };
  const box = message.parsed?.prompts[job.promptIndex];
  const family: Family = job.params.family;
  return (
    <Dialog className="dialog-wide ib-dialog" label="看大图和参数" odId="dialog-image-viewer" onClose={close} onBackdrop={close}>
      <div
        className="ib-body"
        onKeyDown={(e) => {
          if ((e.target as Element).closest('input')) return;
          if (e.key === 'ArrowLeft') go(-1);
          if (e.key === 'ArrowRight') go(1);
        }}
      >
        <div className="ib-stage">
          <Stage at={target} job={job} where={where} />
          <button type="button" className="ib-nav is-prev" aria-label="上一张" disabled={at === 0} onClick={() => go(-1)}>
            <Icon name="chev-left" />
          </button>
          <button type="button" className="ib-nav is-next" aria-label="下一张" disabled={at === list.length - 1} onClick={() => go(1)}>
            <Icon name="chev-right" />
          </button>
          <span className="ib-count mono">
            {at + 1} / {list.length}
          </span>
        </div>
        <Side target={target} job={job} jobs={jobs} where={where} title={node.title} label={box?.label} family={family} lanUrl={status?.url ?? null} />
      </div>
    </Dialog>
  );
}

function Stage({ at, job, where }: { at: ImageAt; job: ImageJob; where: ImageWhere | null }) {
  const image = job.images[at.index];
  const gone = image.status === 'done' && where && !where.temp && !where.saved;
  if (image.status === 'done' && !gone) return <img src={imageSrc(at, image.seed, 'file')} alt="" />;
  return (
    <div className="ib-ph">
      {gone ? (
        <>
          <Icon name="trash" />
          <b>临时文件被清掉了</b>
          <span>这张没下载过，图已经没了。参数都还在，可以「同样参数再来」出一张一样的。</span>
        </>
      ) : image.status === 'failed' ? (
        <>
          <Icon name="warn" />
          <b>这张没出成</b>
          <span>{shortError(image.error ?? '')}。参数都还在，可以再来。</span>
        </>
      ) : (
        <>
          <Icon name="stop" />
          <b>这张叫停了</b>
          <span>参数都还在，可以同样参数再来。</span>
        </>
      )}
    </div>
  );
}

type SideProps = { target: ImageTarget; job: ImageJob; jobs: ImageJob[]; where: ImageWhere | null; title: string; label?: string; family: Family; lanUrl: string | null };

function Side({ target, job, jobs, where, title, label, family, lanUrl }: SideProps) {
  const defaults = useCanvasStore((s) => s.defaults[family]);
  const image = job.images[target.index];
  const { params } = job;
  const done = image.status === 'done';
  const cleared = done && where && !where.temp;
  const gone = cleared && !where.saved;
  const positive = splitPositive(params.positive, defaults);
  const negativeFixed = defaults.negative && (params.negative === defaults.negative || params.negative.startsWith(`${defaults.negative}, `));

  const remove = async () => {
    const ok = await confirmBox({
      title: '删掉这张图？',
      body: `临时文件夹里的文件直接删掉，不进回收站。${image.savedPath ? `下载过的那份（${image.savedPath}）不动。` : '这张没下载过，删了就找不回来，但同组别的图不受影响。'}`,
      ok: '删除',
      danger: true,
    });
    if (ok) await removeImage(target);
  };
  const rerun = (sameSeed: boolean) => {
    close();
    void again(target, sameSeed);
  };

  return (
    <aside className="ib-side">
      <div className="ib-top">
        <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
          <span className="meta">
            {title} · {label || '提示词'} · {jobLabel(job, jobs)}
          </span>
          <h2 className="ib-title">
            <span className="meta">种子</span> <span className="mono">{image.seed}</span>
          </h2>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {image.starred && (
              <span className="tag tag-star">
                <Icon name="star" className="icon-fill" />
                打过星
              </span>
            )}
            {image.savedPath && (
              <span className="tag tag-ok" title={image.savedPath}>
                <Icon name="download" />
                已下载
              </span>
            )}
            {cleared && <span className="tag tag-warn">临时文件已清理{where.saved ? '，显示的是下载的那份' : ''}</span>}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-icon ib-close" aria-label="关闭" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      {done && (
        <div className="ib-acts">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={Boolean(gone)}
            onClick={() => useOverlays.setState({ download: { nodeId: target.nodeId, title, items: [{ ...target, seed: image.seed }] } })}
          >
            <Icon name="download" />
            {image.savedPath ? '再下载一份' : '下载'}
          </button>
          <button type="button" className={`btn btn-secondary btn-sm${image.starred ? ' is-star' : ''}`} onClick={() => void starImage(target, !image.starred)}>
            <Icon name="star" className={image.starred ? 'icon-fill' : undefined} />
            {image.starred ? '已打星' : '打星（这张好）'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(gone)} onClick={() => void revealImage(target)}>
            <Icon name="reveal" />
            在资源管理器里显示
          </button>
          <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void remove()}>
            <Icon name="trash" />
            删除
          </button>
        </div>
      )}
      <div className="ib-acts ib-acts-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => rerun(true)}>
          <Icon name="retry" />
          同样参数再来
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => rerun(false)}>
          <Icon name="sparkles" />
          只换种子再来
        </button>
      </div>
      <div className="ib-params" data-od-id="image-params">
        <div className="ib-prompt">
          <span className="k">正面提示词</span>
          <p className="mono">
            {positive.fixed.map((part, i) => (
              <span key={i} className="ib-fixed" title={part.title}>
                {part.text}
              </span>
            ))}
            {positive.rest}
          </p>
        </div>
        <div className="ib-prompt">
          <span className="k">负面词</span>
          <p className="mono">
            {negativeFixed ? (
              <>
                <span className="ib-fixed" title={`${family} 系列默认负面词`}>
                  {defaults.negative}
                </span>
                {params.negative.slice(defaults.negative.length)}
              </>
            ) : (
              params.negative
            )}
          </p>
        </div>
        <Kv k="尺寸">
          <span className="mono">
            {image.width ?? params.width}×{image.height ?? params.height}
          </span>
        </Kv>
        <Kv k="底模">
          <span className="mono">{shortCheckpoint(params.checkpoint ?? '')}</span> <span className="tag">{family}</span>
        </Kv>
        <Kv k="LoRA">
          {params.loras?.length ? (
            params.loras.map((lora, i) => (
              <span key={i}>
                {i > 0 && <br />}
                <span className="mono">{shortCheckpoint(lora.name)}</span> <span className="meta mono">{lora.strength}</span>
              </span>
            ))
          ) : (
            <span className="meta">没挂</span>
          )}
        </Kv>
        <Kv k="步数 · CFG">
          <span className="mono">
            {params.steps} · {params.cfg}
          </span>
        </Kv>
        <Kv k="采样器 · 调度器">
          <span className="mono">
            {params.sampler} · {params.scheduler}
          </span>
        </Kv>
        <Kv k="clip skip">
          <span className="mono">{params.clipSkip}</span>
        </Kv>
        <Kv k="工作流">{params.workflow.id ? `导入的「${params.workflow.name}」` : '内置基础流程'}</Kv>
        <Kv k="ComfyUI">
          局域网 {lanUrl && <span className="meta mono">{lanUrl.replace(/^https?:\/\//, '')}</span>}
        </Kv>
        <Kv k="用时">{image.ms ? <span className="mono">{seconds(image.ms)}</span> : <span className="meta">—</span>}</Kv>
        <Kv k="出图时间">
          <span className="mono">{dayTime(job.createdAt)}</span>
        </Kv>
        {done && (
          <Kv k="文件">
            <span className="mono ib-path">{where ? (where.temp ?? where.saved ?? '已清理') : ''}</span>
          </Kv>
        )}
      </div>
      <div className="ib-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(params.positive, '已复制正面提示词（含固定开头）')}>
          <Icon name="copy" />
          复制正面提示词
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(String(image.seed), `已复制种子 ${image.seed}`)}>
          <Icon name="copy" />
          复制种子
        </button>
      </div>
    </aside>
  );
}
