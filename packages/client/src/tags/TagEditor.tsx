import {
  composeChecked,
  displayTag,
  formatTag,
  splitTags,
  weightedTag,
  type Family,
  type TagCheck,
  type TagConvertResult,
  type TagHit,
  type TagItem,
} from '@media-agent/shared';
import type { JSONContent } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import type { EditorState } from '@tiptap/pm/state';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toast';
import { chipContent, chipDrag, chipItem, chipPos, moveChip, TAG_CHIP, TagChipNode } from './chipNode';
import { FragmentPicker, SaveFragmentDialog } from './fragments';
import { chipName, fmtCount, fmtWeight, TAG_CATEGORIES } from './TagChip';
import { checkOf, rememberChecks, useTagChecks } from './tagStore';

// 能让 AI 转标签时：用哪个节点的模型配置问，界面上写着模型名和思考档位
export type ConvertWith = { canvasId: string; nodeId: string; model: string; level: string };

type Props = {
  sub: string; // 标题下面的小字：改的是哪个框
  text: string;
  family: Family | null;
  convert: ConvertWith | null;
  saveLabel: string;
  footNote: string;
  onSave: (text: string) => Promise<boolean>; // 存成了才关
  onClose: () => void;
};

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;

// 框里的一串标签变成一行小块，每个后面跟一个空格
function chipsDoc(text: string): JSONContent {
  const content = splitTags(text).flatMap((item) => [chipContent(item.raw), { type: 'text', text: ' ' }]);
  return { type: 'doc', content: [content.length ? { type: 'paragraph', content } : { type: 'paragraph' }] };
}

// 光标前面正在打的那段字：从前一个小块或逗号后面算起，去掉开头的空白
function typedBefore(state: EditorState): { from: number; to: number; text: string } | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  const before = $from.nodeBefore?.isText ? $from.nodeBefore.text! : '';
  const text = before.slice(Math.max(before.lastIndexOf(','), before.lastIndexOf('，')) + 1).replace(/^\s+/, '');
  return { from: $from.pos - text.length, to: $from.pos, text };
}

// 文档里的小块，按顺序
function chipsOf(editor: Editor): { id: string; item: TagItem; picked: boolean }[] {
  const chips: { id: string; item: TagItem; picked: boolean }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === TAG_CHIP) chips.push({ id: String(node.attrs.id), item: chipItem(String(node.attrs.raw)), picked: Boolean(node.attrs.picked) });
  });
  return chips;
}

// 存的时候：小块，加上还没变成小块的字（按逗号拆开）
function allItems(editor: Editor): TagItem[] {
  const items: TagItem[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === TAG_CHIP) items.push(chipItem(String(node.attrs.raw)));
    else if (node.isText) items.push(...splitTags(node.text!.replace(/，/g, ',')));
  });
  return items;
}

const seconds = (since: number) => Math.max(0, Math.round((Date.now() - since) / 1000));

// 标签编辑窗：标签是一行文字里的小块；打字联想，逗号或回车把打的字变成小块；点小块调权重或删掉，拖动换顺序。
// 能插片段、挑几个存成片段；打的中文词库里没有时让 AI 转成标签。见 docs/dev-plan.md 5.15
export function TagEditor({ sub, text, family, convert, saveLabel, footNote, onSave, onClose }: Props) {
  const [, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ q: string; hits: TagHit[] }>({ q: '', hits: [] });
  const [active, setActive] = useState(0);
  const [mini, setMini] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<{ label: string; note: string; since: number } | null>(null);
  const [fragAnchor, setFragAnchor] = useState<DOMRect | null>(null);
  const [saving, setSaving] = useState<TagItem[] | null>(null);
  const [, tick] = useState(0);
  const hits = found.q === query ? found.hits : [];

  // 编辑器的回调在建好时就定了，里面读最新的状态
  const latest = useRef({ hits, active, picking });
  latest.current = { hits, active, picking };

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      TagChipNode.configure({ family, onClick: (id, anchor) => clickChip(id, anchor) }),
      UndoRedo,
      Placeholder.configure({ placeholder: '打中文或英文找标签，比如「金发」「twin」。打逗号把前面打的字变成一个小块' }),
    ],
    content: chipsDoc(text),
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'te-input', id: 'teInput', 'aria-label': '标签', role: 'textbox', spellcheck: 'false' },
      handleTextInput: (view, _from, _to, typed) => {
        if (typed !== ',' && typed !== '，') return false;
        const typing = typedBefore(view.state);
        if (typing?.text.trim()) toChips(typing, [typing.text.trim()]);
        return true;
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing || view.composing) return false;
        const { hits: list, active: at } = latest.current;
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && list.length) {
          setActive((at + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
          return true;
        }
        if (event.key === 'Enter') {
          const typing = typedBefore(view.state);
          if (list.length) pick(list[at]);
          else if (typing?.text.trim()) toChips(typing, [typing.text.trim()]);
          return true;
        }
        if (event.key === 'Escape' && list.length) {
          setFound({ q: '', hits: [] });
          setQuery('');
          return true;
        }
        return false;
      },
      // 拖小块：放在另一个小块上按左右半边定前后，放在空白处就挪到那儿
      handleDrop: (view, event) => {
        const id = chipDrag.id;
        if (!id || !self.current) return false;
        chipDrag.id = null;
        const target = (event.target as Element).closest?.('[data-chip-id]');
        let to: number | null = null;
        if (target && target.getAttribute('data-chip-id') !== id) {
          const pos = chipPos(self.current, target.getAttribute('data-chip-id')!);
          const rect = target.getBoundingClientRect();
          if (pos !== null) to = event.clientX < rect.left + rect.width / 2 ? pos : pos + 1;
        } else if (!target) {
          to = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        }
        if (to !== null) moveChip(self.current, id, to);
        return true;
      },
    },
    onUpdate: () => setVersion((v) => v + 1),
    onSelectionUpdate: ({ editor: instance }) => setQuery(typedBefore(instance.state)?.text.trim() ?? ''),
    onTransaction: ({ editor: instance }) => setQuery(typedBefore(instance.state)?.text.trim() ?? ''),
  });
  const self = useRef<Editor | null>(null);
  self.current = editor;

  // 打的字变了：去词库里搜，最多 20 个；回来时字又变了就不要了
  useEffect(() => {
    setActive(0);
    if (!query) return;
    const timer = setTimeout(() => {
      api<TagHit[]>(`/tags/search?q=${encodeURIComponent(query)}`)
        .then((list) => setFound({ q: query, hits: list }))
        .catch(() => setFound({ q: query, hits: [] }));
    }, 80);
    return () => clearTimeout(timer);
  }, [query]);

  // 等 AI 时秒数每秒走
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const chips = editor ? chipsOf(editor) : [];
  const checks = useTagChecks(
    chips.map((chip) => chip.item.name),
    family,
  );
  const unknowns = checks.filter((check) => check?.status === 'unknown').length;
  const picked = chips.filter((chip) => chip.picked);
  const preview = composeChecked(
    chips.map((chip) => chip.item),
    checks as TagCheck[],
  );

  // 把 range 那段换成几个小块，光标落在最后
  function toChips(range: { from: number; to: number }, raws: string[]) {
    const instance = self.current;
    if (!instance) return;
    instance
      .chain()
      .insertContentAt(
        range,
        raws.flatMap((raw) => [chipContent(raw), { type: 'text', text: ' ' }]),
      )
      .run();
    setFound({ q: '', hits: [] });
  }

  // 选了一个候选：换掉打的字。候选里带着中文、分类、次数，不用再问服务端
  function pick(hit: TagHit) {
    const instance = self.current;
    const typing = instance && typedBefore(instance.state);
    if (!typing) return;
    const raw = formatTag(hit.tag);
    rememberChecks([raw], [{ input: raw, status: 'ok', tag: hit.tag, zh: hit.zh, category: hit.category, count: hit.count }], family);
    toChips(typing, [raw]);
    instance.commands.focus();
  }

  function clickChip(id: string, anchor: DOMRect) {
    const instance = self.current;
    if (!instance) return;
    if (!latest.current.picking) return setMini({ id, anchor });
    const pos = chipPos(instance, id);
    if (pos === null) return;
    const node = instance.state.doc.nodeAt(pos)!;
    instance.view.dispatch(instance.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, picked: !node.attrs.picked }));
  }

  // 改一个小块的写法（调了权重）
  function setRaw(id: string, raw: string) {
    const instance = self.current;
    const pos = instance && chipPos(instance, id);
    if (!instance || pos === null || pos === undefined) return;
    const node = instance.state.doc.nodeAt(pos)!;
    instance.view.dispatch(instance.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, raw }));
  }

  // 删掉一个小块，连同后面那个空格
  function removeChip(id: string) {
    const instance = self.current;
    const pos = instance && chipPos(instance, id);
    if (!instance || pos === null || pos === undefined) return;
    const end = instance.state.doc.textBetween(pos + 1, Math.min(pos + 2, instance.state.doc.content.size - 1)) === ' ' ? pos + 2 : pos + 1;
    instance.view.dispatch(instance.state.tr.delete(pos, end));
    setMini(null);
  }

  // 插在光标处；不在编辑器里时加在最后
  function insertAtCursor(raws: string[]) {
    const instance = self.current;
    if (!instance) return;
    const at = instance.state.selection.from;
    instance
      .chain()
      .insertContentAt(
        at,
        raws.flatMap((raw) => [chipContent(raw), { type: 'text', text: ' ' }]),
      )
      .focus()
      .run();
  }

  async function toTags() {
    const instance = self.current;
    const typing = instance && typedBefore(instance.state);
    if (!instance || !convert || !typing?.text.trim()) return;
    const q = typing.text.trim();
    setBusy({ label: `AI 正在把「${q}」转成标签`, note: `用「${convert.model}」问一次，不带对话记录。`, since: Date.now() });
    instance.setEditable(false);
    try {
      const result = await api<TagConvertResult>('/tags/convert', { method: 'POST', body: { canvasId: convert.canvasId, nodeId: convert.nodeId, text: q } });
      const items = splitTags(result.text);
      rememberChecks(
        items.map((item) => item.name),
        result.checks,
        family,
      );
      instance.setEditable(true);
      toChips(typing, items.map((item) => item.raw));
      toast(`「${q}」转成了 ${items.length} 个标签：${items.map((item) => chipName(item, checkOf(item.name, family))).join(', ')}`);
    } catch (err) {
      instance.setEditable(true);
      toast(`转标签失败：${(err as Error).message}`, { tone: 'danger', ms: 4500 });
    } finally {
      setBusy(null);
      instance.commands.focus();
    }
  }

  async function save() {
    if (!editor) return;
    const items = allItems(editor);
    if (!items.length) return toast('一个标签都没有，存不了', { tone: 'warn' });
    if (await onSave(items.map((item) => item.raw).join(', '))) onClose();
  }

  const stopPicking = () => {
    if (editor) {
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === TAG_CHIP && node.attrs.picked) tr.setNodeMarkup(pos, undefined, { ...node.attrs, picked: false });
      });
      editor.view.dispatch(tr);
    }
    setPicking(false);
  };

  const miniChip = mini && chips.find((chip) => chip.id === mini.id);
  const miniCheck = miniChip ? checks[chips.indexOf(miniChip)] : undefined;
  const typing = editor ? typedBefore(editor.state) : null;

  return (
    <Dialog className={`dialog-wide te-dialog${picking ? ' is-picking' : ''}`} label="编辑标签" odId="dialog-tag-editor" onClose={onClose}>
      <div className="dialog-head te-head">
        <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
          <h2>编辑标签</h2>
          <span className="meta" id="teSub">
            {sub}
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {busy && (
        <div className="te-banner" id="teBanner">
          <span className="spinner" />
          <span>
            <b>{busy.label}</b>，等了 <span className="mono">{seconds(busy.since)} 秒</span>。{busy.note}
          </span>
        </div>
      )}
      <div className="te-tools" data-od-id="tag-editor-tools">
        <button type="button" className="btn btn-secondary btn-sm" data-te="frag" onClick={(e) => setFragAnchor(e.currentTarget.getBoundingClientRect())}>
          <Icon name="plus" />
          插片段
        </button>
        <button
          type="button"
          className={`btn ${picking && picked.length ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          data-te="pickMode"
          onClick={() => {
            if (picking && picked.length) setSaving(picked.map((chip) => chip.item));
            else if (picking) stopPicking();
            else setPicking(true);
          }}
        >
          <Icon name="check" />
          {picking ? (picked.length ? `把选中的 ${picked.length} 个存成片段` : '点小块挑几个…') : '挑几个存成片段'}
        </button>
        <span className="grow" />
        <span className="meta te-count" id="teCount">
          <span className="mono">{chips.length}</span> 个标签
          {unknowns > 0 && (
            <>
              {' · '}
              <span className="te-unk">{unknowns} 个不认识</span>
            </>
          )}
          {picking && (
            <>
              {' · 选了 '}
              <span className="mono">{picked.length}</span> 个
            </>
          )}
        </span>
      </div>
      <div className={`te-main${busy ? ' is-busy' : ''}`}>
        <EditorContent editor={editor} className="te-scroll" />
        <div className="te-sug" id="teSug" role="listbox" aria-label="候选标签">
          {hits.length > 0 ? (
            hits.map((hit, i) => (
              <button
                key={hit.tag}
                type="button"
                className={`te-s${i === active ? ' is-on' : ''}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(hit)}
              >
                <span className="te-s-en">{displayTag(hit.tag)}</span>
                <span className="te-s-zh">{hit.zh}</span>
                {hit.alias && <span className="te-s-via">靠别名 {displayTag(hit.alias)} 对上</span>}
                <span className="tag">{TAG_CATEGORIES[hit.category] ?? ''}</span>
                <span className="mono te-s-n">{fmtCount(hit.count)}</span>
              </button>
            ))
          ) : query && found.q === query && typing?.text.trim() ? (
            CJK.test(query) && convert ? (
              <div className="te-none">
                <span>词库里没有「{query}」。整句话可以让 AI 转成几个标签。</span>
                <button type="button" className="btn btn-secondary btn-sm" data-te="toTags" disabled={Boolean(busy)} onClick={() => void toTags()}>
                  <Icon name="sparkles" />
                  让 AI 转成标签
                </button>
                <span className="meta">
                  用节点的「{convert.model}」问一次，思考：{convert.level}，要几秒
                </span>
              </div>
            ) : (
              <div className="te-none">
                <span>词库里没有「{query}」。按回车或逗号照原样加进去，会标「不认识」。</span>
              </div>
            )
          ) : (
            <div className="te-hint">
              <span>打字时这里出候选，最多 20 个。</span>
              <span>
                <span className="kbd">↑</span> <span className="kbd">↓</span> 选，<span className="kbd">Enter</span> 加。
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="te-preview">
        <span className="label">复制和出图用的是这一串</span>
        <p className="mono" id="tePreview">
          {preview || '（还没有标签）'}
        </p>
      </div>
      <div className="dialog-foot">
        <span className="meta grow">{footNote}</span>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          放弃
        </button>
        <button type="button" className="btn btn-primary" data-te="save" onClick={() => void save()}>
          <Icon name="check" />
          {saveLabel}
        </button>
      </div>

      {miniChip && (
        <Popover
          anchor={mini!.anchor}
          className="te-mini"
          odId="popover-tag-weight"
          label="调权重"
          onClose={() => setMini(null)}
          keepOpen={(target) => Boolean(target.closest('.te-chip'))}
        >
          <div className="te-mini-head">
            <b>{chipName(miniChip.item, miniCheck)}</b>
            <span className="meta">
              {miniCheck && miniCheck.status !== 'unknown'
                ? [miniCheck.zh, TAG_CATEGORIES[miniCheck.category ?? -1], miniCheck.count ? `用过 ${fmtCount(miniCheck.count)} 次` : ''].filter(Boolean).join(' · ')
                : '词库里没有'}
            </span>
          </div>
          <div className="row">
            <span className="label">权重</span>
            <div className="stepper">
              <button
                type="button"
                aria-label="减 0.1"
                disabled={miniChip.item.weight <= 0.1}
                onClick={() => setRaw(miniChip.id, weightedTag(miniChip.item.name, Math.max(0.1, Math.round((miniChip.item.weight - 0.1) * 10) / 10)))}
              >
                −
              </button>
              <output>{fmtWeight(miniChip.item.weight)}</output>
              <button
                type="button"
                aria-label="加 0.1"
                disabled={miniChip.item.weight >= 2}
                onClick={() => setRaw(miniChip.id, weightedTag(miniChip.item.name, Math.min(2, Math.round((miniChip.item.weight + 0.1) * 10) / 10)))}
              >
                +
              </button>
            </div>
            {miniChip.item.weight !== 1 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRaw(miniChip.id, miniChip.item.name)}>
                回到 1.0
              </button>
            )}
            <span className="grow" />
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => removeChip(miniChip.id)}>
              <Icon name="trash" />
              删掉
            </button>
          </div>
          <p className="hint">0.1 到 2.0，每次 0.1。1.0 是正常，大于 1 加强，小于 1 减弱。</p>
        </Popover>
      )}

      {fragAnchor && (
        <FragmentPicker
          anchor={fragAnchor}
          onClose={() => setFragAnchor(null)}
          onPick={(fragment) => {
            setFragAnchor(null);
            const items = splitTags(fragment.text);
            insertAtCursor(items.map((item) => item.raw));
            toast(`插进了「${fragment.name}」的 ${items.length} 个标签`);
          }}
        />
      )}

      {saving && (
        <SaveFragmentDialog
          items={saving}
          onClose={(saved) => {
            setSaving(null);
            if (saved) stopPicking();
          }}
        />
      )}
    </Dialog>
  );
}
