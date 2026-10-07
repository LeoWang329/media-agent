import { VIDEO_DURATION, VIDEO_MEGAPIXELS, VIDEO_UPSCALES, videoAspect, videoSettingsOf, videoSizes, type ChatNode, type VideoSettings } from '@media-agent/shared';
import { useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { CommitInput, integerFrom } from '../ui/CommitInput';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';

// 视频节点的时长和生成设置，见 docs/dev-plan.md 5.24、5.27

const QUICK_DURATIONS = [15, 30, 45, 60];

// 时长直接填，或者点常用的几个；超过 15 秒的分段生成
export function DurationPop({ anchor, value, onPick, onClose }: { anchor: DOMRect; value: number; onPick: (seconds: number) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(String(value));
  const { min, max } = VIDEO_DURATION;
  const seconds = Number(draft);
  const ok = Number.isInteger(seconds) && seconds >= min && seconds <= max;
  const go = () => ok && onPick(seconds);
  return (
    <Popover anchor={anchor} className="size-pop dur-pop" odId="popover-duration" label="视频时长" onClose={onClose}>
      <div className="row">
        <input
          className="input mono"
          type="number"
          id="durInput"
          aria-label="视频时长（秒）"
          data-autofocus
          min={min}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        <span className="meta">秒</span>
        <button type="button" className="btn btn-primary btn-sm" disabled={!ok} onClick={go}>
          用这个
        </button>
      </div>
      <div className="row dur-quick">
        {QUICK_DURATIONS.map((quick) => (
          <button key={quick} type="button" className="btn btn-ghost btn-sm mono" data-dur={quick} onClick={() => onPick(quick)}>
            {quick} 秒
          </button>
        ))}
      </div>
      <p className="hint">
        能填 {min} 到 {max} 秒。超过 15 秒的分段生成：16 到 30 秒 2 段，31 到 45 秒 3 段，46 到 60 秒 4 段，模型在一个框里按段写好。
      </p>
    </Popover>
  );
}

// 槽位区右边的「生成设置」：按钮上写着出片多大，点开改一采大小、放大倍数、种子
export function VideoGenButton({ node }: { node: ChatNode }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const settings = videoSettingsOf(node.video);
  const { finalWidth, finalHeight } = videoSizes(settings.megapixels, settings.upscale, node.aspectRatio);
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm gen-cfg-btn"
        id="btnVideoCfg"
        data-od-id="btn-video-settings"
        title="生成设置：一采大小、放大倍数、种子，每个节点各存一份"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <Icon name="sliders" />
        生成设置
        <span className="lbl mono">
          出片 {finalWidth}×{finalHeight}
        </span>
      </button>
      {anchor && <VideoSettingsPop anchor={anchor} node={node} onClose={() => setAnchor(null)} />}
    </>
  );
}

function VideoSettingsPop({ anchor, node, onClose }: { anchor: DOMRect; node: ChatNode; onClose: () => void }) {
  const settings = videoSettingsOf(node.video);
  const ratio = videoAspect(node.aspectRatio);
  const final = videoSizes(settings.megapixels, settings.upscale, node.aspectRatio);
  const save = (patch: Partial<VideoSettings>) => void useCanvasStore.getState().patchNode(node.id, { video: patch });
  return (
    <Popover anchor={anchor} align="right" className="vc-pop" odId="popover-video-settings" label="生成设置" onClose={onClose} keepOpen={(t) => Boolean(t.closest('#btnVideoCfg'))}>
      <div className="vc-sec">
        <h4>一采大小</h4>
        <select className="select select-sm mono" id="vcMp" aria-label="一采大小" value={settings.megapixels} onChange={(e) => save({ megapixels: Number(e.target.value) })}>
          {VIDEO_MEGAPIXELS.map((mp) => {
            const size = videoSizes(mp, settings.upscale, node.aspectRatio);
            return (
              <option key={mp} value={mp}>
                {mp} 百万像素 · {size.width}×{size.height}
              </option>
            );
          })}
        </select>
        <p className="hint">
          先按这个大小生成一遍（一采），宽高按节点的比例算{node.aspectRatio === 'auto' ? '，比例自动的按 16:9' : `，现在是 ${ratio}`}。越大越慢，要的显存越多。
        </p>
      </div>
      <div className="vc-sec">
        <h4>放大倍数</h4>
        <div className="seg" role="group" aria-label="放大倍数" id="vcUp">
          {VIDEO_UPSCALES.map((scale) => (
            <button key={scale} type="button" aria-pressed={settings.upscale === scale} onClick={() => save({ upscale: scale })}>
              {scale} 倍
            </button>
          ))}
        </div>
        <p className="hint">一采完不解码直接放大，再细修一遍（二采）。</p>
      </div>
      <div className="vc-sec">
        <h4>种子</h4>
        <div className="row">
          <div className="seg" role="group" aria-label="种子">
            <button type="button" aria-pressed={settings.seed === null} onClick={() => save({ seed: null })}>
              每次随机
            </button>
            <button type="button" aria-pressed={settings.seed !== null} onClick={() => settings.seed === null && save({ seed: Math.floor(Math.random() * 2 ** 32) })}>
              固定一个数
            </button>
          </div>
          {settings.seed !== null && (
            <CommitInput className="input mono" id="vcSeed" style={{ width: 150 }} aria-label="种子" value={String(settings.seed)} parse={integerFrom(0)} onCommit={(v) => save({ seed: Number(v) })} />
          )}
        </div>
      </div>
      <div className="vc-final">
        出片{' '}
        <b className="mono" id="vcFinal">
          {final.finalWidth}×{final.finalHeight}
        </b>
        <span className="meta">步数、采样器、分段重叠照内置流程，不用调</span>
      </div>
    </Popover>
  );
}
