import { expect, test, type Page } from '@playwright/test';
import { cardTitled, cards, drawerTitle, input, lastReply, newCanvasWithNode, panel, send, setupWorkFolder, toasts, waitIdle } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 面板里的对话：复制来的消息收在最上面的折叠块里，这里只数节点自己的
const own = (page: Page, testId: 'message-user' | 'message-assistant') => panel(page).locator(`#thread > [data-testid="${testId}"]`);
const userTexts = (page: Page) => panel(page).locator('#thread > .msg-user .msg-text');

test('新建画布和节点，发「写一个」：看到标题、一个提示词框，卡片概述含「测试概述」', async ({ page }) => {
  await newCanvasWithNode(page, '用例 1');
  await send(page, '写一个');
  await expect(drawerTitle(page)).toHaveText('测试标题');
  await expect(panel(page).getByTestId('prompt-box')).toHaveCount(1);
  await expect(cards(page)).toContainText('测试标题');
  await expect(cards(page)).toContainText('测试概述');
  // 模型配置里填了价格，回复角落和面板顶上都显示花了多少
  await expect(lastReply(page).locator('.msg-meta')).toContainText(/¥0\.\d{4}/);
  await expect(panel(page).locator('#drCost')).toContainText(/这个节点花了 ¥0\.\d{4}/);
});

test('从最后一条回复岔出：多一个节点和一条线；在新节点发消息，历史消息数是原路径条数加 1', async ({ page }) => {
  await newCanvasWithNode(page, '用例 5');
  await send(page, '写一个');
  const reply = lastReply(page);
  await reply.hover();
  await reply.getByRole('button', { name: '从这里岔出' }).click();

  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('#edges path')).toHaveCount(1);
  await expect(drawerTitle(page)).toHaveText('测试标题 · 分支');
  await expect(panel(page).locator('#drSub')).toContainText('从「测试标题」第 2 条消息岔出');
  await expect(panel(page).locator('.copied > summary')).toHaveText('从「测试标题」复制来的 2 条消息');
  await expect(own(page, 'message-assistant')).toHaveCount(0);

  await send(page, '继续');
  await expect(lastReply(page)).toContainText('历史消息 3 条');
});

test('从第一条用户消息岔出：新节点输入框预填这句话，没有复制来的消息', async ({ page }) => {
  await newCanvasWithNode(page, '用例 6');
  await send(page, '写一个');
  const user = panel(page).getByTestId('message-user').first();
  await user.hover();
  await user.getByRole('button', { name: '从这里岔出' }).click();

  await expect(cards(page)).toHaveCount(2);
  await expect(drawerTitle(page)).toHaveText('测试标题 · 分支');
  await expect(input(page)).toHaveText('写一个');
  await expect(panel(page).getByTestId('message-user')).toHaveCount(0);
  await expect(panel(page).getByTestId('message-assistant')).toHaveCount(0);
});

test('改第一条用户消息：出现版本切换，后面的消息不见了；切回第 1 版，后面的消息回来', async ({ page }) => {
  await newCanvasWithNode(page, '用例 7');
  await send(page, '写一个');
  await send(page, '再来');
  const first = panel(page).getByTestId('message-user').first();
  await first.hover();
  await first.getByRole('button', { name: '改这句' }).click();
  await panel(page).getByLabel('改这句').fill('写两个');
  await panel(page).getByRole('button', { name: '发送修改' }).click();

  await expect(first.locator('.ver')).toHaveText('2/2');
  await expect(userTexts(page)).toHaveText(['写两个']);
  await waitIdle(page);

  await first.getByRole('button', { name: '上一个版本' }).click();
  await expect(first.locator('.ver')).toHaveText('1/2');
  await expect(userTexts(page)).toHaveText(['写一个', '再来']);
});

test('重答：回复出现版本切换，标着「重答」', async ({ page }) => {
  await newCanvasWithNode(page, '用例 8');
  await send(page, '写一个');
  const reply = lastReply(page);
  await reply.hover();
  await reply.getByRole('button', { name: '重答' }).click();
  await expect(reply.locator('.ver')).toHaveText('2/2');
  await waitIdle(page);
  await expect(reply.getByTestId('prompt-box')).toHaveCount(1);
  // 标题行里还有个「重答」按钮，只看标签
  await expect(reply.locator('.msg-head > .tag')).toHaveText('重答');
});

test('发「三个方向」：三个框，卡片显示「3 个方向」；点第二个框的沿这个方向继续，新节点输入框预填「第 2 个方向」', async ({ page }) => {
  await newCanvasWithNode(page, '用例 10');
  await send(page, '三个方向');
  await expect(panel(page).getByTestId('prompt-box')).toHaveCount(3);
  await expect(cards(page)).toContainText('3 个方向');

  await panel(page).getByTestId('prompt-box').nth(1).getByRole('button', { name: '沿这个方向继续' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(input(page)).toHaveText(/第 2 个方向/);
  await expect(input(page)).toBeFocused();
});

test('折叠有子节点的节点：子节点藏起来、卡片显示收起了几个；删除时确认框写「连同 2 个子节点」，三个一起消失', async ({ page }) => {
  await newCanvasWithNode(page, '用例 12');
  await send(page, '写一个');
  const parent = cardTitled(page, '测试标题');
  for (const count of [2, 3]) {
    await parent.click();
    await expect(drawerTitle(page)).toHaveText('测试标题');
    await panel(page).getByRole('button', { name: '节点操作' }).click();
    await page.getByRole('menuitem', { name: '从最后一条消息岔出' }).click();
    await expect(cards(page)).toHaveCount(count);
  }

  await page.getByRole('button', { name: '自动排整齐' }).click();
  await expect(toasts(page).filter({ hasText: '已排整齐' })).toBeVisible();

  await parent.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '折叠子节点（2 个）' }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(parent.locator('.gn-collapsed')).toHaveText('收起了 2 个节点');
  await parent.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '展开子节点' }).click();
  await expect(cards(page)).toHaveCount(3);

  await parent.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除节点' }).click();
  const confirm = page.getByRole('dialog', { name: '删除「测试标题」？' });
  await expect(confirm).toContainText('连同它下面的 2 个子节点');
  await confirm.getByRole('button', { name: '删除 3 个节点' }).click();
  await expect(cards(page)).toHaveCount(0);
  await expect(toasts(page).filter({ hasText: '已删除 3 个节点' })).toBeVisible();
});

test('改名：卡片菜单里改节点名、点顶上改画布名，AI 之后不再覆盖节点标题', async ({ page }) => {
  await newCanvasWithNode(page, '改名');
  await send(page, '写一个');
  const card = cardTitled(page, '测试标题');
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名' }).click();
  // 改名时标题换成了输入框，卡片按标题找不到了，直接找输入框
  const rename = page.locator('.gnode input.ws-rename');
  await rename.fill('我起的名字');
  await rename.press('Enter');
  await expect(cardTitled(page, '我起的名字')).toHaveCount(1);
  await expect(drawerTitle(page)).toHaveText('我起的名字');
  await expect(panel(page).locator('#drSub')).toContainText('标题手动改过，AI 不再覆盖');

  await send(page, '再来');
  await expect(drawerTitle(page)).toHaveText('我起的名字');

  await page.locator('#canvasTitle').click();
  await page.locator('.ws-top input').fill('改过的画布');
  await page.locator('.ws-top input').press('Enter');
  await expect(page.locator('#canvasTitle')).toHaveText('改过的画布');
  await expect(page).toHaveTitle('改过的画布 · 提示词画布');
});

test('发「报错」：显示请求失败和重试，重试成功', async ({ page }) => {
  await newCanvasWithNode(page, '用例 13');
  await send(page, `报错 ${Date.now()}`);
  const reply = lastReply(page);
  await expect(reply.locator('.failbox')).toContainText('请求失败');
  await expect(cards(page).locator('.tag-danger')).toHaveText('请求失败');
  await reply.getByRole('button', { name: '重试' }).click();
  await expect(reply.getByTestId('prompt-box')).toHaveCount(1);
  await waitIdle(page);
  // 照原型：重试是把失败那条换掉，不多出一个版本，也不标「重答」
  await expect(panel(page).getByTestId('message-assistant')).toHaveCount(1);
  await expect(reply.locator('.ver')).toHaveCount(0);
  await expect(reply.locator('.msg-head > .tag')).toHaveCount(0);
  await expect(cards(page).locator('.tag-danger')).toHaveCount(0);
});

test('失败以后没点重试、接着聊了几句，再回去重试：失败那版连同后面的对话还能切回去', async ({ page }) => {
  await newCanvasWithNode(page, '用例 13 接着聊');
  await send(page, `报错 ${Date.now()}`);
  const failed = panel(page).getByTestId('message-assistant').first();
  await expect(failed.locator('.failbox')).toContainText('请求失败');
  await send(page, '写一个');
  await expect(panel(page).getByTestId('message-user')).toHaveCount(2);

  await failed.getByRole('button', { name: '重试' }).click();
  await expect(failed.getByTestId('prompt-box')).toHaveCount(1);
  await waitIdle(page);
  await expect(panel(page).getByTestId('message-user')).toHaveCount(1);
  await expect(failed.locator('.ver')).toHaveText('2/2');
  await failed.getByRole('button', { name: '上一个版本' }).click();
  await expect(failed.locator('.failbox')).toContainText('请求失败');
  await expect(panel(page).getByTestId('message-user')).toHaveCount(2);
  await expect(panel(page).getByTestId('message-user').last()).toContainText('写一个');
});

test('生成中点停止：保留已收到的部分，标着「已叫停」，可以接着发', async ({ page }) => {
  await newCanvasWithNode(page, '停止');
  await input(page).fill('慢一点');
  await input(page).press('Enter');
  const reply = lastReply(page);
  await expect(reply).toContainText('收到 0 张图');
  await expect(cards(page).locator('.tag-accent')).toContainText('生成中');
  await panel(page).getByRole('button', { name: '停止' }).click();
  await waitIdle(page);
  await expect(reply).toContainText('收到 0 张图');
  await expect(reply.locator('.msg-head')).toContainText('已叫停');
  // 叫停时框还没写完的话会显示成「不完整」，完整的框一个都没有
  await expect(reply.locator('.pbox:not(.is-writing)')).toHaveCount(0);

  await send(page, '继续');
  await expect(lastReply(page)).toContainText('历史消息 3 条');
});

test('对话目录：在面板左边列出每一轮和回复写了什么，点一下跳到那一轮；开着的状态刷新后还在', async ({ page }) => {
  await newCanvasWithNode(page, '对话目录');
  for (const text of ['第一轮需求', '第二轮只回答', '第三轮要三个方向']) await send(page, text);

  await panel(page).locator('#drOutline').click();
  const outline = page.getByRole('navigation', { name: '对话目录' });
  const items = outline.getByTestId('outline-item');
  await expect(outline).toContainText('对话目录 · 3 轮');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('第一轮需求');
  await expect(items.nth(0)).toContainText('测试概述');
  await expect(items.nth(1)).toContainText('没有提示词');
  await expect(items.nth(2)).toContainText('3 个方向 · 方向一：测试方向一');
  // 目录浮在面板左边，不挡画布顶上的工具条（等滑出来的动画走完再量）
  await outline.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const [outlineBox, drawerBox, toolsBox] = await Promise.all([outline.boundingBox(), panel(page).boundingBox(), page.locator('#tools').boundingBox()]);
  expect(drawerBox!.x - (outlineBox!.x + outlineBox!.width)).toBeGreaterThanOrEqual(0);
  expect(drawerBox!.x - (outlineBox!.x + outlineBox!.width)).toBeLessThanOrEqual(12);
  expect(outlineBox!.y).toBeGreaterThan(toolsBox!.y + toolsBox!.height);

  // 发完三轮停在最底下，第一轮在上面看不见；点目录第一项跳过去
  const first = own(page, 'message-user').first();
  const inView = async () => {
    const [box, area] = await Promise.all([first.boundingBox(), panel(page).locator('#thread').boundingBox()]);
    return box!.y >= area!.y - 1 && box!.y < area!.y + area!.height / 2;
  };
  expect(await inView()).toBe(false);
  await items.nth(0).click();
  await expect.poll(inView).toBe(true);
  await expect(first).toHaveClass(/is-located/);

  await page.reload();
  await cards(page).first().click();
  await expect(outline).toBeVisible();
  await outline.getByRole('button', { name: '收起对话目录' }).click();
  await expect(outline).toHaveCount(0);
  await expect(panel(page).locator('#drOutline')).toHaveAttribute('aria-pressed', 'false');
});
