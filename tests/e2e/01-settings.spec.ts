import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_WORK_FOLDER, MOCK_LLM_PORT } from './env';

const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(E2E_WORK_FOLDER, file), 'utf8'));

test('第一次打开进首次设置：选工作文件夹、填模型配置并测通、看汇总、进首页', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: '选工作文件夹' })).toBeVisible();

  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('先选一个文件夹')).toBeVisible();
  await page.getByLabel('文件夹').fill(E2E_WORK_FOLDER);
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '填一套模型配置' })).toBeVisible();
  for (const name of ['ref2va', 'i2v', 't2v', 'fl2va', 'l2va', 'il', 'pony', 'krea2']) expect(fs.existsSync(path.join(E2E_WORK_FOLDER, 'prompts', `${name}.md`))).toBe(true);

  await page.getByLabel('名字').fill('mock');
  await page.getByLabel('模型名').fill('mock-model');
  await page.getByLabel('接口地址').fill(`http://127.0.0.1:${MOCK_LLM_PORT}/v1`);
  const key = page.getByLabel('密钥');
  await key.fill('test-key');
  await key.press('Enter');
  await expect(page.locator('#mf-keystate')).toContainText('已配置');
  await expect(key).toHaveValue('');

  await page.getByText('价格（可选）').click();
  await page.getByLabel('输入价').fill('3');
  await page.getByLabel('输出价').fill('15');
  await page.getByLabel('缓存命中价').fill('0.3');
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.locator('#mf-result')).toContainText('连得上');

  await page.getByRole('button', { name: '保存并继续' }).click();
  await expect(page.getByRole('heading', { name: '设置好了' })).toBeVisible();
  await expect(page.getByText('放进了 8 套')).toBeVisible();
  const saved = readJson('model-configs.json');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ name: 'mock', model: 'mock-model', pricing: { currency: '¥', input: 3, output: 15, cached: 0.3 } });

  await page.getByRole('link', { name: '进入首页' }).click();
  await expect(page.getByRole('heading', { name: '还没有画布' })).toBeVisible();
  await expect(page.locator('.path-pill')).toHaveText(E2E_WORK_FOLDER);
});

test('设置页：改模型配置和系统提示词不用点保存，自动写进工作文件夹', async ({ page }) => {
  await page.goto('/settings#models');
  await expect(page.locator('#mTitle')).toHaveText('mock');
  await page.getByLabel('名字').fill('mock 改名');
  await expect(page.locator('[data-model]')).toContainText('mock 改名');
  await expect.poll(() => readJson('model-configs.json')[0].name).toBe('mock 改名');
  await page.getByLabel('名字').fill('mock');
  await expect.poll(() => readJson('model-configs.json')[0].name).toBe('mock');

  // 新建一套，切到别的分类再切回来：刚建的还在；再改别的那套也不会把它冲掉
  const names = () => readJson('model-configs.json').map((m: { name: string }) => m.name);
  await page.getByRole('button', { name: '新建配置' }).click();
  await expect(page.locator('#mTitle')).toHaveText('新配置');
  await page.getByLabel('名字').fill('第二套');
  await expect.poll(names).toEqual(['mock', '第二套']);
  await page.getByRole('link', { name: '工作文件夹' }).click();
  await expect(page.getByText('能读写')).toBeVisible();
  await page.getByRole('link', { name: '模型配置' }).click();
  await expect(page.locator('[data-model]')).toHaveCount(2);
  await page.locator('[data-model]').first().click();
  await page.getByLabel('名字').fill('mock 又改名');
  await expect.poll(names).toEqual(['mock 又改名', '第二套']);
  await page.getByLabel('名字').fill('mock');
  await expect.poll(names).toEqual(['mock', '第二套']);
  await page.locator('[data-model]').nth(1).click();
  await page.locator('#mDel').click();
  await page.getByRole('dialog', { name: '删除「第二套」？' }).getByRole('button', { name: '删除' }).click();
  await expect.poll(names).toEqual(['mock']);

  await page.getByRole('link', { name: '系统提示词' }).click();
  await page.getByRole('button', { name: '新建' }).click();
  const dialog = page.getByRole('dialog', { name: '新建系统提示词' });
  await dialog.getByLabel('名字').fill('测试用');
  await dialog.getByRole('button', { name: '新建' }).click();
  await expect(page.getByRole('heading', { name: '测试用.md' })).toBeVisible();
  const file = path.join(E2E_WORK_FOLDER, 'prompts', '测试用.md');
  await page.getByLabel('系统提示词内容').fill('改过的系统提示词');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('改过的系统提示词');

  await page.locator('#pDel').click();
  await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();
  await expect(page.locator('[data-prompt="测试用"]')).toHaveCount(0);
  expect(fs.existsSync(file)).toBe(false);

  await page.getByRole('link', { name: '工作文件夹' }).click();
  await expect(page.getByText('能读写')).toBeVisible();
  await expect(page.getByText('8 套系统提示词')).toBeVisible();
});
