import type { AudioUse, FrameAttachment, MediaKind, MediaSlot, VideoMedia, VideoUse } from './types';
import { VIDEO_FPS } from './video';

// 视频和音频参考：能收哪些格式、槽位编号、上限、发给写提示词的模型的说明，见 docs/dev-plan.md 5.31

export const MEDIA_EXTENSIONS: Record<MediaKind, string[]> = {
  video: ['.mp4', '.mov', '.webm', '.m4v'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'],
};

// 按扩展名认是视频还是音频，都不是的是 null
export function mediaKindOf(name: string): MediaKind | null {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (MEDIA_EXTENSIONS.video.includes(ext)) return 'video';
  return MEDIA_EXTENSIONS.audio.includes(ext) ? 'audio' : null;
}

// 槽位：视频、音频各最多 3 个
export const MAX_MEDIA: Record<MediaKind, number> = { video: 3, audio: 3 };

// H3 参考的上限：每段 2 到 15 秒；参考的视频、音频各最多 3 段（视频里的声音算一段音频），连图加起来最多 12 个；视频加起来、音频加起来各不超过 15 秒
export const MEDIA_LIMITS = { minSeconds: 2, maxSeconds: 15, videos: 3, audios: 3, total: 12, videoSeconds: 15, audioSeconds: 15 };

export const VIDEO_USE_TEXT: Record<VideoUse, string> = { picture: '只用画面', both: '画面和声音', sound: '只用声音' };
export const AUDIO_USE_TEXT: Record<AudioUse, string> = { voice: '声音参考', dub: '配音' };

// 秒数显示：最多一位小数
export const secondsText = (seconds: number) => String(Math.round(seconds * 10) / 10);

// H3 节点只按 17 帧一档用参考视频的画面（5、22、39…帧，每秒 24 帧），零头从尾巴砍掉
export function refVideoFrames(seconds: number): number {
  const frames = Math.round(seconds * VIDEO_FPS);
  return frames < 5 ? 0 : frames - ((frames - 5) % 17);
}

// 取多少秒：从开始那一秒取到 end（没填的取到这段结束），参考的最多 15 秒；配音一直用到文件结束。
// 用画面的视频先按节点真用的帧数砍好零头，取多少秒就是真用多少秒。取到百分之一秒，免得加起来差一点点就超
export function takeSeconds(slot: { seconds: number; start: number; end?: number; use: MediaSlot['use'] }): number {
  const to = slot.end === undefined ? slot.seconds : Math.min(slot.end, slot.seconds);
  const left = Math.max(0, Math.round((to - slot.start) * 100) / 100);
  if (slot.use === 'dub') return left;
  const take = Math.min(MEDIA_LIMITS.maxSeconds, left);
  return slot.use === 'picture' || slot.use === 'both' ? Math.round((refVideoFrames(take) / VIDEO_FPS) * 100) / 100 : take;
}

// 每格的编号，照 H3 节点数的顺序：用画面的视频依次是 <Video 1>…；音频先数「画面和声音」的视频的声音，
// 再数「只用声音」的视频，再数当声音参考的音频；配音不编号
export type MediaLabel = { video?: number; audio?: number; dub?: true };
export function mediaLabels(media: MediaSlot[]): MediaLabel[] {
  const labels: MediaLabel[] = media.map(() => ({}));
  let videos = 0;
  let audios = 0;
  media.forEach((slot, i) => {
    if (slot.kind === 'video' && slot.use !== 'sound') labels[i].video = ++videos;
  });
  const audioOrder: ((slot: MediaSlot) => boolean)[] = [
    (slot) => slot.kind === 'video' && slot.use === 'both',
    (slot) => slot.kind === 'video' && slot.use === 'sound',
    (slot) => slot.kind === 'audio' && slot.use === 'voice',
  ];
  for (const match of audioOrder) {
    media.forEach((slot, i) => {
      if (match(slot)) labels[i].audio = ++audios;
    });
  }
  media.forEach((slot, i) => {
    if (slot.use === 'dub') labels[i].dub = true;
  });
  return labels;
}

// 一格叫什么：视频 1、音频 2、配音
export function mediaName(slot: MediaSlot, label: MediaLabel): string {
  if (label.dub) return '配音';
  if (slot.kind === 'video' && label.video) return `视频 ${label.video}`;
  return `音频 ${label.audio}`;
}

// 接进流程的顺序：用画面的视频、只用声音的视频、声音参考、配音；size 查视频的宽高
export function videoMediaOf(media: MediaSlot[], size: (mediaId: string) => { width?: number; height?: number } | undefined): VideoMedia[] {
  const rank = (slot: MediaSlot) => (slot.kind === 'video' ? (slot.use === 'sound' ? 1 : 0) : slot.use === 'voice' ? 2 : 3);
  return media
    .map((slot, i) => ({ slot, i }))
    .sort((a, b) => rank(a.slot) - rank(b.slot) || a.i - b.i)
    .map(({ slot }) => {
      const { width, height } = (slot.kind === 'video' && slot.use !== 'sound' && size(slot.mediaId)) || {};
      return { kind: slot.kind, mediaId: slot.mediaId, use: slot.use, start: slot.start, take: takeSeconds(slot), ...(width && height && { width, height }) };
    });
}

// 超了哪些上限，见 docs/dev-plan.md 5.31；pictures 是一起当参考的图有几张。都没超是空的
export function mediaProblems(media: MediaSlot[], pictures: number): string[] {
  const labels = mediaLabels(media);
  const L = MEDIA_LIMITS;
  const problems: string[] = [];
  const videos = media.filter((_, i) => labels[i].video);
  const audios = media.filter((_, i) => labels[i].audio);
  const dubs = media.filter((slot) => slot.use === 'dub');
  if (videos.length > L.videos) problems.push(`参考视频有 ${videos.length} 段，最多 ${L.videos} 段`);
  if (audios.length > L.audios) problems.push(`参考音频有 ${audios.length} 段（视频里的声音也算），最多 ${L.audios} 段`);
  const total = pictures + videos.length + audios.length;
  if (total > L.total) problems.push(`图、视频、音频加起来 ${total} 个，最多 ${L.total} 个`);
  media.forEach((slot, i) => {
    const take = takeSeconds(slot);
    if (take < L.minSeconds) problems.push(`${mediaName(slot, labels[i])} 从第 ${secondsText(slot.start)} 秒起只能取 ${secondsText(take)} 秒，至少要 ${L.minSeconds} 秒`);
  });
  const sum = (slots: MediaSlot[]) => Math.round(slots.reduce((total, slot) => total + takeSeconds(slot), 0) * 100) / 100;
  if (sum(videos) > L.videoSeconds) problems.push(`参考视频加起来 ${secondsText(sum(videos))} 秒，最多 ${L.videoSeconds} 秒`);
  if (sum(audios) > L.audioSeconds) problems.push(`参考音频加起来 ${secondsText(sum(audios))} 秒（视频里的声音也算），最多 ${L.audioSeconds} 秒`);
  if (audios.length && !pictures && !videos.length) problems.push('只有参考音频不行，至少要一张参考图或一段用画面的视频');
  if (dubs.length > 1) problems.push(`配音有 ${dubs.length} 段，只能有一段`);
  return problems;
}

// 给写提示词的模型的说明：现在的全部视频和音频，加上用画面的视频各截的一帧；一个都没有是空的
export function mediaNote(media: MediaSlot[]): { note: string; frames: FrameAttachment[] } {
  const labels = mediaLabels(media);
  const items = media.map((slot, i) => ({ slot, label: labels[i], take: secondsText(takeSeconds(slot)) }));
  const videos = items.filter((item) => item.label.video).sort((a, b) => a.label.video! - b.label.video!);
  const audios = items.filter((item) => item.label.audio && !item.label.video).sort((a, b) => a.label.audio! - b.label.audio!);
  const audioCount = items.filter((item) => item.label.audio).length;
  const parts = [
    ...videos.map(({ slot, label, take }) =>
      slot.use === 'both' ? `<Video ${label.video}> 取 ${take} 秒，画面和声音都用，它的声音是 <Audio ${label.audio}>` : `<Video ${label.video}> 取 ${take} 秒，只用画面`,
    ),
    ...audios.map(({ slot, label, take }) => `<Audio ${label.audio}> 取 ${take} 秒${slot.kind === 'video' ? '，是一段视频里的声音' : ''}`),
  ];
  const head = [videos.length && `参考视频 ${videos.length} 段`, audioCount && `参考音频 ${audioCount} 段`].filter(Boolean).join('、');
  let note = parts.length ? `${head}：${parts.join('；')}。` : '';
  const dub = items.find((item) => item.label.dub);
  if (dub) note += `配音：一段 ${dub.take} 秒的音频当整条视频的声音，人物跟着它对口型。`;
  const frames = videos.flatMap(({ slot, label }) => (slot.kind === 'video' && slot.frame ? [{ video: label.video!, imageId: slot.frame }] : []));
  if (frames.length) note += `下面是 ${frames.map((f) => `<Video ${f.video}>`).join('、')} 各截的一帧。`;
  return { note, frames };
}

// 视频和音频变没变：加、删、换、调顺序、改从第几秒到第几秒、改用法都算；截帧跟着起止变，不单算
const mediaKey = (media: MediaSlot[]) => JSON.stringify(media.map((slot) => [slot.kind, slot.mediaId, slot.start, slot.kind === 'video' ? (slot.end ?? null) : null, slot.use]));
export const sameMedia = (a: MediaSlot[] = [], b: MediaSlot[] = []) => mediaKey(a) === mediaKey(b);

// 框下面没生成过时写带了什么：「带 1 段参考视频、2 段参考音频、配音」里视频和音频那几项
export function mediaSummary(media: Pick<VideoMedia, 'kind' | 'use'>[]): string[] {
  const videos = media.filter((m) => m.kind === 'video' && m.use !== 'sound').length;
  const audios = media.filter((m) => m.use === 'both').length + media.filter((m) => m.use === 'sound' || m.use === 'voice').length;
  return [videos && `${videos} 段参考视频`, audios && `${audios} 段参考音频`, media.some((m) => m.use === 'dub') && '配音'].filter((part): part is string => Boolean(part));
}
