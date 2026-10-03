import { parseReply, thinkingLevelFor } from '@media-agent/shared';
import { useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { TagEditor } from '../tags/TagEditor';
import { LEVEL_LABELS } from '../ui/thinking';
import { toast } from '../ui/toast';
import { useOverlays, type TagsTarget } from './overlays';
import { shownVersions } from './Thread';

const close = () => useOverlays.setState({ tags: null });

// 生图节点框上的「编辑」：在标签编辑窗里改，存成这条回复的新版本，不问 AI
export function BoxTagEditor() {
  const target = useOverlays((s) => s.tags);
  if (!target) return null;
  return <Open key={`${target.messageId}/${target.promptIndex}`} target={target} />;
}

function Open({ target }: { target: TagsTarget }) {
  const node = useCanvasStore((s) => s.nodes[target.nodeId]);
  const message = node?.messages[target.messageId];
  const info = useCanvasStore((s) => s.prompts.find((p) => p.name === message?.systemPromptName));
  const model = useCanvasStore((s) => s.modelConfigs.find((m) => m.id === node?.modelConfigId));
  const thinking = useCanvasStore((s) => s.thinking);
  const busy = useCanvasStore((s) => Boolean(s.streams[target.nodeId]) || Boolean(s.detail?.nodes.find((n) => n.id === target.nodeId)?.generating));
  // 打开时框里的那串；之后这条回复再变也不影响正在改的
  const [text] = useState(() => (message ? (parseReply(message.text).prompts[target.promptIndex]?.text ?? '') : ''));
  if (!node || !message) return null;

  const family = info?.family ?? null;
  const level = !model || model.thinkingStyle === 'none' ? '不支持' : LEVEL_LABELS[thinking ? thinkingLevelFor(thinking, 'tagging') : 'off'];
  return (
    <TagEditor
      sub={`${node.title} · ${target.label || '提示词'}${family ? ` · ${family} 系列` : ''}`}
      text={text}
      family={family}
      convert={model ? { canvasId: node.canvasId, nodeId: node.id, model: model.name, level } : null}
      saveLabel="存成新版本"
      footNote="点小块调权重或删掉，按住拖动换顺序。存成这条回复的新版本，不问 AI"
      onSave={async (next) => {
        if (busy) {
          toast('正在生成，先叫停或等它写完', { tone: 'warn' });
          return false;
        }
        const versions = shownVersions(node, message).length;
        const ok = await useCanvasStore.getState().editPrompt(node.id, message.id, target.promptIndex, next);
        if (ok) toast(`存成了第 ${versions + 1} 版，标着「手动修改」`);
        return ok;
      }}
      onClose={close}
    />
  );
}
