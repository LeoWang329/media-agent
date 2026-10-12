import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { E2E_WORK_FOLDER, MOCK_COMFY_PORT } from './env';
import { lastReply, newCanvasWithNode, panel, send, setupWorkFolder, toasts } from './helpers';

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;
const box = (page: Page) => lastReply(page).getByTestId('prompt-box');
const viewer = (page: Page) => page.getByRole('dialog', { name: '看大图和参数' });
// 生图节点的框是标签框（data-act="gen"），Krea2 那种段落框是 data-act="generate"
const generateButton = (page: Page) => box(page).locator('[data-act="gen"], [data-act="generate"]').first();
// 生图节点默认出 4 张，测试里都改成 1 张，数着方便
async function setCount(page: Page, count = 1) {
  for (let n = 3; n >= count; n -= 1) {
    await panel(page).locator('#cntDown').click();
    await expect(panel(page).locator('#imgCount')).toHaveText(`${n} 张`);
  }
}
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const graphOf = async (page: Page) => ((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[]).at(-1)!.prompt;
const nodeOf = (graph: Graph, type: string) => Object.values(graph).find((n) => n.class_type === type)!;
const idOf = (graph: Graph, type: string) => Object.keys(graph).find((id) => graph[id].class_type === type)!;

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.put('/api/config', { data: { comfyTarget: 'lan' } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL } } })).ok()).toBe(true);
  expect((await page.request.post(`${COMFY_URL}/_hide-nodes`, { data: { types: [] } })).ok()).toBe(true);
  expect((await page.request.get('/api/comfy/options?refresh=1')).ok()).toBe(true);
});

// 服务端落盘的那张掩码 PNG：临时文件夹里最新的一张
async function maskFile(): Promise<string> {
  const root = path.join(E2E_WORK_FOLDER, 'image-temp');
  const days = await fs.readdir(root).catch(() => []);
  const found: { file: string; at: number }[] = [];
  for (const day of days) {
    for (const name of await fs.readdir(path.join(root, day))) {
      if (!name.endsWith('-mask.png')) continue;
      const file = path.join(root, day, name);
      found.push({ file, at: (await fs.stat(file)).mtimeMs });
    }
  }
  found.sort((a, b) => b.at - a.at);
  if (!found.length) throw new Error('临时文件夹里没有掩码 PNG');
  return found[0].file;
}

// 在掩码画布上从左上往右下拖一下，坐标按显示框的比例给
async function dragBox(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const rect = (await page.locator('.mask-canvas').boundingBox())!;
  const at = (p: { x: number; y: number }) => ({ x: rect.x + rect.width * p.x, y: rect.y + rect.height * p.y });
  const start = at(from);
  const end = at(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}

test('局部重绘：大图窗口里拖个框 → 出的那张 PNG 框里透明、别处不透明 → 只裁一块重画，别处不动', async ({ page }, testInfo) => {
  await newCanvasWithNode(page, '局部重绘', '生图节点');
  await setCount(page);
  await send(page, '写一个');
  await generateButton(page).click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
  await box(page).locator('.ig-cell.is-done').first().click();
  await expect(viewer(page).getByRole('button', { name: '局部重绘' })).toBeVisible();

  await viewer(page).getByRole('button', { name: '局部重绘' }).click();
  await expect(page.locator('[data-od-id="mask-editor"]')).toBeVisible();
  await expect(page.locator('.mask-canvas')).toBeVisible();
  // 还没画就点开始：按住
  await expect(page.locator('#ibInpaintGo')).toBeDisabled();
  await dragBox(page, { x: 0.2, y: 0.15 }, { x: 0.45, y: 0.4 });
  await page.screenshot({ path: testInfo.outputPath('mask-editor.png') });
  await expect(page.locator('#ibInpaintGo')).toBeEnabled();
  // 涂抹能在框上叠加，撤销能退回去
  await page.locator('.mask-tools').getByRole('button', { name: '涂抹' }).click();
  await dragBox(page, { x: 0.6, y: 0.6 }, { x: 0.75, y: 0.75 });
  await expect(page.locator('#maskUndo')).toBeEnabled();
  await page.locator('#maskUndo').click();
  await page.locator('.mask-tools').getByRole('button', { name: '拖框' }).click();

  await page.locator('#ibInpaintDenoise').fill('0.8');
  await page.locator('#ibInpaintDenoise').press('Enter');
  await page.locator('#ibInpaintGo').click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(toasts(page).filter({ hasText: '开始重绘这一块' })).toBeVisible();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(2);

  // 服务端收到的那张 PNG：和原图同尺寸，框里的 alpha 是 0，别处是 255
  const file = await maskFile();
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect({ width: info.width, height: info.height }).toEqual({ width: 832, height: 1216 });
  const alphaAt = (x: number, y: number) => data[(Math.round(y * info.height) * info.width + Math.round(x * info.width)) * 4 + 3];
  expect(alphaAt(0.32, 0.27)).toBe(0);
  expect(alphaAt(0.8, 0.85)).toBe(255);
  expect(alphaAt(0.05, 0.9)).toBe(255);

  const graph = await graphOf(page);
  expect(nodeOf(graph, 'InpaintCropImproved').inputs).toMatchObject({ mask_expand_pixels: 8, output_target_width: 1024, output_target_height: 1024 });
  expect(nodeOf(graph, 'InpaintModelConditioning').inputs.noise_mask).toBe(true);
  expect(nodeOf(graph, 'InpaintStitchImproved').inputs).toEqual({ stitcher: [idOf(graph, 'InpaintCropImproved'), 0], inpainted_image: [idOf(graph, 'VAEDecode'), 0] });
  expect(nodeOf(graph, 'KSampler').inputs.denoise).toBe(0.8);
  expect(nodeOf(graph, 'LoadImage').inputs.image).toBeTruthy();

  // 新的一组标着从哪张来；「只换种子再来」重新上传同一张（按内容算名字），不用再涂
  const first = await (await page.request.get(`${COMFY_URL}/_uploads`)).json();
  const group = box(page).locator('[data-od-id="image-job"]').filter({ hasText: '局部重绘 · 来自' });
  await expect(group).toHaveCount(1);
  await expect(group.locator('.ig-kind')).toContainText('局部重绘 · 来自');
  await group.locator('.ig-cell.is-done').first().click();
  await expect(viewer(page)).toContainText('局部重绘 · 来自');
  await viewer(page).getByRole('button', { name: '只换种子再来' }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(3);
  expect(await (await page.request.get(`${COMFY_URL}/_uploads`)).json()).toEqual(first);
});

test('这台 ComfyUI 没装 ComfyUI-Inpaint-CropAndStitch：点开始重绘一张都不发，提示缺插件', async ({ page }) => {
  await newCanvasWithNode(page, '缺插件', '生图节点');
  await setCount(page);
  await send(page, '写一个');
  await generateButton(page).click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
  expect((await page.request.post(`${COMFY_URL}/_hide-nodes`, { data: { types: ['InpaintCropImproved'] } })).ok()).toBe(true);
  expect((await page.request.get('/api/comfy/options?refresh=1')).ok()).toBe(true);

  await box(page).locator('.ig-cell.is-done').first().click();
  await viewer(page).getByRole('button', { name: '局部重绘' }).click();
  await expect(page.locator('.mask-canvas')).toBeVisible();
  await dragBox(page, { x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 });
  const before = (await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as unknown[];
  await page.locator('#ibInpaintGo').click();
  await expect(toasts(page).filter({ hasText: '这组没出成：缺插件' })).toBeVisible();
  expect(((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as unknown[]).length).toBe(before.length);
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
});

test('Krea2 出的图不给局部重绘入口', async ({ page }) => {
  await newCanvasWithNode(page, 'Krea2 不给重绘', '生图节点');
  await panel(page).locator('#cfgSys').selectOption('krea2');
  await send(page, '写一个');
  await generateButton(page).click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1);
  await box(page).locator('.ig-cell.is-done').first().click();
  await expect(viewer(page).getByRole('button', { name: '做四视图' })).toBeVisible();
  await expect(viewer(page).getByRole('button', { name: '局部重绘' })).toHaveCount(0);
});
