import { FAMILIES, type ComfyStatus, type Family, type FamilyDefaults, type ImageTempInfo, type SharedSettings } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { gpuText, vramText } from '../components/ComfyPill';
import { useComfyStore } from '../store/comfyStore';
import { CommitInput, CommitTextarea, integerFrom, numberFrom, trimmed } from '../ui/CommitInput';
import { fmtSize } from '../ui/format';
import { Icon } from '../ui/Icon';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';

// 设置里出图用的三节：局域网那台 ComfyUI、底模和两个系列的默认值、出的图，见 docs/dev-plan.md 6.4

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

const SHARED = (
  <span className="tag sx-where">
    <Icon name="folder" />
    存在工作文件夹，两台电脑共用
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
  const [saved, setSaved] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<ComfyStatus | 'testing' | null>(null);
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    if (!workFolder) return;
    api<SharedSettings>('/settings').then((settings) => {
      const lanUrl = settings.comfy.lanUrl ?? '';
      setSaved(lanUrl);
      setUrl(lanUrl);
      if (!lanUrl) return;
      setResult('testing');
      void useComfyStore.getState().checkStatus().then(setResult);
    }, failed);
  }, [workFolder]);

  if (!workFolder) return NO_FOLDER;

  // 地址改了才存；换了地址，下拉选项要重新读
  const saveUrl = async (): Promise<boolean> => {
    const next = url.trim();
    if (saved === null || next === saved.trim()) return true;
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
          <p>出图的程序跑在有显卡的电脑上，这台只有核显。局域网里那台填好地址就能出图，所有节点共用。</p>
        </div>
      </div>
      <section className="card editor" data-od-id="comfy-lan">
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
    </>
  );
}

const RATING_FIELDS: [keyof FamilyDefaults['rating'], string][] = [
  ['general', '全年龄'],
  ['sensitive', '擦边'],
  ['explicit', '成人'],
];

export function CheckpointsTab({ workFolder }: { workFolder: string | null }) {
  const [settings, setSettings] = useState<SharedSettings | null>(null);
  const options = useComfyStore((s) => s.options);
  const optionsError = useComfyStore((s) => s.optionsError);
  const loading = useComfyStore((s) => s.loadingOptions);

  useEffect(() => {
    if (!workFolder) return;
    api<SharedSettings>('/settings').then(setSettings, failed);
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
            {loading ? '正在读…' : '从局域网那台重新读'}
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
              optionsError.includes('还没填') ? (
                <>
                  还没填局域网 ComfyUI 的地址，先去 <Link to={{ hash: 'comfy' }}>ComfyUI</Link> 里填。
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
