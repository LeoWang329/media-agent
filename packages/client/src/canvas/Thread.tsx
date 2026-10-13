import {
  activePath,
  aspectRatioText,
  hasUnsentSettings,
  messageCost,
  formatCost,
  parseReply,
  slotDiff,
  versionsOf,
  type CanvasImage,
  type ChatNode,
  type Message,
} from '@media-agent/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { imageThumbUrl } from '../api';
import { switchChangesSettings, useCanvasStore, type Stream } from '../store/canvasStore';
import { confirmBox } from '../ui/confirm';
import { fmtNum } from '../ui/copy';
import { clock, clockSeconds, dayTime } from '../ui/format';
import { Icon, type IconName } from '../ui/Icon';
import { chatThinkingLevel } from '../ui/thinking';
import { toast } from '../ui/toast';
import { copiedCount, splitError } from './nodeInfo';
import { useOverlays } from './overlays';
import { usePromptInfo } from './imageNode';
import { PromptBox } from './PromptBox';
import { TagBox } from './TagBox';
import { Markdown, tokens } from './tokens';

type Images = Record<string, CanvasImage> | undefined;

// 同一位置的几个版本。失败后重试成功的，失败那条不算一个版本（照原型，重试是把它换掉）；
// 失败以后在它下面接着聊过的照样算，不然那段对话切不回去
const hasFollowUp = (node: ChatNode, messageId: string) => Object.values(node.messages).some((m) => m.parentId === messageId);
export const shownVersions = (node: ChatNode, message: Message) =>
  versionsOf(node, message).filter((v) => v.id === message.id || !(v.role === 'assistant' && v.error && !hasFollowUp(node, v.id)));

const BUSY_HINT = '正在生成，先叫停或等它写完';

// 右侧面板的对话：复制来的消息收在最上面，下面是这个节点自己的
export function Thread({ node, embedded = false, visible = true }: { node: ChatNode; embedded?: boolean; visible?: boolean }) {
  const stream = useCanvasStore((s) => s.streams[node.id]);
  const remote = useCanvasStore((s) => !s.streams[node.id] && Boolean(s.detail?.nodes.find((n) => n.id === node.id)?.generating));
  const images = useCanvasStore((s) => s.detail?.images);
  const parentTitle = useCanvasStore((s) => s.detail?.nodes.find((n) => n.id === node.parentNodeId)?.title);
  const [editing, setEditing] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const mounted = useRef(false);
  const scroller = () => embedded ? list.current?.closest<HTMLElement>('.edit-workspace') : list.current;

  useEffect(() => {
    if (!embedded) return;
    const el = scroller();
    if (!el) return;
    const update = () => { nearBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 80; };
    el.addEventListener('scroll', update);
    return () => el.removeEventListener('scroll', update);
  }, [embedded]);

  const path = activePath(node);
  const copied = copiedCount(node, path);
  const busy = Boolean(stream) || remote;
  const last = path.at(-1);
  // 别的页面在生成（比如刷新过）：最后一条还空着的回复当成正在写
  const liveId = stream ? stream.assistantId : remote && last?.role === 'assistant' && !last.error && !last.stopped ? last.id : null;

  // 打开节点：停在最后一条回复的开头；正在生成时停在最底下
  useLayoutEffect(() => {
    if (!visible) return;
    const el = scroller()!;
    const lastEl = list.current!.lastElementChild as HTMLElement | null;
    if (lastEl?.classList.contains('msg-ai') && !busy) el.scrollTop = Math.max(0, lastEl.offsetTop - el.offsetTop - 12);
    else el.scrollTop = el.scrollHeight;
  }, [visible]);

  // 开始生成时滚到底；之后停在底部才跟着往下走
  useLayoutEffect(() => {
    if (!visible) return;
    const el = scroller();
    if (stream?.assistantId && el) el.scrollTop = el.scrollHeight;
  }, [stream?.assistantId, visible]);

  useLayoutEffect(() => {
    if (!visible) return;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const el = scroller();
    if (nearBottom.current && el) el.scrollTop = el.scrollHeight;
  }, [path.length, stream?.text, last?.text, visible]);

  const render = (message: Message, ro: boolean) =>
    message.role === 'user' ? (
      <UserMessage
        key={message.id}
        node={node}
        message={message}
        ro={ro}
        busy={busy}
        images={images}
        editing={editing === message.id}
        onEdit={(on) => setEditing(on ? message.id : null)}
      />
    ) : (
      <AssistantMessage
        key={message.id}
        node={node}
        message={message}
        ro={ro}
        busy={busy}
        live={message.id === liveId}
        stream={message.id === stream?.assistantId ? stream : undefined}
        images={images}
      />
    );

  return (
    <div
      className={embedded ? 'edit-history' : 'dr-body'}
      id="thread"
      data-od-id="thread"
      data-node-kind={node.kind}
      ref={list}
      onScroll={(e) => {
        const el = e.currentTarget;
        nearBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 80;
      }}
    >
      {copied > 0 && (
        <details className="copied" data-od-id="copied-messages">
          <summary>
            <Icon name="branch" />
            <span className="grow">
              从「{parentTitle ?? '已删除的节点'}」复制来的 {copied} 条消息
            </span>
            <Icon name="chev-down" className="chev" />
          </summary>
          <div className="copied-inner">{path.slice(0, copied).map((m) => render(m, true))}</div>
        </details>
      )}
      {path.slice(copied).map((m) => render(m, false))}
      {!path.length && (
        <div style={{ padding: '48px 12px', textAlign: 'center' }} className="stack">
          <h3>这个节点还没有对话</h3>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            {node.kind === 'edit' ? '选择原图，写下要修改的内容，可连续对话并保存候选。' : '先在下面放参考图、选时长和比例，再写需求发出去。'}
            <br />
            AI 第一次回复时会给节点起标题。
          </p>
        </div>
      )}
    </div>
  );
}

// 同一位置有多个版本时显示 ‹ 1/2 ›；切过去后那时候的槽位、时长、比例跟着回来
function VersionSwitch({ node, message, busy }: { node: ChatNode; message: Message; busy: boolean }) {
  const versions = shownVersions(node, message);
  if (versions.length < 2) return null;
  const index = versions.findIndex((v) => v.id === message.id);

  const go = async (to: number) => {
    if (busy) return toast('正在生成，先叫停或等它写完再切版本', { tone: 'warn' });
    const target = versions[to];
    const settings = switchChangesSettings(node, target.id);
    if (settings && hasUnsentSettings(node)) {
      const note = slotDiff(activePath(node).at(-1)!, node, node.kind).systemNote ?? '';
      const ok = await confirmBox({
        title: '有改动还没发出去',
        body: (
          <>
            当前有没发出去的改动：「{note}」<br />
            <br />
            切到第 {to + 1} 版后，槽位、时长、比例会变回那时候的样子，这些改动就没了。
          </>
        ),
        ok: '仍然切换',
      });
      if (!ok) return;
    }
    const switched = await useCanvasStore.getState().switchVersion(node.id, target.id);
    if (switched && settings) toast(`切到第 ${to + 1} 版，槽位变回那时候的 ${settings.slots.length} 张图`);
  };

  return (
    <span className="ver" title={`同一位置有 ${versions.length} 个版本`}>
      <button type="button" aria-label="上一个版本" disabled={index === 0} onClick={() => void go(index - 1)}>
        <Icon name="chev-left" className="icon-sm" />
      </button>
      <span>
        {index + 1}/{versions.length}
      </span>
      <button type="button" aria-label="下一个版本" disabled={index === versions.length - 1} onClick={() => void go(index + 1)}>
        <Icon name="chev-right" className="icon-sm" />
      </button>
    </span>
  );
}

function Action({ name, label, icon, onClick }: { name: string; label: string; icon: IconName; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm" data-act={name} title={label} onClick={onClick}>
      <Icon name={icon} />
      <span className="lbl">{label}</span>
    </button>
  );
}

type UserProps = {
  node: ChatNode;
  message: Message;
  ro: boolean;
  busy: boolean;
  images: Images;
  editing: boolean;
  onEdit: (on: boolean) => void;
};

function UserMessage({ node, message, ro, busy, images, editing, onEdit }: UserProps) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const imgs = message.slotSnapshot;
  const frames = message.frames ?? [];
  const snapshot = message.mediaSnapshot ?? [];
  const videoCount = snapshot.filter((m) => m.kind === 'video').length;
  const audioCount = snapshot.length - videoCount;
  const mediaCount = [videoCount && `${videoCount} 段视频`, audioCount && `${audioCount} 段音频`].filter(Boolean).join('、');
  if (editing && !ro) return <UserEdit node={node} message={message} busy={busy} onDone={() => onEdit(false)} />;

  return (
    <div className="msg msg-user" data-od-id="msg-user" data-testid="message-user" data-message-id={message.id}>
      <div className="msg-head">
        <span className="msg-role">需求</span>
        <span className="msg-time">{dayTime(message.createdAt)}</span>
        {!ro && <VersionSwitch node={node} message={message} busy={busy} />}
        <div className="msg-actions">
          {!ro && (
            <Action
              name="edit"
              label="改这句"
              icon="edit"
              onClick={() => {
                if (busy) toast(BUSY_HINT, { tone: 'warn' });
                else onEdit(true);
              }}
            />
          )}
          <Action name="fork" label="从这里岔出" icon="branch" onClick={() => void useCanvasStore.getState().fork(node.id, message.id)} />
        </div>
      </div>
      <div className="bubble">
        {message.systemNote && (
          <div className="autonote">
            <span className="tag tag-outline" title="程序在发送时自动附上的说明，不是手打的">
              自动附加
            </span>
            <span>{tokens(message.systemNote, imgs, images)}</span>
          </div>
        )}
        <div className="msg-text">{tokens(message.text, imgs, images)}</div>
        {(imgs.length > 0 || frames.length > 0) && canvasId && (
          <div className="msg-imgs">
            {imgs.map((id, i) => (
              <div key={`${i}-${id}`} className="msg-img" title={`${i + 1} 号：${images?.[id]?.originalName ?? ''}`}>
                <img className="im" src={imageThumbUrl(canvasId, id)} alt={images?.[id]?.originalName ?? ''} loading="lazy" draggable={false} />
                <span className="num-badge">{i + 1}</span>
              </div>
            ))}
            {/* 视频的截帧，见 docs/dev-plan.md 5.31 */}
            {frames.map((frame) => (
              <div key={`video-${frame.video}`} className="msg-img is-frame" title={`<Video ${frame.video}> 截的一帧`} data-testid="message-frame">
                <img className="im" src={imageThumbUrl(canvasId, frame.imageId)} alt="" loading="lazy" draggable={false} />
                <span className="num-badge">视频 {frame.video}</span>
              </div>
            ))}
          </div>
        )}
        <div className="meta" style={{ marginTop: 8 }}>
          这条带了 {imgs.length} 张图
          {mediaCount && ` · ${mediaCount}`}
          {node.kind === 'video' && ` · ${message.duration} 秒 · ${aspectRatioText(message.aspectRatio)}`}
        </div>
      </div>
    </div>
  );
}

// 改这句：只改文字，会多出一个版本。服务端收下了才关编辑框，没发出去时改的字还在
function UserEdit({ node, message, busy, onDone }: { node: ChatNode; message: Message; busy: boolean; onDone: () => void }) {
  const [text, setText] = useState(message.text);
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    if (busy) return toast(BUSY_HINT, { tone: 'warn' });
    const count = versionsOf(node, message).length + 1;
    void useCanvasStore.getState().edit(node.id, message.id, value, () => {
      onDone();
      toast(`改好了，这句现在有 ${count} 个版本，可以来回切`);
    });
  };

  return (
    <div className="msg msg-user msg-edit" data-testid="message-user" data-message-id={message.id}>
      <div className="msg-head">
        <span className="msg-role">改这句</span>
        <span className="meta">改完会多出一个版本，原来的那版和它后面的对话都还在</span>
      </div>
      <textarea
        className="textarea"
        id="editArea"
        aria-label="改这句"
        value={text}
        autoFocus
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        }}
      />
      <p className="hint" style={{ marginTop: 6 }}>
        只改文字。那时候带的 {message.slotSnapshot.length} 张图、{message.duration} 秒、{message.aspectRatio === 'auto' ? '自动' : message.aspectRatio} 照旧。
      </p>
      <div className="row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>
          取消
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={submit}>
          <Icon name="send" />
          发送修改
        </button>
      </div>
    </div>
  );
}

type AssistantProps = {
  node: ChatNode;
  message: Message;
  ro: boolean;
  busy: boolean;
  live: boolean;
  stream: Stream | undefined; // 这个页面正在收的就是这条回复
  images: Images;
};

function AssistantMessage({ node, message, ro, busy, live, stream, images }: AssistantProps) {
  // 框里是视频提示词还是一串标签，看写这条回复时用的系统提示词；中途换了提示词，已有的回复不变
  const writtenWith = usePromptInfo(message.systemPromptName ?? '');
  const text = stream ? stream.text : message.text;
  const reasoning = (stream ? stream.reasoning : message.reasoning) ?? '';
  // 这次发出去开着思考：设置里写提示词的档位不是关，模型配置也支持
  const thinkingOn = useCanvasStore((s) => {
    const level = s.thinking && chatThinkingLevel(s.modelConfigs.find((m) => m.id === message.modelConfigId), s.thinking);
    return Boolean(level && level !== 'off');
  });
  const thinking = thinkingOn || Boolean(reasoning);
  // 想了多久：写完的回复里有；正在写的从回复建好算到第一个正文字
  const thinkingMs = message.thinkingMs ?? (live && thinking && stream?.firstTextAt ? stream.firstTextAt - Date.parse(message.createdAt) : undefined);
  const regenerate = () => {
    if (busy) toast(BUSY_HINT, { tone: 'warn' });
    else void useCanvasStore.getState().regenerate(node.id, message.id);
  };
  const versions = shownVersions(node, message);
  const manual = Boolean(message.editedFromMessageId);
  const handwritten = Boolean(message.handwritten);
  const retried = !manual && !handwritten && versions.findIndex((v) => v.id === message.id) > 0;

  const head = (
    <div className="msg-head">
      <span className="msg-role">{handwritten ? '自己写的' : '回复'}</span>
      <span className="msg-time">{clock(message.createdAt)}</span>
      {manual ? (
        <span className="tag">
          <Icon name="edit" />
          手动修改
        </span>
      ) : (
        retried && <span className="tag">重答</span>
      )}
      {message.stopped && <span className="tag tag-warn">已叫停</span>}
      {!ro && <VersionSwitch node={node} message={message} busy={busy} />}
      <div className="msg-actions">
        {!ro && !manual && !handwritten && !live && <Action name="regen" label="重答" icon="retry" onClick={regenerate} />}
        {!live && !message.error && (
          <Action name="fork" label="从这里岔出" icon="branch" onClick={() => void useCanvasStore.getState().fork(node.id, message.id)} />
        )}
      </div>
    </div>
  );

  if (message.error && !live) {
    const { code, reason } = splitError(message.error);
    return (
      <div className="msg msg-ai" data-od-id="msg-ai" data-testid="message-assistant" data-message-id={message.id}>
        {head}
        <div className="failbox" data-od-id="msg-failed">
          <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <span style={{ color: 'var(--danger)', marginTop: 2 }}>
              <Icon name="warn" />
            </span>
            <div className="grow">
              <p>
                <b>请求失败</b> {code && <span className="mono">{code}</span>}
                {code && ' · '}
                {reason}
              </p>
              <p className="meta" style={{ marginTop: 2 }}>
                {clockSeconds(message.createdAt)} · 失败的这条不会带进之后的对话
              </p>
            </div>
            {!ro && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={regenerate}>
                <Icon name="retry" />
                重试
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 正文出来之前在思考：只显示正在思考和秒数
  if (live && !text && thinking) {
    return (
      <div className="msg msg-ai" data-od-id="msg-ai" data-testid="message-assistant" data-message-id={message.id}>
        {head}
        <ThinkingLive since={message.createdAt} />
      </div>
    );
  }

  const segments = parseReply(text).segments;
  const lastIndex = segments.length - 1;

  return (
    <div className="msg msg-ai" data-od-id="msg-ai" data-testid="message-assistant" data-message-id={message.id}>
      {head}
      {thinkingMs !== undefined && <ThinkingDone ms={thinkingMs} reasoning={reasoning} />}
      {segments.map((segment, i) => {
        if (segment.type === 'text') return <Markdown key={i} text={segment.text} imgs={message.slotSnapshot} images={images} caret={live && i === lastIndex} />;
        if (!segment.closed && !live && !message.stopped) {
          // 回复已经结束但框没有收尾，照原样显示
          return (
            <div key={i} className="intro">
              {`<prompt${segment.label ? ` label="${segment.label}"` : ''}>\n${segment.text}`}
            </div>
          );
        }
        if (writtenWith?.use === 'image' && writtenWith.family !== 'Krea2') {
          return (
            <TagBox
              key={i}
              node={node}
              message={message}
              index={segment.index}
              label={segment.label}
              text={segment.text}
              family={writtenWith.family}
              ro={ro}
              writing={live && !segment.closed}
              incomplete={!live && !segment.closed}
              busy={busy}
            />
          );
        }
        return (
          <PromptBox
            key={i}
            node={node}
            message={message}
            index={segment.index}
            label={segment.label}
            text={segment.text}
            ro={ro}
            writing={live && !segment.closed}
            incomplete={!live && !segment.closed}
            busy={busy}
            versions={versions.length}
            images={images}
          />
        );
      })}
      {live && !text && (
        <div className="intro">
          <span className="caret" />
        </div>
      )}
      <ReplyMeta message={message} live={live} text={text} />
    </div>
  );
}

// 正文出来之前：正在思考，秒数从回复建好时算，每秒走一次
function ThinkingLive({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="think is-live" data-od-id="thinking-live">
      <span className="spinner" />
      <span>
        正在思考 <span className="mono">{Math.max(0, Math.round((now - Date.parse(since)) / 1000))} 秒</span>
      </span>
      <span className="meta">想完才开始写正文</span>
    </div>
  );
}

// 想完了：收到过思考原文的折叠着，点开看原文；没收到的只说想了多久
function ThinkingDone({ ms, reasoning }: { ms: number; reasoning: string }) {
  const seconds = <span className="mono">{Math.round(ms / 1000)} 秒</span>;
  if (!reasoning) {
    return (
      <div className="think" data-od-id="thinking-done">
        <Icon name="brain" className="icon-sm" />
        <span>思考了 {seconds}</span>
        <span className="meta">这家模型不发回思考的内容，只知道想了多久</span>
      </div>
    );
  }
  return (
    <details className="think" data-od-id="thinking-done">
      <summary>
        <Icon name="brain" className="icon-sm" />
        <span>思考了 {seconds}</span>
        <span className="meta">{fmtNum(Array.from(reasoning).length)} 字 · 不会带进下一轮对话</span>
        <Icon name="chev-down" className="icon-sm chev" />
      </summary>
      <div className="think-body">{reasoning}</div>
    </details>
  );
}

// 回复角落：模型、系统提示词（点开看当时那一版）、token 和花了多少钱
function ReplyMeta({ message, live, text }: { message: Message; live: boolean; text: string }) {
  const config = useCanvasStore((s) => s.modelConfigs.find((m) => m.id === message.modelConfigId));
  if (message.editedFromMessageId) return <div className="msg-meta">手动修改，没有调用 AI</div>;
  if (message.handwritten) return <div className="msg-meta">自己写的，没有调用 AI</div>;
  const pricing = config?.pricing;
  // 正在写的回复还没记下模型名，先用模型配置里的
  const modelName = message.modelName ?? config?.model;
  const usage = message.usage;
  const cost = usage && pricing ? messageCost(usage, pricing) : null;

  return (
    <div className="msg-meta">
      {modelName && (
        <span className="row" style={{ gap: 4 }}>
          <Icon name="cpu" className="icon-sm" />
          <span className="mono">{modelName}</span>
        </span>
      )}
      {message.systemPromptName &&
        (message.systemPromptHash ? (
          <button
            type="button"
            title="查看发这条时用的系统提示词原文"
            onClick={() => useOverlays.setState({ sys: { name: message.systemPromptName!, hash: message.systemPromptHash!, at: message.createdAt } })}
          >
            {message.systemPromptName}
          </button>
        ) : (
          <span>{message.systemPromptName}</span>
        ))}
      {live ? (
        <span className="row" style={{ gap: 6 }}>
          <span className="dot dot-live" />
          正在回复 · 已输出 <span className="mono">{fmtNum(Array.from(text).length)}</span> 字
        </span>
      ) : (
        usage && (
          <>
            <span>
              输入 <span className="mono">{fmtNum(usage.promptTokens)}</span>
              {usage.cachedTokens ? (
                <>
                  （缓存命中 <span className="mono">{fmtNum(usage.cachedTokens)}</span>）
                </>
              ) : null}{' '}
              · 输出 <span className="mono">{fmtNum(usage.completionTokens)}</span> tokens
            </span>
            {cost !== null ? (
              <span className="mono" style={{ color: 'var(--fg)' }}>
                {formatCost(cost, pricing!.currency)}
              </span>
            ) : (
              <span>没填价格</span>
            )}
          </>
        )
      )}
      {!live && message.trimmed && (
        <span data-testid="trimmed">
          只带了最近 {message.trimmed.kept} 轮，前面 {message.trimmed.dropped} 轮没带
        </span>
      )}
    </div>
  );
}
