import type { ChatNode, Family, ImageRating, ImageSettings } from '@media-agent/shared';
import { useEffect } from 'react';
import { LanState } from '../components/ComfyPill';
import { useCanvasStore } from '../store/canvasStore';
import { useComfyStore } from '../store/comfyStore';
import { anyNumber, CommitInput, integerFrom, numberFrom, trimmed } from '../ui/CommitInput';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { effectiveCheckpoint, useImageSettings, usePromptInfo } from './imageNode';
import { useOverlays } from './overlays';

// 出图设置：每个节点各存一份，常动的放上面，很少动的收起来。改一项存一项，见 docs/dev-plan.md 5.14

export const RATING_LABELS: Record<ImageRating, string> = { none: '不加', general: '全年龄', sensitive: '擦边', explicit: '成人' };
const RATINGS = Object.keys(RATING_LABELS) as ImageRating[];

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
  const status = useComfyStore((s) => s.status);
  const checking = useComfyStore((s) => s.checking);

  useEffect(() => {
    void useComfyStore.getState().loadOptions();
    void useComfyStore.getState().checkStatus();
  }, []);

  const save = (patch: Partial<ImageSettings>) => void useCanvasStore.getState().patchNode(node.id, { image: patch });

  const mine = options?.checkpoints.filter((c) => c.family === family).map((c) => c.name) ?? [];
  const others = (options?.checkpoints.length ?? 0) - mine.length;
  const checkpoint = effectiveCheckpoint(image, family, options);
  // 节点选的底模这台 ComfyUI 上没有：也列出来，标明
  const checkpointList = checkpoint && !mine.includes(checkpoint) ? [checkpoint, ...mine] : mine;
  const loras = options?.loras ?? [];
  const pick = (list: string[], value: string) => (value && !list.includes(value) ? [value, ...list] : list);
  const ratingWord = image.rating === 'none' ? '（不加）' : defaults.rating[image.rating];

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
            用哪台 ComfyUI<span className="meta">所有节点共用</span>
          </h4>
          <span className="gc-src-state">
            <b>局域网那台</b>
            <LanState status={status} checking={checking} />
            {status?.url && <span className="meta mono">{status.url}</span>}
          </span>
        </div>
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
                {options && !mine.includes(name) ? '（这台 ComfyUI 上没有）' : ''}
              </option>
            ))}
          </select>
          {optionsError && (
            <p className="hint">
              <Icon name="info" className="icon-sm" />
              {optionsError}
            </p>
          )}
          {options && !mine.length && (
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
                <select
                  className="select"
                  aria-label="LoRA"
                  value={lora.name}
                  onChange={(e) => save({ loras: image.loras.map((l, j) => (j === i ? { ...l, name: e.target.value } : l)) })}
                >
                  {pick(loras, lora.name).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
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
        </div>
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
            <span className="meta mono">
              {image.steps} 步 · CFG {image.cfg} · {image.sampler} · {image.scheduler} · {RATING_LABELS[image.rating]}
            </span>
          </summary>
          <div className="gc-grid">
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
