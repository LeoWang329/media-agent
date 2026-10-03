import { tagKey, type TagInfo } from '@media-agent/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv';

// 仓库里的词库快照，工作文件夹里还没有词库时从这里复制，见 docs/dev-plan.md 5.13
const SNAPSHOT = fileURLToPath(new URL('../../../../data/danbooru/', import.meta.url));

export const tagsDir = (work: string) => path.join(work, 'tags');

export type TagEntry = {
  tag: string;
  category: number;
  count: number;
  deprecated: boolean;
  zh: string;
  zhAliases: string[]; // 中文对照里的常用叫法：日文原名、社区叫法、英文旧写法
  notes: string;
};

export type TagLibrary = {
  entries: TagEntry[]; // 按使用次数从多到少
  byTag: Map<string, TagEntry>;
  aliases: Map<string, string>; // 官方别名 → 标准名，只留指向词库里有的标签的
  near: { key: string; tag: string }[]; // 找最接近的写法用：标签名、官方别名、对照表里的英文叫法
  info: TagInfo;
};

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
export const hasCjk = (text: string) => CJK.test(text);

const libraries = new Map<string, Promise<TagLibrary>>();

// 词库读一次留在内存里；更新词库后调 forgetLibrary 重新读
export function loadLibrary(work: string): Promise<TagLibrary> {
  const dir = tagsDir(work);
  let library = libraries.get(dir);
  if (!library) {
    library = ensureTags(dir).then(() => readLibrary(dir));
    library.catch(() => libraries.delete(dir));
    libraries.set(dir, library);
  }
  return library;
}

export function forgetLibrary(work: string): void {
  libraries.delete(tagsDir(work));
}

// 工作文件夹里还没有词库：从仓库复制一份，已有的不覆盖
async function ensureTags(dir: string): Promise<void> {
  const exists = await fs.stat(path.join(dir, 'tags.csv')).then(
    () => true,
    () => false,
  );
  if (!exists) await fs.cp(SNAPSHOT, dir, { recursive: true, force: false, errorOnExist: false });
}

async function readCsv(file: string): Promise<string[][]> {
  return parseCsv(await fs.readFile(file, 'utf8')).slice(1);
}

async function readLibrary(dir: string): Promise<TagLibrary> {
  const byTag = new Map<string, TagEntry>();
  for (const [tag, category, count, deprecated] of await readCsv(path.join(dir, 'tags.csv'))) {
    if (!tag || count === undefined) continue;
    byTag.set(tag, { tag, category: Number(category), count: Number(count), deprecated: deprecated === '1', zh: '', zhAliases: [], notes: '' });
  }

  const zhDir = path.join(dir, 'zh');
  const zhFiles = (await fs.readdir(zhDir).catch(() => [])).filter((name) => name.endsWith('.csv'));
  for (const name of zhFiles) {
    for (const [tag, , aliases, zh, , notes] of await readCsv(path.join(zhDir, name))) {
      const entry = byTag.get(tag);
      if (!entry) continue;
      entry.zh = zh ?? '';
      entry.zhAliases = (aliases ?? '').split('|').filter(Boolean);
      entry.notes = notes ?? '';
    }
  }

  const aliases = new Map<string, string>();
  for (const [alias, tag] of await readCsv(path.join(dir, 'aliases.csv'))) {
    if (alias && byTag.has(tag)) aliases.set(alias, tag);
  }

  const entries = [...byTag.values()].sort((a, b) => b.count - a.count);
  const near = new Map<string, string>();
  for (const entry of entries) {
    near.set(entry.tag, entry.tag);
    for (const alias of entry.zhAliases) if (!hasCjk(alias) && !near.has(tagKey(alias))) near.set(tagKey(alias), entry.tag);
  }
  for (const [alias, tag] of aliases) if (!near.has(alias)) near.set(alias, tag);

  const updatedAt = ((await fs.readFile(path.join(dir, 'info.json'), 'utf8').then(JSON.parse).catch(() => null)) as { updatedAt?: string } | null)?.updatedAt;
  const live = entries.filter((entry) => !entry.deprecated);
  const withZh = live.filter((entry) => hasCjk(entry.zh));
  const uses = (list: TagEntry[]) => list.reduce((sum, entry) => sum + entry.count, 0);
  return {
    entries,
    byTag,
    aliases,
    near: [...near].map(([key, tag]) => ({ key, tag })),
    info: { updatedAt: updatedAt ?? null, tags: live.length, withZh: withZh.length, zhByUse: uses(live) ? uses(withZh) / uses(live) : 0, aliases: aliases.size },
  };
}
