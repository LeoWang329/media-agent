import type { TagInfo, TagUpdateEvent } from '@media-agent/shared';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { HttpError } from '../httpError';
import { csvRow } from './csv';
import { forgetLibrary, loadLibrary, tagsDir } from './library';

// 从哪下：Danbooru 官方接口和中文对照的仓库；测试换成假的地址、不等待
export type TagSources = { danbooru: string; zh: string; pageDelayMs: number };

export const DEFAULT_TAG_SOURCES: TagSources = {
  danbooru: 'https://danbooru.donmai.us',
  zh: 'https://raw.githubusercontent.com/amenorira/danbooru-tags-data-zh/main',
  pageDelayMs: 500,
};

const ZH_FILES = ['tags/artist.csv', 'tags/character.csv', 'tags/copyright.csv', 'tags/general.csv', 'tags/meta.csv', 'LICENSE'];
const HEADERS = { 'User-Agent': 'media-agent' };

type TagRow = { id: number; name: string; post_count: number; category: number; is_deprecated: boolean };
const TAG_FIELDS = 'id,name,post_count,category,is_deprecated';

// 正在更新时的开关，设置里点「停止更新」用它
let running: AbortController | null = null;

export const tagUpdateRunning = () => running !== null;

export class TagUpdateStopped extends Error {}

// 停在正在下的这一页，已经下的扔掉，旧的不动
export const stopTagUpdate = () => running?.abort();

// 照仓库快照的做法重新下，全部下完才整体换掉工作文件夹里的 tags/；中途失败旧的不动，见 docs/dev-plan.md 5.13
export async function updateTagLibrary(work: string, sources: TagSources, onProgress: (event: TagUpdateEvent) => void): Promise<TagInfo> {
  if (running) throw new HttpError(409, '词库正在更新，等这一次下完');
  const controller = new AbortController();
  running = controller;
  const { signal } = controller;
  const dir = tagsDir(work);
  const fresh = `${dir}.new-${randomUUID()}`;
  try {
    await fs.mkdir(path.join(fresh, 'zh'), { recursive: true });

    // 用过 50 次以上的，再加上全部已废弃的：Danbooru 撤了的标签（比如 bangs）现在多是 0 次，底模多半还认得
    const tags = await step('下标签', async () => {
      const onPage = pageCounter('tags', onProgress);
      const used = await pages<TagRow>(sources, signal, 'tags.json', { 'search[post_count]': '>50', only: TAG_FIELDS }, onPage);
      const deprecated = await pages<TagRow>(sources, signal, 'tags.json', { 'search[is_deprecated]': 'true', only: TAG_FIELDS }, onPage);
      const names = new Set(used.map((t) => t.name));
      return [...used, ...deprecated.filter((t) => !names.has(t.name))];
    });
    tags.sort((a, b) => b.post_count - a.post_count || a.name.localeCompare(b.name));
    const tagRows = tags.map((t) => csvRow([t.name, t.category, t.post_count, t.is_deprecated ? 1 : 0]));
    await fs.writeFile(path.join(fresh, 'tags.csv'), [csvRow(['tag', 'category', 'count', 'deprecated']), ...tagRows, ''].join('\n'));

    const aliases = await step('下别名', () =>
      pages<{ id: number; antecedent_name: string; consequent_name: string }>(
        sources,
        signal,
        'tag_aliases.json',
        { 'search[status]': 'active', only: 'id,antecedent_name,consequent_name' },
        pageCounter('aliases', onProgress),
      ),
    );
    aliases.sort((a, b) => a.consequent_name.localeCompare(b.consequent_name) || a.antecedent_name.localeCompare(b.antecedent_name));
    const aliasRows = aliases.map((a) => csvRow([a.antecedent_name, a.consequent_name]));
    await fs.writeFile(path.join(fresh, 'aliases.csv'), [csvRow(['alias', 'tag']), ...aliasRows, ''].join('\n'));

    await step('下中文对照', async () => {
      for (const [index, file] of ZH_FILES.entries()) {
        const res = await fetch(`${sources.zh}/${file}`, { headers: HEADERS, signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
        if (!res.ok) throw new Error(`${file}：HTTP ${res.status}`);
        await fs.writeFile(path.join(fresh, 'zh', path.basename(file)), Buffer.from(await res.arrayBuffer()));
        onProgress({ type: 'progress', step: 'zh', file: index + 1, files: ZH_FILES.length });
      }
    });

    const today = new Date();
    const updatedAt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await fs.writeFile(path.join(fresh, 'info.json'), JSON.stringify({ updatedAt }, null, 2));

    // 换掉旧的：先挪开，新的改名过去，再删旧的；新的没换上就把旧的挪回来
    const old = `${dir}.old-${randomUUID()}`;
    const moved = await fs.rename(dir, old).then(
      () => true,
      (err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
        return false;
      },
    );
    try {
      await fs.rename(fresh, dir);
    } catch (err) {
      if (moved) await fs.rename(old, dir);
      throw err;
    }
    await fs.rm(old, { recursive: true, force: true });
    forgetLibrary(work);
    return (await loadLibrary(work)).info;
  } catch (err) {
    await fs.rm(fresh, { recursive: true, force: true });
    throw signal.aborted ? new TagUpdateStopped() : err;
  } finally {
    running = null;
  }
}

// 出错时说清是哪一步
async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw new Error(`${name}时出错：${(err as Error).message}`);
  }
}

// 这一步翻到第几页、一共下了多少条，推给前端；一步里查好几次的，页数和条数接着往下数
function pageCounter(name: 'tags' | 'aliases', onProgress: (event: TagUpdateEvent) => void): (rows: number) => void {
  let page = 0;
  let total = 0;
  return (rows) => onProgress({ type: 'progress', step: name, page: (page += 1), rows: (total += rows) });
}

// 按 id 翻页：page=a<上一页最大的 id>，每页 1000 条，翻到返回空为止；一页一页按顺序请求。onPage 收到这一页有几条
async function pages<T extends { id: number }>(
  sources: TagSources,
  signal: AbortSignal,
  resource: string,
  search: Record<string, string>,
  onPage: (rows: number) => void,
): Promise<T[]> {
  const rows: T[] = [];
  let after = 0;
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ ...search, limit: '1000', page: `a${after}` });
    const res = await fetch(`${sources.danbooru}/${resource}?${query}`, { headers: HEADERS, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
    if (!res.ok) throw new Error(`第 ${page} 页：HTTP ${res.status}`);
    const batch = (await res.json()) as T[];
    if (!batch.length) return rows;
    rows.push(...batch);
    after = Math.max(...batch.map((row) => row.id));
    onPage(batch.length);
    if (sources.pageDelayMs) await sleep(sources.pageDelayMs, undefined, { signal });
  }
}
