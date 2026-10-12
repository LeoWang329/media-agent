import {
  segmentCount,
  SELFLIFT_U37_LORAS,
  selfliftOfSettings,
  selfliftPlan,
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
  videoSecondsText,
  videoSettingsOf,
  videoSizes,
  workflowOfSettings,
  type AspectRatio,
  type ChatNode,
  type Message,
  type VideoLora,
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
import { VideoLeadPick } from './VideoLeadPick';

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
const WORKFLOW_LABELS: Record<VideoWorkflow, string> = { 'two-pass': '两遍生成', selflift: 'SelfLift 接续' };
const CONTEXT_LABELS: Record<number, string> = { 22: '22 帧（1 组）', 39: '39 帧（2 组）', 90: '90 帧（5 组）' };

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
  return (
    <Popover anchor={anchor} align="right" className="vc-pop" odId="popover-video-settings" label="生成设置" onClose={onClose} keepOpen={(t) => Boolean(t.closest('#btnVideoCfg, .gc-lora-pop'))}>
      <VideoSettingsBody node={node} />
    </Popover>
  );
}

// 生成设置的内容：「生成设置」那个小窗和点「生成视频」弹出来的窗用的是同一份，见 docs/dev-plan.md 5.36。
// message 给了就多几样跟这个框相关的（比如「续写起点」能挑这个框下面已生成的那条）
export function VideoSettingsBody({ node, message }: { node: ChatNode; message?: Message }) {
  const settings = videoSettingsOf(node.video);
  const workflow = workflowOfSettings(settings);
  const selflift = selfliftOfSettings(settings);
  const steps = stepsOfSettings(settings);
  // SelfLift 接续那套分几条接力：按节点现在的时长和「这长度该写几段」估，实际看框里写了几段
  const wantedSegments = segmentCount(node.duration);
  const plan = selfliftPlan(node.duration, wantedSegments, selflift.contextFrames);
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
  // 双 LoRA 双采：两遍各挂一套，改哪一边都是整份 selflift 存一遍
  const setPhaseLora = (key: 'lowresLora' | 'hiresLora', lora: VideoLora | null) =>
    save({ selflift: key === 'lowresLora' ? { ...selflift, lowresLora: lora } : { ...selflift, hiresLora: lora } });
  return (
    <>
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
            ? `两遍生成：先按一采大小出一遍，不解码放大到出片大小，再按「二采重画多少」细修一遍。分段接续在一个任务里跑完，能重拍一截。`
            : `SelfLift 接续：照实例上那份「U37 真-上下文无缝无色差」——一段一条片子接力出，第 1 段正常出，第 2 段起把上一段结尾的几帧当上下文钉进去、接着往下长，出完再把颜色对齐到上一段。一套调度里前 ${selflift.transitionStep} 步低分辨率、抬到出片大小跑完剩下的 ${selflift.steps - selflift.transitionStep} 步，没有放大这一步。这套不能重拍一截。`}
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
        <>
          <div className="vc-sec">
            <h4>
              续写起点<span className="meta">从一段已有的视频接着往下出；不选就是重新生成</span>
            </h4>
            <VideoLeadPick node={node} message={message} />
            <p className="hint">
              选了一段，出来的整条就是「这一段 + 按这个节点时长新出的几段」：新出的第 1 段先读它的尾巴（开头那几帧，出片时剪掉）钉进去接着往下长，
              出完再把两段接成一条。跟自己这个大小、帧率、有没有声音对不上的，会先在那台上规整一份（缩到出片大小、24 帧、没声音的补静音）。
            </p>
          </div>
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
          <div className="vc-sec">
            <h4>
              接上一段<span className="meta">第 2 段起拿上一段的尾巴当上下文</span>
            </h4>
            <div className="row vc-steps">
              <label className="field">
                <span className="meta">带几帧</span>
                <select
                  className="select select-sm mono"
                  id="vcSelfContext"
                  aria-label="接上一段带几帧"
                  value={selflift.contextFrames}
                  onChange={(e) => save({ selflift: { ...selflift, contextFrames: Number(e.target.value) } })}
                >
                  {VIDEO_SELFLIFT.contextFrames.map((frames) => (
                    <option key={frames} value={frames}>
                      {CONTEXT_LABELS[frames] ?? `${frames} 帧`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="meta">接缝加噪</span>
                <CommitInput
                  className="input mono"
                  type="number"
                  id="vcSelfNoise"
                  aria-label="接缝加多少噪"
                  step={VIDEO_SELFLIFT.noise.step}
                  min={VIDEO_SELFLIFT.noise.min}
                  max={VIDEO_SELFLIFT.noise.max}
                  value={String(selflift.noise)}
                  parse={anyNumber}
                  onCommit={(v) => save({ selflift: { ...selflift, noise: Number(v) } })}
                />
              </label>
              <label className="field">
                <span className="meta">偏色对齐</span>
                <CommitInput
                  className="input mono"
                  type="number"
                  id="vcSelfColor"
                  aria-label="偏色对齐强度"
                  step={VIDEO_SELFLIFT.colorMatch.step}
                  min={VIDEO_SELFLIFT.colorMatch.min}
                  max={VIDEO_SELFLIFT.colorMatch.max}
                  value={String(selflift.colorMatch)}
                  parse={anyNumber}
                  onCommit={(v) => save({ selflift: { ...selflift, colorMatch: Number(v) } })}
                />
              </label>
              <label className="field">
                <span className="meta">声音羽化</span>
                <CommitInput
                  className="input mono"
                  type="number"
                  id="vcSelfFeather"
                  aria-label="接缝声音羽化几个刻度"
                  step={VIDEO_SELFLIFT.audioFeather.step}
                  min={VIDEO_SELFLIFT.audioFeather.min}
                  max={VIDEO_SELFLIFT.audioFeather.max}
                  value={String(selflift.audioFeather)}
                  parse={integerBetween(VIDEO_SELFLIFT.audioFeather.min, VIDEO_SELFLIFT.audioFeather.max)}
                  onCommit={(v) => save({ selflift: { ...selflift, audioFeather: Number(v) } })}
                />
              </label>
            </div>
            <p className="hint" id="vcSelfPlan">
              按 {node.duration} 秒、{wantedSegments} 段提示词算，会分 {plan.lengths.length} 条接力、每条 {plan.lengths[0]} 帧（约{' '}
              {(plan.lengths[0] / 24).toFixed(1)} 秒），出来约 {videoSecondsText(plan.total)}（框里多写几段就更短更稳）。带几帧就是每条开头重复上一段的尾巴、出片时剪掉（照 U37 那三个档）；接缝加噪默认{' '}
              {0.1}，只给前几帧加、最后一帧不加；偏色对齐 0 到 1，把每条的颜色对到上一段的最后一帧上，0 是不对齐。
            </p>
            <p className="hint">
              声音羽化是接缝那几帧的声音两头抹平几档（U37 填 {12}，走 MiniMaxH3AudioGuideFeather 这个插件节点）：0 是不羽化、就不接那个节点，没装{' '}
              <span className="mono">ComfyUI-MiniMax-H3-Audio-Guide-Feather</span> 填 0 也能出。画面靠上下文帧接，声音是每段自己生成的，只有这几帧的声音是钉进去的。
              那个插件自带的补丁在 ComfyUI 0.38 上默认不生效、得先修一次，不然这个刻度等于白填（我们这台已经修过）；没把握就填 0。
            </p>
          </div>
          <div className="vc-sec">
            <h4>
              双 LoRA 双采<span className="meta">低分辨率那遍、高分辨率那遍各挂一套</span>
            </h4>
            <div className="gc-loras" id="vcSelfLoras">
              {(
                [
                  { key: 'lowresLora', label: '低分辨率', short: '8 步 0.75', lora: selflift.lowresLora, u37: SELFLIFT_U37_LORAS.lowres },
                  { key: 'hiresLora', label: '高分辨率', short: '4 步 0.7', lora: selflift.hiresLora, u37: SELFLIFT_U37_LORAS.hires },
                ] as const
              ).map((row) => (
                // 一行四个：名字、这一遍、LoRA、强度、去掉（照出图设置那行的排法，只是多一列标签）
                <div className="gc-lora vc-phase" key={row.key}>
                  <span className="meta">{row.label}</span>
                  {row.lora ? (
                    <>
                      <NameSelect
                        className="gc-lora-name"
                        value={row.lora.name}
                        names={pick(loras, row.lora.name)}
                        what={`${row.label}那遍的 LoRA`}
                        onPick={(name) => setPhaseLora(row.key, { ...row.lora!, name })}
                      />
                      <CommitInput
                        className="input mono"
                        type="number"
                        step={VIDEO_SELFLIFT.loraStrength.step}
                        min={VIDEO_SELFLIFT.loraStrength.min}
                        max={VIDEO_SELFLIFT.loraStrength.max}
                        aria-label={`${row.label}那遍的 LoRA 强度`}
                        value={String(row.lora.strength)}
                        parse={anyNumber}
                        onCommit={(v) => setPhaseLora(row.key, { ...row.lora!, strength: Number(v) })}
                      />
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${row.label}那遍不挂 LoRA`} onClick={() => setPhaseLora(row.key, null)}>
                        <Icon name="x" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm vc-phase-add"
                      title={`填 U37 用的那个（${row.u37.name}，强度 ${row.u37.strength}）；那台开着时点名字能换成别的 LoRA`}
                      onClick={() => setPhaseLora(row.key, { ...row.u37 })}
                    >
                      <Icon name="plus" />
                      挂一套<span className="meta">（U37：{row.short}）</span>
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                id="vcSelfU37Lora"
                title="把两遍都填成那份工作流里的：8 步 0.75 / 4 步 0.7；那台开着时点名字能换成别的 LoRA"
                onClick={() => save({ selflift: { ...selflift, lowresLora: { ...SELFLIFT_U37_LORAS.lowres }, hiresLora: { ...SELFLIFT_U37_LORAS.hires } } })}
              >
                <Icon name="retry" />
                照 U37 那套填上
              </button>
            </div>
            <p className="hint">
              这就是 U37 的「双采」：一套调度里低分辨率跑的那几步用一套 LoRA、抬到高分辨率跑剩下的步数时换成另一套（那边是 8 步加速 LoRA 0.75 和 4 步加速 LoRA 0.7），两套不用同一步数调出来的加速 LoRA
              互相将就。这两套接在主模型和注意力补丁之上，只有自己那一遍带；上面「LoRA」那栏挂的是两遍都带的（人物、风格那类）。不挂也不影响出片，就是踏踏实实按步数跑。
            </p>
          </div>
        </>
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
    </>
  );
}
