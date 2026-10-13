import { expect, test } from '@playwright/test';
import { FOUR_VIEW_INSTRUCTION } from '@media-agent/shared';
import { E2E_WORK_FOLDER } from './env';
import { panel, setupWorkFolder } from './helpers';
import { chooseFn, currentNode, graphOf, nodeOf, prepareEdit, startEditResult } from './edit-helpers';

test.beforeAll(async ({ playwright }) => { await setupWorkFolder(playwright); });

test('放大 2/4 倍不重绘，面部修复单独启用', async ({ page }) => {
  await prepareEdit(page, '放大参数');
  await chooseFn(page, 'upscale');
  await expect(panel(page).locator('#wbText')).toHaveCount(0);
  await panel(page).locator('#wbScale').selectOption('4');
  await startEditResult(page);
  let graph = await graphOf(page);
  expect(nodeOf(graph, 'ImageUpscaleWithModel')).toBeTruthy();
  expect(nodeOf(graph, 'KSampler')).toBeUndefined();
  expect((await currentNode(page)).edit?.upscale.scale).toBe(4);
  await panel(page).getByRole('tab', { name: '执行', exact: true }).click();
  await panel(page).locator('#wbScale').selectOption('2');
  await panel(page).locator('#wbFace').selectOption('on');
  await startEditResult(page, 2);
  graph = await graphOf(page);
  expect(nodeOf(graph, 'FaceDetailer')).toBeTruthy();
});

test('四视图预设与自定义尺寸，固定指令追加额外要求，空白也可生成', async ({ page }) => {
  await prepareEdit(page, '四视图尺寸');
  await chooseFn(page, 'fourview');
  await expect(panel(page).locator('#wbFourW')).toHaveValue('1536');
  await panel(page).locator('#wbFourPreset').selectOption('custom');
  await expect(panel(page).locator('#wbFourPreset')).toHaveValue('custom');
  await panel(page).locator('#wbFourW').fill('1280');
  await panel(page).locator('#wbFourH').fill('768');
  await panel(page).locator('#wbText').fill('blue background');
  await startEditResult(page);
  let job = Object.values((await currentNode(page)).messages).flatMap((m) => m.images ?? [])[0];
  expect(job.params).toMatchObject({ width: 1280, height: 768, positive: `${FOUR_VIEW_INSTRUCTION}\n\nblue background` });
  expect(nodeOf(await graphOf(page), 'Krea2EditGroundedEncode')).toBeTruthy();
  await panel(page).getByRole('tab', { name: '执行', exact: true }).click();
  await panel(page).locator('#wbText').fill('');
  await panel(page).locator('#wbFourPreset').selectOption('1024x1024');
  await startEditResult(page, 2);
  job = Object.values((await currentNode(page)).messages).flatMap((m) => m.images ?? []).at(-1)!;
  expect(job.params.positive).toBe(FOUR_VIEW_INSTRUCTION);
  expect(job.params).toMatchObject({ width: 1024, height: 1024 });
});

for (const initialFn of ['edit', 'upscale', 'real'] as const) test(`保存后 ${initialFn} 继续创作保留源图与候选关系，临时图禁止派生`, async ({ page }) => {
  await prepareEdit(page, `保存派生-${initialFn}`);
  if (initialFn === 'edit') {
    await panel(page).locator('#wbText').fill('a red coat');
    await panel(page).getByRole('button', { name: '保存候选', exact: true }).click();
    await expect(panel(page).getByRole('tab', { name: '创作', exact: true })).toHaveAttribute('aria-selected', 'true');
    await panel(page).getByRole('tab', { name: '执行', exact: true }).click();
  } else {
    await chooseFn(page, initialFn);
    if (initialFn === 'real') await panel(page).locator('#wbPromptSource').selectOption('interrogate');
  }
  await startEditResult(page);
  const node = await currentNode(page);
  const [messageId, message] = Object.entries(node.messages).find(([, m]) => m.images?.length)!;
  const candidate = { messageId, promptIndex: message.images![0].promptIndex };
  await panel(page).getByRole('button', { name: '继续创作', exact: true }).click();
  const derive = page.getByRole('dialog', { name: '继续创作' });
  await expect(derive.getByRole('button', { name: '四视图', exact: true })).toBeDisabled();
  await derive.getByRole('button', { name: '保存源图', exact: true }).click();
  // 通过既有下载弹窗保存到隔离测试工作目录，避免调用系统选目录。
  expect((await page.request.post('/api/assets/folders', { data: { path: E2E_WORK_FOLDER } })).ok()).toBe(true);
  await page.route('**/api/assets/pick-folder', (route) => route.fulfill({ json: { path: E2E_WORK_FOLDER } }));
  await page.getByRole('dialog', { name: '下载', exact: true }).locator('[data-dl=pick]').click();
  await page.getByRole('dialog', { name: '下载', exact: true }).getByRole('button', { name: '下载', exact: true }).click();
  await expect(panel(page).locator('.wb-result')).toContainText('已保存');
  await panel(page).getByRole('button', { name: '继续创作', exact: true }).click();
  await derive.getByRole('button', { name: '四视图', exact: true }).click();
  await expect(panel(page).getByRole('tab', { name: '执行', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await currentNode(page)).edit?.source?.jobId).toBe(Object.values(node.messages).flatMap((m) => m.images ?? [])[0].id);
  expect((await currentNode(page)).edit?.candidate).toEqual(candidate);
  await startEditResult(page, 2);
  const after = await currentNode(page);
  const jobs = after.messages[candidate!.messageId].images!;
  expect(jobs).toHaveLength(2);
  expect(jobs[1].source?.jobId).toBe(jobs[0].id);
  expect(Object.keys(after.messages)).toHaveLength(Object.keys(node.messages).length);
});
