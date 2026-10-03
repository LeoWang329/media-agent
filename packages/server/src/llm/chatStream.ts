import { thinkingRequest, type ChatCompletionMessage, type Message, type ModelConfigWithKey, type ThinkingLevel } from '@media-agent/shared';

type Options = {
  modelConfig: ModelConfigWithKey;
  messages: ChatCompletionMessage[];
  thinking?: ThinkingLevel; // 不给就不带思考参数
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void;
};

// 调 OpenAI 兼容的 /chat/completions，流式读 data: 行
export async function streamChatCompletion({ modelConfig, messages, thinking, signal, onDelta, onReasoning }: Options): Promise<{ usage?: Message['usage'] }> {
  const { model, params } = thinking ? thinkingRequest(modelConfig, thinking) : { model: modelConfig.model, params: {} };
  const res = await fetch(`${modelConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(modelConfig.apiKey ? { Authorization: `Bearer ${modelConfig.apiKey}` } : {}),
    },
    body: JSON.stringify({ ...params, model, messages, stream: true, stream_options: { include_usage: true } }),
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
      const delta = chunk.choices?.[0]?.delta;
      // 思考原文：DeepSeek、通义放在 reasoning_content，有的转发平台叫 reasoning
      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (typeof reasoning === 'string' && reasoning) onReasoning?.(reasoning);
      const text = delta?.content;
      if (text) onDelta(text);
      if (chunk.usage) {
        // 命中缓存的输入 tokens：OpenAI 这类放在 prompt_tokens_details.cached_tokens，DeepSeek 放在 prompt_cache_hit_tokens
        const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? chunk.usage.prompt_cache_hit_tokens;
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          ...(typeof cachedTokens === 'number' && cachedTokens > 0 ? { cachedTokens } : {}),
        };
      }
    }
  }
}
