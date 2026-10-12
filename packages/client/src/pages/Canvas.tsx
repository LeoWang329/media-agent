import { hiddenNodeIds } from '@media-agent/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AssetsDialog } from '../canvas/AssetsDialog';
import { CollageDialog } from '../canvas/CollageDialog';
import { DownloadDialog, VideoDownloadDialog } from '../canvas/DownloadDialog';
import { Drawer } from '../canvas/Drawer';
import { GenSettingsDialog } from '../canvas/GenSettings';
import { FourViewDialog } from '../canvas/FourViewDialog';
import { Graph } from '../canvas/Graph';
import { onImageEvent } from '../canvas/imageActions';
import { ImageViewer } from '../canvas/ImageViewer';
import { addRootNode, autoLayout, closeDrawer, selectNode } from '../canvas/nodeActions';
import { CLOSED_OVERLAYS, openAssets, useOverlays } from '../canvas/overlays';
import { RefPicker } from '../canvas/RefPicker';
import { SysPromptDialog } from '../canvas/SysPromptDialog';
import { TranslateDialog } from '../canvas/TranslateDialog';
import { BoxTagEditor, WriteTagsEditor } from '../canvas/BoxTagEditor';
import { UploadDialog } from '../canvas/UploadDialog';
import { onVideoEvent, showVideo } from '../canvas/videoActions';
import { VideoGenDialog } from '../canvas/VideoGenDialog';
import { VideoTasksButton } from '../canvas/VideoTasks';
import { ZoomDialog } from '../canvas/ZoomDialog';
import { fitAll, useView, zoomBy } from '../canvas/view';
import { ComfyPill, VideoPill } from '../components/ComfyPill';
import { useCanvasStore } from '../store/canvasStore';
import { watchImageJobs } from '../store/comfyStore';
import { watchVideoJobs } from '../store/videoStore';
import { clockSeconds } from '../ui/format';
import { Icon } from '../ui/Icon';
import { showMenu, type MenuItem } from '../ui/menu';
import { RenameInput } from '../ui/RenameInput';
import { SaveState } from '../ui/saveState';
import { ThemeToggle, toggleTheme } from '../ui/theme';

// 画布工作台：节点图铺满整个窗口，工具浮在四角，右边滑出节点对话面板
// 新建节点先选是视频节点还是生图节点，建好就不能换，见 docs/dev-plan.md 5.23
const NEW_NODE_MENU: MenuItem[] = [
  { label: '视频节点', icon: 'film', onClick: () => void addRootNode('video') },
  { label: '生图节点', icon: 'sparkles', onClick: () => void addRootNode('image') },
];

export function Canvas() {
  const { id } = useParams();
  const navigate = useNavigate();
  const detail = useCanvasStore((s) => (s.canvasId === id ? s.detail : null));
  const selectedId = useCanvasStore((s) => s.selectedId);
  const undoLabels = useCanvasStore((s) => s.undoLabels);
  const redoLabels = useCanvasStore((s) => s.redoLabels);
  const zoom = useView((s) => s.z);
  const [renaming, setRenaming] = useState(false);
  const fitted = useRef(false);
  // 从首页点进来的节点（地址里的 #node=节点 id），画布读出来后打开它的对话；从视频任务小窗点进来的还带着 &video=视频 id，那条闪一下
  const linked = useRef<{ nodeId: string; videoId: string | null } | null>(null);
  const title = detail?.canvas.title ?? '';

  useEffect(() => {
    if (!id) return;
    fitted.current = false;
    const hash = new URLSearchParams(location.hash.slice(1));
    linked.current = hash.get('node') ? { nodeId: hash.get('node')!, videoId: hash.get('video') } : null;
    void useCanvasStore.getState().open(id);
    useOverlays.setState(CLOSED_OVERLAYS);
  }, [id]);

  useEffect(() => {
    document.body.classList.add('ws');
    return () => document.body.classList.remove('ws', 'drawer-open');
  }, []);

  // 出图、生成视频的变化：框下面的图和视频、卡片上的进度跟着变
  useEffect(() => watchImageJobs(onImageEvent), []);
  useEffect(() => watchVideoJobs(onVideoEvent), []);

  useEffect(() => {
    document.body.classList.toggle('drawer-open', Boolean(selectedId));
  }, [selectedId]);

  useEffect(() => {
    if (title) document.title = `${title} · 提示词画布`;
  }, [title]);

  // 打开画布时把节点都放进视野；从首页点进来的节点接着打开，地址里的 #node= 用完就去掉
  useEffect(() => {
    if (!detail || fitted.current) return;
    fitted.current = true;
    const hidden = hiddenNodeIds(detail.nodes);
    fitAll(detail.nodes.filter((n) => !hidden.has(n.id)));
    const link = linked.current;
    if (!link) return;
    linked.current = null;
    if (detail.nodes.some((n) => n.id === link.nodeId)) void (link.videoId ? showVideo(link.nodeId, link.videoId) : selectNode(link.nodeId));
    navigate({ hash: '' }, { replace: true });
  }, [detail, navigate]);

  // 别的页面里正在生成的节点（比如刷新过页面）：隔一会儿读一次，写完为止
  const remote = useCanvasStore((s) => (s.detail?.nodes ?? []).filter((n) => n.generating && !s.streams[n.id]).map((n) => n.id).join(','));
  useEffect(() => {
    if (!remote) return;
    const timer = setInterval(() => {
      const { refresh, loadNode, selectedId: current, nodes } = useCanvasStore.getState();
      void refresh().catch(() => undefined);
      if (current && remote.split(',').includes(current) && nodes[current]) void loadNode(current).catch(() => undefined);
    }, 1500);
    return () => {
      clearInterval(timer);
      // 生成完了再读一次，拿到写完的回复；打开过的节点都读，切回去时不会停在半截
      const { loadNode, nodes } = useCanvasStore.getState();
      remote.split(',').forEach((nodeId) => nodes[nodeId] && void loadNode(nodeId).catch(() => undefined));
    };
  }, [remote]);

  // Ctrl+Z 撤销、Ctrl+Shift+Z 或 Ctrl+Y 重做；打字时不抢，那里撤销的是打的字。Esc 收起面板。
  // 弹窗开着时都不管，不动后面的画布
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName) || document.querySelector('dialog[open]')) return;
      const { undo, redo } = useCanvasStore.getState();
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      }
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        void redo();
      }
      if (e.key === 'Escape' && target.tagName !== 'SELECT') closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const { undo, redo } = useCanvasStore.getState();
  const undoLabel = undoLabels.at(-1);
  const redoLabel = redoLabels.at(-1);

  const renameCanvas = async (next: string | null) => {
    setRenaming(false);
    const value = next?.trim();
    if (value && value !== title) await useCanvasStore.getState().renameCanvas(value);
  };

  return (
    <>
      <Graph key={id} />

      <header className="ws-float ws-top" data-od-id="canvas-topbar">
        <Link className="btn btn-ghost btn-icon" to="/" title="回到首页" aria-label="回到首页">
          <Icon name="home" />
        </Link>
        <div className="ws-crumb">
          <Link to="/" className="muted hide-sm">
            画布
          </Link>
          <span className="muted hide-sm">/</span>
          {renaming ? (
            <RenameInput value={title} className="ws-rename" maxLength={30} onDone={(next) => void renameCanvas(next)} />
          ) : (
            <button type="button" className="ws-title-btn" id="canvasTitle" title="点击改名" data-od-id="canvas-title" onClick={() => setRenaming(true)}>
              {title}
            </button>
          )}
        </div>
        <span className="vr hide-sm" />
        <SaveState idle={detail ? `已写入 ${clockSeconds(detail.canvas.updatedAt)}` : ''} className="hide-sm" />
      </header>

      <nav className="ws-float ws-tools" id="tools" aria-label="画布工具" data-od-id="canvas-tools">
        <button type="button" className="btn btn-ghost" id="btnNewNode" data-od-id="btn-new-node" aria-haspopup="menu" onClick={(e) => showMenu(e.currentTarget, NEW_NODE_MENU, 'left')}>
          <Icon name="plus" />
          <span className="hide-sm">新建节点</span>
        </button>
        <button type="button" className="btn btn-ghost hide-sm" id="btnLayout" data-od-id="btn-auto-layout" onClick={() => void autoLayout()}>
          <Icon name="layout" />
          自动排整齐
        </button>
        <span className="vr hide-sm" />
        <button
          type="button"
          className="btn btn-ghost btn-icon hide-sm"
          id="btnUndo"
          aria-label="撤销"
          data-od-id="btn-undo"
          disabled={!undoLabel}
          title={undoLabel ? `撤销：${undoLabel}（Ctrl+Z）` : '没有可以撤销的操作'}
          onClick={() => void undo()}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon hide-sm"
          id="btnRedo"
          aria-label="重做"
          data-od-id="btn-redo"
          disabled={!redoLabel}
          title={redoLabel ? `重做：${redoLabel}（Ctrl+Shift+Z）` : '没有可以重做的操作'}
          onClick={() => void redo()}
        >
          <Icon name="redo" />
        </button>
        <span className="vr hide-sm" />
        <button type="button" className="btn btn-ghost hide-sm" id="btnAssets" data-od-id="btn-assets" onClick={() => openAssets(selectedId ? 'slots' : 'browse')}>
          <Icon name="image" />
          <span className="hide-md">资产库</span>
        </button>
        <ThemeToggle className="hide-sm" />
        <Link className="btn btn-ghost btn-icon hide-sm" to="/settings" aria-label="设置" title="设置">
          <Icon name="gear" />
        </Link>
        <button
          type="button"
          className="btn btn-ghost btn-icon show-sm"
          id="btnMore"
          aria-label="更多"
          onClick={(e) =>
            showMenu(e.currentTarget, [
              { label: '自动排整齐', icon: 'layout', onClick: () => void autoLayout() },
              { label: '撤销', icon: 'undo', onClick: () => void undo() },
              { label: '重做', icon: 'redo', onClick: () => void redo() },
              { sep: true },
              { label: '资产库', icon: 'image', onClick: () => openAssets('browse') },
              { label: '切换明暗', icon: 'sun', onClick: toggleTheme },
              { label: '设置', icon: 'gear', onClick: () => navigate('/settings') },
            ])
          }
        >
          <Icon name="more" />
        </button>
      </nav>

      <div className="ws-float ws-zoom" data-od-id="canvas-zoom">
        <button type="button" className="btn btn-ghost btn-icon btn-sm" id="zoomOut" aria-label="缩小" onClick={() => zoomBy(1 / 1.2)}>
          <Icon name="minus" />
        </button>
        <button type="button" className="btn btn-ghost btn-sm mono" id="zoomVal" title="回到 100%" onClick={() => zoomBy(1 / useView.getState().z)}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" id="zoomIn" aria-label="放大" onClick={() => zoomBy(1.2)}>
          <Icon name="plus" />
        </button>
        <span className="vr" />
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          id="zoomFit"
          aria-label="显示全部节点"
          title="显示全部节点"
          onClick={() => {
            const nodes = useCanvasStore.getState().detail?.nodes ?? [];
            const hidden = hiddenNodeIds(nodes);
            fitAll(nodes.filter((n) => !hidden.has(n.id)));
          }}
        >
          <Icon name="fit" />
        </button>
      </div>

      {/* 缩放旁边：出图用哪台 ComfyUI、生成视频那台，一直看得到 */}
      <div className="ws-float ws-comfy">
        <ComfyPill />
        <VideoPill />
        <VideoTasksButton />
      </div>

      <Drawer />
      <RefPicker />
      <AssetsDialog />
      <UploadDialog />
      <CollageDialog />
      <SysPromptDialog />
      <TranslateDialog />
      <BoxTagEditor />
      <WriteTagsEditor />
      <ZoomDialog />
      <GenSettingsDialog />
      <FourViewDialog />
      <ImageViewer />
      <DownloadDialog />
      <VideoDownloadDialog />
      <VideoGenDialog />
    </>
  );
}
