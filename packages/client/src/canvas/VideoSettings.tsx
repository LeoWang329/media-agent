import {
  VIDEO_DURATION,
  VIDEO_MEGAPIXELS,
  VIDEO_SPEEDS,
  VIDEO_UPSCALES,
  videoAspect,
  videoImageUse,
  videoRatioOf,
  videoSettingsOf,
  videoSizes,
  type AspectRatio,
  type ChatNode,
  type VideoSettings,
  type VideoSpeed,
} from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useVideoStore } from '../store/videoStore';
import { anyNumber, CommitInput, integerFrom } from '../ui/CommitInput';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { LoraSelect } from './GenSettings';

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

// 宽高按哪个比例算：图当首帧、比例自动的按槽位第一张图，见 docs/dev-plan.md 5.26
export function useVideoRatio(promptName: string | undefined, ratio: AspectRatio, firstId: string | undefined) {
  const first = useCanvasStore((s) => (firstId ? s.detail?.images[firstId] : undefined));
  return videoRatioOf(ratio, videoImageUse(promptName), first);
}

const SPEED_LABELS: Record<VideoSpeed, string> = { fast: '加速', full: '不加速' };

// 槽位区右边的「生成设置」：按钮上写着出片多大，点开改加速还是不加速、一采大小、放大倍数、种子、主模型、LoRA
export function VideoGenButton({ node }: { node: ChatNode }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const settings = videoSettingsOf(node.video);
  const { finalWidth, finalHeight } = videoSizes(settings.megapixels, settings.upscale, useVideoRatio(node.systemPromptName, node.aspectRatio, node.slots[0]));
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm gen-cfg-btn"
        id="btnVideoCfg"
        data-od-id="btn-video-settings"
        title="生成设置：加速还是不加速、一采大小、放大倍数、种子、主模型、LoRA，每个节点各存一份"
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
  const sized = useVideoRatio(node.systemPromptName, node.aspectRatio, node.slots[0]);
  const ratioText = typeof sized !== 'string' ? '，比例自动的按当首帧的那张图' : node.aspectRatio === 'auto' ? '，比例自动的按 16:9' : `，现在是 ${videoAspect(node.aspectRatio)}`;
  const final = videoSizes(settings.megapixels, settings.upscale, sized);
  const save = (patch: Partial<VideoSettings>) => void useCanvasStore.getState().patchNode(node.id, { video: patch });
  // 主模型和 LoRA 的列表从生成视频那台读；关着时读过的照样有
  const options = useVideoStore((s) => s.options);
  const optionsError = useVideoStore((s) => s.optionsError);
  useEffect(() => {
    void useVideoStore.getState().loadOptions();
  }, []);
  const models = options?.models ?? [];
  const loras = options?.loras ?? [];
  // 节点选的那台上没有：也列出来
  const pick = (list: string[], value: string) => (value && !list.includes(value) ? [value, ...list] : list);
  return (
    <Popover anchor={anchor} align="right" className="vc-pop" odId="popover-video-settings" label="生成设置" onClose={onClose} keepOpen={(t) => Boolean(t.closest('#btnVideoCfg, .gc-lora-pop'))}>
      <div className="vc-sec">
        <h4>加速</h4>
        <div className="seg" role="group" aria-label="加速还是不加速" id="vcSpeed">
          {(Object.keys(SPEED_LABELS) as VideoSpeed[]).map((speed) => (
            <button key={speed} type="button" aria-pressed={settings.speed === speed} onClick={() => save({ speed, model: VIDEO_SPEEDS[speed].model })}>
              {SPEED_LABELS[speed]}
            </button>
          ))}
        </div>
        <p className="hint">
          加速用 DaSiWa V2 加速版，一采 {VIDEO_SPEEDS.fast.steps.pass1} 步、二采 {VIDEO_SPEEDS.fast.steps.pass2} 步；不加速用完整版，一采 {VIDEO_SPEEDS.full.steps.pass1} 步、二采{' '}
          {VIDEO_SPEEDS.full.steps.pass2} 步，同样长度多花七成左右的时间。切的时候主模型跟着换，换完还能在下面改。
        </p>
      </div>
      <div className="vc-sec">
        <h4>一采大小</h4>
        <select className="select select-sm mono" id="vcMp" aria-label="一采大小" value={settings.megapixels} onChange={(e) => save({ megapixels: Number(e.target.value) })}>
          {VIDEO_MEGAPIXELS.map((mp) => {
            const size = videoSizes(mp, settings.upscale, sized);
            return (
              <option key={mp} value={mp}>
                {mp} 百万像素 · {size.width}×{size.height}
              </option>
            );
          })}
        </select>
        <p className="hint">
          先按这个大小生成一遍（一采），宽高按节点的比例算{ratioText}。越大越慢，要的显存越多。
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
      <div className="vc-sec">
        <h4>
          主模型
          <button type="button" className="btn btn-ghost btn-sm vc-refresh" title="生成视频那台上新放了模型，重读一次" onClick={() => void useVideoStore.getState().loadOptions(true)}>
            <Icon name="retry" />
            刷新
          </button>
        </h4>
        <LoraSelect what="主模型" value={settings.model} loras={pick(models, settings.model)} onPick={(model) => save({ model })} />
        {optionsError && !options && (
          <p className="hint is-error" id="vcOptionsError">
            {optionsError}
          </p>
        )}
      </div>
      <div className="vc-sec">
        <h4>
          LoRA<span className="meta">可以挂几个，各带强度，只作用在主模型上</span>
        </h4>
        <div className="gc-loras" id="vcLoras">
          {settings.loras.map((lora, i) => (
            <div className="gc-lora" key={i}>
              <LoraSelect value={lora.name} loras={pick(loras, lora.name)} onPick={(name) => save({ loras: settings.loras.map((l, j) => (j === i ? { ...l, name } : l)) })} />
              <CommitInput
                className="input mono"
                type="number"
                step="0.05"
                min="-2"
                max="2"
                aria-label="强度"
                value={String(lora.strength)}
                parse={anyNumber}
                onCommit={(v) => save({ loras: settings.loras.map((l, j) => (j === i ? { ...l, strength: Number(v) } : l)) })}
              />
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="去掉" onClick={() => save({ loras: settings.loras.filter((_, j) => j !== i) })}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!loras.length}
            title={loras.length ? undefined : '生成视频那台开机后才列得出 LoRA'}
            onClick={() => save({ loras: [...settings.loras, { name: loras.find((l) => !settings.loras.some((x) => x.name === l)) ?? loras[0], strength: 0.8 }] })}
          >
            <Icon name="plus" />
            挂一个 LoRA
          </button>
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
