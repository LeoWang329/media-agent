import type { ChatCompletionMessage, Message, ModelConfigWithKey } from '@media-agent/shared';

type Options = {
  modelConfig: ModelConfigWithKey;
  messages: ChatCompletionMessage[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
};

// 调 OpenAI 兼容的 /chat/completions，流式读 data: 行
export async function streamChatCompletion({ modelConfig, messages, signal, onDelta }: Options): Promise<{ usage?: Message['usage'] }> {
  const res = await fetch(`${modelConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(modelConfig.apiKey ? { Authorization: `Bearer ${modelConfig.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: modelConfig.model, messages, stream: true, stream_options: { include_usage: true } }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}：${(await res.text()).slice(0, 500)}`);

  let usage: Message['usage'];
  let buffer = '';
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return { usage };
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        await reader.cancel();
        return { usage };
      }
      const chunk = JSON.parse(data);
      if (chunk.error) throw new Error(`接口返回错误：${JSON.stringify(chunk.error).slice(0, 500)}`);
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) onDelta(text);
      if (chunk.usage) usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens };
    }
  }
}
