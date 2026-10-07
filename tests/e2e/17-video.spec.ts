import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MOCK_AUTODL_TOKEN, MOCK_AUTODL_UUID, MOCK_AUTODL_VIDEO_UUID } from '../../tools/mock-comfyui/src/autodl';
import { E2E_WORK_FOLDER, MOCK_COMFY_PORT } from './env';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { filledSlots, lastReply, newCanvasWithNode, panel, send, setupWorkFolder, toasts } from './helpers';

// 第四批：生成视频，见 docs/dev-plan.md 10.4 第 1 到 4 条

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

const box = (page: Page) => lastReply(page).getByTestId('prompt-box');
const videos = (page: Page) => box(page).locator('.vj-job');
const comfyPrompts = async (page: Page) => (await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[];
const lastGraph = async (page: Page) => (await comfyPrompts(page)).at(-1)!.prompt;
const graphNodes = (graph: Graph, type: string) => Object.values(graph).filter((n) => n.class_type === type);

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

// 用接口填好 Token、出图那台和生成视频那台
async function useVideoAutodl(page: Page) {
  expect((await page.request.put('/api/config', { data: { autodlToken: MOCK_AUTODL_TOKEN } })).ok()).toBe(true);
  const comfy = { autodl: { instanceUuid: MOCK_AUTODL_UUID }, videoAutodl: { instanceUuid: MOCK_AUTODL_VIDEO_UUID } };
  expect((await page.request.put('/api/settings', { data: { comfy } })).ok()).toBe(true);
}

// 视频节点换成 t2v、时长填 60，发「写一个」
async function longVideoNode(page: Page, title: string) {
  await newCanvasWithNode(page, title);
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await panel(page).locator('#durVal').click();
  await page.locator('#durInput').fill('60');
  await page.locator('#durInput').press('Enter');
  await expect(panel(page).locator('#durVal')).toHaveText('60 秒');
  await expect(panel(page).locator('#durSegs')).toHaveText('分 4 段');
  await send(page, '写一个');
}

// 记下框下面视频状态的每一次变化：mock 跑得快，一步只有几十毫秒
async function recordStates(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { videoStates: string[] }).videoStates = seen;
    new MutationObserver(() => {
      const text = document.querySelector('.vj-job .ig-state')?.textContent ?? '';
      if (text && seen.at(-1) !== text) seen.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { videoStates: string[] }).videoStates);
}

// 手动改框，存成新版本
async function editBox(page: Page, text: string) {
  await box(page).locator('[data-act="editBox"]').click();
  await panel(page).getByRole('textbox', { name: '手动改提示词' }).fill(text);
  await panel(page).getByRole('button', { name: '存成新版本' }).click();
  await expect(box(page)).toContainText(text);
}

test('10.4 第 1 条：设置里选生成视频用的实例，出图那台不能选；选好后顶上多出视频那台的状态，写着已关机', async ({ page }) => {
  expect((await page.request.put('/api/config', { data: { autodlToken: MOCK_AUTODL_TOKEN } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings', { data: { comfy: { autodl: { instanceUuid: MOCK_AUTODL_UUID } } } })).ok()).toBe(true);
  await page.goto('/settings#comfy');
  await expect(page.locator('#videoPill')).toHaveCount(0);
  const taken = page.locator('#vdInst option').filter({ hasText: 'ComfyUI-测试' });
  await expect(taken).toHaveText(/（出图在用）$/);
  await expect(taken).toBeDisabled();
  await page.locator('#vdInst').selectOption(MOCK_AUTODL_VIDEO_UUID);
  await expect(page.locator('#vdState')).toContainText('已关机');
  await expect(page.locator('#videoPill')).toContainText('视频那台已关机');
  await expect(page.locator('#adInst option').filter({ hasText: 'H3-测试' })).toHaveText(/（生成视频在用）$/);
});

test('10.4 第 2 条：t2v、60 秒 → 说明里分 4 段 → 框里 4 段 → 生成视频：先开机，再走编码、一采、放大、二采、存文件 → 出完能播放，1728×960、57.6 秒', async ({ page }) => {
  await useVideoAutodl(page);
  await longVideoNode(page, '长视频');
  await expect(lastReply(page)).toContainText('视频时长 60 秒，分 4 段生成，每段约 15 秒');
  await expect(box(page)).toContainText('第 4 段');
  await expect(box(page).locator('.ig-empty')).toContainText('分 4 段，约 57.6 秒，出片 1728×960');

  const states = await recordStates(page);
  await box(page).locator('[data-act="genVideo"]').click();
  await expect(toasts(page).filter({ hasText: '生成视频用的 AutoDL 实例关着，先开机' })).toBeVisible();
  const player = videos(page).locator('video');
  await expect(player).toHaveCount(1, { timeout: 30_000 });
  const seen = (await states()).join('\n');
  for (const text of ['生成视频那台正在开机', '编码提示词', '一采 第 1/4 段', '一采 第 4/4 段', '放大', '二采 第 1/4 段', '存文件']) expect(seen).toContain(text);
  await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(videos(page).locator('.vj-info')).toContainText('1728×960');
  await expect(videos(page).locator('.vj-info')).toContainText('57.6 秒');
  await expect(page.locator('#videoPill')).toContainText('视频那台运行中');

  const files = await fs.readdir(path.join(E2E_WORK_FOLDER, 'video-temp', today()));
  expect(files.some((name) => name.endsWith('.mp4'))).toBe(true);
  const graph = await lastGraph(page);
  const [prompts] = graphNodes(graph, 'MMH3ReferenceMultiPrompt');
  expect(String(prompts.inputs.prompts).split('\n|\n')).toHaveLength(4);
  expect(prompts.inputs).toMatchObject({ width: 864, height: 480, length: 1382 });
  expect(graphNodes(graph, 'MMH3LoopingSampler').map((node) => [node.inputs.chunk_frames, node.inputs.overlap_frames])).toEqual([
    [362, 22],
    [362, 22],
  ]);
});

test('10.4 第 3 条：一采 0.3、固定种子 → 出片 1472×832 → 只换种子再来换了种子；删掉一条临时文件也没了；含「慢」的一采时叫停；含「报错」的写原因', async ({ page }) => {
  await useVideoAutodl(page);
  await longVideoNode(page, '设置和叫停');

  await panel(page).locator('#btnVideoCfg').click();
  const settings = page.locator('[data-od-id="popover-video-settings"]');
  await settings.locator('#vcMp').selectOption('0.3');
  await settings.getByRole('button', { name: '固定一个数' }).click();
  await settings.locator('#vcSeed').fill('4242');
  await settings.locator('#vcSeed').press('Enter');
  await expect(settings.locator('#vcFinal')).toHaveText('1472×832');
  await page.keyboard.press('Escape');
  await expect(panel(page).locator('#btnVideoCfg')).toContainText('出片 1472×832');

  await box(page).locator('[data-act="genVideo"]').click();
  await expect(videos(page).first().locator('video')).toHaveCount(1, { timeout: 30_000 });
  let graph = await lastGraph(page);
  expect(graphNodes(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ width: 736, height: 416 });
  expect(graphNodes(graph, 'RandomNoise')[0].inputs.noise_seed).toBe(4242);
  await expect(videos(page).first().locator('.vj-info')).toContainText('种子 4242');

  await videos(page).first().locator('[data-vact="reseed"]').click();
  await expect(videos(page)).toHaveCount(2);
  await expect(videos(page).nth(1).locator('video')).toHaveCount(1, { timeout: 30_000 });
  graph = await lastGraph(page);
  expect(graphNodes(graph, 'RandomNoise')[0].inputs.noise_seed).not.toBe(4242);
  await expect(videos(page).nth(1).locator('.ig-kind')).toContainText('只换种子再来');

  // 删掉第一条：临时文件直接删
  const folder = path.join(E2E_WORK_FOLDER, 'video-temp', today());
  const before = (await fs.readdir(folder)).filter((name) => name.endsWith('-4242.mp4'));
  expect(before.length).toBeGreaterThan(0);
  await videos(page).first().locator('[data-vact="delete"]').click();
  await expect(videos(page)).toHaveCount(1);
  expect((await fs.readdir(folder)).filter((name) => before.includes(name)).length).toBe(before.length - 1);

  await editBox(page, '慢慢地走');
  await box(page).locator('[data-act="genVideo"]').click();
  await expect(videos(page).locator('.ig-state')).toContainText('一采', { timeout: 15_000 });
  await videos(page).locator('[data-vact="stop"]').click();
  await expect(videos(page).locator('.ig-state')).toContainText('已叫停', { timeout: 15_000 });

  await editBox(page, '报错');
  await box(page).locator('[data-act="genVideo"]').click();
  await expect(videos(page).locator('.vj-error')).toContainText('生成视频出错（MMH3LoopingSampler）', { timeout: 15_000 });
});

test('10.4 第 4 条：下载一条，文件名是「节点标题-种子.mp4」，标已下载；槽位放了图的回复点生成视频，提示带图的还没做', async ({ page }) => {
  await useVideoAutodl(page);
  const folder = path.join(E2E_WORK_FOLDER, '挑出来的视频');
  await fs.mkdir(folder, { recursive: true });
  // 选文件夹的窗口是系统弹的，测试里直接给结果
  await page.route('**/api/assets/pick-folder', (route) => route.fulfill({ json: { path: folder } }));
  await newCanvasWithNode(page, '下载视频');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await send(page, '写一个');
  await box(page).locator('[data-act="genVideo"]').click();
  await expect(videos(page).locator('video')).toHaveCount(1, { timeout: 30_000 });
  const seed = (await videos(page).locator('.vj-info').textContent())!.match(/种子 (\d+)/)![1];

  await videos(page).locator('[data-vact="download"]').click();
  const dialog = page.getByRole('dialog', { name: '下载视频' });
  await expect(dialog.locator('.dl-names')).toHaveText(`测试标题-${seed}.mp4`);
  await dialog.locator('[data-dl="pick"]').click();
  await expect(dialog.locator('.dl-folder')).toContainText(folder);
  await dialog.locator('[data-dl="ok"]').click();
  await expect(toasts(page).filter({ hasText: `下载到了 ${path.join(folder, `测试标题-${seed}.mp4`)}` })).toBeVisible();
  expect((await fs.stat(path.join(folder, `测试标题-${seed}.mp4`))).isFile()).toBe(true);
  await expect(videos(page).locator('.ig-dl')).toHaveText('已下载');

  // 槽位放一张图再写一条：P19 还不接参考图
  await panel(page).locator('#localFile').setInputFiles(path.join(FIXTURES_DIR, FIXTURES.first));
  await expect(filledSlots(page)).toHaveCount(1);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
  await send(page, '再写一个');
  await box(page).locator('[data-act="genVideo"]').click();
  await expect(toasts(page).filter({ hasText: '带图的生成视频还没做' })).toBeVisible();
});
