import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { cardTitled, cards, filledSlots, newCanvasWithNode, panel, placeFromAssets, send, setupWorkFolder, slotMenu, slots, toasts } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const slotTitle = (index: number, name: string) => new RegExp(`^${index + 1} 号：${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

// 焦点在输入框里时 Ctrl+Z 撤销的是打的字，先让焦点离开
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const undo = async (page: Page) => {
  await blur(page);
  await page.keyboard.press('Control+z');
};
const redo = async (page: Page) => {
  await blur(page);
  await page.keyboard.press('Control+Shift+z');
};

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
    await expect(page.locator('#btnUndo')).toHaveAttribute('title', '撤销：移动节点（Ctrl+Z）');
    await undo(page);
    await expect.poll(() => positions(page)).toEqual(before);
    await expect(toasts(page).filter({ hasText: '已撤销：移动节点' })).toBeVisible();
  });

  await panel(page).getByRole('button', { name: '节点操作' }).click();
  await page.getByRole('menuitem', { name: '从最后一条消息岔出' }).click();
  await expect(cards(page)).toHaveCount(2);

  await test.step('删掉父节点连同子节点，Ctrl+Z 两个都回来', async () => {
    await parent.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除节点' }).click();
    await page.getByRole('dialog', { name: '删除「测试标题」？' }).getByRole('button', { name: '删除 2 个节点' }).click();
    await expect(cards(page)).toHaveCount(0);

    await undo(page);
    await expect(cards(page)).toHaveCount(2);
    await expect(parent).toBeVisible();
    // 消息也跟着回来
    await parent.click();
    await expect(panel(page).locator('#drTitle')).toHaveText('测试标题');
    await expect(panel(page).getByTestId('message-assistant')).toHaveCount(1);
  });

  await test.step('改槽位顺序后 Ctrl+Z 顺序恢复，Ctrl+Shift+Z 再换回去', async () => {
    await placeFromAssets(page, [FIXTURES.first, FIXTURES.second]);

    await slots(page).nth(1).dragTo(slots(page).first());
    await expect(slots(page).first()).toHaveAttribute('title', slotTitle(0, FIXTURES.second));
    await undo(page);
    await expect(slots(page).first()).toHaveAttribute('title', slotTitle(0, FIXTURES.first));
    await redo(page);
    await expect(slots(page).first()).toHaveAttribute('title', slotTitle(0, FIXTURES.second));
  });

  await test.step('放进去的图、删掉的图也能撤销', async () => {
    await placeFromAssets(page, [FIXTURES.third]);
    await undo(page);
    await expect(filledSlots(page)).toHaveCount(2);

    await slotMenu(page, 0, '删掉这格');
    await expect(filledSlots(page)).toHaveCount(1);
    await undo(page);
    await expect(filledSlots(page)).toHaveCount(2);
    await expect(slots(page).first()).toHaveAttribute('title', slotTitle(0, FIXTURES.second));
  });

  await test.step('提示条上的「撤销」只撤它说的那一步：马上点能撤；之后又改了别的，就不撤', async () => {
    // 删 2 号：上一步删 1 号的提示条可能还没消失，字不一样才不会点到那条上。删图的提示条等服务端存完才出来
    const removed = toasts(page).filter({ hasText: '删掉了 2 号' });
    await slotMenu(page, 1, '删掉这格');
    await expect(filledSlots(page)).toHaveCount(1);
    await removed.getByRole('button', { name: '撤销' }).click();
    await expect(filledSlots(page)).toHaveCount(2);
    await expect(slots(page).nth(1)).toHaveAttribute('title', slotTitle(1, FIXTURES.first));
    await expect(removed).toHaveCount(0);

    await slotMenu(page, 1, '删掉这格');
    await expect(filledSlots(page)).toHaveCount(1);
    await expect(removed).toBeVisible();
    await panel(page).getByRole('button', { name: '增加一秒' }).click();
    await expect(panel(page).locator('#durVal')).toHaveText('9 秒');
    await removed.getByRole('button', { name: '撤销' }).click();
    await expect(toasts(page).filter({ hasText: '这一步已经撤销过了，或者之后又有别的改动，没有再撤销' })).toBeVisible();
    await expect(filledSlots(page)).toHaveCount(1);
    await expect(panel(page).locator('#durVal')).toHaveText('9 秒');

    await undo(page);
    await expect(panel(page).locator('#durVal')).toHaveText('8 秒');
    await undo(page);
    await expect(filledSlots(page)).toHaveCount(2);
  });

  await test.step('折叠、时长改动都能撤销；已发出的消息不动', async () => {
    await parent.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '折叠子节点（1 个）' }).click();
    await expect(cards(page)).toHaveCount(1);
    await undo(page);
    await expect(cards(page)).toHaveCount(2);

    for (let i = 0; i < 4; i += 1) await panel(page).getByRole('button', { name: '增加一秒' }).click();
    await expect(panel(page).locator('#durVal')).toHaveText('12 秒');
    // 连着点的几下算一步
    await undo(page);
    await expect(panel(page).locator('#durVal')).toHaveText('8 秒');
    await expect(panel(page).getByTestId('message-assistant')).toHaveCount(1);
  });

  await test.step('重新打开画布后撤销栈是空的，按 Ctrl+Z 什么都不发生', async () => {
    for (let i = 0; i < 4; i += 1) await panel(page).getByRole('button', { name: '增加一秒' }).click();
    await expect(panel(page).locator('#durVal')).toHaveText('12 秒');

    await page.getByRole('link', { name: '回到首页' }).click();
    await page.getByRole('link', { name: '打开「撤销」', exact: true }).click();
    await parent.click();
    await expect(panel(page).locator('#durVal')).toHaveText('12 秒');
    await expect(page.locator('#btnUndo')).toBeDisabled();

    let wrote = false;
    page.on('request', (request) => {
      if (['PATCH', 'POST', 'PUT', 'DELETE'].includes(request.method())) wrote = true;
    });
    await undo(page);
    await page.waitForTimeout(200);
    expect(wrote).toBe(false);
    await expect(panel(page).locator('#durVal')).toHaveText('12 秒');
  });
});
