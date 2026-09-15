import type { NodeSummary } from '@media-agent/shared';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';

export type CardNode = Node<{ summary: NodeSummary; hiddenCount: number }, 'card'>;

export function NodeCard({ id, data, selected }: NodeProps<CardNode>) {
  const { summary, hiddenCount } = data;
  const renamingId = useCanvasStore((s) => s.renamingId);
  const setRenaming = useCanvasStore((s) => s.setRenaming);
  const patchNode = useCanvasStore((s) => s.patchNode);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (renamingId === id) {
      setEditing(true);
      setRenaming(null);
    }
  }, [renamingId, id, setRenaming]);

  const cancelled = useRef(false);
  const finish = (value: string) => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (value.trim() && value.trim() !== summary.title) void patchNode(id, { title: value.trim() });
  };

  return (
    <div className={`node-card${selected ? ' selected' : ''}`} data-testid="node-card">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="node-card-head">
        {editing ? (
          <input
            className="nodrag node-title-input"
            aria-label="节点标题"
            autoFocus
            defaultValue={summary.title}
            onBlur={(e) => finish(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancelled.current = true;
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
          />
        ) : (
          <div className="node-title" onDoubleClick={() => setEditing(true)}>
            {summary.title}
          </div>
        )}
        {summary.directionCount > 1 && <span className="badge">{summary.directionCount} 个方向</span>}
      </div>
      {summary.summary && <div className="node-summary">{summary.summary}</div>}
      {hiddenCount > 0 && <div className="node-collapsed">▸ 已收起 {hiddenCount} 个</div>}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
