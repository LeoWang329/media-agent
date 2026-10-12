import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MOCK_AUTODL_TOKEN, MOCK_AUTODL_UUID } from '../../tools/mock-comfyui/src/autodl';
import { E2E_WORK_FOLDER, MOCK_COMFY_PORT } from './env';
import { assetsDialog, assetTile, cards, cardTitled, drawerTitle, filledSlots, lastReply, newCanvasWithNode, newNode, panel, send, setupWorkFolder, toasts } from './helpers';

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;
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

  await newCanvasWithNode(page, '出图', '生图节点');
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
  await newCanvasWithNode(page, '叫停', '生图节点');
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

  await newCanvasWithNode(page, '下载', '生图节点');
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
  await newNode(page);
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
  await newCanvasWithNode(page, '再出图', '生图节点');
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

// ComfyUI 自带的文生图「导出（API）」的样子，最后存图
const API_WORKFLOW: Graph = {
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 5, steps: 20, cfg: 8, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    _meta: { title: 'KSampler' },
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'pony-test.safetensors' }, _meta: { title: 'Load Checkpoint' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 }, _meta: { title: 'Empty Latent Image' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'beautiful scenery', clip: ['4', 1] }, _meta: { title: '正面' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'text, watermark', clip: ['4', 1] }, _meta: { title: '负面' } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['8', 0] } },
};

const jsonFile = (name: string, data: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });

test('10.3 第 9 条：导入普通格式的提示用「导出（API）」→ 导入 API 格式的，自动认出正面、负面、种子、尺寸 → 选它出图，mock 收到的 JSON 只换了这几处 → 有 mock 上没有的节点，出图时说缺哪个', async ({ page }) => {
  await useMockComfy(page);
  await page.goto('/settings#workflows');
  const file = page.getByTestId('workflow-file');
  const dialog = page.getByRole('dialog', { name: '导入工作流' });

  await file.setInputFiles(jsonFile('my-workflow.json', { last_node_id: 9, last_link_id: 9, nodes: [{ id: 3, type: 'KSampler' }], links: [], version: 0.4 }));
  await expect(dialog).toContainText('这是普通的工作流文件，不是 API 格式。');
  await expect(dialog).toContainText('菜单「工作流」→「导出（API）」');
  await dialog.getByRole('button', { name: '知道了' }).click();
  await expect(dialog).toHaveCount(0);

  await file.setInputFiles(jsonFile('basic-api.json', API_WORKFLOW));
  await expect(dialog).toContainText('认出来了，程序会往这几处填');
  for (const text of ['6 · CLIPTextEncode · 正面', '7 · CLIPTextEncode · 负面', '3 · KSampler · seed', '5 · EmptyLatentImage']) await expect(dialog.locator('.sx-map')).toContainText(text);
  await expect(dialog.locator('#wfName')).toHaveValue('basic-api');
  await dialog.locator('#wfName').fill('基础文生图');
  await dialog.getByRole('button', { name: '导入' }).click();
  await expect(toasts(page).filter({ hasText: '导入了，存在工作文件夹的 workflows 里' })).toBeVisible();
  await expect(page.locator('[data-wf]').filter({ hasText: '基础文生图' })).toContainText('basic-api.json');

  // 多一个 mock 上没有的节点：导入时就说，照样能导进来
  await file.setInputFiles(jsonFile('lacking-api.json', { ...API_WORKFLOW, '10': { class_type: 'NotInstalledTestNode', inputs: { images: ['8', 0] } } }));
  await expect(dialog).toContainText('这台 ComfyUI 上没有：NotInstalledTestNode');
  await dialog.locator('#wfName').fill('缺插件的');
  await dialog.getByRole('button', { name: '导入' }).click();
  await expect(page.locator('[data-wf]').filter({ hasText: '缺插件的' })).toContainText('这台 ComfyUI 上没有这几种节点：NotInstalledTestNode');

  await newCanvasWithNode(page, '导入的工作流', '生图节点');
  await setCount(page, 1);
  await send(page, '写一个');
  const settings = page.getByRole('dialog', { name: '出图设置' });
  await panel(page).locator('#btnGenCfg').click();
  await settings.locator('#gcWf').selectOption({ label: '基础文生图（导入的）' });
  await expect(settings).toContainText('导入的工作流里，底模、LoRA、步数这些按它自己的来');
  await expect(settings.locator('#gcCkpt')).toHaveCount(0);
  await settings.getByRole('button', { name: '好了' }).click();
  await expect(panel(page).locator('#btnGenCfg')).toContainText('工作流「基础文生图」');

  const sentBefore = (await comfyPrompts(page)).length;
  await box(page).locator('[data-act="gen"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });
  await expect(box(page).locator('.ig-meta')).toContainText('工作流「基础文生图」');
  const seed = Number(await box(page).locator('.ig-seed').textContent());
  const sent = (await comfyPrompts(page)).slice(sentBefore);
  expect(sent).toHaveLength(1);
  const graph = sent[0].prompt;
  expect(graph['6'].inputs.text).toMatch(/^masterpiece, best quality, 1girl, /);
  expect(graph['7'].inputs.text).toMatch(/^lowres, worst quality, /);
  expect(graph['3'].inputs).toEqual({ ...API_WORKFLOW['3'].inputs, seed });
  expect(graph['5'].inputs).toEqual({ width: 832, height: 1216, batch_size: 1 });
  for (const id of ['4', '8', '9']) expect(graph[id]).toEqual(API_WORKFLOW[id]);

  await cells(page).first().click();
  await expect(viewer(page)).toContainText('导入的「基础文生图」');
  await expect(viewer(page)).toContainText('按工作流里原来的');
  await page.keyboard.press('Escape');
  await expect(viewer(page)).toHaveCount(0);

  await panel(page).locator('#btnGenCfg').click();
  await settings.locator('#gcWf').selectOption({ label: '缺插件的（导入的）' });
  await expect(settings).toContainText('这台 ComfyUI 上没有这几种节点：NotInstalledTestNode，出图前会拦下来');
  await settings.getByRole('button', { name: '好了' }).click();
  await box(page).locator('[data-act="gen"]').click();
  const error = box(page).locator('.ig-err');
  await expect(error).toContainText('这台 ComfyUI 缺插件，没有发出去');
  await expect(error).toContainText('object_info 里没有 NotInstalledTestNode');
  expect(await comfyPrompts(page)).toHaveLength(sentBefore + 1);
});

test('出图设置：LoRA 点开能按名字搜，空格隔开的几个词都对得上才列出来；上下键挑、回车选上，存进节点', async ({ page }) => {
  await useMockComfy(page);
  await newCanvasWithNode(page, 'LoRA', '生图节点');
  const settings = page.getByRole('dialog', { name: '出图设置' });
  await panel(page).locator('#btnGenCfg').click();
  await settings.getByRole('button', { name: '挂一个 LoRA' }).click();
  const field = settings.getByRole('button', { name: 'LoRA', exact: true });
  await expect(field).toHaveText('detail-test.safetensors');

  await field.click();
  const picker = page.getByRole('dialog', { name: '选 LoRA' });
  const options = picker.getByRole('option');
  await expect(options).toHaveText(['detail-test.safetensors', 'IL/anime-style-test.safetensors', 'IL/detail-tweaker-test.safetensors', 'krea2/krea2_4panel.safetensors', 'krea2/krea2_identity_edit_v1_1.safetensors', 'krea2/krea2_identity_edit_v1_2.safetensors', 'krea2/krea_outfittransfer.safetensors', 'krea2/Krea2_Anything2RealCharacters-V1.safetensors', 'krea2/Krea2_Anything2RealCharacters-V3.safetensors', 'krea2/krea2_darkbrush.safetensors', 'krea2/DynamicCharacterSheet_krea2_v1.safetensors', 'krea2/Krea2_DreamCos_Realism.safetensors', 'krea2/Krea2-realism-V2.safetensors', 'krea2/krea2-Cc风情万种-人像.safetensors', 'krea2/krea2-Cc风情万种-风格.safetensors', 'krea2/krea2-Cc-天魔-身材.safetensors', 'krea2/Nick_baotunqun_Krea2.safetensors', 'krea2/Nick_leggings_Krea2.safetensors', 'krea2/krea2_reid_rank32.safetensors', 'krea2/Krea2-depth-control-lora.safetensors', 'krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors']);
  const search = picker.getByRole('textbox', { name: '搜 LoRA' });
  await expect(search).toBeFocused();
  await search.fill('il ANIME');
  await expect(options).toHaveText(['IL/anime-style-test.safetensors']);
  await search.fill('nothing');
  await expect(picker).toContainText('没有名字里带「nothing」的 LoRA');
  await search.fill('detail');
  await expect(options).toHaveCount(2);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(field).toHaveText('IL/detail-tweaker-test.safetensors');
  await settings.getByRole('button', { name: '好了' }).click();

  const canvasId = new URL(page.url()).pathname.split('/').at(-1)!;
  const nodeId = (await cardTitled(page, (await drawerTitle(page).textContent())!).getAttribute('data-id'))!;
  const node = (await (await page.request.get(`/api/canvases/${canvasId}/nodes/${nodeId}`)).json()) as { image: { loras: unknown[] } };
  expect(node.image.loras).toEqual([{ name: 'IL/detail-tweaker-test.safetensors', strength: 0.8 }]);
});

test('出图设置：底模点开能按名字搜，只列这个系列的；这台 ComfyUI 上没有的也列出来并标明，选一个换掉存进节点', async ({ page }) => {
  await useMockComfy(page);
  await newCanvasWithNode(page, '底模', '生图节点');
  const settings = page.getByRole('dialog', { name: '出图设置' });
  await panel(page).locator('#btnGenCfg').click();
  await expect(settings.locator('#gcCkpt')).toHaveText('il-test.safetensors');

  await settings.locator('#gcCkpt').click();
  const picker = page.getByRole('dialog', { name: '选 底模' });
  const options = picker.getByRole('option');
  // pony-test 这台上有，但不是 IL 系列，不列
  await expect(options).toHaveText(['il-test.safetensors']);
  const search = picker.getByRole('textbox', { name: '搜 底模' });
  await expect(search).toBeFocused();
  await search.fill('pony');
  await expect(picker).toContainText('没有名字里带「pony」的 底模');
  await search.press('Escape');
  await settings.getByRole('button', { name: '好了' }).click();

  // 节点上写着这台 ComfyUI 没有的底模：照样列出来、后面标一句，也能换回有的那个
  const canvasId = new URL(page.url()).pathname.split('/').at(-1)!;
  const nodeId = (await cardTitled(page, (await drawerTitle(page).textContent())!).getAttribute('data-id'))!;
  const patched = await page.request.patch(`/api/canvases/${canvasId}/nodes/${nodeId}`, { data: { image: { checkpoint: 'gone-test.safetensors' } } });
  expect(patched.ok()).toBe(true);
  await page.reload();
  await expect(cards(page)).toHaveCount(1);
  if (!(await panel(page).locator('#btnGenCfg').count())) await cards(page).first().click();
  await panel(page).locator('#btnGenCfg').click();
  await expect(settings.locator('#gcCkpt')).toHaveText('gone-test.safetensors');

  await settings.locator('#gcCkpt').click();
  await expect(options).toHaveText(['gone-test.safetensors（这台 ComfyUI 上没有）', 'il-test.safetensors']);
  await picker.getByRole('textbox', { name: '搜 底模' }).fill('il');
  await expect(options).toHaveText(['il-test.safetensors']);
  await picker.getByRole('textbox', { name: '搜 底模' }).press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(settings.locator('#gcCkpt')).toHaveText('il-test.safetensors');
  await settings.getByRole('button', { name: '好了' }).click();

  const node = (await (await page.request.get(`/api/canvases/${canvasId}/nodes/${nodeId}`)).json()) as { image: { checkpoint: string } };
  expect(node.image.checkpoint).toBe('il-test.safetensors');
});

test('写标签：不问 AI 写成一个框，标着「自己写的」，能直接生图；再写一串、带一句要求让 AI 优化，自己写的存下来留着，AI 带着前面的对话回一个新框', async ({ page }) => {
  await useMockComfy(page);
  await newCanvasWithNode(page, '写标签', '生图节点');
  await setCount(page, 1);
  const writer = page.getByRole('dialog', { name: '写标签' });
  const tagNames = writer.locator('.te-chip .tg-name');

  await panel(page).locator('#btnWriteTags').click();
  await expect(writer.locator('#teSub')).toContainText('IL 系列');
  await page.locator('#teInput').click();
  await page.keyboard.type('1girl, solo, red hair,');
  await expect(tagNames).toHaveText(['1girl', 'solo', 'red hair']);
  await writer.locator('[data-te="save"]').click();
  await expect(writer).toHaveCount(0);
  await expect(toasts(page).filter({ hasText: '存成了一个框，标着「自己写的」' })).toBeVisible();
  await expect(lastReply(page).locator('.msg-role')).toHaveText('自己写的');
  await expect(lastReply(page).locator('.msg-meta')).toHaveText('自己写的，没有调用 AI');
  await expect(lastReply(page).locator('[data-act="regen"]')).toHaveCount(0);
  await expect(box(page).locator('.tg-name')).toHaveText(['1girl', 'solo', 'red hair']);

  const sentBefore = (await comfyPrompts(page)).length;
  await box(page).locator('[data-act="gen"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });
  const [body] = (await comfyPrompts(page)).slice(sentBefore);
  const positives = Object.values(body.prompt).filter((n) => n.class_type === 'CLIPTextEncode').map((n) => String(n.inputs.text));
  expect(positives.some((text) => text.endsWith('1girl, solo, red hair'))).toBe(true);

  await panel(page).locator('#btnWriteTags').click();
  await page.locator('#teInput').click();
  await page.keyboard.type('blonde hair,');
  await expect(tagNames).toHaveText(['blonde hair']);
  await writer.locator('#teReq').fill('换成夜景');
  await writer.locator('[data-te="optimize"]').click();
  await expect(writer).toHaveCount(0);
  await expect(panel(page).getByTestId('message-user').last()).toContainText('优化上面这个框里我自己写的标签：换成夜景');
  // 两个自己写的框和 AI 回的；发给模型的是两个自己写的框加这次的要求
  await expect(panel(page).getByTestId('message-assistant')).toHaveCount(3);
  await expect(lastReply(page)).toContainText('说明：优化上面这个框里我自己写的标签：换成夜景');
  await expect(lastReply(page)).toContainText('历史消息 3 条');
  await expect(lastReply(page).locator('.msg-meta')).toContainText('mock-model');
  await expect(panel(page).getByTestId('message-assistant').nth(1).locator('.tg-name')).toHaveText(['blonde hair']);
});

// 节点里存的出图设置
async function nodeImageOf(page: Page) {
  const canvasId = new URL(page.url()).pathname.split('/').at(-1)!;
  const nodeId = (await cardTitled(page, (await drawerTitle(page).textContent())!).getAttribute('data-id'))!;
  return ((await (await page.request.get(`/api/canvases/${canvasId}/nodes/${nodeId}`)).json()) as { image: Record<string, unknown> }).image;
}

// 发给 ComfyUI 的流程里，一个节点某个输入连着的那个节点
const linkedNode = (graph: Graph, link: unknown) => graph[String((link as [string, number])[0])];

test('10.3 第 11 条：出图设置里打开放大 2 倍、加两道部位重绘（脸、手，手这道写了正面）→ 生图，新图是原来的 2 倍 → mock 收到放大和两个 FaceDetailer → 大图参数里写着 → mock 去掉 FaceDetailer 再生图，说缺 Impact Pack', async ({ page }) => {
  await useMockComfy(page);
  await newCanvasWithNode(page, '放大重绘', '生图节点');
  await setCount(page, 1);
  await send(page, '写一个');

  const settings = page.getByRole('dialog', { name: '出图设置' });
  await panel(page).locator('#btnGenCfg').click();
  const upscale = settings.locator('[data-stage="upscale"]');
  await upscale.getByRole('button', { name: '放大', exact: true }).click();
  await upscale.getByLabel('放大模型').selectOption('4x-test.pth');
  await expect(upscale).toContainText('放大到 1664×2432');
  const passes = settings.locator('[data-stage="details"]');
  await passes.getByRole('button', { name: '加一道' }).click();
  const face = passes.locator('[data-pass="0"]');
  // 新加的一道先选名字带 face 的；同一个文件夹里的 SAM 不列
  await expect(face.getByLabel('检测模型')).toHaveValue('bbox/face_yolov8m.pt');
  await expect(face.getByLabel('检测模型').locator('option')).toHaveText(['bbox/face_yolov8m', 'bbox/hand_yolov8s', 'segm/person_yolov8m-seg']);
  await passes.getByRole('button', { name: '加一道' }).click();
  const hand = passes.locator('[data-pass="1"]');
  await hand.getByLabel('检测模型').selectOption('bbox/hand_yolov8s.pt');
  await hand.getByLabel('这道的正面').fill('detailed hands');
  await hand.getByLabel('这道的正面').press('Enter');
  await settings.getByRole('button', { name: '好了' }).click();
  await expect.poll(async () => ((await nodeImageOf(page)).details as { positive: string }[])?.[1]?.positive).toBe('detailed hands');

  const sentBefore = (await comfyPrompts(page)).length;
  await box(page).locator('[data-act="gen"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });
  await expect(box(page).locator('.ig-head').last()).toContainText('1664×2432');
  const [body] = (await comfyPrompts(page)).slice(sentBefore);
  expect(graphNode(body.prompt, 'ImageUpscaleWithModel')).toBeTruthy();
  expect(graphNode(body.prompt, 'ImageScale').inputs).toMatchObject({ width: 1664, height: 2432 });
  const detailers = Object.values(body.prompt).filter((n) => n.class_type === 'FaceDetailer');
  expect(detailers.map((n) => linkedNode(body.prompt, n.inputs.bbox_detector).inputs.model_name)).toEqual(['bbox/face_yolov8m.pt', 'bbox/hand_yolov8s.pt']);
  expect(linkedNode(body.prompt, detailers[1].inputs.positive).inputs.text).toBe('masterpiece, best quality, detailed hands');
  expect(linkedNode(body.prompt, detailers[1].inputs.image)).toBe(detailers[0]);

  await cells(page).first().click();
  await expect(viewer(page).locator('.ib-kv', { hasText: '尺寸' })).toContainText('1664×2432');
  await expect(viewer(page).locator('.ib-kv', { hasText: '放大' })).toContainText('4x-test 2× · 重绘 0.35');
  const detail = viewer(page).locator('.ib-kv', { hasText: '部位重绘' });
  await expect(detail).toContainText('bbox/face_yolov8m');
  await expect(detail).toContainText('bbox/hand_yolov8s');
  await expect(detail).toContainText('自己写了正面');
  await page.keyboard.press('Escape');

  // 这台 ComfyUI 去掉 FaceDetailer（读一次新的节点列表）：一张都不发，说要装 Impact Pack
  await page.request.post(`${COMFY_URL}/_hide-nodes`, { data: { types: ['FaceDetailer'] } });
  try {
    await page.request.get('/api/comfy/options?refresh=1');
    const before = (await comfyPrompts(page)).length;
    await box(page).locator('[data-act="gen"]').click();
    await expect(toasts(page).filter({ hasText: '这组没出成：缺插件' })).toBeVisible({ timeout: 15_000 });
    const jobs = (await jobsOf(page, await placeOf(page))) as unknown as { images: { error?: string }[] }[];
    expect(jobs.at(-1)!.images[0].error).toBe('这台 ComfyUI 缺插件：object_info 里没有 FaceDetailer，要装 ComfyUI-Impact-Pack');
    expect(await comfyPrompts(page)).toHaveLength(before);
  } finally {
    await page.request.post(`${COMFY_URL}/_hide-nodes`, { data: { types: [] } });
    await page.request.get('/api/comfy/options?refresh=1');
  }
});

test('10.3 第 12 条：大图里点「放大和重绘」→ 关掉放大、只留脸那道 → 开始 → 框下面多一组，标着从哪张来，mock 收到传上去的图，流程从 LoadImage 开始 → 存成预设、另一个节点套用 → 设置里改名、删除', async ({ page }) => {
  await useMockComfy(page);
  await newCanvasWithNode(page, '补做', '生图节点');
  await setCount(page, 1);
  await send(page, '写一个');
  const place = await placeOf(page);
  const face = { on: true, detector: 'bbox/face_yolov8m.pt', sam: '', threshold: 0.3, denoise: 0.4, guideSize: 1024, positive: '', negative: '' };
  const image = { upscale: { on: true, model: '4x-test.pth', scale: 2, denoise: 0.35 }, details: [face, { ...face, detector: 'bbox/hand_yolov8s.pt' }] };
  expect((await page.request.patch(`/api/canvases/${place.canvasId}/nodes/${place.nodeId}`, { data: { image } })).ok()).toBe(true);
  // 先离开画布页再回来，页面重新读节点（只改 # 后面的部分不会重新加载）
  await page.goto('/');
  await page.goto(`/canvas/${place.canvasId}#node=${place.nodeId}`);
  await box(page).locator('[data-act="gen"]').click();
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });
  const [first] = await jobsOf(page, place);

  await cells(page).first().click();
  await viewer(page).locator('#ibRefine').click();
  const form = viewer(page).locator('.ib-refine');
  // 先拿的是节点现在的设置
  await expect(form.locator('[data-stage="upscale"]').getByRole('button', { name: '放大', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await form.locator('[data-stage="upscale"]').getByRole('button', { name: '不放大' }).click();
  await form.locator('[data-pass="1"]').getByLabel('第 2 道开着').uncheck();
  const sentBefore = (await comfyPrompts(page)).length;
  await form.getByRole('button', { name: '开始' }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(box(page).locator('.ig-job')).toHaveCount(2);
  await expect(box(page).locator('.ig-kind').last()).toHaveText(/^放大和重绘 · 来自 \d\d:\d\d 那组第 1 张$/);
  await expect(box(page).locator('.ig-job').last().locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 15_000 });

  const uploads = (await (await page.request.get(`${COMFY_URL}/_uploads`)).json()) as { name: string }[];
  const [body] = (await comfyPrompts(page)).slice(sentBefore);
  expect(graphNode(body.prompt, 'LoadImage').inputs.image).toBe(uploads.at(-1)!.name);
  expect(Object.values(body.prompt).filter((n) => n.class_type === 'FaceDetailer')).toHaveLength(1);
  expect(Object.values(body.prompt).some((n) => n.class_type === 'EmptyLatentImage' || n.class_type === 'ImageUpscaleWithModel')).toBe(false);
  // 节点的设置没被大图里的改动改掉
  expect((await nodeImageOf(page)).upscale).toMatchObject({ on: true });
  expect(((await jobsOf(page, place)) as unknown as { kind: string; source: { jobId: string } }[]).at(-1)).toMatchObject({ kind: 'refine', source: { jobId: first.id } });

  // 存成预设，另一个节点套用：放大和部位重绘带过去，张数不变
  const settings = page.getByRole('dialog', { name: '出图设置' });
  await panel(page).locator('#btnGenCfg').click();
  await settings.locator('#gcSavePreset').click();
  const pop = page.getByRole('dialog', { name: '存成预设' });
  await pop.getByLabel('预设的名字').fill('测试预设');
  await pop.getByRole('button', { name: '存', exact: true }).click();
  await expect(toasts(page).filter({ hasText: '存成了预设「测试预设」' })).toBeVisible();
  await settings.getByRole('button', { name: '好了' }).click();

  await newCanvasWithNode(page, '套预设', '生图节点');
  await setCount(page, 2);
  await panel(page).locator('#btnGenCfg').click();
  await settings.locator('#gcPreset').selectOption({ label: '测试预设' });
  await expect(toasts(page).filter({ hasText: '套上了「测试预设」。张数和种子没动' })).toBeVisible();
  await expect(settings.locator('[data-stage="upscale"]').getByRole('button', { name: '放大', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.locator('[data-pass]')).toHaveCount(2);
  await settings.getByRole('button', { name: '好了' }).click();
  await expect.poll(async () => (await nodeImageOf(page)).details).toEqual(image.details);
  expect(await nodeImageOf(page)).toMatchObject({ count: 2, upscale: image.upscale });

  await page.goto('/settings#presets');
  const row = page.locator('[data-preset]').filter({ hasText: '测试预设' });
  await expect(row).toContainText('放大 2×');
  await expect(row).toContainText('部位重绘 2 道');
  const id = await row.getAttribute('data-preset');
  const item = page.locator(`[data-preset="${id}"]`);
  await item.locator('[data-pa="rename"]').click();
  await item.locator('input').fill('E02 测试');
  await item.locator('input').press('Enter');
  await expect(item.locator('.sx-wf-name')).toHaveText('E02 测试');
  await item.locator('[data-pa="del"]').click();
  await page.getByRole('dialog', { name: '删除预设「E02 测试」？' }).getByRole('button', { name: '删除' }).click();
  await expect(item).toHaveCount(0);
});

test('10.3 第 10 条：设置里填 AutoDL 的 Token（mock 的）、选实例 → 出图设置切到 AutoDL → 生图 → 显示「正在开机」→ 出完图 → 手动关机，状态变成已关机', async ({ page }) => {
  await useMockComfy(page);
  await page.goto('/settings#comfy');
  const card = page.locator('[data-od-id="comfy-autodl"]');
  await expect(card.locator('.mf-keystate')).toContainText('还没配置');
  await page.locator('#adToken').fill(MOCK_AUTODL_TOKEN);
  await page.locator('#adToken').press('Enter');
  await expect(toasts(page).filter({ hasText: 'Token 已存到这台电脑' })).toBeVisible();
  await expect(page.locator('#adToken')).toHaveValue('');
  await expect(card.locator('.mf-keystate')).toContainText('已配置');
  await expect(page.locator('#adInst option').filter({ hasText: 'ComfyUI-测试 · 西北B区 · vGPU-32GB · ¥1.68/小时' })).toHaveCount(1);
  await page.locator('#adInst').selectOption(MOCK_AUTODL_UUID);
  await expect(page.locator('#adState')).toContainText('已关机');

  await newCanvasWithNode(page, 'AutoDL 出图', '生图节点');
  await setCount(page, 1);
  await send(page, '写一个');
  const settings = page.getByRole('dialog', { name: '出图设置' });
  await panel(page).locator('#btnGenCfg').click();
  await settings.getByRole('button', { name: 'AutoDL 实例' }).click();
  await expect(toasts(page).filter({ hasText: 'AutoDL 实例出图。它现在关着，点生图时会先开机' })).toBeVisible();
  await expect(settings.locator('.gc-src-state')).toContainText('已关机');
  await page.keyboard.press('Escape');
  const pill = page.locator('.cf-pill');
  await expect(pill).toContainText('AutoDL 已关机');

  await box(page).locator('[data-act="gen"]').click();
  await expect(toasts(page).filter({ hasText: 'AutoDL 实例关着，先开机，开好了再出图' })).toBeVisible();
  await expect(box(page).locator('.ig-state')).toContainText('AutoDL 正在开机，等了');
  await expect(cells(page).first()).toContainText('等开机');
  await expect(pill).toContainText('AutoDL 正在开机');
  await expect(box(page).locator('.ig-cell.is-done img')).toHaveCount(1, { timeout: 30_000 });
  await expect(toasts(page).filter({ hasText: 'AutoDL 实例开好了' })).toBeVisible();
  await expect(pill).toContainText('AutoDL 运行中');
  await expect(box(page).locator('.ig-meta')).toContainText('AutoDL');

  await pill.click();
  await page.locator('[data-od-id="comfy-popover"]').getByRole('button', { name: '现在关机' }).click();
  await page.getByRole('dialog', { name: '关掉 AutoDL 实例？' }).getByRole('button', { name: '关机' }).click();
  await expect(pill).toContainText('AutoDL 已关机', { timeout: 15_000 });
  const { calls } = (await (await page.request.get(`${COMFY_URL}/_autodl`)).json()) as { calls: { action: string }[] };
  expect(calls.slice(-2).map((c) => c.action)).toEqual(['power_on', 'power_off']);
});
