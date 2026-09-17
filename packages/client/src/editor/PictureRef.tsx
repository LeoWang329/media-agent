import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { imageThumbUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { PICTURE_REF } from './document';

type PictureRefOptions = {
  nodeId: string | null; // 输入框：编号按这个节点现在的槽位算，调了顺序跟着变
  fixedSlots: string[] | null; // 手动改提示词：编号按这条回复当时带的图算，不跟着槽位变
};

// 句子里引用的图：存的是哪张图，不是死编号。整块当一个字符，删一次就整个删掉
export const PictureRef = Node.create<PictureRefOptions>({
  name: PICTURE_REF,
  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return { nodeId: null, fixedSlots: null };
  },

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

function PictureTag({ node, extension }: ReactNodeViewProps) {
  const { nodeId, fixedSlots } = extension.options as PictureRefOptions;
  const imageId = String(node.attrs.imageId);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const slots = useCanvasStore((s) => fixedSlots ?? (nodeId ? s.nodes[nodeId]?.slots : undefined));
  const name = useCanvasStore((s) => s.detail?.images[imageId]?.originalName ?? '');
  const index = (slots ?? []).indexOf(imageId);
  let title = `${name}：现在是 ${index + 1} 号，调了顺序会自动跟着变`;
  if (fixedSlots) title = index < 0 ? `${name}：不在这条回复带的图里` : `${name}：这条回复里的 ${index + 1} 号`;
  else if (index < 0) title = `${name}：这张图已经从槽位删掉了`;

  return (
    <NodeViewWrapper as="span" className={`ref${index < 0 ? ' is-broken' : ''}`} contentEditable={false} data-img={imageId} data-testid="picture-tag" title={title}>
      {canvasId && <img className="im" src={imageThumbUrl(canvasId, imageId)} alt={name} loading="lazy" draggable={false} />}
      <span className="ref-no">{index >= 0 ? `Picture ${index + 1}` : fixedSlots ? '不在这条回复里' : '已不在槽位'}</span>
    </NodeViewWrapper>
  );
}
