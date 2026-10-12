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
  { name: 'ref2va', use: 'video', family: null, fn: null },
  { name: 'i2v', use: 'video', family: null, fn: null },
  { name: 't2v', use: 'video', family: null, fn: null },
  { name: 'fl2va', use: 'video', family: null, fn: null },
  { name: 'l2va', use: 'video', family: null, fn: null },
  { name: 'il', use: 'image', family: 'IL', fn: null },
  { name: 'pony', use: 'image', family: 'Pony', fn: null },
  { name: 'krea2', use: 'image', family: 'Krea2', fn: null },
  { name: 'edit', use: 'edit', family: null, fn: '指令编辑' },
  { name: 'edit-outfit', use: 'edit', family: null, fn: '换装' },
  { name: 'edit-inpaint', use: 'edit', family: null, fn: '局部重绘' },
  { name: 'edit-real', use: 'edit', family: null, fn: '转真人' },
  { name: 'edit-depth', use: 'edit', family: null, fn: '深度迁移' },
  { name: 'edit-remix', use: 'edit', family: null, fn: '风格 Remix' },
  { name: 'edit-fourview', use: 'edit', family: null, fn: '四视图' },
];

describe('系统提示词', () => {
  it('列表、新建、读、改、删除进 .trash；名字不合法返回 400', async () => {
    // 自带十五套：视频的五套在前、参考模式排第一，生图的三套标出系列，编辑的七套标出功能名
    //（放大 / 高清不用模型写字，没有它那份）
    expect(await t.ok('GET', '/prompts')).toEqual(BUILTINS);

    await t.ok('POST', '/prompts', { name: '英文版', text: 'english' });
    expect((await t.call('POST', '/prompts', { name: '英文版', text: 'x' })).status).toBe(409);
    await t.ok('POST', '/prompts', { name: '我的 IL', text: '---\n用途：生图\n底模：il\n---\n只写标签' });
    await t.ok('POST', '/prompts', { name: '我的编辑', text: '---\n用途：编辑\n功能：换装\n---\n只写衣服' });
    expect(await t.ok('GET', '/prompts')).toEqual([
      ...BUILTINS,
      { name: '我的 IL', use: 'image', family: 'IL', fn: null },
      { name: '我的编辑', use: 'edit', family: null, fn: '换装' },
      { name: '英文版', use: 'video', family: null, fn: null },
    ]);
    await t.ok('DELETE', `/prompts/${encodeURIComponent('我的 IL')}`);
    await t.ok('DELETE', `/prompts/${encodeURIComponent('我的编辑')}`);

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

    // t2v 是用户删掉的（.builtin.json 也没了，算老工作文件夹），不再补回来；其余缺的都补上
    expect((await t.ok<PromptInfo[]>('GET', '/prompts')).map((p) => p.name)).toEqual(BUILTINS.filter((p) => p.name !== 't2v').map((p) => p.name));
    expect(await fs.readFile(path.join(prompts, 'il.md'), 'utf8')).toBe(await fs.readFile(IL_PROMPT, 'utf8'));
    expect(JSON.parse(await fs.readFile(path.join(prompts, '.builtin.json'), 'utf8'))).toEqual(BUILTINS.map((p) => p.name));

    await t.ok('DELETE', '/prompts/il');
    const left = (await t.ok<PromptInfo[]>('GET', '/prompts')).map((p) => p.name);
    expect(left).toContain('pony');
    expect(left).toContain('edit');
    expect(left).not.toContain('il');
    expect(left).not.toContain('t2v');
  });

  it('固定格式要求：视频 / 生图 / Krea2 / 图像编辑各取各的，都是 --- 下面那段', async () => {
    const { video, image, krea2, edit } = await t.ok<FormatRequirements>('GET', '/format-requirement');
    expect(video.startsWith('输出格式要求：')).toBe(true);
    expect(video).toContain('<prompt label="方向一：慢推近景，无台词">');
    expect(image.startsWith('输出格式要求：')).toBe(true);
    expect(image).toContain('框里只放英文标签');
    expect(krea2).toContain('英文自然语言描述');
    // 编辑那份的框里是"直接发给 ComfyUI 的那句话"，不拆成标签
    expect(edit.startsWith('输出格式要求：')).toBe(true);
    expect(edit).toContain('框里**只放英文**');
    expect(edit).toContain('一个字都不会被程序改动');
    for (const text of [video, image, krea2, edit]) expect(text).not.toContain('---');
  });
});
