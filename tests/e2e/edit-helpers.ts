import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import type { ChatNode, ComfyGraph, EditFnId } from '@media-agent/shared';
import { FIXTURES, FIXTURES_DIR } from '../fixtures/makeImages';
import { MOCK_COMFY_PORT } from './env';
import { cards, newCanvasWithNode, panel } from './helpers';

export const COMFY_URL = `http://127.0.0.1:${MOCK_COMFY_PORT}`;
export const nodeOf = (graph: ComfyGraph, type: string) => Object.values(graph).find((node) => node.class_type === type)!;
export const graphOf = async (page: Page) => ((await (await page.request.get(`${COMFY_URL}/_last-prompts`)).json()) as { prompt: ComfyGraph }[]).at(-1)!.prompt;
export async function prepareEdit(page: Page, title: string, count = 1) {
  expect((await page.request.put('/api/config', { data: { comfyTarget: 'lan' } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings', { data: { comfy: { lanUrl: COMFY_URL } } })).ok()).toBe(true);
  expect((await page.request.post(`${COMFY_URL}/_hide-nodes`, { data: { types: [] } })).ok()).toBe(true);
  await newCanvasWithNode(page, title, '改图节点');
  if (count) await panel(page).locator('#localFile').setInputFiles([FIXTURES.first, FIXTURES.second].slice(0, count).map((name) => path.join(FIXTURES_DIR, name)));
  await expect(panel(page).locator('#slots .slot.is-filled')).toHaveCount(count);
  await expect(panel(page).locator('#slots .processing')).toHaveCount(0);
}
export async function chooseFn(page: Page, fn: EditFnId) {
  await panel(page).locator('#editOp').selectOption(fn);
  await panel(page).getByRole('tab', { name: '执行', exact: true }).click();
}
export async function startEditResult(page: Page, count = 1) {
  await panel(page).locator('#editStart').click();
  await expect(panel(page).getByRole('tab', { name: '结果', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).locator('.wb-result')).toHaveCount(count, { timeout: 20_000 });
  await expect(panel(page).locator('.wb-result img')).toHaveCount(count);
}
export async function nodeAt(page: Page) {
  const canvasId = page.url().split('/').at(-1)!;
  const detail = await (await page.request.get(`/api/canvases/${canvasId}`)).json();
  return `/api/canvases/${canvasId}/nodes/${detail.nodes.find((n: { kind: string }) => n.kind === 'edit').id}`;
}
export const currentNode = async (page: Page) => (await (await page.request.get(await nodeAt(page))).json()) as ChatNode;
export async function reopenEdit(page: Page) {
  await page.reload();
  await cards(page).first().click();
  await expect(panel(page).locator('#editWorkspace')).toBeVisible();
}
