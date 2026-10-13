import { create } from 'zustand';
import { editSettingsOf, type ChatNode, type Message } from '@media-agent/shared';
import { useCanvasStore } from '../store/canvasStore';

export type EditTab = 'create' | 'execute' | 'results';
export const useEditWorkspace = create<{
  tabs: Record<string, EditTab>;
  context: string | null;
}>()(() => ({ tabs: {}, context: null }));

export const showEditTab = (nodeId: string, tab: EditTab) =>
  useEditWorkspace.setState((s) => ({ tabs: { ...s.tabs, [nodeId]: tab } }));

export async function useEditCandidate(node: ChatNode, message: Message, promptIndex: number) {
  node = useCanvasStore.getState().nodes[node.id] ?? node;
  const edit = editSettingsOf(node.edit, node.slots.length);
  const origin = message.slotSnapshot[message.edit?.slot ?? edit.slot];
  const slot = node.slots.indexOf(origin);
  const text = message.parsed?.prompts[promptIndex]?.text ?? '';
  const ok = await useCanvasStore.getState().patchNode(node.id, {
    edit: {
      text, candidate: { messageId: message.id, promptIndex }, source: null,
      ...(slot >= 0 && { slot }),
    },
  });
  if (ok) showEditTab(node.id, 'execute');
  return ok;
}
