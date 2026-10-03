import { expect, test, type Page } from '@playwright/test';
import { cards, lastReply, newCanvasWithNode, panel, send, setupWorkFolder, toasts } from './helpers';

const copied = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

// 回复里的标签框和它的小块；小块按显示的英文名找
const box = (page: Page) => lastReply(page).getByTestId('prompt-box');
const boxChip = (page: Page, name: string) => box(page).getByTestId('tag-chip').filter({ has: page.locator('.tg-name', { hasText: new RegExp(`^${name}$`) }) });
const editor = (page: Page) => page.getByRole('dialog', { name: '编辑标签' });
const chips = (page: Page) => editor(page).locator('.te-chip');
const chipNames = (page: Page) => chips(page).locator('.tg-name');

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 面板上的系统提示词换成 il，节点变成生图节点
async function useIl(page: Page) {
  await panel(page).locator('#cfgSys').selectOption('il');
  await expect(toasts(page).filter({ hasText: '这个节点变成生图节点' })).toBeVisible();
}

// 在编辑窗最后打字
async function typeAtEnd(page: Page, text: string) {
  await page.locator('#teInput').press('Control+End');
  await page.keyboard.type(text);
}

test('10.3 第 2 条：系统提示词选 il → 面板是尺寸和张数 → 框里的标签是小块，别名注明原来的写法，不认识的点开换掉 → 复制拿到的是换好的', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await newCanvasWithNode(page, '生图标签');
  await expect(panel(page).locator('#durVal')).toBeVisible();
  await useIl(page);
  await expect(panel(page).locator('#durVal')).toHaveCount(0);
  await expect(panel(page).getByLabel('画面比例')).toHaveCount(0);
  await expect(panel(page).getByLabel('图的尺寸')).toHaveValue('832×1216');
  await expect(panel(page).locator('#imgCount')).toHaveText('4 张');

  await send(page, '写一个');
  await expect(box(page).getByTestId('tag-chip')).toHaveCount(7);
  await expect(boxChip(page, 'long hair').locator('.tg-zh')).toHaveText('长发');
  await expect(boxChip(page, 'blonde hair').locator('.tg-was')).toHaveText('原来写的是 blond hair');
  await expect(box(page).locator('.tg-foot')).toContainText('1 处换成了标准写法');
  await expect(box(page).locator('.tg-foot')).toContainText('1 个词库里没有');

  const golden = boxChip(page, 'golden hair');
  await expect(golden).toHaveClass(/is-unknown/);
  await golden.click();
  const unknown = page.getByRole('dialog', { name: '换掉不认识的标签' });
  await unknown.locator('[data-near="blonde_hair"]').click();
  await expect(toasts(page).filter({ hasText: '「golden hair」换成了「blonde hair」，存成了新版本' })).toBeVisible();
  await expect(lastReply(page).locator('.ver')).toHaveText('2/2');
  await expect(boxChip(page, 'golden hair')).toHaveCount(0);

  await box(page).locator('[data-act="copy"]').click();
  await expect(toasts(page).filter({ hasText: '已复制提示词（7 个标签）' })).toBeVisible();
  const text = await copied(page);
  expect(text).not.toContain('golden hair');
  expect(text).not.toContain('blond hair');
  expect(text).toBe('1girl, solo, long hair, blonde hair, blonde hair, smile, hatsune miku');

  // 首页最近动过的节点：标着生图和系列，写的是尺寸
  await page.goto('/');
  const recent = page.locator('.hm-node').filter({ hasText: '生图标签' }).first();
  await expect(recent.locator('.hm-kind')).toHaveText('生图 · IL');
  await expect(recent.locator('.hm-node-meta')).toContainText('832×1216');
});

test('10.3 第 3 条：编辑窗里打「金发」选第一个候选、拖到最前、权重调到 1.2、存 → 复制以它开头；再打一句中文让 AI 转成标签', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await newCanvasWithNode(page, '标签编辑窗');
  await useIl(page);
  await send(page, '写一个');

  await box(page).locator('[data-act="editTags"]').click();
  await expect(chips(page)).toHaveCount(7);
  await typeAtEnd(page, '金发');
  const first = editor(page).getByRole('option').first();
  await expect(first.locator('.te-s-en')).toHaveText('blonde hair');
  await expect(first.locator('.te-s-zh')).toHaveText('金发');
  await page.keyboard.press('Enter');
  await expect(chips(page)).toHaveCount(8);
  await expect(chipNames(page).last()).toHaveText('blonde hair');

  // 按住拖到第一个小块的左半边
  await chips(page).last().dragTo(chips(page).first(), { targetPosition: { x: 3, y: 8 } });
  await expect(chipNames(page)).toHaveText(['blonde hair', '1girl', 'solo', 'long hair', 'blonde hair', 'golden hair', 'smile', 'hatsune miku']);

  await chips(page).first().click();
  const weight = page.getByRole('dialog', { name: '调权重' });
  await weight.getByRole('button', { name: '加 0.1' }).click();
  await weight.getByRole('button', { name: '加 0.1' }).click();
  await expect(weight.locator('output')).toHaveText('1.2');
  await page.keyboard.press('Escape');
  await expect(weight).toHaveCount(0);
  await expect(editor(page).locator('#tePreview')).toHaveText(/^\(blonde hair:1\.2\), 1girl, /);

  await editor(page).locator('[data-te="save"]').click();
  await expect(editor(page)).toHaveCount(0);
  await expect(toasts(page).filter({ hasText: '存成了第 2 版，标着「手动修改」' })).toBeVisible();
  await box(page).locator('[data-act="copy"]').click();
  await expect(toasts(page).filter({ hasText: '已复制提示词（8 个标签）' })).toBeVisible();
  expect(await copied(page)).toMatch(/^\(blonde hair:1\.2\), /);

  // 再打开，打一整句中文，词库里搜不到，让 AI 转成标签
  await box(page).locator('[data-act="editTags"]').click();
  await expect(chips(page)).toHaveCount(8);
  await typeAtEnd(page, '坐在窗边看书');
  await editor(page).locator('[data-te="toTags"]').click();
  await expect(toasts(page).filter({ hasText: '「坐在窗边看书」转成了 4 个标签' })).toBeVisible();
  await expect(chips(page)).toHaveCount(12);
  await expect(chipNames(page)).toHaveText([
    'blonde hair',
    '1girl',
    'solo',
    'long hair',
    'blonde hair',
    'golden hair',
    'smile',
    'hatsune miku',
    'sitting',
    'window',
    'book',
    'reading',
  ]);
  await expect(chips(page).last().locator('.tg-zh')).not.toHaveText(/不认识/);
  await editor(page).getByRole('button', { name: '放弃' }).click();
});

test('10.3 第 4 条：挑两个小块存成片段 → 另一个生图节点的编辑窗里搜到、插进来 → 设置的片段库里有，删掉后搜不到', async ({ page }) => {
  await newCanvasWithNode(page, '片段');
  await useIl(page);
  await send(page, '写一个');

  await box(page).locator('[data-act="editTags"]').click();
  const pick = editor(page).locator('[data-te="pickMode"]');
  await pick.click();
  await expect(pick).toHaveText('点小块挑几个…');
  await chips(page).nth(2).click();
  await chips(page).nth(3).click();
  await expect(pick).toHaveText('把选中的 2 个存成片段');
  await pick.click();
  const save = page.getByRole('dialog', { name: '存成片段' });
  await expect(save.locator('.te-sf-prev')).toHaveText('long hair, blond hair');
  await save.getByLabel('名字').fill('测试角色');
  await save.getByRole('button', { name: '存', exact: true }).click();
  await expect(toasts(page).filter({ hasText: '存好了片段「测试角色」，以后在「插片段」里能搜到' })).toBeVisible();
  await editor(page).getByRole('button', { name: '放弃' }).click();

  // 另一个生图节点
  await page.getByRole('button', { name: '新建节点' }).click();
  await expect(cards(page)).toHaveCount(2);
  await useIl(page);
  await send(page, '写一个');
  await box(page).locator('[data-act="editTags"]').click();
  await expect(chips(page)).toHaveCount(7);
  await editor(page).locator('[data-te="frag"]').click();
  const picker = page.getByRole('dialog', { name: '插片段' });
  await picker.getByLabel('搜片段名').fill('测试角色');
  await picker.locator('.te-fr').filter({ hasText: '测试角色' }).click();
  await expect(toasts(page).filter({ hasText: '插进了「测试角色」的 2 个标签' })).toBeVisible();
  await expect(chips(page)).toHaveCount(9);
  await expect(chipNames(page).nth(7)).toHaveText('long hair');
  await expect(chipNames(page).nth(8)).toHaveText('blonde hair');
  await editor(page).getByRole('button', { name: '放弃' }).click();

  // 设置的片段库里有，按分类放着；删掉
  await page.goto('/settings#fragments');
  const card = page.locator('[data-fid]').filter({ hasText: '测试角色' });
  await expect(page.locator('[data-od-id="fragments-character"]').locator('[data-fid]')).toHaveCount(1);
  await expect(card).toContainText('2 个标签');
  await expect(card.getByTestId('tag-chip').locator('.tg-name')).toHaveText(['long hair', 'blonde hair']);
  await card.locator('[data-fa="del"]').click();
  await page.getByRole('dialog', { name: '删除片段「测试角色」？' }).getByRole('button', { name: '删除' }).click();
  await expect(toasts(page).filter({ hasText: '删掉了' })).toBeVisible();
  await expect(card).toHaveCount(0);

  // 回到画布，编辑窗里搜不到了
  await page.goBack();
  await cards(page).first().click();
  await box(page).locator('[data-act="editTags"]').click();
  await editor(page).locator('[data-te="frag"]').click();
  await picker.getByLabel('搜片段名').fill('测试角色');
  await expect(picker).toContainText('没有名字里带「测试角色」的片段');
});

test('设置：系统提示词分视频和生图两组，生图的标着系列；固定格式要求两份都能看；词库显示概况', async ({ page }) => {
  await page.goto('/settings#prompts');
  const list = page.locator('#pList');
  await expect(list.locator('.li-sep')).toHaveText(['写视频提示词', '写生图标签 · 节点选了这些就变成生图节点']);
  await expect(list.locator('[data-prompt]')).toHaveText([/^ref2va/, /^i2v/, /^t2v/, /^il/, /^pony/]);
  await expect(list.locator('[data-prompt="il"] .tag-outline')).toHaveText('生图 · IL');
  await expect(list.locator('[data-prompt="pony"] .tag-outline')).toHaveText('生图 · Pony');
  await list.locator('[data-prompt="pony"]').click();
  await expect(page.locator('.editor .hint')).toContainText('（生图那一份）。开头的「用途: 生图」「底模: Pony」是程序认它的依据，别删。');

  await page.locator('[data-tab="format"]').click();
  await expect(page.locator('[data-od-id="format-requirement"]')).toContainText('概括这条视频的内容');
  await expect(page.locator('[data-od-id="format-requirement-image"]')).toContainText('框里只放英文标签');

  await page.locator('[data-tab="taglib"]').click();
  const info = page.locator('#libInfo');
  await expect(info).toContainText('2026-10-03');
  await expect(info).toContainText('124,205 个');
  await expect(info).toContainText('按使用次数算 97.8% 有中文');
  await expect(page.locator('#libUpdate')).toBeVisible();
});
