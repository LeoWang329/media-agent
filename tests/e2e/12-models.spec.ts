import { expect, test } from '@playwright/test';
import { MOCK_AUTODL_TOKEN, MOCK_AUTODL_UUID } from '../../tools/mock-comfyui/src/autodl';
import { MOCK_COMFY_PORT } from './env';
import { newCanvasWithNode, panel, setupWorkFolder, toasts } from './helpers';

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;
const LORA = { name: 'mine-lora.safetensors', mimeType: 'application/octet-stream', buffer: Buffer.alloc(200_000, 1) };

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

test('10.3 第 16 条：设置「AutoDL 上的模型」→ 从电脑传一个 LoRA 到子文件夹 IL → 列表里有、出图设置的 LoRA 里搜得到 → 同名再传问换不换 → 给链接下一个放大模型 → 删掉 LoRA，列表和下拉里都没了', async ({ page }) => {
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL, autodl: { instanceUuid: MOCK_AUTODL_UUID } } } })).ok()).toBe(true);
  expect((await page.request.put('/api/config', { data: { autodlToken: MOCK_AUTODL_TOKEN, comfyTarget: 'lan' } })).ok()).toBe(true);

  await page.goto('/settings#autodl-models');
  await expect(page.locator('[data-od-id="autodl-models-head"]')).toBeVisible();

  // 从电脑传：实例关着，点「传」先开机
  const uploadFile = async () => {
    await page.locator('#mxUpload').click();
    const dialog = page.getByRole('dialog', { name: '从电脑传' });
    await dialog.getByLabel('选文件').setInputFiles(LORA);
    await expect(dialog.getByLabel('文件名')).toHaveValue('mine-lora.safetensors');
    await expect(dialog.getByLabel('模型类型')).toHaveValue('lora');
    await dialog.getByLabel('子文件夹').fill('IL');
    await dialog.getByRole('button', { name: '传', exact: true }).click();
  };
  await uploadFile();
  await expect(toasts(page).filter({ hasText: '「mine-lora.safetensors」排上了' })).toBeVisible({ timeout: 30_000 });
  const lora = page.locator('[data-file="lora:IL/mine-lora.safetensors"]');
  await expect(lora).toContainText('0.2 MB', { timeout: 15_000 });
  await expect(page.locator('.mx-transfer').first()).toContainText('传完了');
  await expect(page.locator('.mx-state')).toContainText('那台还剩');

  // 出图设置的 LoRA 下拉里搜得到
  await newCanvasWithNode(page, '传上去的 LoRA');
  await panel(page).locator('#cfgSys').selectOption('il');
  await expect(toasts(page).filter({ hasText: '这个节点变成生图节点' })).toBeVisible();
  const settings = page.getByRole('dialog', { name: '出图设置' });
  await panel(page).locator('#btnGenCfg').click();
  await settings.getByRole('button', { name: '挂一个 LoRA' }).click();
  await settings.getByRole('button', { name: 'LoRA', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选 LoRA' });
  await picker.getByRole('textbox', { name: '搜 LoRA' }).fill('mine');
  await expect(picker.getByRole('option')).toHaveText(['IL/mine-lora.safetensors']);
  await page.keyboard.press('Escape');

  // 同名再传：问要不要换掉
  await page.goto('/settings#autodl-models');
  await uploadFile();
  const ask = page.getByRole('dialog', { name: '那台上已经有「IL/mine-lora.safetensors」了，换掉吗？' });
  await ask.getByRole('button', { name: '换掉' }).click();
  await expect(toasts(page).filter({ hasText: '「mine-lora.safetensors」排上了' })).toBeVisible();
  await expect(page.locator('.mx-transfer')).toHaveCount(2);
  await expect(page.locator('.mx-transfer').first()).toContainText('传完了', { timeout: 15_000 });

  // 给链接下：文件名从链接里取
  await page.locator('#mxDownload').click();
  const download = page.getByRole('dialog', { name: '给链接下' });
  await download.getByLabel('下载链接').fill(`${COMFY_URL}/_files/4x-mine.pth?bytes=50000`);
  await expect(download.getByLabel('文件名')).toHaveValue('4x-mine.pth');
  await download.getByLabel('模型类型').selectOption('upscale');
  await download.getByRole('button', { name: '下', exact: true }).click();
  await expect(toasts(page).filter({ hasText: '排上了，那台自己下' })).toBeVisible();
  await expect(page.locator('[data-file="upscale:4x-mine.pth"]')).toContainText('0.0 MB', { timeout: 15_000 });

  // 删掉 LoRA：列表和下拉里都没了
  await lora.locator('[data-ma="del"]').click();
  await page.getByRole('dialog', { name: '删掉「IL/mine-lora.safetensors」？' }).getByRole('button', { name: '删除' }).click();
  await expect(lora).toHaveCount(0);
  await expect
    .poll(async () => ((await (await page.request.get('/api/comfy/options')).json()) as { loras: string[] }).loras)
    .not.toContain('IL/mine-lora.safetensors');

  // 收尾：删掉放大模型，关掉实例，后面的用例从关着开始
  await page.request.delete('/api/comfy/autodl/models', { data: { kind: 'upscale', path: '4x-mine.pth' } });
  await page.request.post('/api/comfy/autodl/power', { data: { on: false } });
});
