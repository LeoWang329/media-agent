import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MOCK_AUTODL_TOKEN, MOCK_AUTODL_UUID, MOCK_AUTODL_VIDEO_UUID } from '../../tools/mock-comfyui/src/autodl';
import { E2E_ROOT, E2E_WORK_FOLDER, MOCK_COMFY_PORT } from './env';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { assetsDialog, assetTile, filledSlots, lastReply, newCanvasWithNode, panel, send, setupWorkFolder, toasts } from './helpers';

// 第四批：生成视频，见 docs/dev-plan.md 10.4 第 1 到 11 条

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

// 这一条成片出来了：`.vj-info`（出片宽高、多长、种子那行）只有出完或叫停留下低清版才有。
// 一采出完会先冒出一版低清预览，那也是一个 video，所以不能只看有没有 video，见 docs/dev-plan.md 5.27
const finished = (page: Page) => videos(page).locator('.vj-info');

// 手动改框，存成新版本。分段的框显示时那个 | 单独一行会并进去，按段查
async function editBox(page: Page, text: string) {
  await box(page).locator('[data-act="editBox"]').click();
  await panel(page).getByRole('textbox', { name: '手动改提示词' }).fill(text);
  await panel(page).getByRole('button', { name: '存成新版本' }).click();
  for (const part of text.split('\n|\n')) await expect(box(page)).toContainText(part);
}

// 时长 60 秒要 4 段，一段最长 15 秒：手动改的框也得按段写，不然会被拦下来，见 docs/dev-plan.md 5.24
const fourWay = (first: string) => [first, '第二段', '第三段', '第四段'].join('\n|\n');

// 生成设置弹窗，见 docs/dev-plan.md 5.36
const genDialog = (page: Page) => page.locator('[data-od-id="dialog-gen-video"]');

// 点「生成视频」：先弹出配置窗（里面就是生成设置，顶上是「开始生成」），点它才真的发出去
async function genVideo(page: Page) {
  await box(page).locator('[data-act="genVideo"]').click();
  await expect(genDialog(page)).toBeVisible();
  await genDialog(page).locator('#vgGo').click();
  await expect(genDialog(page)).toHaveCount(0);
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
  await genVideo(page);
  await expect(toasts(page).filter({ hasText: '生成视频用的 AutoDL 实例关着，先开机' })).toBeVisible();
  const player = videos(page).locator('video');
  // 一采出完会先冒出一版低清预览，所以不能只看有没有 video：.vj-info 是成片才有的，见 docs/dev-plan.md 5.27
  await expect(videos(page).locator('.vj-info')).toHaveCount(1, { timeout: 60_000 });
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

  await genVideo(page);
  await expect(videos(page).first().locator('.vj-info')).toHaveCount(1, { timeout: 30_000 });
  let graph = await lastGraph(page);
  expect(graphNodes(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ width: 736, height: 416 });
  expect(graphNodes(graph, 'RandomNoise')[0].inputs.noise_seed).toBe(4242);
  await expect(videos(page).first().locator('.vj-info')).toContainText('种子 4242');

  await videos(page).first().locator('[data-vact="reseed"]').click();
  await expect(videos(page)).toHaveCount(2);
  await expect(videos(page).nth(1).locator('.vj-info')).toHaveCount(1, { timeout: 30_000 });
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

  await editBox(page, fourWay('慢慢地走'));
  await genVideo(page);
  await expect(videos(page).locator('.ig-state')).toContainText('一采', { timeout: 15_000 });
  await videos(page).locator('[data-vact="stop"]').click();
  await expect(videos(page).locator('.ig-state')).toContainText('已叫停', { timeout: 15_000 });

  await editBox(page, fourWay('报错'));
  await genVideo(page);
  await expect(videos(page).locator('.vj-error')).toContainText('生成视频出错（MMH3LoopingSampler）', { timeout: 15_000 });
});

test('10.4 第 4 条：下载一条，文件名是「节点标题-种子.mp4」，标已下载', async ({ page }) => {
  await useVideoAutodl(page);
  const folder = path.join(E2E_WORK_FOLDER, '挑出来的视频');
  await fs.mkdir(folder, { recursive: true });
  // 选文件夹的窗口是系统弹的，测试里直接给结果
  await page.route('**/api/assets/pick-folder', (route) => route.fulfill({ json: { path: folder } }));
  await newCanvasWithNode(page, '下载视频');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await send(page, '写一个');
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
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
});

// 槽位放几张图
async function putImages(page: Page, files: string[]) {
  await panel(page).locator('#localFile').setInputFiles(files.map((file) => path.join(FIXTURES_DIR, file)));
  await expect(filledSlots(page)).toHaveCount(files.length);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
}

test('10.4 第 5 条：参考模式两张图 → 两张都传上去、接进编码提示词；一图当首帧 → 钉在第 0 帧，比例自动的按这张图；首尾帧写的提示还不支持', async ({ page }) => {
  await useVideoAutodl(page);
  await newCanvasWithNode(page, '带图');
  await putImages(page, [FIXTURES.first, FIXTURES.second]);
  await send(page, '照这两张图写');
  await expect(box(page).locator('.ig-empty')).toContainText('带 2 张参考图');
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  let graph = await lastGraph(page);
  const uploads = (await (await page.request.get(`${COMFY_URL}/_uploads`)).json()) as { name: string }[];
  const loads = graphNodes(graph, 'LoadImage').map((node) => String(node.inputs.image));
  expect(loads).toHaveLength(2);
  for (const name of loads) expect(uploads.map((u) => u.name)).toContain(name);
  expect(graphNodes(graph, 'MMH3ReferenceMultiPrompt')[0].inputs.ref_images).toEqual(['40', 0]);
  expect(graphNodes(graph, 'ImageTensorList')[0].inputs).toEqual({ image1: ['30', 0], image2: ['31', 0] });

  // 换成图当首帧、比例自动：800×600 的图，0.4 百万像素是 736×576，出片 1472×1152
  await panel(page).locator('#cfgSys').selectOption('i2v');
  await panel(page).locator('#ratioSel').selectOption('auto');
  await expect(panel(page).locator('#btnVideoCfg')).toContainText('出片 1472×1152');
  await send(page, '从第一张图开始');
  await expect(box(page).locator('.ig-empty')).toContainText('第 1 张图当首帧');
  await expect(box(page).locator('.ig-empty')).toContainText('出片 1472×1152');
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  graph = await lastGraph(page);
  expect(graphNodes(graph, 'LoadImage')).toHaveLength(1);
  expect(graphNodes(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ width: 736, height: 576, ref_images: ['30', 0] });
  expect(graphNodes(graph, 'MMH3LoopingSampler')[0].inputs).toMatchObject({ keyframes: ['30', 0], keyframe_indices: '0' });
  await expect(videos(page).locator('.vj-info')).toContainText('1472×1152');

  await panel(page).locator('#cfgSys').selectOption('fl2va');
  await send(page, '首尾两张');
  await expect(box(page).locator('.ig-empty')).toContainText('首尾帧、尾帧这两种提示词写的还不能生成视频');
  await genVideo(page);
  await expect(toasts(page).filter({ hasText: '首尾帧、尾帧这两种提示词写的还不能生成视频' })).toBeVisible();
});

// 生成设置里一采大小改成 0.6：出片 2112×1216，前面几条测试都没出过这个大小
async function useMegapixels(page: Page, megapixels: string) {
  await panel(page).locator('#btnVideoCfg').click();
  await page.locator('[data-od-id="popover-video-settings"] #vcMp').selectOption(megapixels);
  await page.keyboard.press('Escape');
}

test('10.4 第 7 条：两个画布各生成一条，一条含「慢」→ 视频任务 2 → 一条在做、一条排第 1，都估不出 → 叫停排着的 → 点在做的跳过去 → 出完再来一条写着预计还要多久', async ({ page }) => {
  // 含「慢」的每步 1.2 秒，一条要二十多秒
  test.setTimeout(120_000);
  await useVideoAutodl(page);
  await newCanvasWithNode(page, '任务甲');
  const canvasA = page.url();
  await useMegapixels(page, '0.6');
  await send(page, '写一个');
  await editBox(page, '慢慢地走');
  await genVideo(page);
  await expect(videos(page).locator('.ig-state')).toContainText('一采', { timeout: 15_000 });

  await newCanvasWithNode(page, '任务乙');
  await useMegapixels(page, '0.6');
  await send(page, '写一个');
  await genVideo(page);
  const button = page.locator('#videoTasks');
  await expect(button).toContainText('视频任务2');

  await button.click();
  const pop = page.locator('[data-od-id="video-tasks-popover"]');
  const live = pop.locator('[data-od-id="video-tasks-live"] .vt-row');
  await expect(live).toHaveCount(2);
  await expect(live.nth(0)).toContainText('任务甲');
  await expect(live.nth(0).locator('.vt-live')).toContainText('一采');
  await expect(live.nth(0).locator('.vt-live')).toContainText('已经');
  await expect(live.nth(1)).toContainText('任务乙');
  await expect(live.nth(1).locator('.vt-live')).toContainText('排第 1');
  for (const row of [live.nth(0), live.nth(1)]) await expect(row.locator('.vt-left')).toHaveText('第一次出这个大小，估不出');

  // 叫停排着的那条：挪到下面完了的里
  await live.nth(1).locator('[data-vact="stop"]').click();
  await expect(live).toHaveCount(1);
  const done = pop.locator('[data-od-id="video-tasks-done"] .vt-row').first();
  await expect(done).toContainText('任务乙');
  await expect(done).toContainText('已叫停');
  await expect(button).toContainText('视频任务1');

  // 点在做的那条：跳到任务甲那个画布、那个节点，框下面那条闪一下
  await live.nth(0).click();
  await expect(page.locator('#canvasTitle')).toHaveText('任务甲');
  expect(page.url().split('#')[0]).toBe(canvasA);
  await expect(videos(page).first()).toHaveClass(/is-flash/);
  await expect(videos(page).locator('.vj-info')).toHaveCount(1, { timeout: 60_000 });

  // 同样大小、同样段数的再来一条：估得出了
  await videos(page).first().locator('[data-vact="again"]').click();
  await expect(videos(page)).toHaveCount(2);
  await expect(videos(page).nth(1).locator('.ig-state')).toContainText('一采', { timeout: 15_000 });
  await button.click();
  await expect(pop.locator('[data-od-id="video-tasks-live"] .vt-row .vt-left')).toHaveText(/^预计还要 /);
  await pop.locator('[data-od-id="video-tasks-live"] [data-vact="stop"]').click();
  await expect(pop.locator('[data-od-id="video-tasks-live"] .vt-row')).toHaveCount(0, { timeout: 15_000 });

  // 完了的那条在小窗里就能直接播、直接下，见 docs/dev-plan.md 5.29
  const finished = pop.locator('[data-od-id="video-tasks-done"] .vt-row').filter({ hasText: '出完了' }).first();
  await expect(finished.locator('[data-vact="play"]')).toHaveCount(1);
  await expect(finished.locator('[data-vact="download"]')).toHaveCount(1);
  await finished.locator('[data-vact="download"]').click();
  const picker = page.getByRole('dialog', { name: '下载' });
  await expect(picker).toContainText('测试标题');
  await picker.getByRole('button', { name: '取消' }).click();
});

// 在时间条上从第 from 帧拖到第 to 帧
async function dragRange(page: Page, from: number, to: number, total: number) {
  const bar = videos(page).locator('.vrs-bar');
  await bar.scrollIntoViewIfNeeded();
  const rect = (await bar.boundingBox())!;
  const x = (frame: number) => rect.x + (rect.width * frame) / total;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(x(from), y);
  await page.mouse.down();
  await page.mouse.move(x((from + to) / 2), y, { steps: 3 });
  await page.mouse.move(x(to), y, { steps: 3 });
  await page.mouse.up();
}

// mock 那台上这几条视频的存档；前面的测试也会留下
const mockLatents = async (page: Page, ...jobIds: string[]) =>
  ((await (await page.request.get(`${COMFY_URL}/_ssh`)).json()) as { latents: string[] }).latents.filter((name) => jobIds.some((id) => name.includes(id)));

test('10.4 第 8 条：两段的视频存下两份存档 → 拖选 8 到 11 秒重拍，只切第 1 窗、按遮罩重画 → 原片下面多一个版本，能切换、能下载 → 在这一版上再重拍第 2 段 → 删原片连版本和存档一起删；存档没了的说只能整条重出', async ({ page }) => {
  test.setTimeout(120_000);
  await useVideoAutodl(page);
  const folder = path.join(E2E_WORK_FOLDER, '重拍的视频');
  await fs.mkdir(folder, { recursive: true });
  await page.route('**/api/assets/pick-folder', (route) => route.fulfill({ json: { path: folder } }));
  await newCanvasWithNode(page, '重拍一截');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await panel(page).locator('#durVal').click();
  await page.locator('#durInput').fill('30');
  await page.locator('#durInput').press('Enter');
  await expect(panel(page).locator('#durSegs')).toHaveText('分 2 段');
  await send(page, '写一个');
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  const saves = graphNodes(await lastGraph(page), 'MiniMaxH3NativeLatentCheckpointSaveT8Advanced');
  expect(saves.map((node) => String(node.inputs.filename_prefix))).toEqual([expect.stringMatching(/_pass1$/), expect.stringMatching(/_pass2$/)]);
  const rootId = (await videos(page).getAttribute('data-video'))!;
  const original = await mockLatents(page, rootId);
  expect(original).toHaveLength(2);

  // 拖选 8 到 11 秒：拖的时候视频跟着跳
  await dragRange(page, 192, 264, 702);
  await expect(videos(page).locator('[data-od-id="reshoot-range"]')).toHaveText('重拍 8.0 到 11.0 秒，在第 1 段');
  // 假的视频只有一两秒，跳过头的停在最后
  const [at, length] = await videos(page).locator('video').evaluate((video: HTMLVideoElement) => [video.currentTime, video.duration]);
  expect(at).toBeCloseTo(Math.min(11, length), 1);
  await videos(page).locator('[data-segment="0"]').fill('第一段改过的');
  await videos(page).locator('#vrSeed').fill('4242');
  await videos(page).locator('[data-vact="reshoot"]').click();
  await expect(toasts(page).filter({ hasText: '开始重拍这一截' })).toBeVisible();
  const tabs = videos(page).locator('.vj-ver');
  await expect(tabs).toHaveText(['原片', '重拍 8.0 到 11.0 秒']);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(videos(page).locator('.vj-info')).toContainText('种子 4242');

  let graph = await lastGraph(page);
  expect(graphNodes(graph, 'MiniMaxH3NativeLatentCheckpointLoadT8Advanced').map((node) => node.inputs.checkpoint_path)).toEqual([...original].sort());
  expect(graphNodes(graph, 'MMH3TrimAV').slice(0, 2).map((node) => [node.inputs.trim_head_latents, node.inputs.trim_tail_latents])).toEqual([
    [0, 100],
    [0, 100],
  ]);
  expect(graphNodes(graph, 'SolidMask').map((node) => node.inputs.value)).toEqual([0, 1, 0]);
  expect(graphNodes(graph, 'RepeatImageBatch').map((node) => node.inputs.amount)).toEqual([192, 72, 98]);
  expect(graphNodes(graph, 'MMH3ReferenceMultiPrompt')[0].inputs.prompts).toBe('第一段改过的');

  // 切换播放；这一版能下载
  const versionSrc = await videos(page).locator('video').getAttribute('src');
  await tabs.nth(0).click();
  await expect(videos(page).locator('video')).not.toHaveAttribute('src', versionSrc!);
  await expect(videos(page).locator('[data-vact="again"]')).toHaveCount(1);
  await tabs.nth(1).click();
  await expect(videos(page).locator('video')).toHaveAttribute('src', versionSrc!);
  await expect(videos(page).locator('[data-vact="again"]')).toHaveCount(0);
  await videos(page).locator('[data-vact="download"]').click();
  const dialog = page.getByRole('dialog', { name: '下载视频' });
  await expect(dialog.locator('.dl-names')).toHaveText('测试标题-4242.mp4');
  await dialog.locator('[data-dl="pick"]').click();
  await dialog.locator('[data-dl="ok"]').click();
  await expect(videos(page).locator('.ig-dl')).toHaveText('已下载');

  // 在这一版上再选第 2 段里的一截：读回的是这一版的存档
  const versionId = (await tabs.nth(1).getAttribute('data-version'))!;
  await dragRange(page, 480, 528, 702);
  await expect(videos(page).locator('[data-od-id="reshoot-range"]')).toHaveText('重拍 20.0 到 22.0 秒，在第 2 段');
  await videos(page).locator('[data-vact="reshoot"]').click();
  await expect(tabs).toHaveCount(3);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  graph = await lastGraph(page);
  const loaded = graphNodes(graph, 'MiniMaxH3NativeLatentCheckpointLoadT8Advanced').map((node) => String(node.inputs.checkpoint_path));
  expect(loaded).toEqual((await mockLatents(page, versionId)).sort());
  const againId = (await tabs.nth(2).getAttribute('data-version'))!;
  expect(await mockLatents(page, rootId, versionId, againId)).toHaveLength(6);
  expect(graphNodes(graph, 'RepeatImageBatch').map((node) => node.inputs.amount)).toEqual([141, 47, 174]);

  // 删掉原片：各个版本和存档都没了
  await tabs.nth(0).click();
  await videos(page).locator('[data-vact="delete"]').click();
  await expect(videos(page)).toHaveCount(0);
  await expect.poll(() => mockLatents(page, rootId, versionId, againId)).toEqual([]);

  // 存档没了再重拍：这一版没生成出来，说只能整条重出
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  const lostId = (await videos(page).getAttribute('data-video'))!;
  await page.request.post(`${COMFY_URL}/_ssh`, { data: { removeLatents: await mockLatents(page, lostId) } });
  await dragRange(page, 24, 48, 702);
  await videos(page).locator('[data-vact="reshoot"]').click();
  await expect(toasts(page).filter({ hasText: '那台上没有这条的存档了，只能整条重出' })).toBeVisible({ timeout: 15_000 });
  await expect(videos(page).locator('.vj-error')).toHaveText('那台上没有这条的存档了，只能整条重出');
});

test('10.4 第 6 条：设置「AutoDL 上的模型」切到生成视频那台，只能传 LoRA，传一个 → 生成设置里换主模型、搜到这个 LoRA 挂上，强度 0.8 → JSON 里主模型换了、有 LoraLoaderModelOnly', async ({ page }) => {
  test.setTimeout(90_000);
  await useVideoAutodl(page);
  await page.goto('/settings#autodl-models');
  await page.locator('#mxHost').getByRole('button', { name: '生成视频那台' }).click();
  await expect(page.locator('h2 + p')).toContainText('往生成视频那台传 LoRA');
  await page.locator('#mxUpload').click();
  const dialog = page.getByRole('dialog', { name: '从电脑传' });
  await dialog.getByLabel('选文件').setInputFiles({ name: 'my-h3-lora.safetensors', mimeType: 'application/octet-stream', buffer: Buffer.alloc(50_000, 2) });
  await expect(dialog.getByLabel('模型类型').locator('option')).toHaveText(['LoRA']);
  await dialog.getByLabel('子文件夹').fill('H3');
  await dialog.getByRole('button', { name: '传', exact: true }).click();
  await expect(page.locator('[data-file="lora:H3/my-h3-lora.safetensors"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.mx-transfer').first()).toContainText('传完了');

  await newCanvasWithNode(page, '主模型和 LoRA');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await panel(page).locator('#btnVideoCfg').click();
  const settings = page.locator('[data-od-id="popover-video-settings"]');
  await settings.getByRole('button', { name: '主模型', exact: true }).click();
  let picker = page.getByRole('dialog', { name: '选 主模型' });
  await expect(picker.getByRole('option')).toHaveText([
    'minimax/DasiwaMinimaxH3_dasiwaHybridTurboV2_int8.safetensors',
    'minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors',
    'minimax/minimax_h3_ref2va_int8_convrot.safetensors',
  ]);
  await picker.getByRole('option', { name: 'minimax/minimax_h3_ref2va_int8_convrot.safetensors' }).click();
  await expect(settings.getByRole('button', { name: '主模型', exact: true })).toHaveText('minimax/minimax_h3_ref2va_int8_convrot.safetensors');
  await settings.getByRole('button', { name: '挂一个 LoRA' }).click();
  await settings.getByRole('button', { name: 'LoRA', exact: true }).click();
  picker = page.getByRole('dialog', { name: '选 LoRA' });
  await picker.getByRole('textbox', { name: '搜 LoRA' }).fill('my-h3');
  await expect(picker.getByRole('option')).toHaveText(['H3/my-h3-lora.safetensors']);
  await page.keyboard.press('Enter');
  await expect(settings.getByRole('button', { name: 'LoRA', exact: true })).toHaveText('H3/my-h3-lora.safetensors');
  await expect(settings.getByLabel('强度')).toHaveValue('0.8');
  await page.keyboard.press('Escape');

  await send(page, '写一个');
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  const graph = await lastGraph(page);
  expect(graphNodes(graph, 'UNETLoader')[0].inputs.unet_name).toBe('minimax/minimax_h3_ref2va_int8_convrot.safetensors');
  expect(graphNodes(graph, 'LoraLoaderModelOnly').map((node) => node.inputs)).toEqual([{ model: ['1', 0], lora_name: 'H3/my-h3-lora.safetensors', strength_model: 0.8 }]);
});

test('10.4 第 9 条：生成设置里点「不加速」→ 主模型换成 DaSiWa V2 完整版 → 生成视频，JSON 里一采 20 步、二采 6 步 → 点回「加速」，主模型换回加速版', async ({ page }) => {
  await useVideoAutodl(page);
  await newCanvasWithNode(page, '不加速');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await panel(page).locator('#btnVideoCfg').click();
  const settings = page.locator('[data-od-id="popover-video-settings"]');
  const speed = settings.locator('#vcSpeed');
  await expect(speed.getByRole('button', { name: '加速', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await speed.getByRole('button', { name: '不加速' }).click();
  await expect(settings.getByRole('button', { name: '主模型', exact: true })).toHaveText('minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors');
  await page.keyboard.press('Escape');

  await send(page, '写一个');
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  const graph = await lastGraph(page);
  expect(graphNodes(graph, 'UNETLoader')[0].inputs.unet_name).toBe('minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors');
  expect(graphNodes(graph, 'BasicScheduler').map((node) => node.inputs.steps)).toEqual([20, 6]);

  await panel(page).locator('#btnVideoCfg').click();
  await speed.getByRole('button', { name: '加速', exact: true }).click();
  await expect(settings.getByRole('button', { name: '主模型', exact: true })).toHaveText('minimax/DasiwaMinimaxH3_dasiwaHybridTurboV2_int8.safetensors');
});

test('生成设置里能自己填一采、二采的步数：改完流程照它走；越界的填不进、退回原来那个；切预设会覆盖', async ({ page }) => {
  await useVideoAutodl(page);
  await newCanvasWithNode(page, '步数');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await panel(page).locator('#btnVideoCfg').click();
  const settings = page.locator('[data-od-id="popover-video-settings"]');

  // 没改过：照「加速」那个预设
  await expect(settings.locator('#vcSteps1')).toHaveValue('10');
  await expect(settings.locator('#vcSteps2')).toHaveValue('3');
  await expect(settings.locator('.vc-steps-now')).toHaveText('现在是照「加速」');

  await settings.locator('#vcSteps1').fill('14');
  await settings.locator('#vcSteps1').press('Enter');
  await settings.locator('#vcSteps2').fill('5');
  await settings.locator('#vcSteps2').press('Enter');
  await expect(settings.locator('.vc-steps-now')).toHaveText('现在是自己改的');
  // 越界的填不进，退回 14
  await settings.locator('#vcSteps1').fill('99');
  await settings.locator('#vcSteps1').press('Enter');
  await expect(settings.locator('#vcSteps1')).toHaveValue('14');
  await page.keyboard.press('Escape');

  await send(page, '写一个');
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  expect(graphNodes(await lastGraph(page), 'BasicScheduler').map((node) => node.inputs.steps)).toEqual([14, 5]);

  // 切一次不加速：预设把改过的步数覆盖掉
  await panel(page).locator('#btnVideoCfg').click();
  await settings.locator('#vcSpeed').getByRole('button', { name: '不加速' }).click();
  await expect(settings.locator('#vcSteps1')).toHaveValue('20');
  await expect(settings.locator('#vcSteps2')).toHaveValue('6');
  await expect(settings.locator('.vc-steps-now')).toHaveText('现在是自己改的');
});

test('生成设置里能选 SelfLift 接续那套：二采重画多少、总步数、低分辨率几步、放大器、接几帧、加噪、偏色对齐都能改；出片是一段一条片子接力拼起来的', async ({ page }) => {
  await useVideoAutodl(page);
  await newCanvasWithNode(page, 'SelfLift');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await panel(page).locator('#btnVideoCfg').click();
  const settings = page.locator('[data-od-id="popover-video-settings"]');

  // 默认两遍生成：一采、二采的步数在，SelfLift 那几项不在；二采重画多少默认 0.2
  await expect(settings.locator('#vcSteps1')).toHaveValue('10');
  await expect(settings.locator('#vcSelfSteps')).toHaveCount(0);
  await expect(settings.locator('#vcDenoise')).toHaveValue('0.2');
  await settings.locator('#vcDenoise').fill('0.5');
  await settings.locator('#vcDenoise').press('Enter');
  await expect(settings.locator('#vcDenoise')).toHaveValue('0.5');
  // 越界的填不进，退回 0.5
  await settings.locator('#vcDenoise').fill('2');
  await settings.locator('#vcDenoise').press('Enter');
  await expect(settings.locator('#vcDenoise')).toHaveValue('0.5');

  // 切到 SelfLift 接续：一采、二采那套换成接续那套的，默认照 U37 开着上下文那档（4 步低分辨率、0.65）
  await settings.locator('#vcWorkflow').getByRole('button', { name: 'SelfLift 接续' }).click();
  await expect(settings.locator('#vcSteps1')).toHaveCount(0);
  await expect(settings.locator('#vcDenoise')).toHaveCount(0);
  await expect(settings.locator('#vcSelfSteps')).toHaveValue('8');
  await expect(settings.locator('#vcSelfTransition')).toHaveValue('4');
  await expect(settings.locator('#vcSelfLowres')).toHaveValue('0.65');
  await expect(settings.locator('#vcSelfContext')).toHaveValue('22');
  await expect(settings.locator('#vcSelfNoise')).toHaveValue('0.1');
  await expect(settings.locator('#vcSelfColor')).toHaveValue('0.75');
  // 双 LoRA 双采默认两边都不挂，接缝声音羽化默认照 U37 的 12
  await expect(settings.locator('#vcSelfLoras .vc-phase-add')).toHaveCount(2);
  await expect(settings.locator('#vcSelfFeather')).toHaveValue('12');
  // 改一改：低分辨率几步、放大器、接几帧、偏色对齐、声音羽化，再把两遍的 LoRA 都挂上（默认填 U37 那两个、各带强度）
  await settings.locator('#vcSelfTransition').fill('3');
  await settings.locator('#vcSelfTransition').press('Enter');
  await settings.locator('#vcSelfUpscaler').selectOption('none');
  await settings.locator('#vcSelfContext').selectOption('39');
  await settings.locator('#vcSelfColor').fill('0.4');
  await settings.locator('#vcSelfColor').press('Enter');
  await expect(settings.locator('#vcSelfColor')).toHaveValue('0.4');
  await settings.locator('#vcSelfFeather').fill('8');
  await settings.locator('#vcSelfFeather').press('Enter');
  await expect(settings.locator('#vcSelfFeather')).toHaveValue('8');
  await settings.locator('#vcSelfLoras .gc-lora').nth(0).locator('.vc-phase-add').click();
  await expect(settings.getByLabel('低分辨率那遍的 LoRA 强度')).toHaveValue('0.75');
  await settings.locator('#vcSelfLoras .gc-lora').nth(1).locator('.vc-phase-add').click();
  await expect(settings.getByLabel('高分辨率那遍的 LoRA 强度')).toHaveValue('0.7');
  await page.screenshot({ path: 'test-results/video-settings-selflift.png' });
  await page.keyboard.press('Escape');

  // 30 秒 2 段：一段要出 360 帧新画面，一条最多出 362 − 39（接上一段）= 323 帧，所以自己分成几条接力
  await panel(page).locator('#durVal').click();
  await page.locator('#durInput').fill('30');
  await page.locator('#durInput').press('Enter');
  await expect(panel(page).locator('#durSegs')).toHaveText('分 2 段');

  await send(page, '写一个');
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  const prompts = (await comfyPrompts(page)).map((one) => one.prompt);
  // 最后发出去的是「把几段接起来」，再往前找带上下文那条（这套才用 MiniMaxH3AddGuide）
  const merge = [...prompts].reverse().find((graph) => graphNodes(graph, 'ConcatenateVideo').length > 0)!;
  const clip = [...prompts].reverse().find((graph) => graphNodes(graph, 'MiniMaxH3AddGuide').length > 0)!;
  const loads = graphNodes(merge, 'LoadVideo');
  expect(loads.length).toBeGreaterThanOrEqual(2);
  expect(loads.map((node) => node.inputs.file)).toEqual(loads.map((_, i) => expect.stringContaining(`_s${i}.mp4`)));
  expect(graphNodes(merge, 'ConcatenateVideo')[0].inputs['videos.video0']).toEqual(['400', 0]);
  expect(graphNodes(merge, 'SaveVideo')).toHaveLength(1);
  const samplers = graphNodes(clip, 'SelfLiftH3Sampler');
  expect(samplers).toHaveLength(1);
  expect(samplers[0].inputs).toMatchObject({ cfg: 1, transition_step: 3, lowres_scale: 0.65, upscaler_model: 'none', rho: 0.6, w_min: 1, w_max: 1 });
  expect(samplers[0].inputs.model).toEqual(['75', 0]);
  expect(samplers[0].inputs.model_hires).toEqual(['76', 0]);
  expect(graphNodes(clip, 'MMH3LoopingSampler')).toEqual([]);
  expect(graphNodes(clip, 'MinimaxH3LatentUpscaler3D')).toEqual([]);
  expect(graphNodes(clip, 'BasicScheduler').map((node) => node.inputs)).toEqual([expect.objectContaining({ steps: 8, denoise: 1 })]);
  // 双 LoRA 双采：两遍各挂一套，都接在主模型和注意力补丁（4 号）之后
  expect(graphNodes(clip, 'LoraLoaderModelOnly').map((node) => node.inputs)).toEqual([
    { model: ['4', 0], lora_name: 'minimax/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors', strength_model: 0.75 },
    { model: ['4', 0], lora_name: 'minimax/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors', strength_model: 0.7 },
  ]);
  // 接缝声音羽化：带上下文的那几条在 AddGuide 后面过一道，刻度照填的 8；第 1 条没有上下文不接
  expect(graphNodes(clip, 'MiniMaxH3AudioGuideFeather').map((node) => node.inputs)).toEqual([{ positive: ['308', 0], audio_feather_ticks: 8 }]);
  expect(samplers[0].inputs.positive).toEqual(['315', 0]);
  const clips = prompts.filter((graph) => graphNodes(graph, 'MiniMaxH3ReferenceToVideo').length > 0);
  expect(clips.length).toBeGreaterThanOrEqual(2);
  // 假的 ComfyUI 一份进程里跨用例留着发过的图，所以按结构认：带上下文的（有 AddGuide）那条才有羽化，第 1 条没有
  expect(clips.some((graph) => graphNodes(graph, 'MiniMaxH3AddGuide').length === 0)).toBe(true);
  for (const graph of clips) expect(graphNodes(graph, 'MiniMaxH3AudioGuideFeather')).toHaveLength(graphNodes(graph, 'MiniMaxH3AddGuide').length ? 1 : 0);
  // 第 2 段起：读上一段、取最后 39 帧、剪掉 39 帧、颜色对齐，编码用的是 H3 官方的 ReferenceToVideo
  expect(graphNodes(clip, 'MiniMaxH3ReferenceToVideo')).toHaveLength(1);
  expect(graphNodes(clip, 'MiniMaxH3AddGuide')[0].inputs).toMatchObject({ frame_idx: 0 });
  expect(graphNodes(clip, 'VideoFrameSample')[0].inputs).toMatchObject({ num_frames: 39, strategy: 'tail' });
  expect(graphNodes(clip, 'VideoTemporalCrop')[0].inputs).toMatchObject({ start_frame: 39 });
  expect(graphNodes(clip, 'ColorTransfer')[0].inputs).toMatchObject({ strength: 0.4 });
  // 这套没有一采二采的存档，所以没有「重拍一截」；但有「从第 N 段起重出」
  await expect(videos(page).locator('[data-vact="reshoot"]')).toHaveCount(0);
  const before = prompts.length;
  await videos(page).locator('[data-vact="rerun"]').click();
  await expect(page.locator('[data-od-id="popover-rerun"]')).toBeVisible();
  // 3 条都出完了：能从第 2、3 段起
  await expect(page.locator('[data-rerun]')).toHaveText([/从第 2 段起重出/, /从第 3 段起重出/]);
  await page.locator('[data-rerun="2"]').click();
  await expect(finished(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(videos(page).locator('.ig-kind').last()).toHaveText('从第 2 段起重出 · 前 1 段照旧');
  const moved = (await comfyPrompts(page)).map((one) => one.prompt).slice(before);
  // 只重跑了第 2、3 段，再拼一次；留下的第 1 段是照原样拷进 input 的
  expect(moved).toHaveLength(3);
  const rerunClips = moved.filter((graph) => graphNodes(graph, 'MiniMaxH3ReferenceToVideo').length > 0);
  expect(rerunClips).toHaveLength(2);
  expect(graphNodes(rerunClips[0], 'LoadVideo')[0].inputs.file).toBe(graphNodes(moved[2], 'LoadVideo')[0].inputs.file);
  const rerunMerge = moved.filter((graph) => graphNodes(graph, 'ConcatenateVideo').length > 0);
  expect(rerunMerge).toHaveLength(1);
  const names = graphNodes(rerunMerge[0], 'LoadVideo').map((node) => String(node.inputs.file));
  expect(names).toHaveLength(3);
  expect(names.map((name) => name.replace(/_s\d\.mp4$/, '')).every((one) => one === names[0].replace(/_s\d\.mp4$/, ''))).toBe(true);
  expect(names.map((name) => name.match(/_s(\d)\.mp4$/)![1])).toEqual(['0', '1', '2']);
});

// 视频和音频参考用的文件夹：测试用的小视频、小音频和一张图，导入资产库
async function mediaFolder(page: Page): Promise<string> {
  const dir = path.join(E2E_ROOT, 'media-assets');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const name of ['talk.mp4', 'voice.mp3', 'line.mp3', 'hum.mp3', 'short.mp3']) await fs.copyFile(new URL(`../fixtures/media/${name}`, import.meta.url), path.join(dir, name));
  await fs.copyFile(path.join(FIXTURES_DIR, FIXTURES.first), path.join(dir, FIXTURES.first));
  expect((await page.request.post('/api/assets/folders', { data: { path: dir } })).ok()).toBe(true);
  return dir;
}

const mediaSlots = (page: Page) => panel(page).getByTestId('media-slot');
const mediaPop = (page: Page) => page.locator('[data-od-id="popover-media"]');

// 从资产库那个文件夹里按顺序点几个，放进当前节点
async function placeMedia(page: Page, names: string[]) {
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).locator('.as-folder').filter({ hasText: 'media-assets' }).click();
  for (const name of names) await assetTile(page, name).click();
  await assetsDialog(page).getByRole('button', { name: `放进槽位（${names.length}）` }).click();
  await expect(assetsDialog(page)).toHaveCount(0);
  await expect(panel(page).getByTestId('media-slot-placing')).toHaveCount(0, { timeout: 15_000 });
}

// 点一格视频或音频，改用法
async function setUse(page: Page, index: number, use: string) {
  await mediaSlots(page).nth(index).click();
  await mediaPop(page).locator('#mediaUse').getByRole('button', { name: use }).click();
  await expect(mediaPop(page).locator('#mediaUse').getByRole('button', { name: use })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
}

test('10.4 第 10 条：资产库里有视频和音频的格子；和图一起放进视频节点，各进各的槽位；改成画面和声音、从第 0.5 秒起，编号跟着变；改到第几秒，写用多少帧，太短的红字提示；下面写管成片前几秒；发出去说明里有编号，带着截帧；没改的不再说', async ({ page }) => {
  await mediaFolder(page);
  await newCanvasWithNode(page, '视频音频参考');
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).locator('.as-folder').filter({ hasText: 'media-assets' }).click();
  await expect(assetTile(page, 'talk.mp4').locator('.tile-kind')).toHaveText('视频');
  await expect(assetTile(page, 'voice.mp3').locator('.tile-kind')).toHaveText('音频');
  await page.keyboard.press('Escape');

  await placeMedia(page, ['talk.mp4', 'voice.mp3', FIXTURES.first]);
  await expect(filledSlots(page)).toHaveCount(1);
  await expect(mediaSlots(page).locator('.mslot-name')).toHaveText(['视频 1', '音频 1']);
  await expect(mediaSlots(page).first().locator('.mslot-im')).toHaveCount(1);
  // 不到 2 秒的不收
  await placeMedia(page, ['short.mp3']);
  await expect(toasts(page).filter({ hasText: '不到 2 秒的用不了' })).toHaveCount(1);
  await expect(mediaSlots(page)).toHaveCount(2);

  await mediaSlots(page).first().click();
  await mediaPop(page).locator('#mediaUse').getByRole('button', { name: '画面和声音' }).click();
  await mediaPop(page).locator('#mediaStart').fill('0.5');
  await mediaPop(page).locator('#mediaStart').press('Enter');
  // 3 秒的视频从第 0.5 秒取到结束：2.5 秒按 H3 的 17 帧一档用 56 帧，真用 2.3 秒
  await expect(mediaSlots(page).first().locator('.mslot-meta')).toHaveText('2.3 秒 · 画面和声音');
  await expect(mediaSlots(page).first()).toHaveAttribute('title', /从第 0.5 秒取到第 2.8 秒/);
  await expect(mediaPop(page).locator('#mediaEnd')).toHaveValue('2.8');
  await expect(mediaPop(page).locator('#mediaFrames')).toHaveText('用 56 帧');
  // 改到第 2.5 秒：只能用 39 帧、1.6 秒，不到 2 秒，红字提示；改回第 3 秒就好了
  await mediaPop(page).locator('#mediaEnd').fill('2.5');
  await mediaPop(page).locator('#mediaEnd').press('Enter');
  await expect(panel(page).locator('#mediaProblems')).toContainText('视频 1 从第 0.5 秒起只能取 1.6 秒，至少要 2 秒');
  await expect(mediaPop(page).locator('#mediaFrames')).toHaveText('用 39 帧');
  await mediaPop(page).locator('#mediaEnd').fill('3');
  await mediaPop(page).locator('#mediaEnd').press('Enter');
  await expect(panel(page).locator('#mediaProblems')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(mediaSlots(page).locator('.mslot-name')).toHaveText(['视频 1 · 声音是音频 1', '音频 2']);
  await expect(panel(page).locator('#mediaCovers')).toHaveText('视频 1 管成片前 2.3 秒。');

  await send(page, '写一个');
  const user = panel(page).getByTestId('message-user').last();
  await expect(user.locator('.autonote')).toContainText('参考视频 1 段、参考音频 2 段：<Video 1> 取 2.3 秒，画面和声音都用，它的声音是 <Audio 1>；<Audio 2> 取 4 秒。');
  await expect(user.getByTestId('message-frame')).toHaveCount(1);
  await expect(lastReply(page)).toContainText('收到 2 张图：<Picture 1>、<Video 1>');

  await send(page, '再改改');
  await expect(panel(page).getByTestId('message-user').last().locator('.autonote')).toHaveCount(0);
});

test('10.4 第 11 条：参考模式带画面和声音的视频、声音参考、配音 → 框下面写带了什么 → 生成视频，文件传上去，流程里各接各的 → 参考音频凑到 4 段，点生成提示超了', async ({ page }) => {
  await useVideoAutodl(page);
  await mediaFolder(page);
  await newCanvasWithNode(page, '配音和参考');
  await placeMedia(page, ['talk.mp4', 'voice.mp3', 'line.mp3']);
  await setUse(page, 0, '画面和声音');
  await setUse(page, 2, '配音');
  await expect(mediaSlots(page).locator('.mslot-name')).toHaveText(['视频 1 · 声音是音频 1', '音频 2', '配音']);

  await send(page, '写一个');
  await expect(box(page).locator('[data-od-id="video-empty"]')).toContainText('带 1 段参考视频、2 段参考音频、配音');
  await genVideo(page);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  const graph = await lastGraph(page);
  const prompts = graphNodes(graph, 'MMH3ReferenceMultiPrompt')[0].inputs;
  expect(prompts).toMatchObject({ 'ref_videos.ref_video_0': ['200', 0], 'ref_video_audios.ref_video_audio_0': ['200', 2], 'ref_audios.ref_audio_0': ['202', 0], audio: ['206', 0], use_input_audio: true });
  expect(graphNodes(graph, 'VHS_LoadVideo')).toHaveLength(1);
  expect(graphNodes(graph, 'TrimAudioDuration')).toHaveLength(2);
  // 配音比视频短，后面接了静音
  expect(graphNodes(graph, 'AudioConcat')).toHaveLength(1);
  // 读的文件都是传上去过的
  const uploaded = ((await (await page.request.get(`${COMFY_URL}/_uploads`)).json()) as { name: string }[]).map((u) => u.name);
  const read = [...graphNodes(graph, 'VHS_LoadVideo').map((n) => n.inputs.video), ...graphNodes(graph, 'LoadAudio').map((n) => n.inputs.audio)];
  expect(read).toHaveLength(3);
  for (const name of read) expect(uploaded).toContain(name);

  // 配音改回声音参考，再加一段：视频里的声音加上三段声音参考，一共 4 段
  await setUse(page, 2, '声音参考');
  await placeMedia(page, ['hum.mp3']);
  await expect(panel(page).locator('#mediaProblems')).toContainText('参考音频有 4 段（视频里的声音也算），最多 3 段');
  await send(page, '加一段声音');
  await genVideo(page);
  await expect(toasts(page).filter({ hasText: '参考音频有 4 段' })).toHaveCount(1);
});

test('长视频：一采出完先给一份低清预览（二采还在跑），这时叫停，这一版留下能播能下载', async ({ page }) => {
  test.setTimeout(180_000);
  await useVideoAutodl(page);
  await newCanvasWithNode(page, '一采预览');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await panel(page).locator('#durVal').click();
  await page.locator('#durInput').fill('30');
  await page.locator('#durInput').press('Enter');
  await expect(panel(page).locator('#durSegs')).toHaveText('分 2 段');
  await send(page, '写一个');
  // 含「慢」：一采每步 1.2 秒，二采那会儿来得及看预览、也来得及叫停
  await editBox(page, ['慢慢地走', '第二段'].join('\n|\n'));
  await genVideo(page);

  // 一采跑完、二采还在跑：低清预览已经能看了，见 docs/dev-plan.md 5.27
  const job = videos(page).first();
  const preview = job.locator('[data-od-id="video-preview"]');
  await expect(preview).toHaveCount(1, { timeout: 90_000 });
  await expect(preview).toContainText('这是一采（低清）出的整条，二采还在跑');
  await expect(preview.locator('video')).toHaveCount(1);
  await expect(job.locator('.ig-state')).toContainText('二采');

  // 二采途中叫停：这一版转正成结果，能播能下载
  await job.locator('[data-vact="stop"]').click();
  await expect(job.locator('.ig-state')).toContainText('已叫停', { timeout: 30_000 });
  await expect(preview).toHaveCount(0);
  await expect(job.locator('.vj-partial')).toContainText('这是叫停时留下的一采低清版，二采没跑完');
  await expect(job.locator('video')).toHaveCount(1);
  await expect(job.locator('[data-vact="download"]')).toHaveCount(1);
});

test('时长和框里段数对不上时拦住不让生成：框里 1 段、时长拨到 60 秒，说明白要几段、会出多长；改回 15 秒就放行', async ({ page }) => {
  await useVideoAutodl(page);
  await newCanvasWithNode(page, '长度对不上');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  // 默认时长下发一句：模型写 1 段，这时候对得上
  await send(page, '写一个');
  const gen = box(page).locator('[data-act="genVideo"]');
  const warn = box(page).locator('[data-od-id="video-length-mismatch"]');
  await expect(gen).toBeEnabled();
  await expect(warn).toHaveCount(0);

  // 时长拨到 60 秒：框里还是 1 段，先拦下来，别白跑一趟，见 docs/dev-plan.md 5.24
  await panel(page).locator('#durVal').click();
  await page.locator('#durInput').fill('60');
  await page.locator('#durInput').press('Enter');
  await expect(panel(page).locator('#durSegs')).toHaveText('分 4 段');
  await expect(warn).toContainText('时长 60 秒至少要分 4 段（一段最长 15 秒），这个框里只写了 1 段，这样出来只有 15.1 秒');
  await expect(gen).toBeDisabled();
  await expect(gen).toHaveAttribute('title', /至少要分 4 段/);

  // 改回 15 秒：1 段正好，放行
  await panel(page).locator('#durVal').click();
  await page.locator('#durInput').fill('15');
  await page.locator('#durInput').press('Enter');
  await expect(warn).toHaveCount(0);
  await expect(gen).toBeEnabled();
});

test('点「生成视频」先弹配置窗：里面就是生成设置，改完点顶上的「开始生成」才发出去，改了自动存', async ({ page }) => {
  await useVideoAutodl(page);
  await newCanvasWithNode(page, '生成视频配置窗');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  await send(page, '写一个');

  await box(page).locator('[data-act="genVideo"]').click();
  const dialog = genDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#vgTitle')).toHaveText('生成视频');
  await expect(dialog.locator('#vgSub')).toContainText('的第 1 个提示词框');
  await expect(dialog.locator('[data-od-id="video-gen-summary"]')).toContainText('走 两遍生成');
  // 里面就是生成设置那一份（跟「生成设置」小窗同源）
  await expect(dialog.locator('#vcSteps1')).toHaveValue('10');
  await expect(dialog.locator('#vcMp')).toHaveValue('0.4');
  await expect(dialog.locator('#vcFinal')).toHaveText('1728×960');

  // 在窗里改：一采 0.3、二采重画多少 0.5；改完按 Esc 关掉，什么都没发出去
  await dialog.locator('#vcMp').selectOption('0.3');
  await expect(dialog.locator('#vcFinal')).toHaveText('1472×832');
  await dialog.locator('#vcDenoise').fill('0.5');
  await dialog.locator('#vcDenoise').press('Enter');
  await expect(dialog.locator('#vcDenoise')).toHaveValue('0.5');
  await page.screenshot({ path: 'test-results/video-gen-dialog.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(videos(page)).toHaveCount(0);

  // 改了自动存：再打开还是改过的；点顶上的「开始生成」才发
  await box(page).locator('[data-act="genVideo"]').click();
  await expect(genDialog(page).locator('#vcMp')).toHaveValue('0.3');
  await expect(genDialog(page).locator('#vcDenoise')).toHaveValue('0.5');
  await genDialog(page).locator('#vgGo').click();
  await expect(genDialog(page)).toHaveCount(0);
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  const graph = await lastGraph(page);
  expect(graphNodes(graph, 'MMH3ReferenceMultiPrompt')[0].inputs).toMatchObject({ width: 736, height: 416 });
  expect(graphNodes(graph, 'BasicScheduler').map((node) => node.inputs.denoise)).toEqual([1, 0.5]);
  await expect(videos(page).locator('.vj-info')).toContainText('1472×832');
});

test('SelfLift 加「续写起点」：传一段前一段视频，出来的整条 = 这一段 + 这次出的几段；不选就是重新生成', async ({ page }) => {
  await useVideoAutodl(page);
  await newCanvasWithNode(page, '续写起点');
  await panel(page).locator('#cfgSys').selectOption('t2v');
  // 8 秒一套调度出 1 段 192 帧
  await panel(page).locator('#durVal').click();
  await page.locator('#durInput').fill('8');
  await page.locator('#durInput').press('Enter');
  await send(page, '写一个');

  await box(page).locator('[data-act="genVideo"]').click();
  const dialog = genDialog(page);
  await dialog.locator('#vcWorkflow').getByRole('button', { name: 'SelfLift 接续' }).click();
  // 默认不接：就是重新生成（跟本来的行为一样）
  await expect(dialog.locator('#vcLead')).toContainText('不接，重新生成');
  // 从电脑里传一段：不读时长宽高（浏览器不一定读得出来），传完就选上
  const leadFile = path.join(E2E_ROOT, 'lead-source', 'talk.mp4');
  await fs.mkdir(path.dirname(leadFile), { recursive: true });
  await fs.copyFile(new URL('../fixtures/media/talk.mp4', import.meta.url), leadFile);
  await dialog.getByTestId('lead-file').setInputFiles(leadFile);
  await expect(dialog.locator('#vcLead')).toContainText('talk.mp4', { timeout: 15_000 });
  await expect(dialog.locator('.vc-lead-view')).toHaveCount(1);
  // 点开起点那一行看看能挑什么：不接、这个框下面已生成的、画布上的素材、传上来的、电脑里的
  await dialog.locator('#vcLead').click();
  await expect(page.locator('[data-od-id="popover-video-lead"]')).toBeVisible();
  await expect(page.locator('[data-od-id="popover-video-lead"]')).toContainText('传上来的前一段');
  await dialog.locator('#vcLead').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/video-lead.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-od-id="popover-video-lead"]')).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await dialog.locator('#vgGo').click();
  await expect(finished(page)).toHaveCount(1, { timeout: 30_000 });
  // 框下面这条写着是接着哪一段出的
  await expect(videos(page).locator('.ig-meta')).toContainText('续写 talk.mp4');
  const prompts = (await comfyPrompts(page)).map((one) => one.prompt);
  const merge = [...prompts].reverse().find((graph) => graphNodes(graph, 'ConcatenateVideo').length > 0)!;
  const files = graphNodes(merge, 'LoadVideo').map((node) => String(node.inputs.file));
  // 前一段排在最前面（传上去按这条件务起名），后面是这次出的那一段
  expect(files).toHaveLength(2);
  expect(files[0]).toMatch(/_lead\.mp4$/);
  expect(files[1]).toMatch(/_s0\.mp4$/);
  // 这次出的第 1 段读的就是前一段：取 22 帧尾巴钉在第 0 帧上，出片剪掉、颜色对齐
  const clip = [...prompts].reverse().find((graph) => graphNodes(graph, 'MiniMaxH3ReferenceToVideo').length > 0 && graphNodes(graph, 'VideoFrameSample').length > 0)!;
  expect(graphNodes(clip, 'LoadVideo')[0].inputs.file).toBe(files[0]);
  expect(graphNodes(clip, 'VideoFrameSample')[0].inputs).toMatchObject({ num_frames: 22, strategy: 'tail' });
  expect(graphNodes(clip, 'MiniMaxH3AddGuide')[0].inputs).toMatchObject({ frame_idx: 0 });
  expect(graphNodes(clip, 'VideoTemporalCrop')[0].inputs).toMatchObject({ start_frame: 22 });
  expect(graphNodes(clip, 'MiniMaxH3AudioGuideFeather')).toHaveLength(1);

  // 清掉就是重新生成：再点一次「生成视频」，在配置窗里把起点清掉，再开始生成
  await box(page).locator('[data-act="genVideo"]').click();
  const again = genDialog(page);
  await expect(again.locator('#vcLead')).toContainText('talk.mp4');
  await again.locator('#vcLead').click();
  await page.locator('[data-lead="none"]').click();
  await expect(page.locator('[data-od-id="popover-video-lead"]')).toHaveCount(0);
  await expect(again.locator('#vcLead')).toContainText('不接，重新生成');
  await again.locator('#vgGo').click();
  await expect(again).toHaveCount(0);
  await expect(finished(page)).toHaveCount(2, { timeout: 30_000 });
  const after = (await comfyPrompts(page)).map((one) => one.prompt);
  const plain = [...after].reverse().find((graph) => graphNodes(graph, 'ConcatenateVideo').length > 0)!;
  expect(graphNodes(plain, 'LoadVideo').map((node) => node.inputs.file)).toHaveLength(1);

  // 另一条路：从资产库里挑一段（照样只传内容、不读宽高），挑完就选上了
  await mediaFolder(page);
  await box(page).locator('[data-act="genVideo"]').click();
  const third = genDialog(page);
  await third.locator('#vcLead').click();
  await page.locator('[data-lead="assets"]').click();
  await expect(assetsDialog(page)).toBeVisible();
  await expect(assetsDialog(page).locator('#asTitle')).toHaveText('挑一段当续写起点');
  await assetsDialog(page).locator('.as-folder').filter({ hasText: 'media-assets' }).click();
  await assetTile(page, 'talk.mp4').click();
  await expect(assetsDialog(page)).toHaveCount(0);
  await expect(third.locator('#vcLead')).toContainText('talk.mp4', { timeout: 15_000 });
  await third.locator('#vgGo').click();
  await expect(finished(page)).toHaveCount(3, { timeout: 30_000 });
  const picked = (await comfyPrompts(page)).map((one) => one.prompt);
  const mediaMerge = [...picked].reverse().find((graph) => graphNodes(graph, 'ConcatenateVideo').length > 0)!;
  expect(graphNodes(mediaMerge, 'LoadVideo')).toHaveLength(2);
});
