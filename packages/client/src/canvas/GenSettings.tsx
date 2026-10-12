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
  kreaDefaults,
  KREA2_EDIT_LONG_SIDE,
  KREA2_EDIT_PRESETS,
  editPresetOf,
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
import { ControlList, RefButton } from './ControlList';
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
  const family = usePromptInfo(node?.systemPromptName ?? '')?.family;
  return node ? family === 'Krea2' ? <KreaGenSettings node={node} /> : <GenSettings node={node} /> : null;
}

function KreaGenSettings({ node }: { node: ChatNode }) {
  const image = useImageSettings(node, 'Krea2');
  const krea = image.krea!;
  // 这一组 LoRA 是哪个编辑方案（手动改过就是「自己选的」）
  const editPreset = editPresetOf(image.loras);
  const options = useComfyStore((s) => s.options);
  const target = useComfyStore((s) => s.target);
  const status = useComfyStore((s) => s.status);
  const autodl = useComfyStore((s) => s.autodl);
  const checking = useComfyStore((s) => s.checking);
  const optionsError = useComfyStore((s) => s.optionsError);
  const presets = usePresetStore((s) => s.list)?.filter((p) => p.family === 'Krea2') ?? [];
  useEffect(() => {
    void useComfyStore.getState().loadTarget();
    void useComfyStore.getState().loadOptions();
    void useComfyStore.getState().checkStatus();
    void useComfyStore.getState().checkAutodl();
    void usePresetStore
      .getState()
      .load()
      .catch((err: Error) => toast(err.message, { tone: 'danger' }));
  }, []);
  const save = (patch: Partial<ImageSettings>) => void useCanvasStore.getState().patchNode(node.id, { image: patch });
  const select = (id: string, label: string, value: string, values: string[], onPick: (value: string) => void) => (
    <label className="field" htmlFor={id}>
      {label}
      <select className="select" id={id} value={value} onChange={(e) => onPick(e.target.value)}>
        {[...new Set([value, ...values])].filter(Boolean).map((name) => (
          <option key={name} value={name}>
            {name}
            {options && !values.includes(name) ? '（这台 ComfyUI 上没有）' : ''}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Dialog className="gc-dialog" label="出图设置" onClose={close}>
      <div className="dialog-head">
        <h2>Krea2 出图设置</h2>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dialog-body gc-body">
        <div className="gc-sec">
          <h4>用哪台 ComfyUI</h4>
          <div className="seg" role="group" aria-label="用哪台 ComfyUI">
            {(['lan', 'autodl'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={target === value}
                onClick={async () => {
                  await useComfyStore.getState().setTarget(value);
                  void useComfyStore.getState().loadOptions();
                }}
              >
                {value === 'lan' ? '局域网那台' : 'AutoDL 实例'}
              </button>
            ))}
          </div>
          {target === 'autodl' ? <AutodlSource autodl={autodl} /> : <LanState status={status} checking={checking} />}
          {optionsError && <p className="hint">{optionsError}</p>}
        </div>
        <div className="gc-sec">
          <h4>预设</h4>
          <div className="row">
            <select
              className="select"
              id="gcPreset"
              aria-label="套用预设"
              value=""
              onChange={(e) => {
                const p = presets.find((p) => p.id === e.target.value);
                if (p) save(p.settings);
              }}
            >
              <option value="">套用 Krea2 预设…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <SavePreset family="Krea2" image={image} />
          </div>
        </div>
        <div className="gc-sec">
          <h4>起图</h4>
          <div className="seg" role="group" aria-label="起图">
            {(['text', 'four-view', 'edit'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={krea.mode === mode}
                onClick={() => {
                  if (mode === krea.mode) return;
                  const defaults = kreaDefaults(mode);
                  save({ ...defaults, count: image.count, krea: { ...defaults.krea!, reference: krea.reference, referenceB: krea.referenceB ?? null, extra: krea.extra } });
                }}
              >
                {mode === 'text' ? '文生图' : mode === 'four-view' ? '四视图' : '编辑'}
              </button>
            ))}
          </div>
          {krea.mode !== 'text' && (
            <div className="stack">
              {/* 编辑档能给两张：图 1 是场景、图 2 是主体（T07 的「双图」，顺序是训练时定的）；没选图 2 就是单图 */}
              {krea.mode === 'edit' ? (
                <>
                  <span className="meta">图 1 · 场景：构图、背景、姿势</span>
                  <RefButton node={node} value={krea.reference} onPick={(reference) => save({ krea: { ...krea, reference } })} />
                  <span className="meta">图 2 · 人物：长相、身份（可不选）</span>
                  <RefButton what="第二张参考图" node={node} value={krea.referenceB ?? null} onPick={(referenceB) => save({ krea: { ...krea, referenceB } })} />
                </>
              ) : (
                <RefButton node={node} value={krea.reference} onPick={(reference) => save({ krea: { ...krea, reference } })} />
              )}
              {krea.mode === 'edit' && krea.referenceB ? (
                <>
                  <label className="field">
                    图 1（场景）相似度
                    <CommitInput
                      className="input mono"
                      id="gcRefBoostA"
                      type="number"
                      step="0.5"
                      min="0"
                      max="10"
                      aria-label="场景相似度"
                      value={String(krea.refBoostA ?? 1)}
                      parse={numberFrom(0)}
                      onCommit={(v) => save({ krea: { ...krea, refBoostA: Number(v) } })}
                    />
                  </label>
                  <label className="field">
                    图 2（人物）相似度
                    <CommitInput
                      className="input mono"
                      id="gcRefBoost"
                      type="number"
                      step="0.5"
                      min="0"
                      max="10"
                      aria-label="参考图相似度"
                      value={String(krea.refBoost)}
                      parse={numberFrom(0)}
                      onCommit={(v) => save({ krea: { ...krea, refBoost: Number(v) } })}
                    />
                  </label>
                </>
              ) : (
                <label className="field">
                  参考图相似度
                  <CommitInput
                    className="input mono"
                    id="gcRefBoost"
                    type="number"
                    step="0.5"
                    min="0"
                    max="10"
                    aria-label="参考图相似度"
                    value={String(krea.refBoost)}
                    parse={numberFrom(0)}
                    onCommit={(v) => save({ krea: { ...krea, refBoost: Number(v) } })}
                  />
                </label>
              )}
              {krea.mode === 'four-view' ? (
                <p className="hint">生成脸部特写、正面、侧面和背面全身四视图。框中文字作为额外要求；默认 1536×1024，尺寸可在面板上调整。</p>
              ) : (
                <>
                  {/* 编辑方案：选一个就把它的 LoRA 和作者给的推荐参数填进去，之后还能手动改 */}
                  <label className="field">
                    编辑方案
                    <select
                      className="select"
                      id="gcEditPreset"
                      aria-label="编辑方案"
                      value={editPreset?.id ?? ''}
                      onChange={(e) => {
                        const picked = KREA2_EDIT_PRESETS.find((preset) => preset.id === e.target.value);
                        if (picked) save({ ...picked.settings, loras: picked.loras.map((lora) => ({ ...lora })) });
                      }}
                    >
                      <option value="">自己选的 LoRA</option>
                      {KREA2_EDIT_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editPreset && <p className="hint">{editPreset.note}</p>}
                  <p className="hint">
                    图 1 定场景（构图、背景、姿势），图 2 定人物长相；两张都选就是把图 2 的人放进图 1 的场景里。
                    框里写清要改什么——模型照这句话重画整张，改哪儿它自己找，不用涂；没提到的部分也可能跟着变一点。
                  </p>
                  <p className="hint">
                    这一档按参考图的比例出图，长边缩到 {KREA2_EDIT_LONG_SIDE} 再画（V3 那个 LoRA 是 2K 训的，缩到 1MP 会糊），
                    所以面板上的尺寸、还有上面那个「参考图相似度」这一档都不看（相似度是四视图那条路的）。
                    写实测不出来的话，先看「文字理解模型」是不是去审查那个、底模是不是写实类的。
                  </p>
                </>
              )}
            </div>
          )}
        </div>
        <div className="gc-sec">
          <label className="field">
            底模
            <NameSelect
              id="gcCkpt"
              what="底模"
              className="gc-lora-name"
              value={image.checkpoint}
              names={[...new Set([image.checkpoint, ...(options?.kreaModels ?? [])])].filter(Boolean)}
              onPick={(checkpoint) => save({ checkpoint })}
              note={(name) => (options && !(options.kreaModels ?? []).includes(name) ? '（这台 ComfyUI 上没有）' : undefined)}
            />
          </label>
          {select('gcTextEncoder', '文字理解模型', image.textEncoder ?? '', options?.textEncoders ?? [], (textEncoder) => save({ textEncoder }))}
          {select('gcVae', 'VAE', image.vae, options?.vaes ?? [], (vae) => save({ vae }))}
        </div>
        <div className="gc-sec">
          <h4>LoRA</h4>
          <div className="gc-loras">
            {image.loras.map((lora, i) => (
              <div className="gc-lora" key={i}>
                <NameSelect
                  className="gc-lora-name"
                  value={lora.name}
                  names={[...new Set([lora.name, ...(options?.loras.filter((name) => /krea/i.test(name)) ?? [])])]}
                  onPick={(name) => save({ loras: image.loras.map((l, j) => (j === i ? { ...l, name } : l)) })}
                  what="LoRA"
                />
                <CommitInput
                  className="input mono"
                  type="number"
                  step="0.05"
                  aria-label="强度"
                  value={String(lora.strength)}
                  parse={anyNumber}
                  onCommit={(v) => save({ loras: image.loras.map((l, j) => (j === i ? { ...l, strength: Number(v) } : l)) })}
                />
                <button type="button" className="btn btn-ghost btn-icon" aria-label="去掉" onClick={() => save({ loras: image.loras.filter((_, j) => j !== i) })}>
                  <Icon name="x" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!options?.loras.some((name) => /krea/i.test(name))}
              onClick={() => save({ loras: [...image.loras, { name: options!.loras.find((name) => /krea/i.test(name))!, strength: 1 }] })}
            >
              <Icon name="plus" />
              挂一个 LoRA
            </button>
          </div>
        </div>
        <div className="gc-sec gc-grid">
          <label className="field">
            步数
            <CommitInput
              className="input mono"
              id="gcSteps"
              type="number"
              min="1"
              aria-label="步数"
              value={String(image.steps)}
              parse={integerFrom(1)}
              onCommit={(v) => save({ steps: Number(v) })}
            />
          </label>
          <label className="field">
            CFG
            <CommitInput
              className="input mono"
              id="gcCfg"
              type="number"
              min="0"
              step="0.1"
              aria-label="CFG"
              value={String(image.cfg)}
              parse={numberFrom(0)}
              onCommit={(v) => save({ cfg: Number(v) })}
            />
          </label>
          {select('gcSampler', '采样器', image.sampler, options?.samplers ?? [], (sampler) => save({ sampler }))}
          {select('gcScheduler', '调度器', image.scheduler, options?.schedulers ?? [], (scheduler) => save({ scheduler }))}
          <label className="field">
            种子（空着随机）
            <CommitInput
              className="input mono"
              id="gcSeed"
              aria-label="种子"
              value={image.seed === null ? '' : String(image.seed)}
              parse={(v) => (v.trim() ? integerFrom(0)(v) : '')}
              onCommit={(v) => save({ seed: v === '' ? null : Number(v) })}
            />
          </label>
        </div>
      </div>
    </Dialog>
  );
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
              <NameSelect
                id="gcCkpt"
                what="底模"
                className="gc-lora-name"
                value={checkpoint}
                names={checkpointList}
                onPick={(checkpoint) => save({ checkpoint })}
                note={(name) => (options && !familyCheckpoints.includes(name) ? '（这台 ComfyUI 上没有）' : undefined)}
                disabled={!checkpointList.length}
                empty={optionsError ? '读不到底模列表' : '正在读底模列表…'}
              />
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
                    <NameSelect
                      className="gc-lora-name"
                      value={lora.name}
                      names={pick(loras, lora.name)}
                      onPick={(name) => save({ loras: image.loras.map((l, j) => (j === i ? { ...l, name } : l)) })}
                      what="LoRA"
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

// 选名字：点开能按名字搜。几个词用空格隔开，名字里都有才列出来，不分大小写；上下键挑、回车选。
// LoRA、视频节点的主模型、底模都用它，what 是选的是什么。
// note 给某个名字后面加一句小字（比如「这台 ComfyUI 上没有」）；names 是空的时候按钮上写 empty 那句话、点不动
export function NameSelect({
  id,
  value,
  names,
  onPick,
  what,
  className = '',
  note,
  disabled,
  empty,
}: {
  id?: string;
  value: string;
  names: string[];
  onPick: (name: string) => void;
  what: string;
  className?: string;
  note?: (name: string) => string | undefined;
  disabled?: boolean;
  empty?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const said = names.length ? value : (empty ?? value);
  return (
    <>
      <button
        type="button"
        id={id}
        className={`select${className ? ` ${className}` : ''}`}
        aria-label={what}
        title={said}
        disabled={disabled}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        {said}
      </button>
      {anchor && (
        <NameSearch
          anchor={anchor}
          value={value}
          names={names}
          what={what}
          note={note}
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

function NameSearch({ anchor, value, names, what, note, onPick, onClose }: { anchor: DOMRect; value: string; names: string[]; what: string; note?: (name: string) => string | undefined; onPick: (name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  // 刚打开时停在现在选的那个上
  const [active, setActive] = useState(() => Math.max(0, names.indexOf(value)));
  const list = useRef<HTMLDivElement>(null);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = names.filter((name) => words.every((word) => name.toLowerCase().includes(word)));

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
    <Popover anchor={anchor} className="gc-lora-pop" odId="popover-pick-name" label={`选 ${what}`} onClose={onClose}>
      <input
        className="input"
        placeholder={`搜名字，一共 ${names.length} 个`}
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
        {shown.map((name, i) => {
          const hint = note?.(name);
          return (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={name === value}
              title={name}
              className={`gc-lora-opt${i === active ? ' is-on' : ''}`}
              onMouseMove={() => setActive(i)}
              onClick={() => onPick(name)}
            >
              {name}
              {hint && <span className="gc-opt-note">{hint}</span>}
            </button>
          );
        })}
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
