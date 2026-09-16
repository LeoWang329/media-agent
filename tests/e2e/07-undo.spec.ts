import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { cards, newCanvasWithNode, panel, send, setupWorkFolder } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const tile = (page: Page, name: string) => page.locator('.asset-column').getByTestId('asset-tile').filter({ hasText: name });
const slots = (page: Page) => panel(page).getByTestId('slot');
const filledSlots = (page: Page) => panel(page).locator('.slot.filled');
const cardTitled = (page: Page, title: string) => cards(page).filter({ has: page.locator('.node-title', { hasText: new RegExp(`^${title}$`) }) });

const undo = (page: Page) => page.keyboard.press('Control+z');
const redo = (page: Page) => page.keyboard.press('Control+Shift+z');

const positions = async (page: Page) => {
  const canvasId = page.url().split('/').at(-1);
  const detail = await (await page.request.get(`/api/canvases/${canvasId}`)).json();
  return (detail.nodes as { id: string; x: number; y: number }[]).map((node) => `${node.x},${node.y}`);
};

test('10.2 第 4 条：删除节点后 Ctrl+Z 连子节点一起回来；改槽位顺序后 Ctrl+Z 顺序恢复', async ({ page }) => {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, '撤销');
  await send(page, '写一个');
  const parent = cardTitled(page, '测试标题');

  await test.step('拖动节点后 Ctrl+Z 回到原位', async () => {
    const before = await positions(page);
    const box = (await parent.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 70, { steps: 5 });
    await page.mouse.move(box.x + 230, box.y + 130, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => positions(page)).not.toEqual(before);
    await undo(page);
    await expect.poll(() => positions(page)).toEqual(before);
  });

  await parent.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'fork 到新节点' }).click();
  await expect(cards(page)).toHaveCount(2);

  await test.step('删掉父节点连同子节点，Ctrl+Z 两个都回来', async () => {
    page.once('dialog', (dialog) => void dialog.accept());
    await parent.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除' }).click();
    await expect(cards(page)).toHaveCount(0);

    await undo(page);
    await expect(cards(page)).toHaveCount(2);
    await expect(cardTitled(page, '测试标题')).toBeVisible();
    // 消息也跟着回来
    await cardTitled(page, '测试标题').click();
    await expect(panel(page).getByTestId('message-assistant')).toHaveCount(1);
  });

  await test.step('改槽位顺序后 Ctrl+Z 顺序恢复，Ctrl+Shift+Z 再换回去', async () => {
    for (const name of [FIXTURES.first, FIXTURES.second]) await tile(page, name).dblclick();
    await expect(filledSlots(page)).toHaveCount(2);

    await slots(page).nth(1).dragTo(slots(page).first());
    await expect(slots(page).first()).toHaveAttribute('title', FIXTURES.second);
    await undo(page);
    await expect(slots(page).first()).toHaveAttribute('title', FIXTURES.first);
    await redo(page);
    await expect(slots(page).first()).toHaveAttribute('title', FIXTURES.second);
  });

  await test.step('放进去的图、删掉的图也能撤销', async () => {
    await tile(page, FIXTURES.third).dblclick();
    await expect(filledSlots(page)).toHaveCount(3);
    await undo(page);
    await expect(filledSlots(page)).toHaveCount(2);

    await slots(page).first().hover();
    await panel(page).getByRole('button', { name: '删除 1 号图' }).click();
    await expect(filledSlots(page)).toHaveCount(1);
    await undo(page);
    await expect(filledSlots(page)).toHaveCount(2);
    await expect(slots(page).first()).toHaveAttribute('title', FIXTURES.second);
  });

  await test.step('折叠、时长改动都能撤销；已发出的消息不动', async () => {
    await parent.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '折叠' }).click();
    await expect(cards(page)).toHaveCount(1);
    await undo(page);
    await expect(cards(page)).toHaveCount(2);

    await panel(page).getByLabel('视频时长').selectOption('12');
    await expect(panel(page).getByLabel('视频时长')).toHaveValue('12');
    await undo(page);
    await expect(panel(page).getByLabel('视频时长')).toHaveValue('8');
    await expect(panel(page).getByTestId('message-assistant')).toHaveCount(1);
  });

  await test.step('重新打开画布后撤销栈是空的，按 Ctrl+Z 什么都不发生', async () => {
    await panel(page).getByLabel('视频时长').selectOption('12');
    await expect(panel(page).getByLabel('视频时长')).toHaveValue('12');

    const canvasPath = new URL(page.url()).pathname;
    await page.getByRole('link', { name: '首页' }).click();
    await page.locator(`a[href="${canvasPath}"]`).click();
    await cardTitled(page, '测试标题').click();
    await expect(panel(page).getByLabel('视频时长')).toHaveValue('12');

    let wrote = false;
    page.on('request', (request) => {
      if (request.method() === 'PATCH' || request.method() === 'POST') wrote = true;
    });
    await undo(page);
    await page.waitForTimeout(200);
    expect(wrote).toBe(false);
    await expect(panel(page).getByLabel('视频时长')).toHaveValue('12');
  });
});
