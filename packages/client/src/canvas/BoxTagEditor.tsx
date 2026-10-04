import { parseReply, thinkingLevelFor, type ChatNode, type ModelConfig, type ThinkingSettings } from '@media-agent/shared';
import { useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { TagEditor, type ConvertWith } from '../tags/TagEditor';
import { LEVEL_LABELS } from '../ui/thinking';
import { toast } from '../ui/toast';
import { useOverlays, type TagsTarget } from './overlays';
import { shownVersions } from './Thread';

const close = () => useOverlays.setState({ tags: null });
const closeWrite = () => useOverlays.setState({ writeTags: null });

const BUSY = '正在生成，先叫停或等它写完';

// 让 AI 优化时不写要求就用这句
const OPTIMIZE_DEFAULT = '保持原意，改成标准写法，补上缺的，去掉重复和冲突的';

// 「让 AI 转成标签」用节点的模型配置问，界面上写着模型名和思考档位
function convertWith(node: ChatNode, model: ModelConfig | undefined, thinking: ThinkingSettings | null): ConvertWith | null {
  if (!model) return null;
  const level = model.thinkingStyle === 'none' ? '不支持' : LEVEL_LABELS[thinking ? thinkingLevelFor(thinking, 'tagging') : 'off'];
  return { canvasId: node.canvasId, nodeId: node.id, model: model.name, level };
}

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
  return (
    <TagEditor
      sub={`${node.title} · ${target.label || '提示词'}${family ? ` · ${family} 系列` : ''}`}
      text={text}
      family={family}
      convert={convertWith(node, model, thinking)}
      saveLabel="存成新版本"
      footNote="点小块调权重或删掉，按住拖动换顺序。存成这条回复的新版本，不问 AI"
      onSave={async (next) => {
        if (busy) {
          toast(BUSY, { tone: 'warn' });
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

// 生图节点输入框旁的「写标签」：不问 AI，自己写一个框。
// 也能让 AI 优化：先把写的存成框，再像平时发消息一样带着前面的对话问模型，模型回一个新框，见 docs/dev-plan.md 5.14
export function WriteTagsEditor() {
  const nodeId = useOverlays((s) => s.writeTags);
  if (!nodeId) return null;
  return <Write key={nodeId} nodeId={nodeId} />;
}

function Write({ nodeId }: { nodeId: string }) {
  const node = useCanvasStore((s) => s.nodes[nodeId]);
  const info = useCanvasStore((s) => s.prompts.find((p) => p.name === node?.systemPromptName));
  const model = useCanvasStore((s) => s.modelConfigs.find((m) => m.id === node?.modelConfigId));
  const thinking = useCanvasStore((s) => s.thinking);
  const busy = useCanvasStore((s) => Boolean(s.streams[nodeId]) || Boolean(s.detail?.nodes.find((n) => n.id === nodeId)?.generating));
  if (!node) return null;

  const family = info?.family ?? null;
  const write = async (text: string) => {
    if (busy) {
      toast(BUSY, { tone: 'warn' });
      return false;
    }
    return useCanvasStore.getState().writeBox(node.id, text);
  };
  return (
    <TagEditor
      title="写标签"
      sub={`${node.title}${family ? ` · ${family} 系列` : ''}`}
      text=""
      family={family}
      convert={convertWith(node, model, thinking)}
      saveLabel="存成框"
      footNote="存成框不问 AI。让 AI 优化时，你写的也存成一个框留着，AI 带着前面的对话回一个新框"
      onSave={async (text) => {
        const ok = await write(text);
        if (ok) toast('存成了一个框，标着「自己写的」，可以直接生图');
        return ok;
      }}
      optimize={{
        placeholder: `想怎么改可以写一句，比如「换成夜景」。不写就按默认：${OPTIMIZE_DEFAULT}`,
        onOptimize: async (text, requirement) => {
          if (!(await write(text))) return false;
          void useCanvasStore.getState().send(node.id, `优化上面这个框里我自己写的标签：${requirement || OPTIMIZE_DEFAULT}`);
          return true;
        },
      }}
      onClose={closeWrite}
    />
  );
}
