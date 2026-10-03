import type { ModelConfig, ThinkingLevel, ThinkingSettings, ThinkingStyle, ThinkingUse } from './types';

export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];
export const THINKING_STYLES: ThinkingStyle[] = ['none', 'reasoning-effort', 'enable-thinking', 'thinking-type', 'model-switch'];
export const THINKING_USES: ThinkingUse[] = ['chat', 'translate', 'tagging'];

// 总档位默认关；写提示词跟总档位，翻译和转标签用不着思考，默认关
export const DEFAULT_THINKING: ThinkingSettings = { level: 'off', chat: 'follow', translate: 'off', tagging: 'off' };

// 新建的模型配置：不支持思考，什么都不发
export const DEFAULT_MODEL_THINKING: Pick<ModelConfig, 'thinkingStyle' | 'thinkingModel'> = { thinkingStyle: 'none', thinkingModel: '' };

export function thinkingLevelFor(settings: ThinkingSettings, use: ThinkingUse): ThinkingLevel {
  const own = settings[use];
  return own === 'follow' ? settings.level : own;
}

// 这一档会不会让模型思考；写法是「不支持」的，档位不起作用
export const thinkingOn = (config: Pick<ModelConfig, 'thinkingStyle'>, level: ThinkingLevel) => level !== 'off' && config.thinkingStyle !== 'none';

// 通义的思考预算：低、中按 token 数限，高不限
const BUDGET = { low: 2000, medium: 8000 };

// 按模型配置的思考写法，把档位换成请求里用的模型名和要加的参数，见 docs/dev-plan.md 5.12
export function thinkingRequest(
  config: Pick<ModelConfig, 'model' | 'thinkingStyle' | 'thinkingModel'>,
  level: ThinkingLevel,
): { model: string; params: Record<string, unknown> } {
  const { model } = config;
  switch (config.thinkingStyle) {
    case 'reasoning-effort':
      // 多数家关不掉思考，关就发各家都认的最低一档
      return { model, params: { reasoning_effort: level === 'off' ? 'low' : level } };
    case 'enable-thinking':
      if (level === 'off') return { model, params: { enable_thinking: false } };
      return { model, params: { enable_thinking: true, ...(level !== 'high' && { thinking_budget: BUDGET[level] }) } };
    case 'thinking-type':
      return { model, params: { thinking: { type: level === 'off' ? 'disabled' : 'enabled' } } };
    case 'model-switch':
      return { model: level !== 'off' && config.thinkingModel ? config.thinkingModel : model, params: {} };
    default:
      return { model, params: {} };
  }
}
