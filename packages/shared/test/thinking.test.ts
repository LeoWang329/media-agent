import { describe, expect, it } from 'vitest';
import { DEFAULT_THINKING, thinkingLevelFor, thinkingOn, thinkingRequest, type ThinkingLevel, type ThinkingStyle } from '../src';

const config = (thinkingStyle: ThinkingStyle, thinkingModel = '') => ({ model: 'base-model', thinkingStyle, thinkingModel });
const levels: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];
const each = (style: ThinkingStyle, thinkingModel = '') => levels.map((level) => thinkingRequest(config(style, thinkingModel), level));

describe('思考档位换成请求参数', () => {
  it('不支持：什么都不发', () => {
    expect(each('none')).toEqual(levels.map(() => ({ model: 'base-model', params: {} })));
  });

  it('reasoning_effort：关也发 low，其余照档位发', () => {
    expect(each('reasoning-effort').map((r) => r.params)).toEqual([
      { reasoning_effort: 'low' },
      { reasoning_effort: 'low' },
      { reasoning_effort: 'medium' },
      { reasoning_effort: 'high' },
    ]);
  });

  it('enable_thinking：关发 false；低中带思考预算，高不限', () => {
    expect(each('enable-thinking').map((r) => r.params)).toEqual([
      { enable_thinking: false },
      { enable_thinking: true, thinking_budget: 2000 },
      { enable_thinking: true, thinking_budget: 8000 },
      { enable_thinking: true },
    ]);
  });

  it('thinking.type：只能开关，低中高都是 enabled', () => {
    expect(each('thinking-type').map((r) => r.params)).toEqual([
      { thinking: { type: 'disabled' } },
      { thinking: { type: 'enabled' } },
      { thinking: { type: 'enabled' } },
      { thinking: { type: 'enabled' } },
    ]);
  });

  it('换模型名：开思考时换成开思考用的模型名，没填就不换', () => {
    expect(each('model-switch', 'deepseek-reasoner').map((r) => r.model)).toEqual(['base-model', 'deepseek-reasoner', 'deepseek-reasoner', 'deepseek-reasoner']);
    expect(each('model-switch').map((r) => r.model)).toEqual(levels.map(() => 'base-model'));
    expect(each('model-switch', 'deepseek-reasoner').every((r) => Object.keys(r.params).length === 0)).toBe(true);
  });
});

describe('各用途的档位', () => {
  it('默认写提示词跟总档位，翻译和转标签关；单独选了的不跟总档位', () => {
    const settings = { ...DEFAULT_THINKING, level: 'high' as const };
    expect(thinkingLevelFor(settings, 'chat')).toBe('high');
    expect(thinkingLevelFor(settings, 'translate')).toBe('off');
    expect(thinkingLevelFor(settings, 'tagging')).toBe('off');
    expect(thinkingLevelFor({ ...settings, chat: 'low', translate: 'follow' }, 'chat')).toBe('low');
    expect(thinkingLevelFor({ ...settings, chat: 'low', translate: 'follow' }, 'translate')).toBe('high');
  });

  it('写法是不支持时，档位开着也不算思考', () => {
    expect(thinkingOn({ thinkingStyle: 'none' }, 'high')).toBe(false);
    expect(thinkingOn({ thinkingStyle: 'enable-thinking' }, 'off')).toBe(false);
    expect(thinkingOn({ thinkingStyle: 'enable-thinking' }, 'low')).toBe(true);
  });
});
