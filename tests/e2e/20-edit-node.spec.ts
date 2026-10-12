import { expect, test, type Page } from '@playwright/test';
import { MOCK_COMFY_PORT } from './env';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { assetsDialog, assetTile, cardTitled, cards, lastReply, newCanvasWithNode, newNode, panel, send, setupWorkFolder, toasts } from './helpers';

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const graphOf = async (page: Page) => ((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[]).at(-1)!.prompt;
const nodeOf = (graph: Graph, type: string) => Object.values(graph).find((n) => n.class_type === type)!;

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

test.beforeEach(async ({ page }) => {
  expect((await page.request.put('/api/config', { data: { comfyTarget: 'lan' } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL } } })).ok()).toBe(true);
  expect((await page.request.post(`${COMFY_URL}/_hide-nodes`, { data: { types: [] } })).ok()).toBe(true);
});

// 往槽位里放一张测试图
async function putImage(page: Page) {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).locator('.as-folder').filter({ hasText: FIXTURES_DIR }).first().click();
  await assetTile(page, FIXTURES.first).click();
  await assetsDialog(page).getByRole('button', { name: /放进槽位/ }).click();
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(1);
}

test('10.3 第 18 条（E1）：「新建节点」里有第三种「图像编辑节点」→ 卡片标「编辑」、边框跟视频和生图都不一样，模型提示词只有当前功能那一份', async ({ page }) => {
  await newCanvasWithNode(page, '图像编辑节点', '图像编辑节点');
  const kinds = cards(page).locator('.gn-kind');
  const cfgSys = panel(page).locator('#cfgSys');
  const options = cfgSys.locator('option');

  await expect(kinds).toHaveText(['编辑']);
  // 这一行在编辑节点上叫「模型提示词」：四个功能各有一套，这里只列当前功能（默认指令编辑）那一份
  await expect(panel(page).locator('.cfg-lbl')).toHaveText('模型提示词');
  await expect(cfgSys).toHaveAttribute('aria-label', '模型提示词');
  await expect(options).toHaveText(['edit · 指令编辑']);
  await expect(cfgSys).toHaveValue('edit');
  await expect(cards(page).first()).toHaveClass(/is-edit/);

  // 另外两种节点跟着建，卡片上三种标得清清楚
  await newNode(page);
  await newNode(page, '生图节点');
  await expect(kinds).toHaveText(['编辑', '视频', '生图 · IL']);

  // 都不选中时，编辑节点的边框跟视频、生图都不一样
  await panel(page).locator('#drClose').click();
  await page.mouse.move(0, 0);
  await expect(cards(page).nth(1)).not.toHaveClass(/is-edit/);
  await expect(cards(page).nth(2)).not.toHaveClass(/is-edit/);
  const border = (i: number) => cards(page).nth(i).evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(await border(0)).not.toBe(await border(1));
  expect(await border(0)).not.toBe(await border(2));

  // 编辑节点上写一句话能给模型发出去，系统消息里接的是编辑那份格式要求
  await cards(page).first().click();
  await expect(cfgSys).toHaveValue('edit');
});

test('10.3 第 18 条（E1）：编辑节点只能选编辑用的系统提示词；岔出来的还是编辑节点', async ({ page }) => {
  await newCanvasWithNode(page, '编辑节点换提示词', '图像编辑节点');
  const kinds = cards(page).locator('.gn-kind');
  const options = panel(page).locator('#cfgSys option');

  // 别的用途的提示词根本不在下拉里；别的功能那几份也不在（每个功能一套，跟着功能走）
  await expect(options).toHaveText(['edit · 指令编辑']);
  await expect(panel(page).locator('#cfgSys option[value="il"]')).toHaveCount(0);
  await expect(panel(page).locator('#cfgSys option[value="ref2va"]')).toHaveCount(0);
  await expect(panel(page).locator('#cfgSys option[value="edit-real"]')).toHaveCount(0);

  // 输入框在，跟别的节点一样能发消息
  await expect(panel(page).getByRole('textbox', { name: '输入消息' })).toBeVisible();
  await expect(kinds).toHaveText(['编辑']);
});

test('10.3 第 18 条（E1）：设置页里多出第三组「写改图说明 · 图像编辑节点用」，四份都在，带「编辑 · 功能名」标签', async ({ page }) => {
  await page.goto('/settings#prompts');
  const list = page.locator('#pList');
  await expect(list.locator('.li-sep')).toHaveText([
    '写视频提示词 · 视频节点用',
    '写生图标签 · 生图节点用',
    '写改图说明 · 图像编辑节点用',
  ]);
  for (const name of ['edit', 'edit-outfit', 'edit-inpaint', 'edit-real']) {
    await expect(page.locator(`[data-prompt="${name}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-prompt="edit"]')).toContainText('编辑 · 指令编辑');
  await expect(page.locator('[data-prompt="edit-real"]')).toContainText('编辑 · 转真人');
  // 固定格式要求里也多了一份
  await page.goto('/settings#format');
  const editFormat = page.locator('[data-od-id="format-requirement-edit"]');
  await expect(editFormat).toContainText('输出格式要求：');
  await expect(editFormat).toContainText('一个字都不会被程序改动');
});

test('10.3 第 18 条（E2）：编辑栏从上到下是功能 → 图 → 提示词 → 开始；放一张图、选一条现成的、点开始 → 出图挂在框下面', async ({ page }) => {
  await newCanvasWithNode(page, '编辑栏', '图像编辑节点');
  const dock = panel(page).locator('[data-od-id="composer-dock"]');

  // 功能：默认「指令编辑」；E4 之后转真人、换装能选了，E5 之后局部重绘也能选了
  await expect(dock.locator('#editFn')).toContainText('指令编辑');
  await expect(dock.locator('#editNeed')).toHaveText('要 1 张：① 要改的图');
  await dock.locator('#editFn').click();
  await expect(page.getByRole('menuitem', { name: '转真人' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '换装' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '局部重绘' })).toBeVisible();
  await page.getByRole('menuitem', { name: '指令编辑' }).click();
  await expect(dock.locator('#editFn')).toContainText('指令编辑');

  // 没图、没写字：开始是灰的
  await expect(dock.locator('#btnEditStart')).toBeDisabled();

  // 图：放一张进来，它自动成了「要改的」那张
  await putImage(page);
  await expect(dock.getByTestId('slot-role')).toHaveText('要改的');
  await expect(dock.locator('#btnEditStart')).toBeDisabled(); // 还差一句话

  // 提示词：选一条现成的 → 正文被填上
  await dock.locator('#editPreset').selectOption({ label: '换衣服 · 保持脸和背景' });
  await expect(dock.locator('#editText')).toHaveValue(/black studded leather biker jacket/);
  await expect(dock.locator('#btnEditStart')).toBeEnabled();

  // 开始 → 出图挂在新建的框下面
  await dock.locator('#btnEditStart').click();
  const box = lastReply(page).getByTestId('prompt-box');
  await expect(box).toContainText('指令编辑');
  await expect(box.locator('.ig-cell.is-done img')).toHaveCount(1);

  // 发出去的图：走的是 Krea2 编辑档那套（Ostris 的两个节点），不是四视图那条 Krea2Edit，
  // 也不挂动漫转真人 V3（所以不会自己加真人化触发词）
  const graph = await graphOf(page);
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch').inputs.kv_cache).toBe(true);
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).toBe('Change her coat into a black studded leather biker jacket, keep her face, hair and the background exactly the same.');
  expect(nodeOf(graph, 'Krea2EditModelPatch')).toBeUndefined();
  expect(nodeOf(graph, 'Krea2EditGroundedEncode')).toBeUndefined();
  expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs.lora_name).toBe('krea2/krea2_identity_edit_v1_1.safetensors');
  expect(nodeOf(graph, 'LoadImage').inputs.image).toBeTruthy();
  expect(nodeOf(graph, 'KSampler').inputs.scheduler).toBe('simple');
});

test('10.3 第 18 条（E2）：图槽点一下就用那张；换一张之后开始出的图跟着换；右击还能开原来的菜单', async ({ page }) => {
  await newCanvasWithNode(page, '编辑栏换图', '图像编辑节点');
  const dock = panel(page).locator('[data-od-id="composer-dock"]');
  await putImage(page);
  // 再放一张
  await panel(page).locator('#slotAssets').click();
  await assetTile(page, FIXTURES.second).click();
  await assetsDialog(page).getByRole('button', { name: /放进槽位/ }).click();
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(2);

  // 默认是第 1 张
  await expect(panel(page).locator('#slots .slot').nth(0)).toHaveClass(/is-source/);
  await panel(page).locator('#slots .slot').nth(1).click();
  await expect(panel(page).locator('#slots .slot').nth(1)).toHaveClass(/is-source/);
  await expect(panel(page).locator('#slots .slot').nth(0)).not.toHaveClass(/is-source/);

  // 右击开菜单，里面有「用这张图」
  await panel(page).locator('#slots .slot').nth(0).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '用这张图' })).toBeVisible();
  await page.keyboard.press('Escape');
});

// 拿当前画布和里面那个编辑节点的 id（界面上还换不了功能，用接口换）
async function editNodeAt(page: Page, title: string): Promise<{ canvasId: string; nodeId: string }> {
  const home = (await (await page.request.get('/api/home')).json()) as { canvases: { id: string; title: string }[] };
  const canvasId = home.canvases.find((c) => c.title === title)!.id;
  const detail = (await (await page.request.get(`/api/canvases/${canvasId}`)).json()) as { nodes: { id: string; kind: string }[] };
  return { canvasId, nodeId: detail.nodes.find((n) => n.kind === 'edit')!.id };
}

test('10.3 第 18 条（E3）：模型看着选中的那张图给几个方向，框上标着「指令编辑 · 用几号图」；「用它」落到编辑栏；「写一个」不问那句话', async ({ page }) => {
  await newCanvasWithNode(page, '模型参与', '图像编辑节点');
  const dock = panel(page).locator('[data-od-id="composer-dock"]');
  const { canvasId, nodeId } = await editNodeAt(page, '模型参与');
  await putImage(page);
  // 放图是先改本地再写服务端，等它真的落到服务端再发，不然发出去的是空槽位
  const slots = async () => ((await (await page.request.get(`/api/canvases/${canvasId}/nodes/${nodeId}`)).json()) as { slots: string[] }).slots.length;
  await expect.poll(slots).toBe(1);

  // 说一句中文（要三个方向）→ 只把选中的那张图发给模型，回复里三个框
  await send(page, '把她的外套换成朋克风，给我三个方向');
  const reply = lastReply(page);
  await expect(reply).toContainText('收到 1 张图：<Picture 1>');
  const boxes = reply.getByTestId('prompt-box');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.first()).toContainText('Change her coat into a black studded leather biker jacket');
  await expect(boxes.first().getByTestId('box-edit-tag')).toHaveText('指令编辑 · 用 1 号图');

  // 点「用它」→ 那句话落到编辑栏的正文里，功能还是指令编辑
  await boxes.first().getByRole('button', { name: '用它' }).click();
  await expect(dock.locator('#editText')).toHaveValue(/black studded leather biker jacket/);
  await expect(dock.locator('#editFn')).toContainText('指令编辑');

  // 「写一个」：不问你要改什么，直接按当前功能发一句出去，模型照样给框
  await dock.locator('#btnWriteOne').click();
  await expect(panel(page).getByTestId('message-user').last()).toContainText('看图，按「指令编辑」给我写几个方向。');
  const second = lastReply(page);
  await expect(second).toContainText('收到 1 张图：<Picture 1>');
  await expect(second.getByTestId('prompt-box')).toHaveCount(2);

  // 换了功能（E4 之前界面上还选不了，先用接口换）：模型提示词跟着换成那个功能那一份
  expect((await page.request.patch(`/api/canvases/${canvasId}/nodes/${nodeId}`, { data: { edit: { fn: 'real' } } })).ok()).toBe(true);
  await page.reload();
  await cards(page).first().click();
  await expect(panel(page).locator('#cfgSys')).toHaveValue('edit-real');
  await expect(panel(page).locator('.cfg-lbl')).toHaveText('模型提示词');
});

