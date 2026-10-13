import type { JSONContent } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { splitBlock } from '@tiptap/pm/commands';
import { useEditor, type Editor } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import { textToDoc } from './document';
import { PictureRef } from './PictureRef';

type Options = {
  initialText: string;
  slots: string[]; // 开头文字里的 <Picture N> 按它还原成图片标签
  nodeId?: string; // 标签编号按这个节点现在的槽位算；不传就一直按 slots 编号（手动改一条回复的提示词）
  ariaLabel: string;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
  className: string;
  placeholder?: string;
  autofocus?: boolean; // 打开就把光标放在开头，照原型
  onChange?: (doc: JSONContent) => void;
  onEnter?: () => void; // 传了就拦下 Enter（输入框用来发送），Shift+Enter 还是换行
  onAt?: (editor: Editor, typedAt: boolean) => void; // 按了 @，弹引用图片的小窗；typedAt：@ 已经打进去了
  onEscape?: () => void;
};

// 只有段落和文字的纯文本编辑器，外加图片标签
export function usePictureEditor(options: Options): Editor | null {
  const latest = useRef(options);
  latest.current = options;
  const self = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      PictureRef.configure({ nodeId: options.nodeId ?? null, fixedSlots: options.nodeId ? null : options.slots }),
      UndoRedo,
      Placeholder.configure({ placeholder: () => latest.current.placeholder ?? '' }),
    ],
    content: textToDoc(options.initialText, options.slots),
    autofocus: false,
    editorProps: {
      attributes: {
        class: options.className, 'aria-label': options.ariaLabel, role: 'textbox', 'aria-multiline': 'true',
        ...(options.ariaLabelledby && { 'aria-labelledby': options.ariaLabelledby }),
        ...(options.ariaDescribedby && { 'aria-describedby': options.ariaDescribedby }),
      },
      // 按 @ 不打出这个字，直接弹小窗；输入法打出来的 @ 也弹，插图时再删掉它
      handleTextInput: (_view, _from, _to, text) => {
        if ((text === '@' || text === '＠') && self.current) latest.current.onAt?.(self.current, true);
        return false;
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing || view.composing) return false;
        if (event.key === '@' && latest.current.onAt && self.current) {
          latest.current.onAt(self.current, false);
          return true;
        }
        if (event.key === 'Escape') latest.current.onEscape?.();
        if (event.key !== 'Enter' || !latest.current.onEnter) return false;
        if (event.shiftKey) return splitBlock(view.state, view.dispatch);
        latest.current.onEnter();
        return true;
      },
    },
    onUpdate: ({ editor }) => latest.current.onChange?.(editor.getJSON()),
  });
  self.current = editor;

  // 挂上 DOM 之后才能真的聚焦；点「手动改」那一帧焦点还在按钮上，等这一帧过去再抢回来
  useEffect(() => {
    if (!latest.current.autofocus || !editor) return;
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed && document.activeElement !== editor.view.dom) editor.commands.focus('start');
    });
    return () => cancelAnimationFrame(frame);
  }, [editor]);

  return editor;
}
