import { activePath, type ChatNode } from '@media-agent/shared';
import { EditorContent } from '@tiptap/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { docPictures, docToText } from '../editor/document';
import { usePictureEditor } from '../editor/usePictureEditor';
import { usePicturePicking } from '../editor/usePicturePicking';
import { useCanvasStore } from '../store/canvasStore';
import { MessageItem } from './MessageItem';
import { SlotStrip } from './SlotStrip';

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
      <SlotStrip node={node} />
      <Composer node={node} busy={busy} />
    </div>
  );
}

function Composer({ node, busy }: { node: ChatNode; busy: boolean }) {
  const { send, stop, patchNode } = useCanvasStore.getState();
  const [empty, setEmpty] = useState(!node.draft.trim());
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  const editor = usePictureEditor({
    initialText: node.draft,
    slots: node.slots,
    ariaLabel: '输入消息',
    className: 'composer-editor',
    placeholder: 'Enter 发送，Shift+Enter 换行，@ 选图',
    onAt: (position) => onAt(position),
    onEnter: () => submit(),
    // 没发出的文字过半秒存一次，切换节点再回来还在
    onChange: (doc) => {
      const text = docToText(doc, node.slots);
      setEmpty(!text.trim());
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => void patchNode(node.id, { draft: text }), 500);
    },
  });

  const { onAt, picker } = usePicturePicking(node, editor);

  const submit = () => {
    if (!editor || busy) return;
    const doc = editor.getJSON();
    if (docPictures(doc).some((imageId) => !node.slots.includes(imageId))) {
      useCanvasStore.setState({ error: '有小标签指的图已经不在槽位里了，先删掉它再发' });
      return;
    }
    const text = docToText(doc, node.slots);
    if (!text.trim()) return;
    clearTimeout(draftTimer.current);
    editor.commands.clearContent();
    setEmpty(true);
    void send(node.id, text);
  };

  return (
    <div className="composer">
      <EditorContent editor={editor} className="composer-box" />
      {busy ? (
        <button type="button" onClick={() => void stop(node.id)}>停止</button>
      ) : (
        <button type="button" disabled={empty} onClick={submit}>发送</button>
      )}
      {picker}
    </div>
  );
}
