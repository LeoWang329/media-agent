import type { Fragment, FragmentCategory, TagItem } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Dialog } from '../ui/Dialog';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toast';

export const FRAGMENT_CATEGORIES: { value: FragmentCategory; label: string }[] = [
  { value: 'character', label: '角色' },
  { value: 'style', label: '画风' },
  { value: 'quality', label: '质量词' },
  { value: 'other', label: '其他' },
];

// 插片段：搜名字，按分类列出来，点一个插进去
export function FragmentPicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (fragment: Fragment) => void; onClose: () => void }) {
  const [fragments, setFragments] = useState<Fragment[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api<Fragment[]>('/fragments').then(setFragments, (err: Error) => {
      toast(err.message, { tone: 'danger' });
      onClose();
    });
  }, []);

  const query = q.trim();
  const shown = (fragments ?? []).filter((fragment) => !query || fragment.name.includes(query));
  return (
    <Popover anchor={anchor} className="te-frags" odId="popover-insert-fragment" label="插片段" onClose={onClose}>
      <input className="input" id="teFq" placeholder="搜片段名" aria-label="搜片段名" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="te-fr-list">
        {FRAGMENT_CATEGORIES.map(({ value, label }) => {
          const list = shown.filter((fragment) => fragment.category === value);
          if (!list.length) return null;
          return (
            <div key={value}>
              <h4>{label}</h4>
              {list.map((fragment) => (
                <button key={fragment.id} type="button" className="te-fr" data-fr={fragment.id} onClick={() => onPick(fragment)}>
                  <b>{fragment.name}</b>
                  <span className="mono meta">{fragment.text}</span>
                </button>
              ))}
            </div>
          );
        })}
        {fragments && !shown.length && (
          <p className="gp-none">{query ? `没有名字里带「${query}」的片段` : '还没有片段。在编辑窗里挑几个小块，就能存成片段。'}</p>
        )}
      </div>
      <p className="hint" style={{ margin: '8px 2px 2px' }}>
        插进来就是普通小块，和片段没有关系了。片段在设置里管。
      </p>
    </Popover>
  );
}

// 挑出来的几个小块存成片段：起名字、选分类；名字重了提示换一个
export function SaveFragmentDialog({ items, onClose }: { items: TagItem[]; onClose: (saved: boolean) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<FragmentCategory>('character');
  const [error, setError] = useState('');
  const text = items.map((item) => item.raw).join(', ');

  const save = async () => {
    const value = name.trim();
    if (!value) return setError('先起个名字');
    try {
      await api<Fragment>('/fragments', { method: 'POST', body: { name: value, category, text } });
    } catch (err) {
      return setError((err as Error).message);
    }
    toast(`存好了片段「${value}」，以后在「插片段」里能搜到`);
    onClose(true);
  };

  return (
    <Dialog label="存成片段" odId="dialog-save-fragment" onClose={() => onClose(false)}>
      <div className="dialog-head">
        <h2>存成片段</h2>
      </div>
      <div className="dialog-body stack" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="sfName">名字</label>
          <input
            className={`input${error ? ' is-error' : ''}`}
            id="sfName"
            placeholder="比如：栗发少女的外观"
            data-autofocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
          <p className={`hint${error ? ' is-error' : ''}`} id="sfHint">
            {error || '写提示词时在编辑窗里搜这个名字插进来。'}
          </p>
        </div>
        <div className="field">
          <span className="label">分类</span>
          <div className="seg" id="sfCat" role="group" aria-label="分类">
            {FRAGMENT_CATEGORIES.map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">{items.length} 个标签</span>
          <p className="mono te-sf-prev">{text}</p>
        </div>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" onClick={() => onClose(false)}>
          取消
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          存
        </button>
      </div>
    </Dialog>
  );
}
