import {
  DETAILER_NODES,
  missingNodeTypes,
  NO_PREPROCESSOR,
  PLUGIN_OF,
  type ChatNode,
  type ComfyTarget,
  type Family,
  type ImagePreset,
  type ImageRating,
  type ImageSettings,
  type LoraTarget,
  type TagWeighting,
} from '@media-agent/shared';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { LanState } from '../components/ComfyPill';
import { useCanvasStore } from '../store/canvasStore';
import { useComfyStore, type AutodlNow } from '../store/comfyStore';
import { usePresetStore } from '../store/presetStore';
import { useNodeWorkflow, useWorkflowStore } from '../store/workflowStore';
import { anyNumber, CommitInput, integerFrom, numberFrom, trimmed } from '../ui/CommitInput';
import { confirmBox } from '../ui/confirm';
import { ControlList } from './ControlList';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';
import { effectiveCheckpoint, useImageSettings, usePromptInfo } from './imageNode';
import { useOverlays } from './overlays';
import { DetailPassList, UpscaleFields } from './StageFields';

// 出图设置：每个节点各存一份，常动的放上面，很少动的收起来。改一项存一项，见 docs/dev-plan.md 5.14。
// 选了导入的工作流，底模、VAE、LoRA、步数、权重算法、ControlNet、放大、部位重绘这些照工作流里的，不显示。整套能存成预设、套用预设，见 5.21

export const RATING_LABELS: Record<ImageRating, string> = { none: '不加', general: '全年龄', sensitive: '擦边', explicit: '成人' };
const RATINGS = Object.keys(RATING_LABELS) as ImageRating[];
const LORA_TARGET_LABELS: Record<LoraTarget, string> = { both: '画图的模型和文字理解', model: '只作用在画图的模型' };
const LORA_TARGETS = Object.keys(LORA_TARGET_LABELS) as LoraTarget[];
const WEIGHTING_LABELS: Record<TagWeighting, string> = { comfy: 'ComfyUI 自带的', a1111: 'A1111 的' };
const WEIGHTINGS = Object.keys(WEIGHTING_LABELS) as TagWeighting[];

const close = () => useOverlays.setState({ genSettings: null });

export function GenSettingsDialog() {
  const nodeId = useOverlays((s) => s.genSettings);
  const node = useCanvasStore((s) => (nodeId ? s.nodes[nodeId] : undefined));
  return node ? <GenSettings node={node} /> : null;
}

function GenSettings({ node }: { node: ChatNode }) {
  const family: Family = usePromptInfo(node.systemPromptName)?.family ?? 'IL';
  const image = useImageSettings(node, family);
  const defaults = useCanvasStore((s) => s.defaults[family]);
  const options = useComfyStore((s) => s.options);
  const optionsError = useComfyStore((s) => s.optionsError);
  const target = useComfyStore((s) => s.target);
  const status = useComfyStore((s) => s.status);
  const autodl = useComfyStore((s) => s.autodl);
  const checking = useComfyStore((s) => s.checking);
  const workflows = useWorkflowStore((s) => s.list);
  const workflow = useNodeWorkflow(image.workflowId);
  const missing = workflow && options ? missingNodeTypes(workflow.graph, options.nodeTypes) : [];
  const presets = usePresetStore((s) => s.list);
  const mine = presets?.filter((preset) => preset.family === family) ?? [];
  // 开了部位重绘、开了要提取的 ControlNet，这台 ComfyUI 上却没装要用的插件
  const detailerMissing = options && image.details.some((pass) => pass.on) ? DETAILER_NODES.filter((type) => !options.nodeTypes.includes(type)) : [];
  const extractorMissing =
    options && image.controls.some((control) => control.on && control.preprocessor !== NO_PREPROCESSOR) && !options.nodeTypes.includes('AIO_Preprocessor');
  const weightingMissing = options && image.weighting === 'a1111' && !options.nodeTypes.includes('BNK_CLIPTextEncodeAdvanced');

  useEffect(() => {
    void useComfyStore.getState().loadTarget();
    void useComfyStore.getState().loadOptions();
    void useComfyStore.getState().checkStatus();
    void useComfyStore.getState().checkAutodl();
    useWorkflowStore
      .getState()
      .load()
      .catch((err: Error) => toast(`读不到导入的工作流：${err.message}`, { tone: 'danger', ms: 4500 }));
    usePresetStore
      .getState()
      .load()
      .catch((err: Error) => toast(`读不到预设：${err.message}`, { tone: 'danger', ms: 4500 }));
  }, []);

  const save = (patch: Partial<ImageSettings>) => void useCanvasStore.getState().patchNode(node.id, { image: patch });

  // 换了一台，底模、LoRA 这些下拉从那台重新读
  const switchTo = async (next: ComfyTarget) => {
    await useComfyStore.getState().setTarget(next);
    void useComfyStore.getState().loadOptions();
  };

  const familyCheckpoints = options?.checkpoints.filter((c) => c.family === family).map((c) => c.name) ?? [];
  const others = (options?.checkpoints.length ?? 0) - familyCheckpoints.length;
  const checkpoint = effectiveCheckpoint(image, family, options);
  // 节点选的底模这台 ComfyUI 上没有：也列出来，标明
  const checkpointList = checkpoint && !familyCheckpoints.includes(checkpoint) ? [checkpoint, ...familyCheckpoints] : familyCheckpoints;
  const loras = options?.loras ?? [];
  const pick = (list: string[], value: string) => (value && !list.includes(value) ? [value, ...list] : list);
  const ratingWord = image.rating === 'none' ? '（不加）' : defaults.rating[image.rating];
  // 收起来时一行写完，VAE 和权重算法不是默认的才写
  const rarely = [
    `${image.steps} 步`,
    `CFG ${image.cfg}`,
    image.sampler,
    image.scheduler,
    ...(image.vae ? [image.vae.replace(/\.(safetensors|pt|ckpt)$/, '')] : []),
    ...(image.weighting === 'a1111' ? ['A1111 权重'] : []),
    RATING_LABELS[image.rating],
  ].join(' · ');

  // 套用预设：张数和种子留着节点自己的；预设不存 ControlNet 的参考图，要重选
  const apply = (id: string) => {
    const preset = mine.find((p) => p.id === id);
    if (!preset) return;
    save({ ...preset.settings });
    toast(`套上了「${preset.name}」。张数和种子没动${preset.settings.controls.some((control) => control.on) ? '，ControlNet 的参考图要重选' : ''}`);
  };

  return (
    <Dialog className="gc-dialog" label="出图设置" odId="dialog-generation-settings" onClose={close}>
      <div className="dialog-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>出图设置</h2>
          <span className="meta">
            「{node.title}」自己的一份。新节点按 {family} 系列的默认值填
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dialog-body gc-body">
        <div className="gc-sec">
          <h4>
            用哪台 ComfyUI<span className="meta">所有节点共用，只记在这台电脑上</span>
          </h4>
          <div className="seg gc-src" role="group" aria-label="用哪台 ComfyUI">
            <button type="button" aria-pressed={target === 'lan'} data-gc="lan" onClick={() => void switchTo('lan')}>
              局域网那台
            </button>
            <button type="button" aria-pressed={target === 'autodl'} data-gc="autodl" onClick={() => void switchTo('autodl')}>
              AutoDL 实例
            </button>
          </div>
          <span className="gc-src-state">
            {target === 'autodl' ? (
              <AutodlSource autodl={autodl} />
            ) : (
              <>
                <LanState status={status} checking={checking} />
                {status?.url && <span className="meta mono">{status.url}</span>}
              </>
            )}
          </span>
        </div>
        <div className="gc-sec">
          <h4>
            预设<span className="meta">整套出图设置存个名字，换着用</span>
          </h4>
          <div className="row">
            <select className="select" id="gcPreset" aria-label="套用预设" value="" disabled={!mine.length} onChange={(e) => apply(e.target.value)}>
              <option value="">{presets === null ? '正在读预设…' : mine.length ? '套用一个预设…' : `还没有 ${family} 系列的预设`}</option>
              {mine.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <SavePreset family={family} image={image} />
          </div>
        </div>
        <div className="gc-sec">
          <h4>工作流</h4>
          <select className="select" id="gcWf" aria-label="工作流" value={workflow?.id ?? ''} onChange={(e) => save({ workflowId: e.target.value || null })}>
            <option value="">内置基础流程</option>
            {workflows?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}（导入的）
              </option>
            ))}
          </select>
          {workflow && (
            <p className="hint">
              <Icon name="info" className="icon-sm" />
              导入的工作流里，底模、LoRA、步数这些按它自己的来，这里不用填。程序只往里填提示词、种子、尺寸。
              {missing.length > 0 && (
                <>
                  <br />
                  <b className="gc-warn">这台 ComfyUI 上没有这几种节点：{missing.join('、')}，出图前会拦下来。</b>
                </>
              )}
            </p>
          )}
        </div>
        {!workflow && (
          <>
            <div className="gc-sec">
              <h4>
                底模
                <span className="meta">
                  只列标成 {family} 的{others > 0 ? `，另有 ${others} 个不是 ${family}` : ''}
                </span>
              </h4>
              <select className="select" id="gcCkpt" aria-label="底模" value={checkpoint} onChange={(e) => save({ checkpoint: e.target.value })} disabled={!checkpointList.length}>
                {!checkpointList.length && <option value="">{optionsError ? '读不到底模列表' : '正在读底模列表…'}</option>}
                {checkpointList.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {options && !familyCheckpoints.includes(name) ? '（这台 ComfyUI 上没有）' : ''}
                  </option>
                ))}
              </select>
              {optionsError && (
                <p className="hint">
                  <Icon name="info" className="icon-sm" />
                  {optionsError}
                </p>
              )}
              {options && !familyCheckpoints.length && (
                <p className="hint">
                  <Icon name="info" className="icon-sm" />
                  这台 ComfyUI 上没有标成 {family} 的底模，去设置「底模和默认值」里看看底模各标成了哪个系列。
                </p>
              )}
            </div>
            <div className="gc-sec">
              <h4>
                LoRA<span className="meta">可以挂几个，各带强度</span>
              </h4>
              <div className="gc-loras">
                {image.loras.map((lora, i) => (
                  <div className="gc-lora" key={i}>
                    <LoraSelect
                      value={lora.name}
                      loras={pick(loras, lora.name)}
                      onPick={(name) => save({ loras: image.loras.map((l, j) => (j === i ? { ...l, name } : l)) })}
                    />
                    <CommitInput
                      className="input mono"
                      type="number"
                      step="0.05"
                      min="-2"
                      max="2"
                      aria-label="强度"
                      value={String(lora.strength)}
                      parse={anyNumber}
                      onCommit={(v) => save({ loras: image.loras.map((l, j) => (j === i ? { ...l, strength: Number(v) } : l)) })}
                    />
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="去掉" onClick={() => save({ loras: image.loras.filter((_, j) => j !== i) })}>
                      <Icon name="x" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!loras.length}
                  title={loras.length ? undefined : '这台 ComfyUI 上没有 LoRA'}
                  onClick={() => save({ loras: [...image.loras, { name: loras.find((l) => !image.loras.some((x) => x.name === l)) ?? loras[0], strength: 0.8 }] })}
                >
                  <Icon name="plus" />
                  挂一个 LoRA
                </button>
              </div>
              {image.loras.length > 0 && (
                <div className="row gc-lora-target">
                  <span className="meta">作用在</span>
                  <div className="seg" role="group" aria-label="LoRA 作用在哪">
                    {LORA_TARGETS.map((loraTarget) => (
                      <button key={loraTarget} type="button" aria-pressed={image.loraTarget === loraTarget} onClick={() => save({ loraTarget })}>
                        {LORA_TARGET_LABELS[loraTarget]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="gc-sec">
              <h4>
                ControlNet<span className="meta">像 WebUI，照着参考图的姿势、深度这些画</span>
              </h4>
              <ControlList node={node} controls={image.controls} options={options} onChange={(controls) => save({ controls })} />
              <p className="hint">
                <Icon name="info" className="icon-sm" />
                <span>
                  参考图从这个节点的槽位和出过的图里选。提取方式把参考图变成姿势图、深度图这些，参考图本来就是的选「不提取」。IL 用 NoobAI-XL 出的 ControlNet（比如深度
                  noob-sdxl-controlnet-depth_midas、姿势 noob_openpose），Pony 用通用 SDXL 的（比如 xinsir 的 union，一个文件管好几种）。
                  {extractorMissing && (
                    <b className="gc-warn">
                      {' '}
                      这台 ComfyUI 上没有 AIO_Preprocessor，要装 {PLUGIN_OF.AIO_Preprocessor}，出图前会拦下来；选「不提取」的不受影响。
                    </b>
                  )}
                </span>
              </p>
            </div>
            <div className="gc-sec">
              <h4>
                放大<span className="meta">像 WebUI 的高清修复，出图时自动做</span>
              </h4>
              <UpscaleFields value={image.upscale} models={options?.upscaleModels ?? []} size={image} onChange={(upscale) => save({ upscale })} />
            </div>
            <div className="gc-sec">
              <h4>
                部位重绘<span className="meta">像 WebUI 的 ADetailer，找到脸、手这些地方再重画</span>
              </h4>
              <DetailPassList passes={image.details} detectors={options?.detectors ?? []} sams={options?.sams ?? []} onChange={(details) => save({ details })} />
              <p className="hint">
                <Icon name="info" className="icon-sm" />
                <span>
                  按顺序做。检测模型名字里 face 是脸、hand 是手、person 是人；bbox 下的重画整个框，segm 下的只重画轮廓里面；选了 SAM 的先用它把框收成脸、手的形状再重画（E02 就这样）。这道写了正面就换掉框里的标签，写了负面就换掉额外的负面词，系列固定开头和默认负面词照加。
                  {detailerMissing.length > 0 && (
                    <b className="gc-warn">
                      {' '}
                      这台 ComfyUI 上没有 {detailerMissing.join('、')}，要装 {[...new Set(detailerMissing.map((type) => PLUGIN_OF[type]))].join('、')}，出图前会拦下来。
                    </b>
                  )}
                </span>
              </p>
            </div>
          </>
        )}
        <div className="gc-sec">
          <h4>种子</h4>
          <div className="row">
            <div className="seg" role="group" aria-label="种子">
              <button type="button" aria-pressed={image.seed === null} onClick={() => save({ seed: null })}>
                每次随机
              </button>
              <button type="button" aria-pressed={image.seed !== null} onClick={() => image.seed === null && save({ seed: Math.floor(Math.random() * 2 ** 32) })}>
                固定一个数
              </button>
            </div>
            {image.seed !== null && (
              <CommitInput className="input mono" id="gcSeed" style={{ width: 150 }} aria-label="种子" value={String(image.seed)} parse={integerFrom(0)} onCommit={(v) => save({ seed: Number(v) })} />
            )}
          </div>
          <p className="hint">出几张就用几个种子，从这个数往上依次加 1。随机时第一个随机取。</p>
        </div>
        <details className="gc-more">
          <summary>
            <Icon name="chev-down" className="icon-sm chev" />
            很少动的
            <span className="meta mono">{workflow ? `评级 ${RATING_LABELS[image.rating]}` : rarely}</span>
          </summary>
          <div className="gc-grid">
            {!workflow && (
              <>
                <div className="field">
                  <label htmlFor="gcSteps">步数</label>
                  <CommitInput className="input mono" id="gcSteps" type="number" min="1" max="150" value={String(image.steps)} parse={integerFrom(1)} onCommit={(v) => save({ steps: Number(v) })} />
                </div>
                <div className="field">
                  <label htmlFor="gcCfg">
                    CFG<span className="muted">（提示词管得多严）</span>
                  </label>
                  <CommitInput
                    className="input mono"
                    id="gcCfg"
                    type="number"
                    min="1"
                    max="30"
                    step="0.5"
                    value={String(image.cfg)}
                    parse={numberFrom(0)}
                    onCommit={(v) => save({ cfg: Number(v) })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="gcSampler">采样器</label>
                  <select className="select" id="gcSampler" value={image.sampler} onChange={(e) => save({ sampler: e.target.value })}>
                    {pick(options?.samplers ?? [], image.sampler).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="gcSched">调度器</label>
                  <select className="select" id="gcSched" value={image.scheduler} onChange={(e) => save({ scheduler: e.target.value })}>
                    {pick(options?.schedulers ?? [], image.scheduler).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field gc-wide">
                  <label htmlFor="gcVae">
                    VAE<span className="muted">（把画好的变成图片，影响颜色和细节）</span>
                  </label>
                  <select className="select" id="gcVae" value={image.vae} onChange={(e) => save({ vae: e.target.value })}>
                    <option value="">底模自带的</option>
                    {pick(options?.vaes ?? [], image.vae).map((name) => (
                      <option key={name} value={name}>
                        {name}
                        {options && !options.vaes.includes(name) ? '（这台 ComfyUI 上没有）' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field gc-wide">
                  <span className="label">带权重的标签怎么算</span>
                  <div className="seg" id="gcWeighting" role="group" aria-label="权重算法">
                    {WEIGHTINGS.map((weighting) => (
                      <button key={weighting} type="button" aria-pressed={image.weighting === weighting} onClick={() => save({ weighting })}>
                        {WEIGHTING_LABELS[weighting]}
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    标签写成 <span className="mono">(blonde hair:1.2)</span> 这样带权重时，两种算法出来不一样。A1111 的和 WebUI 一样，要装 {PLUGIN_OF.BNK_CLIPTextEncodeAdvanced} 插件。
                    {weightingMissing && <b className="gc-warn"> 这台 ComfyUI 上没装，出图前会拦下来。</b>}
                  </p>
                </div>
              </>
            )}
            <div className="field gc-wide">
              <span className="label">评级</span>
              <div className="seg" id="gcRating" role="group" aria-label="评级">
                {RATINGS.map((rating) => (
                  <button key={rating} type="button" aria-pressed={image.rating === rating} onClick={() => save({ rating })}>
                    {RATING_LABELS[rating]}
                  </button>
                ))}
              </div>
              <p className="hint">
                选了会在固定开头后面加一个评级词：{family} 系列写成 <span className="mono">{ratingWord}</span>。
              </p>
            </div>
            <div className="field gc-wide">
              <label htmlFor="gcNeg">
                额外的负面词<span className="muted">（接在系列默认负面词后面）</span>
              </label>
              <CommitInput className="input mono" id="gcNeg" value={image.negativeExtra} placeholder="比如：glasses, hat" parse={trimmed} onCommit={(v) => save({ negativeExtra: String(v) })} />
            </div>
          </div>
        </details>
      </div>
      <div className="dialog-foot">
        <span className="meta grow">改了自动存，下次点「生图」就用新的</span>
        <button type="button" className="btn btn-primary" onClick={close}>
          好了
        </button>
      </div>
    </Dialog>
  );
}

// 存成预设：起个名字；这个系列已经有同名的，问要不要换掉
function SavePreset({ family, image }: { family: Family; image: ImageSettings }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [name, setName] = useState('');

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const { count: _count, seed: _seed, ...settings } = image;
    const existing = usePresetStore.getState().list?.find((p) => p.family === family && p.name === trimmedName);
    try {
      if (existing) {
        const ok = await confirmBox({ title: `换掉「${trimmedName}」？`, body: `${family} 系列已经有叫「${trimmedName}」的预设，换成现在这套出图设置。`, ok: '换掉' });
        if (!ok) return;
        usePresetStore.getState().put(await trackWrite(api<ImagePreset>(`/image-presets/${existing.id}`, { method: 'PATCH', body: { settings } })));
      } else {
        usePresetStore.getState().put(await trackWrite(api<ImagePreset>('/image-presets', { method: 'POST', body: { name: trimmedName, family, settings } })));
      }
      setAnchor(null);
      setName('');
      toast(`存成了预设「${trimmedName}」`);
    } catch (err) {
      toast((err as Error).message, { tone: 'danger', ms: 4500 });
    }
  };

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" id="gcSavePreset" onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}>
        <Icon name="plus" />
        存成预设…
      </button>
      {anchor && (
        <Popover anchor={anchor} className="gc-preset-pop" odId="popover-save-preset" label="存成预设" onClose={() => setAnchor(null)}>
          <div className="row">
            <input
              className="input"
              data-autofocus
              aria-label="预设的名字"
              placeholder="起个名字，比如 E02"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
            <button type="button" className="btn btn-primary btn-sm" disabled={!name.trim()} onClick={() => void save()}>
              存
            </button>
          </div>
          <p className="hint">存张数、种子以外的全部出图设置，{family} 系列的节点能套用。</p>
        </Popover>
      )}
    </>
  );
}

// 选 LoRA：点开能按名字搜。几个词用空格隔开，名字里都有才列出来，不分大小写；上下键挑、回车选。
// 视频节点选主模型也用它，what 是选的是什么
export function LoraSelect({ value, loras, onPick, what = 'LoRA' }: { value: string; loras: string[]; onPick: (name: string) => void; what?: string }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button type="button" className="select gc-lora-name" aria-label={what} title={value} onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}>
        {value}
      </button>
      {anchor && (
        <LoraSearch
          anchor={anchor}
          value={value}
          loras={loras}
          what={what}
          onPick={(name) => {
            setAnchor(null);
            onPick(name);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}

function LoraSearch({ anchor, value, loras, what, onPick, onClose }: { anchor: DOMRect; value: string; loras: string[]; what: string; onPick: (name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  // 刚打开时停在现在选的那个上
  const [active, setActive] = useState(() => Math.max(0, loras.indexOf(value)));
  const list = useRef<HTMLDivElement>(null);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = loras.filter((name) => words.every((word) => name.toLowerCase().includes(word)));

  useEffect(() => {
    list.current?.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
  }, [active, q]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + step, 0), shown.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) onPick(shown[active]);
    }
  };

  return (
    <Popover anchor={anchor} className="gc-lora-pop" odId="popover-pick-lora" label={`选 ${what}`} onClose={onClose}>
      <input
        className="input"
        placeholder={`搜名字，一共 ${loras.length} 个`}
        aria-label={`搜 ${what}`}
        data-autofocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="gc-lora-list" role="listbox" aria-label={`${what} 列表`} ref={list}>
        {shown.map((name, i) => (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={name === value}
            className={`gc-lora-opt${i === active ? ' is-on' : ''}`}
            onMouseMove={() => setActive(i)}
            onClick={() => onPick(name)}
          >
            {name}
          </button>
        ))}
        {!shown.length && <p className="gp-none">没有名字里带「{q.trim()}」的 {what}</p>}
      </div>
    </Popover>
  );
}

// AutoDL 现在怎样：开着就在扣钱；关着的点生图时自动开机
function AutodlSource({ autodl }: { autodl: AutodlNow | null }) {
  switch (autodl?.state) {
    case 'running':
      return (
        <span className="tag tag-warn">
          <Icon name="power" />
          运行中 · 在扣钱
        </span>
      );
    case 'booting':
      return <span className="tag tag-accent">正在开机</span>;
    case 'stopping':
      return <span className="tag">正在关机</span>;
    case 'failed':
      return <span className="tag tag-danger">开机失败</span>;
    case 'unknown':
      return <span className="tag tag-danger">查不到状态</span>;
    case 'unset':
      return (
        <>
          <span className="tag">还没设置</span>
          <span className="meta">在设置的「ComfyUI」里填 Token、选实例</span>
        </>
      );
    case 'off':
      return (
        <>
          <span className="tag">已关机</span>
          <span className="meta">点生图时自动开机</span>
        </>
      );
    default:
      return (
        <span className="meta">
          <span className="spinner" /> 正在查…
        </span>
      );
  }
}
