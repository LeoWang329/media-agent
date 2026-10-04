import { MODEL_KINDS, modelKindLabel, nameFromUrl, sizeText, type ModelKind, type ModelTransfer, type RemoteModelFile } from '@media-agent/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, type ApiError } from '../api';
import { AutodlStateView } from '../components/ComfyPill';
import { useComfyStore } from '../store/comfyStore';
import { useModelStore, type Waiting } from '../store/modelStore';
import { confirmBox } from '../ui/confirm';
import { Dialog } from '../ui/Dialog';
import { whenDid } from '../ui/format';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';

// 设置「AutoDL 上的模型」：往 AutoDL 那台传底模、LoRA 这些，从电脑传或者给链接让它下；列出自己传的，能删，见 docs/dev-plan.md 5.22

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

const STATE_TEXT: Record<ModelTransfer['state'], string> = { queued: '排着', running: '在传', done: '传完了', failed: '没传成', stopped: '停了' };

export function AutodlModelsTab({ workFolder }: { workFolder: string | null }) {
  const autodl = useComfyStore((s) => s.autodl);
  const remote = useModelStore((s) => s.remote);
  const listError = useModelStore((s) => s.listError);
  const transfers = useModelStore((s) => s.transfers);
  const waiting = useModelStore((s) => s.waiting);
  const [form, setForm] = useState<'upload' | 'download' | null>(null);
  const running = autodl?.state === 'running';

  useEffect(() => {
    if (!workFolder) return;
    void useComfyStore.getState().checkAutodl();
    useModelStore.getState().watch();
  }, [workFolder]);

  useEffect(() => {
    if (workFolder && running) void useModelStore.getState().load();
  }, [workFolder, running]);

  if (!workFolder) return <p className="muted">AutoDL 的实例记在工作文件夹里，先在「工作文件夹」里选一个。</p>;

  const remove = async (file: RemoteModelFile) => {
    const ok = await confirmBox({ title: `删掉「${file.path}」？`, body: '那台上的文件直接删掉，找不回来。', ok: '删除', danger: true });
    if (!ok) return;
    try {
      await api('/comfy/autodl/models', { method: 'DELETE', body: { kind: file.kind, path: file.path } });
      toast('删掉了');
      void useModelStore.getState().load();
      void useComfyStore.getState().loadOptions();
    } catch (err) {
      failed(err);
    }
  };

  const shown: (ModelTransfer & { local?: boolean })[] = [
    ...transfers,
    ...waiting.map((item): ModelTransfer & { local: boolean } => ({ id: item.id, way: 'upload', kind: item.kind, path: item.folder ? `${item.folder}/${item.name}` : item.name, done: 0, total: item.file.size, state: 'queued', local: true })),
  ];
  const sendingFromHere = waiting.length > 0 || transfers.some((one) => one.way === 'upload' && one.state === 'running');

  return (
    <>
      <div className="st-head">
        <div>
          <h2>AutoDL 上的模型</h2>
          <p>
            往 AutoDL 那台传底模、LoRA 这些，传完出图设置里就能选。从电脑传，速度看你这边的上传带宽；给链接让那台自己下，它连得上 HuggingFace 的国内镜像和 ModelScope，连不上 Civitai 和 HuggingFace
            本站，Civitai 上的先下到电脑再传。那台上原有的模型是 AutoDL 公共模型库的，只读，这里不列。
          </p>
        </div>
      </div>

      {autodl?.state === 'unset' ? (
        <p className="muted">
          先在 <Link to={{ hash: 'comfy' }}>ComfyUI</Link> 一节填 AutoDL 的开发者 Token、选好实例。
        </p>
      ) : (
        <>
          <section className="card editor mx-head" data-od-id="autodl-models-head">
            <div className="mx-state">
              <AutodlStateView autodl={autodl} where="settings" />
              {running && remote && <span className="meta">那台还剩 <b className="mono">{sizeText(remote.free)}</b></span>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" id="mxUpload" onClick={() => setForm('upload')}>
                <Icon name="upload" />
                从电脑传…
              </button>
              <button type="button" className="btn btn-secondary btn-sm" id="mxDownload" onClick={() => setForm('download')}>
                <Icon name="download" />
                给链接下…
              </button>
            </div>
          </section>

          {shown.length > 0 && (
            <div className="sx-list" data-od-id="autodl-transfers">
              <h3 className="sx-sub">传输</h3>
              {sendingFromHere && <p className="hint">从电脑传的，传完前别关这个页面，关了就断了。</p>}
              {[...shown].reverse().map((one) => (
                <TransferRow key={one.id} transfer={one} />
              ))}
            </div>
          )}

          {running && listError && <p className="hint is-error">{listError}</p>}
          {running && remote && (
            <div className="sx-list" data-od-id="autodl-files">
              <h3 className="sx-sub">自己传的</h3>
              {!remote.files.length && <p className="muted">还没有。点上面「从电脑传」或「给链接下」。</p>}
              {MODEL_KINDS.map(({ kind, label }) => {
                const files = remote.files.filter((file) => file.kind === kind);
                if (!files.length) return null;
                return (
                  <div className="mx-group" key={kind} data-kind={kind}>
                    <span className="mx-kind">{label}</span>
                    {files.map((file) => (
                      <div className="sx-row mx-file" key={file.path} data-file={`${file.kind}:${file.path}`}>
                        <span className="mono mx-name">{file.path}</span>
                        {file.partial && <span className="tag tag-warn">没传完</span>}
                        <span className="grow" />
                        <span className="meta mono">{sizeText(file.bytes)}</span>
                        <span className="meta">{whenDid(file.modifiedAt, '传')}</span>
                        <button type="button" className="btn btn-danger-ghost btn-sm" data-ma="del" onClick={() => void remove(file)}>
                          <Icon name="trash" />
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {form === 'upload' && <UploadDialog onClose={() => setForm(null)} />}
      {form === 'download' && <DownloadDialog onClose={() => setForm(null)} />}
    </>
  );
}

function TransferRow({ transfer }: { transfer: ModelTransfer & { local?: boolean } }) {
  const busy = transfer.state === 'queued' || transfer.state === 'running';
  const share = transfer.total ? Math.min(1, transfer.done / transfer.total) : null;
  return (
    <div className={`sx-row mx-transfer is-${transfer.state}`} data-transfer={transfer.id}>
      <Icon name={transfer.way === 'upload' ? 'upload' : 'download'} />
      <span className="mono mx-name">{transfer.path}</span>
      <span className="meta">{modelKindLabel(transfer.kind)}</span>
      <span className="grow" />
      {transfer.state === 'running' && (
        <span className="mx-bar" aria-hidden="true">
          <i style={{ width: share === null ? '30%' : `${Math.round(share * 100)}%` }} />
        </span>
      )}
      <span className="meta mono">
        {busy || transfer.state === 'done' ? `${sizeText(transfer.done)}${transfer.total ? ` / ${sizeText(transfer.total)}` : ''}` : ''}
      </span>
      <span className={`mx-st${transfer.state === 'failed' ? ' is-error' : ''}`}>{STATE_TEXT[transfer.state]}</span>
      {busy && (
        <button type="button" className="btn btn-ghost btn-sm" data-ma="stop" onClick={() => void useModelStore.getState().stop(transfer.id).catch(failed)}>
          <Icon name="stop" />停
        </button>
      )}
      {transfer.error && <p className="hint is-error mx-error">{transfer.error}</p>}
    </div>
  );
}

// 类型、子文件夹、文件名，两个窗口共用
function WhereFields({ kind, folder, name, onKind, onFolder, onName }: { kind: ModelKind; folder: string; name: string; onKind: (kind: ModelKind) => void; onFolder: (folder: string) => void; onName: (name: string) => void }) {
  return (
    <>
      <label className="field">
        <span className="label">类型</span>
        <select className="select" aria-label="模型类型" value={kind} onChange={(e) => onKind(e.target.value as ModelKind)}>
          {MODEL_KINDS.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">子文件夹</span>
        <input className="input mono" aria-label="子文件夹" placeholder="不写放最外层，比如 IL" value={folder} onChange={(e) => onFolder(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">文件名</span>
        <input className="input mono" aria-label="文件名" value={name} onChange={(e) => onName(e.target.value)} />
      </label>
    </>
  );
}

// 关着的实例这时开机，要等一两分钟；按钮上写着
function useBootText(): string | null {
  const state = useComfyStore((s) => s.autodl?.state);
  return state === 'booting' ? '正在开机…' : null;
}

function UploadDialog({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ModelKind>('lora');
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const boot = useBootText();

  // 先看一眼同名的有没有、空间够不够（关着的先开机），过了才排进去
  const start = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const where = { kind, folder: folder.trim(), name: name.trim(), size: file.size };
      let replace = false;
      try {
        await api('/comfy/autodl/models/check', { method: 'POST', body: where });
      } catch (err) {
        if ((err as ApiError).status !== 409) throw err;
        const ok = await confirmBox({ title: `${(err as Error).message}，换掉吗？`, body: '换掉的话，那台上原来那个传完后就没了。', ok: '换掉' });
        if (!ok) return;
        replace = true;
        await api('/comfy/autodl/models/check', { method: 'POST', body: { ...where, replace } });
      }
      const item: Waiting = { id: crypto.randomUUID(), file, ...where, replace };
      useModelStore.getState().enqueue(item);
      toast(`「${item.name}」排上了，传完前别关这个页面`);
      onClose();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog className="mx-dialog" label="从电脑传" odId="dialog-upload-model" onClose={onClose}>
      <div className="dialog-head">
        <h2>从电脑传</h2>
      </div>
      <div className="dialog-body stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" data-autofocus onClick={() => input.current?.click()}>
            <Icon name="folder" />
            选文件…
          </button>
          {file ? (
            <span className="mono meta">
              {file.name} · {sizeText(file.size)}
            </span>
          ) : (
            <span className="meta">还没选</span>
          )}
          <input
            ref={input}
            type="file"
            hidden
            aria-label="选文件"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setFile(picked);
              if (picked) setName(picked.name);
            }}
          />
        </div>
        <WhereFields kind={kind} folder={folder} name={name} onKind={setKind} onFolder={setFolder} onName={setName} />
        <p className="hint">关着的实例点「传」时先开机。传完前别关这个页面。</p>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn btn-primary" disabled={!file || !name.trim() || busy} onClick={() => void start()}>
          {busy ? (boot ?? '正在看那台…') : '传'}
        </button>
      </div>
    </Dialog>
  );
}

function DownloadDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<ModelKind>('lora');
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState(false);
  const boot = useBootText();

  const start = async () => {
    setBusy(true);
    try {
      const body = { kind, url: url.trim(), folder: folder.trim(), name: name.trim() };
      try {
        await api('/comfy/autodl/models/download', { method: 'POST', body });
      } catch (err) {
        if ((err as ApiError).status !== 409) throw err;
        const ok = await confirmBox({ title: `${(err as Error).message}，换掉吗？`, body: '换掉的话，那台上原来那个下完后就没了。', ok: '换掉' });
        if (!ok) return;
        await api('/comfy/autodl/models/download', { method: 'POST', body: { ...body, replace: true } });
      }
      useModelStore.getState().watch();
      toast('排上了，那台自己下，这个页面能关');
      onClose();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog className="mx-dialog" label="给链接下" odId="dialog-download-model" onClose={onClose}>
      <div className="dialog-head">
        <h2>给链接下</h2>
      </div>
      <div className="dialog-body stack" style={{ gap: 12 }}>
        <label className="field">
          <span className="label">链接</span>
          <input
            className="input mono"
            aria-label="下载链接"
            data-autofocus
            placeholder="HuggingFace 或 ModelScope 的下载链接"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (!named) setName(nameFromUrl(e.target.value));
            }}
          />
        </label>
        <WhereFields
          kind={kind}
          folder={folder}
          name={name}
          onKind={setKind}
          onFolder={setFolder}
          onName={(next) => {
            setNamed(true);
            setName(next);
          }}
        />
        <p className="hint">那台自己下，不占你这边的带宽，页面能关。huggingface.co 的链接会换成国内镜像 hf-mirror.com 再下；Civitai 的那台连不上，先下到电脑再从电脑传。</p>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn btn-primary" disabled={!url.trim() || !name.trim() || busy} onClick={() => void start()}>
          {busy ? (boot ?? '正在看那台…') : '下'}
        </button>
      </div>
    </Dialog>
  );
}
