import { GUIDE_SIZES, newDetailPass, scaledSize, UPSCALE_SCALES, type DetailPass, type UpscaleSettings } from '@media-agent/shared';
import { CommitInput, numberBetween, trimmed } from '../ui/CommitInput';
import { Icon } from '../ui/Icon';

// 放大和部位重绘的设置，出图设置和大图里「放大和重绘」共用，见 docs/dev-plan.md 5.21

// 选中的不在列表里（这台 ComfyUI 上没有）也列出来
const withValue = (list: string[], value: string) => (value && !list.includes(value) ? [value, ...list] : list);

// 放大，像 WebUI 的高清修复：放大模型放大后缩到出图尺寸乘倍数；重绘强度 0 是只放大不重画
export function UpscaleFields({ value, models, size, onChange }: { value: UpscaleSettings; models: string[]; size: { width: number; height: number }; onChange: (next: UpscaleSettings) => void }) {
  const set = (patch: Partial<UpscaleSettings>) => onChange({ ...value, ...patch });
  const target = scaledSize(size, value.scale);
  return (
    <div className="gc-stage" data-stage="upscale">
      <div className="seg" role="group" aria-label="放大">
        <button type="button" aria-pressed={!value.on} onClick={() => set({ on: false })}>
          不放大
        </button>
        <button type="button" aria-pressed={value.on} onClick={() => set({ on: true })}>
          放大
        </button>
      </div>
      {value.on && (
        <>
          <div className="gc-up">
            <select className="select" aria-label="放大模型" value={value.model} onChange={(e) => set({ model: e.target.value })}>
              {!value.model && <option value="">{models.length ? '选一个放大模型' : '这台 ComfyUI 上没有放大模型'}</option>}
              {withValue(models, value.model).map((name) => (
                <option key={name} value={name}>
                  {name}
                  {!models.includes(name) ? '（这台 ComfyUI 上没有）' : ''}
                </option>
              ))}
            </select>
            <div className="seg" role="group" aria-label="放大倍数">
              {UPSCALE_SCALES.map((scale) => (
                <button key={scale} type="button" aria-pressed={value.scale === scale} onClick={() => set({ scale })}>
                  {scale}×
                </button>
              ))}
            </div>
            <label className="ib-num">
              重绘强度
              <CommitInput
                className="input mono"
                type="number"
                min="0"
                max="1"
                step="0.05"
                aria-label="放大的重绘强度"
                value={String(value.denoise)}
                parse={numberBetween(0, 1)}
                onCommit={(v) => set({ denoise: Number(v) })}
              />
            </label>
          </div>
          <p className="hint">
            放大到 <span className="mono">{`${target.width}×${target.height}`}</span>。重绘强度 0 是只放大不重画（E02 就是这样）；越大补的细节越多，也越容易走样。
          </p>
        </>
      )}
    </div>
  );
}

// 部位重绘，像 WebUI 的 ADetailer：能加几道，按顺序做；每道一个检测模型
export function DetailPassList({ passes, detectors, onChange }: { passes: DetailPass[]; detectors: string[]; onChange: (next: DetailPass[]) => void }) {
  const set = (i: number, patch: Partial<DetailPass>) => onChange(passes.map((pass, j) => (j === i ? { ...pass, ...patch } : pass)));
  const move = (i: number, step: number) => {
    const next = [...passes];
    [next[i], next[i + step]] = [next[i + step], next[i]];
    onChange(next);
  };
  return (
    <div className="gc-passes" data-stage="details">
      {passes.map((pass, i) => (
        <div className={`gc-pass${pass.on ? '' : ' is-off'}`} key={i} data-pass={i}>
          <div className="gc-pass-top">
            <input type="checkbox" checked={pass.on} aria-label={`第 ${i + 1} 道开着`} onChange={(e) => set(i, { on: e.target.checked })} />
            <span className="gc-pass-n mono">{i + 1}</span>
            <select className="select" aria-label="检测模型" value={pass.detector} onChange={(e) => set(i, { detector: e.target.value })}>
              {!pass.detector && <option value="">选检测模型</option>}
              {withValue(detectors, pass.detector).map((name) => (
                <option key={name} value={name}>
                  {name.replace(/\.pt$/, '')}
                  {!detectors.includes(name) ? '（这台 ComfyUI 上没有）' : ''}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="往前挪" disabled={i === 0} onClick={() => move(i, -1)}>
              <Icon name="chev-down" className="icon-flip" />
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="往后挪" disabled={i === passes.length - 1} onClick={() => move(i, 1)}>
              <Icon name="chev-down" />
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="去掉这道" onClick={() => onChange(passes.filter((_, j) => j !== i))}>
              <Icon name="x" />
            </button>
          </div>
          <div className="gc-pass-nums">
            <label className="ib-num">
              检测阈值
              <CommitInput
                className="input mono"
                type="number"
                min="0"
                max="1"
                step="0.05"
                aria-label="检测阈值"
                value={String(pass.threshold)}
                parse={numberBetween(0, 1)}
                onCommit={(v) => set(i, { threshold: Number(v) })}
              />
            </label>
            <label className="ib-num">
              重绘强度
              <CommitInput
                className="input mono"
                type="number"
                min="0.05"
                max="1"
                step="0.05"
                aria-label="重绘强度"
                value={String(pass.denoise)}
                parse={numberBetween(0.01, 1)}
                onCommit={(v) => set(i, { denoise: Number(v) })}
              />
            </label>
            <label className="ib-num">
              重画尺寸
              <select className="select mono" aria-label="重画尺寸" value={pass.guideSize} onChange={(e) => set(i, { guideSize: Number(e.target.value) })}>
                {GUIDE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <CommitInput className="input mono" aria-label="这道的正面" placeholder="正面，不写就用框里的标签" value={pass.positive} parse={trimmed} onCommit={(v) => set(i, { positive: String(v) })} />
          <CommitInput className="input mono" aria-label="这道的负面" placeholder="负面，不写就用额外的负面词" value={pass.negative} parse={trimmed} onCommit={(v) => set(i, { negative: String(v) })} />
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={!detectors.length}
        title={detectors.length ? undefined : '这台 ComfyUI 上没有检测模型'}
        onClick={() => onChange([...passes, newDetailPass(detectors)])}
      >
        <Icon name="plus" />
        加一道
      </button>
    </div>
  );
}
