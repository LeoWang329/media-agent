import { expect, test } from '@playwright/test';
import { REAL_TRIGGER, REAL_TRIGGER_DUAL } from '@media-agent/shared';
import { panel, setupWorkFolder } from './helpers';
import { chooseFn, currentNode, graphOf, nodeOf, prepareEdit, startEditResult } from './edit-helpers';

// canvas.html 的转真人参数区：单/双图与手输/反推是独立选择。
test.beforeAll(async ({ playwright }) => { await setupWorkFolder(playwright); });

for (const dual of [false, true]) for (const reverse of [false, true]) {
  test(`转真人 ${dual ? '双图' : '单图'} + ${reverse ? '反推' : '手输'}：参数进入正确分支，结果和提示词可查`, async ({ page }) => {
    await prepareEdit(page, `转真人-${dual}-${reverse}`, dual ? 2 : 1);
    await chooseFn(page, 'real');
    await panel(page).locator('#wbDual').selectOption(dual ? 'dual' : 'single');
    await panel(page).locator('#wbPromptSource').selectOption(reverse ? 'interrogate' : 'manual');
    if (dual) {
      await panel(page).locator('#wbRef2').selectOption('1');
      await panel(page).locator('#wbStrength').fill('0.6');
    }
    if (!reverse) await panel(page).locator('#wbText').fill('red jacket in the rain');
    await panel(page).locator('#wbInterrogateSeed').fill('88221');
    await panel(page).locator('#wbSeedMode').selectOption('fixed');
    await panel(page).locator('#wbSeed').fill('1234');
    await startEditResult(page);
    const graph = await graphOf(page);
    const easy = nodeOf(graph, 'Easy_QwenEdit2509');
    const interrogator = nodeOf(graph, 'llama_cpp_instruct_adv');
    if (reverse) {
      expect(interrogator.inputs.seed).toBe(88221);
      expect(Array.isArray(easy.inputs.prompt)).toBe(true);
    } else {
      expect(interrogator).toBeUndefined();
      expect(easy.inputs.prompt).toBe(`${dual ? REAL_TRIGGER_DUAL : REAL_TRIGGER}\n\nred jacket in the rain`);
    }
    expect(nodeOf(graph, 'KSampler').inputs).toMatchObject({ seed: 1234, steps: 8, cfg: 1, scheduler: 'beta57' });
    if (dual) expect(easy.inputs.image2_strength).toBe(0.6);
    const job = Object.values((await currentNode(page)).messages).flatMap((m) => m.images ?? [])[0];
    expect(job.params.real).toMatchObject({ reverse, dual, reverseSeed: 88221 });
    if (reverse) expect(job.images[0].promptText).toContain(REAL_TRIGGER);
    await panel(page).getByRole('button', { name: '任务快照', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /任务快照/ })).toContainText('1536');
  });
}

test('转真人双图没有第二张时明确提示并按既有规则回退，切功能保留文字', async ({ page }) => {
  await prepareEdit(page, '转真人回退');
  await panel(page).locator('#wbText').fill('keep the pose');
  await chooseFn(page, 'real');
  await panel(page).locator('#wbPromptSource').selectOption('manual');
  await panel(page).locator('#wbDual').selectOption('dual');
  await expect(panel(page).locator('#editPane-execute')).toContainText('由原图兼作参考');
  await expect(panel(page).locator('#wbText')).toHaveValue('keep the pose');
  await startEditResult(page);
  const easy = nodeOf(await graphOf(page), 'Easy_QwenEdit2509');
  expect(easy.inputs.image2).toEqual(easy.inputs.image1);
});

test('换装 LoRA 与要求进入换装工作流；无图、无字时可读报错', async ({ page }) => {
  await prepareEdit(page, '换装');
  await chooseFn(page, 'outfit');
  await panel(page).locator('#wbText').fill('a black leather jacket');
  await panel(page).locator('#wbLora').fill('krea2/krea_outfittransfer.safetensors');
  await startEditResult(page);
  const graph = await graphOf(page);
  expect(nodeOf(graph, 'LoraLoaderModelOnly').inputs.lora_name).toBe('krea2/krea_outfittransfer.safetensors');
  expect(nodeOf(graph, 'TextEncodeKrea2OstrisEdit').inputs.prompt).toBe('a black leather jacket');
  await prepareEdit(page, '缺原图', 0);
  await panel(page).locator('#editStart').click();
  await expect(panel(page).locator('#editDockError')).toContainText('图');
});
