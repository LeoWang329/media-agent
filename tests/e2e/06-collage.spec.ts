import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { newCanvasWithNode, setupWorkFolder } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 拼出来的图存在测试图片文件夹里，跑完删掉
const collages = async () => (await fs.readdir(FIXTURES_DIR)).filter((name) => name.startsWith('collage-'));

test.afterEach(async () => {
  for (const name of await collages()) await fs.rm(path.join(FIXTURES_DIR, name), { force: true });
});

const tile = (page: Page, name: string) => page.locator('.asset-column').getByTestId('asset-tile').filter({ hasText: name });
const board = (page: Page) => page.getByRole('dialog', { name: '拼图' });
const cells = (page: Page) => board(page).getByTestId('collage-cell');

// 左上角 120×120：不带编号时是留白，开了编号那里有黑字
const cornerDarkest = async (file: string) => {
  const corner = await sharp(file).extract({ left: 0, top: 0, width: 120, height: 120 }).toBuffer();
  return Math.min(...(await sharp(corner).stats()).channels.map((c) => c.min));
};

test('10.2 第 3 条：拼图 2×2 四张图，2048×2048；开编号再拼一次，左上角不是纯白', async ({ page }) => {
  // 测试里弹不出系统的选文件夹窗口，按「弹不出来」处理，改用路径输入框
  await page.route('**/api/assets/pick-folder', (route) => route.fulfill({ status: 501, json: { error: '这个系统不能弹窗选择，请直接填写路径' } }));
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, '拼图');

  await page.locator('.asset-column').getByRole('button', { name: '拼图' }).click();
  await expect(cells(page)).toHaveCount(4);
  await expect(board(page)).toContainText('2048×2048 像素');

  const names = [FIXTURES.first, FIXTURES.second, FIXTURES.third, FIXTURES.fourth];
  for (const [i, name] of names.entries()) await tile(page, name).dragTo(cells(page).nth(i));
  await expect(board(page).locator('.collage-cell.filled')).toHaveCount(4);

  await test.step('格子之间拖动调顺序：1 号和 2 号换位置', async () => {
    await cells(page).first().dragTo(cells(page).nth(1));
    await expect(cells(page).first()).toHaveAttribute('title', path.join(FIXTURES_DIR, FIXTURES.second));
    await expect(cells(page).nth(1)).toHaveAttribute('title', path.join(FIXTURES_DIR, FIXTURES.first));
  });

  await test.step('存进资产库里的文件夹：文件是 2048×2048，库里刷新出来', async () => {
    await board(page).getByRole('button', { name: '保存' }).click();
    await board(page).getByLabel('存到哪个文件夹').fill(FIXTURES_DIR);
    await board(page).getByRole('button', { name: '存这里' }).click();
    await expect.poll(collages).toHaveLength(1);

    const file = path.join(FIXTURES_DIR, (await collages())[0]);
    expect(await sharp(file).metadata()).toMatchObject({ width: 2048, height: 2048, format: 'jpeg' });
    expect(await cornerDarkest(file)).toBe(255);
    await expect(tile(page, 'collage-')).toHaveCount(1);
  });

  await test.step('开编号再拼一次：左上角有黑字', async () => {
    const before = await collages();
    await board(page).getByLabel('加编号').check();
    await board(page).getByRole('button', { name: '保存' }).click();
    await board(page).getByLabel('存到哪个文件夹').fill(FIXTURES_DIR);
    await board(page).getByRole('button', { name: '存这里' }).click();
    await expect.poll(collages).toHaveLength(2);

    const file = path.join(FIXTURES_DIR, (await collages()).find((name) => !before.includes(name))!);
    expect(await sharp(file).metadata()).toMatchObject({ width: 2048, height: 2048 });
    expect(await cornerDarkest(file)).toBeLessThan(100);
  });

  await test.step('行列各 1 到 3；都选 1 时不让保存', async () => {
    await board(page).getByLabel('列数').selectOption('3');
    await expect(cells(page)).toHaveCount(6);
    await expect(board(page)).toContainText('3072×2048 像素');
    await board(page).getByLabel('行数').selectOption('1');
    await board(page).getByLabel('列数').selectOption('1');
    await expect(board(page)).toContainText('至少两格');
    await expect(board(page).getByRole('button', { name: '保存' })).toBeDisabled();
  });
});
