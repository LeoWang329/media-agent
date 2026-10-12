import { expect, test, type Page } from '@playwright/test';
import { MOCK_COMFY_PORT } from './env';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { assetsDialog, assetTile, cards, lastReply, newCanvasWithNode, panel, send, setupWorkFolder, slotMenu, toasts } from './helpers';

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;
const box = (page: Page) => lastReply(page).getByTestId('prompt-box');
const settings = (page: Page) => page.getByRole('dialog', { name: '出图设置' });
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

async function kreaNode(page: Page, title: string) {
  await newCanvasWithNode(page, title, '生图节点');
  await panel(page).locator('#cfgSys').selectOption('krea2');
  await expect(cards(page)).toContainText('生图 · Krea2');
  await expect(panel(page).locator('#imgCount')).toHaveText('1 张');
}

async function reference(page: Page) {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).locator('.as-folder').filter({ hasText: FIXTURES_DIR }).first().click();
  await assetTile(page, FIXTURES.first).click();
  await assetsDialog(page).getByRole('button', { name: '放进槽位（1）' }).click();
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(1);
}

test('Krea2 是英文段落框；模型和参数能改，多 LoRA、种子和尺寸进入流程，出完能再出与翻译', async ({ page }, testInfo) => {
  await kreaNode(page, 'Krea2 文生图');
  await expect(panel(page).locator('#btnWriteTags')).toHaveCount(0);
  await panel(page).locator('#imgSize').selectOption('1024×1024');
  await panel(page).locator('#btnGenCfg').click();
  await expect(settings(page)).toContainText('Krea2 出图设置');
  await expect(settings(page).locator('#gcCkpt')).toHaveText('krea2/darkBeastINT8Convrot2_krea211INT8Convrot.safetensors');
  await expect(settings(page).locator('#gcTextEncoder')).toHaveValue('qwen3vl_4b_uncensored_int8_convrot.safetensors');
  await settings(page).getByRole('button', { name: '挂一个 LoRA' }).click();
  await settings(page).locator('#gcSeed').fill('123');
  await settings(page).locator('#gcSeed').press('Enter');
  await page.screenshot({ path: testInfo.outputPath('krea2-settings.png') });
  await settings(page).getByRole('button', { name: '关闭', exact: true }).click();
  await send(page, '写一个');
  await expect(box(page).locator('.pb-body')).toContainText('An adult woman');
  await expect(box(page).locator('[data-act="editTags"]')).toHaveCount(0);
  await box(page).locator('[data-act="generate"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
  const graph = await graphOf(page);
  expect(nodeOf(graph, 'CLIPLoader').inputs.type).toBe('krea2');
  expect(nodeOf(graph, 'KSampler').inputs).toMatchObject({ seed: 123, steps: 8, cfg: 1 });
  expect(nodeOf(graph, 'EmptyLatentImage').inputs).toMatchObject({ width: 1024, height: 1024 });
  expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs.strength_model).toBe(1);
  await box(page).locator('.ig-cell.is-done').click();
  const viewer = page.getByRole('dialog', { name: '看大图和参数' });
  await expect(viewer).toContainText('qwen3vl_4b_uncensored_int8_convrot');
  await expect(viewer.getByRole('button', { name: '放大和重绘' })).toHaveCount(0);
  await viewer.getByRole('button', { name: '同样参数再来' }).click();
  await expect(viewer).toHaveCount(0);
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(2);
  await box(page).locator('[data-act="translate"]').click();
  await expect(page.getByRole('dialog').last()).toContainText('翻译');
  await page.goto('/settings#checkpoints');
  const defaults = page.locator('[data-od-id="series-defaults-krea2"]');
  await expect(defaults.getByLabel('步数')).toHaveValue('8');
  await expect(defaults.getByLabel('固定开头')).toHaveCount(0);
  await expect(defaults.getByLabel('默认负面词')).toHaveCount(0);
  await expect(defaults.getByLabel('clip skip')).toHaveCount(0);
});

test('四视图模式的框文字追加到固定指令；参考图、相似度、尺寸可选；预设属于 Krea2', async ({ page }) => {
  await kreaNode(page, 'Krea2 四视图');
  await reference(page);
  await panel(page).locator('#btnGenCfg').click();
  await settings(page).getByRole('button', { name: '四视图', exact: true }).click();
  await expect(settings(page).locator('#gcSteps')).toHaveValue('10');
  await expect(settings(page).locator('#gcCkpt')).toHaveText('krea/krea2_turbo_int8_convrot.safetensors');
  await settings(page).getByRole('button', { name: '参考图', exact: true }).click();
  await page.getByRole('button', { name: '槽位 1 号', exact: true }).click();
  await settings(page).locator('#gcRefBoost').fill('4');
  await settings(page).locator('#gcRefBoost').press('Enter');
  await settings(page).getByRole('button', { name: '存成预设…' }).click();
  const save = page.getByRole('dialog', { name: '存成预设' });
  await save.getByRole('textbox').fill('Krea2 四视图测试');
  await save.getByRole('button', { name: '存', exact: true }).click();
  await settings(page).getByRole('button', { name: '关闭', exact: true }).click();
  await expect(panel(page).locator('#imgSize')).toHaveValue('1536×1024');
  await send(page, '写一个');
  await box(page).locator('[data-act="generate"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
  const graph = await graphOf(page);
  expect(nodeOf(graph, 'Krea2EditGroundedEncode').inputs.prompt).toContain('An adult woman');
  expect(nodeOf(graph, 'Krea2EditGroundedEncode').inputs.prompt).toContain('Character Sheet');
  expect(nodeOf(graph, 'Krea2EditModelPatch').inputs.ref_boost).toBe(4);
  expect(nodeOf(graph, 'Krea2EditModelPatch').inputs.target_latent).toEqual(nodeOf(graph, 'KSampler').inputs.latent_image);
  const presets = await (await page.request.get('/api/image-presets')).json();
  expect(presets.find((p: { name: string }) => p.name === 'Krea2 四视图测试')).toMatchObject({ family: 'Krea2', settings: { krea: { reference: null } } });
});

test('编辑档：放一张参考图写一句话就重画（走作者那套 Ostris）；没选参考图拦住；大图参数写着从哪来', async ({ page }) => {
  await kreaNode(page, 'Krea2 编辑');
  await reference(page);
  await panel(page).locator('#btnGenCfg').click();
  await settings(page).getByRole('button', { name: '编辑', exact: true }).click();
  await expect(settings(page)).toContainText('不用涂');
  await expect(settings(page)).toContainText('长边缩到 2048');
  await expect(settings(page).locator('#gcSteps')).toHaveValue('10');
  await expect(settings(page).locator('#gcCkpt')).toHaveText('krea2/moodyAmateurMixKrea2_3JAVStyle_int8.safetensors');
  await expect(settings(page).locator('#gcTextEncoder')).toHaveValue('qwen3vl_4b_uncensored_int8_convrot.safetensors');
  await expect(settings(page).locator('.gc-loras .gc-lora-name').first()).toHaveText('krea2/Krea2_Anything2RealCharacters-V3.safetensors');
  await settings(page).getByRole('button', { name: '关闭', exact: true }).click();
  await send(page, '写一个');
  // 还没选参考图：点生图拦住，一张都不发
  await box(page).locator('[data-act="generate"]').click();
  await expect(toasts(page).filter({ hasText: '编辑还没选参考图' })).toBeVisible();
  await panel(page).locator('#btnGenCfg').click();
  await settings(page).getByRole('button', { name: '参考图', exact: true }).click();
  await page.getByRole('button', { name: '槽位 1 号', exact: true }).click();
  await settings(page).getByRole('button', { name: '关闭', exact: true }).click();
  await box(page).locator('[data-act="generate"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
  const graph = await graphOf(page);
  // 触发词 + 框里那句话都进正面词，不追加四视图的固定指令
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).toContain('transform the image to realistic photograph');
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).toContain('An adult woman');
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).not.toContain('Character Sheet');
  expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs.lora_name).toBe('krea2/Krea2_Anything2RealCharacters-V3.safetensors');
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch').inputs.kv_cache).toBe(true);
  // 尺寸不面板说了算：参考图按比例缩到长边 2048，潜变量接它的宽高
  expect(nodeOf(graph, 'LayerUtility: ImageScaleByAspectRatio V2').inputs).toMatchObject({ scale_to_side: 'longest', scale_to_length: 2048, round_to_multiple: '16' });
  expect(nodeOf(graph, 'Krea2EditModelPatch')).toBeUndefined();
  expect(nodeOf(graph, 'LoadImage').inputs.image).toBeTruthy();
  await box(page).locator('.ig-cell.is-done').click();
  const viewer = page.getByRole('dialog', { name: '看大图和参数' });
  await expect(viewer).toContainText('编辑 · 相似度 1');
  await expect(box(page)).toContainText('编辑');
});

test('编辑方案：默认「动漫转真人 V3」，换成 V1 会连 LoRA 和步数一起换；手动改 LoRA 就不算方案了', async ({ page }, testInfo) => {
  await kreaNode(page, 'Krea2 编辑方案');
  await reference(page);
  await panel(page).locator('#btnGenCfg').click();
  await settings(page).getByRole('button', { name: '编辑', exact: true }).click();
  await expect(settings(page).locator('#gcEditPreset')).toHaveValue('real-v3');
  await expect(settings(page)).toContainText('真机验过');
  await settings(page).locator('#gcEditPreset').selectOption({ label: '动漫转真人 V1' });
  await expect(settings(page).locator('.gc-loras .gc-lora-name').first()).toHaveText('krea2/Krea2_Anything2RealCharacters-V1.safetensors');
  await expect(settings(page).locator('#gcSteps')).toHaveValue('10');
  // 手动改 LoRA 就不再算这个方案了
  await settings(page).locator('.gc-loras .gc-lora-name').first().click();
  const picker = page.getByRole('dialog', { name: '选 LoRA' });
  await picker.getByRole('textbox', { name: '搜 LoRA' }).fill('darkbrush');
  await picker.getByRole('option').first().click();
  await expect(settings(page).locator('#gcEditPreset')).toHaveValue('');
  // 换回默认那个方案，选上参考图再出图
  await settings(page).locator('#gcEditPreset').selectOption({ label: '动漫转真人 V3（默认）' });
  await expect(settings(page).locator('.gc-loras .gc-lora-name').first()).toHaveText('krea2/Krea2_Anything2RealCharacters-V3.safetensors');
  await settings(page).getByRole('button', { name: '参考图', exact: true }).click();
  await page.getByRole('button', { name: '槽位 1 号', exact: true }).click();
  await settings(page).getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('edit-preset.png') });
  await send(page, '写一个');
  await box(page).locator('[data-act="generate"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
  const graph = await graphOf(page);
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).toContain('transform the image to realistic photograph');
  expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs.lora_name).toBe('krea2/Krea2_Anything2RealCharacters-V3.safetensors');
});

// 再往槽位里放一张（资产库那个文件夹前面已经注册过了）
async function reference2(page: Page) {
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).locator('.as-folder').filter({ hasText: FIXTURES_DIR }).first().click();
  await assetTile(page, FIXTURES.second).click();
  await assetsDialog(page).getByRole('button', { name: '放进槽位（1）' }).click();
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(2);
}

test('双图：图 1 场景 + 图 2 人物，选第二张才出第二个相似度；mock 收到两张图、编码节点两路都接', async ({ page }, testInfo) => {
  await kreaNode(page, 'Krea2 双图');
  await reference(page);
  await reference2(page);
  await panel(page).locator('#btnGenCfg').click();
  await settings(page).getByRole('button', { name: '编辑', exact: true }).click();
  await expect(settings(page)).toContainText('图 1 · 场景');
  await expect(settings(page)).toContainText('图 2 · 人物');
  await settings(page).getByRole('button', { name: '参考图', exact: true }).click();
  await page.getByRole('button', { name: '槽位 1 号', exact: true }).click();
  // 还没选第二张：单图，只有一个相似度
  await expect(settings(page).locator('#gcRefBoostA')).toHaveCount(0);
  await settings(page).getByRole('button', { name: '第二张参考图', exact: true }).click();
  await page.getByRole('button', { name: '槽位 2 号', exact: true }).click();
  await expect(settings(page).locator('#gcRefBoostA')).toHaveValue('1');
  await settings(page).locator('#gcRefBoostA').fill('1.5');
  await settings(page).locator('#gcRefBoostA').press('Enter');
  await settings(page).locator('#gcRefBoost').fill('2');
  await settings(page).locator('#gcRefBoost').press('Enter');
  await settings(page).getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('edit-dual.png') });

  await send(page, '写一个');
  await box(page).locator('[data-act="generate"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
  const graph = await graphOf(page);
  const loads = Object.values(graph)
    .filter((n) => n.class_type === 'LoadImage')
    .map((n) => n.inputs.image);
  expect(loads).toHaveLength(2);
  expect(loads[0]).not.toBe(loads[1]);
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch')).toBeTruthy();
  for (const node of Object.values(graph).filter((n) => n.class_type === 'TextEncodeKrea2OstrisEdit')) {
    expect(node.inputs.image1).toBeTruthy();
    expect(node.inputs.image2).toBeTruthy();
  }
  // 两张都传上去了（mock 的 _uploads 是跨用例累积的，只认这两张在不在里面）
  const uploaded = ((await (await page.request.get(`${COMFY_URL}/_uploads`)).json()) as { name: string }[]).map((u) => u.name);
  for (const name of loads) expect(uploaded).toContain(name);
  // 大图参数里写着双图
  await box(page).locator('.ig-cell.is-done').first().click();
  await expect(page.getByRole('dialog', { name: '看大图和参数' })).toContainText('编辑（双图）· 场景 1.5 / 人物 2');
});

test('IL 槽位不问模型就能做四视图，新建四视图框；图上的入口把结果挂回原框，刷新后还在', async ({ page }) => {
  await newCanvasWithNode(page, 'IL 做四视图', '生图节点');
  await reference(page);
  await slotMenu(page, 0, '做四视图');
  const four = page.getByRole('dialog', { name: '做四视图' });
  await four.getByRole('textbox', { name: '额外要求' }).fill('Keep the glasses.');
  await four.getByRole('button', { name: '开始做四视图' }).click();
  await expect(box(page)).toContainText('四视图');
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
  await expect(panel(page).locator('#cfgSys')).toHaveValue('il');
  await box(page).getByRole('button', { name: '做四视图', exact: true }).click();
  await four.getByRole('button', { name: '开始做四视图' }).click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(2);
  await expect(panel(page).getByTestId('message-assistant')).toHaveCount(1);
  await page.reload();
  await cards(page).first().click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(2);
});
