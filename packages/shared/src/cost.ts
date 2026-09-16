import type { Message, ModelPricing } from './types';

export const DEFAULT_PRICING: ModelPricing = { currency: '¥', input: 0, output: 0, cached: 0 };

const PER_TOKENS = 1_000_000;

// 一条回复花了多少钱：命中缓存的那部分输入按缓存价算，其余输入按输入价。三个价都是 0 当作没填，返回 null
export function messageCost(usage: NonNullable<Message['usage']>, pricing: ModelPricing): number | null {
  if (!pricing.input && !pricing.output && !pricing.cached) return null;
  const cached = Math.min(Math.max(usage.cachedTokens ?? 0, 0), usage.promptTokens);
  const input = (usage.promptTokens - cached) * pricing.input + cached * pricing.cached;
  return (input + usage.completionTokens * pricing.output) / PER_TOKENS;
}

// 一次几分钱的时候要看得见，贵了就不用那么多位
export function formatCost(amount: number, currency: string): string {
  return `${currency}${amount < 1 ? amount.toFixed(4) : amount.toFixed(2)}`;
}
