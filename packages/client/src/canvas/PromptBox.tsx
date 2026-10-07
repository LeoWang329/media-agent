import { directionDraft, type CanvasImage, type ChatNode, type Message } from '@media-agent/shared';
import { EditorContent } from '@tiptap/react';
import { useState } from 'react';
import { docPictures, docToText } from '../editor/document';
import { usePictureEditor } from '../editor/usePictureEditor';
import { useCanvasStore } from '../store/canvasStore';
import { copyText, fmtNum } from '../ui/copy';
import { Icon, type IconName } from '../ui/Icon';
import { toast } from '../ui/toast';
import { closeRefPicker, openRefPicker, useOverlays } from './overlays';
import { promptBody } from './tokens';
import { generateVideo } from './videoActions';
import { VideoJobs } from './VideoJobs';

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
          {act('copy', '复制', 'copy', () => copyText(text, `已复制提示词（${fmtNum(text.length)} 字）`))}
          {video && editable && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-act="genVideo"
              title="按这条回复的时长、比例和节点的生成设置，在生成视频用的 AutoDL 实例上生成"
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
        </div>
      </div>
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
