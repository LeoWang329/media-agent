import { DEFAULT_IMAGE_LONG_SIDE, type Config, type ModelConfigWithKey } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, promptUrl } from '../api';

type Status = { kind: 'ok' | 'error' | 'pending'; text: string };

type SectionProps = { config: Config; onSaved: (config: Config) => void };

export function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Config>('/config').then(setConfig, (err: Error) => setError(err.message));
  }, []);

  if (error) return <main className="page"><p className="status error">{error}</p></main>;
  if (!config) return null;
  return (
    <main className="page">
      <header className="topbar">
        <h1>设置</h1>
        <Link to="/">返回首页</Link>
      </header>
      <WorkFolderSection config={config} onSaved={setConfig} />
      {/* 模型配置和系统提示词都存在工作文件夹里，换了工作文件夹就重新加载 */}
      <ModelConfigsSection key={config.workFolder ?? ''} config={config} onSaved={setConfig} />
      {config.workFolder && <PromptsSection key={config.workFolder} />}
      <FormatRequirementSection />
    </main>
  );
}

function WorkFolderSection({ config, onSaved }: SectionProps) {
  const [folder, setFolder] = useState(config.workFolder ?? '');
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await task();
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function save(path: string) {
    const next = await api<Config>('/config', { method: 'PUT', body: { workFolder: path } });
    onSaved(next);
    setFolder(next.workFolder ?? '');
    setStatus({ kind: 'ok', text: '已保存' });
  }

  const pick = () =>
    run(async () => {
      setStatus({ kind: 'pending', text: '请在弹出的窗口里选择文件夹' });
      const { path } = await api<{ path: string | null }>('/assets/pick-folder', { method: 'POST' });
      setStatus(null);
      if (path) await save(path);
    });

  return (
    <section className="card">
      <h2>工作文件夹</h2>
      {!config.workFolder && <p className="status pending">请先选择工作文件夹</p>}
      <div className="row">
        <input
          aria-label="工作文件夹路径"
          value={folder}
          placeholder="例如 D:\同步盘\提示词画布"
          onChange={(e) => setFolder(e.target.value)}
        />
        <button type="button" onClick={pick} disabled={busy}>选择</button>
        <button type="button" onClick={() => run(() => save(folder))} disabled={busy || !folder.trim()}>保存</button>
      </div>
      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
    </section>
  );
}

function ModelConfigsSection({ config, onSaved }: SectionProps) {
  const [items, setItems] = useState<ModelConfigWithKey[]>(config.modelConfigs);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Status | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, Status>>({});

  function edit(next: ModelConfigWithKey[]) {
    setItems(next);
    setDirty(true);
    setSaveStatus(null);
  }

  const update = (id: string, patch: Partial<ModelConfigWithKey>) =>
    edit(items.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const add = () =>
    edit([...items, { id: crypto.randomUUID(), name: '', baseUrl: '', apiKey: '', model: '', imageLongSide: DEFAULT_IMAGE_LONG_SIDE }]);

  async function save(): Promise<boolean> {
    try {
      const next = await api<Config>('/config', { method: 'PUT', body: { modelConfigs: items } });
      onSaved(next);
      setItems(next.modelConfigs);
      setDirty(false);
      setSaveStatus({ kind: 'ok', text: '已保存' });
      return true;
    } catch (err) {
      setSaveStatus({ kind: 'error', text: (err as Error).message });
      return false;
    }
  }

  // 测试的是服务端存着的配置，所以有没保存的修改时先保存
  async function test(id: string) {
    const show = (status: Status) => setTestStatus((all) => ({ ...all, [id]: status }));
    show({ kind: 'pending', text: '测试中…' });
    if (dirty && !(await save())) {
      show({ kind: 'error', text: '保存失败，没有测试' });
      return;
    }
    try {
      const result = await api<{ ok: boolean; error?: string }>('/llm/test', { method: 'POST', body: { modelConfigId: id } });
      show(result.ok ? { kind: 'ok', text: '连接成功' } : { kind: 'error', text: `连接失败：${result.error}` });
    } catch (err) {
      show({ kind: 'error', text: `连接失败：${(err as Error).message}` });
    }
  }

  if (!config.workFolder) {
    return (
      <section className="card">
        <h2>模型配置</h2>
        <p className="status pending">模型配置存在工作文件夹里，先设置工作文件夹</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>模型配置</h2>
      {items.map((m) => (
        <div className="model-config" key={m.id}>
          <label>
            <span>名字</span>
            <input value={m.name} onChange={(e) => update(m.id, { name: e.target.value })} />
          </label>
          <label>
            <span>接口地址</span>
            <input value={m.baseUrl} placeholder="例如 https://api.openai.com/v1" onChange={(e) => update(m.id, { baseUrl: e.target.value })} />
          </label>
          <label>
            <span>API 密钥</span>
            {/* 已保存的密钥显示成 ******，点进去全选，直接粘贴新的就会替换 */}
            <input
              value={m.apiKey}
              placeholder="只存在本机，换一台机器要再填一次"
              onFocus={(e) => e.target.select()}
              onChange={(e) => update(m.id, { apiKey: e.target.value })}
            />
          </label>
          <label>
            <span>模型名</span>
            <input value={m.model} onChange={(e) => update(m.id, { model: e.target.value })} />
          </label>
          <label>
            <span>发图长边</span>
            <input
              type="number"
              min={1}
              value={Number.isNaN(m.imageLongSide) ? '' : m.imageLongSide}
              onChange={(e) => update(m.id, { imageLongSide: e.target.valueAsNumber })}
            />
          </label>
          <div className="row">
            <button type="button" onClick={() => test(m.id)}>测试连接</button>
            <button type="button" onClick={() => edit(items.filter((x) => x.id !== m.id))}>删除</button>
            {testStatus[m.id] && <span className={`status ${testStatus[m.id].kind}`}>{testStatus[m.id].text}</span>}
          </div>
        </div>
      ))}
      <div className="row actions">
        <button type="button" onClick={add}>新增模型配置</button>
        <button type="button" onClick={save} disabled={!dirty}>保存</button>
        {saveStatus && <span className={`status ${saveStatus.kind}`}>{saveStatus.text}</span>}
      </div>
    </section>
  );
}

function PromptsSection() {
  const [names, setNames] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [savedText, setSavedText] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const dirty = current !== null && text !== savedText;

  async function run(task: () => Promise<void>) {
    setStatus(null);
    try {
      await task();
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    }
  }

  async function openPrompt(name: string) {
    const prompt = await api<{ name: string; text: string }>(promptUrl(name));
    setCurrent(name);
    setText(prompt.text);
    setSavedText(prompt.text);
  }

  async function reloadList(select?: string | null) {
    const list = await api<string[]>('/prompts');
    setNames(list);
    const next = select !== undefined ? select : list[0];
    if (next && list.includes(next)) await openPrompt(next);
    else {
      setCurrent(null);
      setText('');
      setSavedText('');
    }
  }

  useEffect(() => {
    void run(() => reloadList());
  }, []);

  const confirmDiscard = () => !dirty || window.confirm(`「${current}」有没保存的修改，不要了吗？`);

  const create = () =>
    run(async () => {
      if (!confirmDiscard()) return;
      const name = window.prompt('新系统提示词的名字')?.trim();
      if (!name) return;
      await api('/prompts', { method: 'POST', body: { name, text: '' } });
      await reloadList(name);
    });

  const remove = () =>
    run(async () => {
      if (!current || !window.confirm(`删除系统提示词「${current}」？会移到工作文件夹的 .trash 里。`)) return;
      await api(promptUrl(current), { method: 'DELETE' });
      await reloadList();
    });

  return (
    <section className="card">
      <h2>系统提示词</h2>
      <div className="prompts-layout">
        <ul className="prompt-list">
          {names.map((name) => (
            <li key={name}>
              <button
                type="button"
                className={name === current ? 'active' : ''}
                onClick={() =>
                  void run(async () => {
                    if (confirmDiscard()) await openPrompt(name);
                  })
                }
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
        <div className="prompt-editor">
          <textarea aria-label="系统提示词内容" value={text} disabled={current === null} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button
              type="button"
              disabled={!dirty}
              onClick={() =>
                void run(async () => {
                  await api(promptUrl(current!), { method: 'PUT', body: { text } });
                  setSavedText(text);
                  setStatus({ kind: 'ok', text: '已保存，之后的回复按这一版写' });
                })
              }
            >
              保存
            </button>
            <button type="button" onClick={() => void create()}>新建</button>
            <button type="button" disabled={current === null} onClick={() => void remove()}>删除</button>
            <button
              type="button"
              disabled={current === null}
              onClick={() =>
                void run(async () => {
                  await api(`${promptUrl(current!)}/open`, { method: 'POST' });
                })
              }
            >
              用外部编辑器打开
            </button>
            {status && <span className={`status ${status.kind}`}>{status.text}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function FormatRequirementSection() {
  const [text, setText] = useState('');

  useEffect(() => {
    api<{ text: string }>('/format-requirement').then(
      (res) => setText(res.text),
      (err: Error) => setText(`读取失败：${err.message}`),
    );
  }, []);

  return (
    <section className="card">
      <h2>程序固定附加的格式要求</h2>
      <p className="muted">每次发给模型时，自动接在系统提示词后面，这里只能看不能改。</p>
      <pre className="readonly-text">{text}</pre>
    </section>
  );
}
