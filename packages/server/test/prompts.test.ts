import type { FormatRequirements, PromptInfo } from '@media-agent/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

const IL_PROMPT = fileURLToPath(new URL('../../../docs/prompts/il.md', import.meta.url));

let t: TestApp;

beforeEach(async () => {
  t = await startTestApp();
});

afterEach(async () => {
  await t.cleanup();
});

const BUILTINS: PromptInfo[] = [
  { name: 'ref2va', use: 'video', family: null },
  { name: 'i2v', use: 'video', family: null },
  { name: 't2v', use: 'video', family: null },
  { name: 'fl2va', use: 'video', family: null },
  { name: 'l2va', use: 'video', family: null },
  { name: 'il', use: 'image', family: 'IL' },
  { name: 'pony', use: 'image', family: 'Pony' },
];

describe('系统提示词', () => {
  it('列表、新建、读、改、删除进 .trash；名字不合法返回 400', async () => {
    // 自带七套，视频的五套在前、参考模式排第一，生图的两套标出系列
    expect(await t.ok('GET', '/prompts')).toEqual(BUILTINS);

    await t.ok('POST', '/prompts', { name: '英文版', text: 'english' });
    expect((await t.call('POST', '/prompts', { name: '英文版', text: 'x' })).status).toBe(409);
    await t.ok('POST', '/prompts', { name: '我的 IL', text: '---\n用途：生图\n底模：il\n---\n只写标签' });
    expect(await t.ok('GET', '/prompts')).toEqual([
      ...BUILTINS,
      { name: '我的 IL', use: 'image', family: 'IL' },
      { name: '英文版', use: 'video', family: null },
    ]);
    await t.ok('DELETE', `/prompts/${encodeURIComponent('我的 IL')}`);

    await t.ok('PUT', `/prompts/${encodeURIComponent('英文版')}`, { text: 'english v2' });
    expect(await t.ok('GET', `/prompts/${encodeURIComponent('英文版')}`)).toEqual({ name: '英文版', text: 'english v2' });
    expect(await fs.readFile(path.join(t.work, 'prompts', '英文版.md'), 'utf8')).toBe('english v2');

    expect((await t.call('PUT', '/prompts/missing', { text: 'x' })).status).toBe(404);
    expect((await t.call('POST', '/prompts', { name: '../evil', text: 'x' })).status).toBe(400);
    expect((await t.call('GET', `/prompts/${encodeURIComponent('..\\config')}`)).status).toBe(400);

    expect((await t.call('DELETE', `/prompts/${encodeURIComponent('英文版')}`)).status).toBe(204);
    expect(await t.ok('GET', '/prompts')).toEqual(BUILTINS);
    expect((await fs.readdir(path.join(t.work, '.trash'))).some((name) => name.endsWith('-prompt-英文版.md'))).toBe(true);
  });

  it('旧工作文件夹：fl2va、l2va、il、pony 补进来一次，之前删掉的视频提示词不补；删掉的 il 也不再补回来', async () => {
    const prompts = path.join(t.work, 'prompts');
    for (const file of ['.builtin.json', 'il.md', 'pony.md', 't2v.md']) await fs.rm(path.join(prompts, file));

    expect((await t.ok<PromptInfo[]>('GET', '/prompts')).map((p) => p.name)).toEqual(['ref2va', 'i2v', 'fl2va', 'l2va', 'il', 'pony']);
    expect(await fs.readFile(path.join(prompts, 'il.md'), 'utf8')).toBe(await fs.readFile(IL_PROMPT, 'utf8'));
    expect(JSON.parse(await fs.readFile(path.join(prompts, '.builtin.json'), 'utf8'))).toEqual(BUILTINS.map((p) => p.name));

    await t.ok('DELETE', '/prompts/il');
    expect((await t.ok<PromptInfo[]>('GET', '/prompts')).map((p) => p.name)).toEqual(['ref2va', 'i2v', 'fl2va', 'l2va', 'pony']);
  });

  it('固定格式要求：视频的取 format-requirement.md、生图的取 format-requirement-image.md，都是 --- 下面那段', async () => {
    const { video, image } = await t.ok<FormatRequirements>('GET', '/format-requirement');
    expect(video.startsWith('输出格式要求：')).toBe(true);
    expect(video).toContain('<prompt label="方向一：慢推近景，无台词">');
    expect(image.startsWith('输出格式要求：')).toBe(true);
    expect(image).toContain('框里只放英文标签');
    for (const text of [video, image]) expect(text).not.toContain('---');
  });
});
