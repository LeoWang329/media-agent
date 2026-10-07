import { downloadFileName, videoDownloadName, type Config, type VideoJob } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { rootOf, useAssetStore } from '../store/assetStore';
import { useCanvasStore } from '../store/canvasStore';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';
import { usePicks } from './imageActions';
import { useOverlays, type DownloadTarget, type VideoDownloadTarget } from './overlays';
import { putVideo } from './videoActions';

// 下载出的图：选文件夹（记住上次），从临时文件夹复制一份过去。那个文件夹不在资产库里时问要不要顺便导入，见 docs/dev-plan.md 5.20

const close = () => useOverlays.setState({ download: null });

export function DownloadDialog() {
  const target = useOverlays((s) => s.download);
  return target ? <Download target={target} /> : null;
}

function Download({ target }: { target: DownloadTarget }) {
  const roots = useAssetStore((s) => s.roots);
  const [folder, setFolder] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState(true);
  const [saving, setSaving] = useState(false);
  const inLibrary = Boolean(folder && rootOf(roots, folder));
  const count = target.items.length;

  // 上次下载到哪：读回来之前已经选好文件夹的，不盖掉
  useEffect(() => {
    void (async () => {
      await useAssetStore.getState().load();
      const config = await api<Config>('/config').catch(() => null);
      setFolder((picked) => picked ?? config?.lastDownloadFolder ?? null);
      setLoaded(true);
    })();
  }, []);

  const pick = async () => {
    try {
      const { path } = await api<{ path: string | null }>('/assets/pick-folder', { method: 'POST', body: { start: folder ?? undefined } });
      if (path) setFolder(path);
    } catch (err) {
      toast((err as Error).message, { tone: 'danger', ms: 4500 });
    }
  };

  const save = async () => {
    if (!folder) return;
    setSaving(true);
    try {
      const canvasId = useCanvasStore.getState().canvasId;
      const items = target.items.map(({ nodeId, messageId, jobId, index }) => ({ canvasId, nodeId, messageId, jobId, index }));
      const result = await trackWrite(api<{ paths: string[]; inLibrary: boolean }>('/images/download', { method: 'POST', body: { items, folder } }));
      const imported = !result.inLibrary && importing;
      if (imported) await useAssetStore.getState().addFolder(folder);
      new Set(target.items.map((item) => item.jobId)).forEach((jobId) => usePicks.getState().drop(jobId));
      close();
      toast(`下载了 ${result.paths.length} 张到 ${folder}${imported ? '，这个文件夹也导入资产库了' : ''}`, { ms: 4000 });
    } catch (err) {
      toast((err as Error).message, { tone: 'danger', ms: 4500 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog style={{ width: 'min(520px, calc(100vw - 32px))' }} label="下载" odId="dialog-download" onClose={close}>
      <div className="dialog-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>下载 {count} 张图</h2>
          <span className="meta">从临时文件夹复制一份过去，下载过的才能放进视频节点的槽位</span>
        </div>
      </div>
      <div className="dialog-body">
        <div className="field">
          <span className="label">存到</span>
          <div className="dl-folder">
            {folder ? (
              <>
                <span className="mono">{folder}</span>
                {inLibrary ? (
                  <span className="tag tag-ok">
                    <Icon name="check" />
                    在资产库里
                  </span>
                ) : (
                  <span className="tag tag-warn">不在资产库里</span>
                )}
              </>
            ) : (
              <span className="meta">{loaded ? '还没选过文件夹' : '正在读…'}</span>
            )}
            <span className="grow" />
            <button type="button" className="btn btn-secondary btn-sm" data-dl="pick" onClick={() => void pick()}>
              <Icon name="folder" />
              {folder ? '换个文件夹…' : '选个文件夹…'}
            </button>
          </div>
          {folder &&
            (inLibrary ? (
              <p className="hint">上次存的就是这里。</p>
            ) : (
              <>
                <label className="switch" style={{ marginTop: 6 }}>
                  <input type="checkbox" id="dlImport" checked={importing} onChange={(e) => setImporting(e.target.checked)} />
                  <span className="track" />
                  顺便把这个文件夹导入资产库
                </label>
                <p className="hint">不导入也能存，只是视频节点选图时在资产库里看不到它们。</p>
              </>
            ))}
        </div>
        <div className="dl-names">
          {target.items.map((item) => (
            <div className="mono" key={`${item.jobId}:${item.index}`}>
              {downloadFileName(target.title, item.seed)}
            </div>
          ))}
        </div>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" onClick={close}>
          取消
        </button>
        <button type="button" className="btn btn-primary" data-dl="ok" disabled={!folder || saving} onClick={() => void save()}>
          <Icon name="download" />
          下载
        </button>
      </div>
    </Dialog>
  );
}

// 下载一条视频，见 docs/dev-plan.md 5.28：选文件夹（和出的图共用上次那个），复制一份过去。视频不进资产库，不问要不要导入
const closeVideo = () => useOverlays.setState({ videoDownload: null });

export function VideoDownloadDialog() {
  const target = useOverlays((s) => s.videoDownload);
  return target ? <VideoDownload target={target} /> : null;
}

function VideoDownload({ target }: { target: VideoDownloadTarget }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<Config>('/config')
      .then((config) => setFolder((picked) => picked ?? config.lastDownloadFolder ?? null))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const pick = async () => {
    try {
      const { path } = await api<{ path: string | null }>('/assets/pick-folder', { method: 'POST', body: { start: folder ?? undefined } });
      if (path) setFolder(path);
    } catch (err) {
      toast((err as Error).message, { tone: 'danger', ms: 4500 });
    }
  };

  const save = async () => {
    if (!folder) return;
    setSaving(true);
    try {
      const { nodeId, messageId, jobId } = target;
      const item = { canvasId: useCanvasStore.getState().canvasId, nodeId, messageId, jobId };
      const result = await trackWrite(api<{ path: string }>('/videos/download', { method: 'POST', body: { item, folder } }));
      const job = useCanvasStore.getState().nodes[nodeId]?.messages[messageId]?.videos?.find((j) => j.id === jobId);
      if (job) putVideo({ nodeId, messageId }, { ...job, savedPath: result.path } satisfies VideoJob);
      closeVideo();
      toast(`下载到了 ${result.path}`, { ms: 4000 });
    } catch (err) {
      toast((err as Error).message, { tone: 'danger', ms: 4500 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog style={{ width: 'min(520px, calc(100vw - 32px))' }} label="下载视频" odId="dialog-video-download" onClose={closeVideo}>
      <div className="dialog-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>下载视频</h2>
          <span className="meta">从临时文件夹复制一份过去</span>
        </div>
      </div>
      <div className="dialog-body">
        <div className="field">
          <span className="label">存到</span>
          <div className="dl-folder">
            {folder ? <span className="mono">{folder}</span> : <span className="meta">{loaded ? '还没选过文件夹' : '正在读…'}</span>}
            <span className="grow" />
            <button type="button" className="btn btn-secondary btn-sm" data-dl="pick" onClick={() => void pick()}>
              <Icon name="folder" />
              {folder ? '换个文件夹…' : '选个文件夹…'}
            </button>
          </div>
        </div>
        <div className="dl-names">
          <div className="mono">{videoDownloadName(target.title, target.seed)}</div>
        </div>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" onClick={closeVideo}>
          取消
        </button>
        <button type="button" className="btn btn-primary" data-dl="ok" disabled={!folder || saving} onClick={() => void save()}>
          <Icon name="download" />
          下载
        </button>
      </div>
    </Dialog>
  );
}
