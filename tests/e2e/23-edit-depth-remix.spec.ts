import { expect, test } from '@playwright/test';
import { REMIX_LORAS } from '@media-agent/shared';
import { panel, setupWorkFolder } from './helpers';
import { chooseFn, graphOf, nodeOf, prepareEdit, startEditResult } from './edit-helpers';

test.beforeAll(async ({ playwright }) => { await setupWorkFolder(playwright); });

test('深度迁移上限 2 可执行，结构控制与 1024 方图契约保持', async ({ page }) => {
  await prepareEdit(page, '深度参数');
  await chooseFn(page, 'depth');
  await panel(page).locator('#wbText').fill('a rainy street');
  await panel(page).locator('#wbControl').fill('2');
  await startEditResult(page);
  const graph = await graphOf(page);
  expect(nodeOf(graph, 'Krea2ControlLoRALoader').inputs.strength).toBe(2);
  expect(nodeOf(graph, 'Krea2ControlImageEncode')).toBeTruthy();
  expect(nodeOf(graph, 'Krea2ControlApply')).toBeTruthy();
  await expect(panel(page).locator('.wb-result')).toContainText('1024 × 1024');
});

for (const variant of ['ReID', 'RealCosplay']) {
  test(`Remix ${variant} 选择对应 LoRA，Ostris 编码与参考图分支保持`, async ({ page }) => {
    await prepareEdit(page, `Remix-${variant}`);
    await chooseFn(page, 'remix');
    await panel(page).locator('#wbVariant').selectOption(variant);
    const lora = REMIX_LORAS[variant === 'ReID' ? 0 : 1].name;
    await expect(panel(page).locator('#wbLora')).toHaveValue(lora);
    await panel(page).locator('#wbText').fill('white shirt in a garden');
    await startEditResult(page);
    const graph = await graphOf(page);
    expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs.lora_name).toBe(lora);
    expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).toBe('white shirt in a garden');
    expect(Object.values(graph).filter((n) => n.class_type === 'FluxKontextMultiReferenceLatentMethod')).toHaveLength(2);
  });
}

test('非法参数不提交；有效数字恢复后可执行', async ({ page }) => {
  await prepareEdit(page, '参数校验');
  await chooseFn(page, 'depth');
  await panel(page).locator('#wbText').fill('rain');
  await panel(page).locator('#wbControl').fill('0');
  await panel(page).locator('#editStart').click();
  await expect(panel(page).locator('#editDockError')).toContainText('允许范围');
  await expect(panel(page).locator('.wb-taskrow')).toHaveCount(0);
  await panel(page).locator('#wbControl').fill('0.8');
  await startEditResult(page);
});
