import type { ComfyStatus } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useComfyStore } from '../store/comfyStore';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toast';

// 隔多久再问一次连不连得上
const CHECK_MS = 30_000;

// 显存按 GB 说，显卡名去掉 NVIDIA GeForce
export const vramText = (bytes: number) => `${Math.round(bytes / 1024 ** 3)} GB`;
export const gpuText = (gpu: string) => gpu.replace(/^NVIDIA GeForce /, '');

// 出图用哪台 ComfyUI、现在连不连得上，画布、首页、设置三页都挂着；点开看详情、重新读底模列表
export function ComfyPill() {
  const status = useComfyStore((s) => s.status);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') void useComfyStore.getState().checkStatus();
    };
    check();
    const timer = setInterval(check, CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  const down = status && !status.ok && status.url;
  return (
    <>
      <button
        type="button"
        className={`cf-pill${down ? ' is-down' : ''}`}
        data-od-id="comfy-status"
        title="出图用哪台 ComfyUI，所有节点共用。点开看状态"
        onClick={(e) => {
          if (anchor) return setAnchor(null);
          setAnchor(e.currentTarget.getBoundingClientRect());
          void useComfyStore.getState().checkStatus();
        }}
      >
        <span className={`dot${status?.ok ? ' dot-ok' : down ? ' dot-danger' : ''}`} />
        <span className="cf-txt">{down ? '局域网 ComfyUI 连不上' : '局域网 ComfyUI'}</span>
        {!down && <span className="cf-sub">{!status ? '正在连' : status.ok ? '连得上' : '还没填地址'}</span>}
        <Icon name="chev-down" className="icon-sm" />
      </button>
      {anchor && <ComfyPanel anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}

function ComfyPanel({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const status = useComfyStore((s) => s.status);
  const checking = useComfyStore((s) => s.checking);
  const loading = useComfyStore((s) => s.loadingOptions);

  const reload = async () => {
    const { loadOptions } = useComfyStore.getState();
    const options = await loadOptions(true);
    const error = useComfyStore.getState().optionsError;
    if (error || !options) return toast(error ?? '读不到列表', { tone: 'danger', ms: 4500 });
    toast(`读到 ${options.checkpoints.length} 个底模、${options.loras.length} 个 LoRA、${options.samplers.length} 种采样器`);
  };

  return (
    <Popover anchor={anchor} className="cf-pop" odId="comfy-popover" label="出图用哪台 ComfyUI" onClose={onClose} keepOpen={(target) => Boolean(target.closest('.cf-pill'))}>
      <div className="cf-pop-head">
        <b>出图用哪台 ComfyUI</b>
        <span className="meta">所有节点共用</span>
      </div>
      <div className="cf-src is-on">
        <span className="cf-src-body">
          <span className="cf-src-name">
            <Icon name="server" />
            局域网那台
          </span>
          {status?.url && <span className="mono meta">{status.url}</span>}
          <span className="cf-src-state">
            <LanState status={status} checking={checking} />
          </span>
        </span>
      </div>
      <div className="cf-pop-foot">
        <button type="button" className="btn btn-ghost btn-sm" disabled={loading || !status?.ok} onClick={() => void reload()}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" />}
          {loading ? '正在读…' : '重新读底模和 LoRA 列表'}
        </button>
        <span className="grow" />
        <Link className="btn btn-ghost btn-sm" to={{ pathname: '/settings', hash: 'comfy' }} onClick={onClose}>
          <Icon name="gear" />
          设置
        </Link>
      </div>
    </Popover>
  );
}

// 连得上：显卡和显存；连不上：多半是地址不对或者那边没开
export function LanState({ status, checking }: { status: ComfyStatus | null; checking: boolean }) {
  if (!status) {
    return (
      <span className="meta">
        <span className="spinner" /> 正在连…
      </span>
    );
  }
  if (status.ok) {
    return (
      <>
        <span className="tag tag-ok">
          <Icon name="check" />
          连得上
        </span>
        <span className="meta mono">
          {gpuText(status.gpu)} · {vramText(status.vramTotal)}
        </span>
      </>
    );
  }
  if (!status.url) {
    return (
      <>
        <span className="tag">还没填地址</span>
        <span className="meta">在设置的「ComfyUI」里填</span>
      </>
    );
  }
  return (
    <>
      <span className="tag tag-danger">
        <Icon name="x" />
        连不上
      </span>
      <span className="meta">{checking ? '正在重新连…' : '地址不对，或者那台电脑上 ComfyUI 没开'}</span>
    </>
  );
}
