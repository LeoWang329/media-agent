import { activePath, type ChatNode } from '@media-agent/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { MessageItem } from './MessageItem';

export function ChatPanel() {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const node = useCanvasStore((s) => (s.selectedId ? s.nodes[s.selectedId] : undefined));
  if (!selectedId) return <div className="panel-empty">点画布上的节点，在这里对话</div>;
  if (!node) return <div className="panel-empty">加载中…</div>;
  return <Conversation key={node.id} node={node} />;
}

function Conversation({ node }: { node: ChatNode }) {
  const stream = useCanvasStore((s) => s.streams[node.id]);
  const modelConfigs = useCanvasStore((s) => s.modelConfigs);
  const promptNames = useCanvasStore((s) => s.promptNames);
  const patchNode = useCanvasStore((s) => s.patchNode);
  const list = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const path = activePath(node);
  const busy = Boolean(stream);

  // 用户停在底部时，新消息和流式文字到来就跟着滚到底
  useLayoutEffect(() => {
    if (stickToBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [path.length, stream?.text]);

  return (
    <div className="conversation">
      <header className="panel-header">
        <div className="panel-title">{node.title}</div>
        <div className="row">
          <select aria-label="模型配置" value={node.modelConfigId} onChange={(e) => void patchNode(node.id, { modelConfigId: e.target.value })}>
            {!modelConfigs.some((m) => m.id === node.modelConfigId) && <option value={node.modelConfigId}>（没有选模型配置）</option>}
            {modelConfigs.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.model}</option>
            ))}
          </select>
          <select aria-label="系统提示词" value={node.systemPromptName} onChange={(e) => void patchNode(node.id, { systemPromptName: e.target.value })}>
            {!promptNames.includes(node.systemPromptName) && <option value={node.systemPromptName}>（找不到 {node.systemPromptName}）</option>}
            {promptNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </header>
      <div
        className="messages"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {path.map((message) => (
          <MessageItem
            key={message.id}
            node={node}
            message={message}
            busy={busy}
            streamingText={stream?.assistantId === message.id ? stream.text : undefined}
          />
        ))}
      </div>
      <Composer node={node} busy={busy} />
    </div>
  );
}

function Composer({ node, busy }: { node: ChatNode; busy: boolean }) {
  const { send, stop, patchNode } = useCanvasStore.getState();
  const [text, setText] = useState(node.draft);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  // 没发出的文字过半秒存一次，切换节点再回来还在
  const change = (value: string) => {
    setText(value);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => void patchNode(node.id, { draft: value }), 500);
  };

  const submit = () => {
    if (!text.trim() || busy) return;
    clearTimeout(draftTimer.current);
    setText('');
    void send(node.id, text);
  };

  return (
    <div className="composer">
      <textarea
        aria-label="输入消息"
        value={text}
        placeholder="Enter 发送，Shift+Enter 换行"
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {busy ? (
        <button type="button" onClick={() => void stop(node.id)}>停止</button>
      ) : (
        <button type="button" disabled={!text.trim()} onClick={submit}>发送</button>
      )}
    </div>
  );
}
