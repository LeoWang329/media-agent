import { referencedPictures, type Message } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { api, imageThumbUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';

type ChecklistPath = { path: string; kind: 'original' | 'canvas'; note?: string };

// 5.7：这条消息当时的每张图该传哪个文件，和提示词一起复制出去用
export function UploadChecklist({ message, promptText, onClose }: { message: Message; promptText: string; onClose: () => void }) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const images = useCanvasStore((s) => s.detail?.images);
  const [paths, setPaths] = useState<Record<string, ChecklistPath>>({});
  const [copied, setCopied] = useState('');
  const slots = message.slotSnapshot;
  const used = referencedPictures(promptText);
  const missing = used.filter((n) => n < 1 || n > slots.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let dropped = false;
    Promise.all(slots.map(async (id) => [id, await api<ChecklistPath>(`/canvases/${canvasId}/images/${id}/checklist-path`)] as const))
      .then((entries) => {
        if (!dropped) setPaths(Object.fromEntries(entries));
      })
      .catch((err: Error) => useCanvasStore.setState({ error: err.message }));
    return () => {
      dropped = true;
    };
  }, [canvasId, message.id]);

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(''), 1500);
  };

  return (
    <div className="picker-backdrop" onPointerDown={onClose}>
      <div className="checklist" role="dialog" aria-label="上传清单" onPointerDown={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span>上传清单</span>
          <span className="checklist-head-actions">
            <button type="button" onClick={() => void copy(promptText, 'prompt')}>{copied === 'prompt' ? '已复制' : '复制提示词'}</button>
            <button type="button" onClick={onClose}>关闭</button>
          </span>
        </div>
        {missing.length > 0 && (
          <p className="checklist-warning">提示词里引用了 {missing.map((n) => `<Picture ${n}>`).join('、')}，可这条消息只有 {slots.length} 张图。</p>
        )}
        <div className="checklist-rows">
          {slots.length === 0 && <p className="muted">这条消息没有参考图。</p>}
          {slots.map((imageId, i) => {
            const image = images?.[imageId];
            const row = paths[imageId];
            return (
              <div className="checklist-row" key={imageId} data-testid="checklist-row">
                {canvasId && <img src={imageThumbUrl(canvasId, imageId)} alt="" />}
                <div className="checklist-info">
                  <div className="checklist-title">
                    <b>Picture {i + 1}</b>
                    <span>{image?.originalName ?? ''}</span>
                    {!used.includes(i + 1) && <span className="muted">提示词里没用到</span>}
                  </div>
                  <div className="checklist-path">
                    <span title={row?.path}>{row?.path ?? '读取中…'}</span>
                    {row?.note && <span className="checklist-note">{row.note}</span>}
                  </div>
                </div>
                <div className="checklist-actions">
                  <button type="button" disabled={!row} onClick={() => row && void api('/assets/reveal', { method: 'POST', body: { path: row.path } })}>
                    在资源管理器中显示
                  </button>
                  <button type="button" disabled={!row} onClick={() => row && void copy(row.path, imageId)}>
                    {copied === imageId ? '已复制' : '复制路径'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
