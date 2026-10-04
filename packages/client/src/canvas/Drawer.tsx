import { activePath, type ChatNode, type ModelConfig, type ThinkingSettings } from '@media-agent/shared';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useCanvasStore } from '../store/canvasStore';
import { Icon } from '../ui/Icon';
import { showMenu } from '../ui/menu';
import { RenameInput } from '../ui/RenameInput';
import { chatThinkingLevel, LEVEL_LABELS } from '../ui/thinking';
import { toast } from '../ui/toast';
import { Dock } from './Dock';
import { closeDrawer, drawerMenu, finishRename, selectNode, startRename, useRenaming } from './nodeActions';
import { copiedCount, forkedAt, isUntitled, nodeCost } from './nodeInfo';
import { Outline } from './Outline';
import { Thread } from './Thread';

const WIDTH_KEY = 'pc-drawer-w';
const OUTLINE_KEY = 'pc-outline';

// 对话目录开没开记在浏览器里，下次打开面板还是那样
function readOutline(): boolean {
  try {
    return localStorage.getItem(OUTLINE_KEY) === '1';
  } catch {
    return false;
  }
}

// 右侧的节点对话面板；收起时滑出屏幕，里面还留着刚才那个节点，滑动时不会一下子空掉
export function Drawer() {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const loaded = useCanvasStore((s) => Boolean(s.selectedId && s.nodes[s.selectedId]));
  const shown = useRef<string | null>(null);
  const wasOpen = useRef(false);
  // 面板开着换到还没读过的节点：先留着上一个，读完再换，面板不会空一下
  if (selectedId && (loaded || !wasOpen.current)) shown.current = selectedId;
  useEffect(() => {
    wasOpen.current = Boolean(selectedId);
  });
  const node = useCanvasStore((s) => (shown.current ? s.nodes[shown.current] : undefined));
  const exists = useCanvasStore((s) => Boolean(shown.current && s.detail?.nodes.some((n) => n.id === shown.current)));
  const handle = useRef<HTMLDivElement>(null);
  const resize = useRef<{ x: number; width: number } | null>(null);
  const [outline, setOutline] = useState(readOutline);
  // 面板收起时目录不跟着滑，直接不显示
  const outlineShown = outline && Boolean(selectedId && node && exists);

  const toggleOutline = () => {
    setOutline(!outline);
    try {
      localStorage.setItem(OUTLINE_KEY, outline ? '0' : '1');
    } catch {
      // 存不了就只管这一次
    }
  };

  // 面板宽度记在浏览器里
  useEffect(() => {
    try {
      const width = parseInt(localStorage.getItem(WIDTH_KEY) ?? '', 10);
      if (width) document.body.style.setProperty('--drawer-w', `${width}px`);
    } catch {
      // 浏览器不让读就用默认宽度
    }
    return () => {
      document.body.style.removeProperty('--drawer-w');
    };
  }, []);

  const onResizeDown = (e: PointerEvent<HTMLDivElement>) => {
    resize.current = { x: e.clientX, width: document.getElementById('drawer')!.offsetWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add('is-active');
  };
  const onResizeMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!resize.current) return;
    const width = Math.min(Math.max(440, resize.current.width - (e.clientX - resize.current.x)), Math.min(960, innerWidth - 320));
    document.body.style.setProperty('--drawer-w', `${width}px`);
  };
  const onResizeUp = (e: PointerEvent<HTMLDivElement>) => {
    resize.current = null;
    e.currentTarget.classList.remove('is-active');
    try {
      localStorage.setItem(WIDTH_KEY, String(document.getElementById('drawer')!.offsetWidth));
    } catch {
      // 存不了就只管这一次
    }
  };

  return (
    <aside className="drawer" id="drawer" aria-label="节点对话" data-od-id="node-drawer">
      <div className="drawer-resize" id="drawerResize" title="拖动调宽" ref={handle} onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} />
      {node && exists && (
        <>
          <DrawerHead node={node} outline={outline} onOutline={toggleOutline} />
          <Thread key={`thread-${node.id}`} node={node} />
          <Dock key={`dock-${node.id}`} node={node} />
          {outlineShown && <Outline node={node} onClose={toggleOutline} />}
        </>
      )}
    </aside>
  );
}

function DrawerHead({ node, outline, onOutline }: { node: ChatNode; outline: boolean; onOutline: () => void }) {
  const renaming = useRenaming((s) => s.nodeId === node.id && s.where === 'drawer');
  const parent = useCanvasStore((s) => s.detail?.nodes.find((n) => n.id === node.parentNodeId));
  const modelConfigs = useCanvasStore((s) => s.modelConfigs);
  const prompts = useCanvasStore((s) => s.prompts);
  // 系统提示词只能选这种节点用的
  const usable = prompts.filter((p) => p.use === node.kind);
  const thinking = useCanvasStore((s) => s.thinking);
  const patchNode = useCanvasStore((s) => s.patchNode);
  const untitled = isUntitled(node);
  const cost = nodeCost(node, modelConfigs);
  const copied = copiedCount(node, activePath(node));

  // 标题下面的小字：从哪儿岔出来的、标题会不会被 AI 改，几项之间用点隔开
  const sub: ReactNode[][] = [];
  if (node.parentNodeId) {
    sub.push([
      <Icon key="icon" name="branch" className="icon-sm" />,
      <span key="fork">
          从
          {parent ? (
            <>
              「
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  selectNode(parent.id);
                }}
              >
                {parent.title}
              </a>
              」
            </>
          ) : (
            '已删除的节点'
          )}
          第 {forkedAt(node, copied)} 条消息岔出
      </span>,
    ]);
  }
  if (untitled) sub.push([<span key="untitled">发出第一条后 AI 会起标题</span>]);
  else if (node.titleIsManual) sub.push([<span key="manual">标题手动改过，AI 不再覆盖</span>]);

  return (
    <header className="dr-head" data-od-id="drawer-head">
      <div className="dr-head-row">
        <button type="button" className="btn btn-ghost btn-icon show-sm" id="drBack" aria-label="返回画布" onClick={closeDrawer}>
          <Icon name="chev-left" />
        </button>
        <div className="dr-title-wrap grow">
          {renaming ? (
            <RenameInput value={node.title} className="ws-rename" maxLength={24} onDone={(next) => void finishRename(node.id, next)} />
          ) : (
            <button
              type="button"
              className="dr-title"
              id="drTitle"
              title="点击改名"
              data-od-id="drawer-node-title"
              style={untitled ? { fontStyle: 'italic' } : undefined}
              onClick={() => startRename(node.id, 'drawer')}
            >
              {node.title}
            </button>
          )}
          <div className="dr-sub" id="drSub">
            {sub.flatMap((item, i) => (i ? [<span key={`dot-${i}`}>·</span>, ...item] : item))}
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-ghost btn-icon${outline ? ' is-on' : ''}`}
          id="drOutline"
          aria-label="对话目录"
          aria-pressed={outline}
          title={outline ? '收起对话目录' : '对话目录：在左边列出每一轮，点一下跳过去'}
          onClick={onOutline}
        >
          <Icon name="list" />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" id="drMenu" aria-label="节点操作" onClick={(e) => showMenu(e.currentTarget, drawerMenu(node.id))}>
          <Icon name="more" />
        </button>
        <button type="button" className="btn btn-ghost btn-icon hide-sm" id="drClose" aria-label="收起面板" onClick={closeDrawer}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dr-config" data-od-id="node-config">
        <label className="cfg">
          <Icon name="cpu" className="icon-sm" />
          <select
            id="cfgModel"
            aria-label="模型配置"
            value={node.modelConfigId}
            onChange={(e) => {
              const config = modelConfigs.find((m) => m.id === e.target.value);
              void patchNode(node.id, { modelConfigId: e.target.value }).then((ok) => ok && toast(`从下一条消息起用「${config?.name ?? ''}」`));
            }}
          >
            {!modelConfigs.some((m) => m.id === node.modelConfigId) && <option value={node.modelConfigId}>（没有选模型配置）</option>}
            {modelConfigs.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.model}
              </option>
            ))}
          </select>
        </label>
        <label className="cfg">
          <Icon name="doc" className="icon-sm" />
          <select
            id="cfgSys"
            aria-label="系统提示词"
            value={node.systemPromptName}
            onChange={(e) => {
              const name = e.target.value;
              void patchNode(node.id, { systemPromptName: name }).then((ok) => ok && toast(`从下一条消息起用系统提示词「${name}」`));
            }}
          >
            {/* 现在用的这套删了，或者用途改成了另一种：照旧显示，写着用不了 */}
            {!usable.some((p) => p.name === node.systemPromptName) && (
              <option value={node.systemPromptName}>
                （{prompts.some((p) => p.name === node.systemPromptName) ? `${node.systemPromptName} 不是${node.kind === 'image' ? '生图' : '视频'}节点用的` : `找不到 ${node.systemPromptName}`}）
              </option>
            )}
            {usable.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.family ? ` · ${p.family}` : ''}
              </option>
            ))}
          </select>
        </label>
        {thinking && <ThinkingButton config={modelConfigs.find((m) => m.id === node.modelConfigId)} settings={thinking} />}
        <span className="meta grow dr-cost" id="drCost">
          {cost ? `这个节点花了 ${cost}` : ''}
        </span>
      </div>
    </header>
  );
}

// 写提示词时思考不思考、哪一档；点一下去设置里改
function ThinkingButton({ config, settings }: { config: ModelConfig | undefined; settings: ThinkingSettings }) {
  const navigate = useNavigate();
  const level = chatThinkingLevel(config, settings);
  const on = level !== null && level !== 'off';
  const label = on ? `思考 ${LEVEL_LABELS[level]}` : level ? '不思考' : '不支持思考';
  const title = on
    ? `写提示词时先思考，档位「${LEVEL_LABELS[level]}」${settings.chat === 'follow' ? '（跟设置里的总开关）' : ''}。点一下去设置里改`
    : level
      ? '设置里写提示词的思考是「关」。点一下去设置里改'
      : '这套模型配置的「开思考的写法」是不支持。点一下去设置里改';
  return (
    <button
      type="button"
      className={`cfg cfg-think${on ? ' is-on' : ''}`}
      id="cfgThink"
      title={title}
      data-od-id="thinking-level"
      onClick={() => navigate({ pathname: '/settings', hash: 'thinking' })}
    >
      <Icon name="brain" className="icon-sm" />
      <span>{label}</span>
    </button>
  );
}
