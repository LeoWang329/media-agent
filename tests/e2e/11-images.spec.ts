import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { E2E_WORK_FOLDER, MOCK_COMFY_PORT } from './env';
import { assetsDialog, assetTile, cards, cardTitled, drawerTitle, filledSlots, lastReply, newCanvasWithNode, panel, send, setupWorkFolder, toasts } from './helpers';

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
type Job = { id: string; images: { seed: number; file?: string; savedPath?: string }[] };
type Node = { messages: Record<string, { images?: Job[] }> };

const box = (page: Page) => lastReply(page).getByTestId('prompt-box');
const cells = (page: Page) => box(page).locator('.ig-cell');
const viewer = (page: Page) => page.getByRole('dialog', { name: '看大图和参数' });
const editor = (page: Page) => page.getByRole('dialog', { name: '编辑标签' });

// mock-comfyui 收到的每个出图请求
const comfyPrompts = async (page: Page) => (await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[];
const graphNode = (graph: Graph, type: string) => Object.values(graph).find((n) => n.class_type === type)!;

// 工作文件夹 image-temp 下当天的子文件夹名，和服务端一样按本地时间
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 第 5 条之后的用例直接用接口填好局域网 ComfyUI 的地址
async function useMockComfy(page: Page) {
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL } } })).ok()).toBe(true);
}

async function useIl(page: Page) {
  await panel(page).locator('#cfgSys').selectOption('il');
  await expect(toasts(page).filter({ hasText: '这个节点变成生图节点' })).toBeVisible();
}

// 张数从默认的 4 张往下调，每次等服务端存好
async function setCount(page: Page, count: number) {
  for (let n = 3; n >= count; n -= 1) {
    await panel(page).locator('#cntDown').click();
    await expect(panel(page).locator('#imgCount')).toHaveText(`${n} 张`);
  }
}

// 在标签编辑窗最后加一个标签（打逗号变成小块），存成新版本
async function addTag(page: Page, text: string) {
  await box(page).locator('[data-act="editTags"]').click();
  await page.locator('#teInput').press('Control+End');
  await page.keyboard.type(`${text},`);
  await expect(editor(page).locator('.te-chip .tg-name').last()).toHaveText(text);
  await editor(page).locator('[data-te="save"]').click();
  await expect(editor(page)).toHaveCount(0);
}

// 当前画布、面板里的节点、最后一条回复
async function placeOf(page: Page) {
  const canvasId = new URL(page.url()).pathname.split('/').at(-1)!;
  const nodeId = (await cardTitled(page, (await drawerTitle(page).textContent())!).getAttribute('data-id'))!;
  const messageId = (await lastReply(page).getAttribute('data-message-id'))!;
  return { canvasId, nodeId, messageId };
}

async function jobsOf(page: Page, place: { canvasId: string; nodeId: string; messageId: string }) {
  const node = (await (await page.request.get(`/api/canvases/${place.canvasId}/nodes/${place.nodeId}`)).json()) as Node;
  return node.messages[place.messageId].images ?? [];
}

test('10.3 第 5 条：填 mock-comfyui 的地址测试连接 → pony-test 自动标成 Pony → 张数 2 点生图，先排队、再出进度、最后出图 → 临时文件夹里有两张 → 大图参数带固定开头，种子差 1，clip skip 发的是 -2', async ({ page }) => {
  await page.goto('/settings#comfy');
  await page.locator('#cfUrl').fill(COMFY_URL);
  await page.locator('#cfTest').click();
  const result = page.locator('#cfResult');
  await expect(result).toContainText('连得上');
  await expect(result).toContainText('ComfyUI 0.3.60 · RTX 4090 · 显存 24 GB');

  await page.locator('[data-tab="checkpoints"]').click();
  const pony = page.locator('[data-ck="pony-test.safetensors"]');
  await expect(pony.getByRole('button', { name: 'Pony' })).toHaveAttribute('aria-pressed', 'true');
  await expect(pony).toContainText('按文件名猜的');
  await expect(page.locator('[data-ck="il-test.safetensors"]').getByRole('button', { name: 'IL' })).toHaveAttribute('aria-pressed', 'true');

  await newCanvasWithNode(page, '出图');
  await useIl(page);
  await setCount(page, 2);
  await send(page, '写一个');
  const sentBefore = (await comfyPrompts(page)).length;
  await box(page).locator('[data-act="gen"]').click();
  await expect(cells(page)).toHaveCount(2);
  await expect(cells(page).nth(1)).toHaveClass(/is-queued/);
  await expect(cells(page).nth(1)).toContainText(/排第 \d|排队中/);
  await expect(box(page).locator('.ig-cell.is-running')).toContainText(/\d+\/\d+ 步/);
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(2, { timeout: 15_000 });
  await expect(box(page).locator('.ig-state')).toHaveText('出完 2/2');

  const place = await placeOf(page);
  const [job] = await jobsOf(page, place);
  for (const image of job.images) {
    expect(image.file).toMatch(new RegExp(`^image-temp/${today()}/`));
    expect((await fs.stat(path.join(E2E_WORK_FOLDER, image.file!))).isFile()).toBe(true);
  }
  const seeds = (await box(page).locator('.ig-seed').allTextContents()).map(Number);
  expect(seeds[1] - seeds[0]).toBe(1);

  await cells(page).first().click();
  await expect(viewer(page).locator('.ib-title')).toHaveText(`种子 ${seeds[0]}`);
  await expect(viewer(page).locator('.ib-prompt p').first()).toHaveText(/^masterpiece, best quality, 1girl, /);
  await expect(viewer(page).locator('.ib-fixed').first()).toHaveText('masterpiece, best quality, ');
  await expect(viewer(page)).toContainText('il-test');
  await expect(viewer(page)).toContainText('内置基础流程');
  await page.keyboard.press('Escape');
  await expect(viewer(page)).toHaveCount(0);

  const sent = (await comfyPrompts(page)).slice(sentBefore);
  expect(sent).toHaveLength(2);
  for (const [i, body] of sent.entries()) {
    expect(graphNode(body.prompt, 'CLIPSetLastLayer').inputs.stop_at_clip_layer).toBe(-2);
    expect(graphNode(body.prompt, 'KSampler').inputs.seed).toBe(seeds[i]);
    expect(graphNode(body.prompt, 'CheckpointLoaderSimple').inputs.ckpt_name).toBe('il-test.safetensors');
  }

  // 画布卡片上显示出的图
  await expect(cardTitled(page, '测试图片').locator('.gn-slots.is-gen img')).toHaveCount(2);
});

test('10.3 第 6 条：张数 3、框里含「慢」→ 第一张在跑时叫停，跑着的和排队的都标已叫停；含「报错」的显示失败原因；底模文件不在时说清楚', async ({ page }) => {
  await useMockComfy(page);
  await newCanvasWithNode(page, '叫停');
  await useIl(page);
  await setCount(page, 3);
  await send(page, '写一个');
  await addTag(page, '慢');
  await box(page).locator('[data-act="gen"]').click();
  await expect(cells(page)).toHaveCount(3);
  await expect(cells(page).first()).toHaveClass(/is-running/);
  await box(page).locator('[data-jact="stop"]').click();
  await expect(box(page).locator('.ig-cell.is-stopped')).toHaveCount(3);
  await expect(box(page).locator('.ig-cell.is-stopped').first()).toContainText('已叫停');
  await expect(box(page).locator('.ig-state')).toHaveText('出完 0/3 · 3 张叫停了');
  await expect(box(page).locator('[data-jact="stop"]')).toHaveCount(0);

  // 再写一版，框里含「报错」：每张跑到一半出错，格子上写失败，下面写原因
  await send(page, '写一个');
  await addTag(page, '报错');
  await box(page).locator('[data-act="gen"]').click();
  await expect(box(page).locator('.ig-cell.is-failed')).toHaveCount(3);
  await expect(box(page).locator('.ig-cell.is-failed').first()).toContainText('失败');
  await expect(box(page).locator('.ig-state')).toHaveText('3 张都失败了');
  await expect(box(page).locator('.ig-err')).toContainText('按约定出错');

  // 节点的底模换成这台 ComfyUI 上没有的文件
  const place = await placeOf(page);
  const patched = await page.request.patch(`/api/canvases/${place.canvasId}/nodes/${place.nodeId}`, { data: { image: { checkpoint: 'gone-test.safetensors' } } });
  expect(patched.ok()).toBe(true);
  await box(page).locator('[data-act="gen"]').click();
  await expect(toasts(page).filter({ hasText: '这台 ComfyUI 上找不到底模文件，这组没出成' })).toBeVisible();
  const latest = box(page).locator('.ig-job').last();
  await expect(latest.locator('.ig-cell.is-failed')).toHaveCount(3);
  await expect(latest.locator('.ig-cell').first()).toContainText('底模文件不在');
  await expect(latest.locator('.ig-err b')).toHaveText('底模文件不在');
  await expect(latest.locator('.ig-err')).toContainText('找不到 gone-test.safetensors');
  await expect(latest.locator('[data-jact="settings"]')).toHaveText('换底模');
});

test('10.3 第 7 条：下载一张到不在资产库里的新文件夹，顺便导入 → 视频节点从资产库放进槽位；清掉临时文件后下载过的显示下载的那份，没下载过的显示已清理，同样参数再来照样能出', async ({ page }) => {
  await useMockComfy(page);
  const folder = path.join(E2E_WORK_FOLDER, '挑出来的图');
  await fs.mkdir(folder, { recursive: true });
  // 选文件夹的窗口是系统弹的，测试里直接给结果
  await page.route('**/api/assets/pick-folder', (route) => route.fulfill({ json: { path: folder } }));

  await newCanvasWithNode(page, '下载');
  await useIl(page);
  await setCount(page, 2);
  await send(page, '写一个');
  await box(page).locator('[data-act="gen"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(2, { timeout: 15_000 });
  const place = await placeOf(page);
  const seeds = (await box(page).locator('.ig-seed').allTextContents()).map(Number);
  const name = `测试图片-${seeds[0]}.png`;

  await cells(page).first().click();
  await viewer(page).getByRole('button', { name: '下载', exact: true }).click();
  const download = page.getByRole('dialog', { name: '下载', exact: true });
  await expect(download.locator('.dl-names')).toHaveText(name);
  await download.locator('[data-dl="pick"]').click();
  await expect(download.locator('.dl-folder')).toContainText(folder);
  await expect(download.locator('.dl-folder')).toContainText('不在资产库里');
  await expect(download.locator('#dlImport')).toBeChecked();
  await download.locator('[data-dl="ok"]').click();
  await expect(toasts(page).filter({ hasText: `下载了 1 张到 ${folder}，这个文件夹也导入资产库了` })).toBeVisible();
  expect((await fs.stat(path.join(folder, name))).isFile()).toBe(true);
  await expect(viewer(page).getByRole('button', { name: '再下载一份' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer(page)).toHaveCount(0);
  await expect(cells(page).first().locator('.ig-dl')).toHaveText('已下载');

  // 新建一个视频节点，从资产库里把下载的那张放进槽位
  await page.getByRole('button', { name: '新建节点' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(drawerTitle(page)).toHaveText('新节点');
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).getByTitle(folder, { exact: true }).click();
  await assetTile(page, name).click();
  await assetsDialog(page).getByRole('button', { name: '放进槽位（1）' }).click();
  await expect(assetsDialog(page)).toHaveCount(0);
  await expect(filledSlots(page)).toHaveCount(1);

  // 两张的临时文件都清掉
  const [job] = await jobsOf(page, place);
  for (const image of job.images) await fs.rm(path.join(E2E_WORK_FOLDER, image.file!));
  await page.reload();
  await cardTitled(page, '测试图片').click();
  await expect(drawerTitle(page)).toHaveText('测试图片');
  await expect(cells(page).first().locator('img')).toBeVisible();
  await expect(cells(page).first()).not.toHaveClass(/is-cleared/);
  await expect(cells(page).nth(1)).toHaveClass(/is-cleared/);
  await expect(cells(page).nth(1)).toContainText('已清理');

  await cells(page).first().click();
  await expect(viewer(page).locator('.tag-warn')).toHaveText('临时文件已清理，显示的是下载的那份');
  await expect(viewer(page).locator('.ib-stage img')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(viewer(page).locator('.ib-ph')).toContainText('临时文件被清掉了');
  await viewer(page).getByRole('button', { name: '同样参数再来' }).click();
  await expect(viewer(page)).toHaveCount(0);
  const again = box(page).locator('.ig-job').last();
  await expect(box(page).locator('.ig-job')).toHaveCount(2);
  await expect(again.locator('.ig-kind')).toHaveText(`同样参数再来 · 种子 ${seeds[1]}`);
  await expect(again.locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });
  await expect(again.locator('.ig-seed')).toHaveText(String(seeds[1]));
});

test('10.3 第 8 条：给生图框打星 → 首页打过星的提示词里有它出的图 → 点「再出图」→ 回到画布，框下面多一组', async ({ page }) => {
  await useMockComfy(page);
  await newCanvasWithNode(page, '再出图');
  await useIl(page);
  await setCount(page, 1);
  await send(page, '写一个');
  await box(page).locator('[data-act="gen"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });
  await box(page).locator('[data-act="star"]').click();
  await expect(toasts(page).filter({ hasText: '打了星' })).toBeVisible();
  const { nodeId, messageId } = await placeOf(page);

  await page.goto('/');
  await expect(page.locator(`.hm-node[data-node="${nodeId}"] .hm-mosaic.is-gen img`)).toHaveCount(1);
  const starred = page.locator(`[data-star="${messageId}-0"]`);
  await expect(starred.locator('.hm-gen img')).toHaveCount(1);
  await expect(starred.locator('.hm-gen-meta')).toContainText('1 张');
  await starred.locator('[data-regen]').click();
  await toasts(page).filter({ hasText: '这个框又排上了 1 张，按节点现在的出图设置' }).getByRole('button', { name: '去看看' }).click();
  await expect(page.locator('#canvasTitle')).toHaveText('再出图');
  await expect(drawerTitle(page)).toHaveText('测试图片');
  await expect(box(page).locator('.ig-job')).toHaveCount(2);
  await expect(box(page).locator('.ig-job').last().locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });
});
