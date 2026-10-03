import { splitTags, type Family, type TagItem } from '@media-agent/shared';
import { Node, type Editor, type JSONContent } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { useMemo, useState } from 'react';
import { TagChip } from './TagChip';
import { useTagChecks } from './tagStore';

// 标签编辑窗里的一个小块：存的是框里这一项原样的写法（含权重），id 用来在文档里找到它，picked 是挑来存片段的
export const TAG_CHIP = 'tagChip';

type ChipOptions = {
  family: Family | null;
  onClick: (id: string, anchor: DOMRect) => void;
};

// 正在拖的小块
export const chipDrag: { id: string | null } = { id: null };

export const chipContent = (raw: string): JSONContent => ({ type: TAG_CHIP, attrs: { raw, id: crypto.randomUUID() } });

// 一项的写法拆回标签：raw 是一项，拆出来就是它自己
export const chipItem = (raw: string): TagItem => splitTags(raw)[0] ?? { raw, name: raw, weight: 1 };

export const TagChipNode = Node.create<ChipOptions>({
  name: TAG_CHIP,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return { family: null, onClick: () => undefined };
  },

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-tag-chip') ?? '',
        renderHTML: (attributes) => ({ 'data-tag-chip': attributes.raw as string }),
      },
      // 复制粘贴进来的小块换一个新的 id
      id: { default: '', rendered: false, parseHTML: () => crypto.randomUUID() },
      picked: { default: false, rendered: false, parseHTML: () => false },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-tag-chip]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes];
  },

  renderText({ node }) {
    return `${node.attrs.raw}, `;
  },

  // 小块里的点击、拖动由小块自己管；拖到哪儿放下由编辑器的 handleDrop 管
  addNodeView() {
    return ReactNodeViewRenderer(ChipView, { stopEvent: ({ event }) => !['dragover', 'dragenter', 'drop'].includes(event.type) });
  },
});

function ChipView({ node, extension }: ReactNodeViewProps) {
  const { family, onClick } = extension.options as ChipOptions;
  const raw = String(node.attrs.raw);
  const id = String(node.attrs.id);
  const item = useMemo(() => chipItem(raw), [raw]);
  const [check] = useTagChecks([item.name], family);
  const [dragging, setDragging] = useState(false);
  const [drop, setDrop] = useState<'l' | 'r' | null>(null);

  return (
    <NodeViewWrapper as="span" className="te-chip-wrap" data-chip-id={id}>
      <TagChip
        item={item}
        check={check}
        unknownText="不认识，照原样用"
        className={`te-chip${node.attrs.picked ? ' is-picked' : ''}${dragging ? ' is-drag' : ''}${drop ? ` is-drop-${drop}` : ''}`}
        draggable
        onDragStart={(e) => {
          chipDrag.id = id;
          setDragging(true);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/x-tag-chip', id);
        }}
        onDragEnd={() => {
          chipDrag.id = null;
          setDragging(false);
        }}
        onDragOver={(e) => {
          if (!chipDrag.id || chipDrag.id === id) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setDrop(e.clientX < rect.left + rect.width / 2 ? 'l' : 'r');
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={() => setDrop(null)}
        onClick={(e) => onClick(id, e.currentTarget.getBoundingClientRect())}
      />
    </NodeViewWrapper>
  );
}

// 文档里这个小块在哪
export function chipPos(editor: Editor, id: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === TAG_CHIP && node.attrs.id === id) found = pos;
    return found === null;
  });
  return found;
}

// 把小块挪到 to（原文档里的位置）：连同它后面那个空格一起挪，到新位置后面也跟一个空格
export function moveChip(editor: Editor, id: string, to: number) {
  const from = chipPos(editor, id);
  if (from === null || to === from || to === from + 1) return;
  const { state } = editor;
  const chip = state.doc.nodeAt(from)!;
  const end = state.doc.textBetween(from + 1, Math.min(from + 2, state.doc.content.size - 1)) === ' ' ? from + 2 : from + 1;
  const tr = state.tr.delete(from, end);
  const at = tr.mapping.map(to);
  tr.insert(at, [chip, state.schema.text(' ')]);
  editor.view.dispatch(tr);
}
