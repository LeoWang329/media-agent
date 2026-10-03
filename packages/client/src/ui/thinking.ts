import { thinkingLevelFor, type ModelConfig, type ThinkingLevel, type ThinkingSettings, type ThinkingStyle } from '@media-agent/shared';

export const LEVEL_LABELS: Record<ThinkingLevel, string> = { off: '关', low: '低', medium: '中', high: '高' };

// 模型配置里「开思考的写法」的选项：参数名照各家接口写，看文档时对得上
export const STYLE_LABELS: Record<ThinkingStyle, string> = {
  none: '不支持',
  'reasoning-effort': 'reasoning_effort',
  'enable-thinking': 'enable_thinking',
  'thinking-type': 'thinking.type',
  'model-switch': '换模型名',
};

// 这种写法在各档位发什么，见 docs/dev-plan.md 5.12
export function styleNote(config: Pick<ModelConfig, 'model' | 'thinkingStyle' | 'thinkingModel'>): string {
  switch (config.thinkingStyle) {
    case 'reasoning-effort':
      return '关和低发 low，中发 medium，高发 high，不发回思考原文';
    case 'enable-thinking':
      return '关发 false；低中高发 true 加思考预算，会发回思考原文';
    case 'thinking-type':
      return '关发 disabled，低中高都发 enabled';
    case 'model-switch':
      return config.thinkingModel
        ? `关用「${config.model}」，低中高换成「${config.thinkingModel}」，会发回思考原文`
        : `还没填开思考用的模型名，低中高也用「${config.model}」`;
    default:
      return '什么都不发';
  }
}

// 节点里写提示词按哪一档思考；模型配置的写法是「不支持」时是 null，档位对它不起作用
export function chatThinkingLevel(config: Pick<ModelConfig, 'thinkingStyle'> | undefined, settings: ThinkingSettings): ThinkingLevel | null {
  if (!config || config.thinkingStyle === 'none') return null;
  return thinkingLevelFor(settings, 'chat');
}
