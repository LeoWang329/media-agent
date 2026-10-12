import type { StreamEvent } from '@media-agent/shared';

// 出错时 message 是服务端给的原因，status 是 HTTP 状态码
export type ApiError = Error & { status: number };

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `请求失败（HTTP ${res.status}）`), { status: res.status });
  return data as T;
}

// 从 Windows 文件夹拖进来的图：没有本机路径，把内容直接传上去
export async function uploadImage<T>(canvasId: string, nodeId: string, file: File): Promise<T> {
  const query = new URLSearchParams({ name: file.name, nodeId });
  const res = await fetch(`/api/canvases/${canvasId}/images/upload?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `请求失败（HTTP ${res.status}）`);
  return data as T;
}

// 从文件夹拖进来的视频、音频：内容直接传上去，多长、宽高、有没有声音是浏览器读好的
export async function uploadMedia<T>(canvasId: string, file: File, meta: { seconds: number; width?: number; height?: number; hasAudio?: boolean }): Promise<T> {
  const query = new URLSearchParams({ name: file.name, seconds: String(meta.seconds) });
  if (meta.width && meta.height) {
    query.set('width', String(meta.width));
    query.set('height', String(meta.height));
  }
  if (meta.hasAudio !== undefined) query.set('hasAudio', String(meta.hasAudio));
  const res = await fetch(`/api/canvases/${canvasId}/media/upload?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `请求失败（HTTP ${res.status}）`);
  return data as T;
}

// 从文件夹拖进来的「续写起点」前一段视频：只把内容传上去，不读时长宽高（浏览器不一定读得出来），
// 规整成出片大小是在生成视频那台上做的，见 docs/dev-plan.md 5.35
export async function uploadLead<T>(canvasId: string, file: File): Promise<T> {
  const res = await fetch(`/api/canvases/${canvasId}/leads/upload?${new URLSearchParams({ name: file.name })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `请求失败（HTTP ${res.status}）`);
  return data as T;
}

// 发送、重新生成、编辑、更新词库都返回 SSE，一边收一边回调
export async function postStream<E = StreamEvent>(path: string, body: unknown, onEvent: (event: E) => void): Promise<void> {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `请求失败（HTTP ${res.status}）`);
  }
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (block.startsWith('data: ')) onEvent(JSON.parse(block.slice(6)));
    }
  }
}

export const promptUrl = (name: string) => `/prompts/${encodeURIComponent(name)}`;

export const assetThumbUrl = (path: string, mtime: number) => `/api/assets/thumb?${new URLSearchParams({ path, v: String(mtime) })}`;

export const imageThumbUrl = (canvasId: string, imageId: string) => `/api/canvases/${canvasId}/images/${imageId}/thumb`;

export const imageFileUrl = (canvasId: string, imageId: string) => `/api/canvases/${canvasId}/images/${imageId}/file`;

// 视频和音频：画布里存的那份、资产库里的原文件
export const mediaFileUrl = (canvasId: string, mediaId: string) => `/api/canvases/${canvasId}/media/${mediaId}/file`;
export const leadFileUrl = (canvasId: string, leadId: string) => `/api/canvases/${canvasId}/leads/${leadId}/file`;
export const assetFileUrl = (path: string, mtime: number) => `/api/assets/file?${new URLSearchParams({ path, v: String(mtime) })}`;

// 拖拽时放在 dataTransfer 里的数据类型：资产库的图（路径列表）、槽位之间调顺序（槽位下标）、拼图格子之间调顺序（格子下标）
export const ASSET_DRAG_TYPE = 'application/x-media-agent-assets';
export const SLOT_DRAG_TYPE = 'application/x-media-agent-slot';
export const COLLAGE_DRAG_TYPE = 'application/x-media-agent-collage';
