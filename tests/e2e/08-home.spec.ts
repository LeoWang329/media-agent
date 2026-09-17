import { expect, test, type Page } from '@playwright/test';
import { setupWorkFolder, toasts } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const card = (page: Page, title: string) => page.locator('.cv').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test('首页：新建画布要起名字；卡片菜单里改名；删除移到回收站，提示条里能撤销', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建画布' }).click();
  const dialog = page.getByRole('dialog', { name: '新建画布' });
  await dialog.getByRole('button', { name: '新建' }).click();
  await expect(dialog.locator('#newHint')).toHaveText('先起个名字');
  await dialog.getByLabel('画布名字').fill('首页用例');
  await dialog.getByRole('button', { name: '新建' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page, '首页用例')).toHaveClass(/is-new/);
  await expect(card(page, '首页用例')).toContainText('还没有节点');
  await expect(toasts(page).filter({ hasText: '建好了「首页用例」' })).toBeVisible();

  await card(page, '首页用例').getByRole('button', { name: '画布操作' }).click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  await page.locator('.cv input').fill('首页用例改名');
  await page.locator('.cv input').press('Enter');
  await expect(card(page, '首页用例改名')).toHaveCount(1);

  await card(page, '首页用例改名').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除（移到回收站）' }).click();
  const confirm = page.getByRole('dialog', { name: '删除「首页用例改名」？' });
  await expect(confirm).toContainText('.trash');
  await confirm.getByRole('button', { name: '移到回收站' }).click();
  await expect(card(page, '首页用例改名')).toHaveCount(0);
  await toasts(page).filter({ hasText: '「首页用例改名」已移到回收站' }).getByRole('button', { name: '撤销' }).click();
  await expect(card(page, '首页用例改名')).toHaveCount(1);
});
