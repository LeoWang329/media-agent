import { expect, test } from '@playwright/test';
import { cards, lastReply, panel, send, setupWorkFolder, toasts } from './helpers';
import { chooseFn, currentNode, graphOf, nodeAt, nodeOf, prepareEdit, reopenEdit, startEditResult } from './edit-helpers';

test.beforeAll(async ({ playwright }) => { await setupWorkFolder(playwright); });

test('改图工作区：默认执行，三页签，固定用途，上下文与思考保存', async ({ page }) => {
  await prepareEdit(page, '新版改图工作区');
  await expect(panel(page).getByRole('tab')).toHaveText(['创作', '执行', '结果']);
  await expect(panel(page).getByRole('tab', { name: '执行', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).locator('#cfgSys')).toBeDisabled();
  await expect(panel(page).locator('#cfgSys')).toContainText('图像编辑 · 用途固定');
  await expect(panel(page).locator('#editChatDisclosure')).toBeHidden();
  await expect(cards(page).first()).toContainText('改图 · 指令编辑');
  await panel(page).locator('#cfgThink').click();
  const dialog = page.getByRole('dialog', { name: '上下文与思考' });
  await dialog.locator('#wbRounds').selectOption('5');
  await dialog.locator('#wbThinking').selectOption('low');
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await expect.poll(async () => (await currentNode(page)).thinking).toBe('low');
  await reopenEdit(page);
  await panel(page).locator('#cfgThink').click();
  await expect(dialog.locator('#wbRounds')).toHaveValue('5');
  await expect(dialog.locator('#wbThinking')).toHaveValue('low');
  await page.keyboard.press('Escape');
  await panel(page).getByRole('tab', { name: '创作', exact: true }).click();
  await expect(panel(page).getByRole('textbox', { name: '继续对话' })).toBeVisible();
  await expect(panel(page).locator('#editStart')).toHaveCount(0);
  await panel(page).getByRole('tab', { name: '结果', exact: true }).click();
  await expect(panel(page).locator('#editStart')).toBeVisible();
});

test('辅助编写不覆盖执行文字；候选原框归属、版本和结果保留', async ({ page }) => {
  await prepareEdit(page, '候选与执行');
  await panel(page).locator('#wbText').fill('保留这句执行要求');
  await panel(page).getByRole('tab', { name: '创作', exact: true }).click();
  await send(page, '把外套换成朋克风，给我三个方向');
  await expect(lastReply(page).getByTestId('prompt-box')).toHaveCount(3);
  await panel(page).getByRole('tab', { name: '执行', exact: true }).click();
  await expect(panel(page).locator('#wbText')).toHaveValue('保留这句执行要求');
  await panel(page).locator('#wbCandidate').selectOption({ index: 1 });
  await expect(panel(page).locator('#wbText')).toHaveValue(/black studded leather biker jacket/);
  const before = await currentNode(page);
  await startEditResult(page);
  const after = await currentNode(page);
  expect(Object.keys(after.messages)).toHaveLength(Object.keys(before.messages).length);
  expect(after.messages[after.edit!.candidate!.messageId].images).toHaveLength(1);
  expect(nodeOf(await graphOf(page), 'TextEncodeKrea2OstrisEdit').inputs.prompt).toContain('black studded leather biker jacket');
  await chooseFn(page, 'outfit');
  await panel(page).locator('#wbCandidate').selectOption({ index: 1 });
  await expect(panel(page).locator('#editOp')).toHaveValue('outfit');
  await startEditResult(page, 2);
  expect(nodeOf(await graphOf(page), 'LoraLoaderModelOnly').inputs.lora_name).toBe('krea2/krea_outfittransfer.safetensors');
  await panel(page).getByRole('tab', { name: '执行', exact: true }).click();
  await panel(page).locator('#wbText').fill('换成红色外套');
  await panel(page).getByRole('button', { name: '保存候选', exact: true }).click();
  await expect(panel(page).getByRole('tab', { name: '创作', exact: true })).toHaveAttribute('aria-selected', 'true');
  const revised = await currentNode(page);
  expect(Object.values(revised.messages).some((m) => m.images?.length)).toBe(true);
  expect(Object.keys(revised.messages).length).toBeGreaterThan(Object.keys(after.messages).length);
});

test('候选绑定原图，原图缺失时拦住，显式复用文字解除绑定', async ({ page }) => {
  await prepareEdit(page, '候选原图绑定', 2);
  await panel(page).locator('#slots .slot').nth(1).press('Space');
  await expect(panel(page).locator('#slots .slot').nth(1)).toHaveClass(/is-source/);
  await panel(page).locator('#slots .slot').nth(0).press('Enter');
  await expect(panel(page).locator('#slots .slot').nth(0)).toHaveClass(/is-source/);
  await panel(page).locator('#wbText').fill('blue coat');
  await panel(page).getByRole('button', { name: '保存候选', exact: true }).click();
  await expect(panel(page).getByRole('tab', { name: '创作', exact: true })).toHaveAttribute('aria-selected', 'true');
  await panel(page).getByRole('tab', { name: '执行', exact: true }).click();
  const at = await nodeAt(page);
  const node = await currentNode(page);
  expect((await page.request.patch(at, { data: { slots: [node.slots[1]] } })).ok()).toBe(true);
  await reopenEdit(page);
  await panel(page).locator('#editStart').click();
  await expect(panel(page).locator('#editDockError')).toContainText('候选绑定的原图');
  await panel(page).getByRole('button', { name: '复用文字', exact: true }).click();
  await panel(page).locator('#wbText').press('Control+Enter');
  await expect(panel(page).getByRole('tab', { name: '结果', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).locator('.wb-result')).toHaveCount(1, { timeout: 20_000 });
});

test('结果：收藏、比较完整图、同参数与换种子重出，文件缺失独立提示', async ({ page }) => {
  await prepareEdit(page, '结果工具');
  await panel(page).locator('#wbText').fill('red coat');
  await panel(page).locator('#wbSeedMode').selectOption('fixed');
  await panel(page).locator('#wbSeed').fill('123');
  await startEditResult(page);
  await panel(page).getByRole('button', { name: '收藏', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: '已收藏', exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: '任务快照', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /任务快照/ });
  await expect(dialog).toContainText('123');
  await dialog.getByRole('button', { name: '同参数重出', exact: true }).click();
  await expect(panel(page).locator('.wb-result')).toHaveCount(2, { timeout: 20_000 });
  await panel(page).locator('.wb-result input[type=checkbox]').nth(0).check();
  await panel(page).locator('.wb-result input[type=checkbox]').nth(1).check();
  await panel(page).getByRole('button', { name: '比较', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '比较结果' }).locator('img')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await panel(page).locator('.wb-result').first().getByRole('button', { name: '任务快照' }).click();
  await dialog.getByRole('button', { name: '只换种子', exact: true }).click();
  await expect(panel(page).locator('.wb-result')).toHaveCount(3, { timeout: 20_000 });
  const seeds = Object.values((await currentNode(page)).messages).flatMap((m) => m.images ?? []).flatMap((j) => j.images.map((i) => i.seed));
  expect(seeds.filter((seed) => seed === 123)).toHaveLength(2);
  expect(seeds.some((seed) => seed !== 123)).toBe(true);
  await page.route('**/images/*/*/file*', (route) => route.fulfill({ status: 404 }));
  await reopenEdit(page);
  await panel(page).getByRole('tab', { name: '结果', exact: true }).click();
  await expect(panel(page).locator('.wb-result').first()).toContainText('结果文件已缺失');
  await expect(panel(page).locator('.wb-result').first()).toContainText('完成');
});

test('任务失败与停止状态可见，失败保留参数并可重试', async ({ page }) => {
  await prepareEdit(page, '任务状态');
  await panel(page).locator('#wbText').fill('显存不足');
  await panel(page).locator('#editStart').click();
  await expect(panel(page).locator('.wb-taskrow')).toContainText('失败', { timeout: 20_000 });
  await panel(page).locator('.wb-taskrow').getByRole('button', { name: /失败/ }).click();
  await expect(page.getByRole('dialog', { name: /任务快照/ })).toContainText('CUDA');
  await expect(page.getByRole('dialog', { name: /任务快照/ }).getByRole('button', { name: '重试', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await panel(page).getByRole('tab', { name: '执行', exact: true }).click();
  await panel(page).locator('#wbText').fill('慢任务');
  await panel(page).locator('#editStart').click();
  await panel(page).locator('.wb-taskrow').first().getByRole('button', { name: '停止任务' }).click();
  await expect(panel(page).locator('.wb-taskrow').first()).toContainText('停止', { timeout: 15_000 });
});

test('原型布局：桌面与手机无横向溢出，页签与底部操作可访问', async ({ page }, testInfo) => {
  await prepareEdit(page, '布局回归');
  await expect(toasts(page)).toHaveCount(0, { timeout: 8000 });
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel(page).getByRole('tab', { name: '执行', exact: true })).toBeVisible();
    await expect(panel(page).getByRole('tab', { name: '执行', exact: true })).toBeInViewport();
    await expect(panel(page).locator('#editStart')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: '电脑里的图', exact: true })).toHaveCount(1);
    expect(await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`edit-${width}.png`) });
  }
});
