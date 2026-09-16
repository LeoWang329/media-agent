import { aspectRatioText, imageSizeFits, isSupportedImageName, type AspectRatio, type ChatNode } from '@media-agent/shared';
import { useState, type DragEvent } from 'react';
import { ASSET_DRAG_TYPE, imageThumbUrl, SLOT_DRAG_TYPE } from '../api';
import { MAX_SLOTS, useCanvasStore } from '../store/canvasStore';
import { AssetPicker } from './AssetLibrary';

const DURATIONS = Array.from({ length: 12 }, (_, i) => i + 4);
const ASPECT_RATIOS: AspectRatio[] = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

// 输入框上方：9 个槽位，右边是时长和比例
export function SlotStrip({ node }: { node: ChatNode }) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const images = useCanvasStore((s) => s.detail?.images);
  const placing = useCanvasStore((s) => s.placing);
  const { placeImages, placeFiles, removeSlot, moveSlot, patchNode } = useCanvasStore.getState();
  const [over, setOver] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null); // 正在给哪个槽位选图

  const accepts = (e: DragEvent) =>
    e.dataTransfer.types.includes(ASSET_DRAG_TYPE) || e.dataTransfer.types.includes(SLOT_DRAG_TYPE) || e.dataTransfer.types.includes('Files');

  // index 是放下时鼠标所在的槽位：资产库的图放在已有图的槽位上就替换它，槽位之间拖动是调顺序
  const drop = (e: DragEvent, index?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    const assets = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    const from = e.dataTransfer.getData(SLOT_DRAG_TYPE);
    const dropped = [...e.dataTransfer.files];
    const files = dropped.filter((file) => isSupportedImageName(file.name));
    if (files.length) {
      void placeFiles(node.id, files, index);
    } else if (dropped.length) {
      useCanvasStore.setState({ error: '只支持 jpg、jpeg、png、webp 格式的图片' });
    } else if (assets) {
      void placeImages(node.id, JSON.parse(assets) as string[], index);
    } else if (from !== '') {
      const to = index === undefined || index >= node.slots.length ? node.slots.length - 1 : index;
      if (Number(from) !== to) void moveSlot(node.id, Number(from), to);
    }
  };

  const dragOver = (e: DragEvent, index?: number) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(SLOT_DRAG_TYPE) ? 'move' : 'copy';
    if (index !== undefined) setOver(index);
  };

  return (
    <>
      <div className="slot-area">
        <div className="slot-strip" data-testid="slot-strip" onDragOver={(e) => dragOver(e)} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e)}>
          {Array.from({ length: MAX_SLOTS }, (_, i) => {
            const imageId = node.slots[i];
            const image = imageId ? images?.[imageId] : undefined;
            const misfit = image ? !imageSizeFits(image.width, image.height) : false;
            // 点空槽位弹出来的是第一个空位：槽位中间不留空，点右边的空格子也只能填到那里
            const target = imageId ? i : Math.min(i, node.slots.length);
            return (
              <div
                key={i}
                className={`slot${imageId ? ' filled' : ''}${misfit ? ' misfit' : ''}${over === i ? ' over' : ''}${picking === i ? ' picked' : ''}`}
                data-testid="slot"
                title={image ? `${image.originalName}${misfit ? '（尺寸不符）' : ''}` : undefined}
                draggable={Boolean(imageId)}
                onClick={() => setPicking(target)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(SLOT_DRAG_TYPE, String(i));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => dragOver(e, i)}
                onDrop={(e) => drop(e, i)}
              >
                {!imageId && i === node.slots.length && <span className="slot-next">+</span>}
                {imageId && canvasId && (
                  <>
                    <img src={imageThumbUrl(canvasId, imageId)} alt="" draggable={false} />
                    <span className="slot-number">{i + 1}</span>
                    {misfit && <span className="slot-misfit">尺寸不符</span>}
                    <button
                      type="button"
                      className="slot-remove"
                      aria-label={`删除 ${i + 1} 号图`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeSlot(node.id, i);
                      }}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="slot-settings">
          <select aria-label="视频时长" value={node.duration} onChange={(e) => void patchNode(node.id, { duration: Number(e.target.value) })}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>{d} 秒</option>
            ))}
          </select>
          <select aria-label="画面比例" value={node.aspectRatio} onChange={(e) => void patchNode(node.id, { aspectRatio: e.target.value as AspectRatio })}>
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>{aspectRatioText(r)}</option>
            ))}
          </select>
        </div>
      </div>
      {placing > 0 && <div className="placing muted">正在放入 {placing} 张图…</div>}
      {picking !== null && (
        <AssetPicker
          title={node.slots[picking] ? `替换 ${picking + 1} 号` : `放进 ${picking + 1} 号`}
          node={node}
          onPick={(paths) => {
            setPicking(null);
            void placeImages(node.id, paths, picking);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}
