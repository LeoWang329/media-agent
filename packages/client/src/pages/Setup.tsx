import { DEFAULT_IMAGE_LONG_SIDE, DEFAULT_PRICING, type Config, type ModelConfigWithKey } from '@media-agent/shared';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { isPriced, ModelForm, type ModelFormErrors, type ModelFormHandle } from '../components/ModelForm';
import { Icon } from '../ui/Icon';
import { ThemeToggle } from '../ui/theme';
import { toast } from '../ui/toast';

const DEFAULT_PROMPT = 'ref2va';

const STEPS = [
  ['工作文件夹', '画布和图片副本存哪'],
  ['模型配置', '用哪个 AI 写提示词'],
  ['开始用', '去首页建第一张画布'],
] as const;

const newConfig = (): ModelConfigWithKey => ({
  id: crypto.randomUUID(),
  name: '主力',
  baseUrl: '',
  apiKey: '',
  model: '',
  imageLongSide: DEFAULT_IMAGE_LONG_SIDE,
  pricing: DEFAULT_PRICING,
});

// 第一次打开：选工作文件夹 → 填一套模型配置 → 汇总
export function Setup() {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<Config | null>(null);
  const [dir, setDir] = useState('');
  const [model, setModel] = useState<ModelConfigWithKey>(newConfig);

  useEffect(() => {
    document.title = '第一次设置 · 提示词画布';
    api<Config>('/config').then((loaded) => {
      setConfig(loaded);
      setDir(loaded.workFolder ?? '');
    }, (err: Error) => toast(err.message, { tone: 'danger' }));
  }, []);

  return (
    <>
      <header className="appbar">
        <span className="brand"><span className="brand-mark"><Icon name="logo" /></span>提示词画布</span>
        <span className="spacer" />
        <ThemeToggle />
      </header>

      <main className="su">
        <aside data-od-id="setup-steps">
          <div className="su-intro">
            <h1>先设置两件事</h1>
            <p>第一次打开，这里还什么都没有。选好工作文件夹、填一套模型配置，就能开始写提示词。</p>
          </div>
          <ol className="su-steps" id="steps">
            {STEPS.map(([title, sub], i) => (
              <li key={title} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} aria-current={i === step ? 'step' : 'false'}>
                <div><b>{title}</b><span>{sub}</span></div>
              </li>
            ))}
          </ol>
        </aside>
        <section className="card su-card" id="card" data-od-id="setup-card" aria-live="polite">
          {step === 0 && config && (
            <WorkFolderStep
              dir={dir}
              onDir={setDir}
              onDone={(next) => {
                setConfig(next);
                // 同步盘上的工作文件夹可能已经有模型配置了（另一台电脑建的），那就给它补密钥
                setModel((current) => next.modelConfigs.find((m) => m.id === current.id) ?? next.modelConfigs[0] ?? current);
                setStep(1);
              }}
            />
          )}
          {step === 1 && config && (
            <ModelStep
              config={config}
              model={model}
              onModel={setModel}
              onBack={() => setStep(0)}
              onDone={(next) => {
                setConfig(next);
                setStep(2);
              }}
            />
          )}
          {step === 2 && config && <DoneStep config={config} model={model} onBack={() => setStep(1)} />}
        </section>
      </main>
    </>
  );
}

function WorkFolderStep({ dir, onDir, onDone }: { dir: string; onDir: (dir: string) => void; onDone: (config: Config) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trimmed = dir.trim();

  const pick = async () => {
    try {
      const { path } = await api<{ path: string | null }>('/assets/pick-folder', { method: 'POST', body: { start: trimmed || undefined } });
      if (path) {
        onDir(path);
        setError('');
      }
    } catch (err) {
      toast((err as Error).message, { tone: 'danger' });
    }
  };

  const next = async () => {
    if (!trimmed) {
      setError('先选一个文件夹');
      input.current?.focus();
      return;
    }
    setBusy(true);
    try {
      onDone(await api<Config>('/config', { method: 'PUT', body: { workFolder: trimmed } }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <>
      <h2>选工作文件夹</h2>
      <p className="lead">画布、系统提示词、图片副本都存在这里。建议放在同步盘里，两台电脑就能共用同一份。</p>
      <div className="field" data-od-id="field-workdir">
        <label htmlFor="dir">文件夹</label>
        <div className="input-group">
          <input
            ref={input}
            className={`input mono${error ? ' is-error' : ''}`}
            id="dir"
            placeholder="D:\同步盘\提示词画布"
            value={dir}
            spellCheck={false}
            onChange={(e) => {
              onDir(e.target.value);
              setError('');
            }}
          />
          <button type="button" className="btn btn-secondary" id="pick" onClick={() => void pick()}>
            <Icon name="folder" />选择…
          </button>
        </div>
        <p className={error ? 'hint is-error' : 'hint'} id="dirHint">{error || '没有这个文件夹的话会新建。'}</p>
      </div>
      <div id="treeWrap">
        {trimmed && (
          <>
            <p className="label" style={{ marginTop: 20 }}>会在里面建好这些</p>
            <div className="tree">
              {`${trimmed}\n├─ model-configs.json   `}<span className="c">模型配置，不含密钥</span>
              {'\n├─ prompts\\             '}<span className="c">系统提示词，放进自带的 ref2va、i2v、t2v</span>
              {'\n├─ canvases\\            '}<span className="c">画布、节点对话、放进槽位的图片副本</span>
              {'\n└─ .trash\\              '}<span className="c">删掉的画布和节点</span>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>文件夹里已经有同名的系统提示词时，不会覆盖。</p>
          </>
        )}
      </div>
      <div className="su-foot">
        <span className="grow meta">密钥不会存进这个文件夹</span>
        <button type="button" className="btn btn-primary btn-lg" id="next" disabled={busy} onClick={() => void next()}>
          {busy ? <><span className="spinner" />正在建目录…</> : <>下一步<Icon name="arrow-right" /></>}
        </button>
      </div>
    </>
  );
}

type ModelStepProps = {
  config: Config;
  model: ModelConfigWithKey;
  onModel: (model: ModelConfigWithKey) => void;
  onBack: () => void;
  onDone: (config: Config) => void;
};

function ModelStep({ config, model, onModel, onBack, onDone }: ModelStepProps) {
  const form = useRef<ModelFormHandle>(null);
  const [errors, setErrors] = useState<ModelFormErrors>({});

  // 这一套放进列表，整份存回去。已经有同 id 的原位替换：顺序不能变，新节点默认用第一套
  const save = async (item: ModelConfigWithKey) => {
    const exists = config.modelConfigs.some((m) => m.id === item.id);
    const modelConfigs = exists ? config.modelConfigs.map((m) => (m.id === item.id ? item : m)) : [...config.modelConfigs, item];
    return api<Config>('/config', { method: 'PUT', body: { modelConfigs } });
  };

  const next = async () => {
    const found: ModelFormErrors = {};
    if (!model.name.trim()) found.name = '起个名字，节点里靠它选';
    if (!model.model.trim()) found.model = '填接口认的模型名';
    if (!/^https?:\/\//.test(model.baseUrl.trim())) found.url = '接口地址要以 http:// 或 https:// 开头';
    if (!model.apiKey && !form.current?.hasTypedKey()) found.key = '还没填密钥';
    setErrors(found);
    if (Object.keys(found).length) {
      // 等标红的框画出来再把光标放过去
      requestAnimationFrame(() => document.querySelector<HTMLElement>('#mf .is-error')?.focus());
      return;
    }
    const item = form.current!.storeKey();
    try {
      onDone(await save({ ...item, name: item.name.trim(), model: item.model.trim(), baseUrl: item.baseUrl.trim() }));
    } catch (err) {
      toast((err as Error).message, { tone: 'danger' });
    }
  };

  return (
    <>
      <h2>填一套模型配置</h2>
      <p className="lead">决定用哪个 AI 来写提示词。以后可以在设置里再加几套，每个节点自己选用哪套。</p>
      <div id="mf">
        <ModelForm
          ref={form}
          value={model}
          onChange={onModel}
          errors={errors}
          onClearError={(field) => setErrors((e) => ({ ...e, [field]: undefined }))}
          beforeTest={async (item) => {
            await save(item);
          }}
        />
      </div>
      <div className="su-foot">
        <button type="button" className="btn btn-ghost" id="back" onClick={onBack}>
          <Icon name="chev-left" />上一步
        </button>
        <span className="grow" />
        <button type="button" className="btn btn-primary btn-lg" id="next" onClick={() => void next()}>
          保存并继续<Icon name="arrow-right" />
        </button>
      </div>
    </>
  );
}

function DoneStep({ config, model, onBack }: { config: Config; model: ModelConfigWithKey; onBack: () => void }) {
  const [prompts, setPrompts] = useState<string[]>([]);

  useEffect(() => {
    api<string[]>('/prompts').then(setPrompts, () => setPrompts([]));
  }, []);

  return (
    <>
      <h2>设置好了</h2>
      <p className="lead">这些以后都能在设置里改。</p>
      <div className="sum">
        <div className="sum-row">
          <span className="k">工作文件夹</span>
          <span className="v">
            <span className="mono">{config.workFolder}</span>
            <span className="tag tag-ok"><Icon name="check" />目录建好了</span>
          </span>
        </div>
        <div className="sum-row">
          <span className="k">模型配置</span>
          <span className="v">
            {model.name} · <span className="mono">{model.model}</span>
            <span className="tag tag-ok"><Icon name="check" />密钥已配置</span>
            {isPriced(model.pricing) && <span className="tag">填了价格</span>}
          </span>
        </div>
        <div className="sum-row">
          <span className="k">系统提示词</span>
          <span className="v">
            放进了 {prompts.length} 套：
            {prompts.map((name, i) => (
              <Fragment key={name}>
                {i > 0 && '、'}
                <span className="mono">{name}</span>
                {name === DEFAULT_PROMPT && '（新节点默认用）'}
              </Fragment>
            ))}
          </span>
        </div>
      </div>
      <div className="su-foot">
        <button type="button" className="btn btn-ghost" id="back" onClick={onBack}>
          <Icon name="chev-left" />上一步
        </button>
        <span className="grow" />
        <Link className="btn btn-primary btn-lg" to="/">进入首页<Icon name="arrow-right" /></Link>
      </div>
    </>
  );
}
