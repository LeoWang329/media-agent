import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;

beforeEach(async () => {
  t = await startTestApp();
});

afterEach(async () => {
  await t.cleanup();
});

describe('系统提示词', () => {
  it('列表、新建、读、改、删除进 .trash；名字不合法返回 400', async () => {
    // 自带五套，参考模式排第一
    expect(await t.ok('GET', '/prompts')).toEqual(['ref2va', 'i2v', 't2v', 'fl2va', 'l2va']);

    await t.ok('POST', '/prompts', { name: '英文版', text: 'english' });
    expect((await t.call('POST', '/prompts', { name: '英文版', text: 'x' })).status).toBe(409);
    expect(await t.ok('GET', '/prompts')).toEqual(['ref2va', 'i2v', 't2v', 'fl2va', 'l2va', '英文版']);

    await t.ok('PUT', `/prompts/${encodeURIComponent('英文版')}`, { text: 'english v2' });
    expect(await t.ok('GET', `/prompts/${encodeURIComponent('英文版')}`)).toEqual({ name: '英文版', text: 'english v2' });
    expect(await fs.readFile(path.join(t.work, 'prompts', '英文版.md'), 'utf8')).toBe('english v2');

    expect((await t.call('PUT', '/prompts/missing', { text: 'x' })).status).toBe(404);
    expect((await t.call('POST', '/prompts', { name: '../evil', text: 'x' })).status).toBe(400);
    expect((await t.call('GET', `/prompts/${encodeURIComponent('..\\config')}`)).status).toBe(400);

    expect((await t.call('DELETE', `/prompts/${encodeURIComponent('英文版')}`)).status).toBe(204);
    expect(await t.ok('GET', '/prompts')).toEqual(['ref2va', 'i2v', 't2v', 'fl2va', 'l2va']);
    expect((await fs.readdir(path.join(t.work, '.trash'))).some((name) => name.endsWith('-prompt-英文版.md'))).toBe(true);
  });

  it('固定格式要求取 docs/prompts/format-requirement.md 里 --- 下面那段', async () => {
    const { text } = await t.ok('GET', '/format-requirement');
    expect(text.startsWith('输出格式要求：')).toBe(true);
    expect(text).toContain('<prompt label="方向一：慢推近景，无台词">');
    expect(text).not.toContain('---');
  });
});
