import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { E2E_ROOT } from './env';
import {
  assetTile,
  assetsDialog,
  cardTitled,
  cards,
  drawerTitle,
  filledSlots,
  input,
  newCanvasWithNode,
  panel,
  placeFromAssets,
  setupWorkFolder,
  slotMenu,
  slots,
  toasts,
  waitIdle,
} from './helpers';

// 槽位不放重复的图，要塞满 9 格得另外备几张
const EXTRA_DIR = path.join(E2E_ROOT, 'more-images');
const EXTRAS = ['extra-1.jpg', 'extra-2.jpg', 'extra-3.jpg'];

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
  await fs.mkdir(EXTRA_DIR, { recursive: true });
  const colors = ['#2c3e50', '#c0392b', '#27ae60'];
  for (const [i, name] of EXTRAS.entries()) {
    await sharp({ create: { width: 640, height: 480, channels: 3, background: colors[i] } }).jpeg().toFile(path.join(EXTRA_DIR, name));
  }
});

const tags = (page: Page) => input(page).getByTestId('picture-tag');
const bubble = (page: Page) => panel(page).getByTestId('message-user').last().locator('.msg-text');
const picker = (page: Page) => page.locator('#refpick');

test('10.2 第 1、2 条：输入 @ 选图插小标签，调槽位顺序编号跟着变', async ({ page }) => {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  expect((await page.request.post('/api/assets/folders', { data: { path: EXTRA_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, '@ 选图');
  await placeFromAssets(page, [FIXTURES.first, FIXTURES.second, FIXTURES.third]);

  await test.step('10.2 第 1 条：@ 弹出当前 3 张，选 2 号，发出去的文字里是 <Picture 2>', async () => {
    await input(page).click();
    await page.keyboard.type('照着');
    await page.keyboard.type('@');
    await expect(picker(page)).toBeVisible();
    await expect(picker(page).getByRole('button', { name: /^Picture \d$/ })).toHaveCount(3);
    await picker(page).getByRole('button', { name: 'Picture 2' }).click();
    await expect(picker(page)).toHaveCount(0);
    await expect(tags(page)).toHaveText(['Picture 2']);
    await page.keyboard.type('写一个');
    await input(page).press('Enter');
    await expect(bubble(page)).toHaveText('照着<Picture 2> 写一个');
    await waitIdle(page);
  });

  await test.step('手动改提示词：<Picture 1> 显示成小标签，@ 一样能选图', async () => {
    const box = panel(page).getByTestId('prompt-box').last();
    await box.locator('[data-act="editBox"]').click();
    const editing = panel(page).getByRole('textbox', { name: '手动改提示词' });
    await expect(editing.getByTestId('picture-tag')).toHaveText(['Picture 1', 'Picture 1']);

    await editing.click();
    await page.keyboard.press('ControlOrMeta+End');
    // 键盘挪完光标，编辑器要等浏览器下一次通知才知道新位置；像平常一样先打个空格
    await page.keyboard.type(' @');
    await picker(page).getByRole('button', { name: 'Picture 3' }).click();
    await expect(editing.getByTestId('picture-tag')).toHaveText(['Picture 1', 'Picture 1', 'Picture 3']);
    await panel(page).getByRole('button', { name: '存成新版本' }).click();
    await expect(panel(page).getByTestId('prompt-box').last()).toContainText('<Picture 3>');
  });

  await test.step('10.2 第 2 条：在资产库里搜一张不在槽位的图，进 4 号槽位标签写 Picture 4；拖到 1 号位变 Picture 1', async () => {
    await input(page).click();
    await page.keyboard.type('@');
    await picker(page).getByRole('button', { name: '在资产库里找…' }).click();
    await expect(assetsDialog(page).locator('#asTitle')).toHaveText('挑一张图插进句子里');
    await assetsDialog(page).locator('#asSearch').fill('04');
    await assetTile(page, FIXTURES.fourth).click();
    await expect(assetsDialog(page)).toHaveCount(0);
    await expect(filledSlots(page)).toHaveCount(4);
    await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
    await expect(slots(page).nth(3)).toHaveAttribute('title', /^4 号：04-orange\.jpg/);
    await expect(tags(page)).toHaveText(['Picture 4']);
    await expect(toasts(page).filter({ hasText: '04-orange.jpg 先放进了 4 号槽位' })).toBeVisible();

    await slots(page).nth(3).dragTo(slots(page).nth(0));
    await expect(slots(page).first()).toHaveAttribute('title', /^1 号：04-orange\.jpg/);
    await expect(tags(page)).toHaveText(['Picture 1']);
    await input(page).press('Enter');
    await expect(bubble(page)).toHaveText('<Picture 1>');
    await waitIdle(page);
  });

  await test.step('发出后调了槽位顺序再手动改提示词：编号还按这条回复带的图算，存下来不变', async () => {
    const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.url().includes('/nodes/'));
    await slots(page).nth(1).dragTo(slots(page).nth(0));
    await expect(slots(page).first()).toHaveAttribute('title', /^1 号：01-red\.jpg/);
    await saved;

    const box = panel(page).getByTestId('prompt-box').last();
    await box.locator('[data-act="editBox"]').click();
    const editing = panel(page).getByRole('textbox', { name: '手动改提示词' });
    // 回复发出时 04-orange 是 1 号，现在槽位里它是 2 号，这里还显示 Picture 1
    await expect(editing.getByTestId('picture-tag')).toHaveText(['Picture 1', 'Picture 1']);
    await expect(editing.getByTestId('picture-tag').first()).toHaveAttribute('title', '04-orange.jpg：这条回复里的 1 号');
    await editing.click();
    await page.keyboard.press('ControlOrMeta+End');
    // 键盘挪完光标，编辑器要等浏览器下一次通知才知道新位置；像平常一样先打个空格
    await page.keyboard.type(' @');
    await expect(picker(page).locator('h4')).toHaveText(['这条回复带的图']);
    await expect(picker(page).getByRole('button', { name: '在资产库里找…' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await panel(page).getByRole('button', { name: '存成新版本' }).click();
    const edited = panel(page).getByTestId('prompt-box').last();
    await expect(edited).toContainText('<Picture 1>');
    await expect(edited).not.toContainText('<Picture 2>');

    const back = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.url().includes('/nodes/'));
    await slots(page).nth(1).dragTo(slots(page).nth(0));
    await expect(slots(page).first()).toHaveAttribute('title', /^1 号：04-orange\.jpg/);
    await back;
  });

  await test.step('没发出去的草稿里，小标签刷新后还在；存完草稿再调槽位顺序，刷新回来指的还是那张图', async () => {
    await input(page).click();
    // 草稿是停手半秒后才存，等那次 PATCH 回来再刷新
    const draftSaved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.url().includes('/nodes/'));
    await page.keyboard.type('@');
    await picker(page).getByRole('button', { name: 'Picture 2' }).click();
    await expect(tags(page)).toHaveText(['Picture 2']);
    await draftSaved;

    const moved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.url().includes('/nodes/'));
    await slots(page).nth(1).dragTo(slots(page).nth(2));
    await expect(slots(page).nth(2)).toHaveAttribute('title', /^3 号：01-red\.jpg/);
    await expect(tags(page)).toHaveText(['Picture 3']);
    await moved;

    await page.reload();
    await cards(page).first().click();
    await expect(tags(page)).toHaveText(['Picture 3']);
    await input(page).press('ControlOrMeta+a');
    await input(page).press('Backspace');
    await expect(tags(page)).toHaveCount(0);
  });

  await test.step('标签指的图被删出槽位后不让发，提示原因', async () => {
    await input(page).click();
    await page.keyboard.type('@');
    await picker(page).getByRole('button', { name: 'Picture 1' }).click();
    await expect(tags(page)).toHaveText(['Picture 1']);

    await slotMenu(page, 0, '删掉这格');
    await expect(filledSlots(page)).toHaveCount(3);
    await expect(toasts(page).filter({ hasText: '输入框里引用了这张图，现在发不出去' })).toBeVisible();
    await expect(tags(page)).toHaveText(['已不在槽位']);
    await input(page).press('Enter');
    await expect(panel(page).locator('#composerError')).toContainText('第 1 处图片引用（04-orange.jpg）已经不在槽位里了');
    await expect(panel(page).getByTestId('message-user')).toHaveCount(2);
    await input(page).press('ControlOrMeta+a');
    await input(page).press('Backspace');
    await expect(tags(page)).toHaveCount(0);
    await expect(panel(page).locator('#composerError')).toHaveCount(0);
  });

  await test.step('槽位满了：@ 里再选资产库的图，提示槽位满了，不插标签', async () => {
    await placeFromAssets(page, [FIXTURES.fourth, FIXTURES.fifth, FIXTURES.big, FIXTURES.small]);
    await panel(page).locator('#slotAssets').click();
    await assetsDialog(page).locator('.as-folder').filter({ hasText: 'more-images' }).click();
    await assetTile(page, EXTRAS[0]).click();
    await assetTile(page, EXTRAS[1]).click();
    await assetsDialog(page).getByRole('button', { name: '放进槽位（2）' }).click();
    await expect(filledSlots(page)).toHaveCount(9);
    await expect(panel(page).locator('#slots .processing')).toHaveCount(0);

    await input(page).click();
    await page.keyboard.type('@');
    await expect(picker(page)).toContainText('选了会先放进下一个空槽位（已经满了）');
    await picker(page).locator(`button[title="${EXTRAS[2]}"]`).click();
    await expect(toasts(page).filter({ hasText: '槽位满了，这张图放不进去，也就没法引用' })).toBeVisible();
    await expect(filledSlots(page)).toHaveCount(9);
    await expect(tags(page)).toHaveCount(0);
  });

  await test.step('从带图片引用的需求岔出：输入框里预填的引用，不打字就调槽位顺序，刷新后指的还是那张图', async () => {
    // 第一句需求是「照着<Picture 2> 写一个」，发出时槽位是 01-red、02-green、03-blue
    const first = panel(page).getByTestId('message-user').first();
    await first.hover();
    await first.getByRole('button', { name: '从这里岔出' }).click();
    await expect(drawerTitle(page)).toHaveText('测试标题 · 分支');
    await expect(tags(page)).toHaveText(['Picture 2']);

    const moved = page.waitForResponse((res) => res.request().method() === 'PATCH' && Boolean(res.request().postData()?.includes('"slots"')));
    await slots(page).nth(1).dragTo(slots(page).nth(0));
    await expect(slots(page).first()).toHaveAttribute('title', /^1 号：02-green\.jpg/);
    await expect(tags(page)).toHaveText(['Picture 1']);
    await moved;

    await page.reload();
    await cardTitled(page, '测试标题 · 分支').click();
    await expect(tags(page)).toHaveText(['Picture 1']);
    await expect(tags(page).first()).toHaveAttribute('title', /^02-green\.jpg：/);
  });
});
