import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { MOCK_COMFY_PORT } from './env';
import { assetsDialog, assetTile, lastReply, newCanvasWithNode, panel, send, setupWorkFolder, toasts } from './helpers';

// 10.3 第 18 条（E5）：图像编辑节点第 2 批那两个功能「放大 / 高清」「四视图」，以及收尾那条
// 「框上直接开始」（布局稿第 4 节 ④：出的那组图挂在**这条框**下面）。
// 放大走的是生图节点已有的那条内置放大路（UpscaleModelLoader + ImageUpscaleWithModel，可选用部位重绘修脸），
// 四视图跟生图节点那个「做四视图」同一条路（Krea2Edit 那两个节点 + krea2_4panel），
// 见 docs/plan-image-edit-node.md 第 3 节、docs/dev-plan.md 5.39。只走界面 + 假 ComfyUI，不连真的那台

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const graphOf = async (page: Page) => ((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[]).at(-1)!.prompt;
const lastGraphs = async (page: Page) => ((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[]).map((one) => one.prompt);
const nodeOf = (graph: Graph, type: string) => Object.values(graph).find((n) => n.class_type === type)!;
const nodesOf = (graph: Graph, type: string) => Object.values(graph).filter((n) => n.class_type === type);
const idOf = (graph: Graph, type: string) => Object.keys(graph).find((id) => graph[id].class_type === type)!;
const dock = (page: Page) => panel(page).locator('[data-od-id="composer-dock"]');

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

test.beforeEach(async ({ page }) => {
  expect((await page.request.put('/api/config', { data: { comfyTarget: 'lan' } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL } } })).ok()).toBe(true);
  expect((await page.request.post(`${COMFY_URL}/_hide-nodes`, { data: { types: [] } })).ok()).toBe(true);
});

// 往槽位里放测试图（01-red.jpg，800×600），照 22 / 23 那两份的辅助
async function putImage(page: Page, name = FIXTURES.first) {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).locator('.as-folder').filter({ hasText: FIXTURES_DIR }).first().click();
  await assetTile(page, name).click();
  await assetsDialog(page).getByRole('button', { name: /放进槽位/ }).click();
  await expect(assetsDialog(page)).toHaveCount(0);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
}

// 「功能」下拉里选一个
async function pickFn(page: Page, name: string) {
  await dock(page).locator('#editFn').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  await expect(dock(page).locator('#editFn')).toContainText(name);
}

// 拿当前画布和里面那个编辑节点的 id（等槽位真的落到服务端再发消息用）
async function editNodeAt(page: Page, title: string): Promise<{ canvasId: string; nodeId: string }> {
  const home = (await (await page.request.get('/api/home')).json()) as { canvases: { id: string; title: string }[] };
  const canvasId = home.canvases.find((c) => c.title === title)!.id;
  const detail = (await (await page.request.get(`/api/canvases/${canvasId}`)).json()) as { nodes: { id: string; kind: string }[] };
  return { canvasId, nodeId: detail.nodes.find((n) => n.kind === 'edit')!.id };
}

type ApiMessage = { role: string; text: string; images?: { promptIndex: number; kind: string; images: { status: string; width?: number; height?: number }[] }[] };
const messagesOf = async (page: Page, at: { canvasId: string; nodeId: string }) =>
  Object.values(((await (await page.request.get(`/api/canvases/${at.canvasId}/nodes/${at.nodeId}`)).json()) as { messages: Record<string, ApiMessage> }).messages);
const slotsOf = async (page: Page, at: { canvasId: string; nodeId: string }) =>
  ((await (await page.request.get(`/api/canvases/${at.canvasId}/nodes/${at.nodeId}`)).json()) as { slots: string[] }).slots.length;

test('编辑节点出的图能点「做四视图」，结果留在原框，编辑功能和提示词不变', async ({ page }) => {
  await newCanvasWithNode(page, '编辑结果做四视图', '图像编辑节点');
  await pickFn(page, '换装');
  await putImage(page);
  await dock(page).locator('#editText').fill('Change the jacket to blue.');
  await dock(page).locator('#btnEditStart').click();
  const box = lastReply(page).getByTestId('prompt-box');
  await expect(box.locator('.ig-cell.is-done img')).toHaveCount(1);
  await box.getByRole('button', { name: '做四视图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '做四视图', exact: true });
  await dialog.getByRole('textbox', { name: '额外要求' }).fill('Keep the blue jacket.');
  await dialog.getByRole('button', { name: '开始做四视图' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(box.locator('.ig-cell.is-done img')).toHaveCount(2);
  await expect(panel(page).getByTestId('message-assistant')).toHaveCount(1);
  await expect(dock(page).locator('#editFn')).toContainText('换装');
  await expect(panel(page).locator('#cfgSys')).toHaveValue('edit-outfit');
  const graph = await graphOf(page);
  expect(nodeOf(graph, 'Krea2EditModelPatch')).toBeTruthy();
  expect(nodesOf(graph, 'Krea2EditGroundedEncode')[0].inputs.prompt).toContain('Keep the blue jacket.');
});

test('10.3 第 18 条（E5）：「放大 / 高清」能在功能下拉里选中：不用写提示词、参数区是倍数 + 放大模型 + 面部修复', async ({ page }) => {
  await newCanvasWithNode(page, '放大和四视图', '图像编辑节点');
  await expect(dock(page).locator('#editFn')).toContainText('指令编辑');

  // 两个新功能都在下拉里，而且不是「还没做」那一档
  await dock(page).locator('#editFn').click();
  await expect(page.getByRole('menuitem', { name: '放大 / 高清', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '四视图', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '放大 / 高清', exact: true }).click();

  // 参数区：要几张、放大倍数两档、放大模型（空着是用这台 ComfyUI 上第一个）、面部修复默认不开
  await expect(dock(page).locator('#editNeed')).toHaveText('要 1 张：① 要放大的图');
  await expect(dock(page).locator('#editUpscaleScale').getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dock(page).locator('#editUpscaleModel')).toHaveValue('');
  await expect(dock(page).locator('#editUpscaleModel option').first()).toHaveText('用这台 ComfyUI 上的第一个');
  await expect(dock(page).locator('#editUpscaleFace')).not.toBeChecked();

  // **这个功能不用模型写字**：没有「提示词」那一行、输入框旁也没有「写一个」，界面上写明了
  await expect(dock(page).locator('#editPreset')).toHaveCount(0);
  await expect(dock(page).locator('[data-od-id="edit-upscale-desc"]')).toContainText('这个功能不用模型写字');
  await expect(panel(page).locator('#btnWriteOne')).toHaveCount(0);
  // 顶栏那一格也说清楚：这套提示词是聊天用的，放大不用它（放大没有自己那份提示词）
  await expect(panel(page).locator('#cfgSys')).toHaveValue('edit');
  await expect(panel(page).locator('#cfgSys')).toContainText('不用模型写字');

  // 没选图：开始按住，说清要先点一张
  await expect(dock(page).locator('#btnEditStart')).toBeDisabled();
  await expect(dock(page).locator('#btnEditStart')).toHaveAttribute('title', '还没选图：先在下面点一张要放大的');
  await putImage(page);
  // 一句都不用写，放了图就能开始；顺带算出放大到多大
  await expect(dock(page).locator('#btnEditStart')).toBeEnabled();
  await expect(dock(page).locator('[data-od-id="edit-upscale-desc"]')).toContainText('1600×1200');
});

test('10.3 第 18 条（E5）：放大开始 → 假 ComfyUI 收到内置放大那条路（放大模型 + 只放大不重画）→ 出图挂在框下面', async ({ page }) => {
  await newCanvasWithNode(page, '放大出图', '图像编辑节点');
  await putImage(page);
  await pickFn(page, '放大 / 高清');

  await dock(page).locator('#btnEditStart').click();
  await expect(toasts(page).filter({ hasText: '开始放大这张图' })).toBeVisible();
  const box = lastReply(page).getByTestId('prompt-box');
  await expect(box).toContainText('放大 / 高清');
  await expect(box.locator('.ig-cell.is-done img')).toHaveCount(1);
  // 放大后的尺寸：800×600 的图 ×2
  await expect(box).toContainText('1600×1200');

  const graph = await graphOf(page);
  // 放大模型（面板上没选，服务端用这台 ComfyUI 上第一个）+ 放大 + 缩回原图 ×2
  expect(nodeOf(graph, 'UpscaleModelLoader').inputs.model_name).toBe('4x-test.pth');
  expect(nodeOf(graph, 'ImageUpscaleWithModel').inputs).toEqual({ upscale_model: expect.anything(), image: expect.anything() });
  expect(nodeOf(graph, 'ImageScale').inputs).toMatchObject({ width: 1600, height: 1200 });
  // 只放大不重画：图上没有采样器；底模是这台 ComfyUI 上 IL 那个
  expect(nodeOf(graph, 'KSampler')).toBeUndefined();
  expect(nodeOf(graph, 'FaceDetailer')).toBeUndefined();
  expect(nodeOf(graph, 'CheckpointLoaderSimple').inputs.ckpt_name).toBe('il-test.safetensors');
});

test('10.3 第 18 条（E5）：放大勾上「面部修复」→ 多一道部位重绘（检测模型是假的那台上的脸检测）', async ({ page }) => {
  await newCanvasWithNode(page, '放大修脸', '图像编辑节点');
  await putImage(page);
  await pickFn(page, '放大 / 高清');

  // 等这台 ComfyUI 的模型列表读回来（面部修复那个开关要靠它挑检测模型），列表里就一个放大模型
  await expect(dock(page).locator('#editUpscaleModel option')).toHaveCount(2);
  await dock(page).locator('#editUpscaleFace').check();
  await expect(dock(page).locator('#editUpscaleFace')).toBeChecked();
  // 倍数也能切（1.5 那档）
  await dock(page).locator('#editUpscaleScale').getByRole('button', { name: '1.5×' }).click();
  await expect(dock(page).locator('#editUpscaleScale').getByRole('button', { name: '1.5×' })).toHaveAttribute('aria-pressed', 'true');

  await dock(page).locator('#btnEditStart').click();
  await expect(lastReply(page).getByTestId('prompt-box').locator('.ig-cell.is-done img')).toHaveCount(1);

  const graph = await graphOf(page);
  expect(nodeOf(graph, 'UltralyticsDetectorProvider').inputs.model_name).toBe('bbox/face_yolov8m.pt');
  const face = nodeOf(graph, 'FaceDetailer');
  expect(face.inputs.image).toEqual([idOf(graph, 'ImageScale'), 0]);
  // 1.5 倍取 8 的倍数：800×600 → 1200×904（900 往上取到 8 的倍数）
  expect(nodeOf(graph, 'ImageScale').inputs).toMatchObject({ width: 1200, height: 904 });
  // 还是只放大不重画：整张图没有采样器
  expect(nodeOf(graph, 'KSampler')).toBeUndefined();
});

test('10.3 第 18 条（E5）：「四视图」能在功能下拉里选中：主指令固定、框里只补一句额外要求，开始走 Krea2Edit 那条路', async ({ page }) => {
  await newCanvasWithNode(page, '四视图出图', '图像编辑节点');
  await pickFn(page, '四视图');

  // 参数区：要 1 张角色图、能看到固定的主指令，没有「提示词」下拉（没有说话模板）
  await expect(dock(page).locator('#editNeed')).toHaveText('要 1 张：① 角色图');
  await expect(dock(page).locator('[data-od-id="edit-fourview-instruction"]')).toContainText('Convert the character in the image to a Character Sheet');
  await expect(dock(page).locator('[data-od-id="edit-fourview-desc"]')).toContainText('主指令是固定的');
  await expect(dock(page).locator('#editPreset')).toHaveCount(0);
  // 顶栏「模型提示词」跟着功能走：四视图那份（edit-fourview），输入框旁的「写一个」还在（这句模型能帮着写）
  await expect(panel(page).locator('#cfgSys')).toHaveValue('edit-fourview');
  await expect(panel(page).locator('#cfgSys option')).toHaveText([/四视图/]);
  await expect(panel(page).locator('#btnWriteOne')).toBeVisible();

  // 一句都不写也开得起来（主指令是固定的），先补一句额外要求试试
  await expect(dock(page).locator('#editText')).toHaveValue('');
  await expect(dock(page).locator('#btnEditStart')).toBeDisabled();
  await dock(page).locator('#editText').fill('keep the red jacket and use a plain background');
  await putImage(page);
  await expect(dock(page).locator('#btnEditStart')).toBeEnabled();

  await dock(page).locator('#btnEditStart').click();
  await expect(toasts(page).filter({ hasText: '开始做四视图' })).toBeVisible();
  const box = lastReply(page).getByTestId('prompt-box');
  await expect(box).toContainText('四视图');
  await expect(box.locator('.ig-cell.is-done img')).toHaveCount(1);
  // 框里显示的是真发出去的那句：主指令 + 我们补的那句
  await expect(box).toContainText('Convert the character in the image to a Character Sheet');

  const graph = await graphOf(page);
  // 跟生图节点那个「做四视图」同一条路：Krea2Edit 那两个节点（不是编辑档的 Ostris 那两个），挂 krea2_4panel
  expect(nodeOf(graph, 'Krea2EditModelPatch')).toBeTruthy();
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch')).toBeUndefined();
  expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs.lora_name).toBe('krea2/krea2_4panel.safetensors');
  const encodes = nodesOf(graph, 'Krea2EditGroundedEncode');
  expect(encodes.map((n) => n.inputs.prompt)).toEqual([
    'Convert the character in the image to a Character Sheet showing a face close-up, front full body, side full body and back full body views\n\nkeep the red jacket and use a plain background',
    '',
  ]);
  expect(nodeOf(graph, 'LoadImage').inputs.image).toBeTruthy();

  // 不写额外要求也能开：清空那句话再来一次，正面就是主指令那一句。
  // 清空是「先改本地再写服务端」，等它真的落到服务端再点开始，不然发出去的还是上一句
  const canvasId = new URL(page.url()).pathname.split('/').at(-1)!;
  await dock(page).locator('#editText').fill('');
  await expect
    .poll(async () => {
      const detail = (await (await page.request.get(`/api/canvases/${canvasId}`)).json()) as { nodes: { id: string }[] };
      const node = (await (await page.request.get(`/api/canvases/${canvasId}/nodes/${detail.nodes[0].id}`)).json()) as { edit: { text: string } };
      return node.edit.text;
    })
    .toBe('');
  await expect(dock(page).locator('#btnEditStart')).toBeEnabled();
  // 等假 ComfyUI 那边真的多出一张再读图：点下去到提交要一个来回，
  // 只看「最后一条回复里有出完的图」会被上一组已经出完的图骗过去
  const before = (await lastGraphs(page)).length;
  await dock(page).locator('#btnEditStart').click();
  await expect.poll(async () => (await lastGraphs(page)).length).toBe(before + 1);
  const bare = (await lastGraphs(page)).at(-1)!;
  expect(nodesOf(bare, 'Krea2EditGroundedEncode').map((n) => n.inputs.prompt)).toEqual([
    'Convert the character in the image to a Character Sheet showing a face close-up, front full body, side full body and back full body views',
    '',
  ]);
});

test('10.3 第 18 条（布局第 4 节 ④）：框上直接「开始」—— 出的图挂在**这条框**下面，不新建回复', async ({ page }) => {
  await newCanvasWithNode(page, '框上开始', '图像编辑节点');
  const at = await editNodeAt(page, '框上开始');
  await putImage(page);
  // 放图是先改本地再写服务端，等它真的落到服务端再发消息，不然发出去的是空槽位
  await expect.poll(() => slotsOf(page, at)).toBe(1);

  // 让模型给三个方向：一条回复里三个框，每个框上都有「用它」和「开始」
  await send(page, '把她的外套换成朋克风，给我三个方向');
  const boxes = lastReply(page).getByTestId('prompt-box');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(2).getByRole('button', { name: '开始' })).toBeVisible();
  const repliesBefore = await panel(page).getByTestId('message-assistant').count();
  const before = await messagesOf(page, at);

  // 点第 3 个框上的「开始」
  await boxes.nth(2).locator('[data-act="start"]').click();
  await expect(toasts(page).filter({ hasText: '开始改这张图' })).toBeVisible();
  // 出的一组挂在这条框下面：第 3 个框下面有图，前两个框下面一张都没有
  await expect(boxes.nth(2).locator('.ig-cell.is-done img')).toHaveCount(1);
  await expect(boxes.nth(0).locator('.ig-job')).toHaveCount(0);
  await expect(boxes.nth(1).locator('.ig-job')).toHaveCount(0);
  // **不新建回复**：回复还是一条，消息一条都没多
  await expect(panel(page).getByTestId('message-assistant')).toHaveCount(repliesBefore);
  const after = await messagesOf(page, at);
  expect(after).toHaveLength(before.length);
  const reply = after.find((m) => m.role === 'assistant')!;
  expect(reply.images).toHaveLength(1);
  // 挂的就是第 3 个框（promptIndex 2），走的是指令编辑那条路
  expect(reply.images![0]).toMatchObject({ promptIndex: 2, kind: 'edit' });
  await expect.poll(async () => (await messagesOf(page, at)).find((m) => m.role === 'assistant')!.images![0].images[0].status).toBe('done');

  // 收到的那张图就是指令编辑那条路（Ostris 两个节点 + 身份编辑 LoRA），框里那句话照发
  const graph = await graphOf(page);
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch').inputs.kv_cache).toBe(true);
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).toBe('Change her coat into a black studded leather biker jacket, keep her face, hair and the background exactly the same.');
});

test('10.3 第 18 条（布局第 4 节 ④）：框上「开始」缺东西时说一句人话（这条框的图不在槽位里了）', async ({ page }) => {
  await newCanvasWithNode(page, '框上开始缺图', '图像编辑节点');
  const at = await editNodeAt(page, '框上开始缺图');
  await putImage(page);
  await expect.poll(() => slotsOf(page, at)).toBe(1);
  await send(page, '把外套换成皮衣');
  const box = lastReply(page).getByTestId('prompt-box');
  await expect(box).toHaveCount(1);

  // 把这条框用的那张图从槽位里删掉：框上的「开始」不闷着，说清楚要先把图放回来
  await panel(page).locator('#slots .slot').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删掉这格' }).click();
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(0);
  await box.locator('[data-act="start"]').click();
  await expect(toasts(page).filter({ hasText: '这条框用的图已经不在槽位里了' })).toBeVisible();
  // 一个任务都没建
  expect((await messagesOf(page, at)).find((m) => m.role === 'assistant')!.images ?? []).toHaveLength(0);
});
