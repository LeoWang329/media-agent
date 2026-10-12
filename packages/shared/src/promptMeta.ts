import { FAMILIES } from './imageDefaults';
import type { PromptMeta } from './types';

// 系统提示词开头用 --- 上下围起来的说明段：写着「用途: 生图」「用途: 编辑」或「用途: 视频」。
// 「底模」是 IL 或 Pony（生图才有）；「功能」是图像编辑节点的四种功能之一（编辑才有）。
// 冒号中英文都行；没有说明段的是视频提示词。见 docs/dev-plan.md 5.14、5.36
const USES: Record<string, PromptMeta['use']> = { 生图: 'image', 编辑: 'edit', 视频: 'video' };

export function parsePromptMeta(text: string): PromptMeta {
  const match = text.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { use: 'video', family: null, fn: null, body: text };
  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/);
    if (pair) fields.set(pair[1], pair[2]);
  }
  const family = FAMILIES.find((name) => name.toLowerCase() === fields.get('底模')?.toLowerCase()) ?? null;
  return {
    use: USES[fields.get('用途') ?? ''] ?? 'video',
    family,
    fn: fields.get('功能') || null,
    body: text.slice(match[0].length),
  };
}
