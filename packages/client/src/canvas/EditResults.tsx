import { editFnOf, isLiveImage, scaledSize, type ChatNode, type EditFnId, type ImageJob, type JobImage } from '@media-agent/shared';
import { useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { imageKey, useComfyStore } from '../store/comfyStore';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';
import { again, imageSrc, starImage, stopJob, type ImageAt } from './imageActions';
import { showEditTab } from './editWorkspaceStore';
import { useOverlays } from './overlays';

const STATUS = { queued: '排队', running: '运行', done: '完成', failed: '失败', stopped: '停止' };
type Result = { at: ImageAt; job: ImageJob; image: JobImage; messageId: string };
const keyOf = (r: Result) => `${r.job.id}:${r.at.index}:${r.image.seed}`;
const statusOf = (job: ImageJob): JobImage['status'] => job.images.find((i) => i.status === 'running')?.status ?? job.images.find((i) => i.status === 'queued')?.status ?? job.images.find((i) => i.status === 'failed')?.status ?? job.images.find((i) => i.status === 'stopped')?.status ?? 'done';
const labelOf = (node: ChatNode, job: ImageJob, messageId: string) => {
  const fn = job.editFn ?? node.messages[messageId]?.edit?.fn;
  return job.params.real ? '转真人' : job.kind === 'four-view' ? '四视图' : job.params.inpaint ? '局部重绘' : job.params.upscale ? '放大高清' : fn ? editFnOf(fn).name : '图像编辑';
};
const sizeOf = (job: ImageJob, image?: JobImage) => {
  if (image?.width && image.height) return `${image.width} × ${image.height}`;
  if (job.params.real) return '由工作流计算 · 长边 1536';
  const size = job.params.upscale ? scaledSize(job.params, job.params.upscale.scale) : job.params;
  return `${size.width} × ${size.height}`;
};

export function EditResults({ node }: { node: ChatNode }) {
  const jobs = Object.values(node.messages).flatMap((message) => (message.images ?? []).map((job) => ({ job, messageId: message.id }))).sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
  const rows: Result[] = jobs.flatMap(({ job, messageId }) => job.images.flatMap((image, index) => image.status === 'done' ? [{ at: { nodeId: node.id, messageId, jobId: job.id, index }, job, image, messageId }] : []));
  const [selected, setSelected] = useState<string[]>([]);
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const [task, setTask] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [derive, setDerive] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(false);
  const detail = jobs.find((j) => j.job.id === task);
  const full = rows.find((r) => keyOf(r) === result);
  const source = rows.find((r) => keyOf(r) === derive);
  const compare = rows.filter((r) => selected.includes(keyOf(r)));
  const markMissing = (row: Result) => setGone((s) => s[keyOf(row)] ? s : { ...s, [keyOf(row)]: true });
  const download = (row: Result) => useOverlays.setState({ download: { nodeId: node.id, title: node.title, items: [{ ...row.at, seed: row.image.seed }] } });
  const image = (row: Result) => gone[keyOf(row)] ? <div className="wb-contract">结果文件已缺失；任务参数仍可用于重出。</div> : <img className="od-media" src={imageSrc(row.at, row.image.seed, 'file')} alt={labelOf(node, row.job, row.messageId)} width={row.image.width} height={row.image.height} onError={() => markMissing(row)} />;
  const continueWith = async (row: Result, fn: EditFnId) => {
    if (!row.image.savedPath) return toast('请先保存源结果，再继续创作', { tone: 'warn' });
    if (deriving) return;
    setDeriving(true);
    try {
      const res = await fetch(imageSrc(row.at, row.image.seed, 'file'));
      if (!res.ok) throw new Error('源结果文件不可用，请按任务快照重出');
      const file = new File([await res.blob()], `${row.job.id}-${row.image.seed}.png`, { type: 'image/png' });
      const placed = await useCanvasStore.getState().place(node.id, [{ file, name: file.name }], { quiet: true });
      const current = useCanvasStore.getState().nodes[node.id];
      const slot = placed[0] ? current.slots.indexOf(placed[0].id) : -1;
      if (slot < 0) throw new Error('图片槽位已满，请先移除一张素材');
      const ok = await useCanvasStore.getState().patchNode(node.id, { edit: {
        fn, slot, text: '', maskShapes: null,
        source: { kind: 'generated', jobId: row.job.id, seed: row.image.seed },
        candidate: { messageId: row.messageId, promptIndex: row.job.promptIndex },
      } });
      if (ok) { setDerive(null); showEditTab(node.id, 'execute'); }
    } catch (err) { toast((err as Error).message, { tone: 'danger' }); }
    finally { setDeriving(false); }
  };
  return (
    <>
      <div id="editTaskList">
        {jobs.map(({ job, messageId }) => <div className="wb-taskrow" key={job.id} data-job={job.id}>
          <button type="button" className="btn btn-ghost" onClick={() => setTask(job.id)}>{labelOf(node, job, messageId)} · {STATUS[statusOf(job)]}</button>
          <span className={`tag${statusOf(job) === 'failed' ? ' tag-danger' : statusOf(job) === 'done' ? ' tag-ok' : ''}`}>{STATUS[statusOf(job)]}</span>
          <TaskProgress job={job} />
          {job.images.some(isLiveImage) && <button type="button" className="btn btn-ghost" onClick={() => void stopJob({ nodeId: node.id, messageId }, job)}><Icon name="stop" />停止任务</button>}
        </div>)}
      </div>
      <div id="editResults">
        <div className="wb-sectionhead"><h3>生成结果</h3><span className="meta">{rows.length} 个</span><button type="button" className="btn btn-secondary" onClick={() => {
          if (compare.length !== 2) return toast('请在结果中选择两张图片', { tone: 'warn' });
          if (compare.some((r) => gone[keyOf(r)])) return toast('文件缺失的结果无法比较', { tone: 'warn' });
          setComparing(true);
        }}><Icon name="swap" />比较</button></div>
        {!rows.length && <div className="wb-empty"><strong>{jobs.some((j) => j.job.images.some(isLiveImage)) ? '任务正在运行' : '还没有生成结果'}</strong><span className="meta">选择候选或直接填写执行文字，然后建立任务。</span><button type="button" className="btn btn-secondary" onClick={() => showEditTab(node.id, 'execute')}>前往执行</button></div>}
        <div className="wb-results">{rows.map((row) => <article className="wb-result" key={keyOf(row)} data-result={keyOf(row)}>
          <div className="wb-result-head"><div className="wb-field grow"><strong className="wb-result-label">{labelOf(node, row.job, row.messageId)} · {row.at.index + 1}</strong><span className="meta">{row.image.savedPath ? '已保存' : '临时结果'} · {sizeOf(row.job, row.image)} · {new Date(row.job.createdAt).toLocaleTimeString()}</span></div><span className="tag tag-ok">完成</span></div>
          <button type="button" className="wb-result-image" aria-label="查看完整结果" onClick={() => setResult(keyOf(row))}>{image(row)}</button>
          <div className="wb-result-actions">
            <label className="wb-select"><input type="checkbox" aria-label="比较这张结果" checked={selected.includes(keyOf(row))} onChange={(e) => {
              if (e.target.checked && selected.length >= 2) return toast('一次比较两张结果', { tone: 'warn' });
              setSelected(e.target.checked ? [...selected, keyOf(row)] : selected.filter((key) => key !== keyOf(row)));
            }} />比较</label>
            <button type="button" className="btn btn-secondary" onClick={() => void starImage(row.at, !row.image.starred)}><Icon name="star" />{row.image.starred ? '已收藏' : '收藏'}</button>
          </div>
          <div className="wb-result-actions"><button type="button" className="btn btn-secondary" disabled={gone[keyOf(row)]} onClick={() => download(row)}><Icon name="download" />{row.image.savedPath ? '再次下载' : '保存结果'}</button><button type="button" className="btn btn-secondary" disabled={gone[keyOf(row)]} onClick={() => setDerive(keyOf(row))}><Icon name="branch" />继续创作</button><button type="button" className="btn btn-secondary" onClick={() => setTask(row.job.id)}><Icon name="doc" />任务快照</button></div>
        </article>)}</div>
      </div>
      {detail && <TaskDialog node={node} job={detail.job} messageId={detail.messageId} onClose={() => setTask(null)} />}
      {full && <ResultDialog title="结果详情" onClose={() => setResult(null)} foot={<><button type="button" className="btn btn-secondary" disabled={gone[keyOf(full)]} onClick={() => { setResult(null); download(full); }}>保存结果</button><button type="button" className="btn btn-secondary" disabled={gone[keyOf(full)]} onClick={() => { setResult(null); setDerive(keyOf(full)); }}>继续创作</button></>}>
        {image(full)}<dl className="wb-snapshot"><dt>来源</dt><dd>{labelOf(node, full.job, full.messageId)}</dd><dt>任务</dt><dd>{full.job.id}</dd><dt>尺寸</dt><dd>{sizeOf(full.job, full.image)}</dd><dt>种子</dt><dd>{full.image.seed}</dd><dt>保存状态</dt><dd>{full.image.savedPath ?? '临时结果'}</dd></dl>
      </ResultDialog>}
      {comparing && <ResultDialog title="比较结果" onClose={() => setComparing(false)}><div className="wb-compare">{compare.map((row) => <figure key={keyOf(row)}>{image(row)}<figcaption className="wb-caption">{labelOf(node, row.job, row.messageId)}<br />种子 {row.image.seed}</figcaption></figure>)}</div></ResultDialog>}
      {source && <ResultDialog title="继续创作" onClose={() => setDerive(null)} foot={<button type="button" className="btn btn-secondary" onClick={() => { setDerive(null); download(source); }}>保存源图</button>}>
        <div className="wb-source">{image(source)}<div className="wb-field"><strong>{labelOf(node, source.job, source.messageId)}</strong><span className="meta">源结果保留，派生结果挂在同一源候选下。</span></div></div>
        <div className="wb-purpose">{(['edit', 'real', 'outfit', 'inpaint', 'depth', 'remix', 'upscale', 'fourview'] as const).map((fn) => <button type="button" key={fn} disabled={deriving || !source.image.savedPath} onClick={() => void continueWith(source, fn)}>{editFnOf(fn).name}</button>)}</div>
        <div className="wb-note">{source.image.savedPath ? '已保存结果可加入资产库和视频参考。' : '请先保存源结果，再继续创作。'}</div>
      </ResultDialog>}
    </>
  );
}

function TaskProgress({ job }: { job: ImageJob }) {
  const progress = useComfyStore((s) => s.progress[imageKey(job.id, job.images.findIndex((i) => i.status === 'running'))]);
  const queue = useComfyStore((s) => s.queue[imageKey(job.id, job.images.findIndex((i) => i.status === 'queued'))]);
  if (!job.images.some(isLiveImage)) return null;
  return progress ? <div className="wb-progress" role="progressbar" aria-label="任务进度" aria-valuenow={progress.step} aria-valuemin={0} aria-valuemax={progress.total}><span style={{ transform: `scaleX(${progress.step / Math.max(1, progress.total)})` }} /></div> : <span className="meta">{queue ? `排第 ${queue}` : '等待执行进度'}</span>;
}

function TaskDialog({ node, job, messageId, onClose }: { node: ChatNode; job: ImageJob; messageId: string; onClose: () => void }) {
  const live = job.images.some(isLiveImage);
  const image = job.images[0];
  const retry = (random: boolean) => void again({ nodeId: node.id, messageId, jobId: job.id, index: 0 }, !random).then((made) => { if (made) onClose(); });
  return <ResultDialog title={`${labelOf(node, job, messageId)} · 任务快照`} onClose={onClose} foot={live ? <button type="button" className="btn btn-secondary" onClick={() => void stopJob({ nodeId: node.id, messageId }, job)}>停止任务</button> : <><button type="button" className="btn btn-secondary" onClick={() => retry(false)}>同参数重出</button><button type="button" className="btn btn-secondary" onClick={() => retry(true)}>只换种子</button>{statusOf(job) === 'failed' && <button type="button" className="btn btn-secondary" onClick={() => retry(false)}>重试</button>}</>}>
    <span className="tag">{STATUS[statusOf(job)]}</span><TaskProgress job={job} />
    <dl className="wb-snapshot"><dt>所属分支</dt><dd>{node.title}</dd><dt>当前阶段</dt><dd>{STATUS[statusOf(job)]}</dd><dt>请求时间</dt><dd>{new Date(job.createdAt).toLocaleString()}</dd><dt>耗时</dt><dd>{image.ms !== undefined ? `${(image.ms / 1000).toFixed(1)} 秒` : '尚无完成耗时'}</dd><dt>实际尺寸</dt><dd>{sizeOf(job, image)}</dd><dt>种子</dt><dd>{image.seed}</dd><dt>素材快照</dt><dd>{job.params.krea?.reference?.kind === 'slot' ? job.params.krea.reference.imageId : job.params.inpaint?.image?.kind === 'slot' ? job.params.inpaint.image.imageId : job.params.upscaleFrom?.kind === 'slot' ? job.params.upscaleFrom.imageId : '记录于参数快照'}</dd><dt>候选来源</dt><dd>{messageId} · {job.promptIndex + 1}</dd>{job.source && <><dt>派生来源</dt><dd>{job.source.jobId} · 种子 {job.source.seed}</dd></>}</dl>
    {image.error && <div className="wb-note error" role="alert">{image.error}</div>}
    <details><summary>执行提示词与参数快照</summary><pre>{image.promptText ?? (job.params.real?.reverse ? '反推提示词将在执行完成后记录' : job.params.positive || '此操作无需提示词')}</pre><pre>{JSON.stringify(job.params, null, 2)}</pre></details>
  </ResultDialog>;
}

function ResultDialog({ title, onClose, foot, children }: { title: string; onClose: () => void; foot?: React.ReactNode; children: React.ReactNode }) {
  return <Dialog className="edit-node-dialog" label={title} onClose={onClose}><div className="dialog-head"><h2>{title}</h2><button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={onClose}><Icon name="x" /></button></div><div className="dialog-body">{children}</div><div className="dialog-foot">{foot}<button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button></div></Dialog>;
}
