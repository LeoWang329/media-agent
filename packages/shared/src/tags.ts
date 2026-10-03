// 生图提示词里的标签：拆开、找词库里的写法、拼回去，见 docs/dev-plan.md 5.15
import type { TagCheck } from './types';

// 颜文字标签：写进提示词时保留下划线
export const EMOTICON_TAGS = ['^_^', '>_<', '@_@', '+_+', '=_=', 'o_o', '|_|', '0_0', 'u_u', '>_o', '._.', 'x_x', '<o>_<o>', '3_3', '6_9'];

// raw 是框里原样写的这一项，name 是去掉加权括号后的标签（括号转义还在），weight 不加权是 1
export type TagItem = { raw: string; name: string; weight: number };

// 词库里的写法：小写，空格和下划线当成一样，去掉括号前的 \ 转义
export function tagKey(text: string): string {
  return text.trim().toLowerCase().replace(/\\([()])/g, '$1').replace(/\s+/g, '_');
}

// 按英文逗号和换行拆；括号里的逗号不拆，\( \) 是标签名里的括号，不算加权
export function splitTags(text: string): TagItem[] {
  const items: TagItem[] = [];
  const push = (piece: string) => {
    const raw = piece.trim();
    if (raw) items.push({ raw, ...unwrap(raw) });
  };
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') i += 1;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if ((ch === ',' || ch === '\n') && depth === 0) {
      push(text.slice(start, i));
      start = i + 1;
    }
  }
  push(text.slice(start));
  return items;
}

const round = (weight: number) => Math.round(weight * 100) / 100;

// 去掉外层的加权括号：(tag:1.2) 是 1.2，(tag) 是 1.1，可以套几层
function unwrap(raw: string): { name: string; weight: number } {
  if (!wrapped(raw)) return { name: raw, weight: 1 };
  const inner = raw.slice(1, -1).trim();
  const explicit = inner.match(/^([\s\S]*):\s*(\d+(?:\.\d+)?)$/);
  const nested = unwrap(explicit ? explicit[1].trim() : inner);
  return { name: nested.name, weight: round(nested.weight * (explicit ? Number(explicit[2]) : 1.1)) };
}

// 整项被一对没转义的括号包着
function wrapped(raw: string): boolean {
  if (!raw.startsWith('(') || !raw.endsWith(')') || raw.endsWith('\\)')) return false;
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\\') i += 1;
    else if (raw[i] === '(') depth += 1;
    else if (raw[i] === ')') {
      depth -= 1;
      if (depth === 0 && i < raw.length - 1) return false;
    }
  }
  return depth === 0;
}

// 显示用的写法：词库里的标准名下划线换成空格（颜文字除外）；框里原样写的去掉括号前的转义
export const displayTag = (tag: string) => (EMOTICON_TAGS.includes(tag) ? tag : tag.replace(/_/g, ' '));
export const unescapeTag = (name: string) => name.replace(/\\([()])/g, '$1');

// 一项写回框里：name 照原样（括号转义还在），权重不是 1 写成 (name:1.2)
export const weightedTag = (name: string, weight: number) => (weight === 1 ? name : `(${name}:${round(weight)})`);

// 词库里的标准名写进提示词：下划线换成空格（颜文字除外），括号转义，权重不是 1 写成 (tag:1.2)
export function formatTag(tag: string, weight = 1): string {
  return weightedTag(displayTag(tag).replace(/[()]/g, (paren) => `\\${paren}`), weight);
}

// 拼成一串：有标准名的按标准名写，不认识的原样照写
export function composeTags(items: { raw: string; tag?: string; weight: number }[]): string {
  return items.map((item) => (item.tag ? formatTag(item.tag, item.weight) : item.raw)).join(', ');
}

// 按校验结果拼：词库里的和别名换成标准写法；不认识的、系列固定开头和评级词里的词（校验结果没有 tag）原样照写
export function composeChecked(items: TagItem[], checks: TagCheck[]): string {
  return composeTags(items.map((item, i) => ({ ...item, tag: checks[i]?.status === 'unknown' ? undefined : checks[i]?.tag })));
}
