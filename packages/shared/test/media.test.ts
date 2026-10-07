import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_SETTINGS, mediaKindOf, mediaLabels, mediaProblems, mediaSummary, refVideoFrames, sameMedia, takeSeconds, videoGraph, videoMediaOf, videoParams, type MediaSlot } from '../src';

// 视频和音频参考，见 docs/dev-plan.md 5.31

const video = (id: string, use: 'picture' | 'both' | 'sound', seconds = 10, start = 0): Extract<MediaSlot, { kind: 'video' }> => ({ kind: 'video', mediaId: id, seconds, start, use });
const audio = (id: string, use: 'voice' | 'dub', seconds = 10, start = 0): MediaSlot => ({ kind: 'audio', mediaId: id, seconds, start, use });

describe('视频和音频参考', () => {
  it('按扩展名认视频和音频', () => {
    expect(['a.MP4', 'b.mov', 'c.webm', 'd.m4v', 'e.mp3', 'f.WAV', 'g.flac', 'h.jpg', 'i.mkv'].map(mediaKindOf)).toEqual([
      'video',
      'video',
      'video',
      'video',
      'audio',
      'audio',
      'audio',
      null,
      null,
    ]);
  });

  it('取多少秒：取到填的第几秒，没填的取到结束；参考的最多 15 秒，配音一直用到结束；用画面的视频按 H3 真用的帧数砍掉零头', () => {
    // 17 帧一档：5、22、39…帧
    expect([2, 8.2, 15].map(refVideoFrames)).toEqual([39, 192, 345]);
    expect(takeSeconds(video('v', 'sound', 40, 30))).toBe(10);
    expect(takeSeconds(video('v', 'sound', 40, 3))).toBe(15);
    expect(takeSeconds(video('v', 'picture', 40, 3))).toBe(14.38);
    expect(takeSeconds(video('v', 'both', 40, 30))).toBe(9.42);
    expect(takeSeconds({ ...video('v', 'picture', 40, 3), end: 11.2 })).toBe(8);
    expect(takeSeconds({ ...video('v', 'sound', 40, 3), end: 11.2 })).toBe(8.2);
    expect(takeSeconds(audio('a', 'dub', 40, 3))).toBe(37);
    // 改到第几秒算视频和音频变了
    expect(sameMedia([video('v', 'picture', 40, 3)], [{ ...video('v', 'picture', 40, 3), end: 11.2 }])).toBe(false);
  });

  it('编号照 H3 节点数的顺序：画面和声音的视频的声音先数，再数只用声音的视频，再数声音参考；配音不编号', () => {
    const media = [video('v1', 'sound'), video('v2', 'picture'), video('v3', 'both'), audio('a1', 'dub'), audio('a2', 'voice')];
    expect(mediaLabels(media)).toEqual([{ audio: 2 }, { video: 1 }, { video: 2, audio: 1 }, { dub: true }, { audio: 3 }]);
    // 接进流程的顺序：用画面的视频、只用声音的视频、声音参考、配音
    expect(videoMediaOf(media, () => ({ width: 1280, height: 720 })).map((m) => m.mediaId)).toEqual(['v2', 'v3', 'v1', 'a2', 'a1']);
    expect(mediaSummary(videoMediaOf(media, () => undefined))).toEqual(['2 段参考视频', '3 段参考音频', '配音']);
  });

  it('上限：每段至少 2 秒，视频、音频加起来各不超过 15 秒，连图最多 12 个，不能只有音频，配音只能有一段', () => {
    expect(mediaProblems([video('v', 'sound', 10, 9)], 1)).toEqual(['音频 1 从第 9 秒起只能取 1 秒，至少要 2 秒']);
    expect(mediaProblems([video('v', 'picture', 10, 9)], 0)).toEqual(['视频 1 从第 9 秒起只能取 0.9 秒，至少要 2 秒']);
    expect(mediaProblems([video('v1', 'picture', 10), video('v2', 'picture', 8)], 0)).toEqual(['参考视频加起来 17.4 秒，最多 15 秒']);
    expect(mediaProblems([audio('a', 'voice', 5)], 0)).toEqual(['只有参考音频不行，至少要一张参考图或一段用画面的视频']);
    expect(mediaProblems([audio('a', 'voice', 5)], 1)).toEqual([]);
    expect(mediaProblems([video('v1', 'both', 3), video('v2', 'both', 3), audio('a', 'voice', 3)], 9)).toEqual(['图、视频、音频加起来 14 个，最多 12 个']);
    expect(mediaProblems([audio('a', 'dub', 30), audio('b', 'dub', 30)], 0)).toEqual(['配音有 2 段，只能有一段']);
    // 只有配音没问题：配音不算参考
    expect(mediaProblems([audio('a', 'dub', 60)], 0)).toEqual([]);
  });

  it('比画面大的视频读的时候缩到和画面一样大（竖的按宽），小的不缩', () => {
    const params = videoParams(['一段'], 15, '16:9', DEFAULT_VIDEO_SETTINGS, { refs: [] }, [
      { kind: 'video', mediaId: 'tall', use: 'picture', start: 0, take: 5, width: 1080, height: 1920 },
      { kind: 'video', mediaId: 'small', use: 'picture', start: 1.5, take: 5, width: 640, height: 360 },
    ]);
    const graph = videoGraph(params, 1, { refs: [], media: ['tall.mp4', 'small.mp4'] });
    expect([graph[200].inputs, graph[201].inputs].map((i) => [i.video, i.custom_width, i.custom_height, i.skip_first_frames, i.frame_load_cap])).toEqual([
      ['tall.mp4', 480, 0, 0, 120],
      ['small.mp4', 0, 0, 36, 120],
    ]);
  });
});
