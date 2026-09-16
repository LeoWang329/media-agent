import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { cards, lastReply, newCanvasWithNode, panel, send, setupWorkFolder } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const tile = (page: Page, name: string) => page.getByTestId('asset-tile').filter({ hasText: name });
const slots = (page: Page) => panel(page).getByTestId('slot');
const filledSlots = (page: Page) => panel(page).locator('.slot.filled');

test('资产库和槽位：放三张图发送，换 2 号图，删 1 号图，改时长；fork 出的节点槽位一样', async ({ page }) => {
  // 测试里弹不出系统的选文件夹窗口，按「弹不出来」处理，改用路径输入框导入
  await page.route('**/api/assets/pick-folder', (route) => route.fulfill({ status: 501, json: { error: '这个系统不能弹窗选择，请直接填写路径' } }));
  await newCanvasWithNode(page, '资产库');
  await page.getByRole('button', { name: '导入文件夹' }).click();
  await page.getByLabel('要导入的文件夹路径').fill(FIXTURES_DIR);
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(tile(page, FIXTURES.first)).toBeVisible();
  await expect(tile(page, FIXTURES.heic)).toContainText('不支持');

  await test.step('10.1 第 2 条：双击三张图，槽位显示 1、2、3，发出去带全部图', async () => {
    for (const name of [FIXTURES.first, FIXTURES.second, FIXTURES.big]) await tile(page, name).dblclick();
    await expect(filledSlots(page).locator('.slot-number')).toHaveText(['1', '2', '3']);
    await expect(cards(page).locator('img.node-slot')).toHaveCount(3);
    await send(page, '写一个');
    await expect(lastReply(page)).toContainText('收到 3 张图：<Picture 1>、<Picture 2>、<Picture 3>');
    await expect(lastReply(page)).toContainText('参考图共 3 张');
    await expect(lastReply(page)).toContainText('视频时长 8 秒');
    await expect(panel(page).getByTestId('message-user').last().locator('.attachment')).toHaveCount(3);

    const canvasId = page.url().split('/').at(-1);
    const { images } = await (await page.request.get(`/api/canvases/${canvasId}`)).json();
    const big = Object.values(images as Record<string, { originalName: string; width: number; height: number; processed: { reason: string } }>).find(
      (image) => image.originalName === FIXTURES.big,
    );
    expect(big).toMatchObject({ width: 5760, height: 3840, processed: { reason: 'too-large' } });
  });

  await test.step('10.1 第 3 条：把第四张图拖到 2 号槽位，只带换掉的那张', async () => {
    await tile(page, FIXTURES.fourth).dragTo(slots(page).nth(1));
    await expect(slots(page).nth(1)).toHaveAttribute('title', FIXTURES.fourth);
    await send(page, '改一下');
    await expect(lastReply(page)).toContainText('收到 1 张图：<Picture 2>');
    await expect(lastReply(page)).toContainText('换成了');
  });

  await test.step('10.1 第 4 条：删掉 1 号槽位，全部重新编号', async () => {
    await slots(page).first().hover();
    await panel(page).getByRole('button', { name: '删除 1 号图' }).click();
    await expect(filledSlots(page)).toHaveCount(2);
    await send(page, '再改');
    await expect(lastReply(page)).toContainText('收到 2 张图');
    await expect(lastReply(page)).toContainText('重新编号');
  });

  await test.step('10.1 第 9 条：时长改成 12，只有说明不带图', async () => {
    await panel(page).getByLabel('视频时长').selectOption('12');
    await expect(panel(page).getByLabel('视频时长')).toHaveValue('12');
    await send(page, '长一点');
    await expect(lastReply(page)).toContainText('视频时长改为 12 秒');
    await expect(lastReply(page)).toContainText('收到 0 张图');
  });

  await test.step('10.1 第 5 条：从最后一条回复 fork，新节点槽位和时长一样', async () => {
    await lastReply(page).hover();
    await lastReply(page).getByRole('button', { name: '从这里 fork' }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(panel(page).locator('.panel-title')).toHaveText('测试标题 · 分支');
    await expect(filledSlots(page)).toHaveCount(2);
    await expect(slots(page).first()).toHaveAttribute('title', FIXTURES.fourth);
    await expect(panel(page).getByLabel('视频时长')).toHaveValue('12');
  });
});

test('切换版本时槽位跟着变；有没发出的槽位改动时先确认', async ({ page }) => {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, '版本和槽位');
  await expect(tile(page, FIXTURES.first)).toBeVisible();
  await tile(page, FIXTURES.first).dblclick();
  await expect(filledSlots(page)).toHaveCount(1);
  await send(page, '写一个');

  await tile(page, FIXTURES.second).dblclick();
  await expect(filledSlots(page)).toHaveCount(2);
  const reply = lastReply(page);
  await reply.hover();
  await reply.getByRole('button', { name: '重新生成' }).click();
  await expect(reply.locator('.versions')).toHaveText(/2\/2/);
  await expect(panel(page).getByRole('button', { name: '发送', exact: true })).toBeVisible();

  let confirmText = '';
  page.once('dialog', (dialog) => {
    confirmText = dialog.message();
    void dialog.accept();
  });
  await reply.getByRole('button', { name: '上一个版本' }).click();
  await expect(reply.locator('.versions')).toHaveText(/1\/2/);
  expect(confirmText).toContain('还没发出的改动');
  await expect(filledSlots(page)).toHaveCount(1);
});

test('槽位之间拖动调顺序；多选后拖进槽位区按选中的先后填进空位；按文件名搜索', async ({ page }) => {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, '拖动和搜索');
  await tile(page, FIXTURES.first).dblclick();
  await expect(filledSlots(page)).toHaveCount(1);
  await tile(page, FIXTURES.second).dblclick();
  await expect(filledSlots(page)).toHaveCount(2);

  await slots(page).nth(1).dragTo(slots(page).nth(0));
  await expect(slots(page).nth(0)).toHaveAttribute('title', FIXTURES.second);
  await expect(slots(page).nth(1)).toHaveAttribute('title', FIXTURES.first);

  await tile(page, FIXTURES.fifth).click();
  await tile(page, FIXTURES.third).click({ modifiers: ['Control'] });
  await tile(page, FIXTURES.fifth).dragTo(slots(page).nth(5));
  await expect(filledSlots(page)).toHaveCount(4);
  await expect(slots(page).nth(2)).toHaveAttribute('title', FIXTURES.fifth);
  await expect(slots(page).nth(3)).toHaveAttribute('title', FIXTURES.third);

  await slots(page).first().click();
  await expect(panel(page).getByText('选中了 1 号')).toBeVisible();
  await tile(page, FIXTURES.fourth).dblclick();
  await expect(slots(page).first()).toHaveAttribute('title', FIXTURES.fourth);
  await expect(filledSlots(page)).toHaveCount(4);

  await page.getByLabel('搜索资产库').fill('紫色');
  await expect(page.getByText('搜索结果 1 个')).toBeVisible();
  await expect(page.getByTestId('asset-tile')).toHaveText([FIXTURES.fifth]);
});
