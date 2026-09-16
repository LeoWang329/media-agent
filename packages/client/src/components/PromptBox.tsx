import { directionDraft, type ChatNode, type Message } from '@media-agent/shared';
import { EditorContent } from '@tiptap/react';
import { useState } from 'react';
import { docPictures, docToText } from '../editor/document';
import { usePictureEditor } from '../editor/usePictureEditor';
import { usePicturePicking } from '../editor/usePicturePicking';
import { useCanvasStore } from '../store/canvasStore';
import { UploadChecklist } from './UploadChecklist';

type Props = {
  node: ChatNode;
  message: Message;
  index: number;
  label?: string;
  text: string;
  pending: boolean; // 还没收到 </prompt>
};

export function PromptBox({ node, message, index, label, text, pending }: Props) {
  const { fork, star } = useCanvasStore.getState();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [checklist, setChecklist] = useState(false);
  const starred = Boolean(message.stars?.includes(index));

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (editing) {
    return (
      <div className="prompt-box" data-testid="prompt-box">
        <div className="prompt-box-head">
          <span>{label ?? '提示词'}</span>
        </div>
        <PromptEdit node={node} message={message} index={index} text={text} onClose={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className={`prompt-box${pending ? ' pending' : ''}${starred ? ' starred' : ''}`} data-testid="prompt-box">
      <div className="prompt-box-head">
        <span>{label ?? '提示词'}</span>
        {pending && <span className="muted">生成中…</span>}
        {starred && !pending && <span className="prompt-star">★</span>}
      </div>
      <div className="prompt-box-text">{text}</div>
      <PromptVideos videos={message.videos} />
      {!pending && (
        <div className="prompt-box-actions">
          <button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</button>
          <button type="button" aria-label={starred ? '取消星标' : '星标'} onClick={() => void star(node.id, message.id, index, !starred)}>
            {starred ? '★' : '☆'}
          </button>
          <button type="button" onClick={() => setEditing(true)}>编辑</button>
          <button type="button" onClick={() => setChecklist(true)}>上传清单</button>
          <button type="button" onClick={() => void fork(node.id, message.id, directionDraft(index, label))}>沿此方向 fork</button>
        </div>
      )}
      {checklist && <UploadChecklist message={message} promptText={text} onClose={() => setChecklist(false)} />}
    </div>
  );
}

// 手动改提示词：图片小标签照样能用，保存时按当前槽位写回 <Picture N>
function PromptEdit({ node, message, index, text, onClose }: Pick<Props, 'node' | 'message' | 'index' | 'text'> & { onClose: () => void }) {
  const editPrompt = useCanvasStore((s) => s.editPrompt);
  const [draft, setDraft] = useState(text);

  const editor = usePictureEditor({
    initialText: text,
    slots: node.slots,
    ariaLabel: '编辑提示词',
    className: 'prompt-edit',
    autofocus: true,
    onAt: (position) => onAt(position),
    onChange: (doc) => setDraft(docToText(doc, node.slots)),
  });

  const { onAt, picker } = usePicturePicking(node, editor);

  const save = () => {
    if (!editor) return;
    const doc = editor.getJSON();
    if (docPictures(doc).some((imageId) => !node.slots.includes(imageId))) {
      useCanvasStore.setState({ error: '有小标签指的图已经不在槽位里了，先删掉它再保存' });
      return;
    }
    onClose();
    void editPrompt(node.id, message.id, index, docToText(doc, node.slots));
  };

  return (
    <>
      <EditorContent editor={editor} />
      <div className="prompt-box-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="button" disabled={draft === text} onClick={save}>保存</button>
      </div>
      {picker}
    </>
  );
}

// 预留：以后接第三方接口生成的视频挂在提示词框下面，现在什么都不显示
function PromptVideos({ videos }: { videos?: Message['videos'] }) {
  void videos;
  return null;
}
