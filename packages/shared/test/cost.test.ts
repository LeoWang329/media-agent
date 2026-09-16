import { describe, expect, it } from 'vitest';
import { formatCost, messageCost, type ModelPricing } from '../src';

const pricing: ModelPricing = { currency: '¥', input: 3, output: 15, cached: 0.3 };

describe('messageCost', () => {
  it('三个价都是 0 当作没填', () => {
    expect(messageCost({ promptTokens: 1000, completionTokens: 500 }, { currency: '¥', input: 0, output: 0, cached: 0 })).toBe(null);
  });

  it('没命中缓存时输入按输入价、输出按输出价', () => {
    expect(messageCost({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, pricing)).toBe(18);
  });

  it('命中缓存的那部分按缓存价', () => {
    // 20 万按缓存价 0.3、80 万按输入价 3，加上 10 万输出
    expect(messageCost({ promptTokens: 1_000_000, completionTokens: 100_000, cachedTokens: 200_000 }, pricing)).toBeCloseTo(0.06 + 2.4 + 1.5, 10);
  });

  it('接口报的命中数超过输入总数时只按输入总数算', () => {
    expect(messageCost({ promptTokens: 1000, completionTokens: 0, cachedTokens: 9999 }, pricing)).toBeCloseTo(1000 * 0.3e-6, 10);
  });

  it('只填了输出价也能算', () => {
    expect(messageCost({ promptTokens: 1000, completionTokens: 1_000_000 }, { currency: '$', input: 0, output: 2, cached: 0 })).toBe(2);
  });
});

describe('formatCost', () => {
  it('不到一块钱显示四位小数', () => {
    expect(formatCost(0.00031, '¥')).toBe('¥0.0003');
  });

  it('超过一块钱显示两位小数', () => {
    expect(formatCost(12.345, '$')).toBe('$12.35');
  });
});
