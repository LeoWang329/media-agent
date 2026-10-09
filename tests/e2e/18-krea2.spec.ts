import { expect, test, type Page } from '@playwright/test';
import { MOCK_COMFY_PORT } from './env';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { assetsDialog, assetTile, cards, lastReply, newCanvasWithNode, panel, send, setupWorkFolder, slotMenu } from './helpers';

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
