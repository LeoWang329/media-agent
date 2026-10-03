import {
  DEFAULT_IMAGE_LONG_SIDE,
  DEFAULT_MODEL_THINKING,
  DEFAULT_PRICING,
  THINKING_LEVELS,
  type Config,
  type ModelConfigWithKey,
  type SharedSettings,
  type ThinkingSettings,
  type ThinkingUse,
} from '@media-agent/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api, promptUrl } from '../api';
import { isPriced, ModelForm } from '../components/ModelForm';
import { confirmBox } from '../ui/confirm';
import { fmtNum } from '../ui/copy';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { SaveState, trackWrite } from '../ui/saveState';
import { ThemeToggle } from '../ui/theme';
import { LEVEL_LABELS, STYLE_LABELS, styleNote } from '../ui/thinking';
import { toast } from '../ui/toast';

type Tab = 'workdir' | 'models' | 'prompts' | 'format' | 'thinking';

const TABS: [Tab, string, IconName][] = [
  ['workdir', '工作文件夹', 'folder'],
  ['models', '模型配置', 'cpu'],
  ['prompts', '系统提示词', 'doc'],
  ['format', '固定格式要求', 'lock'],
  ['thinking', '思考', 'brain'],
];

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

export function Settings() {
  const { hash } = useLocation();
  const hashTab = hash.replace('#', '') as Tab;
  const tab: Tab = TABS.some(([id]) => id === hashTab) ? hashTab : 'models';
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    document.title = '设置 · 提示词画布';
    api<Config>('/config').then(setConfig, failed);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  return (
    <>
      <header className="appbar" data-od-id="settings-appbar">
        <Link className="brand" to="/"><span className="brand-mark"><Icon name="logo" /></span>提示词画布</Link>
        <span className="muted hide-sm">/</span>
        <span className="hide-sm">设置</span>
        <span className="spacer" />
        <SaveState idle="改动自动写入" />
        <ThemeToggle />
        <Link className="btn btn-ghost" to="/"><Icon name="home" /><span className="hide-sm">回首页</span></Link>
      </header>

      <div className="st">
        <nav className="st-nav" aria-label="设置分类" data-od-id="settings-nav">
          <h1>设置</h1>
          {TABS.map(([id, label, icon]) => (
            <Link key={id} to={{ hash: id }} data-tab={id} aria-current={tab === id ? 'page' : 'false'}>
              <Icon name={icon} />{label}
            </Link>
          ))}
        </nav>
        <main className="st-main" id="main" data-od-id="settings-main">
          {config && tab === 'workdir' && <WorkdirTab config={config} onConfig={setConfig} />}
          {/* 模型配置和系统提示词都存在工作文件夹里，换了工作文件夹就重新加载 */}
          {config && tab === 'models' && (
            // 改动记在页面这一层：切到别的分类再切回来，看到的还是刚改过的列表
            <ModelsTab key={config.workFolder} config={config} onItems={(modelConfigs) => setConfig((c) => c && { ...c, modelConfigs })} />
          )}
          {config && tab === 'prompts' && <PromptsTab key={config.workFolder} workFolder={config.workFolder} />}
          {tab === 'format' && <FormatTab />}
          {config && tab === 'thinking' && <ThinkingTab key={config.workFolder} config={config} />}
        </main>
      </div>
    </>
  );
}

type WorkFolderStatus = { path: string; writable: boolean; canvases: number; prompts: number; modelConfigs: number };

function WorkdirTab({ config, onConfig }: { config: Config; onConfig: (config: Config) => void }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<WorkFolderStatus | null>(null);

  useEffect(() => {
    setStatus(null);
    if (config.workFolder) api<WorkFolderStatus>('/work-folder').then(setStatus, failed);
  }, [config.workFolder]);

  const pickAndSwitch = async () => {
    try {
      const { path } = await api<{ path: string | null }>('/assets/pick-folder', { method: 'POST', body: { start: config.workFolder ?? undefined } });
      if (!path) return;
      onConfig(await trackWrite(api<Config>('/config', { method: 'PUT', body: { workFolder: path } })));
      toast(`已换到 ${path}`);
    } catch (err) {
      // 弹不出系统窗口时，去首次设置页手填路径
      toast((err as Error).message, { tone: 'warn', ms: 4500, action: '去填写', onAction: () => navigate('/setup') });
    }
  };

  const change = async () => {
    if (!config.workFolder) return pickAndSwitch();
    const ok = await confirmBox({
      title: '换工作文件夹？',
      body: '换过去以后，首页只显示新文件夹里的画布。现在这个文件夹里的东西不会动，换回来还在。',
      ok: '选新文件夹…',
    });
    if (ok) await pickAndSwitch();
  };

  const open = async () => {
    try {
      await api('/work-folder/open', { method: 'POST' });
      toast(`已在资源管理器里打开 ${config.workFolder}`);
    } catch (err) {
      failed(err);
    }
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>工作文件夹</h2>
          <p>画布、系统提示词、图片副本和模型配置都存在这里。放在同步盘上，两台电脑轮流打开的是同一份。</p>
        </div>
      </div>
      <div className="card editor" data-od-id="workdir-card">
        <div className="kv">
          <div className="kv-row">
            <span className="k">路径</span>
            <span className="row" style={{ flexWrap: 'wrap' }}>
              {config.workFolder ? <span className="mono">{config.workFolder}</span> : <span className="muted">还没选</span>}
              {status && (status.writable
                ? <span className="tag tag-ok"><Icon name="check" />能读写</span>
                : <span className="tag tag-danger"><Icon name="x" />写不进去</span>)}
            </span>
          </div>
          {status && (
            <div className="kv-row">
              <span className="k">里面有</span>
              <span>{status.canvases} 个画布 · {status.prompts} 套系统提示词 · {status.modelConfigs} 套模型配置</span>
            </div>
          )}
        </div>
        <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" id="wdChange" onClick={() => void change()}>
            <Icon name="folder" />{config.workFolder ? '换一个文件夹…' : '选文件夹…'}
          </button>
          {config.workFolder && (
            <button type="button" className="btn btn-ghost" id="wdOpen" onClick={() => void open()}>
              <Icon name="external" />在资源管理器里打开
            </button>
          )}
        </div>
      </div>
      <div className="where">
        <div className="card">
          <h3><Icon name="folder" />存在工作文件夹，两台电脑共用</h3>
          <ul><li>画布、节点对话和版本</li><li>放进过槽位的图片副本</li><li>系统提示词</li><li>模型配置（不含密钥）</li></ul>
        </div>
        <div className="card">
          <h3><Icon name="lock" />只存在这台电脑上</h3>
          <ul><li>模型配置的密钥</li><li>资产库导入过哪些文件夹</li><li>资产库的缩略图</li></ul>
        </div>
      </div>
    </>
  );
}

const SAVE_DELAY = 500;

// 改一次存一次太频繁，停手半秒再存；切走之前没存的立刻存
function useDebouncedSave<T>(save: (value: T) => Promise<unknown>) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const latestSave = useRef(save);
  latestSave.current = save;

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const item = pending.current;
    pending.current = null;
    if (item) await latestSave.current(item.value).catch(failed);
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [flush],
  );

  const isPending = useCallback(() => pending.current !== null, []);

  useEffect(() => () => void flush(), [flush]);
  return { schedule, flush, isPending };
}

function ModelsTab({ config, onItems: setItems }: { config: Config; onItems: (list: ModelConfigWithKey[]) => void }) {
  const items = config.modelConfigs;
  // 从「思考」里点某一套的「改」过来，选中那一套
  const linked = (useLocation().state as { modelId?: string } | null)?.modelId;
  const [selectedId, setSelectedId] = useState(linked ?? items[0]?.id ?? null);
  const selected = items.find((m) => m.id === selectedId) ?? items[0];
  const save = (list: ModelConfigWithKey[]) => trackWrite(api<Config>('/config', { method: 'PUT', body: { modelConfigs: list } }));
  const { schedule, flush } = useDebouncedSave(save);

  if (!config.workFolder) {
    return <p className="muted">模型配置存在工作文件夹里，先在「工作文件夹」里选一个。</p>;
  }

  const replace = (next: ModelConfigWithKey) => {
    const list = items.map((m) => (m.id === next.id ? next : m));
    setItems(list);
    schedule(list);
    return list;
  };

  const create = async () => {
    await flush();
    const item: ModelConfigWithKey = { id: crypto.randomUUID(), name: '新配置', baseUrl: '', apiKey: '', model: '', imageLongSide: DEFAULT_IMAGE_LONG_SIDE, pricing: DEFAULT_PRICING, ...DEFAULT_MODEL_THINKING };
    const list = [...items, item];
    setItems(list);
    setSelectedId(item.id);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#mf-name')?.select());
    await save(list).catch(failed);
  };

  const remove = async (m: ModelConfigWithKey) => {
    const ok = await confirmBox({
      title: `删除「${m.name}」？`,
      body: '用这套配置的节点，下次发消息前要重新选一套。已经发出去的消息不受影响。这台电脑上存的密钥也一起删掉。',
      ok: '删除',
      danger: true,
    });
    if (!ok) return;
    await flush();
    const list = items.filter((x) => x.id !== m.id);
    setItems(list);
    setSelectedId(list[0]?.id ?? null);
    try {
      await save(list);
      toast('已删除');
    } catch (err) {
      failed(err);
    }
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>模型配置</h2>
          <p>决定用哪个 AI 写提示词。可以存好几套，每个节点在自己的对话面板里选用哪套。</p>
        </div>
        <button type="button" className="btn btn-primary" id="mNew" onClick={() => void create()}>
          <Icon name="plus" />新建配置
        </button>
      </div>
      <div className="split">
        <div className="list" id="mList" data-od-id="model-config-list">
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              className="li"
              data-model={m.id}
              aria-current={m.id === selected?.id ? 'true' : 'false'}
              onClick={() => void flush().then(() => setSelectedId(m.id))}
            >
              <span className="t">{m.name}</span>
              <span className="s mono">{m.model} · {m.baseUrl.replace(/^https?:\/\//, '')}</span>
              <span className="tags">
                {m.apiKey
                  ? <span className="tag tag-ok"><Icon name="key" />密钥已配置</span>
                  : <span className="tag tag-warn"><Icon name="key" />这台电脑还没填密钥</span>}
                {isPriced(m.pricing)
                  ? <span className="tag mono">{m.pricing.currency}{m.pricing.input} / {m.pricing.currency}{m.pricing.output}</span>
                  : <span className="tag">没填价格</span>}
              </span>
            </button>
          ))}
        </div>
        {selected ? (
          <section className="card editor" data-od-id="model-config-editor">
            <div className="editor-head">
              <h2 id="mTitle">{selected.name || '（没起名）'}</h2>
              <button type="button" className="btn btn-danger-ghost btn-sm" id="mDel" onClick={() => void remove(selected)}>
                <Icon name="trash" />删除这套
              </button>
            </div>
            <div id="mf">
              <ModelForm
                key={selected.id}
                value={selected}
                onChange={replace}
                beforeTest={async (item) => {
                  replace(item);
                  await flush();
                }}
              />
            </div>
          </section>
        ) : (
          <p className="muted">还没有模型配置。</p>
        )}
      </div>
    </>
  );
}

type Prompt = { name: string; text: string };

const BUILTIN: Record<string, string> = {
  ref2va: '有参考图，图提供人物、场景、风格或分镜',
  i2v: '一张图当第一帧往后演',
  t2v: '纯文字，不用图',
};
const DEFAULT_PROMPT = 'ref2va';

// 自己建的没有说明，拿正文第一行
const describe = (p: Prompt) => BUILTIN[p.name] ?? (p.text.split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean) || '自己建的');

function PromptsTab({ workFolder }: { workFolder: string | null }) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = prompts.find((p) => p.name === selectedName) ?? prompts[0];
  const { schedule, flush, isPending } = useDebouncedSave((p: Prompt) =>
    trackWrite(api(promptUrl(p.name), { method: 'PUT', body: { text: p.text } })),
  );

  const load = useCallback(async (select?: string) => {
    const names = await api<string[]>('/prompts');
    const list = await Promise.all(names.map((name) => api<Prompt>(promptUrl(name))));
    setPrompts(list);
    if (select !== undefined) setSelectedName(select);
  }, []);

  useEffect(() => {
    if (workFolder) load().catch(failed);
  }, [workFolder, load]);

  // 用外部编辑器改完切回来，把文件里的新内容读回来（这边正在改的不动）
  const selectedPromptName = selected?.name;
  useEffect(() => {
    if (!selectedPromptName) return;
    const onFocus = () => {
      if (isPending()) return;
      api<Prompt>(promptUrl(selectedPromptName)).then(
        (fresh) => setPrompts((list) => list.map((p) => (p.name === fresh.name && p.text !== fresh.text ? fresh : p))),
        () => {},
      );
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [selectedPromptName, isPending]);

  if (!workFolder) return <p className="muted">系统提示词存在工作文件夹里，先在「工作文件夹」里选一个。</p>;

  const sep = workFolder.includes('\\') ? '\\' : '/';

  const edit = (text: string) => {
    const next = { ...selected!, text };
    setPrompts((list) => list.map((p) => (p.name === next.name ? next : p)));
    schedule(next);
  };

  const remove = async (p: Prompt) => {
    const ok = await confirmBox({
      title: `删除「${p.name}」？`,
      body: (
        <>
          {p.name === DEFAULT_PROMPT && <>这是新节点默认用的一套，删掉后新节点要自己选。<br /><br /></>}
          用这套的节点下次发消息前要重新选一套。已经发出去的消息还能查到当时的原文。
        </>
      ),
      ok: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await flush();
      await trackWrite(api(promptUrl(p.name), { method: 'DELETE' }));
      await load();
      setSelectedName(null);
      toast('已删除');
    } catch (err) {
      failed(err);
    }
  };

  const openExternal = async (p: Prompt) => {
    try {
      await flush();
      await api(`${promptUrl(p.name)}/open`, { method: 'POST' });
      toast(`已用默认编辑器打开 ${p.name}.md，外面改完回来这里会自动刷新`);
    } catch (err) {
      failed(err);
    }
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>系统提示词</h2>
          <p>给 AI 的长期指令，决定它按什么规矩写提示词。每个节点自己选用哪套；每次发消息用到的版本会另存一份，改了也能查到当时的原文。</p>
        </div>
        <button type="button" className="btn btn-primary" id="pNew" onClick={() => setCreating(true)}>
          <Icon name="plus" />新建
        </button>
      </div>
      <div className="split">
        <div className="list" id="pList" data-od-id="system-prompt-list">
          {prompts.map((p) => (
            <button
              key={p.name}
              type="button"
              className="li"
              data-prompt={p.name}
              aria-current={p.name === selected?.name ? 'true' : 'false'}
              onClick={() => void flush().then(() => setSelectedName(p.name))}
            >
              <span className="t mono">{p.name}</span>
              <span className="s">{describe(p)}</span>
              <span className="tags">
                {p.name in BUILTIN ? <span className="tag">自带</span> : <span className="tag">自己建的</span>}
                {p.name === DEFAULT_PROMPT && <span className="tag tag-accent">新节点默认</span>}
                <span className="tag mono">{fmtNum(p.text.length)} 字</span>
              </span>
            </button>
          ))}
        </div>
        {selected && (
          <section className="card editor" data-od-id="system-prompt-editor">
            <div className="editor-head">
              <h2 className="mono">{selected.name}.md</h2>
              <button type="button" className="btn btn-secondary btn-sm" id="pExt" onClick={() => void openExternal(selected)}>
                <Icon name="external" />用外部编辑器打开
              </button>
              <button type="button" className="btn btn-danger-ghost btn-sm" id="pDel" onClick={() => void remove(selected)}>
                <Icon name="trash" />删除
              </button>
            </div>
            <textarea
              className="textarea prompt-area"
              id="pText"
              aria-label="系统提示词内容"
              spellCheck={false}
              value={selected.text}
              onChange={(e) => edit(e.target.value)}
            />
            <p className="hint" style={{ marginTop: 8 }}>
              改动自动写进 <span className="mono">{`${workFolder}${sep}prompts${sep}${selected.name}.md`}</span>。程序会在这段后面自动接上
              <Link className="linkish" to={{ hash: 'format' }}>固定格式要求</Link>。
            </p>
          </section>
        )}
      </div>
      {creating && (
        <NewPromptDialog
          from={selected}
          existing={prompts.map((p) => p.name)}
          onClose={() => setCreating(false)}
          onCreated={async (name) => {
            setCreating(false);
            await load(name);
          }}
        />
      )}
    </>
  );
}

type NewPromptProps = { from: Prompt | undefined; existing: string[]; onClose: () => void; onCreated: (name: string) => Promise<void> };

function NewPromptDialog({ from, existing, onClose, onCreated }: NewPromptProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    const value = name.trim();
    if (!value) return setError('先起个名字');
    if (existing.includes(value)) return setError(`已经有叫「${value}」的了`);
    try {
      await trackWrite(api('/prompts', { method: 'POST', body: { name: value, text: from?.text ?? '' } }));
      await onCreated(value);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Dialog label="新建系统提示词" onClose={onClose}>
      <div className="dialog-head"><h2>新建系统提示词</h2></div>
      <div className="dialog-body">
        <div className="field">
          <label htmlFor="pn">名字</label>
          <input
            className="input mono"
            id="pn"
            placeholder="比如：i2v-慢节奏"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          <p className={error ? 'hint is-error' : 'hint'} id="pnh">
            {error || (from ? `会存成 prompts 文件夹里的一个 .md 文件，内容先复制当前选中的「${from.name}」。` : '会存成 prompts 文件夹里的一个 .md 文件，内容先空着。')}
          </p>
        </div>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
        <button type="button" className="btn btn-primary" onClick={() => void create()}>新建</button>
      </div>
    </Dialog>
  );
}

function FormatTab() {
  const [text, setText] = useState('');

  useEffect(() => {
    api<{ text: string }>('/format-requirement').then((res) => setText(res.text), failed);
  }, []);

  return (
    <>
      <div className="st-head">
        <div>
          <h2>固定格式要求</h2>
          <p>程序自动接在每套系统提示词后面（中间空两行）。程序靠这个格式把提示词框从回复里切出来，所以这里只能看，不能改。</p>
        </div>
        <span className="tag"><Icon name="lock" />只能看</span>
      </div>
      <pre className="ro" data-od-id="format-requirement">{text}</pre>
    </>
  );
}

const THINKING_USE_ROWS: [ThinkingUse, string, string][] = [
  ['chat', '写提示词', '节点里聊天时。默认跟总开关。开了思考，回复前会先显示「正在思考 N 秒」，想完才出正文。'],
  ['translate', '翻译', '提示词框上的「翻译」。默认关，翻译用不着想，快也省钱。'],
  ['tagging', '转标签', '标签编辑窗里「让 AI 转成标签」。默认关，几秒就该回来。'],
];

function ThinkingTab({ config }: { config: Config }) {
  const [thinking, setThinking] = useState<ThinkingSettings | null>(null);
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    if (config.workFolder) api<SharedSettings>('/settings').then((s) => setThinking(s.thinking), failed);
  }, [config.workFolder]);

  if (!config.workFolder) return <p className="muted">思考的设置存在工作文件夹里，先在「工作文件夹」里选一个。</p>;
  if (!thinking) return null;

  // 改一项存一项，按点的顺序存，连着点几下最后存下的是最后点的那个
  const change = (patch: Partial<ThinkingSettings>) => {
    setThinking({ ...thinking, ...patch });
    saving.current = saving.current.then(() => trackWrite(api('/settings', { method: 'PUT', body: { thinking: patch } })).then(() => undefined, failed));
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>思考</h2>
          <p>有的模型回答前会先想一会儿。想得越深越慢，花的钱也越多（想的部分按输出算钱）。这里管想不想、想多深。</p>
        </div>
        <span className="tag sx-where"><Icon name="folder" />存在工作文件夹，两台电脑共用</span>
      </div>
      <section className="card editor" data-od-id="thinking-settings">
        <div className="kv">
          <div className="kv-row">
            <span className="k">总档位</span>
            <div className="stack" style={{ gap: 6 }}>
              <div className="seg" id="thLevel" role="group" aria-label="总档位">
                {THINKING_LEVELS.map((level) => (
                  <button key={level} type="button" aria-pressed={thinking.level === level} onClick={() => change({ level })}>
                    {LEVEL_LABELS[level]}
                  </button>
                ))}
              </div>
              <span className="hint">下面选「跟总开关」的用途都按这一档。只能开关、调不了深浅的模型，低中高都当「开」。</span>
            </div>
          </div>
          {THINKING_USE_ROWS.map(([use, name, note]) => (
            <div className="kv-row" key={use}>
              <label className="k" htmlFor={`th-${use}`}>{name}</label>
              <div className="stack" style={{ gap: 4 }}>
                <select
                  className="select"
                  style={{ width: 200 }}
                  id={`th-${use}`}
                  value={thinking[use]}
                  onChange={(e) => change({ [use]: e.target.value } as Partial<ThinkingSettings>)}
                >
                  <option value="follow">跟总开关（现在是「{LEVEL_LABELS[thinking.level]}」）</option>
                  {THINKING_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {LEVEL_LABELS[level]}
                    </option>
                  ))}
                </select>
                <span className="hint">{note}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="card editor" style={{ marginTop: 16 }} data-od-id="thinking-model-styles">
        <h3 style={{ marginBottom: 4 }}>每套模型配置怎么开思考</h3>
        <p className="hint" style={{ marginBottom: 12 }}>各家开思考的写法不一样，在每套模型配置里选「开思考的写法」。选「不支持」的，上面的档位对它不起作用。</p>
        <div className="sx-list">
          {config.modelConfigs.map((m) => (
            <div className="sx-row" key={m.id}>
              <b>{m.name}</b>
              <span className="mono meta">{m.model}</span>
              <span className="tag mono">{STYLE_LABELS[m.thinkingStyle]}</span>
              <span className="meta grow">{styleNote(m)}</span>
              <Link className="btn btn-ghost btn-sm" to={{ hash: 'models' }} state={{ modelId: m.id }}>改</Link>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
