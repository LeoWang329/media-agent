import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import {
  assetTile,
  assetsDialog,
  cards,
  filledSlots,
  lastReply,
  newCanvasWithNode,
  panel,
  placeFromAssets,
  send,
  setupWorkFolder,
  slotMenu,
  slots,
  toasts,
  waitIdle,
} from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const slotTitle = (index: number, name: string) => new RegExp(`^${index + 1} 号：${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const importFixtures = async (page: Page) => expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);

test('资产库和槽位：导入文件夹，放三张图发送，换 2 号图，删 1 号图，改时长；岔出的节点槽位一样', async ({ page }) => {
  await newCanvasWithNode(page, '资产库');
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).getByRole('button', { name: '导入文件夹' }).click();
  const importing = page.getByRole('dialog', { name: '导入文件夹' });
  await importing.getByLabel('文件夹路径').fill(FIXTURES_DIR);
  await importing.getByRole('button', { name: '导入', exact: true }).click();
  await expect(assetTile(page, FIXTURES.first)).toBeVisible();
  await expect(assetTile(page, FIXTURES.heic)).toContainText('这个格式用不了');
  await expect(assetsDialog(page).locator('#asCount')).toHaveText('已加载 8 / 8 张');
  await page.keyboard.press('Escape');
  await expect(assetsDialog(page)).toHaveCount(0);

  await test.step('10.1 第 2 条：选三张图放进槽位，槽位显示 1、2、3，发出去带全部图', async () => {
    await placeFromAssets(page, [FIXTURES.first, FIXTURES.second, FIXTURES.big]);
    await expect(filledSlots(page).locator('.num-badge')).toHaveText(['1', '2', '3']);
    await expect(cards(page).locator('.gn-slot')).toHaveCount(3);
    await send(page, '写一个');
    await expect(lastReply(page)).toContainText('收到 3 张图：<Picture 1>、<Picture 2>、<Picture 3>');
    await expect(lastReply(page)).toContainText('参考图共 3 张');
    await expect(lastReply(page)).toContainText('视频时长 8 秒');
    await expect(panel(page).getByTestId('message-user').last().locator('.msg-img')).toHaveCount(3);
    await expect(slots(page).nth(2).locator('.proc')).toHaveText('处理过');

    const canvasId = page.url().split('/').at(-1);
    const { images } = await (await page.request.get(`/api/canvases/${canvasId}`)).json();
    const big = Object.values(images as Record<string, { originalName: string; width: number; height: number; processed: { reason: string } }>).find(
      (image) => image.originalName === FIXTURES.big,
    );
    expect(big).toMatchObject({ width: 5760, height: 3840, processed: { reason: 'too-large' } });
  });

  await test.step('10.1 第 3 条：点 2 号槽位换成第四张图，只带换掉的那张', async () => {
    await slotMenu(page, 1, '换一张（从资产库挑）');
    await expect(assetsDialog(page).locator('#asTitle')).toHaveText('换掉 2 号槽位的图');
    await assetTile(page, FIXTURES.fourth).click();
    await expect(assetsDialog(page)).toHaveCount(0);
    await expect(slots(page).nth(1)).toHaveAttribute('title', slotTitle(1, FIXTURES.fourth));
    await expect(panel(page).locator('#pending')).toContainText('有改动还没发出去');
    await send(page, '改一下');
    await expect(lastReply(page)).toContainText('收到 1 张图：<Picture 2>');
    await expect(lastReply(page)).toContainText('换成了');
    await expect(panel(page).locator('#pending')).toHaveCount(0);
  });

  await test.step('10.1 第 4 条：删掉 1 号槽位，全部重新编号', async () => {
    await slotMenu(page, 0, '删掉这格');
    await expect(filledSlots(page)).toHaveCount(2);
    await send(page, '再改');
    await expect(lastReply(page)).toContainText('收到 2 张图');
    await expect(lastReply(page)).toContainText('重新编号');
  });

  await test.step('10.1 第 9 条：时长改成 12，只有说明不带图', async () => {
    for (let i = 0; i < 4; i += 1) await panel(page).getByRole('button', { name: '增加一秒' }).click();
    await expect(panel(page).locator('#durVal')).toHaveText('12 秒');
    await send(page, '长一点');
    await expect(lastReply(page)).toContainText('视频时长改为 12 秒');
    await expect(lastReply(page)).toContainText('收到 0 张图');
  });

  await test.step('10.1 第 5 条：从最后一条回复岔出，新节点槽位和时长一样', async () => {
    await lastReply(page).hover();
    await lastReply(page).getByRole('button', { name: '从这里岔出' }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(panel(page).locator('#drTitle')).toHaveText('测试标题 · 分支');
    await expect(filledSlots(page)).toHaveCount(2);
    await expect(slots(page).first()).toHaveAttribute('title', slotTitle(0, FIXTURES.fourth));
    await expect(panel(page).locator('#durVal')).toHaveText('12 秒');
  });
});

test('切换版本时槽位变回那一版发出时的样子，有没发出的改动先确认，换掉的槽位能撤销', async ({ page }) => {
  await importFixtures(page);
  await newCanvasWithNode(page, '版本和槽位');
  await placeFromAssets(page, [FIXTURES.first]);
  await send(page, '写一个');
  const reply = lastReply(page);
  await reply.hover();
  await reply.getByRole('button', { name: '重答' }).click();
  await expect(reply.locator('.ver')).toHaveText('2/2');
  await waitIdle(page);

  // 放了第 2 张没发：切回第 1 版回复时槽位变回发出时的 1 张，先确认；确认框打开时焦点在「仍然切换」上
  await placeFromAssets(page, [FIXTURES.second]);
  await reply.getByRole('button', { name: '上一个版本' }).click();
  const confirm = page.getByRole('dialog', { name: '有改动还没发出去' });
  await expect(confirm).toContainText('切到第 1 版后，槽位、时长、比例会变回那时候的样子');
  await expect(confirm.getByRole('button', { name: '仍然切换' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(reply.locator('.ver')).toHaveText('1/2');
  await expect(filledSlots(page)).toHaveCount(1);
  await expect(toasts(page).filter({ hasText: '切到第 1 版，槽位变回那时候的 1 张图' })).toBeVisible();
  await expect(panel(page).locator('#pending')).toHaveCount(0);

  // 切版本换掉的槽位能撤回来
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await expect(filledSlots(page)).toHaveCount(2);
  await expect(toasts(page).filter({ hasText: '已撤销：切版本时换了槽位' })).toBeVisible();

  // 取消就不切，槽位也不动
  await reply.getByRole('button', { name: '下一个版本' }).click();
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(reply.locator('.ver')).toHaveText('1/2');
  await expect(filledSlots(page)).toHaveCount(2);

  // 没有没发出的改动时，切到带的图一样的版本不用确认，槽位不动
  await panel(page).getByRole('button', { name: '撤回改动' }).click();
  await expect(filledSlots(page)).toHaveCount(1);
  await reply.getByRole('button', { name: '下一个版本' }).click();
  await expect(reply.locator('.ver')).toHaveText('2/2');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(filledSlots(page)).toHaveCount(1);
});

test('槽位之间拖动调顺序；多选按点的先后放进槽位；换图；按文件名搜索', async ({ page }) => {
  await importFixtures(page);
  await newCanvasWithNode(page, '拖动和搜索');
  await placeFromAssets(page, [FIXTURES.first, FIXTURES.second]);

  await slots(page).nth(1).dragTo(slots(page).nth(0));
  await expect(slots(page).nth(0)).toHaveAttribute('title', slotTitle(0, FIXTURES.second));
  await expect(slots(page).nth(1)).toHaveAttribute('title', slotTitle(1, FIXTURES.first));

  await panel(page).locator('#slotAssets').click();
  await assetTile(page, FIXTURES.fifth).click();
  await assetTile(page, FIXTURES.third).click();
  await expect(assetTile(page, FIXTURES.fifth).locator('.check')).toHaveText('1');
  await expect(assetTile(page, FIXTURES.third).locator('.check')).toHaveText('2');
  await expect(assetsDialog(page).locator('#asSel')).toContainText('已选 2 张，按点选顺序放进 3 号往后');
  await assetsDialog(page).getByRole('button', { name: '放进槽位（2）' }).click();
  await expect(filledSlots(page)).toHaveCount(4);
  await expect(slots(page).nth(2)).toHaveAttribute('title', slotTitle(2, FIXTURES.fifth));
  await expect(slots(page).nth(3)).toHaveAttribute('title', slotTitle(3, FIXTURES.third));

  await slotMenu(page, 0, '换一张（从资产库挑）');
  await assetTile(page, FIXTURES.fourth).click();
  await expect(slots(page).first()).toHaveAttribute('title', slotTitle(0, FIXTURES.fourth));
  await expect(filledSlots(page)).toHaveCount(4);

  // 槽位后面那个加号是下一个空位
  await expect(panel(page).locator('#slots .is-next')).toHaveAttribute('title', '放图进 5 号');
  await panel(page).locator('#slots .is-next').click();
  await assetTile(page, FIXTURES.small).click();
  await assetTile(page, FIXTURES.big).click();
  await assetsDialog(page).getByRole('button', { name: '放进槽位（2）' }).click();
  await expect(filledSlots(page)).toHaveCount(6);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
  await expect(slots(page).nth(4)).toHaveAttribute('title', slotTitle(4, FIXTURES.small));
  await expect(slots(page).nth(5)).toHaveAttribute('title', slotTitle(5, FIXTURES.big));

  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).locator('#asSearch').fill('紫色');
  await expect(assetsDialog(page).locator('#asCount')).toHaveText('1 个结果');
  await expect(assetsDialog(page).getByTestId('asset-tile')).toHaveCount(1);
  await expect(assetsDialog(page).getByTestId('asset-tile')).toContainText(FIXTURES.fifth);
  await expect(assetsDialog(page).getByTestId('asset-tile').locator('.tag.in-slot')).toHaveText('在 3 号');

  // 弹窗里文件夹的「…」菜单点得到：重新扫描；从资产库移除要先确认
  await assetsDialog(page).locator('#asSearch').fill('');
  const folderRow = assetsDialog(page).locator('.as-folder').filter({ hasText: FIXTURES_DIR }).first();
  await folderRow.getByRole('button', { name: '文件夹操作' }).click();
  await page.getByRole('menuitem', { name: '重新扫描' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await folderRow.getByRole('button', { name: '文件夹操作' }).click();
  await page.getByRole('menuitem', { name: '从资产库移除' }).click();
  const confirmRemove = page.getByRole('dialog', { name: '从资产库移除这个文件夹？' });
  await expect(confirmRemove.getByRole('button', { name: '移除' })).toBeFocused();
  await confirmRemove.getByRole('button', { name: '取消' }).click();
  await expect(confirmRemove).toHaveCount(0);
  await expect(assetsDialog(page).locator('.as-folder').filter({ hasText: FIXTURES_DIR })).not.toHaveCount(0);
});

test('点槽位选「放大看」：弹窗里是画布存的那张图，能切原始大小，点图外面的空白关掉', async ({ page }) => {
  await importFixtures(page);
  await newCanvasWithNode(page, '放大看图');
  await placeFromAssets(page, [FIXTURES.first, FIXTURES.second]);

  await slotMenu(page, 1, '放大看');
  const zoom = page.getByRole('dialog', { name: '放大看图' });
  await expect(zoom.locator('.zoom-head')).toContainText(`2 号：${FIXTURES.second} · 800×600`);
  const image = zoom.locator('.zoom-stage img');
  await expect(image).toHaveAttribute('src', /\/api\/canvases\/[0-9a-f-]+\/images\/[0-9a-f-]+\/file$/);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(800);

  await zoom.getByRole('button', { name: '看原始大小' }).click();
  await expect(zoom.locator('.zoom-stage')).toHaveClass(/is-actual/);
  await image.click();
  await expect(zoom.locator('.zoom-stage')).not.toHaveClass(/is-actual/);
  await zoom.locator('.zoom-stage').click({ position: { x: 4, y: 4 } });
  await expect(zoom).toHaveCount(0);
});

test('从 Windows 文件夹直接把两张图拖进槽位，不用先导入文件夹；「电脑里的图」也能选', async ({ page }) => {
  await newCanvasWithNode(page, '从文件夹拖进来');
  const names = [FIXTURES.third, FIXTURES.fourth];
  const read = async (name: string) => ({ name, data: (await fs.readFile(path.join(FIXTURES_DIR, name))).toString('base64') });
  // 浏览器里现造 File，照 Windows 拖文件进来的样子放到槽位上
  const transferOf = (dropped: { name: string; data: string }[]) =>
    page.evaluateHandle((list) => {
      const transfer = new DataTransfer();
      for (const { name, data } of list) {
        transfer.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type: 'image/jpeg' }));
      }
      return transfer;
    }, dropped);
  const dataTransfer = await transferOf(await Promise.all(names.map(read)));
  await panel(page).locator('#slots').dispatchEvent('drop', { dataTransfer });

  await expect(filledSlots(page)).toHaveCount(2);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
  await expect(slots(page).first()).toHaveAttribute('title', slotTitle(0, FIXTURES.third));
  await expect(slots(page).nth(1)).toHaveAttribute('title', slotTitle(1, FIXTURES.fourth));
  await send(page, '写一个');
  await expect(lastReply(page)).toContainText('收到 2 张图：<Picture 1>、<Picture 2>');

  // 拖到有图的格子上：换掉那一格，编号不变
  await slots(page).first().dispatchEvent('drop', { dataTransfer: await transferOf([await read(FIXTURES.first)]) });
  await expect(slots(page).first()).toHaveAttribute('title', slotTitle(0, FIXTURES.first));
  await expect(filledSlots(page)).toHaveCount(2);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);

  await panel(page).locator('#localFile').setInputFiles(path.join(FIXTURES_DIR, FIXTURES.fifth));
  await expect(filledSlots(page)).toHaveCount(3);
  await expect(slots(page).nth(2)).toHaveAttribute('title', slotTitle(2, FIXTURES.fifth));

  // 6000×200 的长条图：缩到 5760 宽后短边还是不到 256，槽位上标「尺寸不符」
  const strip = (await sharp({ create: { width: 6000, height: 200, channels: 3, background: '#7f8c8d' } }).jpeg().toBuffer()).toString('base64');
  await panel(page).locator('#slots').dispatchEvent('drop', { dataTransfer: await transferOf([{ name: 'strip-6000x200.jpg', data: strip }]) });
  await expect(filledSlots(page)).toHaveCount(4);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
  await expect(slots(page).nth(3).locator('.proc')).toHaveText('尺寸不符');
  await expect(slots(page).nth(3)).toHaveAttribute('title', /尺寸不符：现在是 5760×192/);
});
