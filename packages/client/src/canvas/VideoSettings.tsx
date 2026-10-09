import {
  selfliftOfSettings,
  stepsOfSettings,
  VIDEO_DENOISE,
  VIDEO_DURATION,
  VIDEO_MEGAPIXELS,
  VIDEO_SELFLIFT,
  VIDEO_SPEEDS,
  VIDEO_STEPS,
  VIDEO_UPSCALES,
  VIDEO_WORKFLOWS,
  videoAspect,
  videoImageUse,
  videoRatioOf,
  videoSettingsOf,
  videoSizes,
  workflowOfSettings,
  type AspectRatio,
  type ChatNode,
  type VideoSettings,
  type VideoSpeed,
  type VideoWorkflow,
} from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useVideoStore } from '../store/videoStore';
import { anyNumber, CommitInput, integerBetween, integerFrom } from '../ui/CommitInput';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { NameSelect } from './GenSettings';

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
const WORKFLOW_LABELS: Record<VideoWorkflow, string> = { 'two-pass': '两遍生成', selflift: 'SelfLift 一遍' };

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
  const workflow = workflowOfSettings(settings);
  const selflift = selfliftOfSettings(settings);
  const steps = stepsOfSettings(settings);
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
  // SelfLift 能用的放大器也是从那一台读的（装了那套节点才有）；没读到就只列默认那个和「不用放大器」
  const upscalers = options?.selfliftUpscalers?.length ? options.selfliftUpscalers : [VIDEO_SELFLIFT.none, VIDEO_SELFLIFT.upscaler];
  // 节点选的那台上没有：也列出来
  const pick = (list: string[], value: string) => (value && !list.includes(value) ? [value, ...list] : list);
  return (
    <Popover anchor={anchor} align="right" className="vc-pop" odId="popover-video-settings" label="生成设置" onClose={onClose} keepOpen={(t) => Boolean(t.closest('#btnVideoCfg, .gc-lora-pop'))}>
      <div className="vc-sec">
        <h4>
          流程<span className="meta">这个节点走哪套内置流程</span>
        </h4>
        <div className="seg" role="group" aria-label="走哪套流程" id="vcWorkflow">
          {VIDEO_WORKFLOWS.map((one) => (
            <button key={one} type="button" aria-pressed={workflow === one} onClick={() => save({ workflow: one })}>
              {WORKFLOW_LABELS[one]}
            </button>
          ))}
        </div>
        <p className="hint">
          {workflow === 'two-pass'
            ? `两遍生成：先按一采大小出一遍，不解码放大到出片大小，再按「二采重画多少」细修一遍。分段接续、重拍一截都在这套上。`
            : `SelfLift：一套调度跑完——前 ${selflift.transitionStep} 步低分辨率，抬到出片大小再跑完剩下的 ${selflift.steps - selflift.transitionStep} 步，没有放大这一步。一段一个采样器；这套不能重拍一截。`}
        </p>
      </div>
      <div className="vc-sec">
        <h4>
          加速
          <span className="meta">{workflow === 'two-pass' ? '一键设好主模型和步数，设完两样都能自己改' : '只换主模型'}</span>
        </h4>
        <div className="seg" role="group" aria-label="加速还是不加速" id="vcSpeed">
          {(Object.keys(SPEED_LABELS) as VideoSpeed[]).map((speed) => (
            <button
              key={speed}
              type="button"
              aria-pressed={settings.speed === speed}
              // 切的时候主模型和一采、二采的步数一起换成这个预设的，换完下面还能改，见 docs/dev-plan.md 5.27
              onClick={() => save({ speed, model: VIDEO_SPEEDS[speed].model, steps: VIDEO_SPEEDS[speed].steps })}
            >
              {SPEED_LABELS[speed]}
            </button>
          ))}
        </div>
        <p className="hint">
          {workflow === 'two-pass' ? (
            <>
              加速用 DaSiWa V2 加速版，一采 {VIDEO_SPEEDS.fast.steps.pass1} 步、二采 {VIDEO_SPEEDS.fast.steps.pass2} 步；不加速用完整版，一采 {VIDEO_SPEEDS.full.steps.pass1} 步、二采{' '}
              {VIDEO_SPEEDS.full.steps.pass2} 步，同样长度多花七成左右的时间。
            </>
          ) : (
            <>
              加速用 DaSiWa V2 加速版，不加速用完整版；SelfLift 那套的步数在下面自己填，切加速不动它。
            </>
          )}
        </p>
      </div>
      {workflow === 'two-pass' ? (
        <>
          <div className="vc-sec">
            <h4>
              步数<span className="meta">一采、二采每段各几步</span>
            </h4>
            <div className="row vc-steps">
              {(
                [
                  ['一采', 'pass1', 'vcSteps1', VIDEO_STEPS.pass1],
                  ['二采', 'pass2', 'vcSteps2', VIDEO_STEPS.pass2],
                ] as const
              ).map(([label, pass, id, limit]) => (
                <label className="field" key={pass}>
                  <span className="meta">{label}</span>
                  <CommitInput
                    className="input mono"
                    type="number"
                    id={id}
                    aria-label={`${label}步数`}
                    min={limit.min}
                    max={limit.max}
                    value={String(steps[pass])}
                    parse={integerBetween(limit.min, limit.max)}
                    onCommit={(v) => save({ steps: { ...steps, [pass]: Number(v) } })}
                  />
                </label>
              ))}
              <span className="meta vc-steps-now">
                现在是{settings.steps ? '自己改的' : `照「${SPEED_LABELS[settings.speed]}」`}
              </span>
            </div>
            <p className="hint">
              能填一采 {VIDEO_STEPS.pass1.min}–{VIDEO_STEPS.pass1.max}、二采 {VIDEO_STEPS.pass2.min}–{VIDEO_STEPS.pass2.max}。步数越多越细，同样长度花的时间大致按步数涨。
            </p>
          </div>
          <div className="vc-sec">
            <h4>
              二采重画多少<span className="meta">放大完那一遍按多少重画（denoise）</span>
            </h4>
            <div className="row vc-steps">
              <label className="field">
                <span className="meta">重画多少</span>
                <CommitInput
                  className="input mono"
                  type="number"
                  id="vcDenoise"
                  aria-label="二采重画多少"
                  step={VIDEO_DENOISE.step}
                  min={VIDEO_DENOISE.min}
                  max={VIDEO_DENOISE.max}
                  value={String(settings.denoise ?? VIDEO_DENOISE.default)}
                  parse={anyNumber}
                  onCommit={(v) => save({ denoise: Number(v) })}
                />
              </label>
              <span className="meta vc-denoise-now">{settings.denoise === undefined ? `现在是默认的 ${VIDEO_DENOISE.default}` : '现在是自己改的'}</span>
            </div>
            <p className="hint">
              放大完那一遍只重画多少：默认 {VIDEO_DENOISE.default} 是留着构图细修，越大改得越多、越容易跑偏，1 是照放大后的重出一遍。能填 {VIDEO_DENOISE.min} 到 {VIDEO_DENOISE.max}。
            </p>
          </div>
        </>
      ) : (
        <div className="vc-sec">
          <h4>
            步数<span className="meta">SelfLift 一套调度总共几步、前几步在低分辨率跑</span>
          </h4>
          <div className="row vc-steps">
            <label className="field">
              <span className="meta">总步数</span>
              <CommitInput
                className="input mono"
                type="number"
                id="vcSelfSteps"
                aria-label="SelfLift 总步数"
                min={VIDEO_SELFLIFT.steps.min}
                max={VIDEO_SELFLIFT.steps.max}
                value={String(selflift.steps)}
                parse={integerBetween(VIDEO_SELFLIFT.steps.min, VIDEO_SELFLIFT.steps.max)}
                onCommit={(v) => save({ selflift: { ...selflift, steps: Number(v) } })}
              />
            </label>
            <label className="field">
              <span className="meta">低分辨率跑几步</span>
              <CommitInput
                className="input mono"
                type="number"
                id="vcSelfTransition"
                aria-label="低分辨率跑几步"
                min={VIDEO_SELFLIFT.transitionStep.min}
                max={Math.max(VIDEO_SELFLIFT.transitionStep.min, selflift.steps - 1)}
                value={String(selflift.transitionStep)}
                parse={integerBetween(VIDEO_SELFLIFT.transitionStep.min, Math.max(VIDEO_SELFLIFT.transitionStep.min, selflift.steps - 1))}
                onCommit={(v) => save({ selflift: { ...selflift, transitionStep: Number(v) } })}
              />
            </label>
          </div>
          <p className="hint">
            总步数 {VIDEO_SELFLIFT.steps.min}–{VIDEO_SELFLIFT.steps.max}，低分辨率那几步要比总步数少至少 1（剩下的在高分辨率跑）。前面几步在低分辨率跑，是省时间的关键；抬上去之前跑得越多越省，也越容易在接缝上出问题。
          </p>
        </div>
      )}
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
          {workflow === 'two-pass'
            ? `先按这个大小生成一遍（一采），宽高按节点的比例算${ratioText}。越大越慢，要的显存越多。`
            : `这是出片大小除以放大倍数那个数（SelfLift 的 latent 按出片大小定，低分辨率那段由它自己缩），宽高按节点的比例算${ratioText}。越大越慢，要的显存越多。`}
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
        <p className="hint">
          {workflow === 'two-pass' ? '一采完不解码直接放大，再细修一遍（二采）。' : `乘上面那个数就是出片大小：出片 ${final.finalWidth}×${final.finalHeight}，低分辨率那段按这个的 ${selflift.lowresScale} 出。`}
        </p>
      </div>
      {workflow === 'selflift' && (
        <div className="vc-sec">
          <h4>
            低分辨率倍数、放大器<span className="meta">SelfLift 那套怎么抬上去</span>
          </h4>
          <div className="row vc-steps">
            <label className="field">
              <span className="meta">低分辨率倍数</span>
              <CommitInput
                className="input mono"
                type="number"
                id="vcSelfLowres"
                aria-label="低分辨率倍数"
                step={VIDEO_SELFLIFT.lowresScale.step}
                min={VIDEO_SELFLIFT.lowresScale.min}
                max={VIDEO_SELFLIFT.lowresScale.max}
                value={String(selflift.lowresScale)}
                parse={anyNumber}
                onCommit={(v) => save({ selflift: { ...selflift, lowresScale: Number(v) } })}
              />
            </label>
            <span className="meta vc-lowres-now">
              低分辨率那段 {Math.round(final.finalWidth * selflift.lowresScale / 32) * 32}×{Math.round(final.finalHeight * selflift.lowresScale / 32) * 32}
            </span>
          </div>
          <select className="select select-sm mono" id="vcSelfUpscaler" aria-label="提升用哪个放大器" value={selflift.upscaler} onChange={(e) => save({ selflift: { ...selflift, upscaler: e.target.value } })}>
            {pick(upscalers, selflift.upscaler).map((name) => (
              <option key={name} value={name}>
                {name === VIDEO_SELFLIFT.none ? '不用放大器（靠模型自己的像素锚点修）' : name}
              </option>
            ))}
          </select>
          <p className="hint">
            低分辨率缩到多少：{VIDEO_SELFLIFT.lowresScale.min} 到 {VIDEO_SELFLIFT.lowresScale.max}。抬上去用的是 H3 的潜空间放大器（照那份「U37 无色差」默认选 {VIDEO_SELFLIFT.upscaler}）；选「不用放大器」就走 SelfLift-zero，靠模型自己的 VAE 锚点修，接缝更稳但多一趟解码。
          </p>
        </div>
      )}
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
        <NameSelect what="主模型" className="gc-lora-name" value={settings.model} names={pick(models, settings.model)} onPick={(model) => save({ model })} />
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
              <NameSelect className="gc-lora-name" value={lora.name} names={pick(loras, lora.name)} onPick={(name) => save({ loras: settings.loras.map((l, j) => (j === i ? { ...l, name } : l)) })} what="LoRA" />
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
        <span className="meta">采样器、调度器、分段重叠照内置流程，不用调</span>
      </div>
    </Popover>
  );
}
