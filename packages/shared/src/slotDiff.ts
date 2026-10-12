import { mediaNote, sameMedia } from './media';
import type { AspectRatio, Attachment, ChatNode, EditSettings, FrameAttachment, MediaSlot, Message, PromptMeta } from './types';
import { activePath } from './versionTree';
import { segmentCount, segmentSeconds } from './video';

// media 是视频和音频槽位，只有视频节点有，没有是空
export type SlotSettings = { slots: string[]; duration: number; aspectRatio: AspectRatio; media?: MediaSlot[] };

export type SlotDiff = { systemNote?: string; attachments: Attachment[]; frames?: FrameAttachment[] };

export const aspectRatioText = (ratio: AspectRatio) => (ratio === 'auto' ? '自动' : ratio);

const pictureList = (numbers: number[]) => numbers.map((n) => `<Picture ${n}>`).join('、');

// 时长超过 15 秒的分几段生成，说明里写上，见 docs/dev-plan.md 5.24
function settingsNote(duration: number, ratio: AspectRatio): string {
  const segments = segmentCount(duration);
  return segments > 1
    ? `视频时长 ${duration} 秒，分 ${segments} 段生成，每段约 ${segmentSeconds(duration)} 秒，相邻两段重叠约 1 秒。画面比例 ${aspectRatioText(ratio)}。`
    : `视频时长 ${duration} 秒，画面比例 ${aspectRatioText(ratio)}。`;
}

// 视频和音频的说明和截帧，接在图、时长、比例的说明后面，见 docs/dev-plan.md 5.31：第一条有就说；之后变了才说，把现在的全部重说一遍
function mediaDiff(prev: MediaSlot[] | null, cur: MediaSlot[]): { note: string; frames: FrameAttachment[] } {
  if (prev && sameMedia(prev, cur)) return { note: '', frames: [] };
  if (!cur.length) return { note: prev?.length ? '参考视频和音频都去掉了。' : '', frames: [] };
  const { note, frames } = mediaNote(cur);
  return { note: prev ? `参考视频和音频改了，以下是现在全部的，以此为准。${note}` : note, frames };
}

// 发送时算这条 user 消息带哪些图、加什么说明。prev 是当前路径上的最后一条消息（不分角色），节点里还没有消息时为 null。
// 生图节点（use 是 image）的说明不写时长和比例，也没有视频和音频
export function slotDiff(
  prev: Pick<Message, 'slotSnapshot' | 'duration' | 'aspectRatio' | 'mediaSnapshot'> | null,
  cur: SlotSettings,
  use: PromptMeta['use'] = 'video',
): SlotDiff {
  const { slots } = cur;
  const all = slots.map((_, i) => i + 1);
  const attach = (numbers: number[]) => numbers.map((picture) => ({ picture, imageId: slots[picture - 1] }));
  const video = use === 'video';
  const media = video ? mediaDiff(prev && (prev.mediaSnapshot ?? []), cur.media ?? []) : { note: '', frames: [] };
  const withFrames = (diff: SlotDiff): SlotDiff => (media.frames.length ? { ...diff, frames: media.frames } : diff);

  if (!prev) {
    const settings = video ? settingsNote(cur.duration, cur.aspectRatio) : '';
    return withFrames({
      systemNote: `${slots.length ? `参考图共 ${slots.length} 张，编号如下。` : '本次没有参考图。'}${settings}${media.note}`,
      attachments: attach(all),
    });
  }

  const before = prev.slotSnapshot;
  const prefixSame = before.every((id, i) => slots[i] === id);
  // 换掉的位置放的都是之前没有的图才算「换图」；放的是原来别的位置上的图，就是调了顺序
  const onlyReplaced = slots.length === before.length && slots.every((id, i) => id === before[i] || !before.includes(id));

  let note = '';
  let numbers: number[] = [];
  if (prefixSame && slots.length === before.length) {
    // 图没变
  } else if (prefixSame && slots.length > before.length) {
    numbers = all.slice(before.length);
    note = `新增参考图：${pictureList(numbers)}。`;
  } else if (onlyReplaced) {
    numbers = all.filter((n) => slots[n - 1] !== before[n - 1]);
    note = `${pictureList(numbers)} 换成了下面的新图，其他不变。`;
  } else {
    numbers = all;
    note = `参考图已重新编号，以下是当前全部 ${slots.length} 张参考图，以此为准，之前的编号作废。`;
  }
  if (video && cur.duration !== prev.duration) {
    const segments = segmentCount(cur.duration);
    note += segments > 1 ? `视频时长改为 ${cur.duration} 秒，分 ${segments} 段生成。` : `视频时长改为 ${cur.duration} 秒。`;
  }
  if (video && cur.aspectRatio !== prev.aspectRatio) note += `画面比例改为 ${aspectRatioText(cur.aspectRatio)}。`;
  note += media.note;
  return withFrames({ ...(note && { systemNote: note }), attachments: attach(numbers) });
}

type NodeSettings = Pick<ChatNode, 'messages' | 'rootIds' | 'activeChildOf' | 'slots' | 'duration' | 'aspectRatio' | 'media'>;

// 图像编辑节点这次发给模型的图：**只有选中的那一张** —— 模型要看着它写「要改什么」，
// 别的槽位里的图跟这次改哪张没关系，见 docs/dev-plan.md 5.39。
// 每轮都重发一次：只带最近几轮时，前面那轮的图可能已经不在了
export function editDiff(slots: readonly string[], edit: Pick<EditSettings, 'slot'>): SlotDiff {
  const imageId = slots[edit.slot];
  if (!imageId) return { systemNote: '还没有选要改的图。', attachments: [] };
  return { systemNote: `要改的是第 ${edit.slot + 1} 张参考图。`, attachments: [{ picture: edit.slot + 1, imageId }] };
}

// 当前路径最后一条消息记下的槽位、时长、比例、视频和音频；还没有消息时为 null
export function pathSnapshot(node: NodeSettings): SlotSettings | null {
  const last = activePath(node).at(-1);
  return last ? { slots: [...last.slotSnapshot], duration: last.duration, aspectRatio: last.aspectRatio, media: [...(last.mediaSnapshot ?? [])] } : null;
}

// 两份槽位、时长、比例、视频和音频一样不一样
export const sameSettings = (a: SlotSettings, b: SlotSettings) =>
  a.duration === b.duration && a.aspectRatio === b.aspectRatio && a.slots.length === b.slots.length && a.slots.every((id, i) => id === b.slots[i]) && sameMedia(a.media, b.media);

// 槽位、时长、比例、视频和音频和当前路径最后一条消息记下的不一样，就是有还没发出的改动
export function hasUnsentSettings(node: NodeSettings): boolean {
  const snapshot = pathSnapshot(node);
  return Boolean(snapshot && !sameSettings(snapshot, node));
}
