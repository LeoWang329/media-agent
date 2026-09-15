import { directionDraft } from '@media-agent/shared';
import { useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';

type Props = {
  nodeId: string;
  messageId: string;
  index: number;
  label?: string;
  text: string;
  pending: boolean; // 还没收到 </prompt>
};

export function PromptBox({ nodeId, messageId, index, label, text, pending }: Props) {
  const fork = useCanvasStore((s) => s.fork);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`prompt-box${pending ? ' pending' : ''}`} data-testid="prompt-box">
      <div className="prompt-box-head">
        <span>{label ?? '提示词'}</span>
        {pending && <span className="muted">生成中…</span>}
      </div>
      <div className="prompt-box-text">{text}</div>
      {!pending && (
        <div className="prompt-box-actions">
          <button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</button>
          <button type="button" onClick={() => void fork(nodeId, messageId, directionDraft(index, label))}>沿此方向 fork</button>
        </div>
      )}
    </div>
  );
}
