import type { ComfyGraph } from '@media-agent/shared';

// 调 ComfyUI 自带的接口，见 docs/dev-plan.md 5.17、5.19。出错时 message 直接给用户看，带上原话

export class ComfyError extends Error {}

export type ImageRef = { filename: string; subfolder: string; type: string };
export type HistoryEntry = {
  outputs?: Record<string, { images?: ImageRef[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
};
export type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>;
type SystemStats = {
  system?: { comfyui_version?: string };
  devices?: { name?: string; vram_total?: number; vram_free?: number }[];
};

async function call(url: string, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  try {
    return await fetch(`${url}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const { message, cause } = err as Error & { cause?: Error };
    throw new ComfyError(`连不上 ComfyUI（${url}）：地址不对，或者 ComfyUI 没开。原话：${cause?.message ?? message}`);
  }
}

async function json<T>(url: string, path: string, timeoutMs?: number): Promise<T> {
  const res = await call(url, path, {}, timeoutMs);
  if (!res.ok) throw new ComfyError(`ComfyUI 返回 ${res.status}：${(await res.text()).slice(0, 500)}`);
  return (await res.json()) as T;
}

async function post(url: string, path: string, body: unknown): Promise<Response> {
  const res = await call(url, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new ComfyError(`ComfyUI 返回 ${res.status}：${(await res.text()).slice(0, 500)}`);
  return res;
}

// 测试连接和顶上的状态用，等久了界面上一直转圈，10 秒没回来就算连不上
export const systemStats = (url: string) => json<SystemStats>(url, '/system_stats', 10_000);

// 装的插件多时 object_info 有好几 MB
export const objectInfo = (url: string) => json<ObjectInfo>(url, '/object_info', 120_000);

// 发一个任务，返回 prompt_id；ComfyUI 不收时写出是哪个节点哪一项
export async function queuePrompt(url: string, graph: ComfyGraph, clientId: string): Promise<string> {
  const res = await call(url, '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  });
  const text = await res.text();
  let body: { prompt_id?: string; error?: { message?: string; details?: string }; node_errors?: Record<string, NodeError> } = {};
  try {
    body = JSON.parse(text);
  } catch {
    // 不是 JSON 的返回原样报出去
  }
  if (res.ok && body.prompt_id) return body.prompt_id;
  throw new ComfyError(`ComfyUI 不收这个任务：${describeRejection(body) || `${res.status} ${text.slice(0, 500)}`}`);
}

type NodeError = { class_type?: string; errors?: { message?: string; details?: string }[] };

function describeRejection(body: { error?: { message?: string; details?: string }; node_errors?: Record<string, NodeError> }): string {
  const nodes = Object.entries(body.node_errors ?? {});
  if (nodes.length) {
    return nodes
      .map(([id, node]) => `${node.class_type ?? '节点'}（${id} 号节点）${(node.errors ?? []).map((e) => e.details || e.message).join('；')}`)
      .join('；');
  }
  return [body.error?.message, body.error?.details].filter(Boolean).join(' ');
}

// 执行时出的错：有 out of memory 的说显存不够
export function describeExecutionError(data: Record<string, unknown>): string {
  const text = String(data.exception_message ?? '').trim();
  return /out of memory/i.test(text) ? `显存不够：${text}` : `出图出错（${String(data.node_type ?? '')}）：${text}`;
}

// 还没出完或者 ComfyUI 不认识这个 id 时是 null
export async function history(url: string, promptId: string): Promise<HistoryEntry | null> {
  const body = await json<Record<string, HistoryEntry>>(url, `/history/${encodeURIComponent(promptId)}`);
  return body[promptId] ?? null;
}

export async function viewImage(url: string, ref: ImageRef): Promise<Buffer> {
  const query = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type });
  const res = await call(url, `/view?${query}`, {}, 120_000);
  if (!res.ok) throw new ComfyError(`取图失败：ComfyUI 返回 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// 队列里正在跑的和排着的，按排队先后
export async function queueState(url: string): Promise<{ running: string[]; pending: string[] }> {
  const body = await json<{ queue_running?: [number, string][]; queue_pending?: [number, string][] }>(url, '/queue');
  const ids = (rows: [number, string][] = []) => [...rows].sort((a, b) => a[0] - b[0]).map((row) => row[1]);
  return { running: ids(body.queue_running), pending: ids(body.queue_pending) };
}

export async function deleteQueued(url: string, promptIds: string[]): Promise<void> {
  if (promptIds.length) await post(url, '/queue', { delete: promptIds });
}

// 新版 ComfyUI 带了 prompt_id 只停这一个；老版本不认，会停掉当前正在跑的任何任务
export async function interrupt(url: string, promptId: string): Promise<void> {
  await post(url, '/interrupt', { prompt_id: promptId });
}
