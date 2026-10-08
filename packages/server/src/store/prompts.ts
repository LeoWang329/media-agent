import { parsePromptMeta, type FormatRequirements, type NodeKind, type PromptInfo, type PromptMeta } from '@media-agent/shared';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../httpError';
import { readJson, trashName, writeFileAtomic, writeJsonAtomic } from './jsonFile';

// 程序固定用的说明只维护 docs/prompts/ 里这几份：接在系统提示词后面的格式要求（视频、IL/Pony 标签、Krea2 段落）、翻译提示词框和中文转标签时的说明
const doc = (name: string) => fileURLToPath(new URL(`../../../../docs/prompts/${name}.md`, import.meta.url));
const FORMAT_REQUIREMENT_DOCS: Record<PromptMeta['use'], string> = { video: doc('format-requirement'), image: doc('format-requirement-image') };
const TRANSLATE_DOC = doc('translate');
const TO_TAGS_DOC = doc('to-tags');

// 文件名能用的名字：不以点或空格开头结尾，不含 Windows 文件名不允许的字符
const PROMPT_NAME = /^(?![.\s])[^\\/:*?"<>|\r\n]{1,80}(?<![.\s])$/;

// 自带的八套提示词，列表里按这个顺序排在前面：视频的五套（参考模式、图当首帧、纯文字、首尾帧、尾帧图），生图的三套（IL、Pony、Krea2）。
// 第一套是新建节点的默认。原文只维护 docs/prompts/ 里同名的那几份
export const BUILTIN_PROMPTS = ['ref2va', 'i2v', 't2v', 'fl2va', 'l2va', 'il', 'pony', 'krea2'];
export const DEFAULT_PROMPT = BUILTIN_PROMPTS[0];

const promptsDir = (work: string) => path.join(work, 'prompts');

export function promptFile(work: string, name: string): string {
  if (!PROMPT_NAME.test(name)) throw new HttpError(400, '名字不能为空，不能以点或空格开头结尾，不能含 \\ / : * ? " < > |');
  return path.join(promptsDir(work), `${name}.md`);
}

// 复制过哪些自带的提示词记在 prompts/.builtin.json：用户删掉的不再复制回来，以后新加的自带提示词复制一次。
// 没有这个文件的工作文件夹是第三批之前建的，那时复制过视频的三套
const copiedRecord = (work: string) => path.join(promptsDir(work), '.builtin.json');
const FIRST_BUILTINS = ['ref2va', 'i2v', 't2v'];

// all：选工作文件夹的时候缺哪套补哪套。已经有同名的不覆盖，用户改过的那份留着
export async function copyBuiltinPrompts(work: string, all = false): Promise<void> {
  const copied = all ? [] : ((await readJson<string[]>(copiedRecord(work))) ?? FIRST_BUILTINS);
  const missing = BUILTIN_PROMPTS.filter((name) => !copied.includes(name));
  if (!missing.length) return;
  for (const name of missing) {
    try {
      await fs.copyFile(doc(name), promptFile(work, name), fs.constants.COPYFILE_EXCL);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  await writeJsonAtomic(copiedRecord(work), BUILTIN_PROMPTS);
}

export async function listPrompts(work: string): Promise<string[]> {
  await copyBuiltinPrompts(work);
  const entries = await fs.readdir(promptsDir(work), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -3))
    .sort((a, b) => {
      const [ia, ib] = [BUILTIN_PROMPTS.indexOf(a), BUILTIN_PROMPTS.indexOf(b)];
      if (ia >= 0 || ib >= 0) return (ia < 0 ? BUILTIN_PROMPTS.length : ia) - (ib < 0 ? BUILTIN_PROMPTS.length : ib);
      return a.localeCompare(b, 'zh-CN');
    });
}

export async function readPrompt(work: string, name: string): Promise<string> {
  try {
    return await fs.readFile(promptFile(work, name), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, `找不到系统提示词「${name}」`);
    throw err;
  }
}

// 列表里每套标出是视频用的还是生图用的、哪个系列
export async function listPromptInfos(work: string): Promise<PromptInfo[]> {
  return Promise.all(
    (await listPrompts(work)).map(async (name) => {
      const { use, family } = parsePromptMeta(await readPrompt(work, name));
      return { name, use, family };
    }),
  );
}

// 新建节点用哪套：视频节点用 ref2va，生图节点用 il；不在了用排在最前的同一种，一套都没有是 null，见 docs/dev-plan.md 5.23
export async function defaultPromptFor(work: string, kind: NodeKind): Promise<string | null> {
  const mine = (await listPromptInfos(work)).filter((info) => info.use === kind);
  const preferred = kind === 'image' ? 'il' : DEFAULT_PROMPT;
  return (mine.find((info) => info.name === preferred) ?? mine[0])?.name ?? null;
}

// 节点用的系统提示词的说明段；提示词已经不在了是 null，当视频提示词
export async function readPromptMeta(work: string, name: string): Promise<PromptMeta | null> {
  try {
    return parsePromptMeta(await readPrompt(work, name));
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

// 一次读很多节点的卡片时用：同一套提示词只读一次
export function promptMetaReader(work: string): (name: string) => Promise<PromptMeta | null> {
  const cache = new Map<string, Promise<PromptMeta | null>>();
  return (name) => {
    if (!cache.has(name)) cache.set(name, readPromptMeta(work, name));
    return cache.get(name)!;
  };
}

export async function savePrompt(work: string, name: string, text: string): Promise<void> {
  await readPrompt(work, name);
  await writeFileAtomic(promptFile(work, name), text);
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

// 回复角落里点提示词名，看的是发这条时存下的那一版
export async function readPromptVersion(work: string, name: string, hash: string): Promise<string> {
  if (!/^[0-9a-f]{12,64}$/i.test(hash)) throw new HttpError(400, '版本号格式不对');
  promptFile(work, name);
  try {
    return await fs.readFile(path.join(promptsDir(work), '.history', `${name}-${hash.slice(0, 12)}.md`), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, '找不到这一版系统提示词');
    throw err;
  }
}

// 说明文件里「---」以下才是发给模型的
async function textBelowRule(file: string): Promise<string> {
  const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/);
  return lines.slice(lines.findIndex((line) => line.trim() === '---') + 1).join('\n').trim();
}

export const readFormatRequirement = (use: PromptMeta['use'], family?: PromptMeta['family']) =>
  textBelowRule(family === 'Krea2' ? doc('format-requirement-krea2') : FORMAT_REQUIREMENT_DOCS[use]);
export const readFormatRequirements = async (): Promise<FormatRequirements> => ({
  video: await readFormatRequirement('video'),
  image: await readFormatRequirement('image'),
  krea2: await readFormatRequirement('image', 'Krea2'),
});
export const readTranslateInstructions = () => textBelowRule(TRANSLATE_DOC);
export const readToTagsInstructions = () => textBelowRule(TO_TAGS_DOC);
