import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../httpError';
import { trashName, writeTextAtomic } from './jsonFile';

// 程序固定附加的格式要求只维护 docs/prompts/format-requirement.md 这一份
const FORMAT_REQUIREMENT_DOC = fileURLToPath(new URL('../../../../docs/prompts/format-requirement.md', import.meta.url));

// 文件名能用的名字：不以点或空格开头结尾，不含 Windows 文件名不允许的字符
const PROMPT_NAME = /^(?![.\s])[^\\/:*?"<>|\r\n]{1,80}(?<![.\s])$/;

const promptsDir = (work: string) => path.join(work, 'prompts');

export function promptFile(work: string, name: string): string {
  if (!PROMPT_NAME.test(name)) throw new HttpError(400, '名字不能为空，不能以点或空格开头结尾，不能含 \\ / : * ? " < > |');
  return path.join(promptsDir(work), `${name}.md`);
}

export async function listPrompts(work: string): Promise<string[]> {
  const entries = await fs.readdir(promptsDir(work), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -3))
    .sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b, 'zh-CN')));
}

export async function readPrompt(work: string, name: string): Promise<string> {
  try {
    return await fs.readFile(promptFile(work, name), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, `找不到系统提示词「${name}」`);
    throw err;
  }
}

export async function savePrompt(work: string, name: string, text: string): Promise<void> {
  await readPrompt(work, name);
  await writeTextAtomic(promptFile(work, name), text);
}

export async function createPrompt(work: string, name: string, text: string): Promise<void> {
  try {
    await fs.writeFile(promptFile(work, name), text, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new HttpError(409, `已经有叫「${name}」的系统提示词`);
    throw err;
  }
}

export async function trashPrompt(work: string, name: string): Promise<void> {
  await readPrompt(work, name);
  await fs.rename(promptFile(work, name), path.join(work, '.trash', `${trashName('prompt', name)}.md`));
}

// 发送前读一次系统提示词，按内容 hash 在 .history 里存一份，回复里记下用的是哪一版
export async function snapshotPrompt(work: string, name: string): Promise<{ text: string; hash: string }> {
  const text = await readPrompt(work, name);
  const hash = createHash('sha256').update(text).digest('hex');
  const file = path.join(promptsDir(work), '.history', `${name}-${hash.slice(0, 12)}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, text, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return { text, hash };
}

export async function readFormatRequirement(): Promise<string> {
  const lines = (await fs.readFile(FORMAT_REQUIREMENT_DOC, 'utf8')).split(/\r?\n/);
  return lines.slice(lines.findIndex((line) => line.trim() === '---') + 1).join('\n').trim();
}
