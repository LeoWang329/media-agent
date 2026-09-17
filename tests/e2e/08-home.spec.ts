import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { E2E_ROOT, MOCK_LLM_PORT } from './env';
import { drawerTitle, setupWorkFolder, toasts } from './helpers';

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 有的用例会换工作文件夹、改模型配置，跑完换回来
test.afterEach(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

const canvasCard = (page: Page, title: string) => page.locator('.hm-cv').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const recentCard = (page: Page, title: string) => page.locator('.hm-node').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
// Windows 的剪贴板里换行是 \r\n，比对前换回 \n
const copied = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

// 接口返回的节点，只写用到的字段
type Node = { id: string; messages: Record<string, { id: string; role: string; parsed?: { prompts: { text: string }[] } }> };

async function ok<T>(response: Promise<{ ok: () => boolean; json: () => Promise<T>; text: () => Promise<string>; url: () => string }>) {
  const res = await response;
  if (!res.ok()) throw new Error(`${res.url()}：${await res.text()}`);
  return res.json();
}

// 用接口建一个节点、起好名字、放图、发一条消息，返回节点
async function nodeWithReply(request: APIRequestContext, canvasId: string, title: string, text: string, images: string[] = []): Promise<Node> {
  const node = await ok<Node>(request.post(`/api/canvases/${canvasId}/nodes`, { data: { x: 100, y: 100 } }));
  const url = `/api/canvases/${canvasId}/nodes/${node.id}`;
  await ok(request.patch(url, { data: { title, slots: images } }));
  // 发送返回的是一段一段的事件，不是 JSON；请求结束时回复已经存好
  expect((await request.post(`${url}/send`, { data: { parentId: null, text } })).ok()).toBe(true);
  return ok<Node>(request.get(url));
}

test('首页：新建画布要起名字；卡片菜单里改名；删除移到回收站，提示条里能撤销', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建画布' }).click();
  const dialog = page.getByRole('dialog', { name: '新建画布' });
  await dialog.getByRole('button', { name: '新建' }).click();
  await expect(dialog.locator('#newHint')).toHaveText('先起个名字');
  await dialog.getByLabel('画布名字').fill('首页用例');
  await expect(dialog.locator('#newCount')).toHaveText('4/30');
  await dialog.getByRole('button', { name: '新建' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(canvasCard(page, '首页用例')).toHaveClass(/is-new/);
  await expect(canvasCard(page, '首页用例')).toContainText('还没有节点');
  await expect(toasts(page).filter({ hasText: '建好了「首页用例」' })).toBeVisible();

  await canvasCard(page, '首页用例').getByRole('button', { name: '画布操作' }).click();
  await page.getByRole('menuitem', { name: '改名' }).click();
  await page.locator('.hm-cv-rename').fill('首页用例改名');
  await page.locator('.hm-cv-rename').press('Enter');
  await expect(canvasCard(page, '首页用例改名')).toHaveCount(1);
  await expect(toasts(page).filter({ hasText: '已改名为「首页用例改名」' })).toBeVisible();

  await canvasCard(page, '首页用例改名').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除（移到回收站）' }).click();
  const confirm = page.getByRole('dialog', { name: '删除「首页用例改名」？' });
  await expect(confirm).toContainText('.trash');
  await confirm.getByRole('button', { name: '移到回收站' }).click();
  await expect(canvasCard(page, '首页用例改名')).toHaveCount(0);
  await toasts(page).filter({ hasText: '「首页用例改名」已移到回收站' }).getByRole('button', { name: '撤销' }).click();
  await expect(canvasCard(page, '首页用例改名')).toHaveCount(1);
  await expect(toasts(page).filter({ hasText: '已撤销，「首页用例改名」回来了' })).toBeVisible();
});

test('首页：最近动过的节点和打过星的提示词，复制原文和译文、看上传清单，点一下进到节点的对话', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const request = page.request;
  await ok(request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } }));
  const canvas = await ok<{ id: string }>(request.post('/api/canvases', { data: { title: '首页星标' } }));
  const images = [];
  for (const name of [FIXTURES.first, FIXTURES.second]) {
    images.push((await ok<{ id: string }>(request.post(`/api/canvases/${canvas.id}/images`, { data: { path: path.join(FIXTURES_DIR, name) } }))).id);
  }
  await nodeWithReply(request, canvas.id, 'B 节点', '写一个');
  const node = await nodeWithReply(request, canvas.id, '首页的节点', '三个方向', images);
  const reply = Object.values(node.messages).find((m) => m.role === 'assistant')!;
  const messageUrl = `/api/canvases/${canvas.id}/nodes/${node.id}/messages/${reply.id}`;
  await ok(request.post(`${messageUrl}/star`, { data: { promptIndex: 1, on: true } }));
  await ok(request.post(`${messageUrl}/translate`, { data: { promptIndex: 1, language: '英文' } }));
  const promptText = reply.parsed!.prompts[1].text;

  await page.goto('/');
  const recent = recentCard(page, '首页的节点');
  await expect(page.locator('.hm-node[data-node]').first()).toHaveAttribute('data-node', node.id);
  await expect(recent.locator('.hm-star')).toBeVisible();
  await expect(recent.locator('.hm-mosaic img')).toHaveCount(2);
  await expect(recent.locator('.hm-node-meta')).toContainText('首页星标');
  await expect(recent.locator('.hm-node-meta')).toContainText('3 个方向');
  await expect(recent.locator('.hm-node-meta')).toContainText('8秒 · 16:9');
  await expect(recentCard(page, 'B 节点').locator('.hm-mosaic')).toHaveText('没有参考图');
  await expect(recentCard(page, 'B 节点').locator('.hm-star')).toHaveCount(0);
  await expect(canvasCard(page, '首页星标')).toContainText('2 个节点');
  await expect(canvasCard(page, '首页星标')).toContainText('1 个打过星');

  const starred = page.locator('.hm-star-item').filter({ hasText: '首页星标' });
  await expect(starred).toHaveCount(1);
  await expect(starred.locator('.hm-star-label')).toHaveText('方向二：测试方向二');
  await expect(starred.locator('.hm-strip img')).toHaveCount(2);
  await starred.getByRole('button', { name: '复制', exact: true }).click();
  await expect(toasts(page).filter({ hasText: `已复制提示词（${promptText.length.toLocaleString('en-US')} 字）` })).toBeVisible();
  expect(await copied(page)).toBe(promptText);
  await starred.getByRole('button', { name: '英文', exact: true }).click();
  await expect(toasts(page).filter({ hasText: '已复制英文译文' })).toBeVisible();
  expect(await copied(page)).toBe(`译文（英文）\n${promptText}`);

  await starred.getByRole('button', { name: '上传清单' }).click();
  const checklist = page.getByRole('dialog', { name: '上传清单' });
  await expect(checklist.locator('#upSub')).toHaveText('首页星标 › 首页的节点 · 方向二：测试方向二 · 共 2 张，按编号顺序上传');
  await expect(checklist.getByTestId('checklist-row')).toHaveCount(2);
  await expect(checklist.getByTestId('checklist-row').nth(1)).toContainText(`${FIXTURES_DIR}\\${FIXTURES.second}`);
  await checklist.getByRole('button', { name: '好了' }).click();
  await expect(checklist).toHaveCount(0);

  // 点打星那条下面的「画布 › 节点」，进画布直接打开这个节点，地址里的 #node= 用完去掉
  await starred.locator('.hm-star-where').click();
  await expect(drawerTitle(page)).toHaveText('首页的节点');
  await expect(page).toHaveURL(new RegExp(`/canvas/${canvas.id}$`));

  await page.goto('/');
  await recentCard(page, 'B 节点').click();
  await expect(drawerTitle(page)).toHaveText('B 节点');
});

test('首页：按名字找画布，找不到时能清空搜索', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: '按名字找画布' });
  // 读取中的占位卡片没有 data-id
  const cards = page.locator('.hm-cv[data-id]');
  await expect(search).toBeEnabled();
  const all = await cards.count();
  await expect(page.locator('#canvasMeta')).toHaveText(`${all} 个 · 最近动过的在前`);
  await search.fill('首页星');
  await expect(cards).toHaveCount(1);
  await expect(page.locator('#canvasMeta')).toHaveText(`找到 1 个，共 ${all} 个`);
  await search.fill('没有这个名字');
  await expect(cards).toHaveCount(0);
  await expect(page.locator('#canvases')).toContainText('没有名字里带「没有这个名字」的画布');
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(cards).toHaveCount(all);
});

test('首页：这台机器上没填密钥的模型配置在顶上提示，点一下去设置里填', async ({ page }) => {
  const shared = { baseUrl: `http://127.0.0.1:${MOCK_LLM_PORT}/v1`, imageLongSide: 1600, pricing: { currency: '¥', input: 3, output: 15, cached: 0.3 } };
  const modelConfigs = [
    { id: 'mock', name: 'mock', model: 'mock-model', apiKey: 'test', ...shared },
    { id: 'backup', name: '备用', model: 'deepseek-chat', apiKey: '', ...shared },
  ];
  await ok(page.request.put('/api/config', { data: { modelConfigs } }));
  await page.goto('/');
  const issue = page.locator('.hm-issue');
  await expect(issue).toHaveCount(1);
  await expect(issue).toContainText('这台机器上还没填「备用」的密钥');
  await expect(issue).toContainText('deepseek-chat');
  await issue.getByRole('link', { name: '去设置里填' }).click();
  await expect(page).toHaveURL(/\/settings#models$/);
});

test('首页：工作文件夹打不开时整页提示，新建画布点不了；重试还不行说原因，连上后重试就好了', async ({ page }) => {
  const broken = path.join(E2E_ROOT, 'broken-work');
  await ok(page.request.put('/api/config', { data: { workFolder: broken } }));
  fs.rmSync(broken, { recursive: true, force: true });

  await page.goto('/');
  const state = page.getByRole('alert');
  await expect(state).toContainText('打不开工作文件夹');
  await expect(state).toContainText(broken);
  await expect(state.getByRole('link', { name: '去设置里换' })).toHaveAttribute('href', '/settings#workdir');
  await expect(page.locator('.path-pill')).toHaveClass(/is-error/);
  await expect(page.getByRole('button', { name: '新建画布' })).toBeDisabled();

  await state.getByRole('button', { name: '重试' }).click();
  await expect(toasts(page).filter({ hasText: '还是打不开：找不到这个路径' })).toBeVisible();
  await expect(state).toContainText('打不开工作文件夹');

  fs.mkdirSync(path.join(broken, 'canvases'), { recursive: true });
  await state.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { name: '还没有画布' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建画布' })).toBeEnabled();
  await expect(page.locator('.path-pill')).not.toHaveClass(/is-error/);
});
