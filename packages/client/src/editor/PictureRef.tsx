import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { imageThumbUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { PICTURE_REF, pictureNumber } from './document';

// 输入 @ 选图后插进来的小标签，整块当一个字符，删一次就整个删掉
export const PictureRef = Node.create({
  name: PICTURE_REF,
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      imageId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-picture-ref') ?? '',
        renderHTML: (attributes) => ({ 'data-picture-ref': attributes.imageId as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-picture-ref]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PictureTag);
  },
});

function PictureTag({ node }: ReactNodeViewProps) {
  const imageId = String(node.attrs.imageId);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const slots = useCanvasStore((s) => (s.selectedId ? s.nodes[s.selectedId]?.slots : undefined));
  const picture = pictureNumber(imageId, slots ?? []);

  return (
    <NodeViewWrapper as="span" className={`picture-tag${picture ? '' : ' gone'}`} data-testid="picture-tag" contentEditable={false}>
      {picture > 0 && canvasId && <img src={imageThumbUrl(canvasId, imageId)} alt="" draggable={false} />}
      <span>{picture > 0 ? `Picture ${picture}` : '图不在槽位里了'}</span>
    </NodeViewWrapper>
  );
}
