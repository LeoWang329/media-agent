import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { E2E_WORK_FOLDER, MOCK_COMFY_PORT } from './env';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { assetsDialog, assetTile, lastReply, newCanvasWithNode, panel, setupWorkFolder, toasts } from './helpers';

// 10.3 第 18 条（E5）：图像编辑节点的第四个功能「局部重绘」—— 掩码在编辑栏里画，原图是槽位里选中的那张，
// 走 E05 那条路子（跟大图窗口那条一模一样，见 tests/e2e/19-inpaint.spec.ts、docs/dev-plan.md 5.38、5.39）

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const graphOf = async (page: Page) => ((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[]).at(-1)!.prompt;
const nodeOf = (graph: Graph, type: string) => Object.values(graph).find((n) => n.class_type === type)!;
const nodesOf = (graph: Graph, type: string) => Object.values(graph).filter((n) => n.class_type === type);
const idOf = (graph: Graph, node: { class_type: string; inputs: Record<string, unknown> }) => Object.entries(graph).find(([, n]) => n === node)![0];
const dock = (page: Page) => panel(page).locator('[data-od-id="composer-dock"]');

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

test.beforeEach(async ({ page }) => {
  expect((await page.request.put('/api/config', { data: { comfyTarget: 'lan' } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL } } })).ok()).toBe(true);
  expect((await page.request.post(`${COMFY_URL}/_hide-nodes`, { data: { types: [] } })).ok()).toBe(true);
});

// 往槽位里放测试图（01-red.jpg，800×600）
async function putImage(page: Page) {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).locator('.as-folder').filter({ hasText: FIXTURES_DIR }).first().click();
  await assetTile(page, FIXTURES.first).click();
  await assetsDialog(page).getByRole('button', { name: /放进槽位/ }).click();
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(1);
}

// 编辑栏的功能下拉里切到局部重绘
async function useInpaint(page: Page) {
  await dock(page).locator('#editFn').click();
  await page.getByRole('menuitem', { name: '局部重绘' }).click();
  await expect(dock(page).locator('#editFn')).toContainText('局部重绘');
}

// 在掩码画布上从左上往右下拖一下，坐标按显示框的比例给（跟 19-inpaint 那份同一套画法）
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

// 服务端落盘的那张掩码 PNG：临时文件夹里最新的、尺寸对得上的那张（同一轮里别的用例也会落掩码）
async function maskFile(size: { width: number; height: number }): Promise<string> {
  const root = path.join(E2E_WORK_FOLDER, 'image-temp');
  const days = await fs.readdir(root).catch(() => []);
  const found: { file: string; at: number }[] = [];
  for (const day of days) {
    for (const name of await fs.readdir(path.join(root, day))) {
      if (!name.endsWith('-mask.png')) continue;
      const file = path.join(root, day, name);
      const meta = await sharp(file).metadata().catch(() => null);
      if (!meta || meta.width !== size.width || meta.height !== size.height) continue;
      found.push({ file, at: (await fs.stat(file)).mtimeMs });
    }
  }
  found.sort((a, b) => b.at - a.at);
  if (!found.length) throw new Error(`临时文件夹里没有 ${size.width}×${size.height} 的掩码 PNG`);
  return found[0].file;
}

test('10.3 第 18 条（E5）：编辑节点切到局部重绘 → 面板上出现画掩码的地方 → 拖个框 → 开始 → 出图挂在框下面', async ({ page }, testInfo) => {
  await newCanvasWithNode(page, '编辑节点局部重绘', '图像编辑节点');
  await putImage(page);
  await useInpaint(page);

  // 面板上出现了画掩码的入口：工具条、画布、还没画的说明
  await expect(dock(page).locator('[data-od-id="edit-mask"]')).toBeVisible();
  await expect(dock(page).locator('.mask-canvas')).toBeVisible();
  await expect(dock(page).locator('#editMaskState')).toBeVisible();
  await expect(dock(page).locator('#editMaskState')).toContainText('还没画');
  await expect(dock(page).locator('.mask-tools').getByRole('button', { name: '拖框' })).toBeVisible();
  await expect(dock(page).locator('.mask-tools').getByRole('button', { name: '涂抹' })).toBeVisible();
  await expect(dock(page).locator('.mask-tools').getByRole('button', { name: '擦' })).toBeVisible();

  // 还没画掩码：「开始」按住，说清要先画一块
  await expect(dock(page).locator('#btnEditStart')).toBeDisabled();
  await dock(page).locator('#editText').fill('一件红色皮衣领子');
  await expect(dock(page).locator('#btnEditStart')).toBeDisabled();
  await expect(dock(page).locator('#btnEditStart')).toHaveAttribute('title', '先在图上拖个框或者涂抹出要重画的地方');
  // 提示词下拉里是局部重绘那几条（写的都是「这块画成什么」，不是祈使句）
  await dock(page).locator('#editPreset').selectOption({ label: '换衣领 · 只改领子' });
  await expect(dock(page).locator('#editText')).toHaveValue('a red leather jacket collar');

  // 拖个框 → 能画了
  await dragBox(page, { x: 0.2, y: 0.15 }, { x: 0.45, y: 0.4 });
  await expect(dock(page).locator('#editMaskState')).toContainText('画好了');
  await expect(dock(page).locator('#btnEditStart')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('edit-mask.png'), fullPage: true });

  // 涂抹能叠加、撤销能退回去（跟大图窗口那套手感一样）
  await dock(page).locator('.mask-tools').getByRole('button', { name: '涂抹' }).click();
  await dragBox(page, { x: 0.6, y: 0.6 }, { x: 0.75, y: 0.75 });
  await expect(page.locator('#maskUndo')).toBeEnabled();
  await page.locator('#maskUndo').click();
  await dock(page).locator('.mask-tools').getByRole('button', { name: '拖框' }).click();

  // 重绘强度：默认 0.85，改成 0.7
  await expect(dock(page).locator('#editInpaintDenoise')).toHaveValue('0.85');
  await dock(page).locator('#editInpaintDenoise').fill('0.7');
  await dock(page).locator('#editInpaintDenoise').press('Enter');

  await dock(page).locator('#btnEditStart').click();
  await expect(toasts(page).filter({ hasText: '开始重绘这一块' })).toBeVisible();
  const box = lastReply(page).getByTestId('prompt-box');
  await expect(box).toContainText('局部重绘');
  await expect(box.locator('.ig-cell.is-done img')).toHaveCount(1);

  // 服务端收到的那张 PNG：跟原图同尺寸（800×600），框里的 alpha 是 0，别处是 255
  const file = await maskFile({ width: 800, height: 600 });
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect({ width: info.width, height: info.height }).toEqual({ width: 800, height: 600 });
  expect(info.width).toBe(800);
  const alphaAt = (x: number, y: number) => data[(Math.round(y * info.height) * info.width + Math.round(x * info.width)) * 4 + 3];
  expect(alphaAt(0.32, 0.27)).toBe(0);
  expect(alphaAt(0.8, 0.85)).toBe(255);
  expect(alphaAt(0.05, 0.9)).toBe(255);

  // 发出去的流程是 E05 那套（跟大图窗口那条同一个 inpaintGraph），强度进图。
  // 底图和掩码分两张传（LoadImage 会把 RGBA 按 alpha 合成到黑底，合成一张的话要重画那块是黑的）
  const graph = await graphOf(page);
  const loads = nodesOf(graph, 'LoadImage');
  expect(loads).toHaveLength(2);
  expect(loads.map((one) => one.inputs.image)).toEqual([expect.any(String), expect.any(String)]);
  expect(nodeOf(graph, 'InpaintCropImproved').inputs).toMatchObject({
    image: [idOf(graph, loads[0]), 0],
    mask: [idOf(graph, loads[1]), 1],
    mask_expand_pixels: 8,
    output_target_width: 1024,
    output_target_height: 1024,
  });
  expect(nodeOf(graph, 'InpaintModelConditioning').inputs.noise_mask).toBe(true);
  expect(nodeOf(graph, 'InpaintStitchImproved').inputs).toEqual({ stitcher: [idOf(graph, nodeOf(graph, 'InpaintCropImproved')), 0], inpainted_image: [idOf(graph, nodeOf(graph, 'VAEDecode')), 0] });
  expect(nodeOf(graph, 'KSampler').inputs.denoise).toBe(0.7);
  // 局部重绘走的是内置 SDXL 那条路，不是编辑档那套 Krea2 节点
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch')).toBeUndefined();
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit')).toBeUndefined();
});
