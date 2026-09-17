import { activePath, aspectRatioText, hasUnsentSettings, imageSizeFits, slotDiff, type AspectRatio, type ChatNode } from '@media-agent/shared';
import { EditorContent, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { imageThumbUrl, SLOT_DRAG_TYPE } from '../api';
import { docPictures, docToDraft, docToText } from '../editor/document';
import { usePictureEditor } from '../editor/usePictureEditor';
import { MAX_SLOTS, useCanvasStore } from '../store/canvasStore';
import { Icon } from '../ui/Icon';
import { showMenu, type MenuItem } from '../ui/menu';
import { toast } from '../ui/toast';
import { copyOnlyNote, processedNote } from './imageInfo';
import { closeRefPicker, openAssets, openRefPicker, useOverlays } from './overlays';
import { tokens } from './tokens';

const RATIOS: AspectRatio[] = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9', 'auto'];

// 输入框：删槽位里的图时要看输入框里有没有引用它
let composer: { nodeId: string; editor: Editor } | null = null;

// 程序处理过也救不回来的极端长条图：H3 会拒收
const misfitNote = (image: { width: number; height: number }) => `尺寸不符：现在是 ${image.width}×${image.height}，H3 要求每边在 256 到 5760 像素之间`;

// 面板底部：没发出的改动、参考图槽位、时长比例、输入框
export function Dock({ node }: { node: ChatNode }) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <footer className="dr-dock" data-od-id="composer-dock">
      <Pending node={node} />
      <div className="slots-head">
        <span className="panel-title">
          参考图 <span className="mono" id="slotCount">{node.slots.length}/9</span>
        </span>
        <div className="param">
          <span className="meta">时长</span>
          <div className="stepper" data-od-id="duration-stepper">
            <button
              type="button"
              id="durDown"
              aria-label="减少一秒"
              disabled={node.duration <= 4}
              onClick={() => void useCanvasStore.getState().patchNode(node.id, { duration: Math.max(4, node.duration - 1) })}
            >
              −
            </button>
            <output id="durVal">{node.duration} 秒</output>
            <button
              type="button"
              id="durUp"
              aria-label="增加一秒"
              disabled={node.duration >= 15}
              onClick={() => void useCanvasStore.getState().patchNode(node.id, { duration: Math.min(15, node.duration + 1) })}
            >
              +
            </button>
          </div>
        </div>
        <div className="param">
          <span className="meta">比例</span>
          <select
            className="select select-sm mono"
            id="ratioSel"
            aria-label="画面比例"
            data-od-id="ratio-select"
            value={node.aspectRatio}
            onChange={(e) => void useCanvasStore.getState().patchNode(node.id, { aspectRatio: e.target.value as AspectRatio })}
          >
            {RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {aspectRatioText(ratio)}
              </option>
            ))}
          </select>
        </div>
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" id="slotAssets" data-od-id="btn-slot-from-assets" onClick={() => openAssets('slots')}>
          <Icon name="image" />
          <span className="hide-sm">资产库</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" id="slotLocal" data-od-id="btn-slot-from-disk" onClick={() => fileInput.current?.click()}>
          <Icon name="folder" />
          <span className="hide-sm">电脑里的图</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" id="slotCollage" data-od-id="btn-collage" onClick={() => useOverlays.setState({ collage: true })}>
          <Icon name="grid" />
          <span className="hide-sm">拼图</span>
        </button>
      </div>
      <Slots node={node} />
      <Composer node={node} />
      <input
        ref={fileInput}
        type="file"
        id="localFile"
        accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.gif"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void useCanvasStore.getState().place(node.id, files.map((file) => ({ file, name: file.name })));
        }}
      />
    </footer>
  );
}

// 槽位、时长、比例和上次发出时不一样：说清楚下次发消息会自动附上什么
function Pending({ node }: { node: ChatNode }) {
  const images = useCanvasStore((s) => s.detail?.images);
  if (!hasUnsentSettings(node)) return null;
  const previous = activePath(node).at(-1)!;
  const note = slotDiff(previous, node).systemNote;
  if (!note) return null;
  const renumbered = note.includes('重新编号');

  return (
    <div className="pending" id="pending" data-od-id="pending-changes">
      <Icon name="info" />
      <div className="grow">
        <b>有改动还没发出去。</b>下次发消息时会自动附上：<q>{tokens(note, node.slots, images)}</q>
        {renumbered && (
          <div style={{ marginTop: 4 }}>
            {node.slots.map((id, i) => {
              const was = previous.slotSnapshot.indexOf(id);
              if (was === i) return null;
              return (
                <div key={`${i}-${id}`}>
                  现在的 <span className="tk tk-pic">&lt;Picture {i + 1}&gt;</span> 是 {images?.[id]?.originalName ?? ''}
                  {was >= 0 ? `（原来是 ${was + 1} 号）` : '（新加的）'}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        id="revertPending"
        title="槽位、时长、比例回到上次发出时的样子"
        onClick={() => void useCanvasStore.getState().revertSettings(node.id)}
      >
        撤回改动
      </button>
    </div>
  );
}

function Slots({ node }: { node: ChatNode }) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const images = useCanvasStore((s) => s.detail?.images);
  const placing = useCanvasStore((s) => (s.placing?.nodeId === node.id ? s.placing : null));
  const flash = useCanvasStore((s) => (s.flash?.nodeId === node.id ? s.flash.indexes : null));
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const { moveSlot, removeSlot, place } = useCanvasStore.getState();

  // 删掉了再看输入框里有没有引用它，提示条排在「删掉了」下面
  const remove = (index: number) => {
    const imageId = node.slots[index];
    void removeSlot(node.id, index).then((removed) => {
      if (removed && composer?.nodeId === node.id && docPictures(composer.editor.getJSON()).includes(imageId)) {
        toast('输入框里引用了这张图，现在发不出去', { tone: 'danger', ms: 4500 });
      }
    });
  };

  const menu = (anchor: Element, index: number) => {
    const image = images?.[node.slots[index]];
    const processed = image?.processed ? processedNote(image) : null;
    const copyOnly = image ? copyOnlyNote(image) : null;
    const items: MenuItem[] = [{ note: `${index + 1} 号 · ${image?.originalName ?? ''}${processed ? ' · 处理过' : ''}` }];
    if (image && !imageSizeFits(image.width, image.height)) items.push({ note: misfitNote(image) });
    if (processed) items.push({ note: processed });
    if (copyOnly) items.push({ note: copyOnly });
    items.push({ label: '放大看', icon: 'expand', onClick: () => useOverlays.setState({ zoom: { imageId: node.slots[index], title: `${index + 1} 号：${image?.originalName ?? ''}` } }) });
    items.push({ label: '换一张（从资产库挑）', icon: 'swap', onClick: () => openAssets('replace', index) });
    if (index > 0) items.push({ label: '往前挪一位', icon: 'chev-left', onClick: () => void moveSlot(node.id, index, index - 1) });
    if (index < node.slots.length - 1) items.push({ label: '往后挪一位', icon: 'chev-right', onClick: () => void moveSlot(node.id, index, index + 1) });
    items.push({ sep: true }, { label: '删掉这格', icon: 'trash', danger: true, onClick: () => remove(index) });
    showMenu(anchor, items, 'left');
  };

  // 从 Windows 文件夹直接拖进来的图：接在后面放
  const dropFiles = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length) void place(node.id, files.map((file) => ({ file, name: file.name })));
  };

  // 电脑里拖来的图放在有图的格子上：换掉这一格（多张只用第一张）
  const replaceWithFile = (e: DragEvent, index: number) => {
    const [file] = [...e.dataTransfer.files];
    if (file) void place(node.id, [{ file, name: file.name }], { replaceIndex: index });
  };

  const waiting = placing && placing.replaceIndex === null ? placing.thumbs : [];
  const cells = [];
  for (let i = 0; i < MAX_SLOTS; i += 1) {
    const imageId = node.slots[i];
    if (imageId) {
      const image = images?.[imageId];
      const processed = image?.processed ? processedNote(image) : null;
      const copyOnly = image ? copyOnlyNote(image) : null;
      const misfit = image && !imageSizeFits(image.width, image.height) ? misfitNote(image) : null;
      const tip = `${i + 1} 号：${image?.originalName ?? ''}${misfit ? `\n${misfit}` : ''}${processed ? `\n程序处理过：${processed}` : ''}${copyOnly ? `\n${copyOnly}` : ''}`;
      cells.push(
        <div
          key={`${i}-${imageId}`}
          className={`slot is-filled${flash?.includes(i) ? ' is-renumbered' : ''}${over === i ? ' is-drop' : ''}${from === i ? ' is-drag-src' : ''}`}
          draggable
          data-i={i}
          title={tip}
          tabIndex={0}
          data-od-id={`slot-${i + 1}`}
          data-testid="slot"
          onClick={(e) => menu(e.currentTarget, i)}
          onDragStart={(e) => {
            setFrom(i);
            e.dataTransfer.effectAllowed = 'move';
            // 自定义类型：松手落在输入框里也不会被当成文字插进去
            e.dataTransfer.setData(SLOT_DRAG_TYPE, String(i));
          }}
          onDragOver={(e) => {
            if (from === null && !e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setOver(i);
          }}
          onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => {
            if (from === null && !e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(null);
            if (from === null) return replaceWithFile(e, i);
            const start = from;
            setFrom(null);
            void moveSlot(node.id, start, i);
          }}
          onDragEnd={() => {
            setFrom(null);
            setOver(null);
          }}
        >
          {canvasId && <img className="im" src={imageThumbUrl(canvasId, imageId)} alt={image?.originalName ?? ''} loading="lazy" draggable={false} />}
          <span className="num-badge">{i + 1}</span>
          {misfit ? <span className="proc is-misfit">尺寸不符</span> : (copyOnly || processed) && <span className="proc">{copyOnly ? '副本' : '处理过'}</span>}
          {placing?.replaceIndex === i && (
            <div className="processing">
              <div>
                <span className="spinner" />
                处理中
              </div>
            </div>
          )}
        </div>,
      );
    } else if (i < node.slots.length + waiting.length) {
      // 正在复制进画布的图，先占住位置
      cells.push(
        <div key={`waiting-${i}`} className="slot is-filled" data-testid="slot">
          <img className="im" src={waiting[i - node.slots.length]} alt="" draggable={false} />
          <span className="num-badge">{i + 1}</span>
          <div className="processing">
            <div>
              <span className="spinner" />
              处理中
            </div>
          </div>
        </div>,
      );
    } else if (i === node.slots.length + waiting.length) {
      cells.push(
        <button key="next" type="button" className="slot is-empty is-next" data-next title={`放图进 ${i + 1} 号`} data-od-id="slot-add" onClick={() => openAssets('slots')}>
          <Icon name="plus" />
        </button>,
      );
    } else {
      cells.push(
        <div key={`empty-${i}`} className="slot is-empty" aria-hidden="true">
          {i + 1}
        </div>,
      );
    }
  }

  return (
    <div
      className="slots"
      id="slots"
      data-od-id="slots"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={dropFiles}
    >
      {cells}
    </div>
  );
}

function Composer({ node }: { node: ChatNode }) {
  const busy = useCanvasStore((s) => Boolean(s.streams[node.id]) || Boolean(s.detail?.nodes.find((n) => n.id === node.id)?.generating));
  const focus = useCanvasStore((s) => (s.composerFocus?.nodeId === node.id ? s.composerFocus.seq : 0));
  const [empty, setEmpty] = useState(!node.draft.trim());
  const [error, setError] = useState('');
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unsaved = useRef<string | null>(null);
  const refButton = useRef<HTMLButtonElement>(null);

  // 没发出的文字过半秒存一次，切换节点再回来还在
  const saveDraft = () => {
    clearTimeout(draftTimer.current);
    if (unsaved.current === null) return;
    const draft = unsaved.current;
    unsaved.current = null;
    void useCanvasStore.getState().patchNode(node.id, { draft });
  };

  const editor = usePictureEditor({
    initialText: node.draft,
    slots: node.slots,
    nodeId: node.id,
    ariaLabel: '输入消息',
    className: 'composer-input',
    placeholder: '写需求，比如「第二个方向再慢一点」。按 @ 可以把某张图插进句子里',
    onAt: (instance, typedAt) => refButton.current && openRefPicker(refButton.current, instance, typedAt),
    onEscape: closeRefPicker,
    onEnter: () => submit(),
    onChange: (doc) => {
      setError('');
      setEmpty(!docToText(doc, node.slots).trim() && !docPictures(doc).length);
      unsaved.current = docToDraft(doc);
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(saveDraft, 500);
    },
  });

  useEffect(() => {
    if (!editor) return;
    composer = { nodeId: node.id, editor };
    return () => {
      if (composer?.editor === editor) composer = null;
    };
  }, [editor, node.id]);

  // 切走时把还没来得及存的草稿存掉
  useEffect(() => () => saveDraft(), []);

  // 岔出时预填的、以前存的草稿里是 <Picture N>：挂上时已经按现在的槽位认出是哪张图，马上按图存一次，
  // 不然不打字就调槽位顺序、删图，切回来会指到别的图
  useEffect(() => {
    if (!editor || !/<Picture \d+>/.test(node.draft)) return;
    const draft = docToDraft(editor.getJSON());
    if (draft !== node.draft) void useCanvasStore.getState().patchNode(node.id, { draft });
  }, [editor]);

  // 岔出新节点后，光标放进输入框末尾
  useEffect(() => {
    if (focus && editor) editor.commands.focus('end');
  }, [focus, editor]);

  const submit = () => {
    if (!editor || busy) return;
    const doc = editor.getJSON();
    const pictures = docPictures(doc);
    const broken = pictures.findIndex((id) => !node.slots.includes(id));
    if (broken >= 0) {
      editor.view.dom.querySelectorAll('.ref.is-broken').forEach((chip) => {
        chip.classList.remove('is-flash');
        void (chip as HTMLElement).offsetWidth;
        chip.classList.add('is-flash');
      });
      const name = useCanvasStore.getState().detail?.images[pictures[broken]]?.originalName ?? '';
      setError(`第 ${broken + 1} 处图片引用（${name}）已经不在槽位里了，这条消息发不出去。把图放回槽位，或者删掉这处引用。`);
      return;
    }
    const text = docToText(doc, node.slots).trim();
    if (!text) {
      editor.commands.focus();
      return;
    }
    clearTimeout(draftTimer.current);
    unsaved.current = null;
    editor.commands.clearContent();
    setEmpty(true);
    // 没发出去（服务端报错、别的页面正在生成这个节点）：把刚才写的放回输入框
    void useCanvasStore
      .getState()
      .send(node.id, text)
      .then((sent) => {
        if (!sent && !editor.isDestroyed && editor.isEmpty) editor.commands.setContent(doc);
      });
  };

  return (
    <div className={`composer${error ? ' is-error' : ''}`} id="composer" data-od-id="composer">
      <EditorContent editor={editor} />
      {error && (
        <div className="composer-error" id="composerError">
          <Icon name="warn" />
          <span>{error}</span>
        </div>
      )}
      <div className="composer-bar">
        <button
          ref={refButton}
          type="button"
          className="btn btn-ghost btn-sm"
          id="btnRef"
          data-od-id="btn-insert-ref"
          onClick={(e) => editor && openRefPicker(e.currentTarget, editor)}
        >
          <Icon name="at" />
          引用图片
        </button>
        <span className="meta hide-sm">Enter 发送 · Shift+Enter 换行</span>
        <span className="grow" />
        {busy ? (
          <button
            type="button"
            className="btn btn-secondary"
            id="btnSend"
            data-od-id="btn-send"
            onClick={() => void useCanvasStore.getState().stop(node.id).then((ok) => ok && toast('已叫停，写出来的部分保留了'))}
          >
            <Icon name="stop" />
            停止
          </button>
        ) : (
          <button type="button" className="btn btn-primary" id="btnSend" data-od-id="btn-send" disabled={empty} onClick={submit}>
            <Icon name="send" />
            发送
          </button>
        )}
      </div>
    </div>
  );
}
