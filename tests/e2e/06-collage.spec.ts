import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { assetTile, assetsDialog, filledSlots, newCanvasWithNode, panel, setupWorkFolder, slots, toasts } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 拼出来的图存在测试图片文件夹里，跑完删掉
const collages = async () => (await fs.readdir(FIXTURES_DIR)).filter((name) => name.startsWith('collage-'));

test.afterEach(async () => {
  for (const name of await collages()) await fs.rm(path.join(FIXTURES_DIR, name), { force: true });
});

const board = (page: Page) => page.getByRole('dialog', { name: '拼图' });
const cells = (page: Page) => board(page).getByTestId('collage-cell');
const pickImage = (page: Page, name: string) => board(page).locator(`.cl-pick-grid button[title="${name}"]`);

// 左上角 120×120：不带编号时是留白，开了编号那里有黑字
const cornerDarkest = async (file: string) => {
  const corner = await sharp(file).extract({ left: 0, top: 0, width: 120, height: 120 }).toBuffer();
  return Math.min(...(await sharp(corner).stats()).channels.map((c) => c.min));
};

// 打开拼图弹窗，从测试图片文件夹里按顺序点四张，依次放进四个格子
async function openWithFour(page: Page) {
  await panel(page).getByRole('button', { name: '拼图' }).click();
  await expect(cells(page)).toHaveCount(4);
  await board(page).getByLabel('从哪个文件夹挑图').selectOption(FIXTURES_DIR);
  for (const name of [FIXTURES.first, FIXTURES.second, FIXTURES.third, FIXTURES.fourth]) await pickImage(page, name).click();
  await expect(cells(page).locator('img')).toHaveCount(4);
  await board(page).locator('#clDest').selectOption(FIXTURES_DIR);
}

test('10.2 第 3 条：拼图 2×2 四张图，2048×2048；关掉编号拼一次，再带着默认的编号拼一次放进槽位，左上角不是纯白', async ({ page }) => {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, '拼图');
  await openWithFour(page);
  await expect(board(page).locator('#clFoot')).toContainText('2048×2048');
  await expect(board(page).locator('#clFoot')).toContainText('4 格，已放 4 张');

  await test.step('格子之间拖动调顺序：1 号和 2 号换位置', async () => {
    await cells(page).first().dragTo(cells(page).nth(1));
    await expect(cells(page).first().locator('img')).toHaveAttribute('alt', FIXTURES.second);
    await expect(cells(page).nth(1).locator('img')).toHaveAttribute('alt', FIXTURES.first);
  });

  await test.step('关掉编号，只保存进资产库里的文件夹：文件是 2048×2048，左上角留白，库里能看到', async () => {
    await board(page).getByText('每格左上角加编号').click();
    await expect(cells(page).locator('.cl-no')).toHaveCount(0);
    await board(page).locator('#clName').fill('collage-plain.jpg');
    await board(page).getByRole('button', { name: '只保存' }).click();
    await expect(board(page)).toHaveCount(0);
    await expect.poll(collages).toEqual(['collage-plain.jpg']);
    await expect(toasts(page).filter({ hasText: '资产库里已经能看到' })).toBeVisible();

    const file = path.join(FIXTURES_DIR, 'collage-plain.jpg');
    expect(await sharp(file).metadata()).toMatchObject({ width: 2048, height: 2048, format: 'jpeg' });
    expect(await cornerDarkest(file)).toBe(255);
    await expect(filledSlots(page)).toHaveCount(0);

    await panel(page).locator('#slotAssets').click();
    await assetsDialog(page).locator('.as-folder').filter({ hasText: 'fixtures' }).click();
    await expect(assetTile(page, 'collage-plain.jpg')).toHaveCount(1);
    await page.keyboard.press('Escape');
  });

  await test.step('再拼一次，编号默认开着，保存并放进槽位：左上角有黑字', async () => {
    await openWithFour(page);
    await expect(cells(page).locator('.cl-no')).toHaveText(['1', '2', '3', '4']);
    await board(page).locator('#clName').fill('collage-numbered.jpg');
    await board(page).getByRole('button', { name: '保存并放进槽位' }).click();
    await expect(board(page)).toHaveCount(0);
    await expect.poll(collages).toHaveLength(2);

    const file = path.join(FIXTURES_DIR, 'collage-numbered.jpg');
    expect(await sharp(file).metadata()).toMatchObject({ width: 2048, height: 2048 });
    expect(await cornerDarkest(file)).toBeLessThan(100);
    await expect(filledSlots(page)).toHaveCount(1);
    await expect(slots(page).first()).toHaveAttribute('title', /^1 号：collage-numbered\.jpg/);
  });

  await test.step('行列各 1 到 3；都是 1 时不让保存', async () => {
    await panel(page).getByRole('button', { name: '拼图' }).click();
    await board(page).getByRole('button', { name: '列数加一' }).click();
    await expect(cells(page)).toHaveCount(6);
    await expect(board(page).locator('#clFoot')).toContainText('3072×2048');
    await expect(board(page).getByRole('button', { name: '列数加一' })).toBeDisabled();
    await board(page).getByRole('button', { name: '行数减一' }).click();
    await board(page).getByRole('button', { name: '列数减一' }).click();
    await board(page).getByRole('button', { name: '列数减一' }).click();
    await expect(cells(page)).toHaveCount(1);
    await expect(board(page)).toContainText('1×1 不算拼图，至少要 2 格');
    await expect(board(page).getByRole('button', { name: '只保存' })).toBeDisabled();
    await expect(board(page).getByRole('button', { name: '保存并放进槽位' })).toBeDisabled();
  });
});
