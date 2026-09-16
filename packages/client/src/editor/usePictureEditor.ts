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
  slots: string[]; // 只用来把开头文字里的 <Picture N> 还原成小标签
  ariaLabel: string;
  className: string;
  placeholder?: string;
  autofocus?: boolean;
  onChange?: (doc: JSONContent) => void;
  onEnter?: () => void; // 传了就拦下 Enter（输入框用来发送），Shift+Enter 还是换行
  onAt?: (position: number) => void; // 输入 @ 的位置，用来弹选图窗口
};

// 只有段落和文字的纯文本编辑器，外加图片小标签
export function usePictureEditor(options: Options): Editor | null {
  const latest = useRef(options);
  latest.current = options;

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      PictureRef,
      UndoRedo,
      Placeholder.configure({ placeholder: () => latest.current.placeholder ?? '' }),
    ],
    content: textToDoc(options.initialText, options.slots),
    autofocus: options.autofocus ? 'end' : false,
    editorProps: {
      attributes: { class: `picture-editor ${options.className}`, 'aria-label': options.ariaLabel },
      handleTextInput: (_view, from, _to, text) => {
        if (text === '@') latest.current.onAt?.(from);
        return false;
      },
      handleKeyDown: (view, event) => {
        if (event.key !== 'Enter' || event.isComposing || view.composing || !latest.current.onEnter) return false;
        if (event.shiftKey) return splitBlock(view.state, view.dispatch);
        latest.current.onEnter();
        return true;
      },
    },
    onUpdate: ({ editor }) => latest.current.onChange?.(editor.getJSON()),
  });

  // 挂上 DOM 之后才能真的聚焦；点「编辑」那一帧焦点还在按钮上，等这一帧过去再抢回来
  useEffect(() => {
    if (latest.current.autofocus) requestAnimationFrame(() => editor?.commands.focus('end'));
  }, [editor]);

  return editor;
}
