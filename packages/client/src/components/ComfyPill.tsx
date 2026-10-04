import type { AutodlInstance, AutodlState, ComfyStatus } from '@media-agent/shared';
import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { idleMinutesLeft, useComfyStore, watchImageJobs, type AutodlNow } from '../store/comfyStore';
import { confirmBox } from '../ui/confirm';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toast';

// 隔多久再问一次连不连得上、AutoDL 开没开
const CHECK_MS = 30_000;

// 显存按 GB 说，显卡名去掉 NVIDIA GeForce
export const vramText = (bytes: number) => `${Math.round(bytes / 1024 ** 3)} GB`;
export const gpuText = (gpu: string) => gpu.replace(/^NVIDIA GeForce /, '');

// AutoDL 实例：名字 · 地区 · 显卡 · 每小时多少钱
export const instanceLine = (instance: AutodlInstance) =>
  [instance.name, instance.region, instance.gpu, instance.price === null ? '' : `¥${instance.price.toFixed(2)}/小时`].filter(Boolean).join(' · ');

// 正在开机时「等了 N 秒」每秒走一次
export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return ticking ? Math.max(now, Date.now()) : now;
}

export const secondsSince = (since: number | null, now: number) => Math.max(0, Math.round((now - (since ?? now)) / 1000));

// 程序这边正在用 AutoDL 做什么，比如「出图、传模型」
const busyText = (autodl: AutodlState) => autodl.busyWith.map((what) => ({ images: '出图', models: '传模型' })[what]).join('、');

// 出图用哪台 ComfyUI、现在什么状态，画布、首页、设置三页都挂着。AutoDL 开着就在扣钱，开着时用醒目的样子，
// 用局域网那台时 AutoDL 也开着，另外标出来。点开切换、开机关机、重新读底模列表
export function ComfyPill() {
  const target = useComfyStore((s) => s.target);
  const status = useComfyStore((s) => s.status);
  const autodl = useComfyStore((s) => s.autodl);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const now = useNow(autodl?.state === 'booting');

  useEffect(() => {
    const store = useComfyStore.getState();
    void store.loadTarget();
    let first = true;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      if (!first) void store.loadTarget(true);
      first = false;
      void store.checkStatus();
      void store.checkAutodl();
    };
    check();
    const timer = setInterval(check, CHECK_MS);
    const stopWatching = watchImageJobs();
    return () => {
      clearInterval(timer);
      stopWatching();
    };
  }, []);

  const label = pillLabel(target ?? 'lan', status, autodl, now);
  const alsoOn = target === 'lan' && autodl?.state === 'running';
  return (
    <>
      <button
        type="button"
        className={`cf-pill ${label.cls}${alsoOn ? ' has-autodl' : ''}`}
        data-od-id="comfy-status"
        title="出图用哪台 ComfyUI，所有节点共用。点开切换、开机关机"
        onClick={(e) => {
          if (anchor) return setAnchor(null);
          setAnchor(e.currentTarget.getBoundingClientRect());
          void useComfyStore.getState().checkStatus();
          void useComfyStore.getState().checkAutodl();
        }}
      >
        {label.spin ? <span className="spinner" /> : <span className={`dot ${label.dot ?? ''}`} />}
        <span className="cf-txt">{label.text}</span>
        {label.sub && <span className="cf-sub">{label.sub}</span>}
        <Icon name="chev-down" className="icon-sm" />
        {alsoOn && (
          <span className="cf-extra">
            <Icon name="power" className="icon-sm" />
            AutoDL 也开着
          </span>
        )}
      </button>
      {anchor && <ComfyPanel anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}

type PillLabel = { cls: string; dot?: string; spin?: boolean; text: string; sub?: string };

function pillLabel(target: 'lan' | 'autodl', status: ComfyStatus | null, autodl: AutodlNow | null, now: number): PillLabel {
  if (target === 'lan') {
    if (!status) return { cls: '', text: '局域网 ComfyUI', sub: '正在连' };
    if (status.ok) return { cls: '', dot: 'dot-ok', text: '局域网 ComfyUI', sub: '连得上' };
    if (!status.url) return { cls: '', text: '局域网 ComfyUI', sub: '还没填地址' };
    return { cls: 'is-down', dot: 'dot-danger', text: '局域网 ComfyUI 连不上' };
  }
  switch (autodl?.state) {
    case undefined:
      return { cls: '', text: 'AutoDL 实例', sub: '正在查' };
    case 'unset':
      return { cls: '', text: 'AutoDL 实例', sub: '还没设置' };
    case 'unknown':
      return { cls: 'is-down', dot: 'dot-danger', text: 'AutoDL 查不到状态' };
    case 'off':
      return { cls: '', text: 'AutoDL 已关机', sub: '点生图时自动开机' };
    case 'booting':
      return { cls: 'is-booting', spin: true, text: 'AutoDL 正在开机', sub: `等了 ${secondsSince(autodl.since, now)} 秒` };
    case 'stopping':
      return { cls: '', spin: true, text: 'AutoDL 正在关机' };
    case 'failed':
      return { cls: 'is-down', dot: 'dot-danger', text: 'AutoDL 开机失败' };
    case 'running':
      return { cls: 'is-running', dot: 'dot-warn', text: 'AutoDL 运行中', sub: autodl.busyWith.length ? `正在${busyText(autodl)}` : `${idleMinutesLeft(autodl) ?? autodl.idleMinutes} 分钟后自动关机` };
  }
}

function ComfyPanel({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const target = useComfyStore((s) => s.target);
  const status = useComfyStore((s) => s.status);
  const autodl = useComfyStore((s) => s.autodl);
  const checking = useComfyStore((s) => s.checking);
  const loading = useComfyStore((s) => s.loadingOptions);
  const canRead = target === 'autodl' ? autodl?.state === 'running' : Boolean(status?.ok);

  const reload = async () => {
    const { loadOptions } = useComfyStore.getState();
    const options = await loadOptions(true);
    const error = useComfyStore.getState().optionsError;
    if (error || !options) return toast(error ?? '读不到列表', { tone: 'danger', ms: 4500 });
    toast(`读到 ${options.checkpoints.length} 个底模、${options.loras.length} 个 LoRA、${options.samplers.length} 种采样器`);
  };

  return (
    <Popover anchor={anchor} className="cf-pop" odId="comfy-popover" label="出图用哪台 ComfyUI" onClose={onClose} keepOpen={(t) => Boolean(t.closest('.cf-pill'))}>
      <div className="cf-pop-head">
        <b>出图用哪台 ComfyUI</b>
        <span className="meta">所有节点共用，只记在这台电脑上</span>
      </div>
      <label className={`cf-src${target === 'lan' ? ' is-on' : ''}`}>
        <input type="radio" name="cfsrc" value="lan" checked={target === 'lan'} onChange={() => void useComfyStore.getState().setTarget('lan')} />
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
      </label>
      <label className={`cf-src${target === 'autodl' ? ' is-on' : ''}`}>
        <input type="radio" name="cfsrc" value="autodl" checked={target === 'autodl'} onChange={() => void useComfyStore.getState().setTarget('autodl')} />
        <span className="cf-src-body">
          <span className="cf-src-name">
            <Icon name="server" />
            AutoDL 实例
          </span>
          {autodl?.instance && <span className="meta">{instanceLine(autodl.instance)}</span>}
          <span className="cf-src-state">
            <AutodlStateView autodl={autodl} where="panel" />
          </span>
          {autodl?.error && (autodl.state === 'failed' || autodl.state === 'unknown') && <span className="cf-err">{autodl.error}</span>}
          {autodl && autodl.state !== 'unset' && autodl.state !== 'unknown' && (
            <span className="cf-src-acts">
              <PowerButton autodl={autodl} small askOff={onClose} />
              <span className="meta">
                空闲 <span className="mono">{autodl.idleMinutes}</span> 分钟自动关机
              </span>
            </span>
          )}
        </span>
      </label>
      <p className="cf-note">
        <Icon name="info" className="icon-sm" />
        <span>程序关掉以后就管不了实例了。看到 AutoDL 还开着又不用，先点关机再关程序。</span>
      </p>
      <div className="cf-pop-foot">
        <button type="button" className="btn btn-ghost btn-sm" disabled={loading || !canRead} onClick={() => void reload()}>
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

// 开机、现在关机、别开了。按钮放在 label 里，点了不能顺带选中那一项。
// 给了 askOff 的，关机前先问一句；问之前调它（顶上的小窗先收起来，不然会画进确认框里）
export function PowerButton({ autodl, small, askOff }: { autodl: AutodlNow; small?: boolean; askOff?: () => void }) {
  const size = small ? ' btn-sm' : '';
  const run = (on: boolean) => (e: MouseEvent) => {
    e.preventDefault();
    void (async () => {
      if (!on && askOff && autodl.state === 'running') {
        askOff();
        const ok = await confirmBox({ title: '关掉 AutoDL 实例？', body: '关机后不再按秒扣显卡的钱，只收系统盘的钱。下次出图要重新开机，等一两分钟。', ok: '关机' });
        if (!ok) return;
      }
      await useComfyStore.getState().power(on);
    })();
  };
  if (autodl.state === 'running') {
    return (
      <button type="button" className={`btn btn-secondary${size}`} data-cf="off" onClick={run(false)}>
        <Icon name="power" />
        现在关机
      </button>
    );
  }
  if (autodl.state === 'booting') {
    return (
      <button type="button" className={`btn btn-secondary${size}`} data-cf="cancelBoot" onClick={run(false)}>
        别开了
      </button>
    );
  }
  return (
    <button type="button" className={`btn btn-secondary${size}`} data-cf="on" disabled={autodl.state === 'stopping'} onClick={run(true)}>
      <Icon name="power" />
      开机
    </button>
  );
}

// AutoDL 的状态：顶上点开的面板里说得短，设置里多说一句关机时花多少钱
export function AutodlStateView({ autodl, where }: { autodl: AutodlNow | null; where: 'panel' | 'settings' }) {
  const now = useNow(autodl?.state === 'booting' || autodl?.state === 'running');
  if (!autodl) {
    return (
      <span className="meta">
        <span className="spinner" /> 正在查…
      </span>
    );
  }
  switch (autodl.state) {
    case 'unset':
      return (
        <>
          <span className="tag">还没设置</span>
          <span className="meta">{where === 'panel' ? '在设置的「ComfyUI」里填 Token、选实例' : '填好 Token、选好实例后能开机关机'}</span>
        </>
      );
    case 'unknown':
      return (
        <span className="tag tag-danger">
          <Icon name="x" />
          查不到状态
        </span>
      );
    case 'off':
      return (
        <>
          <span className="tag">已关机</span>
          <span className="meta">{where === 'panel' ? '关机时不扣显卡的钱' : '关机时只收系统盘的钱，每天 ¥0.1'}</span>
        </>
      );
    case 'booting':
      return (
        <>
          <span className="tag tag-accent">
            <span className="spinner" />
            正在开机
          </span>
          <span className="meta">
            等了 <span className="mono">{secondsSince(autodl.since, now)} 秒</span>
            {where === 'panel' && '，一般要一两分钟'}
          </span>
        </>
      );
    case 'stopping':
      return (
        <span className="tag">
          <span className="spinner" />
          正在关机
        </span>
      );
    case 'failed':
      return (
        <span className="tag tag-danger">
          <Icon name="x" />
          开机失败
        </span>
      );
    case 'running': {
      const up = autodl.upSince === null ? null : Math.max(0, Math.round((now - autodl.upSince) / 60_000));
      const left = idleMinutesLeft(autodl, now) ?? autodl.idleMinutes;
      return (
        <>
          <span className="tag tag-warn">
            <Icon name="power" />
            运行中 · 在扣钱
          </span>
          <span className="meta">
            {up !== null && (
              <>
                开了 <span className="mono">{up}</span> 分钟 ·{' '}
              </>
            )}
            {autodl.busyWith.length ? (
              `正在${busyText(autodl)}，忙完空闲 ${autodl.idleMinutes} 分钟后关机`
            ) : (
              <>
                <span className="mono">{left}</span> 分钟后自动关机
              </>
            )}
          </span>
        </>
      );
    }
  }
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
