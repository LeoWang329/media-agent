import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { E2E_APP_PORT, E2E_WORK_FOLDER, MOCK_LLM_PORT } from './env';

// 用接口直接设好工作文件夹和 mock 模型配置，不走设置页
export async function setupWorkFolder(playwright: PlaywrightWorkerArgs['playwright']) {
  const request = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${E2E_APP_PORT}` });
  expect((await request.put('/api/config', { data: { workFolder: E2E_WORK_FOLDER } })).ok()).toBe(true);
  const modelConfigs = [{ id: 'mock', name: 'mock', baseUrl: `http://127.0.0.1:${MOCK_LLM_PORT}/v1`, apiKey: 'test', model: 'mock-model', imageLongSide: 1600 }];
  expect((await request.put('/api/config', { data: { modelConfigs } })).ok()).toBe(true);
  await request.dispose();
}

export const panel = (page: Page) => page.locator('.chat-panel');
export const cards = (page: Page) => page.getByTestId('node-card');
export const lastReply = (page: Page) => panel(page).getByTestId('message-assistant').last();

export async function newCanvasWithNode(page: Page, title: string) {
  await page.goto('/');
  page.once('dialog', (dialog) => void dialog.accept(title));
  await page.getByRole('button', { name: '新建画布' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: '新建节点' }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(panel(page).locator('.panel-title')).toHaveText('新节点');
}

// 等回复写完：面板底部的按钮从「停止」变回「发送」
export const waitIdle = (page: Page) => expect(panel(page).getByRole('button', { name: '发送', exact: true })).toBeVisible();

export async function send(page: Page, text: string) {
  const replies = panel(page).getByTestId('message-assistant');
  const before = await replies.count();
  const input = panel(page).getByLabel('输入消息');
  await input.fill(text);
  await input.press('Enter');
  await expect(replies).toHaveCount(before + 1);
  await waitIdle(page);
}
