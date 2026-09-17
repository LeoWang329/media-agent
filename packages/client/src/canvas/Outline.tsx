import { activePath, parseReply, type ChatNode, type Message } from '@media-agent/shared';
import { useCanvasStore } from '../store/canvasStore';
import { dayTime } from '../ui/format';
import { Icon } from '../ui/Icon';
import { copiedCount } from './nodeInfo';

// 目录里每一轮后面的小字：回复写了什么
function replyNote(reply: Message | undefined, live: boolean): string {
  if (live) return '正在回复';
  if (!reply) return '';
  if (reply.error) return '请求失败';
  const prompts = parseReply(reply.text).prompts;
  const stopped = reply.stopped ? '已叫停 · ' : '';
  if (!prompts.length) return `${stopped}没有提示词`;
  // 概述开头的 [reference generation] 这类任务类型对找对话没用，去掉
  const first = prompts[0].label || prompts[0].summary.replace(/^\[[^\]]*\]\s*/, '');
  return `${stopped}${prompts.length > 1 ? `${prompts.length} 个方向 · ` : ''}${first}`;
}

// 滚到那条消息，闪一下；复制来的消息收在折叠区里，先展开
function jumpTo(messageId: string) {
  const thread = document.getElementById('thread');
  const target = thread?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  if (!thread || !target) return;
  const folded = target.closest('details');
  if (folded) folded.open = true;
  const top = target.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop - 12;
  thread.scrollTo({ top, behavior: 'smooth' });
  target.classList.remove('is-located');
  void target.offsetWidth;
  target.classList.add('is-located');
}

// 对话目录：贴在面板左边，当前显示的这条路径上每发一次需求算一轮，点一下跳过去
export function Outline({ node, onClose }: { node: ChatNode; onClose: () => void }) {
  const liveId = useCanvasStore((s) => s.streams[node.id]?.assistantId ?? null);
  const path = activePath(node);
  const copied = copiedCount(node, path);
  const rounds = path.flatMap((message, i) => {
    if (message.role !== 'user') return [];
    const next = path[i + 1];
    return [{ user: message, reply: next?.role === 'assistant' ? next : undefined, copied: i < copied }];
  });

  return (
    <nav className="outline" id="outline" aria-label="对话目录" data-od-id="thread-outline">
      <div className="ol-head">
        <span className="panel-title grow">对话目录 · {rounds.length} 轮</span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="收起对话目录" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="ol-list">
        {rounds.map(({ user, reply, copied: fromParent }, i) => {
          const note = replyNote(reply, Boolean(reply && reply.id === liveId) || (!reply && liveId !== null && i === rounds.length - 1));
          return (
            <button key={user.id} type="button" className="ol-item" data-testid="outline-item" title={user.text} onClick={() => jumpTo(user.id)}>
              <span className="ol-no">{i + 1}</span>
              <span className="ol-main">
                <span className="ol-text">{user.text}</span>
                <span className="ol-note">
                  {fromParent ? '复制来的 · ' : ''}
                  {dayTime(user.createdAt)}
                  {note ? ` · ${note}` : ''}
                </span>
              </span>
            </button>
          );
        })}
        {!rounds.length && <p className="ol-empty">还没有对话</p>}
      </div>
    </nav>
  );
}
