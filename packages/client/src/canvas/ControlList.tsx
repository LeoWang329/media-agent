import {
  CONTROL_LABELS,
  CONTROL_TYPES,
  controlChoices,
  controlModels,
  controlPreprocessors,
  generatedImages,
  newControl,
  NO_PREPROCESSOR,
  type ChatNode,
  type ComfyOptions,
  type ControlSettings,
  type ControlType,
  type GeneratedRef,
  type RefImage,
} from '@media-agent/shared';
import { useState } from 'react';
import { imageThumbUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { CommitInput, numberBetween } from '../ui/CommitInput';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { generatedThumb } from './imageActions';

// ControlNet，像 WebUI：能加几个，按顺序接；每个选类型、参考图、提取方式、模型、强度、起止，见 docs/dev-plan.md 5.21

// 选中的不在列表里（这台 ComfyUI 上没有）也列出来
const withValue = (list: string[], value: string) => (value && !list.includes(value) ? [value, ...list] : list);

export function ControlList({ node, controls, options, onChange }: { node: ChatNode; controls: ControlSettings[]; options: ComfyOptions | null; onChange: (next: ControlSettings[]) => void }) {
  const lists = { preprocessors: options?.preprocessors ?? [], controlnets: options?.controlnets ?? [] };
  const set = (i: number, patch: Partial<ControlSettings>) => onChange(controls.map((control, j) => (j === i ? { ...control, ...patch } : control)));
  return (
    <div className="gc-passes" data-stage="controls">
      {controls.map((control, i) => {
        const preprocessors = controlPreprocessors(control.type, lists.preprocessors);
        const models = controlModels(control.type, lists.controlnets);
        return (
          <div className={`gc-pass${control.on ? '' : ' is-off'}`} key={i} data-control={i}>
            <div className="gc-pass-top">
              <input type="checkbox" checked={control.on} aria-label={`第 ${i + 1} 个开着`} onChange={(e) => set(i, { on: e.target.checked })} />
              <span className="gc-pass-n mono">{i + 1}</span>
              <select
                className="select gc-cn-type"
                aria-label="类型"
                value={control.type}
                onChange={(e) => {
                  const type = e.target.value as ControlType;
                  set(i, { type, ...controlChoices(type, lists) });
                }}
              >
                {CONTROL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CONTROL_LABELS[type]}
                  </option>
                ))}
              </select>
              <select className="select" aria-label="ControlNet 模型" value={control.model} onChange={(e) => set(i, { model: e.target.value })}>
                {!control.model && <option value="">{lists.controlnets.length ? '选一个 ControlNet 模型' : '这台 ComfyUI 上没有 ControlNet 模型'}</option>}
                {withValue(models, control.model).map((name) => (
                  <option key={name} value={name}>
                    {name.replace(/\.(safetensors|pth|bin)$/, '')}
                    {!lists.controlnets.includes(name) ? '（这台 ComfyUI 上没有）' : ''}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="去掉这个" onClick={() => onChange(controls.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </div>
            <div className="gc-cn-row">
              <RefButton node={node} value={control.image} onPick={(image) => set(i, { image })} />
              <select className="select" aria-label="提取方式" value={control.preprocessor} onChange={(e) => set(i, { preprocessor: e.target.value })}>
                <option value={NO_PREPROCESSOR}>不提取，直接用这张</option>
                {withValue(preprocessors, control.preprocessor === NO_PREPROCESSOR ? '' : control.preprocessor).map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {options && !lists.preprocessors.includes(name) ? '（这台 ComfyUI 上没有）' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="gc-pass-nums">
              <label className="ib-num">
                强度
                <CommitInput
                  className="input mono"
                  type="number"
                  min="0"
                  max="2"
                  step="0.05"
                  aria-label="强度"
                  value={String(control.strength)}
                  parse={numberBetween(0, 2)}
                  onCommit={(v) => set(i, { strength: Number(v) })}
                />
              </label>
              <label className="ib-num" title="从采样的哪儿开始管，0 是一开始">
                起点
                <CommitInput
                  className="input mono"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  aria-label="起点"
                  value={String(control.start)}
                  parse={numberBetween(0, control.end)}
                  onCommit={(v) => set(i, { start: Number(v) })}
                />
              </label>
              <label className="ib-num" title="管到采样的哪儿，1 是到最后">
                终点
                <CommitInput
                  className="input mono"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  aria-label="终点"
                  value={String(control.end)}
                  parse={numberBetween(control.start, 1)}
                  onCommit={(v) => set(i, { end: Number(v) })}
                />
              </label>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...controls, newControl('depth', lists)])}>
        <Icon name="plus" />
        加一个
      </button>
    </div>
  );
}

// 这个节点出过的图里，这张现在排在那一组的第几张；删掉了是 -1
const generatedIndex = (node: ChatNode, ref: Extract<RefImage, { kind: 'generated' }>) =>
  node.messages[ref.messageId]?.images?.find((job) => job.id === ref.jobId)?.images.findIndex((image) => image.seed === ref.seed && image.status === 'done') ?? -1;

// 参考图：显示选中的那张，点开从槽位和这个节点出过的图里挑
export function RefButton({ node, value, onPick }: { node: ChatNode; value: RefImage | null; onPick: (image: RefImage) => void }) {
  const canvasId = useCanvasStore((s) => s.canvasId)!;
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  let thumb: string | null = null;
  let label = '选参考图';
  if (value?.kind === 'slot') {
    const at = node.slots.indexOf(value.imageId);
    thumb = imageThumbUrl(canvasId, value.imageId);
    label = at >= 0 ? `槽位 ${at + 1} 号` : '槽位里拿掉的图';
  } else if (value?.kind === 'generated') {
    const index = generatedIndex(node, value);
    thumb = index >= 0 ? generatedThumb(canvasId, node.id, { ...value, index, starred: false }) : null;
    label = index >= 0 ? `出过的图 · 种子 ${value.seed}` : '这张图删掉了';
  }
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm gc-cn-ref" aria-label="参考图" title={label} onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}>
        {thumb ? <img src={thumb} alt="" /> : <Icon name="image" />}
        <span>{label}</span>
      </button>
      {anchor && (
        <RefPicker
          anchor={anchor}
          node={node}
          canvasId={canvasId}
          value={value}
          onPick={(image) => {
            setAnchor(null);
            onPick(image);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}

const sameRef = (a: RefImage | null, b: RefImage) => JSON.stringify(a) === JSON.stringify(b);

function RefPicker({ anchor, node, canvasId, value, onPick, onClose }: { anchor: DOMRect; node: ChatNode; canvasId: string; value: RefImage | null; onPick: (image: RefImage) => void; onClose: () => void }) {
  const generated = generatedImages(Object.values(node.messages));
  const pick = (ref: GeneratedRef): RefImage => ({ kind: 'generated', messageId: ref.messageId, jobId: ref.jobId, seed: ref.seed });
  return (
    <Popover anchor={anchor} className="gc-ref-pop" odId="popover-reference-image" label="选参考图" onClose={onClose}>
      <h4>
        槽位里的<span className="meta">放进槽位的图</span>
      </h4>
      {node.slots.length ? (
        <div className="gp-imgs">
          {node.slots.map((imageId, i) => {
            const ref: RefImage = { kind: 'slot', imageId };
            return (
              <button key={imageId} type="button" className={sameRef(value, ref) ? 'is-on' : ''} aria-label={`槽位 ${i + 1} 号`} onClick={() => onPick(ref)}>
                <img src={imageThumbUrl(canvasId, imageId)} alt="" />
                <span className="num-badge">{i + 1}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="gp-none">槽位里还没有图。</p>
      )}
      <h4>
        这个节点出过的<span className="meta">新的在前</span>
      </h4>
      {generated.length ? (
        <div className="gp-imgs">
          {generated.map((ref) => (
            <button
              key={`${ref.jobId}-${ref.seed}`}
              type="button"
              className={sameRef(value, pick(ref)) ? 'is-on' : ''}
              aria-label={`出过的图，种子 ${ref.seed}`}
              onClick={() => onPick(pick(ref))}
            >
              <img src={generatedThumb(canvasId, node.id, ref)} alt="" />
            </button>
          ))}
        </div>
      ) : (
        <p className="gp-none">这个节点还没出过图。</p>
      )}
    </Popover>
  );
}
