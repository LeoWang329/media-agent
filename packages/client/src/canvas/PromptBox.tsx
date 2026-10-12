import { directionDraft, editFnOf, editSettingsOf, lengthProblem, splitSegments, type CanvasImage, type ChatNode, type Message } from '@media-agent/shared';
import { EditorContent } from '@tiptap/react';
import { useState } from 'react';
import { docPictures, docToText } from '../editor/document';
import { usePictureEditor } from '../editor/usePictureEditor';
import { useCanvasStore } from '../store/canvasStore';
import { copyText, fmtNum } from '../ui/copy';
import { Icon, type IconName } from '../ui/Icon';
import { toast } from '../ui/toast';
import { drawnMask } from './EditPanel';
import { closeRefPicker, openRefPicker, useOverlays } from './overlays';
import { promptBody } from './tokens';
import { generateVideo } from './videoActions';
import { VideoJobs } from './VideoJobs';
import { generate, startEdit } from './imageActions';
import { ImageJobs } from './ImageJobs';

type Props = {
  node: ChatNode;
  message: Message;
  index: number;
  label?: string;
  text: string;
  ro: boolean; // 复制来的消息：只能看、复制、上传清单、往下岔
  writing: boolean; // 正在写
  incomplete: boolean; // 叫停时还没写完
  busy: boolean;
  versions: number; // 这条回复同一位置现在有几个版本
  images: Record<string, CanvasImage> | undefined;
};

export function PromptBox({ node, message, index, label, text, ro, writing, incomplete, busy, versions, images }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const starred = Boolean(message.stars?.includes(index)) && !incomplete;
  // 没收尾的框不在解析出来的提示词里，打星和手动改都对不上号
  const editable = !ro && !writing && !incomplete;
  const imgs = message.slotSnapshot;
  // 视频节点的框能生成视频，框下面挂着生成的视频，见 docs/dev-plan.md 5.27
  const video = node.kind === 'video';
  const image = node.kind === 'image';
  // 编辑节点的框下面也挂在框下面出的图，跟生图节点一样，见 docs/dev-plan.md 5.36
  const edit = node.kind === 'edit';
  // 这条框是照哪个功能、第几张图写的：写这条时记在回复上，老回复没记就照节点现在的设置
  const boxEdit = edit ? (message.edit ?? { fn: editSettingsOf(node.edit, node.slots.length).fn, slot: editSettingsOf(node.edit, node.slots.length).slot }) : null;
  // 框里那句话落到下面编辑栏：把功能、图也切回写这条框时的那套，见 docs/dev-plan.md 5.36
  const useBox = () => {
    if (!boxEdit) return;
    const now = editSettingsOf(node.edit, node.slots.length);
    const imageId = message.slotSnapshot[boxEdit.slot];
    const at = imageId ? node.slots.indexOf(imageId) : -1;
    if (imageId && at < 0) toast('这条框用的图已经不在槽位里了，用的是现在选中的这张', { tone: 'warn' });
    // 转真人：框里那句话是手写的，落下来时切到「手输」，不然反推开着那句话根本用不上（照原型）
    const manual = boxEdit.fn === 'real' ? { real: { ...now.real, reverse: false } } : {};
    void useCanvasStore
      .getState()
      .patchNode(node.id, { edit: { fn: boxEdit.fn, slot: at >= 0 ? at : now.slot, text, ...manual } })
      .then((ok) => ok && toast(`落到编辑栏了：「${editFnOf(boxEdit.fn).name}」，可以直接开始`));
  };
  // 框上的「开始」：用**这条框自己的**功能、图、那句话出图，出的那组挂在这条框下面（不新建回复），
  // 见 docs/plan-image-edit-node-layout.md 第 4 节 ④。跟面板底部的「开始」共用 startEdit 那条服务端路径。
  // 缺东西的三种情况都先说一句人话：功能还没做、这条框用的图不在槽位里了、局部重绘还没画掩码
  const startFromBox = () => {
    if (!boxEdit) return;
    const fn = editFnOf(boxEdit.fn);
    if (!fn.ready) return toast(`「${fn.name}」还没做，下一批上`, { tone: 'danger' });
    const imageId = message.slotSnapshot[boxEdit.slot];
    const at = imageId ? node.slots.indexOf(imageId) : -1;
    if (at < 0) return toast('这条框用的图已经不在槽位里了：把那张图放回槽位，或者点「用它」换一张再开始', { tone: 'warn' });
    const now = editSettingsOf(node.edit, node.slots.length);
    // 转真人：框里那句是手写的，按「手输」走（跟「用它」一个规矩），不然反推开着时这句话根本用不上
    const change = { fn: boxEdit.fn, slot: at, text, ...(boxEdit.fn === 'real' ? { real: { ...now.real, reverse: false } } : {}) };
    const target = { messageId: message.id, promptIndex: index };
    // 局部重绘的掩码是在面板上画的：这条框用的图跟面板上那张是同一张、而且画好了才发得出去
    if (boxEdit.fn === 'inpaint') {
      void drawnMask(node, imageId).then((mask) => {
        if (!mask) return toast('局部重绘要先在面板上拖框或涂抹出要重画的地方：点「用它」把这条框落到编辑栏，画好掩码再开始', { tone: 'warn' });
        return startEdit(node.id, { mask, change, target });
      });
      return;
    }
    void startEdit(node.id, { change, target });
  };
  // 框里写的段数不够，出来的片子会比时长短：先说清楚，别点下去白跑一趟，见 docs/dev-plan.md 5.24。
  // 比的是节点现在的时长（面板上那个），和服务端生成时用的是同一个，不按写这条回复时记的
  const tooShort = video ? lengthProblem(node.duration, splitSegments(text).length) : null;

  if (editing) {
    return <BoxEditor node={node} message={message} index={index} label={label} text={text} busy={busy} versions={versions} onClose={() => setEditing(false)} />;
  }

  const long = text.length > 700 && !open && !writing;
  const act = (name: string, title: string, icon: IconName, onClick: () => void, extra = '') => (
    <button type="button" className={`btn btn-ghost btn-sm${extra}`} data-act={name} title={title} onClick={onClick}>
      <Icon name={icon} className={name === 'star' && starred ? 'icon-fill' : undefined} />
      <span className="lbl">{name === 'star' ? (starred ? '已打星' : '打星') : title}</span>
    </button>
  );

  return (
    <div className={`pbox${starred ? ' is-starred' : ''}${writing || incomplete ? ' is-writing' : ''}`} data-od-id="prompt-box" data-testid="prompt-box">
      <div className="pb-head">
        <span className={`pb-label${label ? '' : ' is-plain'}`}>{label || '提示词'}</span>
        <div className="pb-actions">
          {edit && editable && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-act="use"
              title={`把这句话落到编辑栏的「要改什么」，功能切回「${editFnOf(boxEdit!.fn).name}」、用第 ${boxEdit!.slot + 1} 张图`}
              onClick={useBox}
            >
              <Icon name="check" />
              <span className="lbl">用它</span>
            </button>
          )}
          {/* 框上直接出图：出的那组挂在这条框下面，跟生图节点框上那个「生图」一样，见 layout 第 4 节 ④ */}
          {edit && editable && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-act="start"
              title={`按这条框自己的设置出图：「${editFnOf(boxEdit!.fn).name}」、用第 ${boxEdit!.slot + 1} 张图；出的图挂在这条框下面`}
              onClick={startFromBox}
            >
              <Icon name="wand" />
              <span className="lbl">开始</span>
            </button>
          )}
          {act('copy', '复制', 'copy', () => copyText(text, `已复制提示词（${fmtNum(text.length)} 字）`))}
          {image && editable && <button type="button" className="btn btn-secondary btn-sm" data-act="generate" onClick={() => void generate({ nodeId: node.id, messageId: message.id }, index)}><Icon name="image" /><span className="lbl">生图</span></button>}
          {video && editable && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-act="genVideo"
              disabled={Boolean(tooShort)}
              title={tooShort ?? '按这条回复的时长、比例和节点的生成设置，在生成视频用的 AutoDL 实例上生成'}
              onClick={() => void generateVideo({ nodeId: node.id, messageId: message.id }, index)}
            >
              <Icon name="film" />
              <span className="lbl">生成视频</span>
            </button>
          )}
          {!writing &&
            !incomplete &&
            act('translate', '翻译', 'translate', () => useOverlays.setState({ translate: { nodeId: node.id, messageId: message.id, promptIndex: index, label } }))}
          {!ro &&
            !incomplete &&
            act(
              'star',
              starred ? '取消星标' : '打星：这版效果好',
              'star',
              () =>
                void useCanvasStore
                  .getState()
                  .star(node.id, message.id, index, !starred)
                  .then((ok) => ok && toast(starred ? '取消了星标' : '打了星。画布上这个节点会显示星标')),
              starred ? ' is-star' : '',
            )}
          {editable &&
            act('editBox', '手动改', 'edit', () => {
              if (busy) toast('正在生成，先叫停或等它写完', { tone: 'warn' });
              else setEditing(true);
            })}
          {act('upload', '上传清单', 'list', () => useOverlays.setState({ upload: { nodeId: node.id, label, text, images: imgs } }))}
          {!writing && act('continue', '沿这个方向继续', 'arrow-right', () => void useCanvasStore.getState().fork(node.id, message.id, directionDraft(index, label)))}
          {boxEdit && (
            <span className="pb-edit-tag" data-testid="box-edit-tag">
              {editFnOf(boxEdit.fn).name} · 用 {boxEdit.slot + 1} 号图
            </span>
          )}
        </div>
      </div>
      {tooShort && (
        <p className="pb-warn" data-od-id="video-length-mismatch">
          <Icon name="warn" className="icon-sm" />
          <span>{tooShort}</span>
        </p>
      )}
      <div className={`pb-body${long ? ' is-clamped' : ''}`}>
        {promptBody(text, imgs, images)}
        {writing && <span className="caret" />}
      </div>
      {long && (
        <div className="pb-more">
          <button type="button" className="btn btn-ghost btn-sm" data-act="expand" onClick={() => setOpen(true)}>
            <Icon name="chev-down" />
            展开全文 · {fmtNum(text.length)} 字
          </button>
        </div>
      )}
      {writing && (
        <div className="pb-foot">
          <span className="writing-tag">
            <span className="spinner" />
            还没写完
          </span>
          <span className="mono">{fmtNum(text.length)} 字</span>
        </div>
      )}
      {incomplete && (
        <div className="pb-foot" style={{ color: 'var(--warn)' }}>
          <Icon name="warn" />
          叫停时还没写完，这条提示词不完整
        </div>
      )}
      {video && !writing && !incomplete && <VideoJobs node={node} message={message} promptIndex={index} text={text} ro={ro} />}
      {(image || edit) && !writing && !incomplete && <ImageJobs node={node} message={message} promptIndex={index} ro={ro} />}
    </div>
  );
}

// 手动改提示词：<Picture N> 始终按这条回复当时带的图编号。存下的新版本带的还是这些图，
// 上传清单、从它岔出的节点才对得上号；槽位后来调过顺序、删过图都不影响
function BoxEditor({ node, message, index, label, text, busy, versions, onClose }: Pick<Props, 'node' | 'message' | 'index' | 'label' | 'text' | 'busy' | 'versions'> & { onClose: () => void }) {
  const [error, setError] = useState('');
  const images = message.slotSnapshot;
  const editor = usePictureEditor({
    initialText: text,
    slots: images,
    ariaLabel: '手动改提示词',
    className: 'composer-input',
    autofocus: true,
    onAt: (instance, typedAt) => openRefPicker(instance.view.dom, instance, typedAt, images),
    onEscape: closeRefPicker,
    onChange: () => setError(''),
  });

  const save = async () => {
    if (!editor) return;
    // 存下的新版本会成为当前显示的这版，正在写的回复就从面板上切走了
    if (busy) return toast('正在生成，先叫停或等它写完', { tone: 'warn' });
    const doc = editor.getJSON();
    const broken = docPictures(doc).find((id) => !images.includes(id));
    if (broken) {
      const name = useCanvasStore.getState().detail?.images[broken]?.originalName ?? '';
      setError(`引用的 ${name} 不在这条回复带的图里，存不了。删掉这处引用再存。`);
      return;
    }
    const ok = await useCanvasStore.getState().editPrompt(node.id, message.id, index, docToText(doc, images).trim());
    if (!ok) return;
    onClose();
    toast(`存成了第 ${versions + 1} 版，标着「手动修改」`);
  };

  return (
    <div className="pbox" data-od-id="prompt-box-editor" data-testid="prompt-box">
      <div className="pb-head">
        <span className="pb-label">手动改{label ? `：${label}` : ''}</span>
        <span className="meta">存成新版本，不会重新问 AI</span>
      </div>
      <div className="pb-editor">
        <div className="composer">
          <EditorContent editor={editor} />
        </div>
        {error && (
          <div className="composer-error" id="boxEditorError">
            <Icon name="warn" />
            <span>{error}</span>
          </div>
        )}
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" data-act="boxRef" onClick={(e) => editor && openRefPicker(e.currentTarget, editor, false, images)}>
            <Icon name="at" />
            引用图片
          </button>
          <span className="grow" />
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
            <Icon name="check" />
            存成新版本
          </button>
        </div>
      </div>
    </div>
  );
}
