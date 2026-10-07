import type { MediaKind } from '@media-agent/shared';

// 视频和音频由浏览器读：多长、宽高、有没有声音，再截一帧给写提示词的模型看，见 docs/dev-plan.md 5.31

export type MediaProbe = { seconds: number; width?: number; height?: number; hasAudio?: boolean };

const WAIT_MS = 20_000;

// 等元素读完开头；读不出来（浏览器放不了的编码）或者太久没反应的算失败
function loaded(el: HTMLMediaElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), WAIT_MS);
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve();
    };
    el.onerror = () => {
      clearTimeout(timer);
      reject(new Error('decode'));
    };
  });
}

function element(kind: MediaKind, url: string): HTMLMediaElement {
  const el = document.createElement(kind);
  el.preload = 'metadata';
  el.muted = true;
  el.src = url;
  return el;
}

const release = (el: HTMLMediaElement) => {
  el.removeAttribute('src');
  el.load();
};

// 视频有没有声音：Chrome、Edge 从 captureStream 看有没有音轨；看不了的当它有
type Capturable = HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
function hasAudioTrack(video: Capturable): boolean {
  const stream = video.captureStream?.() ?? video.mozCaptureStream?.();
  if (!stream) return true;
  const found = stream.getAudioTracks().length > 0;
  stream.getTracks().forEach((track) => track.stop());
  return found;
}

// 读不出来的抛错，name 写进提示里
export async function probeMedia(url: string, kind: MediaKind, name: string): Promise<MediaProbe> {
  const el = element(kind, url);
  try {
    await loaded(el);
    if (!Number.isFinite(el.duration) || el.duration <= 0) throw new Error('duration');
    if (kind === 'audio') return { seconds: el.duration };
    const video = el as Capturable;
    if (!video.videoWidth || !video.videoHeight) throw new Error('size');
    return { seconds: video.duration, width: video.videoWidth, height: video.videoHeight, hasAudio: hasAudioTrack(video) };
  } catch {
    throw new Error(`${name} 读不出来，换成 mp4（H.264）或 webm 再试`);
  } finally {
    release(el);
  }
}

// 截一帧：跳到 at 秒，画下来存成 JPEG
export async function captureFrame(url: string, at: number): Promise<Blob> {
  const video = element('video', url) as HTMLVideoElement;
  video.preload = 'auto';
  try {
    await loaded(video);
    video.currentTime = Math.max(0, Math.min(at, video.duration - 0.05));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('seek')), WAIT_MS);
      video.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('截不了'))), 'image/jpeg', 0.9));
  } finally {
    release(video);
  }
}
