import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { E2E_APP_PORT, E2E_WORK_FOLDER, MOCK_COMFY_PORT, MOCK_LLM_PORT } from './env';

// 用接口直接设好工作文件夹和 mock 模型配置，不走设置页
export async function setupWorkFolder(playwright: PlaywrightWorkerArgs['playwright']) {
  // 假的 AutoDL 和那台上的文件都是 mock 进程里留着的，跨文件、跨轮次都在：每个文件开头清一次。
  // 不清的话上一轮传上去的模型、开着的实例会让这一轮的列表和「写着已关机」的用例对不上
  await fetch(`http://127.0.0.1:${MOCK_COMFY_PORT}/_reset`, { method: 'POST' }).catch(() => undefined);
  const request = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${E2E_APP_PORT}` });
  expect((await request.put('/api/config', { data: { workFolder: E2E_WORK_FOLDER } })).ok()).toBe(true);
  const pricing = { currency: '¥', input: 3, output: 15, cached: 0.3 };
  const modelConfigs = [
    { id: 'mock', name: 'mock', baseUrl: `http://127.0.0.1:${MOCK_LLM_PORT}/v1`, apiKey: 'test', model: 'mock-model', imageLongSide: 1600, pricing },
  ];
  expect((await request.put('/api/config', { data: { modelConfigs } })).ok()).toBe(true);
  await request.dispose();
}

// 右侧的节点对话面板
export const panel = (page: Page) => page.locator('#drawer');
export const drawerTitle = (page: Page) => panel(page).locator('#drTitle');
export const cards = (page: Page) => page.getByTestId('node-card');
export const cardTitled = (page: Page, title: string) =>
  cards(page).filter({ has: page.locator('.gn-title', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
export const lastReply = (page: Page) => panel(page).getByTestId('message-assistant').last();
export const input = (page: Page) => panel(page).getByRole('textbox', { name: '输入消息' });
export const slots = (page: Page) => panel(page).getByTestId('slot');
export const filledSlots = (page: Page) => panel(page).locator('#slots .slot.is-filled');
export const toasts = (page: Page) => page.locator('.toast');
export const assetsDialog = (page: Page) => page.getByRole('dialog', { name: '资产库' });
export const assetTile = (page: Page, name: string) => assetsDialog(page).getByTestId('asset-tile').filter({ hasText: name });

// 首页新建画布、打开，再建一个节点；面板跟着打开
// 工具栏「新建节点」点开选一种，建好就不能换，见 docs/dev-plan.md 5.23、5.36
export async function newNode(page: Page, kind: '视频节点' | '生图节点' | '图像编辑节点' = '视频节点') {
  await page.getByRole('button', { name: '新建节点' }).click();
  await page.getByRole('menuitem', { name: kind }).click();
}

export async function newCanvasWithNode(page: Page, title: string, kind: '视频节点' | '生图节点' | '图像编辑节点' = '视频节点') {
  await page.goto('/');
  await page.getByRole('button', { name: '新建画布' }).click();
  const dialog = page.getByRole('dialog', { name: '新建画布' });
  await dialog.getByLabel('画布名字').fill(title);
  await dialog.getByRole('button', { name: '新建' }).click();
  await page.getByRole('link', { name: `打开「${title}」`, exact: true }).click();
  await expect(page.locator('#canvasTitle')).toHaveText(title);
  await newNode(page, kind);
  await expect(cards(page)).toHaveCount(1);
  await expect(drawerTitle(page)).toHaveText('新节点');
}

// 等回复写完：面板底部的按钮从「停止」变回「发送」
export const waitIdle = (page: Page) => expect(panel(page).locator('#btnSend')).toHaveText('发送');

export async function send(page: Page, text: string) {
  const replies = panel(page).getByTestId('message-assistant');
  const before = await replies.count();
  await input(page).fill(text);
  await input(page).press('Enter');
  await expect(replies).toHaveCount(before + 1);
  await waitIdle(page);
}

// 从资产库弹窗里按顺序点几张图，放进当前节点的槽位，等复制完
export async function placeFromAssets(page: Page, names: string[]) {
  const before = await filledSlots(page).count();
  await panel(page).locator('#slotAssets').click();
  for (const name of names) await assetTile(page, name).click();
  await assetsDialog(page).getByRole('button', { name: `放进槽位（${names.length}）` }).click();
  await expect(assetsDialog(page)).toHaveCount(0);
  await expect(filledSlots(page)).toHaveCount(before + names.length);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
}

// 点槽位弹出的菜单
export async function slotMenu(page: Page, index: number, item: string) {
  await slots(page).nth(index).click();
  await page.getByRole('menuitem', { name: item }).click();
}
