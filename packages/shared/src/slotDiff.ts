import type { AspectRatio, Attachment, ChatNode, Message, PromptMeta } from './types';
import { activePath } from './versionTree';
import { segmentCount, segmentSeconds } from './video';

export type SlotSettings = { slots: string[]; duration: number; aspectRatio: AspectRatio };

export type SlotDiff = { systemNote?: string; attachments: Attachment[] };

export const aspectRatioText = (ratio: AspectRatio) => (ratio === 'auto' ? '自动' : ratio);

const pictureList = (numbers: number[]) => numbers.map((n) => `<Picture ${n}>`).join('、');

// 时长超过 15 秒的分几段生成，说明里写上，见 docs/dev-plan.md 5.24
function settingsNote(duration: number, ratio: AspectRatio): string {
  const segments = segmentCount(duration);
  return segments > 1
    ? `视频时长 ${duration} 秒，分 ${segments} 段生成，每段约 ${segmentSeconds(duration)} 秒，相邻两段重叠约 1 秒。画面比例 ${aspectRatioText(ratio)}。`
    : `视频时长 ${duration} 秒，画面比例 ${aspectRatioText(ratio)}。`;
}

// 发送时算这条 user 消息带哪些图、加什么说明。prev 是当前路径上的最后一条消息（不分角色），节点里还没有消息时为 null。
// 生图节点（use 是 image）的说明不写时长和比例
export function slotDiff(
  prev: Pick<Message, 'slotSnapshot' | 'duration' | 'aspectRatio'> | null,
  cur: SlotSettings,
  use: PromptMeta['use'] = 'video',
): SlotDiff {
  const { slots } = cur;
  const all = slots.map((_, i) => i + 1);
  const attach = (numbers: number[]) => numbers.map((picture) => ({ picture, imageId: slots[picture - 1] }));
  const video = use === 'video';

  if (!prev) {
    const settings = video ? settingsNote(cur.duration, cur.aspectRatio) : '';
    return {
      systemNote: slots.length ? `参考图共 ${slots.length} 张，编号如下。${settings}` : `本次没有参考图。${settings}`,
      attachments: attach(all),
    };
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
  return { ...(note && { systemNote: note }), attachments: attach(numbers) };
}

type NodeSettings = Pick<ChatNode, 'messages' | 'rootIds' | 'activeChildOf' | 'slots' | 'duration' | 'aspectRatio'>;

// 当前路径最后一条消息记下的槽位、时长、比例；还没有消息时为 null
export function pathSnapshot(node: NodeSettings): SlotSettings | null {
  const last = activePath(node).at(-1);
  return last ? { slots: [...last.slotSnapshot], duration: last.duration, aspectRatio: last.aspectRatio } : null;
}

// 槽位、时长、比例和当前路径最后一条消息记下的不一样，就是有还没发出的改动
export function hasUnsentSettings(node: NodeSettings): boolean {
  const snapshot = pathSnapshot(node);
  if (!snapshot) return false;
  return (
    snapshot.duration !== node.duration ||
    snapshot.aspectRatio !== node.aspectRatio ||
    snapshot.slots.length !== node.slots.length ||
    snapshot.slots.some((id, i) => id !== node.slots[i])
  );
}
