import { splitTags, type Fragment, type TagInfo, type TagUpdateEvent } from '@media-agent/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, postStream } from '../api';
import { FRAGMENT_CATEGORIES } from '../tags/fragments';
import { TagChip } from '../tags/TagChip';
import { TagEditor } from '../tags/TagEditor';
import { forgetChecks, useTagChecks } from '../tags/tagStore';
import { confirmBox } from '../ui/confirm';
import { fmtNum } from '../ui/copy';
import { Icon } from '../ui/Icon';
import { RenameInput } from '../ui/RenameInput';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';

// 设置里生图用的两节：词库、片段库

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

const SHARED = (
  <span className="tag sx-where">
    <Icon name="folder" />
    存在工作文件夹，两台电脑共用
  </span>
);

const LIB_STEPS = ['下标签', '下别名', '下中文对照'];

// 正在更新：在第几步、这一步下到哪了；rows 是前两步各下了多少
type Update = { since: number; at: number; page: number; rows: [number, number]; file: number; files: number };

const elapsed = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};

export function TagLibraryTab({ workFolder }: { workFolder: string | null }) {
  const [info, setInfo] = useState<TagInfo | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [failure, setFailure] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    if (workFolder) api<TagInfo>('/tags/info').then(setInfo, failed);
  }, [workFolder]);

  // 更新时每秒走一下「开始了多久」
  const updating = Boolean(update);
  useEffect(() => {
    if (!updating) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [updating]);

  if (!workFolder) return <p className="muted">词库存在工作文件夹里，先在「工作文件夹」里选一个。</p>;

  const start = async () => {
    setFailure('');
    setUpdate({ since: Date.now(), at: 0, page: 0, rows: [0, 0], file: 0, files: 0 });
    try {
      await postStream<TagUpdateEvent>('/tags/update', {}, (event) => {
        if (event.type === 'progress') {
          setUpdate((u) => {
            if (!u) return u;
            if (event.step === 'zh') return { ...u, at: 2, file: event.file, files: event.files };
            const at = event.step === 'tags' ? 0 : 1;
            const rows: [number, number] = [...u.rows];
            rows[at] = event.rows;
            return { ...u, at, page: event.page, rows };
          });
        } else if (event.type === 'done') {
          setInfo(event.info);
          // 词库换了，之前的校验结果不算数
          forgetChecks();
          toast(`词库更新好了：${fmtNum(event.info.tags)} 个标签`);
        } else if (event.type === 'stopped') {
          toast('停了，旧词库没动');
        } else {
          setFailure(event.message);
        }
      });
    } catch (err) {
      failed(err);
    } finally {
      setUpdate(null);
    }
  };

  const stop = () => api('/tags/update/stop', { method: 'POST' }).catch(failed);

  const stepNote = (u: Update, i: number) => {
    if (i < u.at) return i === 0 ? `${fmtNum(u.rows[0])} 个` : `${fmtNum(u.rows[1])} 条`;
    if (i > u.at) return '';
    if (i === 2) return u.files ? `${u.files} 个文件里的第 ${u.file} 个` : '';
    return u.page ? `第 ${u.page} 页 · 已下 ${fmtNum(u.rows[i])} ${i === 0 ? '个' : '条'}` : '';
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>词库</h2>
          <p>本机存的 Danbooru 标签，用来中文搜标签、给标签配中文、查出写错的标签。</p>
        </div>
        {SHARED}
      </div>
      <section className="card editor" data-od-id="tag-library">
        {info && (
          <div className="kv" id="libInfo">
            <div className="kv-row">
              <span className="k">哪天的</span>
              <span className="mono">{info.updatedAt ?? '没有记录'}</span>
            </div>
            <div className="kv-row">
              <span className="k">标签</span>
              <span>
                <span className="mono">{fmtNum(info.tags)}</span> 个 <span className="meta">· Danbooru 上用过 50 次以上的</span>
              </span>
            </div>
            <div className="kv-row">
              <span className="k">有中文的</span>
              <span>
                <span className="mono">{fmtNum(info.withZh)}</span> 个{' '}
                <span className="meta">· 按使用次数算 {(info.zhByUse * 100).toFixed(1)}% 有中文；画师大多没有，按原名搜</span>
              </span>
            </div>
            <div className="kv-row">
              <span className="k">别名</span>
              <span>
                <span className="mono">{fmtNum(info.aliases)}</span> 条 <span className="meta">· 旧写法会自动换成标准写法</span>
              </span>
            </div>
            <div className="kv-row">
              <span className="k">来源</span>
              <span className="meta">标签和别名：Danbooru 官方接口；中文：amenorira/danbooru-tags-data-zh（MIT 许可）</span>
            </div>
          </div>
        )}
        {update && (
          <div className="sx-progress" data-od-id="tag-library-progress">
            <div className="row-between">
              <b>正在更新词库</b>
              <span className="meta">
                开始了 <span className="mono">{elapsed(Date.now() - update.since)}</span>，一共大约 4 分钟
              </span>
            </div>
            <ol className="sx-steps-p">
              {LIB_STEPS.map((name, i) => {
                const state = i < update.at ? 'done' : i === update.at ? 'now' : 'todo';
                return (
                  <li key={name} className={`is-${state}`}>
                    {state === 'done' ? <Icon name="check" className="icon-sm" /> : state === 'now' ? <span className="spinner" /> : <span className="sx-dot" />}
                    <span>{name}</span>
                    <span className="meta mono">{stepNote(update, i)}</span>
                  </li>
                );
              })}
            </ol>
            <p className="hint">全部下完才整个换掉，中途失败旧的不动。更新时照样能用，联想先用旧词库。</p>
          </div>
        )}
        {failure && (
          <div className="up-alert is-danger" style={{ marginTop: 14 }} role="alert">
            <Icon name="warn" />
            <span>
              <b>更新失败：</b>
              {failure}。旧词库没动，还能照常用。过一会儿再点更新。
            </span>
          </div>
        )}
        <div className="row" style={{ marginTop: 16 }}>
          {update ? (
            <button type="button" className="btn btn-secondary" id="libStop" onClick={() => void stop()}>
              停止更新
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" id="libUpdate" onClick={() => void start()}>
                <Icon name="refresh" />
                更新词库
              </button>
              <span className="hint">Danbooru 天天有新角色。大约要 4 分钟，一页一页按顺序下。</span>
            </>
          )}
        </div>
      </section>
    </>
  );
}

export function FragmentsTab({ workFolder }: { workFolder: string | null }) {
  const [fragments, setFragments] = useState<Fragment[] | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string; attempt: number } | null>(null);
  const [editing, setEditing] = useState<Fragment | null>(null);

  const load = useCallback(() => api<Fragment[]>('/fragments').then(setFragments, failed), []);
  useEffect(() => {
    if (workFolder) void load();
  }, [workFolder, load]);

  if (!workFolder) return <p className="muted">片段库存在工作文件夹里，先在「工作文件夹」里选一个。</p>;

  const patch = async (fragment: Fragment, body: Partial<Pick<Fragment, 'name' | 'category' | 'text'>>) => {
    try {
      const saved = await trackWrite(api<Fragment>(`/fragments/${fragment.id}`, { method: 'PATCH', body }));
      setFragments((list) => list && list.map((f) => (f.id === saved.id ? saved : f)));
      return true;
    } catch (err) {
      failed(err);
      return false;
    }
  };

  // 名字重了提示换一个，输入框留着接着改
  const rename = async (fragment: Fragment, next: string | null) => {
    const name = next?.trim();
    if (!name || name === fragment.name) return setRenaming(null);
    if (fragments?.some((f) => f.id !== fragment.id && f.name === name)) {
      toast(`已经有叫「${name}」的片段了，换一个名字`, { tone: 'warn' });
      return setRenaming((r) => ({ id: fragment.id, draft: name, attempt: (r?.attempt ?? 0) + 1 }));
    }
    setRenaming(null);
    await patch(fragment, { name });
  };

  const remove = async (fragment: Fragment) => {
    const ok = await confirmBox({
      title: `删除片段「${fragment.name}」？`,
      body: '已经插进提示词里的标签不受影响，插进去以后就和片段没关系了。',
      ok: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await trackWrite(api(`/fragments/${fragment.id}`, { method: 'DELETE' }));
      setFragments((list) => list && list.filter((f) => f.id !== fragment.id));
      toast('删掉了');
    } catch (err) {
      failed(err);
    }
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>片段库</h2>
          <p>一小串常用的标签，起个名字存起来，写提示词时在标签编辑窗里搜名字插进去。在编辑窗里挑几个小块就能存成片段。</p>
        </div>
        {SHARED}
      </div>
      {fragments &&
        FRAGMENT_CATEGORIES.map(({ value, label }) => {
          const list = fragments.filter((f) => f.category === value);
          return (
            <section key={value} className="sx-fcat" data-od-id={`fragments-${value}`}>
              <h3>
                {label} <span className="meta mono">{list.length}</span>
              </h3>
              {list.length ? (
                list.map((fragment) => (
                  <div key={fragment.id} className="card sx-frag" data-fid={fragment.id}>
                    <div className="sx-wf-top">
                      {renaming?.id === fragment.id ? (
                        <RenameInput
                          key={renaming.attempt}
                          value={renaming.draft}
                          className="sx-frag-name"
                          maxLength={60}
                          onDone={(next) => void rename(fragment, next)}
                        />
                      ) : (
                        <b>{fragment.name}</b>
                      )}
                      <span className="meta">
                        <span className="mono">{splitTags(fragment.text).length}</span> 个标签
                      </span>
                      <span className="grow" />
                      <select
                        className="select select-sm"
                        aria-label="分类"
                        data-fcat
                        value={fragment.category}
                        onChange={(e) => void patch(fragment, { category: e.target.value as Fragment['category'] })}
                      >
                        {FRAGMENT_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-ghost btn-sm" data-fa="rename" onClick={() => setRenaming({ id: fragment.id, draft: fragment.name, attempt: 0 })}>
                        <Icon name="edit" />
                        改名
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" data-fa="edit" onClick={() => setEditing(fragment)}>
                        <Icon name="tag" />
                        改内容
                      </button>
                      <button type="button" className="btn btn-danger-ghost btn-sm" data-fa="del" onClick={() => void remove(fragment)}>
                        <Icon name="trash" />
                        删除
                      </button>
                    </div>
                    <FragmentChips text={fragment.text} />
                  </div>
                ))
              ) : (
                <p className="hint">还没有。</p>
              )}
            </section>
          );
        })}
      {editing && (
        <TagEditor
          sub={`片段「${editing.name}」 · ${FRAGMENT_CATEGORIES.find((c) => c.value === editing.category)?.label ?? ''}`}
          text={editing.text}
          family={null}
          convert={null}
          saveLabel="存"
          footNote="点小块调权重或删掉，按住拖动换顺序。已经插进提示词里的不跟着变"
          onSave={(text) => patch(editing, { text })}
          onClose={() => {
            setEditing(null);
            // 编辑窗里可能又存了新片段
            void load();
          }}
        />
      )}
    </>
  );
}

function FragmentChips({ text }: { text: string }) {
  const items = useMemo(() => splitTags(text), [text]);
  const checks = useTagChecks(
    items.map((item) => item.name),
    null,
  );
  return (
    <div className="tg-flow">
      {items.map((item, i) => (
        <TagChip key={i} item={item} check={checks[i]} unknownText="不认识" />
      ))}
    </div>
  );
}
