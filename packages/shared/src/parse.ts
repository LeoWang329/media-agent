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
const OPEN = /^\s*<prompt(?:\s+label="([^"]*)")?\s*>\s*$/;
const CLOSE = /^\s*<\/prompt>\s*$/;
const SUMMARY_LINE = /^\s*summary\s*:/i;
const SECTION_LINE = /^\s*[a-z][a-z_]*\s*:/i;

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
    const open = lines[i].match(OPEN);
    if (!open) {
      plain.push(lines[i]);
      continue;
    }
    let end = i + 1;
    while (end < lines.length && !CLOSE.test(lines[end])) end += 1;
    flushPlain();
    const body = trimBlankLines(lines.slice(i + 1, end)).join('\n');
    const closed = end < lines.length;
    const label = open[1] || undefined;
    const box = { index: prompts.length, ...(label !== undefined && { label }), text: body, summary: extractSummary(body) };
    segments.push({ type: 'prompt', ...box, closed });
    if (closed) prompts.push(box);
    i = end;
  }
  flushPlain();

  return { ...(title !== undefined && { title }), prompts, segments };
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
