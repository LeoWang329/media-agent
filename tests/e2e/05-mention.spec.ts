import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { cards, newCanvasWithNode, panel, setupWorkFolder, waitIdle } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const tile = (page: Page, name: string) => page.locator('.asset-column').getByTestId('asset-tile').filter({ hasText: name });
const pickerTile = (page: Page, name: string) => page.locator('.asset-picker').getByTestId('asset-tile').filter({ hasText: name });
const slots = (page: Page) => panel(page).getByTestId('slot');
const filledSlots = (page: Page) => panel(page).locator('.slot.filled');
const input = (page: Page) => panel(page).getByLabel('输入消息');
const tags = (page: Page) => input(page).getByTestId('picture-tag');
const bubble = (page: Page) => panel(page).getByTestId('message-user').last().locator('.bubble');
const picker = (page: Page) => page.getByRole('dialog', { name: '选图插进来' });

test('10.2 第 1、2 条：输入 @ 选图插小标签，调槽位顺序编号跟着变', async ({ page }) => {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, '@ 选图');
  for (const name of [FIXTURES.first, FIXTURES.second, FIXTURES.third]) await tile(page, name).dblclick();
  await expect(filledSlots(page)).toHaveCount(3);

  await test.step('10.2 第 1 条：@ 弹出当前 3 张，选 2 号，发出去的文字里是 <Picture 2>', async () => {
    await input(page).click();
    await page.keyboard.type('照着');
    await page.keyboard.type('@');
    await expect(picker(page).locator('.picker-slot.filled')).toHaveCount(3);
    await picker(page).getByRole('button', { name: 'Picture 2' }).click();
    await expect(tags(page)).toHaveText(['Picture 2']);
    await page.keyboard.type('写一个');
    await input(page).press('Enter');
    await expect(bubble(page)).toHaveText('照着<Picture 2>写一个');
    await waitIdle(page);
  });

  await test.step('提示词编辑框：<Picture 1> 显示成小标签，@ 一样能选图', async () => {
    const box = panel(page).getByTestId('prompt-box').last();
    await box.getByRole('button', { name: '编辑' }).click();
    const editing = panel(page).getByLabel('编辑提示词');
    await expect(editing.getByTestId('picture-tag')).toHaveText(['Picture 1', 'Picture 1']);

    await editing.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('@');
    await picker(page).getByRole('button', { name: 'Picture 3' }).click();
    await expect(editing.getByTestId('picture-tag')).toHaveText(['Picture 1', 'Picture 1', 'Picture 3']);
    await box.getByRole('button', { name: '保存' }).click();
    await expect(panel(page).getByTestId('prompt-box').last()).toContainText('<Picture 3>');
  });

  await test.step('10.2 第 2 条：搜一张不在槽位的图，进 4 号槽位标签写 Picture 4；拖到 1 号位变 Picture 1', async () => {
    await input(page).click();
    await page.keyboard.type('@');
    await picker(page).getByLabel('搜索资产库').fill('04');
    await pickerTile(page, FIXTURES.fourth).click();
    await expect(filledSlots(page)).toHaveCount(4);
    await expect(slots(page).nth(3)).toHaveAttribute('title', FIXTURES.fourth);
    await expect(tags(page)).toHaveText(['Picture 4']);

    await slots(page).nth(3).dragTo(slots(page).nth(0));
    await expect(slots(page).first()).toHaveAttribute('title', FIXTURES.fourth);
    await expect(tags(page)).toHaveText(['Picture 1']);
    await input(page).press('Enter');
    await expect(bubble(page)).toHaveText('<Picture 1>');
    await waitIdle(page);
  });

  await test.step('没发出去的草稿里，小标签刷新后还在', async () => {
    await input(page).click();
    await page.keyboard.type('@');
    await picker(page).getByRole('button', { name: 'Picture 2' }).click();
    await expect(tags(page)).toHaveText(['Picture 2']);
    await page.waitForTimeout(600); // 草稿是停手半秒后才存的

    await page.reload();
    await cards(page).first().click();
    await expect(tags(page)).toHaveText(['Picture 2']);
    await input(page).press('ControlOrMeta+a');
    await input(page).press('Backspace');
    await expect(tags(page)).toHaveCount(0);
  });

  await test.step('标签指的图被删出槽位后不让发，提示换一张', async () => {
    await input(page).click();
    await page.keyboard.type('@');
    await picker(page).getByRole('button', { name: 'Picture 1' }).click();
    await expect(tags(page)).toHaveText(['Picture 1']);

    await slots(page).first().hover();
    await panel(page).getByRole('button', { name: '删除 1 号图' }).click();
    await expect(filledSlots(page)).toHaveCount(3);
    await expect(tags(page)).toHaveText(['图不在槽位里了']);
    await input(page).press('Enter');
    await expect(page.getByRole('alert')).toContainText('已经不在槽位里了');
    await page.getByRole('button', { name: '知道了' }).click();
    await input(page).press('ControlOrMeta+a');
    await input(page).press('Backspace');
    await expect(tags(page)).toHaveCount(0);
  });

  await test.step('槽位满了：@ 里再选资产库的图，提示槽位已满，不插标签', async () => {
    for (let i = 0; i < 6; i += 1) await tile(page, FIXTURES.small).dblclick();
    await expect(filledSlots(page)).toHaveCount(9);

    await input(page).click();
    await page.keyboard.type('@');
    await picker(page).getByLabel('搜索资产库').fill('05');
    await pickerTile(page, FIXTURES.fifth).click();
    await expect(page.getByRole('alert')).toContainText('槽位已满');
    await expect(filledSlots(page)).toHaveCount(9);
    await expect(tags(page)).toHaveCount(0);
  });
});
