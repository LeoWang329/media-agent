import type { ModelConfigWithKey } from '@media-agent/shared';

export type TestConnectionResult = { ok: boolean; error?: string };

// 发一条极短的流式请求，收到响应头就断开：地址、key、模型名哪个填错都能查出来，又几乎不耗 token
export async function testConnection(modelConfig: ModelConfigWithKey): Promise<TestConnectionResult> {
  try {
    const res = await fetch(`${modelConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(modelConfig.apiKey ? { Authorization: `Bearer ${modelConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: modelConfig.model, stream: true, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}：${(await res.text()).slice(0, 500)}` };
    await res.body?.cancel();
    return { ok: true };
  } catch (err) {
    const { message, cause } = err as Error & { cause?: { message?: string } };
    return { ok: false, error: cause?.message ? `${message}（${cause.message}）` : message };
  }
}
