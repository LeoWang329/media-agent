import { expect, test, type Page } from '@playwright/test';
import { MOCK_COMFY_PORT } from './env';
import { lastReply, newCanvasWithNode, panel, send, setupWorkFolder, toasts } from './helpers';

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

const box = (page: Page) => lastReply(page).getByTestId('prompt-box');
const comfyPrompts = async (page: Page) => (await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[];

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

test('10.3 第 18 条：尺寸自己填 864×1280 → 出图设置里 LoRA 只作用在画图的模型上，部位重绘那道选用 SAM，VAE 单独选一个，权重算法选 A1111 → 生图 → mock 收到的流程里有这几样，空白画布是 864×1280 → 大图参数里写着', async ({ page }) => {
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL } } })).ok()).toBe(true);
  await newCanvasWithNode(page, 'E02 的几样', '生图节点');
  for (let n = 3; n >= 1; n -= 1) {
    await panel(page).locator('#cntDown').click();
    await expect(panel(page).locator('#imgCount')).toHaveText(`${n} 张`);
  }
  await send(page, '写一个');

  // 尺寸自己填：不是 8 的倍数的取最近的
  await panel(page).locator('#imgSize').selectOption('custom');
  const sizePop = page.getByRole('dialog', { name: '自己填尺寸' });
  await sizePop.getByLabel('宽').fill('870');
  await sizePop.getByLabel('高').fill('1280');
  await expect(sizePop.getByRole('button', { name: '用 872×1280' })).toBeVisible();
  await sizePop.getByLabel('宽').fill('864');
  await sizePop.getByRole('button', { name: '用 864×1280' }).click();
  await expect(toasts(page).filter({ hasText: '下次生图按 864×1280 出' })).toBeVisible();
  await expect(panel(page).locator('#imgSize')).toHaveValue('864×1280');

  const settings = page.getByRole('dialog', { name: '出图设置' });
  await panel(page).locator('#btnGenCfg').click();
  await settings.getByRole('button', { name: '挂一个 LoRA' }).click();
  await settings.getByRole('group', { name: 'LoRA 作用在哪' }).getByRole('button', { name: '只作用在画图的模型' }).click();
  const details = settings.locator('[data-stage="details"]');
  await details.getByRole('button', { name: '加一道' }).click();
  await details.locator('[data-pass="0"]').getByLabel('SAM').selectOption('sam_vit_b_01ec64.pth');
  await settings.locator('.gc-more > summary').click();
  await settings.locator('#gcVae').selectOption('sdxl_vae.safetensors');
  await settings.getByRole('group', { name: '权重算法' }).getByRole('button', { name: 'A1111 的' }).click();
  await expect(settings.locator('.gc-more > summary')).toContainText('sdxl_vae · A1111 权重');
  await settings.getByRole('button', { name: '好了' }).click();

  const sentBefore = (await comfyPrompts(page)).length;
  await box(page).locator('[data-act="gen"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });
  const [body] = (await comfyPrompts(page)).slice(sentBefore);
  const types = Object.values(body.prompt).map((node) => node.class_type);
  for (const type of ['SAMLoader', 'BNK_CLIPTextEncodeAdvanced', 'VAELoader', 'LoraLoaderModelOnly']) expect(types).toContain(type);
  expect(types).not.toContain('LoraLoader');
  expect(types).not.toContain('CLIPTextEncode');
  expect(Object.values(body.prompt).find((node) => node.class_type === 'EmptyLatentImage')!.inputs).toMatchObject({ width: 864, height: 1280 });

  await box(page).locator('.ig-cell').first().click();
  const viewer = page.getByRole('dialog', { name: '看大图和参数' });
  await expect(viewer.locator('.ib-kv', { hasText: '尺寸' })).toContainText('864×1280');
  await expect(viewer.locator('.ib-kv', { hasText: 'VAE' })).toContainText('sdxl_vae');
  await expect(viewer.locator('.ib-kv', { hasText: 'LoRA' })).toContainText('只作用在画图的模型上');
  await expect(viewer.locator('.ib-kv', { hasText: '权重算法' })).toContainText('A1111 的');
  await expect(viewer.locator('.ib-kv', { hasText: '部位重绘' })).toContainText('SAM sam_vit_b_01ec64');
});
