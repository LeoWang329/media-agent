import type { ChatNode } from '@media-agent/shared';
import type { Editor } from '@tiptap/react';
import { useState, type ReactNode } from 'react';
import { AssetPicker } from '../components/AssetLibrary';
import { MAX_SLOTS, useCanvasStore } from '../store/canvasStore';
import { PICTURE_REF } from './document';

// 打 @ 弹出来的选图，输入框和提示词编辑框共用。
// 点上半部分当前槽位里的图直接插标签；点下半部分资产库里的图，先放进下一个空槽位再插
export function usePicturePicking(node: ChatNode, editor: Editor | null): { onAt: (position: number) => void; picker: ReactNode } {
  const [at, setAt] = useState<number | null>(null);

  // 把触发弹窗的那个 @ 删掉，在原地插入小标签。
  // 等弹窗关掉的那一帧过去再插，不然焦点还在弹窗上，光标会被带回开头
  const insert = (position: number, imageIds: string[]) => {
    setAt(null);
    if (!editor || !imageIds.length) return;
    requestAnimationFrame(() => {
      const chain = editor.chain().focus();
      if (editor.state.doc.textBetween(position, position + 1) === '@') chain.deleteRange({ from: position, to: position + 1 });
      chain
        .insertContentAt(position, imageIds.map((imageId) => ({ type: PICTURE_REF, attrs: { imageId } })))
        .setTextSelection(position + imageIds.length) // 每个标签占一个位置，光标落在最后一个后面
        .run();
    });
  };

  const useAssets = async (position: number, paths: string[]) => {
    setAt(null);
    if (node.slots.length >= MAX_SLOTS) {
      useCanvasStore.setState({ error: '槽位已满' });
      return;
    }
    insert(position, await useCanvasStore.getState().placeImages(node.id, paths));
  };

  return {
    onAt: setAt,
    picker:
      at === null ? null : (
        <AssetPicker
          title="选图插进来"
          node={node}
          onSlot={(index) => insert(at, [node.slots[index]])}
          onPick={(paths) => void useAssets(at, paths)}
          onClose={() => setAt(null)}
        />
      ),
  };
}
