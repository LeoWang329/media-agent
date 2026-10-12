import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { MOCK_COMFY_PORT } from './env';
import { assetsDialog, assetTile, lastReply, newCanvasWithNode, panel, setupWorkFolder, toasts } from './helpers';

// 10.3 第 18 条（E7）：图像编辑节点的第五、六个功能「深度迁移」「风格 Remix」。
// 接线和参数照真机摸出来的 outputs/devcheck/w3-depth.json / w3-reid2.json / w3-remix2.json，
// 见 docs/dev-plan.md 5.36、packages/shared/src/krea2Depth.ts、krea2Remix.ts 和 outputs/devcheck/w3-findings.md。
// 只走界面 + 假 ComfyUI，不连真的那台

const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const graphOf = async (page: Page) => ((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: Graph }[]).at(-1)!.prompt;
const nodeOf = (graph: Graph, type: string) => Object.values(graph).find((n) => n.class_type === type)!;
const idOf = (graph: Graph, type: string) => Object.keys(graph).find((id) => graph[id].class_type === type)!;
const nodesOf = (graph: Graph, type: string) => Object.values(graph).filter((n) => n.class_type === type);
const dock = (page: Page) => panel(page).locator('[data-od-id="composer-dock"]');

test.beforeAll(async ({ playwright }) => {
  await setupWorkFolder(playwright);
});

test.beforeEach(async ({ page }) => {
  expect((await page.request.put('/api/config', { data: { comfyTarget: 'lan' } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL } } })).ok()).toBe(true);
  expect((await page.request.post(`${COMFY_URL}/_hide-nodes`, { data: { types: [] } })).ok()).toBe(true);
});

// 往槽位里放测试图（01-red.jpg，800×600），照 21 / 22 那两份的辅助
async function putImage(page: Page, name = FIXTURES.first) {
  expect((await page.request.post('/api/assets/folders', { data: { path: FIXTURES_DIR } })).ok()).toBe(true);
  await panel(page).locator('#slotAssets').click();
  await assetsDialog(page).locator('.as-folder').filter({ hasText: FIXTURES_DIR }).first().click();
  await assetTile(page, name).click();
  await assetsDialog(page).getByRole('button', { name: /放进槽位/ }).click();
  await expect(assetsDialog(page)).toHaveCount(0);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
}

// 「功能」下拉里选一个
async function pickFn(page: Page, name: string) {
  await dock(page).locator('#editFn').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  await expect(dock(page).locator('#editFn')).toContainText(name);
}

test('10.3 第 18 条（E7）：「深度迁移」「风格 Remix」能在功能下拉里选中，各自的参数区整块跟着换，模型提示词也跟着切', async ({ page }) => {
  await newCanvasWithNode(page, '深度和Remix', '图像编辑节点');
  await expect(dock(page).locator('#editFn')).toContainText('指令编辑');
  // 两个新功能都不是「还没做」那一档
  await dock(page).locator('#editFn').click();
  await expect(page.getByRole('menuitem', { name: '深度迁移', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '风格 Remix', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '深度迁移', exact: true }).click();

  // 深度迁移：提示词 + 控制强度 + 那句「构图跟原图走」，转真人 / 局部重绘那两套不在
  await expect(dock(page).locator('#editNeed')).toHaveText('要 1 张：① 要迁移的图');
  await expect(dock(page).locator('#editPreset')).toBeVisible();
  await expect(dock(page).locator('#editDepthStrength')).toHaveValue('1');
  await expect(dock(page).locator('[data-od-id="edit-depth-desc"]')).toContainText('构图、透视、人物站位跟原图走');
  await expect(dock(page).locator('#editWhoWrites')).toHaveCount(0);
  await expect(dock(page).locator('#editFaceMode')).toHaveCount(0);
  await expect(dock(page).locator('#editInpaintDenoise')).toHaveCount(0);
  await expect(dock(page).locator('[data-od-id="edit-mask"]')).toHaveCount(0);
  // 尺寸不用填：这句实话在（出图固定 1024×1024，见真机那份 JSON）
  await expect(dock(page)).toContainText('出图固定 1024×1024');
  // 顶栏「模型提示词」跟着功能走：只列深度迁移那一份
  await expect(panel(page).locator('.cfg-lbl')).toHaveText('模型提示词');
  await expect(panel(page).locator('#cfgSys option')).toHaveText([/深度迁移/]);

  // 风格 Remix：提示词 + 换人/风格 LoRA 下拉 + 强度 + 两个 LoRA 的区别，深度那条的参数不在
  await pickFn(page, '风格 Remix');
  await expect(dock(page).locator('#editNeed')).toHaveText('要 1 张：① 要改的图');
  await expect(dock(page).locator('#editPreset')).toBeVisible();
  await expect(dock(page).locator('#editRemixLora')).toBeVisible();
  await expect(dock(page).locator('#editRemixLoraStrength')).toHaveValue('1');
  await expect(dock(page).locator('[data-od-id="edit-remix-desc"]')).toContainText('放得开');
  await expect(dock(page).locator('[data-od-id="edit-remix-desc"]')).toContainText('保守');
  await expect(dock(page).locator('#editDepthStrength')).toHaveCount(0);
  await expect(panel(page).locator('#cfgSys option')).toHaveText([/风格 Remix/]);
});

test('10.3 第 18 条（E7）：两个功能的提示词下拉是自己那几条现成的，选一条填进正文（正文照旧能改）', async ({ page }) => {
  await newCanvasWithNode(page, '新功能的现成句子', '图像编辑节点');

  await pickFn(page, '深度迁移');
  await expect(dock(page).locator('#editPreset option')).toHaveText([
    '选一条现成的…',
    '电影感摄影 · 写实、有体积光',
    '二次元插画 · 同构图换画风',
    '油画 / 厚涂 · 笔触重一点',
    '等距黏土模型 · 小微缩',
    '自己写（清空）',
  ]);
  await dock(page).locator('#editPreset').selectOption({ label: '二次元插画 · 同构图换画风' });
  await expect(dock(page).locator('#editText')).toHaveValue(/anime style illustration/);
  await expect(dock(page).locator('#editText')).toBeEditable();
  await dock(page).locator('#editPreset').selectOption({ label: '自己写（清空）' });
  await expect(dock(page).locator('#editText')).toHaveValue('');

  await pickFn(page, '风格 Remix');
  await expect(dock(page).locator('#editPreset option')).toHaveText([
    '选一条现成的…',
    '雨夜霓虹街 · 场景换掉',
    '街头写真 · 只换风格',
    '影棚硬光 · 换个光',
    '日系胶片 · 换个色调',
    '自己写（清空）',
  ]);
  await dock(page).locator('#editPreset').selectOption({ label: '影棚硬光 · 换个光' });
  await expect(dock(page).locator('#editText')).toHaveValue(/hard key light/);
  // 换功能不动你已经写好的字（照 21 那份的规矩）
  await pickFn(page, '深度迁移');
  await expect(dock(page).locator('#editText')).toHaveValue(/hard key light/);
});

test('10.3 第 18 条（E7）：深度迁移 —— 开始 → 假 ComfyUI 收到控制类三节点那套（latent 共用、控制图是槽位那张）→ 出图挂在框下面', async ({ page }) => {
  await newCanvasWithNode(page, '深度迁移出图', '图像编辑节点');
  await putImage(page);
  await pickFn(page, '深度迁移');

  // 没写字：「开始」按住，说清要先写一句
  await expect(dock(page).locator('#btnEditStart')).toBeDisabled();
  await dock(page).locator('#editPreset').selectOption({ label: '电影感摄影 · 写实、有体积光' });
  await expect(dock(page).locator('#btnEditStart')).toBeEnabled();
  // 控制强度调一下：0 不收、0.7 收
  await dock(page).locator('#editDepthStrength').fill('0');
  await expect(dock(page).locator('#editDepthStrength')).toHaveValue('1');
  await dock(page).locator('#editDepthStrength').fill('0.7');
  await dock(page).locator('#editDepthStrength').press('Enter');

  await dock(page).locator('#btnEditStart').click();
  await expect(toasts(page).filter({ hasText: '开始按深度结构重画' })).toBeVisible();
  const box = lastReply(page).getByTestId('prompt-box');
  await expect(box).toContainText('深度迁移');
  await expect(box.locator('.ig-cell.is-done img')).toHaveCount(1);

  const graph = await graphOf(page);
  // 控制类三节点一组，缺一不可，且 Apply 收的是 LoRA 加载器的 MODEL（不是 UNETLoader 的）
  expect(Object.keys(graph).length).toBeGreaterThan(10);
  expect(nodeOf(graph, 'Krea2ControlLoRALoader').inputs).toMatchObject({
    model: [idOf(graph, 'UNETLoader'), 0],
    lora_name: 'krea2/Krea2-depth-control-lora.safetensors',
    strength: 0.7,
  });
  expect(nodeOf(graph, 'Krea2ControlApply').inputs).toEqual({
    model: [idOf(graph, 'Krea2ControlLoRALoader'), 0],
    control_latent: [idOf(graph, 'Krea2ControlImageEncode'), 0],
  });
  expect(nodeOf(graph, 'KSampler').inputs.model).toEqual([idOf(graph, 'Krea2ControlApply'), 0]);
  // 深度提取照 JSON：vitl / 1024，控制图就是槽位传上去的那张
  expect(nodeOf(graph, 'DepthAnythingV2Preprocessor').inputs).toMatchObject({
    image: [idOf(graph, 'LoadImage'), 0],
    ckpt_name: 'depth_anything_v2_vitl.pth',
    resolution: 1024,
  });
  expect(nodeOf(graph, 'LoadImage').inputs.image).toBeTruthy();
  // ★ 控制编码那个 latent 和采样器用的是同一个
  expect(nodeOf(graph, 'Krea2ControlImageEncode').inputs).toMatchObject({
    control_image: [idOf(graph, 'DepthAnythingV2Preprocessor'), 0],
    resize: 'match_latent_size',
    channel_mode: 'grayscale',
    normalize: 'per_image_minmax',
    invert: false,
    batch_mode: 'independent_images',
    latent: [idOf(graph, 'EmptyLatentImage'), 0],
  });
  expect(nodeOf(graph, 'KSampler').inputs.latent_image).toEqual([idOf(graph, 'EmptyLatentImage'), 0]);
  // 底模是跑通的那套 turbo fp8（不是 Remix 那条 int8、也不是无审查），尺寸照 JSON 的 1024×1024
  expect(nodeOf(graph, 'UNETLoader').inputs.unet_name).toBe('krea2/krea2_turbo_fp8_scaled.safetensors');
  expect(nodeOf(graph, 'CLIPLoader').inputs.clip_name).toBe('qwen3vl_4b_fp8_scaled.safetensors');
  expect(nodeOf(graph, 'EmptyLatentImage').inputs).toMatchObject({ width: 1024, height: 1024 });
  // 正负面是普通 CLIPTextEncode：正面是框里那句话、负面空；采样 8 步 / CFG 1 / euler / simple
  expect(nodesOf(graph, 'CLIPTextEncode').map((n) => n.inputs.text)).toEqual([expect.stringContaining('cinematic photograph'), '']);
  expect(nodeOf(graph, 'KSampler').inputs).toMatchObject({ steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 });
  // 转真人 / Remix 那两条路的节点一个都不该有
  expect(nodeOf(graph, 'Easy_QwenEdit2509')).toBeUndefined();
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch')).toBeUndefined();
  expect(nodeOf(graph, 'LoraLoaderModelOnly')).toBeUndefined();
});

test('10.3 第 18 条（E7）：风格 Remix —— 下拉两条 LoRA 能换，开始 → 假 ComfyUI 收到 Ostris 那条（LoRA 只喂 model、参考图缩到 0.140625 MP）→ 出图挂框下', async ({ page }) => {
  await newCanvasWithNode(page, '风格Remix出图', '图像编辑节点');
  await putImage(page);
  await pickFn(page, '风格 Remix');

  // 两条候选，默认「换人」那条
  await expect(dock(page).locator('#editRemixLora option')).toHaveText([
    '换人（放得开：身份带过来，衣服姿势场景都换）',
    '风格 Remix（保守：连原图环境一起留住，只轻微 remix）',
  ]);
  await expect(dock(page).locator('#editRemixLora')).toHaveValue('krea2/krea2_reid_rank32.safetensors');

  // 换成保守那条 + 强度 0.9，再写一句话
  await dock(page).locator('#editRemixLora').selectOption('krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors');
  await dock(page).locator('#editRemixLoraStrength').fill('0.9');
  await dock(page).locator('#editRemixLoraStrength').press('Enter');
  await expect(dock(page).locator('#editText')).toHaveValue('');
  await dock(page).locator('#editPreset').selectOption({ label: '雨夜霓虹街 · 场景换掉' });

  await dock(page).locator('#btnEditStart').click();
  await expect(toasts(page).filter({ hasText: '开始 Remix' })).toBeVisible();
  const box = lastReply(page).getByTestId('prompt-box');
  await expect(box).toContainText('风格 Remix');
  await expect(box.locator('.ig-cell.is-done img')).toHaveCount(1);

  const graph = await graphOf(page);
  // LoRA 只喂 model（官方图的接法），名字带 krea2/ 前缀，强度照面板
  const lora = nodeOf(graph, 'LoraLoaderModelOnly');
  expect(lora.inputs).toEqual({
    model: [idOf(graph, 'UNETLoader'), 0],
    lora_name: 'krea2/Krea2_Remix_RealCosplay_rank64_v1.safetensors',
    strength_model: 0.9,
  });
  // 补丁 kv_cache=true，采样器接补丁
  expect(nodeOf(graph, 'Krea2OstrisEditModelPatch').inputs).toEqual({ model: [idOf(graph, 'LoraLoaderModelOnly'), 0], kv_cache: true });
  expect(nodeOf(graph, 'KSampler').inputs.model).toEqual([idOf(graph, 'Krea2OstrisEditModelPatch'), 0]);
  // 参考图先按总像素缩到 384×384 那个预算，两个编码节点共用它
  const scaled = nodeOf(graph, 'ImageScaleToTotalPixels');
  expect(scaled.inputs).toMatchObject({ upscale_method: 'area', megapixels: 0.140625, resolution_steps: 16 });
  const encodes = nodesOf(graph, 'TextEncodeKrea2OstrisEdit');
  expect(encodes).toHaveLength(2);
  for (const node of encodes) expect(node.inputs.image1).toEqual([idOf(graph, 'ImageScaleToTotalPixels'), 0]);
  expect(encodes.map((n) => n.inputs.prompt)).toEqual([expect.stringContaining('neon-lit rainy city street'), '']);
  // 正负 conditioning 各接一个参考接法节点，不是 ConditioningZeroOut
  const references = nodesOf(graph, 'FluxKontextMultiReferenceLatentMethod');
  // 正面接第一个编码节点（写正面词那个），负面接第二个（空的）
  const encodeIds = Object.keys(graph).filter((id) => graph[id].class_type === 'TextEncodeKrea2OstrisEdit');
  expect(references.map((n) => n.inputs)).toEqual([
    { conditioning: [encodeIds[0], 0], reference_latents_method: 'index_timestep_zero' },
    { conditioning: [encodeIds[1], 0], reference_latents_method: 'index_timestep_zero' },
  ]);
  // 底模是 turbo int8 convrot（不是深度那条 fp8），出图尺寸 1024×1024、跟参考图无关
  expect(nodeOf(graph, 'UNETLoader').inputs.unet_name).toBe('krea2/krea2_turbo_int8_convrot.safetensors');
  expect(nodeOf(graph, 'EmptyLatentImage').inputs).toMatchObject({ width: 1024, height: 1024 });
  expect(nodeOf(graph, 'KSampler').inputs).toMatchObject({ steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 });
  // 深度那条路的控制节点和转真人那个编码节点都不在
  expect(nodeOf(graph, 'Krea2ControlLoRALoader')).toBeUndefined();
  expect(nodeOf(graph, 'Easy_QwenEdit2509')).toBeUndefined();
});

test('10.3 第 18 条（E7）：没选图时两个功能的「开始」都按住，说清要先放一张', async ({ page }) => {
  await newCanvasWithNode(page, '新功能先要图', '图像编辑节点');
  // 假 ComfyUI 的历史是这一轮共用的，所以比「这一条之前有没有多发出去」
  const before = ((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as unknown[]).length;
  for (const name of ['深度迁移', '风格 Remix']) {
    await pickFn(page, name);
    await expect(dock(page).locator('#editText')).toBeEditable();
    await dock(page).locator('#editText').fill('x');
    await expect(dock(page).locator('#btnEditStart')).toBeDisabled();
    await expect(dock(page).locator('#btnEditStart')).toHaveAttribute('title', `还没选图：先在下面点一张${name === '深度迁移' ? '要迁移的' : '要改的'}`);
  }
  // 一句都没发出去
  expect(((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as unknown[]).length).toBe(before);
});
