import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { cards, lastReply, newCanvasWithNode, panel, placeFromAssets, send, setupWorkFolder, toasts } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const box = (page: Page) => lastReply(page).getByTestId('prompt-box');
const act = (page: Page, name: string) => box(page).locator(`[data-act="${name}"]`);
const rows = (page: Page) => page.getByTestId('checklist-row');

// Windows 的剪贴板里换行是 \r\n，比对前换回 \n
const copied = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

test('10.1 第 11 条：上传清单三行，原路径；处理过的那张指向画布副本并标「传处理过的副本」', async ({ page }) => {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, '上传清单');
  await placeFromAssets(page, [FIXTURES.first, FIXTURES.second, FIXTURES.big]);
  await send(page, '写一个');

  await act(page, 'upload').click();
  const checklist = page.getByRole('dialog', { name: '上传清单' });
  await expect(checklist.locator('#upSub')).toHaveText('测试标题 · 提示词 · 共 3 张，按编号顺序上传');
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText(`${FIXTURES_DIR}\\${FIXTURES.first}`);
  await expect(rows(page).nth(1)).toContainText(`${FIXTURES_DIR}\\${FIXTURES.second}`);

  const canvasId = page.url().split('/').at(-1);
  await expect(rows(page).nth(2)).toContainText(`canvases\\${canvasId}\\images\\`);
  await expect(rows(page).nth(2)).toContainText('传处理过的副本');
  await expect(rows(page).nth(2)).toContainText('不要传它');

  // mock 的提示词只引用了 <Picture 1>
  await expect(rows(page).nth(0)).not.toContainText('没用到');
  await expect(rows(page).nth(1)).toContainText('没用到');
  await expect(checklist.locator('.up-alert.is-warn')).toContainText('<Picture 2>、<Picture 3> 在提示词里没用到');
  await expect(checklist.locator('.up-alert.is-danger')).toHaveCount(0);
  await expect(checklist.locator('#upFootNote')).toHaveText('按 1 → 3 的顺序传到第三方平台');
  await checklist.getByRole('button', { name: '好了' }).click();
  await expect(checklist).toHaveCount(0);
});

test('10.1 第 14 条：手动改提示词出新版本，复制的是改过的；引用了不存在的编号时清单顶上标红', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await newCanvasWithNode(page, '改提示词');
  await send(page, '写一个');

  await act(page, 'editBox').click();
  await panel(page).getByRole('textbox', { name: '手动改提示词' }).fill('summary:\n改过的概述，引用了 <Picture 5>');
  await panel(page).getByRole('button', { name: '存成新版本' }).click();

  await expect(lastReply(page).locator('.ver')).toHaveText('2/2');
  await expect(lastReply(page).locator('.msg-head')).toContainText('手动修改');
  await expect(lastReply(page).locator('.msg-meta')).toHaveText('手动修改，没有调用 AI');
  await expect(box(page)).toContainText('改过的概述');
  await expect(cards(page).locator('.gn-sum')).toContainText('改过的概述');
  await expect(toasts(page).filter({ hasText: '存成了第 2 版' })).toBeVisible();

  await act(page, 'copy').click();
  expect(await copied(page)).toBe('summary:\n改过的概述，引用了 <Picture 5>');

  await act(page, 'upload').click();
  const checklist = page.getByRole('dialog', { name: '上传清单' });
  await expect(checklist.locator('.up-alert.is-danger')).toContainText('<Picture 5>');
  await expect(rows(page)).toHaveCount(0);
  await expect(checklist).toContainText('这条提示词没有带参考图，只要复制提示词就行。');
  await page.keyboard.press('Escape');
  await expect(checklist).toHaveCount(0);

  // 切回第 1 版，复制到的是原来的
  await lastReply(page).getByRole('button', { name: '上一个版本' }).click();
  await expect(lastReply(page).locator('.ver')).toHaveText('1/2');
  await act(page, 'copy').click();
  expect(await copied(page)).toContain('测试概述');
});

test('翻译：选语言写要求翻出来，复制的是译文；关掉再点直接看到；换语言另翻，重新翻译换掉旧的', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await newCanvasWithNode(page, '翻译');
  await send(page, '写一个');

  const dialog = page.getByRole('dialog', { name: '翻译提示词' });
  const result = dialog.getByTestId('translation');
  const requirement = dialog.getByLabel('要求（选填）');
  const language = (name: string) => dialog.locator('#trLangs').getByRole('button', { name });
  await act(page, 'translate').click();
  await expect(dialog.locator('#trSub')).toContainText('提示词');
  await expect(dialog.locator('#trSub')).toContainText('用「mock」');
  await expect(dialog.locator('#trSub')).toContainText('mock-model');
  await expect(language('英文')).toHaveAttribute('aria-pressed', 'true');
  await expect(language('日文')).toContainText('还没翻过');
  await expect(dialog.locator('#trEmpty')).toContainText('还没翻成英文');
  await expect(requirement).toBeFocused();

  await language('日文').click();
  await requirement.fill('台词也翻译');
  await dialog.locator('#trRun').click();
  await expect(result).toContainText('译文（日文），按要求：台词也翻译');
  await expect(result).toContainText('测试概述');
  await expect(dialog.locator('#trMeta')).toContainText('当时的要求：台词也翻译');
  await expect(dialog.locator('#trRun')).toHaveText('重新翻译');
  await expect(language('日文')).toHaveAccessibleName(/^日文，.+ 翻过$/);
  await dialog.getByRole('button', { name: '复制译文' }).click();
  expect(await copied(page)).toMatch(/^译文（日文），按要求：台词也翻译\nsubject_definitions:\n/);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // 再打开停在翻过的日文，译文和当时写的要求都在，焦点在「复制译文」上
  await act(page, 'translate').click();
  await expect(language('日文')).toHaveAttribute('aria-pressed', 'true');
  await expect(requirement).toHaveValue('台词也翻译');
  await expect(result).toContainText('译文（日文），按要求：台词也翻译');
  await expect(dialog.getByRole('button', { name: '复制译文' })).toBeFocused();

  await language('英文').click();
  await expect(dialog.locator('#trEmpty')).toContainText('还没翻成英文');
  await expect(requirement).toHaveValue('');

  await language('日文').click();
  await requirement.fill('');
  await dialog.locator('#trRun').click();
  await expect(result).not.toContainText('按要求');
  await expect(result).toContainText('译文（日文）');
  await expect(dialog.locator('#trMeta')).not.toContainText('当时的要求');
});

test('翻译：翻着的时候窗口里的样子，关掉窗口翻好了底部提示；重新翻译时旧译文还在；失败提示带上是哪个框', async ({ page }) => {
  test.setTimeout(60_000);
  await newCanvasWithNode(page, '翻译等待');
  await send(page, '写一个');
  // mock 看提示词原文：含「报错」的第一次返回 500，含「慢」的分 6 秒写完
  await act(page, 'editBox').click();
  await panel(page).getByRole('textbox', { name: '手动改提示词' }).fill(`summary:\n报错 ${Date.now()}，慢慢翻`);
  await panel(page).getByRole('button', { name: '存成新版本' }).click();
  await expect(lastReply(page).locator('.ver')).toHaveText('2/2');

  const dialog = page.getByRole('dialog', { name: '翻译提示词' });
  const run = dialog.locator('#trRun');
  await act(page, 'translate').click();
  await run.click();
  await expect(toasts(page).filter({ hasText: '「提示词」翻成英文失败：' })).toBeVisible();
  await expect(dialog.locator('#trEmpty')).toBeVisible();

  await run.click();
  await expect(dialog.locator('#trWaiting')).toContainText('正在翻成英文');
  await expect(dialog.locator('#trLangs').getByRole('button', { name: '英文' })).toContainText('正在翻');
  await expect(run).toBeDisabled();
  await expect(run).toHaveText('正在翻译');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(toasts(page).filter({ hasText: '「提示词」翻成英文了，点框上的「翻译」看' })).toBeVisible({ timeout: 15_000 });

  await act(page, 'translate').click();
  await expect(dialog.getByTestId('translation')).toContainText('译文（英文）');
  await run.click();
  await expect(dialog.locator('.tr-banner')).toContainText('正在重新翻译');
  await expect(dialog.locator('#trMeta')).toContainText('旧译文');
  await expect(dialog.getByTestId('translation')).toContainText('译文（英文）');
  await expect(dialog.locator('.tr-banner')).toHaveCount(0, { timeout: 15_000 });
  await expect(dialog.locator('#trMeta')).not.toContainText('旧译文');
});

test('星标打在框上、卡片跟着显示；回复角落有模型名、提示词名和 token，点提示词名看当时那版', async ({ page }) => {
  await newCanvasWithNode(page, '星标和角落');
  await send(page, '写一个');

  await act(page, 'star').click();
  await expect(act(page, 'star')).toHaveAttribute('title', '取消星标');
  await expect(act(page, 'star')).toHaveText('已打星');
  await expect(box(page)).toHaveClass(/is-starred/);
  await expect(cards(page).locator('.gn-star')).toBeVisible();
  await act(page, 'star').click();
  await expect(act(page, 'star')).toHaveText('打星');
  await expect(cards(page).locator('.gn-star')).toHaveCount(0);

  const meta = lastReply(page).locator('.msg-meta');
  await expect(meta).toContainText('mock-model');
  await expect(meta).toContainText('tokens');
  await meta.getByRole('button', { name: 'ref2va' }).click();
  const sys = page.getByRole('dialog', { name: '系统提示词原文' });
  await expect(sys.locator('#sysTitle')).toContainText('ref2va · ');
  await expect(sys).toContainText('MiniMax H3 视频提示词写手');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
