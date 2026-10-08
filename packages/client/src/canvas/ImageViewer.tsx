import { CONTROL_LABELS, imageSettingsOf, NO_PREPROCESSOR, type DetailPass, type Family, type FamilyDefaults, type ImageJob, type ImageWhere, type UpscaleSettings } from '@media-agent/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { useComfyStore } from '../store/comfyStore';
import { confirmBox } from '../ui/confirm';
import { copyText } from '../ui/copy';
import { dayTime } from '../ui/format';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { again, imageSrc, imageUrl, jobLabel, refine, removeImage, revealImage, shortError, starImage, type ImageAt } from './imageActions';
import { boxJobs, cellOrder } from './ImageJobs';
import { shortCheckpoint } from './imageNode';
import { useOverlays, type ImageTarget } from './overlays';
import { DetailPassList, UpscaleFields } from './StageFields';

// 看大图和参数：这个框出过的图一张张翻，能下载、打星、删、在资源管理器里显示、再来、补做放大和部位重绘

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
  const autodlName = useComfyStore((s) => s.autodl?.instance?.name ?? null);
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
        <Side target={target} job={job} jobs={jobs} where={where} title={node.title} label={box?.label} family={family} lanUrl={status?.url ?? null} autodlName={autodlName} />
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

type SideProps = {
  target: ImageTarget;
  job: ImageJob;
  jobs: ImageJob[];
  where: ImageWhere | null;
  title: string;
  label?: string;
  family: Family;
  lanUrl: string | null;
  autodlName: string | null;
};

function Side({ target, job, jobs, where, title, label, family, lanUrl, autodlName }: SideProps) {
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
  const [refining, setRefining] = useState(false);

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
        {done && family !== 'Krea2' && (
          <button
            type="button"
            className={`btn btn-secondary btn-sm${refining ? ' is-on' : ''}`}
            id="ibRefine"
            disabled={Boolean(gone)}
            title={gone ? '这张没下载过，临时文件清掉了，没法补做' : undefined}
            onClick={() => setRefining((on) => !on)}
          >
            <Icon name="wand" />
            放大和重绘
          </button>
        )}
        {done && <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(gone)} onClick={() => useOverlays.setState({ fourView: { nodeId: target.nodeId, reference: { kind: 'generated', messageId: target.messageId, jobId: target.jobId, seed: image.seed } } })}><Icon name="image" />做四视图</button>}
      </div>
      {refining && done && !gone && <RefineForm key={`${target.jobId}:${target.index}`} target={target} family={family} size={{ width: image.width ?? params.width, height: image.height ?? params.height }} />}
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
        {params.workflow.id ? (
          <Kv k="底模、LoRA、步数">
            <span className="meta">按工作流里原来的</span>
          </Kv>
        ) : (
          <>
            <Kv k="底模">
              <span className="mono">{shortCheckpoint(params.checkpoint ?? '')}</span> <span className="tag">{family}</span>
            </Kv>
            {params.textEncoder && <Kv k="文字理解模型"><span className="mono">{shortCheckpoint(params.textEncoder)}</span></Kv>}
            {params.krea && <Kv k="起图">{params.krea.mode === 'four-view' ? `四视图 · 相似度 ${params.krea.refBoost}` : '文生图'}</Kv>}
            {params.vae && (
              <Kv k="VAE">
                <span className="mono">{shortCheckpoint(params.vae)}</span>
              </Kv>
            )}
            <Kv k="LoRA">
              {params.loras?.length ? (
                <>
                  {params.loras.map((lora, i) => (
                    <span key={i}>
                      {i > 0 && <br />}
                      <span className="mono">{shortCheckpoint(lora.name)}</span> <span className="meta mono">{lora.strength}</span>
                    </span>
                  ))}
                  {params.loraTarget === 'model' && (
                    <>
                      <br />
                      <span className="meta">只作用在画图的模型上</span>
                    </>
                  )}
                </>
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
            {params.weighting === 'a1111' && <Kv k="权重算法">A1111 的</Kv>}
          </>
        )}
        {params.controls && (
          <Kv k="ControlNet">
            {params.controls.map((control, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {CONTROL_LABELS[control.type]} <span className="mono">{control.model.replace(/\.(safetensors|pth|bin)$/, '')}</span>{' '}
                <span className="meta mono">
                  {control.preprocessor === NO_PREPROCESSOR ? '不提取' : control.preprocessor} · 强度 {control.strength} · {control.start}–{control.end}
                </span>
              </span>
            ))}
          </Kv>
        )}
        {params.upscale && (
          <Kv k="放大">
            <span className="mono">{params.upscale.model.replace(/\.(pth|safetensors)$/, '')}</span>{' '}
            <span className="meta mono">
              {params.upscale.scale}× · 重绘 {params.upscale.denoise}
            </span>
          </Kv>
        )}
        {params.details && (
          <Kv k="部位重绘">
            {params.details.map((pass, i) => (
              <span key={i} className="ib-pass">
                {i > 0 && <br />}
                <span className="mono">{pass.detector.replace(/\.pt$/, '')}</span>{' '}
                <span className="meta mono">
                  阈值 {pass.threshold} · 重绘 {pass.denoise} · {pass.guideSize}
                  {pass.sam && ` · SAM ${pass.sam.replace(/\.(pth|safetensors)$/, '')}`}
                </span>
                {(pass.positive || pass.negative) && (
                  <span className="meta">（自己写了{[pass.positive && '正面', pass.negative && '负面'].filter(Boolean).join('和')}）</span>
                )}
              </span>
            ))}
          </Kv>
        )}
        <Kv k="工作流">{params.workflow.id ? `导入的「${params.workflow.name}」` : '内置基础流程'}</Kv>
        <Kv k="ComfyUI">
          {job.target === 'autodl' ? (
            <>AutoDL {autodlName && <span className="meta">{autodlName}</span>}</>
          ) : (
            <>局域网 {lanUrl && <span className="meta mono">{lanUrl.replace(/^https?:\/\//, '')}</span>}</>
          )}
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

// 出完的图上补做：先拿节点现在的放大和部位重绘，能关掉、能改，点「开始」才发，见 docs/dev-plan.md 5.21
function RefineForm({ target, family, size }: { target: ImageTarget; family: Family; size: { width: number; height: number } }) {
  const node = useCanvasStore((s) => s.nodes[target.nodeId]);
  const defaults = useCanvasStore((s) => s.defaults[family]);
  const options = useComfyStore((s) => s.options);
  const [upscale, setUpscale] = useState<UpscaleSettings>(() => imageSettingsOf(node.image, defaults).upscale);
  const [details, setDetails] = useState<DetailPass[]>(() => imageSettingsOf(node.image, defaults).details);
  const ready = upscale.on || details.some((pass) => pass.on);

  useEffect(() => {
    void useComfyStore.getState().loadOptions();
  }, []);

  const go = () => {
    close();
    void refine(target, upscale, details);
  };

  return (
    <div className="ib-form ib-refine" data-od-id="image-refine">
      <span className="ib-form-k">放大</span>
      <UpscaleFields value={upscale} models={options?.upscaleModels ?? []} size={size} onChange={setUpscale} />
      <span className="ib-form-k">部位重绘</span>
      <DetailPassList passes={details} detectors={options?.detectors ?? []} sams={options?.sams ?? []} onChange={setDetails} />
      <p className="hint">先拿的是节点现在的出图设置，在这里改不影响节点。底模、提示词、种子用这张图的。</p>
      <span className="grow" />
      <button type="button" className="btn btn-primary btn-sm" id="ibRefineGo" disabled={!ready} title={ready ? undefined : '放大和部位重绘至少开一样'} onClick={go}>
        开始
      </button>
    </div>
  );
}
