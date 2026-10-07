import {
  AUTODL_IDLE_MINUTES,
  FAMILIES,
  type AutodlInstance,
  type AutodlSettings,
  type ComfyStatus,
  type Config,
  type Family,
  type FamilyDefaults,
  type ImageTempInfo,
  type SharedSettings,
} from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { AutodlStateView, gpuText, instanceLine, PowerButton, vramText } from '../components/ComfyPill';
import { useComfyStore, type AutodlNow } from '../store/comfyStore';
import { useVideoStore } from '../store/videoStore';
import { CommitInput, CommitTextarea, integerFrom, numberFrom, trimmed } from '../ui/CommitInput';
import { fmtSize } from '../ui/format';
import { Icon } from '../ui/Icon';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';

// 设置里出图用的三节：ComfyUI（出图用哪台、局域网那台、AutoDL 实例）、底模和两个系列的默认值、出的图，见 docs/dev-plan.md 6.4

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

const SHARED = (
  <span className="tag sx-where">
    <Icon name="folder" />
    存在工作文件夹，两台电脑共用
  </span>
);

const LOCAL = (text: string) => (
  <span className="tag sx-where">
    <Icon name="lock" />
    {text}
  </span>
);

const NO_FOLDER = <p className="muted">这些设置存在工作文件夹里，先在「工作文件夹」里选一个。</p>;

const putSettings = (body: unknown) => trackWrite(api<SharedSettings>('/settings', { method: 'PUT', body }));

// 测试连接的结果：连得上写版本、显卡、显存；连不上写 ComfyUI 那边的原话
function TestResult({ status }: { status: ComfyStatus | 'testing' }) {
  if (status === 'testing') {
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
        <span className="meta">
          ComfyUI <span className="mono">{status.version}</span> · {gpuText(status.gpu)} · 显存 <span className="mono">{vramText(status.vramTotal)}</span>
        </span>
      </>
    );
  }
  const raw = status.error.includes('原话：') ? status.error.slice(status.error.indexOf('原话：') + 3) : status.error;
  return (
    <>
      <span className="tag tag-danger">
        <Icon name="x" />
        连不上
      </span>
      <span>
        <span className="mono meta">{raw}</span>：地址不对，或者那台电脑上 ComfyUI 没开。
      </span>
    </>
  );
}

export function ComfyTab({ workFolder }: { workFolder: string | null }) {
  const target = useComfyStore((s) => s.target);
  const [saved, setSaved] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<ComfyStatus | 'testing' | null>(null);
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    if (!workFolder) return;
    void useComfyStore.getState().loadTarget();
    api<SharedSettings>('/settings').then((settings) => {
      const lanUrl = settings.comfy.lanUrl ?? '';
      setSaved(lanUrl);
      // 读回来之前已经在框里填了的，不盖掉
      setUrl((typed) => typed || lanUrl);
      if (!lanUrl) return;
      setResult('testing');
      void useComfyStore.getState().checkStatus().then(setResult);
    }, failed);
  }, [workFolder]);

  if (!workFolder) return NO_FOLDER;

  // 地址改了才存；存过的还没读回来时，填了就存，空着不动；换了地址，下拉选项要重新读
  const saveUrl = async (): Promise<boolean> => {
    const next = url.trim();
    if (saved === null ? !next : next === saved.trim()) return true;
    try {
      const settings = await putSettings({ comfy: { lanUrl: next || null } });
      setSaved(settings.comfy.lanUrl ?? '');
      setUrl(settings.comfy.lanUrl ?? '');
      setUrlError('');
      useComfyStore.setState({ options: null, optionsError: null });
      void useComfyStore.getState().checkStatus();
      return true;
    } catch (err) {
      setUrlError((err as Error).message);
      return false;
    }
  };

  const test = async () => {
    if (!(await saveUrl())) return;
    if (!url.trim()) return setResult(null);
    setResult('testing');
    setResult(await useComfyStore.getState().checkStatus());
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>ComfyUI</h2>
          <p>出图的程序跑在有显卡的电脑上，这台只有核显。两台都能接：局域网里那台，和 AutoDL 上租的实例。出图用哪台随时能切，所有节点共用。</p>
        </div>
      </div>
      <section className="card editor" data-od-id="comfy-source">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <h3>出图用哪台</h3>
          {LOCAL('只存在这台电脑上')}
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="seg" id="cfUse" role="group" aria-label="出图用哪台">
            <button type="button" aria-pressed={target === 'lan'} onClick={() => void useComfyStore.getState().setTarget('lan')}>
              局域网那台
            </button>
            <button type="button" aria-pressed={target === 'autodl'} onClick={() => void useComfyStore.getState().setTarget('autodl')}>
              AutoDL 实例
            </button>
          </div>
          <span className="hint">两台电脑可能不在同一个网络里，所以各自记一份。</span>
        </div>
      </section>
      <section className="card editor" style={{ marginTop: 16 }} data-od-id="comfy-lan">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h3>局域网那台</h3>
          {SHARED}
        </div>
        <div className="field">
          <label htmlFor="cfUrl">地址</label>
          <div className="input-group">
            <input
              className={`input mono${urlError ? ' is-error' : ''}`}
              id="cfUrl"
              value={url}
              spellCheck={false}
              placeholder="http://192.168.1.20:8188"
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlError('');
              }}
              onBlur={() => void saveUrl()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void test();
              }}
            />
            <button type="button" className="btn btn-secondary" id="cfTest" onClick={() => void test()}>
              <Icon name="plug" />
              测试连接
            </button>
          </div>
          <p className={`hint${urlError ? ' is-error' : ''}`}>
            {urlError || (
              <>
                那台电脑上 ComfyUI 启动时要加 <span className="mono">--listen</span>，局域网里才连得上。
              </>
            )}
          </p>
        </div>
        {result && (
          <div className="mf-test" id="cfResult" role="status" style={{ marginTop: 12 }}>
            <TestResult status={result} />
          </div>
        )}
      </section>
      <AutodlCard />
    </>
  );
}

// 关机超过一天的标出来：连续关机 60 天会被释放
const RELEASE_DAYS = 60;
function instanceOption(instance: AutodlInstance): string {
  const days = instance.stoppedAt ? Math.floor((Date.now() - Date.parse(instance.stoppedAt)) / 86_400_000) : 0;
  return days >= 1 ? `${instanceLine(instance)} · 已经关机 ${days} 天，再关 ${Math.max(0, RELEASE_DAYS - days)} 天会被释放` : instanceLine(instance);
}

const idleMinutes = (text: string) => {
  const n = Number(text);
  return Number.isInteger(n) && n >= AUTODL_IDLE_MINUTES.min && n <= AUTODL_IDLE_MINUTES.max ? n : null;
};

// AutoDL 实例：开发者 Token 只存本机；出图、生成视频各选哪个实例、空闲多久自动关机存工作文件夹；状态和开机关机，
// 见 docs/dev-plan.md 5.17、5.25。两台共用一个 Token、一个实例列表
function AutodlCard() {
  const autodl = useComfyStore((s) => s.autodl);
  const videoAutodl = useVideoStore((s) => s.autodl);
  const [tokenSet, setTokenSet] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [chosen, setChosen] = useState<AutodlSettings | null>(null);
  const [chosenVideo, setChosenVideo] = useState<AutodlSettings | null>(null);
  const [instances, setInstances] = useState<AutodlInstance[] | null>(null);
  const [listError, setListError] = useState('');

  const loadInstances = () =>
    api<AutodlInstance[]>('/comfy/autodl/instances').then(
      (list) => {
        setInstances(list);
        setListError('');
      },
      (err: Error) => setListError(err.message),
    );

  useEffect(() => {
    api<Config>('/config').then((config) => {
      setTokenSet(Boolean(config.autodlToken));
      if (config.autodlToken) void loadInstances();
    }, failed);
    api<SharedSettings>('/settings').then((settings) => {
      setChosen(settings.comfy.autodl);
      setChosenVideo(settings.comfy.videoAutodl);
    }, failed);
    void useComfyStore.getState().checkAutodl();
    void useVideoStore.getState().checkAutodl();
  }, []);

  // 存好后输入框清空，不再显示
  const saveToken = async () => {
    const value = token.trim();
    if (!value) return;
    try {
      await trackWrite(api<Config>('/config', { method: 'PUT', body: { autodlToken: value } }));
      setToken('');
      toast(tokenSet ? 'Token 已替换' : 'Token 已存到这台电脑');
      setTokenSet(true);
      void loadInstances();
      void useComfyStore.getState().checkAutodl();
      void useVideoStore.getState().checkAutodl();
    } catch (err) {
      failed(err);
    }
  };

  const saveAutodl = async (patch: Partial<AutodlSettings>) => {
    try {
      setChosen((await putSettings({ comfy: { autodl: patch } })).comfy.autodl);
      void useComfyStore.getState().checkAutodl();
    } catch (err) {
      failed(err);
    }
  };

  const saveVideoAutodl = async (patch: Partial<AutodlSettings>) => {
    try {
      setChosenVideo((await putSettings({ comfy: { videoAutodl: patch } })).comfy.videoAutodl);
      void useVideoStore.getState().checkAutodl();
    } catch (err) {
      failed(err);
    }
  };

  const listed = instances ?? [];
  const rows = { instances: listed, tokenSet, listError };
  return (
    <section className="card editor" style={{ marginTop: 16 }} data-od-id="comfy-autodl">
      <div className="row-between" style={{ marginBottom: 10 }}>
        <h3>AutoDL 实例</h3>
        {LOCAL('Token 只存在这台电脑上')}
      </div>
      <div className="kv">
        <div className="kv-row">
          <span className="k">开发者 Token</span>
          <div className="stack" style={{ gap: 6 }} data-od-id="field-autodl-token">
            <div className="mf-keystate">
              {tokenSet ? (
                <>
                  <span className="tag tag-ok">
                    <Icon name="check" />
                    已配置
                  </span>
                  <span className="meta">存在这台电脑上</span>
                </>
              ) : (
                tokenSet === false && <span className="tag tag-warn">还没配置</span>
              )}
            </div>
            <input
              className="input mono"
              id="adToken"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={tokenSet ? '输入新 Token 可以替换，按回车存好' : '粘贴 Token，按回车存好'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => void saveToken()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <span className="hint">在 AutoDL 控制台「设置 → 开发者 Token」里拿。存好后输入框会清空，不再显示，另一台电脑要各填一次。</span>
          </div>
        </div>
        <InstanceRows
          {...rows}
          prefix="ad"
          use="images"
          chosen={chosen}
          autodl={autodl}
          taken={chosenVideo?.instanceUuid ?? null}
          hint="填了 Token 后列出账号下的实例。ComfyUI 要跑在实例的 6006 端口上。"
          idleHint="程序最后一个出图任务结束后开始算。程序是开着的才管得到；按 Ctrl+C 关程序时，如果实例是程序开的，会先关机再退出。程序没开时管不了，记得自己看一眼。"
          onSave={(patch) => void saveAutodl(patch)}
        />
      </div>
      <div className="row-between" style={{ margin: '18px 0 10px' }}>
        <h3>生成视频用的实例</h3>
      </div>
      <div className="kv" data-od-id="comfy-video-autodl">
        <InstanceRows
          {...rows}
          prefix="vd"
          use="videos"
          chosen={chosenVideo}
          autodl={videoAutodl}
          taken={chosen?.instanceUuid ?? null}
          hint="视频节点点「生成视频」时用这台，要选装着 H3 的实例（32 GB 显存的卡），不能和出图那台是同一个。没选的话视频节点只写提示词。"
          idleHint="这台最后一条视频生成完后开始算，和出图那台各算各的。一条一分钟的视频大约要半小时。"
          onSave={(patch) => void saveVideoAutodl(patch)}
        />
      </div>
    </section>
  );
}

type InstanceRowsProps = {
  prefix: 'ad' | 'vd';
  use: 'images' | 'videos';
  chosen: AutodlSettings | null;
  autodl: AutodlNow | null;
  instances: AutodlInstance[];
  tokenSet: boolean | null;
  listError: string;
  taken: string | null; // 另一台选的实例，这里不能再选
  hint: string;
  idleHint: string;
  onSave: (patch: Partial<AutodlSettings>) => void;
};

// 一台的三行：选哪个实例、现在的状态和开机关机、空闲多久自动关机
function InstanceRows({ prefix, use, chosen, autodl, instances, tokenSet, listError, taken, hint, idleHint, onSave }: InstanceRowsProps) {
  const missing = chosen?.instanceUuid && !instances.some((instance) => instance.uuid === chosen.instanceUuid);
  const other = use === 'images' ? '生成视频' : '出图';
  return (
    <>
      <div className="kv-row">
        <span className="k">实例</span>
        <div className="stack" style={{ gap: 6 }}>
          <select className="select" id={`${prefix}Inst`} value={chosen?.instanceUuid ?? ''} disabled={!chosen} onChange={(e) => onSave({ instanceUuid: e.target.value || null })}>
            {!chosen?.instanceUuid && <option value="">{tokenSet ? '选一个实例' : '先填 Token'}</option>}
            {missing && <option value={chosen.instanceUuid!}>{chosen.instanceUuid}（账号下没列出来）</option>}
            {instances.map((instance) => (
              <option key={instance.uuid} value={instance.uuid} disabled={instance.uuid === taken}>
                {instanceOption(instance)}
                {instance.uuid === taken ? `（${other}在用）` : ''}
              </option>
            ))}
          </select>
          <span className={`hint${listError ? ' is-error' : ''}`}>{listError || hint}</span>
        </div>
      </div>
      <div className="kv-row">
        <span className="k">状态</span>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ flexWrap: 'wrap' }} id={`${prefix}State`}>
            <AutodlStateView autodl={autodl} where="settings" />
          </div>
          {autodl?.error && (autodl.state === 'failed' || autodl.state === 'unknown') && <div className="cf-err">{autodl.error}</div>}
          {autodl && autodl.state !== 'unset' && autodl.state !== 'unknown' && (
            <div className="row">
              <PowerButton autodl={autodl} use={use} />
            </div>
          )}
        </div>
      </div>
      <div className="kv-row">
        <span className="k">空闲多久自动关机</span>
        <div className="stack" style={{ gap: 6 }}>
          <div className="input-group" style={{ width: 160 }}>
            <CommitInput
              className="input mono"
              id={`${prefix}Idle`}
              type="number"
              min={AUTODL_IDLE_MINUTES.min}
              max={AUTODL_IDLE_MINUTES.max}
              value={String(chosen?.idleMinutes ?? '')}
              parse={idleMinutes}
              disabled={!chosen}
              onCommit={(v) => onSave({ idleMinutes: Number(v) })}
            />
            <span className="mf-unit">分钟</span>
          </div>
          <span className="hint">{idleHint}</span>
        </div>
      </div>
    </>
  );
}

const RATING_FIELDS: [keyof FamilyDefaults['rating'], string][] = [
  ['general', '全年龄'],
  ['sensitive', '擦边'],
  ['explicit', '成人'],
];

export function CheckpointsTab({ workFolder }: { workFolder: string | null }) {
  const target = useComfyStore((s) => s.target);
  const [settings, setSettings] = useState<SharedSettings | null>(null);
  const options = useComfyStore((s) => s.options);
  const optionsError = useComfyStore((s) => s.optionsError);
  const loading = useComfyStore((s) => s.loadingOptions);

  useEffect(() => {
    if (!workFolder) return;
    api<SharedSettings>('/settings').then(setSettings, failed);
    void useComfyStore.getState().loadTarget();
    void useComfyStore.getState().loadOptions();
  }, [workFolder]);

  if (!workFolder) return NO_FOLDER;
  if (!settings) return null;

  const reload = async () => {
    const loaded = await useComfyStore.getState().loadOptions(true);
    const error = useComfyStore.getState().optionsError;
    if (error || !loaded) return toast(error ?? '读不到列表', { tone: 'danger', ms: 4500 });
    toast(`读到 ${loaded.checkpoints.length} 个底模、${loaded.loras.length} 个 LoRA、${loaded.samplers.length} 种采样器`);
  };

  // 标底模属于哪个系列，null 是两个都不是：标过的就不算猜的了
  const mark = async (name: string, family: Family | null) => {
    try {
      setSettings(await putSettings({ checkpoints: { [name]: family } }));
      useComfyStore.setState((s) => ({
        options: s.options && { ...s.options, checkpoints: s.options.checkpoints.map((c) => (c.name === name ? { ...c, family, guessed: false } : c)) },
      }));
      toast(family ? `${name} 标成了 ${family}` : `${name} 标成了两个系列都不是，节点的底模下拉里不列`);
    } catch (err) {
      failed(err);
    }
  };

  const saveDefaults = async (family: Family, patch: Partial<FamilyDefaults>) => {
    try {
      setSettings(await putSettings({ defaults: { [family]: patch } }));
    } catch (err) {
      failed(err);
    }
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>底模和默认值</h2>
          <p>这些很少改，但要能改。底模的列表是从 ComfyUI 读来的。</p>
        </div>
        {SHARED}
      </div>
      <section className="card editor" data-od-id="checkpoint-series">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <h3>读到的底模各属哪个系列</h3>
          <button type="button" className="btn btn-secondary btn-sm" id="ckRefresh" disabled={loading} onClick={() => void reload()}>
            {loading ? <span className="spinner" /> : <Icon name="refresh" />}
            {loading ? '正在读…' : `从${target === 'autodl' ? ' AutoDL 实例' : '局域网那台'}重新读`}
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 10 }}>
          生图节点的底模下拉只列这个系列的。没标过的按文件名猜：名字里有 pony 的当 Pony；有 illustrious、noob、wai，或者单独写着 IL 的当 IL；别的两个都不是。猜错了在这里改。
        </p>
        {options?.checkpoints.length ? (
          <div className="sx-list">
            {options.checkpoints.map((c) => (
              <div className="sx-row" key={c.name} data-ck={c.name}>
                <span className="mono grow sx-ck">{c.name}</span>
                {c.guessed && <span className="tag">按文件名猜的</span>}
                <div className="seg" role="group" aria-label={`${c.name} 属于哪个系列`}>
                  {[...FAMILIES, null].map((family) => (
                    <button key={family ?? 'none'} type="button" aria-pressed={c.family === family} onClick={() => c.family !== family || c.guessed ? void mark(c.name, family) : undefined}>
                      {family ?? '都不是'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">
            {optionsError ? (
              optionsError.includes('还没填') || optionsError.includes('先在设置里填') ? (
                <>
                  {optionsError}，先去 <Link to={{ hash: 'comfy' }}>ComfyUI</Link> 里填。
                </>
              ) : (
                optionsError
              )
            ) : options ? (
              '这台 ComfyUI 上一个底模都没有。'
            ) : (
              '正在读底模列表…'
            )}
          </p>
        )}
      </section>
      <div className="sx-two">
        {FAMILIES.map((family) => (
          <FamilyCard key={family} family={family} defaults={settings.defaults[family]} samplers={options?.samplers ?? []} schedulers={options?.schedulers ?? []} onSave={(patch) => void saveDefaults(family, patch)} />
        ))}
      </div>
    </>
  );
}

type FamilyProps = { family: Family; defaults: FamilyDefaults; samplers: string[]; schedulers: string[]; onSave: (patch: Partial<FamilyDefaults>) => void };

// 一个系列的默认值：新建生图节点时按这个填，节点里还能各自改
function FamilyCard({ family, defaults, samplers, schedulers, onSave }: FamilyProps) {
  const id = (key: string) => `${family}-${key}`;
  const pick = (list: string[], value: string) => (value && !list.includes(value) ? [value, ...list] : list);
  return (
    <section className="card editor" data-od-id={`series-defaults-${family.toLowerCase()}`}>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h3>{family} 系列的默认值</h3>
        <span className="meta">新建生图节点时按这个填，节点里还能各自改</span>
      </div>
      <div className="mf-grid">
        <div className="field mf-wide">
          <label htmlFor={id('prefix')}>固定开头</label>
          <CommitTextarea className="textarea mono sx-ta" id={id('prefix')} rows={2} value={defaults.prefix} parse={trimmed} onCommit={(v) => onSave({ prefix: String(v) })} />
          <p className="hint">出图时加在正面提示词最前面。提示词框里不显示，也不用写。</p>
        </div>
        <div className="field mf-wide">
          <label htmlFor={id('negative')}>默认负面词</label>
          <CommitTextarea className="textarea mono sx-ta" id={id('negative')} rows={2} value={defaults.negative} parse={trimmed} onCommit={(v) => onSave({ negative: String(v) })} />
          <p className="hint">不想在图里出现的东西。节点的出图设置里还能再加。</p>
        </div>
        <div className="field mf-wide">
          <span className="label">评级词的写法</span>
          <div className="sx-rate">
            {RATING_FIELDS.map(([key, label]) => (
              <label key={key}>
                <span className="meta">{label}</span>
                <CommitInput className="input mono" value={defaults.rating[key]} parse={trimmed} onCommit={(v) => onSave({ rating: { ...defaults.rating, [key]: String(v) } })} />
              </label>
            ))}
          </div>
          <p className="hint">出图设置里选了评级，就把对应的词加在固定开头后面。</p>
        </div>
        <div className="field">
          <label htmlFor={id('steps')}>步数</label>
          <CommitInput className="input mono" id={id('steps')} value={String(defaults.steps)} parse={integerFrom(1)} onCommit={(v) => onSave({ steps: Number(v) })} />
          <p className="hint">画多少步。越多越细，也越慢。</p>
        </div>
        <div className="field">
          <label htmlFor={id('cfg')}>CFG</label>
          <CommitInput className="input mono" id={id('cfg')} value={String(defaults.cfg)} parse={numberFrom(0)} onCommit={(v) => onSave({ cfg: Number(v) })} />
          <p className="hint">提示词管得多严。太高画面会发硬。</p>
        </div>
        <div className="field">
          <label htmlFor={id('sampler')}>采样器</label>
          <select className="select mono sx-sel" id={id('sampler')} value={defaults.sampler} onChange={(e) => onSave({ sampler: e.target.value })}>
            {pick(samplers, defaults.sampler).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <p className="hint">画的算法，换了画风会有点变化。</p>
        </div>
        <div className="field">
          <label htmlFor={id('scheduler')}>调度器</label>
          <select className="select mono sx-sel" id={id('scheduler')} value={defaults.scheduler} onChange={(e) => onSave({ scheduler: e.target.value })}>
            {pick(schedulers, defaults.scheduler).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <p className="hint">每一步画多少的节奏。</p>
        </div>
        <div className="field">
          <label htmlFor={id('clip')}>clip skip</label>
          <CommitInput className="input mono" id={id('clip')} value={String(defaults.clipSkip)} parse={integerFrom(1)} onCommit={(v) => onSave({ clipSkip: Number(v) })} />
          <p className="hint">这两个系列都要设 2，不设出来是糊的。</p>
        </div>
      </div>
    </section>
  );
}

export function ImagesTab({ workFolder }: { workFolder: string | null }) {
  const [info, setInfo] = useState<ImageTempInfo | null>(null);

  useEffect(() => {
    if (workFolder) api<ImageTempInfo>('/image-temp').then(setInfo, failed);
  }, [workFolder]);

  if (!workFolder) return NO_FOLDER;
  if (!info) return null;

  const count = info.days.reduce((sum, day) => sum + day.count, 0);
  const bytes = info.days.reduce((sum, day) => sum + day.bytes, 0);
  return (
    <>
      <div className="st-head">
        <div>
          <h2>出的图</h2>
          <p>出的图先放在工作文件夹的临时文件夹里，按日期分子文件夹。大多用不上，挑出好的点「下载」存进资产库。</p>
        </div>
        {SHARED}
      </div>
      <section className="card editor" data-od-id="image-temp">
        <div className="kv">
          <div className="kv-row">
            <span className="k">临时文件夹</span>
            <span className="row" style={{ flexWrap: 'wrap' }}>
              <span className="mono">{info.path}</span>
              <button type="button" className="btn btn-secondary btn-sm" id="tmpOpen" onClick={() => void api('/image-temp/open', { method: 'POST' }).catch(failed)}>
                <Icon name="external" />
                在资源管理器里打开
              </button>
            </span>
          </div>
          <div className="kv-row">
            <span className="k">现在里面有</span>
            {count ? (
              <span>
                <span className="mono">{count}</span> 张 · <span className="mono">{fmtSize(bytes)}</span>{' '}
                <span className="meta">· 按日期分在 {info.days.length} 个子文件夹里</span>
              </span>
            ) : (
              <span className="meta">还没出过图</span>
            )}
          </div>
          <div className="kv-row">
            <span className="k">谁来清</span>
            <span>程序不自动删，你自己在资源管理器里清。清掉以后，节点里下载过的图改显示下载的那份；没下载过的显示「已清理」，参数还在，照样能「同样参数再来」。</span>
          </div>
          <div className="kv-row">
            <span className="k">上次下载到</span>
            {info.lastDownload ? (
              <span className="row" style={{ flexWrap: 'wrap' }}>
                <span className="mono">{info.lastDownload.folder}</span>
                {info.lastDownload.inLibrary ? (
                  <span className="tag tag-ok">
                    <Icon name="check" />
                    在资产库里
                  </span>
                ) : (
                  <span className="tag tag-warn">不在资产库里</span>
                )}
                <span className="meta">只记在这台电脑上</span>
              </span>
            ) : (
              <span className="meta">还没下载过</span>
            )}
          </div>
        </div>
        {info.days.length > 0 && (
          <div className="sx-days">
            {info.days.map((day) => (
              <div className="sx-day" key={day.name}>
                <span className="mono">{day.name}</span>
                <span className="meta">
                  <span className="mono">{day.count}</span> 张 · <span className="mono">{fmtSize(day.bytes)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
