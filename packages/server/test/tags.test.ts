import type { TagCheck, TagHit, TagInfo, TagUpdateEvent } from '@media-agent/shared';
import express from 'express';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { close, listen, sleep, startTestApp, urlOf, type TestApp } from './helpers';

// 小词库：几十行，覆盖开头和中间、中文名和常用叫法、别名、已废弃
const ZH_HEADER = '﻿tag,category,aliases,zh,count,notes';
const LIBRARY: Record<string, string> = {
  'tags.csv': `tag,category,count,deprecated
1girl,0,8000000,0
long_hair,0,6000000,0
smile,0,4000000,0
blonde_hair,0,2000000,0
hair_ornament,0,1500000,0
blue_hair,0,1200000,0
hatsune_miku,4,900000,0
hair_flower,0,500000,0
thick_eyebrows,0,300000,0
^_^,0,150000,0
eyebrows,0,38000,1
masterpiece,0,0,1
`,
  'aliases.csv': `alias,tag
blond_hair,blonde_hair
yellow_hair,blonde_hair
eyebrow,eyebrows
not_here,missing_tag
`,
  'zh/general.csv': `${ZH_HEADER}
1girl,0,1girls|女孩|少女,一个女孩,8314081,图中主要或只有一位女性角色
long_hair,0,长髪,长发,6134076,从肩长到腰长的头发
smile,0,:)|笑容,微笑,4120285,"嘴角上扬,表示愉悦"
blonde_hair,0,blond|gold_hair|金毛|金髪,金发,2147014,颜色为金黄或淡黄的头发
hair_ornament,0,,发饰,1500000,
blue_hair,0,,蓝发,1200000,
hair_flower,0,,发间花,500000,
thick_eyebrows,0,,粗眉毛,300000,
eyebrows,0,,眉毛,38000,
`,
  'zh/character.csv': `${ZH_HEADER}
hatsune_miku,4,初音|ミク,初音未来,900000,
`,
  'info.json': '{ "updatedAt": "2026-09-01" }',
};
// 有中文的 9 个用过 2440 万次，没废弃的一共 2455 万次；别名 not_here 指向的标签不在词库里，不算
const LIBRARY_INFO: TagInfo = { updatedAt: '2026-09-01', tags: 10, withZh: 9, zhByUse: 24_400_000 / 24_550_000, aliases: 3 };

// 假的 Danbooru 接口和中文对照仓库；page 是 a<上一页最大的 id>
const TAG_PAGES: Record<string, object[]> = {
  a0: [
    { id: 3, name: 'long_hair', post_count: 7000000, category: 0, is_deprecated: false },
    { id: 7, name: 'new_tag', post_count: 60, category: 0, is_deprecated: false },
  ],
  a7: [{ id: 9, name: 'old_tag', post_count: 100, category: 0, is_deprecated: true }],
};
// 已废弃的另查一次：bangs 现在 0 次；old_tag 第一次已经下过了
const DEPRECATED_PAGES: Record<string, object[]> = {
  a0: [
    { id: 5, name: 'bangs', post_count: 0, category: 0, is_deprecated: true },
    { id: 9, name: 'old_tag', post_count: 100, category: 0, is_deprecated: true },
  ],
};
const ALIAS_PAGES: Record<string, object[]> = { a0: [{ id: 4, antecedent_name: 'longer_hair', consequent_name: 'long_hair' }] };
const NEW_GENERAL = `${ZH_HEADER}\nnew_tag,0,,新标签,60,\n`;

let t: TestApp;
let fake: Server;
let requests: { path: string; query: unknown; agent?: string }[];
let failAliases: boolean;
let hold: Promise<void> | null;

beforeEach(async () => {
  requests = [];
  failAliases = false;
  hold = null;
  const app = express();
  app.use((req, _res, next) => {
    requests.push({ path: req.path, query: req.query, agent: req.get('User-Agent') });
    next();
  });
  app.get('/tags.json', async (req, res) => {
    if (hold) await hold;
    const deprecated = req.query['search[is_deprecated]'] === 'true';
    res.json((deprecated ? DEPRECATED_PAGES : TAG_PAGES)[req.query.page as string] ?? []);
  });
  app.get('/tag_aliases.json', (req, res) => {
    if (failAliases) res.status(500).end();
    else res.json(ALIAS_PAGES[req.query.page as string] ?? []);
  });
  app.get('/zh/tags/:file', (req, res) => {
    res.type('text/csv').send(req.params.file === 'general.csv' ? NEW_GENERAL : `${ZH_HEADER}\n`);
  });
  app.get('/zh/LICENSE', (_req, res) => {
    res.type('text/plain').send('MIT');
  });
  fake = await listen(app);

  t = await startTestApp({ tagSources: { danbooru: urlOf(fake), zh: `${urlOf(fake)}/zh`, pageDelayMs: 0 } });
  for (const [file, text] of Object.entries(LIBRARY)) {
    await fs.mkdir(path.dirname(path.join(t.work, 'tags', file)), { recursive: true });
    await fs.writeFile(path.join(t.work, 'tags', file), text);
  }
});

afterEach(async () => {
  await t.cleanup();
  await close(fake);
});

const search = async (q: string) => t.ok<TagHit[]>('GET', `/tags/search?q=${encodeURIComponent(q)}`);
const check = (tags: string[], family?: string) => t.ok<TagCheck[]>('POST', '/tags/check', { tags, family });

describe('搜索', () => {
  it('英文：先开头对上的，再中间对上的，同一档按使用次数；大小写和空格不论', async () => {
    expect((await search('hair')).map((hit) => hit.tag)).toEqual(['hair_ornament', 'hair_flower', 'long_hair', 'blonde_hair', 'blue_hair']);
    expect((await search('hair'))[0]).toEqual({ tag: 'hair_ornament', zh: '发饰', category: 0, count: 1500000 });
    expect((await search('Blue Hair')).map((hit) => hit.tag)).toEqual(['blue_hair']);
    expect(await search(' ')).toEqual([]);
  });

  it('英文：标签名没对上的再比官方别名，注明是哪个别名；已废弃的不出', async () => {
    expect(await search('yellow')).toEqual([{ tag: 'blonde_hair', zh: '金发', category: 0, count: 2000000, alias: 'yellow_hair' }]);
    expect((await search('eyebrow')).map((hit) => hit.tag)).toEqual(['thick_eyebrows']);
  });

  it('中文：比中文名和常用叫法，开头对上的在前；靠叫法对上的注明是哪个', async () => {
    expect((await search('发')).map((hit) => hit.tag)).toEqual(['hair_ornament', 'hair_flower', 'long_hair', 'blonde_hair', 'blue_hair']);
    expect(await search('金毛')).toEqual([{ tag: 'blonde_hair', zh: '金发', category: 0, count: 2000000, alias: '金毛' }]);
    expect((await search('ミク'))[0]).toMatchObject({ tag: 'hatsune_miku', zh: '初音未来', category: 4, alias: 'ミク' });
    expect((await search('眉毛')).map((hit) => hit.tag)).toEqual(['thick_eyebrows']);
  });
});

describe('校验', () => {
  it('认识的给标准名和中文；官方别名给标准名；不认识的给最接近的几个', async () => {
    const [known, alias, golden, phrase] = await check(['Long Hair', 'blond hair', 'golden hair', 'sitting by the window']);
    expect(known).toEqual({ input: 'Long Hair', status: 'ok', tag: 'long_hair', zh: '长发', category: 0, count: 6000000 });
    expect(alias).toMatchObject({ input: 'blond hair', status: 'alias', tag: 'blonde_hair', zh: '金发' });
    // 对照表里 blonde_hair 有个叫法是 gold_hair，和 golden_hair 差两个字母
    expect(golden.status).toBe('unknown');
    expect(golden.suggestions?.map((hit) => hit.tag)).toEqual(['blonde_hair']);
    expect(phrase).toEqual({ input: 'sitting by the window', status: 'unknown', suggestions: [] });
  });

  it('已废弃的算认识（底模多半还认得），指向它的别名换成它；搜索和候选里照旧不出', async () => {
    const [deprecated, alias, gone] = await check(['eyebrows', 'eyebrow', 'masterpiece']);
    expect(deprecated).toEqual({ input: 'eyebrows', status: 'ok', tag: 'eyebrows', zh: '眉毛', category: 0, count: 38000 });
    expect(alias).toMatchObject({ input: 'eyebrow', status: 'alias', tag: 'eyebrows' });
    expect(gone).toEqual({ input: 'masterpiece', status: 'ok', tag: 'masterpiece', zh: '', category: 0, count: 0 });
    // 离 eyebrowz 最近的是已废弃的 eyebrows（差一个字母），不给它
    expect((await check(['eyebrowz']))[0]).toEqual({ input: 'eyebrowz', status: 'unknown', suggestions: [] });
  });

  it('带了系列时，这个系列固定开头和评级词里的词也算认识，标上是质量词还是评级词', async () => {
    expect((await check(['score_9', 'rating_safe'])).map((result) => result.status)).toEqual(['unknown', 'unknown']);
    expect(await check(['score_9', 'rating_safe'], 'Pony')).toEqual([
      { input: 'score_9', status: 'ok', zh: '质量词', category: 5 },
      { input: 'rating_safe', status: 'ok', zh: '评级词', category: 5 },
    ]);
    expect((await check(['best quality', 'score_9'], 'IL')).map((result) => result.status)).toEqual(['ok', 'unknown']);
    // masterpiece 在词库里是已废弃的，在固定开头里照样标质量词
    expect(await check(['masterpiece'], 'IL')).toEqual([{ input: 'masterpiece', status: 'ok', zh: '质量词', category: 5 }]);
    expect((await t.call('POST', '/tags/check', { tags: 'smile' })).status).toBe(400);
    expect((await t.call('POST', '/tags/check', { tags: ['smile'], family: 'SDXL' })).status).toBe(400);
  });

  it('词库是哪天的、多少个标签（不算已废弃的）、多少个有中文、按使用次数算多少有中文、多少条别名', async () => {
    expect(await t.ok('GET', '/tags/info')).toEqual(LIBRARY_INFO);
  });
});

describe('词库放在哪', () => {
  it('工作文件夹里还没有词库：从仓库复制一份', async () => {
    await fs.rm(path.join(t.work, 'tags'), { recursive: true });
    const info = await t.ok<TagInfo>('GET', '/tags/info');
    expect(info.updatedAt).toBe('2026-10-03');
    expect(info.tags).toBeGreaterThan(100000);
    expect(info.withZh).toBeGreaterThan(10000);
    expect(info.zhByUse).toBeGreaterThan(0.9);
    expect(info.aliases).toBeGreaterThan(10000);
    // 0 次的已废弃标签也在快照里
    expect((await check(['bangs']))[0]).toMatchObject({ status: 'ok', tag: 'bangs', count: 0 });
    expect((await fs.readdir(path.join(t.work, 'tags', 'zh'))).sort()).toEqual(['LICENSE', 'artist.csv', 'character.csv', 'copyright.csv', 'general.csv', 'meta.csv']);
  });
});

describe('更新词库', () => {
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  const leftovers = async () => (await fs.readdir(t.work)).filter((name) => name.startsWith('tags.'));

  it('一页一页按顺序下，下完整个换掉；下到哪一步推给前端；换好后搜的是新的', async () => {
    expect(await t.ok('GET', '/tags/info')).toEqual(LIBRARY_INFO);
    const events = await t.stream<TagUpdateEvent>('/tags/update', {});

    // 下标签查两次：用过 50 次以上的，再是全部已废弃的，页数和条数接着数
    expect(events.slice(0, 4)).toEqual([
      { type: 'progress', step: 'tags', page: 1, rows: 2 },
      { type: 'progress', step: 'tags', page: 2, rows: 3 },
      { type: 'progress', step: 'tags', page: 3, rows: 5 },
      { type: 'progress', step: 'aliases', page: 1, rows: 1 },
    ]);
    expect(events.slice(4, 10).map((event) => event.type === 'progress' && event.step === 'zh' && event.file)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events[10]).toEqual({ type: 'done', info: { updatedAt: today(), tags: 2, withZh: 1, zhByUse: 60 / 7_000_060, aliases: 1 } });

    const tagRequests = requests.filter((request) => request.path === '/tags.json');
    expect(tagRequests[0]).toEqual({
      path: '/tags.json',
      query: { 'search[post_count]': '>50', only: 'id,name,post_count,category,is_deprecated', limit: '1000', page: 'a0' },
      agent: 'media-agent',
    });
    expect(tagRequests[3].query).toEqual({ 'search[is_deprecated]': 'true', only: 'id,name,post_count,category,is_deprecated', limit: '1000', page: 'a0' });
    expect(tagRequests.map((request) => (request.query as { page: string }).page)).toEqual(['a0', 'a7', 'a9', 'a0', 'a9']);
    expect(requests.filter((request) => request.path === '/tag_aliases.json').map((request) => request.query)).toEqual([
      { 'search[status]': 'active', only: 'id,antecedent_name,consequent_name', limit: '1000', page: 'a0' },
      { 'search[status]': 'active', only: 'id,antecedent_name,consequent_name', limit: '1000', page: 'a4' },
    ]);

    const read = (file: string) => fs.readFile(path.join(t.work, 'tags', file), 'utf8');
    expect(await read('tags.csv')).toBe('tag,category,count,deprecated\nlong_hair,0,7000000,0\nold_tag,0,100,1\nnew_tag,0,60,0\nbangs,0,0,1\n');
    expect(await read('aliases.csv')).toBe('alias,tag\nlonger_hair,long_hair\n');
    expect(await read('zh/general.csv')).toBe(NEW_GENERAL);
    expect(await read('zh/LICENSE')).toBe('MIT');
    expect(await leftovers()).toEqual([]);

    expect((await search('hair')).map((hit) => hit.tag)).toEqual(['long_hair']);
    expect((await search('新')).map((hit) => hit.tag)).toEqual(['new_tag']);
  });

  it('中途失败：旧的不动，说是哪一步失败的', async () => {
    failAliases = true;
    const before = await fs.readFile(path.join(t.work, 'tags', 'tags.csv'), 'utf8');
    const events = await t.stream<TagUpdateEvent>('/tags/update', {});
    expect(events.at(-1)).toEqual({ type: 'error', message: '下别名时出错：第 1 页：HTTP 500' });
    expect(await fs.readFile(path.join(t.work, 'tags', 'tags.csv'), 'utf8')).toBe(before);
    expect(await leftovers()).toEqual([]);
    expect(await t.ok('GET', '/tags/info')).toEqual(LIBRARY_INFO);
  });

  it('点了停止：停在正在下的这一页，旧的不动，下了一半的扔掉', async () => {
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    const before = await fs.readFile(path.join(t.work, 'tags', 'tags.csv'), 'utf8');
    const events = t.stream<TagUpdateEvent>('/tags/update', {});
    while (!requests.length) await sleep(10);
    expect((await t.call('POST', '/tags/update/stop')).status).toBe(204);
    expect(await events).toEqual([{ type: 'stopped' }]);
    release();
    expect(await fs.readFile(path.join(t.work, 'tags', 'tags.csv'), 'utf8')).toBe(before);
    expect(await leftovers()).toEqual([]);
    expect(await t.ok('GET', '/tags/info')).toEqual(LIBRARY_INFO);
    // 停了以后能再点更新
    expect((await t.stream<TagUpdateEvent>('/tags/update', {})).at(-1)?.type).toBe('done');
  });

  it('正在更新时再点，返回 409', async () => {
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    const first = t.stream<TagUpdateEvent>('/tags/update', {});
    while (!requests.length) await sleep(10);
    expect(await t.call('POST', '/tags/update', {})).toEqual({ status: 409, body: { error: '词库正在更新，等这一次下完' } });
    release();
    expect((await first).at(-1)?.type).toBe('done');
  });
});
