import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_APP_PORT, E2E_WORK_FOLDER } from './env';
import { input, lastReply, newCanvasWithNode, panel, setupWorkFolder, waitIdle } from './helpers';

const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(E2E_WORK_FOLDER, file), 'utf8'));

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 后面的用例不受这里开的思考影响
test.afterAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${E2E_APP_PORT}` });
  await request.put('/api/settings', { data: { thinking: { level: 'off' } } });
  const { modelConfigs } = await (await request.get('/api/config')).json();
  await request.put('/api/config', { data: { modelConfigs: modelConfigs.map((m: object) => ({ ...m, thinkingStyle: 'none' })) } });
  await request.dispose();
});

test('10.3 第 1 条：总档位调到中、mock 选 reasoning_effort → 正文前显示正在思考，回复上面折叠着思考原文，发的是 medium；翻译默认关，发的是 low', async ({ page }) => {
  await page.goto('/settings#thinking');
  await page.getByRole('group', { name: '总档位' }).getByRole('button', { name: '中' }).click();
  await expect(page.getByLabel('写提示词', { exact: true })).toHaveValue('follow');
  await expect(page.getByLabel('写提示词', { exact: true }).locator('option[value="follow"]')).toHaveText('跟总开关（现在是「中」）');
  await expect(page.getByLabel('翻译', { exact: true })).toHaveValue('off');
  await expect.poll(() => readJson('settings.json').thinking.level).toBe('medium');

  // 从「每套模型配置怎么开思考」点「改」，到模型配置里选中的就是这一套
  const row = page.locator('.sx-row', { hasText: 'mock' });
  await expect(row).toContainText('不支持');
  await row.getByRole('link', { name: '改' }).click();
  await expect(page.locator('#mTitle')).toHaveText('mock');
  await page.getByLabel('开思考的写法').selectOption({ label: 'reasoning_effort' });
  await expect(page.getByLabel('开思考用的模型名')).toHaveCount(0);
  await expect.poll(() => readJson('model-configs.json')[0].thinkingStyle).toBe('reasoning-effort');

  await newCanvasWithNode(page, '思考');
  const button = panel(page).locator('#cfgThink');
  await expect(button).toHaveText('思考 中');

  await input(page).fill('写一个');
  await input(page).press('Enter');
  const reply = lastReply(page);
  await expect(reply.locator('.think.is-live')).toContainText(/正在思考 \d+ 秒/);
  await waitIdle(page);

  const thinking = reply.locator('details.think');
  await expect(thinking.locator('summary')).toContainText(/思考了 \d+ 秒/);
  await expect(thinking.locator('.think-body')).toBeHidden();
  await thinking.locator('summary').click();
  await expect(thinking.locator('.think-body')).toContainText('思考：');
  await expect(reply).toContainText('思考参数：{"reasoning_effort":"medium"}');

  const dialog = page.getByRole('dialog', { name: '翻译提示词' });
  await reply.getByTestId('prompt-box').locator('[data-act="translate"]').click();
  await dialog.locator('#trRun').click();
  await expect(dialog.getByTestId('translation')).toContainText('思考参数：{"reasoning_effort":"low"}');
  await page.keyboard.press('Escape');

  // 面板顶上的思考按钮去设置里的「思考」
  await button.click();
  await expect(page).toHaveURL(/\/settings#thinking$/);
  await expect(page.getByRole('heading', { name: '思考', exact: true })).toBeVisible();
});
