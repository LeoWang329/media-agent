import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { MOCK_COMFY_PORT } from './env';
import { cardTitled, drawerTitle, lastReply, newCanvasWithNode, panel, placeFromAssets, send, setupWorkFolder, toasts } from './helpers';

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

const box = (page: Page) => lastReply(page).getByTestId('prompt-box');
const comfyPrompts = async (page: Page) => (await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[];
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 面板里这个节点存着的数据
async function nodeOf(page: Page) {
  const canvasId = new URL(page.url()).pathname.split('/').at(-1)!;
  const nodeId = (await cardTitled(page, (await drawerTitle(page).textContent())!).getAttribute('data-id'))!;
  const node = (await (await page.request.get(`/api/canvases/${canvasId}/nodes/${nodeId}`)).json()) as { slots: string[]; image?: { controls: { type: string }[] } };
  return { canvasId, node };
}

test('10.3 第 13 条：槽位放一张图 → 出图设置里加一个深度的 ControlNet，提取方式是 MiDaS，参考图选槽位 1 号 → 生图 → mock 收到传上去的那张，流程里先提取再接 ControlNet，采样接在它后面 → 大图参数里写着 → 再加一个姿势的、不选参考图，生图时说还没选', async ({ page }) => {
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL } } })).ok()).toBe(true);
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await newCanvasWithNode(page, 'ControlNet', '生图节点');
  for (let n = 3; n >= 1; n -= 1) {
    await panel(page).locator('#cntDown').click();
    await expect(panel(page).locator('#imgCount')).toHaveText(`${n} 张`);
  }
  await placeFromAssets(page, [FIXTURES.first]);
  await send(page, '写一个');

  const settings = page.getByRole('dialog', { name: '出图设置' });
  const controls = settings.locator('[data-stage="controls"]');
  await panel(page).locator('#btnGenCfg').click();
  await controls.getByRole('button', { name: '加一个' }).click();
  const depth = controls.locator('[data-control="0"]');
  // 新加的是深度，提取方式先选 MiDaS，模型先选名字带 depth 的
  await expect(depth.getByLabel('类型')).toHaveValue('depth');
  await expect(depth.getByLabel('提取方式')).toHaveValue('MiDaS-DepthMapPreprocessor');
  await expect(depth.getByLabel('ControlNet 模型')).toHaveValue('depth-test.safetensors');
  await depth.getByRole('button', { name: '参考图' }).click();
  await page.getByRole('dialog', { name: '选参考图' }).getByRole('button', { name: '槽位 1 号' }).click();
  await expect(depth.getByRole('button', { name: '参考图' })).toContainText('槽位 1 号');
  await settings.getByRole('button', { name: '好了' }).click();

  const sentBefore = (await comfyPrompts(page)).length;
  await box(page).locator('[data-act="gen"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });
  const [body] = (await comfyPrompts(page)).slice(sentBefore);
  const idOf = (type: string) => Object.keys(body.prompt).find((id) => body.prompt[id].class_type === type)!;
  expect(body.prompt[idOf('AIO_Preprocessor')].inputs).toMatchObject({ preprocessor: 'MiDaS-DepthMapPreprocessor', resolution: 832 });
  expect(body.prompt[idOf('ControlNetApplyAdvanced')].inputs).toMatchObject({ strength: 1, start_percent: 0, end_percent: 1 });
  expect(body.prompt[idOf('KSampler')].inputs).toMatchObject({ positive: [idOf('ControlNetApplyAdvanced'), 0], negative: [idOf('ControlNetApplyAdvanced'), 1] });

  // 传上去的就是槽位里那张
  const { canvasId, node } = await nodeOf(page);
  const slotImage = Buffer.from(await (await page.request.get(`/api/canvases/${canvasId}/images/${node.slots[0]}/file`)).body());
  const uploads = (await (await page.request.get(`${COMFY_URL}/_uploads`)).json()) as { name: string; sha256: string }[];
  const uploaded = uploads.find((item) => item.name === body.prompt[idOf('LoadImage')].inputs.image)!;
  expect(uploaded.sha256).toBe(sha256(slotImage));

  await box(page).locator('.ig-cell').first().click();
  const viewer = page.getByRole('dialog', { name: '看大图和参数' });
  await expect(viewer.locator('.ib-kv', { hasText: 'ControlNet' })).toContainText('深度 depth-test');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // 再加一个姿势的，换了类型，提取方式和模型跟着换；不选参考图就生图
  await panel(page).locator('#btnGenCfg').click();
  await controls.getByRole('button', { name: '加一个' }).click();
  const pose = controls.locator('[data-control="1"]');
  await pose.getByLabel('类型').selectOption('pose');
  await expect(pose.getByLabel('提取方式')).toHaveValue('DWPreprocessor');
  await expect(pose.getByLabel('ControlNet 模型')).toHaveValue('openpose-test.safetensors');
  await settings.getByRole('button', { name: '好了' }).click();
  await expect.poll(async () => (await nodeOf(page)).node.image?.controls.map((control) => control.type)).toEqual(['depth', 'pose']);
  await box(page).locator('[data-act="gen"]').click();
  await expect(toasts(page).filter({ hasText: 'ControlNet 第 2 个还没选参考图' })).toBeVisible();
});
