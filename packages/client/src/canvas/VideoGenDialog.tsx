import { lengthProblem, splitSegments, videoFrames, videoSecondsText, videoSettingsOf, videoSizes, workflowOfSettings, selfliftPlan, selfliftOfSettings, type ChatNode, type Message } from '@media-agent/shared';
import { useCanvasStore } from '../store/canvasStore';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { closeGenVideo, useOverlays } from './overlays';
import { generateVideo } from './videoActions';
import { useVideoRatio, VideoSettingsBody } from './VideoSettings';

// 点「生成视频」弹出来的那个窗：里面就是生成设置，改完点顶上的「开始生成」，见 docs/dev-plan.md 5.36。
// 这里改的和「生成设置」那个小窗改的是同一份（每个节点一份，改了自动存）
export function VideoGenDialog() {
  const target = useOverlays((s) => s.genVideo);
  const node = useCanvasStore((s) => (target ? s.nodes[target.nodeId] : undefined));
  const message = node && target ? node.messages[target.messageId] : undefined;
  if (!target || !node || !message) return null;
  return <VideoGenBody key={`${node.id}-${message.id}-${target.promptIndex}`} node={node} message={message} promptIndex={target.promptIndex} />;
}

function VideoGenBody({ node, message, promptIndex }: { node: ChatNode; message: Message; promptIndex: number }) {
  const text = message.parsed?.prompts[promptIndex]?.text ?? '';
  const segments = Math.max(1, splitSegments(text).length);
  const settings = videoSettingsOf(node.video);
  const workflow = workflowOfSettings(settings);
  const sized = useVideoRatio(message.systemPromptName, message.aspectRatio, message.slotSnapshot[0]);
  const { finalWidth, finalHeight } = videoSizes(settings.megapixels, settings.upscale, sized);
  // 框里写的段数不够，出来的片子会比时长短：先说清楚，按住「开始生成」，见 docs/dev-plan.md 5.24
  const tooShort = lengthProblem(node.duration, segments, workflow === 'selflift' ? selfliftOfSettings(settings) : undefined);
  // SelfLift 那套是一段一条片子接力，报的是自己那套的分段和整条时长；两遍生成就是一个任务里跑完
  const plan = workflow === 'selflift' ? selfliftPlan(node.duration, segments, settings.selflift?.contextFrames ?? 22, Boolean(settings.selflift?.lead)) : null;
  const total = plan ? plan.total : videoFrames(node.duration, segments).total;
  // 续写起点只有 SelfLift 那套认（切到两遍生成时它留在设置里，但不生效）
  const lead = workflow === 'selflift' ? (settings.selflift?.lead ?? null) : null;
  // 分段计划已扣掉上下文，并补足节点要求的新画面时长。
  const fresh = total;
  const media = message.mediaSnapshot ?? [];
  const refs = message.slotSnapshot.length;

  const go = () => {
    closeGenVideo();
    void generateVideo({ nodeId: node.id, messageId: message.id }, promptIndex);
  };

  return (
    <Dialog className="vg-dialog" label="生成视频" odId="dialog-gen-video" onClose={closeGenVideo}>
      <div className="dialog-head vg-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id="vgTitle">生成视频</h2>
          <span className="meta" id="vgSub">
            「{node.title}」的第 {promptIndex + 1} 个提示词框 · 生成时按 {node.duration} 秒、{segments} 段提示词
          </span>
        </div>
        <span className="grow" />
        <button type="button" className="btn btn-primary vg-go" id="vgGo" data-od-id="video-gen-go" disabled={Boolean(tooShort)} title={tooShort ?? undefined} onClick={go}>
          <Icon name="film" />
          开始生成
        </button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={closeGenVideo}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dialog-body vg-body">
        <div className="vg-sum" data-od-id="video-gen-summary">
          <span>
            走 <b>{workflow === 'selflift' ? 'SelfLift 接续' : '两遍生成'}</b>
            {plan && (
              <>
                ，分 <b className="mono">{plan.lengths.length}</b> 条接力
              </>
            )}
          </span>
          <span>
            出片{' '}
            <b className="mono">
              {finalWidth}×{finalHeight}
            </b>
            ，{lead ? '新出' : '约'} <b className="mono">{videoSecondsText(fresh)}</b>
            {lead && <span className="meta">（加上选的续写起点那段，就是整条；新出这段开头 {plan?.context} 帧是它的尾巴，出片时剪掉）</span>}
          </span>
          <span>
            带 {refs} 张参考图
            {media.length > 0 && ` · ${media.length} 段视频或音频`}
          </span>
        </div>
        {tooShort && (
          <p className="pb-warn" data-od-id="video-gen-warn">
            <Icon name="warn" className="icon-sm" />
            <span>{tooShort}</span>
          </p>
        )}
        <VideoSettingsBody node={node} message={message} />
      </div>
      <div className="dialog-foot">
        <span className="meta grow">改了自动存，下次点生成就用新的；每个节点各存一份</span>
        <button type="button" className="btn btn-secondary" onClick={closeGenVideo}>
          取消
        </button>
        <button type="button" className="btn btn-primary" id="vgGoFoot" disabled={Boolean(tooShort)} onClick={go}>
          <Icon name="film" />
          开始生成
        </button>
      </div>
    </Dialog>
  );
}
