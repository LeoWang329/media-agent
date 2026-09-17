import { referencedPictures, type CanvasImage, type ChecklistPath } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { api, imageThumbUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { copyText } from '../ui/copy';
import { Dialog } from '../ui/Dialog';
import { fmtSize } from '../ui/format';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';
import { copyOnlyNote, processedNote } from './imageInfo';
import { useOverlays, type UploadTarget } from './overlays';

export function UploadDialog() {
  const target = useOverlays((s) => s.upload);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const images = useCanvasStore((s) => s.detail?.images);
  const nodeTitle = useCanvasStore((s) => s.detail?.nodes.find((n) => n.id === target?.nodeId)?.title ?? '');
  if (!target || !canvasId) return null;
  return <UploadList canvasId={canvasId} images={images} where={nodeTitle} target={target} onClose={close} />;
}

const close = () => useOverlays.setState({ upload: null });
const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

type Props = { canvasId: string; images: Record<string, CanvasImage> | undefined; where: string; target: UploadTarget; onClose: () => void };

// 上传清单：这条回复当时带的每张图该传哪个文件，按编号顺序。where 写在标题下面，是哪个节点，首页上前面还带画布名
export function UploadList({ canvasId, images, where, target, onClose }: Props) {
  const [paths, setPaths] = useState<Record<string, ChecklistPath>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ids = target.images;

  // 每张图各查各的，一张出错只影响那一行
  useEffect(() => {
    let dropped = false;
    for (const id of new Set(ids)) {
      api<ChecklistPath>(`/canvases/${canvasId}/images/${id}/checklist-path`).then(
        (row) => !dropped && setPaths((all) => ({ ...all, [id]: row })),
        (err: Error) => !dropped && setErrors((all) => ({ ...all, [id]: err.message })),
      );
    }
    return () => {
      dropped = true;
    };
  }, [canvasId, ids]);

  const used = referencedPictures(target.text);
  const missing = used.filter((n) => n < 1 || n > ids.length);
  const unused = ids.map((_, i) => i + 1).filter((n) => !used.includes(n));
  const tags = (numbers: number[]) => numbers.map((n) => `<Picture ${n}>`).join('、');

  const reveal = async (imageId: string, path: string) => {
    try {
      await api(`/canvases/${canvasId}/images/${imageId}/reveal`, { method: 'POST' });
      toast(`已在资源管理器里选中 ${fileName(path)}`);
    } catch (err) {
      toast((err as Error).message, { tone: 'danger' });
    }
  };

  return (
    <Dialog className="dialog-sheet" style={{ width: 'min(780px, calc(100vw - 32px))' }} label="上传清单" odId="dialog-upload-list" onClose={onClose}>
      <div className="dialog-head">
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <h2>上传清单</h2>
          <span className="meta" id="upSub">
            {where} · {target.label || '提示词'} · 共 {ids.length} 张，按编号顺序上传
          </span>
        </div>
        <div className="row">
          <button type="button" className="btn btn-secondary btn-sm" id="upCopyPrompt" onClick={() => copyText(target.text, '已复制提示词')}>
            <Icon name="copy" />
            复制提示词
          </button>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div className="dialog-body" id="upBody">
        {missing.length > 0 && (
          <div className="up-alert is-danger">
            <Icon name="alert" />
            <div>
              提示词里写了 <b className="mono">{tags(missing)}</b>，但这条只带了 {ids.length} 张图。上传前先改提示词，不然平台会找不到这张图。
            </div>
          </div>
        )}
        {unused.length > 0 && (
          <div className="up-alert is-warn">
            <Icon name="info" />
            <div>
              <b className="mono">{tags(unused)}</b> 在提示词里没用到。可以不传，但编号要保持连续的话还是得传。
            </div>
          </div>
        )}
        <div className="up-list">
          {ids.map((id, i) => {
            const image = images?.[id];
            const row = paths[id];
            const isUsed = used.includes(i + 1);
            const processed = image?.processed ? processedNote(image) : null;
            // 传哪个文件以服务端查到的为准；还没查回来时先按画布里记的猜
            const useCopy = row ? row.kind === 'canvas' : Boolean(image && copyOnlyNote(image));
            let tag;
            let note;
            if (errors[id]) {
              tag = <span className="tag tag-danger">找不到文件</span>;
              note = errors[id];
            } else if (processed) {
              tag = <span className="tag tag-warn">传处理过的副本</span>;
              // 从电脑里拖进来的图没有原路径
              note = image!.originalPath ? (
                <>
                  {processed}。原文件在 <span className="mono">{image!.originalPath}</span>，不要传它
                </>
              ) : (
                processed
              );
            } else if (useCopy && image?.originalPath) {
              tag = <span className="tag tag-danger">原文件不在了，传程序存的副本</span>;
              note = (
                <>
                  原来在 <s className="mono">{image.originalPath}</s>，已经找不到了
                </>
              );
            } else if (useCopy) {
              tag = <span className="tag">传程序存的副本</span>;
              note = image ? copyOnlyNote(image) : '';
            } else {
              tag = (
                <span className="tag tag-ok">
                  <Icon name="check" />
                  原图
                </span>
              );
              note = image ? `${image.width}×${image.height}${row ? ` · ${fmtSize(row.size)}` : ''}` : '';
            }
            return (
              <div key={`${i}-${id}`} className={`up-row${isUsed ? '' : ' is-unused'}`} data-od-id={`upload-row-${i + 1}`} data-testid="checklist-row">
                <div className="up-num">
                  {i + 1}
                  <small>号</small>
                </div>
                <div className="up-thumb">
                  <img className="im" src={imageThumbUrl(canvasId, id)} alt={image?.originalName ?? ''} loading="lazy" />
                </div>
                <div className="up-info">
                  <div className="up-name">
                    {image?.originalName}
                    {tag}
                    {!isUsed && <span className="tag tag-warn">没用到</span>}
                  </div>
                  <div className="up-path">{row?.path ?? ''}</div>
                  <div className="up-note">{note}</div>
                </div>
                <div className="up-acts">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!row} onClick={() => row && void reveal(id, row.path)}>
                    <Icon name="reveal" />
                    在资源管理器里显示
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!row} onClick={() => row && copyText(row.path, '已复制路径')}>
                    <Icon name="copy" />
                    复制路径
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {!ids.length && (
          <p className="muted" style={{ padding: '28px 0', textAlign: 'center' }}>
            这条提示词没有带参考图，只要复制提示词就行。
          </p>
        )}
      </div>
      <div className="dialog-foot">
        <span className="meta grow" id="upFootNote">
          {ids.length ? `按 1 → ${ids.length} 的顺序传到第三方平台` : ''}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          id="upCopyAll"
          onClick={() => {
            const lines = ids.map((id, i) => `${i + 1}. ${paths[id]?.path ?? ''}`);
            copyText(lines.join('\n'), `已复制 ${lines.length} 个路径`);
          }}
        >
          <Icon name="copy" />
          复制全部路径
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          好了
        </button>
      </div>
    </Dialog>
  );
}
