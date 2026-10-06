import { expect, test } from '@playwright/test';
import { lastReply, newCanvasWithNode, panel, send, setupWorkFolder, toasts } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 设置存在工作文件夹里，后面的用例照全带的来
test.afterEach(async ({ page }) => {
  expect((await page.request.put('/api/settings', { data: { turnLimit: 'all' } })).ok()).toBe(true);
});

test('只带最近几轮：设置里选最近 5 轮，第 6 条只带最近 5 轮，回复下面写着；节点上改成全部带就不截', async ({ page }) => {
  await page.goto('/settings#chat');
  const total = page.getByLabel('最多带几轮');
  await expect(total).toHaveValue('all');
  const saved = page.waitForResponse((res) => res.url().endsWith('/api/settings') && res.request().method() === 'PUT');
  await total.selectOption({ label: '最近 5 轮' });
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByLabel('最多带几轮')).toHaveValue('5');

  await newCanvasWithNode(page, '只带最近几轮');
  const own = panel(page).getByLabel('最多带几轮');
  await expect(own.locator('option:checked')).toHaveText('跟设置（最近 5 轮）');
  for (const text of ['一', '二', '三', '四', '五']) await send(page, text);
  await expect(lastReply(page)).toContainText('历史消息 9 条');
  await expect(lastReply(page).getByTestId('trimmed')).toHaveCount(0);
  await send(page, '六');
  await expect(lastReply(page)).toContainText('历史消息 9 条');
  await expect(lastReply(page).getByTestId('trimmed')).toHaveText('只带了最近 5 轮，前面 1 轮没带');

  await own.selectOption({ label: '全部带' });
  await expect(toasts(page).filter({ hasText: '从下一条消息起，前面的对话全部带上' })).toBeVisible();
  await send(page, '七');
  await expect(lastReply(page)).toContainText('历史消息 13 条');
  await expect(lastReply(page).getByTestId('trimmed')).toHaveCount(0);
});
