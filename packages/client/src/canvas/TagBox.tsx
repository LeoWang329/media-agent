import { directionDraft, displayTag, formatTag, splitTags, unescapeTag, type ChatNode, type Family, type Message, type TagHit } from '@media-agent/shared';
import { useMemo, useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { composeBox, useTagChecks } from '../tags/tagStore';
import { fmtCount, TAG_CATEGORIES, TagChip } from '../tags/TagChip';
import { copyText } from '../ui/copy';
import { Icon, type IconName } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toast';
import { useOverlays } from './overlays';

type Props = {
  node: ChatNode;
  message: Message;
  index: number;
  label?: string;
  text: string;
  family: Family | null;
  ro: boolean; // 复制来的消息：只能看、复制、往下岔
  writing: boolean;
  incomplete: boolean;
  busy: boolean;
};

const BUSY = '正在生成，先叫停或等它写完';

// 生图节点的提示词框：一串标签，每个是一个小块；不认识的点开挑一个换掉
export function TagBox({ node, message, index, label, text, family, ro, writing, incomplete, busy }: Props) {
  const items = useMemo(() => splitTags(text), [text]);
  // 正在写的时候最后一个可能只写了一半，先不校验
  const settled = writing ? items.slice(0, -1) : items;
  const checks = useTagChecks(
    settled.map((item) => item.name),
    family,
  );
  const prefix = useCanvasStore((s) => (family ? s.defaults[family].prefix : ''));
  const [unknown, setUnknown] = useState<{ index: number; anchor: DOMRect } | null>(null);
  const starred = Boolean(message.stars?.includes(index)) && !incomplete;
  const editable = !ro && !writing && !incomplete;
  const aliases = checks.filter((check) => check?.status === 'alias').length;
  const unknowns = checks.filter((check) => check?.status === 'unknown').length;

  const act = (name: string, title: string, icon: IconName, onClick: () => void, extra = '') => (
    <button type="button" className={`btn btn-ghost btn-sm${extra}`} data-act={name} title={title} onClick={onClick}>
      <Icon name={icon} className={name === 'star' && starred ? 'icon-fill' : undefined} />
      <span className="lbl">{name === 'star' ? (starred ? '已打星' : '打星') : title}</span>
    </button>
  );

  const copy = async () => {
    const composed = await composeBox(text, family);
    copyText(composed.text, `已复制提示词（${composed.count} 个标签）`);
  };

  // 点了候选：换掉这一个，权重照旧，存成新版本
  const replace = async (at: number, hit: TagHit) => {
    setUnknown(null);
    if (busy) return toast(BUSY, { tone: 'warn' });
    const next = items.map((item, i) => (i === at ? formatTag(hit.tag, item.weight) : item.raw)).join(', ');
    const ok = await useCanvasStore.getState().editPrompt(node.id, message.id, index, next);
    if (ok) toast(`「${unescapeTag(items[at].name)}」换成了「${displayTag(hit.tag)}」，存成了新版本`);
  };

  const picked = unknown && checks[unknown.index]?.status === 'unknown' ? { item: items[unknown.index], check: checks[unknown.index]! } : null;

  return (
    <div className={`pbox pbox-img${starred ? ' is-starred' : ''}${writing || incomplete ? ' is-writing' : ''}`} data-od-id="image-prompt-box" data-testid="prompt-box">
      <div className="pb-head">
        <span className={`pb-label${label ? '' : ' is-plain'}`}>{label || '提示词'}</span>
        <div className="pb-actions">
          {act('copy', '复制', 'copy', () => void copy())}
          {!ro &&
            !incomplete &&
            act(
              'star',
              starred ? '取消星标' : '打星：这版效果好',
              'star',
              () =>
                void useCanvasStore
                  .getState()
                  .star(node.id, message.id, index, !starred)
                  .then((ok) => ok && toast(starred ? '取消了星标' : '打了星。画布上这个节点会显示星标')),
              starred ? ' is-star' : '',
            )}
          {editable &&
            act('editTags', '编辑', 'edit', () => {
              if (busy) toast(BUSY, { tone: 'warn' });
              else useOverlays.setState({ tags: { nodeId: node.id, messageId: message.id, promptIndex: index, label } });
            })}
          {!writing && act('continue', '沿这个方向继续', 'arrow-right', () => void useCanvasStore.getState().fork(node.id, message.id, directionDraft(index, label)))}
        </div>
      </div>
      <div className="pb-body tg-body">
        <div className="tg-flow">
          {items.map((item, i) =>
            editable && checks[i]?.status === 'unknown' ? (
              <TagChip
                key={i}
                as="button"
                item={item}
                check={checks[i]}
                data-act="unknownTag"
                onClick={(e) => setUnknown({ index: i, anchor: e.currentTarget.getBoundingClientRect() })}
              />
            ) : (
              <TagChip key={i} item={item} check={checks[i]} />
            ),
          )}
          {writing && <span className="caret" />}
        </div>
      </div>
      {writing ? (
        <div className="pb-foot">
          <span className="writing-tag">
            <span className="spinner" />
            还没写完
          </span>
          <span className="mono">{items.length} 个标签</span>
        </div>
      ) : incomplete ? (
        <div className="pb-foot" style={{ color: 'var(--warn)' }}>
          <Icon name="warn" />
          叫停时还没写完，这条提示词不完整
        </div>
      ) : (
        <div className="pb-foot tg-foot">
          <span className="mono">{items.length}</span> 个标签
          {aliases > 0 && (
            <>
              <span className="tg-foot-sep">·</span>
              <span>{aliases} 处换成了标准写法</span>
            </>
          )}
          {unknowns > 0 && (
            <>
              <span className="tg-foot-sep">·</span>
              <span className="tg-foot-unknown">{unknowns} 个词库里没有</span>
            </>
          )}
          <span className="grow" />
          {prefix && (
            <span className="meta">
              出图时前面加 <span className="mono">{prefix}</span>
            </span>
          )}
        </div>
      )}
      {picked && (
        <Popover
          anchor={unknown!.anchor}
          align="right"
          className="unk-pop"
          odId="popover-unknown-tag"
          label="换掉不认识的标签"
          onClose={() => setUnknown(null)}
          keepOpen={(target) => Boolean(target.closest('[data-act="unknownTag"]'))}
        >
          <h4>词库里没有「{unescapeTag(picked.item.name)}」</h4>
          <p className="meta" style={{ margin: '0 2px 8px' }}>
            可能是 AI 编的，也可能是有意写的（比如某个 LoRA 的触发词）。出图时照原样写进去。点下面一个就换掉，存成新版本。
          </p>
          <div className="unk-list">
            {(picked.check.suggestions ?? []).map((hit) => (
              <button key={hit.tag} type="button" data-near={hit.tag} onClick={() => void replace(unknown!.index, hit)}>
                <span className="unk-en">{displayTag(hit.tag)}</span>
                <span className="unk-zh">{hit.zh}</span>
                <span className="tag">{TAG_CATEGORIES[hit.category] ?? ''}</span>
                <span className="mono unk-n">{fmtCount(hit.count)}</span>
              </button>
            ))}
            {!picked.check.suggestions?.length && <p className="gp-none">词库里找不到接近的写法</p>}
          </div>
          <div className="gp-foot">
            <span className="meta">数字是 Danbooru 上用过的次数</span>
            <span className="grow" />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              data-keep
              onClick={() => {
                setUnknown(null);
                toast('照原样留着，出图时原样写进去');
              }}
            >
              保持原样
            </button>
          </div>
        </Popover>
      )}
    </div>
  );
}
