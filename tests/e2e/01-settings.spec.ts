import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_WORK_FOLDER, MOCK_LLM_PORT } from './env';

test('第一次打开跳到设置页；设好工作文件夹出现默认提示词；对 mock-llm 测试连接成功', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText('请先选择工作文件夹')).toBeVisible();

  const workFolder = page.locator('section').filter({ has: page.getByRole('heading', { name: '工作文件夹' }) });
  await workFolder.getByLabel('工作文件夹路径').fill(E2E_WORK_FOLDER);
  await workFolder.getByRole('button', { name: '保存' }).click();
  await expect(workFolder.getByText('已保存')).toBeVisible();
  for (const name of ['ref2va', 'i2v', 't2v']) expect(fs.existsSync(path.join(E2E_WORK_FOLDER, 'prompts', `${name}.md`))).toBe(true);

  const models = page.locator('section').filter({ has: page.getByRole('heading', { name: '模型配置' }) });
  await models.getByRole('button', { name: '新增模型配置' }).click();
  await models.getByLabel('名字').fill('mock');
  await models.getByLabel('接口地址').fill(`http://127.0.0.1:${MOCK_LLM_PORT}/v1`);
  await models.getByLabel('API 密钥').fill('test-key');
  await models.getByLabel('模型名').fill('mock-model');
  await models.getByRole('button', { name: '测试连接' }).click();
  await expect(models.getByText('连接成功')).toBeVisible();

  await page.getByRole('link', { name: '返回首页' }).click();
  await expect(page.getByText(`工作文件夹：${E2E_WORK_FOLDER}`)).toBeVisible();
});
