import type { AssetFile } from '@media-agent/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { assetThumbUrl, imageThumbUrl } from '../api';
import { useAssetStore } from '../store/assetStore';
import { MAX_SLOTS, useCanvasStore } from '../store/canvasStore';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';
import { closeRefPicker, insertRef, openAssets, useOverlays } from './overlays';

// 资产库里的图插进句子：不在槽位里的先放进下一个空槽位
export async function referLibraryImage(file: AssetFile) {
  const { selectedId, nodes, detail, place } = useCanvasStore.getState();
  const node = selectedId ? nodes[selectedId] : undefined;
  if (!node) return;
  const inSlot = node.slots.find((id) => detail?.images[id]?.originalPath === file.path);
  if (inSlot) return insertRef(inSlot);
  if (node.slots.length >= MAX_SLOTS) return toast('槽位满了，这张图放不进去，也就没法引用', { tone: 'danger' });
  const [placed] = await place(node.id, [{ path: file.path, name: file.name, mtime: file.mtime }], { quiet: true });
  if (!placed) return;
  if (placed.added) {
    const index = useCanvasStore.getState().nodes[node.id].slots.indexOf(placed.id);
    toast(`${placed.name} 先放进了 ${index + 1} 号槽位`);
  }
  insertRef(placed.id);
}

// 按 @ 或点「引用图片」弹出来的小窗：上面是槽位里的图，下面是资产库里的几张。
// 手动改提示词时只列这条回复带的图：存下的新版本带的还是这些图，别的图引用了也对不上号
export function RefPicker() {
  const anchor = useOverlays((s) => s.refpick);
  const node = useCanvasStore((s) => (s.selectedId ? s.nodes[s.selectedId] : undefined));
  const canvasId = useCanvasStore((s) => s.canvasId);
  const images = useCanvasStore((s) => s.detail?.images);
  const files = useAssetStore((s) => s.files);
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (anchor && !anchor.images) void useAssetStore.getState().load();
  }, [anchor]);

  useLayoutEffect(() => {
    if (!anchor || !box.current) return setPosition(null);
    const { offsetWidth: w, offsetHeight: h } = box.current;
    setPosition({ left: Math.max(8, Math.min(anchor.left, innerWidth - w - 8)), top: Math.max(8, anchor.top - h - 8) });
  }, [anchor, files, node?.slots.length]);

  useEffect(() => {
    if (!anchor) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!box.current?.contains(target) && !target.closest('#btnRef, [data-act="boxRef"]')) closeRefPicker();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [anchor]);

  if (!anchor || !node || !canvasId) return null;
  const fixed = anchor.images;
  const choices = fixed ?? node.slots;
  const inSlots = new Set(node.slots.map((id) => images?.[id]?.originalPath).filter(Boolean));
  const library = (files ?? []).filter((f) => f.supported && !inSlots.has(f.path)).slice(0, 6);

  return (
    <div className="refpick" id="refpick" ref={box} style={position ?? { left: 0, top: 0, visibility: 'hidden' }} data-testid="refpick">
      <h4>{fixed ? '这条回复带的图' : '槽位里的图'}</h4>
      {choices.length ? (
        <div className="refpick-row">
          {choices.map((id, i) => (
            <button
              key={`${i}-${id}`}
              type="button"
              title={`${i + 1} 号：${images?.[id]?.originalName ?? ''}`}
              aria-label={`Picture ${i + 1}`}
              onClick={() => {
                closeRefPicker();
                insertRef(id);
              }}
            >
              <img className="im" src={imageThumbUrl(canvasId, id)} alt="" loading="lazy" draggable={false} />
              <span className="num-badge">{i + 1}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="refpick-note">{fixed ? '这条回复没有带图' : '槽位还是空的'}</p>
      )}
      {!fixed && (
        <>
          <h4>资产库里的图</h4>
          <p className="refpick-note">选了会先放进下一个空槽位（{node.slots.length < MAX_SLOTS ? `${node.slots.length + 1} 号` : '已经满了'}）</p>
          <div className="refpick-row">
            {library.map((file) => (
              <button
                key={file.path}
                type="button"
                title={file.name}
                onClick={() => {
                  closeRefPicker();
                  void referLibraryImage(file);
                }}
              >
                <img className="im" src={assetThumbUrl(file.path, file.mtime)} alt={file.name} loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-more
            onClick={() => {
              closeRefPicker();
              openAssets('ref');
            }}
          >
            <Icon name="image" />
            在资产库里找…
          </button>
        </>
      )}
    </div>
  );
}
