import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { cards, lastReply, newCanvasWithNode, panel, send, setupWorkFolder } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const tile = (page: Page, name: string) => page.locator('.asset-column').getByTestId('asset-tile').filter({ hasText: name });
const box = (page: Page) => lastReply(page).getByTestId('prompt-box');
const rows = (page: Page) => page.getByTestId('checklist-row');

// Windows 的剪贴板里换行是 \r\n，比对前换回 \n
const copied = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

test('10.1 第 11 条：上传清单三行，原路径；处理过的那张指向画布副本并标「已处理」', async ({ page }) => {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, '上传清单');
  for (const name of [FIXTURES.first, FIXTURES.second, FIXTURES.big]) await tile(page, name).dblclick();
  await expect(panel(page).locator('.slot.filled')).toHaveCount(3);
  await send(page, '写一个');

  await box(page).getByRole('button', { name: '上传清单' }).click();
  const checklist = page.getByRole('dialog', { name: '上传清单' });
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText(`${FIXTURES_DIR}\\${FIXTURES.first}`);
  await expect(rows(page).nth(1)).toContainText(`${FIXTURES_DIR}\\${FIXTURES.second}`);

  const canvasId = page.url().split('/').at(-1);
  await expect(rows(page).nth(2)).toContainText(`canvases\\${canvasId}\\images\\`);
  await expect(rows(page).nth(2)).toContainText('已处理，请上传这份');

  // mock 的提示词只引用了 <Picture 1>
  await expect(rows(page).nth(0)).not.toContainText('提示词里没用到');
  await expect(rows(page).nth(1)).toContainText('提示词里没用到');
  await expect(checklist.locator('.checklist-warning')).toHaveCount(0);
  await checklist.getByRole('button', { name: '关闭' }).click();
  await expect(checklist).toHaveCount(0);
});

test('10.1 第 14 条：手动改提示词出新版本，复制的是改过的；引用了不存在的编号时清单顶上标红', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await newCanvasWithNode(page, '改提示词');
  await send(page, '写一个');

  await box(page).getByRole('button', { name: '编辑' }).click();
  await panel(page).getByLabel('编辑提示词').fill('summary:\n改过的概述，引用了 <Picture 5>');
  await panel(page).getByRole('button', { name: '保存' }).click();

  await expect(lastReply(page).locator('.versions')).toHaveText(/2\/2/);
  await expect(box(page)).toContainText('改过的概述');
  await expect(cards(page).locator('.node-summary')).toContainText('改过的概述');

  await box(page).getByRole('button', { name: '复制', exact: true }).click();
  expect(await copied(page)).toBe('summary:\n改过的概述，引用了 <Picture 5>');

  await box(page).getByRole('button', { name: '上传清单' }).click();
  await expect(page.locator('.checklist-warning')).toContainText('<Picture 5>');
  await expect(rows(page)).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 切回第 1 版，复制到的是原来的
  await lastReply(page).getByRole('button', { name: '上一个版本' }).click();
  await expect(lastReply(page).locator('.versions')).toHaveText(/1\/2/);
  await box(page).getByRole('button', { name: '复制', exact: true }).click();
  expect(await copied(page)).toContain('测试概述');
});

test('星标打在框上、卡片跟着显示；回复角落有模型名、提示词名和 token，点提示词名看当时那版', async ({ page }) => {
  await newCanvasWithNode(page, '星标和角落');
  await send(page, '写一个');

  await box(page).getByRole('button', { name: '星标' }).click();
  await expect(box(page).getByRole('button', { name: '取消星标' })).toBeVisible();
  await expect(cards(page).locator('.node-star')).toBeVisible();
  await box(page).getByRole('button', { name: '取消星标' }).click();
  await expect(cards(page).locator('.node-star')).toHaveCount(0);

  const meta = lastReply(page).locator('.reply-meta');
  await expect(meta).toContainText('mock-model');
  await expect(meta).toContainText('tokens');
  await meta.getByRole('button', { name: 'default' }).click();
  await expect(page.getByRole('dialog', { name: /发这条时的系统提示词/ })).toContainText('MiniMax H3 视频提示词写手');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
