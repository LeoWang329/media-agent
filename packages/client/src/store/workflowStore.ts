import type { ComfyGraph, FillTarget, ImportedWorkflow } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';

// 导入的工作流，设置页、出图设置、面板底部的按钮共用，见 docs/dev-plan.md 5.18

type WorkflowState = {
  list: ImportedWorkflow[] | null; // 还没读过是 null
  load: () => Promise<ImportedWorkflow[]>;
  put: (workflow: ImportedWorkflow) => void;
  drop: (id: string) => void;
};

export const useWorkflowStore = create<WorkflowState>((set, get) => {
  let run: Promise<ImportedWorkflow[]> | null = null;
  return {
    list: null,
    // 同时有几处要读时只读一次
    load: () =>
      (run ??= api<ImportedWorkflow[]>('/workflows')
        .then((list) => {
          set({ list });
          return list;
        })
        .finally(() => {
          run = null;
        })),
    put: (workflow) => {
      const list = get().list ?? [];
      set({ list: list.some((w) => w.id === workflow.id) ? list.map((w) => (w.id === workflow.id ? workflow : w)) : [...list, workflow] });
    },
    drop: (id) => set({ list: (get().list ?? []).filter((w) => w.id !== id) }),
  };
});

// 节点选的导入的工作流；没选、已经删了、还没读到是 null
export const useNodeWorkflow = (workflowId: string | null) => useWorkflowStore((s) => (workflowId ? (s.list?.find((w) => w.id === workflowId) ?? null) : null));

// 列给人看的节点：节点号 · 类型 · 标题，标题和类型一样的不写
export function nodeLabel(graph: ComfyGraph, node: string): string {
  const item = graph[node];
  if (!item) return `${node} 号节点`;
  const title = item._meta?.title?.trim();
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [node, item.class_type, title && plain(title) !== plain(item.class_type) ? title : ''].filter(Boolean).join(' · ');
}

// 往哪填的一项：提示词填的是 text 的不写输入名，种子写上是 seed 还是 noise_seed
export const targetLabel = (graph: ComfyGraph, target: FillTarget, always = false) =>
  always || target.input !== 'text' ? `${nodeLabel(graph, target.node)} · ${target.input}` : nodeLabel(graph, target.node);
