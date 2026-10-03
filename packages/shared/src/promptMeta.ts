import { FAMILIES } from './imageDefaults';
import type { PromptMeta } from './types';

// 系统提示词开头用 --- 上下围起来的说明段：写着「用途: 生图」的是生图提示词，「底模」是 IL 或 Pony，见 docs/dev-plan.md 5.14。
// 冒号中英文都行；没有说明段的是视频提示词
export function parsePromptMeta(text: string): PromptMeta {
  const match = text.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { use: 'video', family: null, body: text };
  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/);
    if (pair) fields.set(pair[1], pair[2]);
  }
  const family = FAMILIES.find((name) => name.toLowerCase() === fields.get('底模')?.toLowerCase()) ?? null;
  return { use: fields.get('用途') === '生图' ? 'image' : 'video', family, body: text.slice(match[0].length) };
}
