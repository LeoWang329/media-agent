import { directionDraft, type ChatNode, type Message } from '@media-agent/shared';
import { useState } from 'react';
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
  const { fork, star, editPrompt } = useCanvasStore.getState();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
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
        <textarea className="prompt-edit" aria-label="编辑提示词" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="prompt-box-actions">
          <button type="button" onClick={() => setEditing(false)}>取消</button>
          <button
            type="button"
            disabled={draft === text}
            onClick={() => {
              setEditing(false);
              void editPrompt(node.id, message.id, index, draft);
            }}
          >
            保存
          </button>
        </div>
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
          <button
            type="button"
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          >
            编辑
          </button>
          <button type="button" onClick={() => setChecklist(true)}>上传清单</button>
          <button type="button" onClick={() => void fork(node.id, message.id, directionDraft(index, label))}>沿此方向 fork</button>
        </div>
      )}
      {checklist && <UploadChecklist message={message} promptText={text} onClose={() => setChecklist(false)} />}
    </div>
  );
}

// 预留：以后接第三方接口生成的视频挂在提示词框下面，现在什么都不显示
function PromptVideos({ videos }: { videos?: Message['videos'] }) {
  void videos;
  return null;
}
