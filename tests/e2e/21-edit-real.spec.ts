import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { assetsDialog, assetTile, newCanvasWithNode, panel, setupWorkFolder, toasts } from './helpers';

// 图像编辑节点的界面（E4）：功能下拉能切到「转真人」「换装」，两个功能各自的参数区，见
// docs/plan-image-edit-node-layout.md 第 2、4 节和 web/prototype/image-edit-node.html。
// 只走界面，不出图（出图那条路由服务端那边测）。

const dock = (page: Page) => panel(page).locator('[data-od-id="composer-dock"]');

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 往槽位里放一张测试图（照 20-edit-node.spec.ts 那个辅助）
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
}

test('10.3 第 18 条（E4）：「转真人」「换装」能在功能下拉里选中，选中后参数区整块跟着换，模型提示词也跟着切', async ({ page }) => {
  await newCanvasWithNode(page, '功能下拉', '图像编辑节点');
  await expect(dock(page).locator('#editFn')).toContainText('指令编辑');
  await expect(dock(page).locator('#editPreset')).toBeVisible();

  // 转真人：谁写词 / 做法 / LoRA 两组 / 版本都在，指令编辑那一套（提示词下拉、相似度）没了
  await pickFn(page, '转真人');
  await expect(dock(page).locator('#editFn')).toContainText('转真人');
  await expect(dock(page).locator('#editNeed')).toHaveText('要 1–2 张：① 要转的动漫图 ② 真人参考图（只有「换脸」用得上）');
  await expect(dock(page).locator('#editWhoWrites')).toBeVisible();
  await expect(dock(page).locator('#editFaceMode')).toBeVisible();
  await expect(dock(page).locator('#editRealLora')).toBeVisible();
  await expect(dock(page).locator('#editAddPeopleLora')).toBeVisible();
  await expect(dock(page).locator('#editRealVersion')).toHaveText('标准工作流');
  await expect(dock(page).locator('#editPreset')).toHaveCount(0);
  await expect(dock(page).locator('#editBoost')).toHaveCount(0);
  // 一张图都没有：说一句「要几张对不上」，但功能照样切过去了
  await expect(toasts(page).last()).toContainText('「转真人」要 1 张图');
  // 顶栏「模型提示词」跟着功能走：只列转真人那一份（服务端自己换 systemPromptName，界面不拦着）
  await expect(panel(page).locator('.cfg-lbl')).toHaveText('模型提示词');
  await expect(panel(page).locator('#cfgSys option')).toHaveText([/转真人/]);

  // 换装：提示词下拉换成换装那几条，转真人那一套收掉，相似度留着
  await pickFn(page, '换装');
  await expect(dock(page).locator('#editFn')).toContainText('换装');
  await expect(dock(page).locator('#editNeed')).toHaveText('要 1 张：① 要换衣服的图');
  await expect(dock(page).locator('#editPreset')).toBeVisible();
  await expect(dock(page).locator('#editBoost')).toBeVisible();
  await expect(dock(page).locator('#editWhoWrites')).toHaveCount(0);
  await expect(dock(page).locator('#editRealLora')).toHaveCount(0);
  await expect(panel(page).locator('#cfgSys option')).toHaveText([/换装/]);
});

test('10.3 第 18 条（E4）：转真人的默认值 —— 反推开着（那句话框是灰的）、只转真人、V3 强度 1、无审查；切「手输」才给辅助词', async ({ page }) => {
  await newCanvasWithNode(page, '转真人默认值', '图像编辑节点');
  await pickFn(page, '转真人');

  // 谁写词：默认反推，那句话由模型写，框是灰的、改不了
  await expect(dock(page).locator('#editWhoWrites button[aria-pressed="true"]')).toHaveText('反推（模型看图自己写）');
  await expect(dock(page).locator('#editText')).not.toBeEditable();
  await expect(dock(page).locator('[data-od-id="edit-who-writes-hint"]')).toContainText('反推开着时这句话由模型写');
  await expect(dock(page).locator('[data-od-id="edit-aux-words"]')).toHaveCount(0);

  // 做法：默认只转真人，没有图 2 那两行
  await expect(dock(page).locator('#editFaceMode button[aria-pressed="true"]')).toHaveText('只转真人');
  await expect(dock(page).locator('#editImage2')).toHaveCount(0);
  await expect(dock(page).locator('#editSlotB')).toHaveCount(0);

  // LoRA 两组：转真人那条默认 V3、强度 1；人物那条默认不加
  await expect(dock(page).locator('#editRealLora')).toHaveValue(/Krea2_Anything2RealCharacters-V3/);
  await expect(dock(page).locator('#editRealLoraStrength')).toHaveValue('1');
  await expect(dock(page).locator('[data-od-id="edit-people-lora"]')).toHaveCount(0);
  await expect(dock(page).locator('#editAddPeopleLora')).toBeVisible();
  // 版本只有「无审查」这一档，尺寸跟着图 1 走
  await expect(dock(page).locator('#editRealVersion')).toHaveText('标准工作流');
  await expect(dock(page)).toContainText('尺寸不用填，跟着图 1 走');

  // 手输：那句话能改，辅助词点一下接在后面，再点一下拿掉
  await dock(page).locator('#editWhoWrites').getByRole('button', { name: '手输' }).click();
  await expect(dock(page).locator('#editText')).toBeEditable();
  await dock(page).locator('#editText').fill('a woman standing on a platform');
  await dock(page).locator('[data-od-id="edit-aux-words"]').getByRole('button', { name: 'looking at camera', exact: true }).click();
  await expect(dock(page).locator('#editText')).toHaveValue('a woman standing on a platform, looking at camera');
  await dock(page).locator('[data-od-id="edit-aux-words"]').getByRole('button', { name: 'looking at camera', exact: true }).click();
  await expect(dock(page).locator('#editText')).toHaveValue('a woman standing on a platform');

  // 人物 LoRA 能挂好几个、每个能删
  await dock(page).locator('#editAddPeopleLora').click();
  await expect(dock(page).locator('[data-od-id="edit-people-lora"]')).toHaveCount(1);
  await expect(dock(page).locator('[data-od-id="edit-people-strength"]')).toHaveValue('0.6');
  await dock(page).locator('#editAddPeopleLora').click();
  await expect(dock(page).locator('[data-od-id="edit-people-lora"]')).toHaveCount(2);
  await dock(page).locator('[data-od-id="edit-people-remove"]').first().click();
  await expect(dock(page).locator('[data-od-id="edit-people-lora"]')).toHaveCount(1);
});

test('10.3 第 18 条（E4）：换功能不动你已经选的图和写好的字', async ({ page }) => {
  await newCanvasWithNode(page, '换功能不丢字', '图像编辑节点');
  await putImage(page);
  await expect(dock(page).locator('#slots .slot.is-filled')).toHaveCount(1);
  await expect(dock(page).getByTestId('slot-role')).toHaveText('要改的');

  // 切到转真人：图还在（角色名跟着功能变成「要转的」），手输写上那句话
  await pickFn(page, '转真人');
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(1);
  await expect(dock(page).getByTestId('slot-role')).toHaveText('要转的');
  await dock(page).locator('#editWhoWrites').getByRole('button', { name: '手输' }).click();
  await dock(page).locator('#editText').fill('silver hair, looking at camera');

  // 切回指令编辑：那句话还在，图也还在
  await pickFn(page, '指令编辑');
  await expect(dock(page).locator('#editText')).toHaveValue('silver hair, looking at camera');
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(1);
  await expect(dock(page).getByTestId('slot-role')).toHaveText('要改的');

  // 再切回转真人：还是那句（谁写词那次选的「手输」也记着）
  await pickFn(page, '转真人');
  await expect(dock(page).locator('#editText')).toHaveValue('silver hair, looking at camera');
  await expect(dock(page).locator('#editWhoWrites button[aria-pressed="true"]')).toHaveText('手输');
});

test('10.3 第 18 条（E4）：选「换脸」才出图 2 强度和「图 2 是哪张」；只有一张图时「开始」给一句提示、不死掉', async ({ page }) => {
  await newCanvasWithNode(page, '换脸要两张', '图像编辑节点');
  await putImage(page);
  await pickFn(page, '转真人');
  await expect(dock(page).locator('#editImage2')).toHaveCount(0);

  // 换脸：多一行图 2 强度（默认 1）和「图 2 是哪张」
  await dock(page).locator('#editFaceMode').getByRole('button', { name: '换脸（图 2 决定长相）' }).click();
  await expect(dock(page).locator('#editImage2')).toBeVisible();
  await expect(dock(page).locator('#editImage2')).toHaveValue('1');
  await expect(dock(page).locator('#editSlotB')).toBeVisible();
  await expect(dock(page).locator('label.edit-param').filter({ hasText: '图 2 强度' })).toHaveCount(1);
  await expect(dock(page).locator('[data-od-id="edit-image2-warn"]')).toContainText('换脸要 2 张图，现在只有 1 张');

  // 「开始」不按住（没有那句话也能开：反推写），点了只给一句话、不发出图请求
  await expect(dock(page).locator('#btnEditStart')).toBeEnabled();
  await dock(page).locator('#btnEditStart').click();
  await expect(toasts(page).last()).toContainText('换脸要 2 张图，现在只有 1 张');
  await page.waitForTimeout(400);
  await expect(panel(page).getByTestId('message-assistant')).toHaveCount(0);

  // 改回「只转真人」：图 2 那两行收掉
  await dock(page).locator('#editFaceMode').getByRole('button', { name: '只转真人' }).click();
  await expect(dock(page).locator('#editImage2')).toHaveCount(0);
  await expect(dock(page).locator('#editSlotB')).toHaveCount(0);
});

test('10.3 第 18 条（E4）：放两张图时，图 1 标「要转的」、图 2 标「真人参考」；点图 2 那张两张对调', async ({ page }) => {
  await newCanvasWithNode(page, '两张图分工', '图像编辑节点');
  await putImage(page);
  await putImage(page, FIXTURES.second);
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(2);

  await pickFn(page, '转真人');
  await dock(page).locator('#editFaceMode').getByRole('button', { name: '换脸（图 2 决定长相）' }).click();
  // 开换脸时图 2 自动指到另一张，两张不会指同一张
  await expect(dock(page).locator('#editSlotB')).toHaveValue('1');
  await expect(dock(page).getByTestId('slot-role')).toHaveText('要转的');
  await expect(dock(page).getByTestId('slot-role-b')).toHaveText('真人参考');
  await expect(panel(page).locator('#slots .slot').nth(0)).toHaveClass(/is-source/);
  await expect(panel(page).locator('#slots .slot').nth(1)).toHaveClass(/is-source-b/);
  await expect(dock(page).locator('[data-od-id="edit-image2-warn"]')).toHaveCount(0);

  // 点图 2 那张：它当图 1，原来那张退回图 2
  await panel(page).locator('#slots .slot').nth(1).click();
  await expect(panel(page).locator('#slots .slot').nth(1)).toHaveClass(/is-source/);
  await expect(panel(page).locator('#slots .slot').nth(0)).toHaveClass(/is-source-b/);
  await expect(dock(page).locator('#editSlotB')).toHaveValue('0');

  // 图槽右键里也能指定图 2
  await panel(page).locator('#slots .slot').nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '用这张当图 2（真人参考）' }).click();
  await expect(dock(page).locator('#editSlotB')).toHaveValue('1');
});

test('10.3 第 18 条（E4）：换装的提示词下拉是那四条现成的，选一条填进正文（正文照旧能改）', async ({ page }) => {
  await newCanvasWithNode(page, '换装四条', '图像编辑节点');
  await pickFn(page, '换装');
  await expect(dock(page).locator('#editPreset option')).toHaveText([
    '选一条现成的…',
    '黑色机车皮衣 · 只换衣服',
    '红色晚礼服 · 只换衣服',
    '白色衬衫 + 牛仔裤 · 只换衣服',
    '和服 · 只换衣服',
    '自己写（清空）',
  ]);
  await dock(page).locator('#editPreset').selectOption({ label: '和服 · 只换衣服' });
  await expect(dock(page).locator('#editText')).toHaveValue(/patterned silk kimono/);
  await expect(dock(page).locator('#editText')).toBeEditable();

  // 自己写：清空那行
  await dock(page).locator('#editPreset').selectOption({ label: '自己写（清空）' });
  await expect(dock(page).locator('#editText')).toHaveValue('');
});

test('10.3 第 18 条（E4）：没选图时切到「局部重绘」，掩码那块先问你要图（画掩码本身在 22-edit-inpaint 里测）', async ({ page }) => {
  await newCanvasWithNode(page, '重绘先要图', '图像编辑节点');
  await pickFn(page, '局部重绘');
  await expect(dock(page).locator('#editFn')).toContainText('局部重绘');
  // 还没放图：没有画布，说清先放一张
  await expect(dock(page).locator('[data-od-id="edit-mask"]')).toHaveCount(0);
  await expect(dock(page).locator('#editMaskState')).toContainText('还没选图');
  await expect(dock(page).locator('#editInpaintDenoise')).toHaveValue('0.85');
  await expect(dock(page).locator('#btnEditStart')).toBeDisabled();

  // 放一张图：画掩码的地方出现，转真人那套参数区不在了
  await putImage(page);
  await expect(dock(page).locator('[data-od-id="edit-mask"]')).toBeVisible();
  await expect(dock(page).locator('.mask-canvas')).toBeVisible();
  await expect(dock(page).locator('#editMaskState')).toContainText('还没画');
  await expect(dock(page).locator('#editWhoWrites')).toHaveCount(0);
});
