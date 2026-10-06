import { TURN_LIMITS, type TurnLimit } from '@media-agent/shared';

// 「最多带几轮」的几个选项和写法，见 docs/dev-plan.md 5.4
export const TURN_LIMIT_CHOICES: TurnLimit[] = ['all', ...TURN_LIMITS];

export const turnLimitLabel = (limit: TurnLimit) => (limit === 'all' ? '全部带' : `最近 ${limit} 轮`);

// 下拉的值是文字，转回来
export const turnLimitOf = (value: string): TurnLimit => (value === 'all' ? 'all' : Number(value));
