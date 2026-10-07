import { latentFrame, nearestLatent, reshootPlan, reshootText, reshootWhere, videoWindowStarts, type VideoJob } from '@media-agent/shared';
import { useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { reshootVideo, type VideoPlace } from './videoActions';

// 视频下面的时间条：按段画好分隔，拖选一截重拍；选好后能改种子和这一截所在段的提示词，见 docs/dev-plan.md 5.30

type Props = { place: VideoPlace; job: VideoJob; seek: (frame: number) => void; onStart: () => void };

export function VideoReshoot({ place, job, seek, onStart }: Props) {
  const { params } = job;
  const total = params.frames.total;
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [seed, setSeed] = useState('');
  const [prompts, setPrompts] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  // 按下时在哪一帧；没在拖是 null
  const anchor = useRef<number | null>(null);

  // 鼠标在时间条上的位置对齐到最近的潜空间帧
  const frameAt = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(total, latentFrame(nearestLatent(x * total)));
  };
  const pct = (frame: number) => `${(frame / total) * 100}%`;
  const starts = [0, ...videoWindowStarts(params), total];

  const plan = range && range.to > range.from ? reshootPlan(params, range.from, range.to) : null;
  const windows = plan ? params.segments.map((_, i) => i).slice(plan.firstWindow, plan.lastWindow + 1) : [];

  const submit = async () => {
    if (!plan) return;
    const edited = Object.fromEntries(windows.flatMap((i) => (prompts[i]?.trim() && prompts[i] !== params.segments[i] ? [[i, prompts[i]]] : [])));
    setSending(true);
    const ok = await reshootVideo(place, job, { from: plan.from, to: plan.to, seed: seed.trim() ? Number(seed) : null, prompts: edited });
    setSending(false);
    if (!ok) return;
    setRange(null);
    setPrompts({});
    setSeed('');
    onStart();
  };

  return (
    <div className="vrs" data-od-id="video-reshoot">
      <div
        ref={bar}
        className="vrs-bar"
        data-from={plan?.from}
        data-to={plan?.to}
        title="拖选要重拍的一截"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const at = frameAt(e.clientX);
          anchor.current = at;
          setRange({ from: at, to: at });
          seek(at);
        }}
        onPointerMove={(e) => {
          if (anchor.current === null) return;
          const at = frameAt(e.clientX);
          setRange({ from: Math.min(anchor.current, at), to: Math.max(anchor.current, at) });
          seek(at);
        }}
        onPointerUp={() => {
          anchor.current = null;
          setRange((r) => (r && r.to > r.from ? r : null));
        }}
      >
        {params.segments.map((_, i) => (
          <span key={i} className="vrs-seg" style={{ left: pct(starts[i]), width: pct(starts[i + 1] - starts[i]) }}>
            {params.segments.length > 1 && `第 ${i + 1} 段`}
          </span>
        ))}
        {plan && <span className="vrs-sel" style={{ left: pct(plan.from), width: pct(plan.to - plan.from) }} />}
      </div>
      {!plan ? (
        <p className="meta vrs-hint">在上面拖选一截，只重拍这一截，前后照原样接上</p>
      ) : (
        <div className="vrs-form">
          <p className="vrs-range" data-od-id="reshoot-range">
            <b>{reshootText(plan.from, plan.to)}</b>，{reshootWhere(plan)}
          </p>
          {windows.map((i) => (
            <label key={i} className="field">
              <span className="label">{params.segments.length > 1 ? `第 ${i + 1} 段的提示词` : '提示词'}</span>
              <textarea className="textarea" rows={5} data-segment={i} value={prompts[i] ?? params.segments[i]} onChange={(e) => setPrompts((p) => ({ ...p, [i]: e.target.value }))} />
            </label>
          ))}
          <div className="vrs-acts">
            <label className="vrs-seed">
              种子
              <input className="input mono" id="vrSeed" inputMode="numeric" placeholder="随机" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} />
            </label>
            <span className="grow" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRange(null)}>
              不重拍了
            </button>
            <button type="button" className="btn btn-primary btn-sm" data-vact="reshoot" disabled={sending} onClick={() => void submit()}>
              <Icon name="retry" />
              重拍这一截
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
