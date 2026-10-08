import {
  activePath,
  aspectRatioText,
  hasUnsentSettings,
  imageSizeFits,
  MEDIA_EXTENSIONS,
  roundSize,
  segmentCount,
  SIZE_LIMITS,
  slotDiff,
  VIDEO_DURATION,
  type AspectRatio,
  type ChatNode,
  type PromptMeta,
} from '@media-agent/shared';
import { EditorContent, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { imageThumbUrl, SLOT_DRAG_TYPE } from '../api';
import { docPictures, docToDraft, docToText } from '../editor/document';
import { usePictureEditor } from '../editor/usePictureEditor';
import { MAX_SLOTS, useCanvasStore } from '../store/canvasStore';
import { useComfyStore } from '../store/comfyStore';
import { useNodeWorkflow, useWorkflowStore } from '../store/workflowStore';
import { Icon } from '../ui/Icon';
import { showMenu, type MenuItem } from '../ui/menu';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toast';
import { copyOnlyNote, processedNote } from './imageInfo';
import { effectiveCheckpoint, imageSize, shortCheckpoint, SIZE_GROUPS, KREA2_SIZE_GROUPS, sizeText, useImageSettings, usePromptInfo } from './imageNode';
import { closeRefPicker, openAssets, openRefPicker, useOverlays } from './overlays';
import { tokens } from './tokens';
import { MediaSlots } from './MediaSlots';
import { DurationPop, VideoGenButton } from './VideoSettings';

const RATIOS: AspectRatio[] = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9', 'auto'];

// 尺寸下拉里「自己填…」那一项的值
const CUSTOM_SIZE = 'custom';

// 输入框：删槽位里的图时要看输入框里有没有引用它
let composer: { nodeId: string; editor: Editor } | null = null;

// 电脑里选文件：视频节点也能选视频和音频，见 docs/dev-plan.md 5.31
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.gif';
const VIDEO_NODE_ACCEPT = [IMAGE_ACCEPT, ...MEDIA_EXTENSIONS.video, ...MEDIA_EXTENSIONS.audio].join(',');

// 程序处理过也救不回来的极端长条图：H3 会拒收
const misfitNote = (image: { width: number; height: number }) => `尺寸不符：现在是 ${image.width}×${image.height}，H3 要求每边在 256 到 5760 像素之间`;

// 面板底部：没发出的改动、参考图槽位、时长比例（生图节点是尺寸和张数）、输入框
export function Dock({ node }: { node: ChatNode }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const use = node.kind;
  return (
    <footer className={`dr-dock${use === 'image' ? ' is-image' : ''}`} data-od-id="composer-dock">
      <Pending node={node} use={use} />
      <div className="slots-head">
        <span className="panel-title">
          参考图 <span className="mono" id="slotCount">{node.slots.length}/9</span>
        </span>
        {use === 'image' ? <ImageParams node={node} /> : <VideoParams node={node} />}
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" id="slotAssets" data-od-id="btn-slot-from-assets" onClick={() => openAssets('slots')}>
          <Icon name="image" />
          <span className="hide-sm">资产库</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" id="slotLocal" data-od-id="btn-slot-from-disk" onClick={() => fileInput.current?.click()}>
          <Icon name="folder" />
          <span className="hide-sm">{use === 'image' ? '电脑里的图' : '电脑里的文件'}</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" id="slotCollage" data-od-id="btn-collage" onClick={() => useOverlays.setState({ collage: true })}>
          <Icon name="grid" />
          <span className="hide-sm">拼图</span>
        </button>
      </div>
      <Slots node={node} />
      {use === 'video' && <MediaSlots node={node} />}
      <Composer node={node} image={use === 'image'} />
      <input
        ref={fileInput}
        type="file"
        id="localFile"
        accept={use === 'image' ? IMAGE_ACCEPT : VIDEO_NODE_ACCEPT}
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

// 视频节点：时长和比例，旁边是生成设置。时长点数字能直接填，超过 15 秒写上分几段，见 docs/dev-plan.md 5.24
function VideoParams({ node }: { node: ChatNode }) {
  const [durationAt, setDurationAt] = useState<DOMRect | null>(null);
  const { min, max } = VIDEO_DURATION;
  const setDuration = (duration: number) => void useCanvasStore.getState().patchNode(node.id, { duration });
  const segments = segmentCount(node.duration);
  return (
    <>
      <div className="param">
        <span className="meta">时长</span>
        <div className="stepper" data-od-id="duration-stepper">
          <button type="button" id="durDown" aria-label="减少一秒" disabled={node.duration <= min} onClick={() => setDuration(Math.max(min, node.duration - 1))}>
            −
          </button>
          <button type="button" className="dur-val" id="durVal" title="点开直接填时长" onClick={(e) => setDurationAt(durationAt ? null : e.currentTarget.getBoundingClientRect())}>
            {node.duration} 秒
          </button>
          <button type="button" id="durUp" aria-label="增加一秒" disabled={node.duration >= max} onClick={() => setDuration(Math.min(max, node.duration + 1))}>
            +
          </button>
        </div>
        {segments > 1 && (
          <span className="meta" id="durSegs" title="超过 15 秒的分段生成，模型在一个框里按段写好">
            分 {segments} 段
          </span>
        )}
        {durationAt && (
          <DurationPop
            anchor={durationAt}
            value={node.duration}
            onPick={(seconds) => {
              setDurationAt(null);
              setDuration(seconds);
            }}
            onClose={() => setDurationAt(null)}
          />
        )}
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
      <VideoGenButton node={node} />
    </>
  );
}

// 生图节点：尺寸和张数，改了存进节点的出图设置；旁边是出图设置，按钮上写着用哪个底模，用导入的工作流时写工作流的名字。
// 尺寸九档以外能自己填，自己填的也列在下拉里
function ImageParams({ node }: { node: ChatNode }) {
  const image = imageSize(node);
  const [customAt, setCustomAt] = useState<DOMRect | null>(null);
  const family = usePromptInfo(node.systemPromptName)?.family ?? 'IL';
  const settings = useImageSettings(node, family);
  const sizeGroups = family === 'Krea2' ? KREA2_SIZE_GROUPS.map((g) => ({ ...g, sizes: g.sizes.filter((s) => settings.krea?.mode !== 'four-view' || (s.width % 16 === 0 && s.height % 16 === 0)) })) : SIZE_GROUPS;
  const listed = sizeGroups.some((g) => g.sizes.some((size) => size.width === image.width && size.height === image.height));
  const options = useComfyStore((s) => s.options);
  const patchNode = useCanvasStore((s) => s.patchNode);
  const setCount = (count: number) => void patchNode(node.id, { image: { count } });
  const setSize = (size: { width: number; height: number }) =>
    void patchNode(node.id, { image: size }).then((ok) => ok && toast(`下次生图按 ${sizeText(size)} 出`));
  const checkpoint = effectiveCheckpoint(settings, family, options);
  const workflow = useNodeWorkflow(settings.workflowId);

  useEffect(() => {
    void useComfyStore.getState().loadOptions();
    // 读不到时按钮上照旧写底模，打开出图设置会说读不到
    if (!useWorkflowStore.getState().list) useWorkflowStore.getState().load().catch(() => undefined);
  }, []);

  // 套一层不占位的 span（原型也这样），出图设置按钮就不算槽位区右边那几个小图标按钮
  return (
    <span className="params" data-od-id="image-params">
      <div className="param">
        <span className="meta">尺寸</span>
        <select
          className="select select-sm mono"
          id="imgSize"
          aria-label="图的尺寸"
          data-od-id="image-size"
          value={sizeText(image)}
          onChange={(e) => {
            if (e.target.value === CUSTOM_SIZE) {
              setCustomAt(e.currentTarget.getBoundingClientRect());
              return;
            }
            const [width, height] = e.target.value.split('×').map(Number);
            setSize({ width, height });
          }}
        >
          {sizeGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.sizes.map((size) => (
                <option key={sizeText(size)} value={sizeText(size)}>
                  {sizeText(size)}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="自己填">
            {!listed && <option value={sizeText(image)}>{sizeText(image)}</option>}
            <option value={CUSTOM_SIZE}>自己填…</option>
          </optgroup>
        </select>
        {customAt && (
          <CustomSize
            anchor={customAt}
            size={image}
            krea={family === 'Krea2' ? settings.krea?.mode : undefined}
            onPick={(size) => {
              setCustomAt(null);
              setSize(size);
            }}
            onClose={() => setCustomAt(null)}
          />
        )}
      </div>
      <div className="param">
        <span className="meta">张数</span>
        <div className="stepper" data-od-id="image-count">
          <button type="button" id="cntDown" aria-label="少出一张" disabled={image.count <= 1} onClick={() => setCount(Math.max(1, image.count - 1))}>
            −
          </button>
          <output id="imgCount">{image.count} 张</output>
          <button type="button" id="cntUp" aria-label="多出一张" disabled={image.count >= 8} onClick={() => setCount(Math.min(8, image.count + 1))}>
            +
          </button>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm gen-cfg-btn"
        id="btnGenCfg"
        data-od-id="btn-generation-settings"
        title="出图设置：用哪台 ComfyUI、工作流、底模、LoRA、种子……每个节点各存一份"
        onClick={() => useOverlays.setState({ genSettings: node.id })}
      >
        <Icon name="sliders" />
        出图设置
        {workflow ? (
          <span className="lbl">工作流「{workflow.name}」</span>
        ) : (
          checkpoint && (
            <span className="lbl">
              {shortCheckpoint(checkpoint)}
              {settings.loras.length > 0 && ` + ${settings.loras.length} 个 LoRA`}
            </span>
          )
        )}
      </button>
    </span>
  );
}

// 尺寸自己填：宽高取最近的 8 的倍数，见 docs/dev-plan.md 5.21
function CustomSize({ anchor, size, krea, onPick, onClose }: { anchor: DOMRect; size: { width: number; height: number }; krea?: 'text' | 'four-view'; onPick: (size: { width: number; height: number }) => void; onClose: () => void }) {
  const [draft, setDraft] = useState({ width: String(size.width), height: String(size.height) });
  const multiple = krea === 'four-view' ? 16 : 8;
  const limits = krea ? { min: SIZE_LIMITS.min, max: 4096 } : SIZE_LIMITS;
  const round = (value: string) => krea === 'four-view' ? Math.round(Number(value) / 16) * 16 : roundSize(Number(value));
  const rounded = { width: round(draft.width), height: round(draft.height) };
  const ok = [rounded.width, rounded.height].every((side) => side >= limits.min && side <= limits.max);
  const go = () => ok && onPick(rounded);
  const field = (side: 'width' | 'height', label: string, autofocus?: boolean) => (
    <input
      className="input mono"
      type="number"
      aria-label={label}
      data-autofocus={autofocus || undefined}
      min={limits.min}
      max={limits.max}
      step={multiple}
      value={draft[side]}
      onChange={(e) => setDraft({ ...draft, [side]: e.target.value })}
      onKeyDown={(e) => e.key === 'Enter' && go()}
    />
  );
  return (
    <Popover anchor={anchor} className="size-pop" odId="popover-custom-size" label="自己填尺寸" onClose={onClose}>
      <div className="row">
        {field('width', '宽', true)}
        <span className="meta">×</span>
        {field('height', '高')}
        <button type="button" className="btn btn-primary btn-sm" disabled={!ok} onClick={go}>
          {ok ? `用 ${sizeText(rounded)}` : '用这个'}
        </button>
      </div>
      <p className="hint">
        宽高取最近的 {multiple} 的倍数，能填 {limits.min} 到 {limits.max}。
      </p>
    </Popover>
  );
}

// 槽位、时长、比例和上次发出时不一样：说清楚下次发消息会自动附上什么。生图节点不说时长和比例
function Pending({ node, use }: { node: ChatNode; use: PromptMeta['use'] }) {
  const images = useCanvasStore((s) => s.detail?.images);
  if (!hasUnsentSettings(node)) return null;
  const previous = activePath(node).at(-1)!;
  const note = slotDiff(previous, node, use).systemNote;
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
    if (node.kind === 'image') items.push({ label: '做四视图', icon: 'image', onClick: () => useOverlays.setState({ fourView: { nodeId: node.id, reference: { kind: 'slot', imageId: node.slots[index] } } }) });
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

function Composer({ node, image }: { node: ChatNode; image: boolean }) {
  const family = usePromptInfo(node.systemPromptName)?.family;
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
        {image && family !== 'Krea2' && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            id="btnWriteTags"
            data-od-id="btn-write-tags"
            title="不问 AI，自己写一串标签变成一个框"
            disabled={busy}
            onClick={() => useOverlays.setState({ writeTags: node.id })}
          >
            <Icon name="edit" />
            写标签
          </button>
        )}
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
