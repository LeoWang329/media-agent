import { expect, test } from '@playwright/test';
import { cards, newCanvasWithNode, newNode, panel, send, setupWorkFolder } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

test('10.3 第 17 条：「新建节点」点开选「生图节点」→ 卡片标「生图 · IL」、边框是紫色，系统提示词下拉只有生图用的 → 换成 pony → 再新建一个视频节点，卡片标「视频」，下拉只有视频用的 → 从生图节点岔出的还是生图节点', async ({ page }) => {
  await newCanvasWithNode(page, '两种节点', '生图节点');
  const kinds = cards(page).locator('.gn-kind');
  const options = panel(page).locator('#cfgSys option');
  await expect(kinds).toHaveText(['生图 · IL']);
  await expect(options).toHaveText(['il · IL', 'pony · Pony']);
  await expect(panel(page).getByLabel('图的尺寸')).toHaveValue('832×1216');
  await panel(page).locator('#cfgSys').selectOption('pony');
  await expect(kinds).toHaveText(['生图 · Pony']);

  await newNode(page);
  await expect(kinds).toHaveText(['生图 · Pony', '视频']);
  await expect(options).toHaveText(['ref2va', 'i2v', 't2v']);
  await expect(panel(page).locator('#durVal')).toBeVisible();

  // 都不选中时，生图节点的边框和视频节点的不一样
  await panel(page).locator('#drClose').click();
  await page.mouse.move(0, 0);
  await expect(cards(page).first()).toHaveClass(/is-image/);
  await expect(cards(page).nth(1)).not.toHaveClass(/is-image/);
  const border = (i: number) => cards(page).nth(i).evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(await border(0)).not.toBe(await border(1));

  // 生图节点岔出来的还是生图节点
  await cards(page).first().click();
  await send(page, '写一个');
  await panel(page).locator('#drMenu').click();
  await page.getByRole('menuitem', { name: '从最后一条消息岔出' }).click();
  await expect(kinds).toHaveText(['生图 · Pony', '视频', '生图 · Pony']);
  await expect(options).toHaveText(['il · IL', 'pony · Pony']);
});
