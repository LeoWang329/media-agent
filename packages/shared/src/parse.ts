import type { PromptBox } from './types';

export type ReplySegment =
  | { type: 'text'; text: string }
  | { type: 'prompt'; index: number; label?: string; text: string; summary: string; closed: boolean };

export type ParsedReply = {
  title?: string;
  prompts: PromptBox[]; // 只含收到了 </prompt> 的框
  segments: ReplySegment[]; // 按顺序的正文和框，最后一个框可能还没收完
};

const TITLE = /<title>([\s\S]*?)<\/title>/;
// 开始标签要在行首，结束标签在哪都认。模型有时把正文和标签写在同一行，也算进框里
const OPEN = /^(\s*<prompt(?:\s+label="([^"]*)")?\s*>)\s*(.*)$/;
const CLOSE = /^(.*?)\s*<\/prompt>\s*(.*)$/;
const SUMMARY_LINE = /^\s*summary\s*:/i;
const SECTION_LINE = /^\s*[a-z][a-z_]*\s*:/i;

type Box = { tag: string; label: string | undefined; lines: string[]; end: number; closed: boolean; after: string };

// 第 start 行是开始标签时，往下找到结束标签，取出框里的各行（去掉首尾空行）。
// 开始标签后面接着的文字算框里第一行，结束标签前面的算最后一行、后面的算框外的话；end 是结束标签所在的行
function readBox(lines: string[], start: number): Box | null {
  const open = lines[start].match(OPEN);
  if (!open) return null;
  const tag = open[1];
  const label = open[2] || undefined;
  const body: string[] = [];
  let line = open[3];
  for (let end = start; ; ) {
    const close = line.match(CLOSE);
    if (close) return { tag, label, lines: trimBlankLines([...body, close[1]]), end, closed: true, after: close[2] };
    body.push(line);
    end += 1;
    if (end >= lines.length) return { tag, label, lines: trimBlankLines(body), end, closed: false, after: '' };
    line = lines[end];
  }
}

export function parseReply(text: string): ParsedReply {
  const title = text.match(TITLE)?.[1].trim() || undefined;
  const lines = text.split(/\r?\n/);
  const segments: ReplySegment[] = [];
  const prompts: PromptBox[] = [];
  let plain: string[] = [];

  const flushPlain = () => {
    const cleaned = trimBlankLines(plain.join('\n').replace(new RegExp(TITLE.source, 'g'), '').split('\n')).join('\n');
    if (cleaned.trim()) segments.push({ type: 'text', text: cleaned });
    plain = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const found = readBox(lines, i);
    if (!found) {
      plain.push(lines[i]);
      continue;
    }
    flushPlain();
    const body = found.lines.join('\n');
    const box = { index: prompts.length, ...(found.label !== undefined && { label: found.label }), text: body, summary: extractSummary(body) };
    segments.push({ type: 'prompt', ...box, closed: found.closed });
    if (found.closed) prompts.push(box);
    if (found.after) plain.push(found.after);
    i = found.end;
  }
  flushPlain();

  return { ...(title !== undefined && { title }), prompts, segments };
}

// 手动改提示词：把第 index 个框里的内容换掉，其余原样；换过的框，开始、结束标签各占一行。没这个框时返回 null
export function replacePromptText(text: string, index: number, promptText: string): string | null {
  const lines = text.split(/\r?\n/);
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const box = readBox(lines, i);
    if (!box) continue;
    if (!box.closed) break; // 没收尾的框不算
    if (seen === index) {
      const after = box.after ? [box.after] : [];
      return [...lines.slice(0, i), box.tag, ...promptText.split(/\r?\n/), '</prompt>', ...after, ...lines.slice(box.end + 1)].join('\n');
    }
    seen += 1;
    i = box.end;
  }
  return null;
}

// 提示词里引用了哪几张图（上传清单用）
export function referencedPictures(text: string): number[] {
  return [...new Set([...text.matchAll(/<Picture\s+(\d+)>/gi)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

// 框里 summary: 那一段；没有就取前两行非空文字
export function extractSummary(boxText: string): string {
  const lines = boxText.split('\n');
  const start = lines.findIndex((line) => SUMMARY_LINE.test(line));
  if (start < 0) return joinLines(lines.filter((line) => line.trim()).slice(0, 2));
  const parts = [lines[start].replace(SUMMARY_LINE, '')];
  for (const line of lines.slice(start + 1)) {
    if (SECTION_LINE.test(line)) break;
    parts.push(line);
  }
  return joinLines(parts);
}

// 去掉换行拼成一行；两边都是英文或数字时补一个空格
function joinLines(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((acc, line) => (/[A-Za-z0-9]$/.test(acc) && /^[A-Za-z0-9]/.test(line) ? `${acc} ${line}` : acc + line), '');
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}
