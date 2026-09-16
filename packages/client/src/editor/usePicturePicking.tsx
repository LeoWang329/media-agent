import type { ChatNode } from '@media-agent/shared';
import type { Editor } from '@tiptap/react';
import { useEffect, useState, type ReactNode } from 'react';
import { AssetPicker } from '../components/AssetLibrary';
import { MAX_SLOTS, useCanvasStore } from '../store/canvasStore';
import { PICTURE_REF } from './document';

type Pending = { position: number; imageIds: string[] };

// 打 @ 弹出来的选图，输入框和提示词编辑框共用。
// 点上半部分当前槽位里的图直接插标签；点下半部分资产库里的图，先放进下一个空槽位再插
export function usePicturePicking(node: ChatNode, editor: Editor | null): { onAt: (position: number) => void; picker: ReactNode } {
  const [at, setAt] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  // 等弹窗从页面上撤掉之后再插：这时候抢焦点、放光标才不会被弹窗卸载带回开头
  useEffect(() => {
    if (!pending || !editor) return;
    setPending(null);
    const { position, imageIds } = pending;
    const chain = editor.chain();
    // 把触发弹窗的那个 @ 删掉，在原地插入小标签
    if (editor.state.doc.textBetween(position, position + 1) === '@') chain.deleteRange({ from: position, to: position + 1 });
    chain
      .insertContentAt(position, imageIds.map((imageId) => ({ type: PICTURE_REF, attrs: { imageId } })))
      .setTextSelection(position + imageIds.length) // 每个标签占一个位置，光标落在最后一个后面
      .run();
    // 直接调 view.focus()：Tiptap 的 focus 命令要等下一帧，那之前接着打字会打到开头去
    editor.view.focus();
  }, [pending, editor]);

  const insert = (position: number, imageIds: string[]) => {
    setAt(null);
    if (imageIds.length) setPending({ position, imageIds });
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
