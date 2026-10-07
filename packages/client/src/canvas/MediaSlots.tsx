import {
  AUDIO_USE_TEXT,
  MAX_MEDIA,
  mediaLabels,
  mediaName,
  mediaProblems,
  refVideoFrames,
  secondsText,
  segmentCount,
  takeSeconds,
  VIDEO_USE_TEXT,
  videoImageUse,
  type ChatNode,
  type MediaLabel,
  type MediaRecord,
  type MediaSlot,
} from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { imageThumbUrl, mediaFileUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { openAssets } from './overlays';

// 视频和音频那一排，见 docs/dev-plan.md 5.31：图的槽位下面，视频、音频各最多 3 个，格子上写编号、取多少秒、怎么用；
// 点一格能试听、改从第几秒开始（视频还能改到第几秒）、改用法、调顺序、删掉。超了上限的用红字写在下面，
// 用画面的视频管成片前几秒写在最下面

// 格子上的名字：画面和声音的写上它的声音是音频几，只用声音的写是视频里的声音
function cellName(slot: MediaSlot, label: MediaLabel): string {
  const name = mediaName(slot, label);
  if (slot.kind === 'video' && slot.use === 'both') return `${name} · 声音是音频 ${label.audio}`;
  if (slot.kind === 'video' && slot.use === 'sound') return `${name} · 视频里的声音`;
  return name;
}

const useText = (slot: MediaSlot) => (slot.kind === 'video' ? VIDEO_USE_TEXT[slot.use] : AUDIO_USE_TEXT[slot.use]);

export function MediaSlots({ node }: { node: ChatNode }) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const records = useCanvasStore((s) => s.detail?.media);
  const placing = useCanvasStore((s) => (s.placingMedia?.nodeId === node.id ? s.placingMedia : null));
  const [open, setOpen] = useState<{ index: number; anchor: DOMRect } | null>(null);
  const media = node.media ?? [];
  const labels = mediaLabels(media);
  const count = (kind: MediaSlot['kind']) => media.filter((m) => m.kind === kind).length;

  // 参考的视频和音频只在参考模式写的回复里带，配音都带
  const refs = videoImageUse(node.systemPromptName) === 'refs';
  const problems = mediaProblems(refs ? media : media.filter((m) => m.use === 'dub'), refs ? node.slots.length : 0);
  const unused = !refs && media.some((m) => m.use !== 'dub');
  // 参考视频只管成片开头和它一样长的那一截；分段生成的，每段都从参考的开头管起
  const covers = refs ? media.flatMap((slot, i) => (labels[i].video ? [`视频 ${labels[i].video} 管成片前 ${secondsText(Math.min(takeSeconds(slot), node.duration))} 秒`] : [])) : [];

  return (
    <div className="mslots-wrap" data-od-id="media-slots">
      <div className="mslots" id="mediaSlots">
        <span className="meta mslots-title">
          视频 <span className="mono">{count('video')}/{MAX_MEDIA.video}</span> · 音频{' '}
          <span className="mono">
            {count('audio')}/{MAX_MEDIA.audio}
          </span>
        </span>
        {media.map((slot, i) => {
          const record = records?.[slot.mediaId];
          return (
            <button
              key={`${i}-${slot.mediaId}`}
              type="button"
              className={`mslot is-${slot.kind}`}
              data-testid="media-slot"
              data-od-id={`media-slot-${i + 1}`}
              title={`${record?.originalName ?? ''}：从第 ${secondsText(slot.start)} 秒取到第 ${secondsText(slot.start + takeSeconds(slot))} 秒，共 ${secondsText(takeSeconds(slot))} 秒，${useText(slot)}`}
              onClick={(e) => setOpen({ index: i, anchor: e.currentTarget.getBoundingClientRect() })}
            >
              {slot.kind === 'video' && slot.frame && canvasId ? (
                <img className="mslot-im" src={imageThumbUrl(canvasId, slot.frame)} alt="" draggable={false} />
              ) : (
                <span className="mslot-icon">
                  <Icon name={slot.kind === 'video' ? 'film' : 'music'} />
                </span>
              )}
              <span className="mslot-text">
                <span className="mslot-name">{cellName(slot, labels[i])}</span>
                <span className="mslot-meta mono">
                  {secondsText(takeSeconds(slot))} 秒 · {useText(slot)}
                </span>
              </span>
            </button>
          );
        })}
        {placing?.names.map((name) => (
          <div key={`placing-${name}`} className="mslot is-placing" data-testid="media-slot-placing">
            <span className="spinner" />
            <span className="mslot-text">
              <span className="mslot-name">{name}</span>
              <span className="mslot-meta">处理中</span>
            </span>
          </div>
        ))}
        <button type="button" className="mslot is-add" title="从资产库挑视频和音频，也能从电脑里直接拖进来" data-od-id="media-slot-add" onClick={() => openAssets('slots')}>
          <Icon name="plus" />
          <span className="mslot-meta">视频、音频</span>
        </button>
      </div>
      {problems.length > 0 && (
        <div className="mslots-problem" id="mediaProblems" data-od-id="media-problems">
          生成视频前要改：{problems.join('；')}
        </div>
      )}
      {unused && <div className="meta mslots-note">图当首帧、纯文字这两种提示词写的不带参考视频和音频，只带配音。</div>}
      {covers.length > 0 && (
        <div className="meta mslots-note" id="mediaCovers" data-od-id="media-covers">
          {covers.join('，')}
          {segmentCount(node.duration) > 1 && '，分段的每段都从头管'}。
        </div>
      )}
      {open && media[open.index] && canvasId && (
        <MediaPop
          key={`${open.index}-${media[open.index].mediaId}`}
          node={node}
          index={open.index}
          slot={media[open.index]}
          label={labels[open.index]}
          record={records?.[media[open.index].mediaId]}
          url={mediaFileUrl(canvasId, media[open.index].mediaId)}
          anchor={open.anchor}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

type PopProps = { node: ChatNode; index: number; slot: MediaSlot; label: MediaLabel; record?: MediaRecord; url: string; anchor: DOMRect; onClose: () => void };

function MediaPop({ node, index, slot, label, record, url, anchor, onClose }: PopProps) {
  const [start, setStart] = useState(secondsText(slot.start));
  const take = takeSeconds(slot);
  const shownEnd = secondsText(slot.start + take);
  const [end, setEnd] = useState(shownEnd);
  // 改完起止、用法以后，「到第几秒」显示真用到第几秒
  useEffect(() => setEnd(shownEnd), [shownEnd]);
  const { changeMedia, removeMedia, moveMedia } = useCanvasStore.getState();
  const media = node.media ?? [];
  const same = media.map((m, i) => ({ m, i })).filter(({ m }) => m.kind === slot.kind);
  const at = same.findIndex(({ i }) => i === index);
  const silent = slot.kind === 'video' && record?.hasAudio === false;

  // 开始的秒数：0 到这段长度减 0.1 之间，填错的回到原来的
  const commitStart = () => {
    const value = Math.round(Number(start) * 10) / 10;
    if (!Number.isFinite(value) || value < 0 || value >= slot.seconds) return setStart(secondsText(slot.start));
    if (value !== slot.start) void changeMedia(node.id, index, { start: value });
  };

  // 到第几秒：要比开始的秒数大，超过这段长度的按长度算，填错的回到原来的
  const commitEnd = () => {
    if (end === shownEnd) return;
    const value = Math.min(Math.round(Number(end) * 10) / 10, slot.seconds);
    if (!Number.isFinite(value) || value <= slot.start) return setEnd(shownEnd);
    void changeMedia(node.id, index, { end: value });
  };

  const uses = slot.kind === 'video' ? (Object.keys(VIDEO_USE_TEXT) as (keyof typeof VIDEO_USE_TEXT)[]) : (Object.keys(AUDIO_USE_TEXT) as (keyof typeof AUDIO_USE_TEXT)[]);
  const hint =
    slot.use === 'dub'
      ? '配音：出的视频直接用这段声音，人物跟着它对口型，从开始那一秒一直用到视频结束；比视频短的，后面没声音。'
      : slot.use === 'picture' || slot.use === 'both'
        ? `参考：取 ${secondsText(take)} 秒（最多 15 秒）。H3 按 17 帧一档用参考视频，零头已经砍掉，取多少秒就真用多少秒。拿来干什么，在对话里跟模型说一句。`
        : `参考：取 ${secondsText(take)} 秒（最多 15 秒）。拿来干什么，在对话里跟模型说一句。`;

  return (
    <Popover anchor={anchor} className="media-pop" odId="popover-media" label={mediaName(slot, label)} onClose={onClose}>
      <div className="mp-head">
        <b>{cellName(slot, label)}</b>
        <span className="meta mono" title={record?.originalName}>
          {record?.originalName} · {secondsText(slot.seconds)} 秒
        </span>
      </div>
      {slot.kind === 'video' ? (
        <video className="mp-player" src={`${url}#t=${slot.start}`} controls preload="metadata" />
      ) : (
        <audio className="mp-player" src={`${url}#t=${slot.start}`} controls preload="metadata" />
      )}
      <form
        className="row mp-start"
        // 两个框的表单按回车不会提交，各自管各自的回车
        onSubmit={(e) => e.preventDefault()}
      >
        <label htmlFor="mediaStart">从第</label>
        <input
          className="input input-sm mono"
          id="mediaStart"
          type="number"
          min={0}
          max={Math.max(0, slot.seconds - 0.1)}
          step={0.1}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commitStart()}
          onBlur={commitStart}
        />
        {slot.kind === 'video' ? (
          <>
            <label htmlFor="mediaEnd">秒到第</label>
            <input
              className="input input-sm mono"
              id="mediaEnd"
              type="number"
              min={0.1}
              max={slot.seconds}
              step={0.1}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitEnd()}
              onBlur={commitEnd}
            />
            <span>秒</span>
            {slot.use !== 'sound' && <span className="meta mono" id="mediaFrames">用 {refVideoFrames(take)} 帧</span>}
          </>
        ) : (
          <span>秒开始</span>
        )}
      </form>
      <div className="seg" role="group" aria-label="怎么用" id="mediaUse">
        {uses.map((use) => (
          <button
            key={use}
            type="button"
            aria-pressed={slot.use === use}
            disabled={silent && use !== 'picture'}
            title={silent && use !== 'picture' ? '这段视频没有声音' : undefined}
            onClick={() => slot.use !== use && void changeMedia(node.id, index, { use })}
          >
            {slot.kind === 'video' ? VIDEO_USE_TEXT[use as keyof typeof VIDEO_USE_TEXT] : AUDIO_USE_TEXT[use as keyof typeof AUDIO_USE_TEXT]}
          </button>
        ))}
      </div>
      <p className="hint">{hint}</p>
      <div className="row mp-actions">
        <button type="button" className="btn btn-ghost btn-sm" disabled={at <= 0} onClick={() => void moveMedia(node.id, index, same[at - 1].i).then(onClose)}>
          <Icon name="chev-left" />
          往前挪
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={at >= same.length - 1} onClick={() => void moveMedia(node.id, index, same[at + 1].i).then(onClose)}>
          往后挪
          <Icon name="chev-right" />
        </button>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-ghost btn-sm is-danger"
          id="mediaRemove"
          onClick={() => {
            onClose();
            void removeMedia(node.id, index);
          }}
        >
          <Icon name="trash" />
          删掉
        </button>
      </div>
    </Popover>
  );
}
