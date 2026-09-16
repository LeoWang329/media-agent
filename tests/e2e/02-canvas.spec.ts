import { expect, test, type Page } from '@playwright/test';
import { cards, newCanvasWithNode, panel, send, setupWorkFolder, waitIdle } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const cardTitled = (page: Page, title: string) => cards(page).filter({ has: page.locator('.node-title', { hasText: new RegExp(`^${title}$`) }) });
const bubbles = (page: Page) => panel(page).locator('.bubble');

test('新建画布和节点，发「写一个」：看到标题、一个提示词框，卡片概述含「测试概述」', async ({ page }) => {
  await newCanvasWithNode(page, '用例 1');
  await send(page, '写一个');
  await expect(panel(page).locator('.panel-title')).toHaveText('测试标题');
  await expect(panel(page).getByTestId('prompt-box')).toHaveCount(1);
  await expect(cards(page)).toContainText('测试标题');
  await expect(cards(page)).toContainText('测试概述');
});

test('从最后一条回复 fork：多一个节点和一条线；在新节点发消息，历史消息数是原路径条数加 1', async ({ page }) => {
  await newCanvasWithNode(page, '用例 5');
  await send(page, '写一个');
  const reply = panel(page).getByTestId('message-assistant').last();
  await reply.hover();
  await reply.getByRole('button', { name: '从这里 fork' }).click();

  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(panel(page).locator('.panel-title')).toHaveText('测试标题 · 分支');
  await expect(panel(page).getByTestId('message-assistant')).toHaveCount(1);

  await send(page, '继续');
  await expect(panel(page).getByTestId('message-assistant').last()).toContainText('历史消息 3 条');
});

test('从第一条用户消息 fork：新节点输入框预填这句话，消息列表为空', async ({ page }) => {
  await newCanvasWithNode(page, '用例 6');
  await send(page, '写一个');
  const user = panel(page).getByTestId('message-user').first();
  await user.hover();
  await user.getByRole('button', { name: '从这里 fork' }).click();

  await expect(cards(page)).toHaveCount(2);
  await expect(panel(page).locator('.panel-title')).toHaveText('测试标题 · 分支');
  await expect(panel(page).getByLabel('输入消息')).toHaveValue('写一个');
  await expect(panel(page).getByTestId('message-user')).toHaveCount(0);
  await expect(panel(page).getByTestId('message-assistant')).toHaveCount(0);
});

test('编辑第一条用户消息：出现版本切换，后面的消息不见了；切回第 1 版，后面的消息回来', async ({ page }) => {
  await newCanvasWithNode(page, '用例 7');
  await send(page, '写一个');
  await send(page, '再来');
  const first = panel(page).getByTestId('message-user').first();
  await first.hover();
  await first.getByRole('button', { name: '编辑' }).click();
  await first.getByLabel('编辑消息').fill('写两个');
  await first.getByRole('button', { name: '发送' }).click();

  await expect(first.locator('.versions')).toHaveText(/2\/2/);
  await expect(bubbles(page)).toHaveText(['写两个']);
  await waitIdle(page);

  await first.getByRole('button', { name: '上一个版本' }).click();
  await expect(first.locator('.versions')).toHaveText(/1\/2/);
  await expect(bubbles(page)).toHaveText(['写一个', '再来']);
});

test('重新生成：回复出现版本切换', async ({ page }) => {
  await newCanvasWithNode(page, '用例 8');
  await send(page, '写一个');
  const reply = panel(page).getByTestId('message-assistant').last();
  await reply.hover();
  await reply.getByRole('button', { name: '重新生成' }).click();
  await expect(reply.locator('.versions')).toHaveText(/2\/2/);
  await waitIdle(page);
  await expect(reply.getByTestId('prompt-box')).toHaveCount(1);
});

test('发「三个方向」：三个框，卡片显示「3 个方向」；点第二个框的沿此方向，新节点输入框预填「第 2 个方向」', async ({ page }) => {
  await newCanvasWithNode(page, '用例 10');
  await send(page, '三个方向');
  await expect(panel(page).getByTestId('prompt-box')).toHaveCount(3);
  await expect(cards(page)).toContainText('3 个方向');

  await panel(page).getByTestId('prompt-box').nth(1).getByRole('button', { name: '沿此方向 fork' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(panel(page).getByLabel('输入消息')).toHaveValue(/第 2 个方向/);
});

test('折叠有子节点的节点：子节点隐藏、卡片显示已收起；删除时确认框写「连同 2 个子节点」，三个一起消失', async ({ page }) => {
  await newCanvasWithNode(page, '用例 12');
  await send(page, '写一个');
  const parent = cardTitled(page, '测试标题');
  for (const count of [2, 3]) {
    await parent.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'fork 到新节点' }).click();
    await expect(cards(page)).toHaveCount(count);
  }

  await parent.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '折叠' }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(parent).toContainText('已收起 2 个');
  await parent.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '展开' }).click();
  await expect(cards(page)).toHaveCount(3);

  let confirmText = '';
  page.once('dialog', (dialog) => {
    confirmText = dialog.message();
    void dialog.accept();
  });
  await parent.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除' }).click();
  await expect(cards(page)).toHaveCount(0);
  expect(confirmText).toContain('连同 2 个子节点');
});

test('发「报错」：显示错误和重试，重试成功', async ({ page }) => {
  await newCanvasWithNode(page, '用例 13');
  await send(page, `报错 ${Date.now()}`);
  const reply = panel(page).getByTestId('message-assistant').last();
  await expect(reply).toContainText('生成失败');
  await reply.getByRole('button', { name: '重试' }).click();
  await expect(reply.locator('.versions')).toHaveText(/2\/2/);
  await waitIdle(page);
  await expect(reply.getByTestId('prompt-box')).toHaveCount(1);
});

test('生成中点停止：保留已收到的部分，可以接着发', async ({ page }) => {
  await newCanvasWithNode(page, '停止');
  const input = panel(page).getByLabel('输入消息');
  await input.fill('慢一点');
  await input.press('Enter');
  const reply = panel(page).getByTestId('message-assistant').last();
  await expect(reply).toContainText('收到 0 张图');
  await panel(page).getByRole('button', { name: '停止' }).click();
  await waitIdle(page);
  await expect(reply).toContainText('收到 0 张图');
  await expect(reply.getByTestId('prompt-box')).toHaveCount(0);

  await send(page, '继续');
  await expect(panel(page).getByTestId('message-assistant').last()).toContainText('历史消息 3 条');
});
