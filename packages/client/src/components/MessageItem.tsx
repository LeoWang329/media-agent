import { formatCost, messageCost, parseReply, versionsOf, type ChatNode, type Message } from '@media-agent/shared';
import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, imageThumbUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { PromptBox } from './PromptBox';

type Props = {
  node: ChatNode;
  message: Message;
  busy: boolean; // 这个节点正在生成
  streamingText?: string; // 这条回复正在生成时，已收到的文字
};

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
});

export function MessageItem({ node, message, busy, streamingText }: Props) {
  return message.role === 'user' ? (
    <UserMessage node={node} message={message} busy={busy} />
  ) : (
    <AssistantMessage node={node} message={message} busy={busy} streamingText={streamingText} />
  );
}

function UserMessage({ node, message, busy }: Props) {
  const { edit, fork } = useCanvasStore.getState();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);

  if (editing) {
    return (
      <div className="message user" data-testid="message-user">
        <textarea className="edit-box" aria-label="编辑消息" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
        <div className="message-footer">
          <button type="button" onClick={() => setEditing(false)}>取消</button>
          <button
            type="button"
            disabled={!text.trim() || busy}
            onClick={() => {
              setEditing(false);
              void edit(node.id, message.id, text);
            }}
          >
            发送
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="message user" data-testid="message-user">
      {message.systemNote && <div className="system-note">{message.systemNote}</div>}
      <div className="bubble">{message.text}</div>
      <Attachments message={message} />
      <div className="message-footer">
        <Versions node={node} message={message} busy={busy} />
        <div className="message-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setText(message.text);
              setEditing(true);
            }}
          >
            编辑
          </button>
          <button type="button" onClick={() => void fork(node.id, message.id)}>从这里 fork</button>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ node, message, busy, streamingText }: Props) {
  const { regenerate, fork } = useCanvasStore.getState();
  const streaming = streamingText !== undefined;
  const text = streaming ? streamingText : message.text;

  return (
    <div className="message assistant" data-testid="message-assistant">
      {message.error ? (
        <div className="message-error">
          <div>生成失败：{message.error}</div>
          <button type="button" disabled={busy} onClick={() => void regenerate(node.id, message.id)}>重试</button>
        </div>
      ) : (
        parseReply(text).segments.map((segment, i) => {
          if (segment.type === 'text') return <Markdown key={i} text={segment.text} />;
          if (segment.closed || streaming) {
            return (
              <PromptBox key={i} node={node} message={message} index={segment.index} label={segment.label} text={segment.text} pending={!segment.closed} />
            );
          }
          // 回复已经结束但框没有收尾，照原样显示
          return (
            <div key={i} className="plain-text">
              {`<prompt${segment.label ? ` label="${segment.label}"` : ''}>\n${segment.text}`}
            </div>
          );
        })
      )}
      {streaming && !text && <div className="muted">生成中…</div>}
      {!streaming && !message.error && <ReplyMeta message={message} />}
      <div className="message-footer">
        <Versions node={node} message={message} busy={busy} />
        {!streaming && (
          <div className="message-actions">
            <button type="button" disabled={busy} onClick={() => void regenerate(node.id, message.id)}>重新生成</button>
            <button type="button" onClick={() => void fork(node.id, message.id)}>从这里 fork</button>
          </div>
        )}
      </div>
    </div>
  );
}

// 回复角落：用的哪个模型、哪套系统提示词（点开看当时那一版）、花了多少 token 和钱
function ReplyMeta({ message }: { message: Message }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const pricing = useCanvasStore((s) => s.modelConfigs.find((m) => m.id === message.modelConfigId)?.pricing);
  if (!message.modelName && !message.systemPromptName) return null;
  const cost = message.usage && pricing ? messageCost(message.usage, pricing) : null;

  const open = async () => {
    const { text } = await api<{ text: string }>(`/prompts/${encodeURIComponent(message.systemPromptName!)}/history/${message.systemPromptHash}`);
    setPrompt(text);
  };

  return (
    <div className="reply-meta muted">
      {message.modelName && <span>{message.modelName}</span>}
      {message.systemPromptName &&
        (message.systemPromptHash ? (
          <button type="button" className="link" onClick={() => void open()}>{message.systemPromptName}</button>
        ) : (
          <span>{message.systemPromptName}</span>
        ))}
      {message.usage && (
        <span>
          {message.usage.promptTokens} + {message.usage.completionTokens} tokens
          {message.usage.cachedTokens ? `（命中缓存 ${message.usage.cachedTokens}）` : ''}
        </span>
      )}
      {cost !== null && <span>{formatCost(cost, pricing!.currency)}</span>}
      {prompt !== null && <TextModal title={`发这条时的系统提示词：${message.systemPromptName}`} text={prompt} onClose={() => setPrompt(null)} />}
    </div>
  );
}

function TextModal({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="picker-backdrop" onPointerDown={onClose}>
      <div className="text-modal" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span>{title}</span>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <pre className="readonly-text">{text}</pre>
      </div>
    </div>
  );
}

// 这条消息实际发给模型的图，带编号
function Attachments({ message }: { message: Message }) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  if (!message.attachments?.length || !canvasId) return null;
  return (
    <div className="attachments">
      {message.attachments.map((a) => (
        <figure key={a.picture} className="attachment">
          <img src={imageThumbUrl(canvasId, a.imageId)} alt={`Picture ${a.picture}`} />
          <figcaption>{a.picture}</figcaption>
        </figure>
      ))}
    </div>
  );
}

// 同一位置有多个版本时显示 ‹ 1/2 ›
function Versions({ node, message, busy }: Omit<Props, 'streamingText'>) {
  const switchVersion = useCanvasStore((s) => s.switchVersion);
  const versions = versionsOf(node, message);
  if (versions.length < 2) return null;
  const index = versions.findIndex((v) => v.id === message.id);
  return (
    <span className="versions">
      <button type="button" aria-label="上一个版本" disabled={busy || index === 0} onClick={() => void switchVersion(node.id, versions[index - 1].id)}>‹</button>
      <span>{index + 1}/{versions.length}</span>
      <button type="button" aria-label="下一个版本" disabled={busy || index === versions.length - 1} onClick={() => void switchVersion(node.id, versions[index + 1].id)}>›</button>
    </span>
  );
}
