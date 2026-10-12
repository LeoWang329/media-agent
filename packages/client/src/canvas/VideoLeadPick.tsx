import { secondsText, selfliftOfSettings, videoSecondsText, videoSettingsOf, type ChatNode, type Message, type VideoJob, type VideoLead } from '@media-agent/shared';
import { useRef, useState } from 'react';
import { leadFileUrl, mediaFileUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { clock, fmtSize } from '../ui/format';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toast';
import { openAssets } from './overlays';
import { videoSrc } from './videoActions';

// SelfLift 的「续写起点」：给一段已有的视频，从那一段接着往下出，见 docs/dev-plan.md 5.35。
// 三种来源都能挑：已经出完的一整条视频、这台画布上导入的视频素材、本机传上来的一段。
// 空着就是重新生成（跟本来的行为一样）
export function VideoLeadPick({ node, message }: { node: ChatNode; message?: Message }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [busy, setBusy] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const records = useCanvasStore((s) => s.detail?.media);
  const leads = useCanvasStore((s) => s.detail?.leads);
  const lead = selfliftOfSettings(videoSettingsOf(node.video)).lead ?? null;

  const jobs = (message?.videos ?? []).filter((job) => job.status === 'done' || (job.status === 'stopped' && job.partial && job.file));
  const videos = Object.values(records ?? {}).filter((record) => record.kind === 'video');
  const uploaded = Object.values(leads ?? {});
  const text = leadText(lead, jobs, videos, leads ?? {});
  const pick = (next: VideoLead | null) => {
    setAnchor(null);
    void useCanvasStore.getState().setLead(node.id, next);
  };
  // 本机的一段：不读时长宽高（浏览器不一定读得出来，HEVC 就报不出宽高），直接传上去
  const send = async (chosen: File) => {
    setAnchor(null);
    setBusy(chosen.name);
    await useCanvasStore.getState().useLead(node.id, { file: chosen, name: chosen.name });
    setBusy('');
  };

  return (
    <div className="vl-row" data-od-id="video-lead">
      <button
        type="button"
        className="select vc-lead-btn"
        id="vcLead"
        aria-label="续写起点"
        title={text}
        aria-pressed={Boolean(lead)}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <Icon name={lead ? 'film' : 'plus'} className="icon-sm" />
        <span className="vc-lead-name">{busy ? `正在传 ${busy}…` : text}</span>
        <Icon name="chev-down" className="icon-sm" />
      </button>
      <button type="button" className="btn btn-ghost btn-sm" id="vcLeadPick" onClick={() => openAssets('lead')} disabled={!canvasId}>
        <Icon name="folder" className="icon-sm" />
        资产库
      </button>
      <button type="button" className="btn btn-ghost btn-sm" id="vcLeadUpload" onClick={() => file.current?.click()}>
        <Icon name="upload" className="icon-sm" />
        传一段
      </button>
      <input
        ref={file}
        type="file"
        accept="video/*,.mp4,.mov,.webm,.m4v,.mkv,.avi"
        hidden
        data-testid="lead-file"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = '';
          if (chosen) void send(chosen);
        }}
      />
      {anchor && (
        <Popover anchor={anchor} className="vl-pop" odId="popover-video-lead" label="续写起点" onClose={() => setAnchor(null)}>
          <p className="hint">从选的那一段接着往下出：出来的整条是「这一段 + 新出的几段」。不选就是重新生成。</p>
          <div className="vl-list">
            <button type="button" className={`vl-item${lead ? '' : ' is-on'}`} data-lead="none" onClick={() => pick(null)}>
              <Icon name="sparkles" className="icon-sm" />
              <span className="vl-name">不接，重新生成</span>
              {!lead && <Icon name="check" className="icon-sm" />}
            </button>
            {jobs.length > 0 && <div className="vl-title">这个框下面已生成的</div>}
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={`vl-item${isSame(lead, { kind: 'job', jobId: job.id }) ? ' is-on' : ''}`}
                data-lead={`job:${job.id}`}
                onClick={() => pick({ kind: 'job', jobId: job.id })}
              >
                <span className="vl-name">
                  种子 {job.seed} · {videoSecondsText(job.params.frames.total)}
                  <span className="meta">
                    {' '}
                    · {clock(job.createdAt)} · {job.params.finalWidth}×{job.params.finalHeight}
                  </span>
                </span>
                {isSame(lead, { kind: 'job', jobId: job.id }) && <Icon name="check" className="icon-sm" />}
              </button>
            ))}
            {videos.length > 0 && <div className="vl-title">这台画布上的视频素材</div>}
            {videos.map((record) => (
              <button
                key={record.id}
                type="button"
                className={`vl-item${isSame(lead, { kind: 'media', mediaId: record.id }) ? ' is-on' : ''}`}
                data-lead={`media:${record.id}`}
                onClick={() => pick({ kind: 'media', mediaId: record.id })}
              >
                <span className="vl-name">
                  {record.originalName}
                  <span className="meta">
                    {' '}
                    · {secondsText(record.seconds)} · {fmtSize(record.bytes)}
                  </span>
                </span>
                {isSame(lead, { kind: 'media', mediaId: record.id }) && <Icon name="check" className="icon-sm" />}
              </button>
            ))}
            {uploaded.length > 0 && <div className="vl-title">传上来的前一段</div>}
            {uploaded.map((record) => (
              <button
                key={record.id}
                type="button"
                className={`vl-item${isSame(lead, { kind: 'lead', leadId: record.id }) ? ' is-on' : ''}`}
                data-lead={`lead:${record.id}`}
                onClick={() => pick({ kind: 'lead', leadId: record.id })}
              >
                <span className="vl-name">
                  {record.originalName}
                  <span className="meta"> · {fmtSize(record.bytes)}</span>
                </span>
                {isSame(lead, { kind: 'lead', leadId: record.id }) && <Icon name="check" className="icon-sm" />}
              </button>
            ))}
            <div className="vl-title">电脑里的</div>
            <button
              type="button"
              className="vl-item"
              data-lead="assets"
              onClick={() => {
                setAnchor(null);
                openAssets('lead');
              }}
            >
              <Icon name="folder" className="icon-sm" />
              <span className="vl-name">资产库里挑一段…</span>
            </button>
            <button
              type="button"
              className="vl-item"
              data-lead="upload"
              onClick={() => {
                setAnchor(null);
                file.current?.click();
              }}
            >
              <Icon name="upload" className="icon-sm" />
              <span className="vl-name">直接传一段上来…</span>
            </button>
          </div>
          <p className="hint">清掉、或者选「不接」就是重新生成。传上来的和资产库挑的都会复制进这台画布一份，之后换电脑、那个文件挪走了都还在。</p>
        </Popover>
      )}
      {lead && canvasId && <LeadPreview lead={lead} jobs={jobs} message={message} node={node} />}
    </div>
  );
}

// 现在选的是哪一段：这个框下面已生成的一条、画布上的视频素材、还是传上来的
export function leadText(lead: VideoLead | null, jobs: VideoJob[], videos: { id: string; originalName: string }[], leads: Record<string, { originalName: string }>): string {
  if (!lead) return '不接，重新生成';
  if (lead.kind === 'job') {
    const job = jobs.find((one) => one.id === lead.jobId);
    return job ? `已生成的那条（种子 ${job.seed}）` : '已生成的那条';
  }
  if (lead.kind === 'media') return videos.find((one) => one.id === lead.mediaId)?.originalName ?? '画布上的一段视频';
  return leads[lead.leadId]?.originalName ?? '传上来的一段视频';
}

const isSame = (lead: VideoLead | null, other: VideoLead) => JSON.stringify(lead) === JSON.stringify(other);

// 选好了给个小播放器：确认是不是要接的那段（认不出来的编码播不了，不影响当起点用）
function LeadPreview({ lead, jobs, message, node }: { lead: VideoLead; jobs: VideoJob[]; message?: Message; node: ChatNode }) {
  const canvasId = useCanvasStore((s) => s.canvasId)!;
  const src =
    lead.kind === 'lead'
      ? leadFileUrl(canvasId, lead.leadId)
      : lead.kind === 'media'
        ? mediaFileUrl(canvasId, lead.mediaId)
        : message && jobs.some((one) => one.id === lead.jobId)
          ? videoSrc({ nodeId: node.id, messageId: message.id }, jobs.find((one) => one.id === lead.jobId)!)
          : null;
  if (!src) return null;
  return (
    <video className="vc-lead-view" src={src} controls preload="metadata" onError={() => toast('这段浏览器播不了，不影响当续写起点用', { tone: 'warn', ms: 3000 })} />
  );
}
