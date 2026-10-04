import { DEFAULT_AUTODL, type AutodlInstance, type AutodlState } from '@media-agent/shared';
import { readComfyConfig } from '../config';
import { HttpError } from '../httpError';
import { readSettings } from '../store/settings';
import { AUTODL_API, AutodlError, comfyAddress, findInstance, instanceStatus, listInstances, powerOff, powerOn, type AutodlAccess } from './autodlApi';
import { queueState, systemStats } from './client';

// AutoDL 实例的开机、关机、空闲自动关机，见 docs/dev-plan.md 5.17。
// 状态变了推给 /image-jobs/events；只在有人问、正在开机关机、空闲到点时查 AutoDL，平时不一直查

// 时间都能调小：测试里不用真等 5 秒一查、几分钟才关
export type AutodlOptions = { api?: string; pollMs?: number; bootTimeoutMs?: number; minuteMs?: number };

// 点了「别开了」：等着开机的图算叫停
export class BootCancelled extends Error {
  constructor() {
    super('不开机了');
  }
}

type Target = AutodlAccess & { uuid: string };

export type Autodl = ReturnType<typeof createAutodl>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createAutodl(configDir: string, { api = AUTODL_API, pollMs = 5000, bootTimeoutMs = 5 * 60_000, minuteMs = 60_000 }: AutodlOptions = {}) {
  let state: AutodlState = {
    state: 'unset',
    raw: null,
    since: null,
    upSince: null,
    idleLeftMs: null,
    idleMinutes: DEFAULT_AUTODL.idleMinutes,
    busy: false,
    byApp: false,
    error: null,
    instance: null,
  };
  // 上面这些说的是哪个实例；url 是它上面 ComfyUI 的地址，关机后也留着，读过的下拉选项还能用
  let uuid: string | null = null;
  let url: string | null = null;
  let boot: { run: Promise<string>; abort: AbortController } | null = null;
  let stopping: { sent: Promise<void>; done: Promise<void> } | null = null;
  let refreshing: Promise<AutodlState> | null = null;
  let idle: { timer: NodeJS.Timeout; from: number } | null = null;
  let closed = false;
  const listeners = new Set<(state: AutodlState) => void>();

  const current = (): AutodlState => ({ ...state, idleLeftMs: idle ? Math.max(0, idle.from + state.idleMinutes * minuteMs - Date.now()) : null });
  const publish = (change: Partial<AutodlState>) => {
    state = { ...state, ...change };
    const snapshot = current();
    listeners.forEach((listener) => listener(snapshot));
  };

  // 本机的 Token、工作文件夹里选的实例和空闲多久关机。换了实例，前一个的事都不算了
  async function target(): Promise<Target | null> {
    const { workFolder, autodlToken } = await readComfyConfig(configDir);
    const settings = workFolder ? (await readSettings(workFolder)).comfy.autodl : DEFAULT_AUTODL;
    if (settings.instanceUuid !== uuid) {
      uuid = settings.instanceUuid;
      url = null;
      disarm();
      state = { ...state, state: 'unset', raw: null, since: null, upSince: null, byApp: false, error: null, instance: null };
    }
    if (settings.idleMinutes !== state.idleMinutes) {
      state = { ...state, idleMinutes: settings.idleMinutes };
      rearm();
    }
    return autodlToken && uuid ? { api, token: autodlToken, uuid } : null;
  }

  // AutoDL 说的状态：running 开着，shutdown 关了，名字里带 shut、stop 的是正在关，别的当正在开。
  // 上次开机失败、现在关着的，留着失败的原因，下次开机前一直看得到
  function apply(raw: string, instance?: AutodlInstance): void {
    const info = instance ? { instance } : {};
    if (raw === 'running') {
      const upSince = instance?.startedAt ? Date.parse(instance.startedAt) : (state.upSince ?? Date.now());
      publish({ state: 'running', raw, since: null, upSince, error: null, ...info });
      armIdle();
      return;
    }
    disarm();
    if (raw === 'shutdown') publish({ state: state.state === 'failed' ? 'failed' : 'off', raw, since: null, upSince: null, byApp: false, ...info });
    else if (/shut|stop/i.test(raw)) publish({ state: 'stopping', raw, since: null, ...info });
    else publish({ state: 'booting', raw, since: state.since ?? Date.now(), ...info });
  }

  // 查一次实例现在怎样。正在开机、关机时由那边隔几秒查，这里不另外查
  function refresh(): Promise<AutodlState> {
    return (refreshing ??= (async () => {
      try {
        const t = await target();
        if (!t) {
          publish({ state: 'unset' });
          return current();
        }
        if (boot || stopping) return current();
        try {
          const known = state.instance?.uuid === t.uuid ? { gpu: state.instance.gpu, price: state.instance.price } : undefined;
          const instance = await findInstance(t, t.uuid, known);
          if (!boot && !stopping) apply(instance.status, instance);
        } catch (err) {
          publish({ state: 'unknown', raw: null, error: (err as Error).message });
        }
        return current();
      } finally {
        refreshing = null;
      }
    })());
  }

  // ComfyUI 连不上时返回原因
  const unreachable = (address: string) =>
    systemStats(address).then(
      () => null,
      (err: Error) => err.message,
    );

  // 出图前用：开着、ComfyUI 连得上的直接用；关着的先开机，隔几秒查一次，开好了再等 ComfyUI 起来。返回 ComfyUI 的地址
  function ensureReady(): Promise<string> {
    if (!boot) {
      const abort = new AbortController();
      const run: Promise<string> = startBoot(abort.signal).finally(() => {
        if (boot?.run === run) boot = null;
        if (abort.signal.aborted && !closed) void refresh();
      });
      run.catch(() => {});
      boot = { run, abort };
    }
    const { run, abort } = boot;
    const cancelled = new Promise<never>((_, reject) => {
      if (abort.signal.aborted) reject(new BootCancelled());
      abort.signal.addEventListener('abort', () => reject(new BootCancelled()), { once: true });
    });
    cancelled.catch(() => {});
    return Promise.race([run, cancelled]);
  }

  async function startBoot(signal: AbortSignal): Promise<string> {
    if (stopping) await stopping.done.catch(() => {});
    const t = await target();
    if (!t) throw new AutodlError('先在设置里填 AutoDL 的开发者 Token、选好实例');
    const started = Date.now();
    const waited = bootTimeoutMs >= 60_000 ? `${Math.round(bootTimeoutMs / 60_000)} 分钟` : `${Math.round(bootTimeoutMs / 1000)} 秒`;
    const late = () => Date.now() - started >= bootTimeoutMs;
    let sent = false;
    try {
      let raw = await instanceStatus(t, t.uuid);
      if (raw === 'running') {
        url ??= await comfyAddress(t, t.uuid);
        if (!(await unreachable(url))) {
          if (state.state !== 'running') apply(raw);
          return url;
        }
      }
      publish({ state: 'booting', raw, since: started, error: null });
      while (raw !== 'running') {
        if (raw === 'shutdown' && !sent) {
          if (signal.aborted) throw new BootCancelled();
          await powerOn(t, t.uuid);
          sent = true;
          publish({ byApp: true });
        }
        if (late()) throw new AutodlError(`等了 ${waited}还没开好：实例状态一直是「${raw}」。可以再试一次，或者先用局域网那台`);
        await sleep(pollMs);
        raw = await instanceStatus(t, t.uuid);
        publish({ raw });
      }
      url = await comfyAddress(t, t.uuid);
      for (let problem = await unreachable(url); problem && !signal.aborted; problem = await unreachable(url)) {
        if (late()) throw new AutodlError(`等了 ${waited}还没开好：实例开了，但上面的 ComfyUI 一直连不上（${problem}）。可以再试一次，或者先用局域网那台`);
        await sleep(pollMs);
      }
      // 点了「别开了」以后才开好的，马上关掉
      if (signal.aborted) {
        if (state.byApp) await shutDown(t).done;
        throw new BootCancelled();
      }
      publish({ state: 'running', raw, since: null, upSince: sent ? Date.now() : (state.upSince ?? Date.now()), error: null });
      armIdle();
      return url;
    } catch (err) {
      if (err instanceof BootCancelled || signal.aborted) throw new BootCancelled();
      publish({ state: 'failed', since: null, error: (err as Error).message });
      throw err;
    }
  }

  // 「别开了」：等着开机的图马上算叫停；已经发出的开机请求等它开好后关掉
  function cancelBoot(): void {
    if (!boot || boot.abort.signal.aborted) return;
    boot.abort.abort();
    publish({ state: 'stopping', since: null });
  }

  // 关机：sent 是关机请求发出去了（失败的交给调用的人）；done 是隔几秒查一次，查到关好了
  function shutDown(t: Target): { sent: Promise<void>; done: Promise<void> } {
    if (stopping) return stopping;
    disarm();
    const before = state.state;
    publish({ state: 'stopping', since: null });
    const sent = powerOff(t, t.uuid).then(
      () => publish({ byApp: false }),
      (err: Error) => {
        publish({ state: before });
        armIdle();
        throw err;
      },
    );
    const done = sent
      .then(async () => {
        const started = Date.now();
        for (;;) {
          await sleep(pollMs);
          if (closed) return;
          const raw = await instanceStatus(t, t.uuid).catch(() => null);
          if (raw === 'shutdown' || (raw && Date.now() - started >= bootTimeoutMs)) return apply(raw);
          if (raw) publish({ raw });
        }
      })
      .finally(() => {
        stopping = null;
      });
    done.catch(() => {});
    stopping = { sent, done };
    return stopping;
  }

  // 设置里、顶上的状态里点的开机关机，都不等开好、关好。正在开机时点关机就是「别开了」
  async function power(on: boolean): Promise<AutodlState> {
    const t = await target();
    if (!t) throw new HttpError(400, '先在设置里填 AutoDL 的开发者 Token、选好实例');
    if (on) {
      if (!boot && state.state !== 'running') publish({ state: 'booting', since: Date.now(), error: null });
      void ensureReady().catch(() => {});
    } else if (boot) {
      cancelBoot();
    } else {
      await shutDown(t).sent;
    }
    return current();
  }

  // 空闲自动关机：实例开着、程序这边没有图在出，从这时起算，到点看一眼 ComfyUI 的队列再关
  function armIdle(): void {
    if (idle || closed || state.state !== 'running' || state.busy) return;
    idle = { from: Date.now(), timer: setTimeout(() => void onIdle(), state.idleMinutes * minuteMs) };
    publish({});
  }

  function disarm(): void {
    if (!idle) return;
    clearTimeout(idle.timer);
    idle = null;
  }

  // 改了空闲多久关机：从开始空闲的时候重新算
  function rearm(): void {
    if (!idle) return;
    clearTimeout(idle.timer);
    idle.timer = setTimeout(() => void onIdle(), Math.max(0, idle.from + state.idleMinutes * minuteMs - Date.now()));
  }

  // 到点了：ComfyUI 的队列里有任务（比如在 ComfyUI 网页上直接出的图）就不关，从这时起重新算空闲，过一分钟再看；
  // 队列空了，离最后一次看到有任务够了空闲的分钟数才关。看的时候状态变了（开始出图、关机、换了实例）就不管了
  async function onIdle(): Promise<void> {
    const mine = idle;
    if (!mine) return;
    if (closed || state.busy || state.state !== 'running') return disarm();
    const t = await target().catch(() => null);
    if (idle !== mine) return;
    if (!t) return disarm();
    const tasks = await comfyHasTasks(t);
    if (idle !== mine) return;
    if (tasks) mine.from = Date.now();
    const left = mine.from + state.idleMinutes * minuteMs - Date.now();
    if (left > 0) {
      clearTimeout(mine.timer);
      mine.timer = setTimeout(() => void onIdle(), tasks ? minuteMs : left);
      if (tasks) publish({});
      return;
    }
    await shutDown(t).done.catch((err: Error) => {
      console.error('AutoDL 空闲自动关机失败', err);
      publish({ error: `空闲自动关机没关成：${err.message}` });
    });
  }

  // ComfyUI 的队列里有没有任务，不管是谁发的。看不了（ComfyUI 连不上）当没有：连不上的 ComfyUI 谁也用不了
  async function comfyHasTasks(t: Target): Promise<boolean> {
    try {
      url ??= await comfyAddress(t, t.uuid);
      const { running, pending } = await queueState(url);
      return running.length + pending.length > 0;
    } catch {
      return false;
    }
  }

  // 出图那边告诉这里：程序这边有没有图在 AutoDL 上出
  function setBusy(busy: boolean): void {
    if (busy === state.busy) return;
    if (busy) disarm();
    publish({ busy });
    if (!busy) armIdle();
  }

  // 开着的实例上 ComfyUI 的地址，关着的是 null
  async function address(): Promise<string | null> {
    const t = await target();
    if (!t) return null;
    if (state.state !== 'running' && !boot) await refresh();
    return state.state === 'running' ? (url ??= await comfyAddress(t, t.uuid)) : null;
  }

  // 设置里选实例用：账号下的全部实例
  async function instances(): Promise<AutodlInstance[]> {
    const { autodlToken } = await readComfyConfig(configDir);
    if (!autodlToken) throw new HttpError(400, '先填 AutoDL 的开发者 Token');
    return listInstances({ api, token: autodlToken });
  }

  function subscribe(listener: (state: AutodlState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // 服务退出时：这次开机是程序开的，又没见它关掉，就关机。只发关机请求，不等关好。
  // 返回给终端看的一句话，没什么要关的返回 null
  async function exit(): Promise<string | null> {
    closed = true;
    disarm();
    boot?.abort.abort();
    if (!state.byApp) return null;
    const t = await target().catch(() => null);
    if (!t) return null;
    try {
      await powerOff(t, t.uuid);
      return 'AutoDL 实例是程序开的，已经让它关机了';
    } catch (err) {
      return `AutoDL 实例没关掉：${(err as Error).message}。去 AutoDL 控制台关一下`;
    }
  }

  // 测试收尾用：停掉计时，不再查
  function close(): void {
    closed = true;
    disarm();
    boot?.abort.abort();
    listeners.clear();
  }

  return { current, refresh, ensureReady, power, setBusy, address, lastAddress: () => url, instances, subscribe, exit, close };
}
