import express from 'express';
import { planReply, toParts, type ChatMessage } from './reply';

const MODEL_ID = 'mock-model';

export function createMockLlmApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  // 含「报错」的文字只失败一次，同样的文字再请求就正常回复，用来测重试
  const failedTexts = new Set<string>();

  app.get('/v1/models', (_req, res) => {
    res.json({ object: 'list', data: [{ id: MODEL_ID, object: 'model', created: 0, owned_by: 'mock-llm' }] });
  });

  app.post('/v1/chat/completions', (req, res) => {
    const messages: ChatMessage[] = req.body?.messages ?? [];
    const { reply, userText, fail, slow } = planReply(messages);
    if (fail && !failedTexts.has(userText)) {
      failedTexts.add(userText);
      res.status(500).json({ error: { message: 'mock-llm：用户文字含「报错」，按约定返回 500', type: 'server_error' } });
      return;
    }

    const id = `mock-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = req.body?.model ?? MODEL_ID;
    const completionTokens = Array.from(reply).length;
    const promptTokens = countPromptTokens(messages);
    const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };

    if (!req.body?.stream) {
      res.json({
        id, object: 'chat.completion', created, model, usage,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      });
      return;
    }

    // 普通：每 20 个字一段、间隔 10 毫秒；含「慢」：分 12 段、间隔 500 毫秒，共 6 秒
    const chunks = slow ? splitInto(reply, 12) : splitEvery(reply, 20);
    const interval = slow ? 500 : 10;
    const send = (data: object) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, ...data })}\n\n`);
    let index = 0;
    let timer: NodeJS.Timeout | undefined;
    const tick = () => {
      send({ choices: [{ index: 0, delta: index === 0 ? { role: 'assistant', content: chunks[index] } : { content: chunks[index] }, finish_reason: null }] });
      index += 1;
      if (index < chunks.length) {
        timer = setTimeout(tick, interval);
        return;
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      send({ choices: [], usage });
      res.end('data: [DONE]\n\n');
    };

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.on('close', () => clearTimeout(timer));
    timer = setTimeout(tick, interval);
  });

  return app;
}

function splitEvery(text: string, size: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += size) chunks.push(chars.slice(i, i + size).join(''));
  return chunks;
}

function splitInto(text: string, count: number): string[] {
  const chars = Array.from(text);
  const at = (i: number) => Math.round((i * chars.length) / count);
  return Array.from({ length: count }, (_, i) => chars.slice(at(i), at(i + 1)).join(''));
}

function countPromptTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (sum, m) => sum + toParts(m.content).reduce((s, p) => s + (p.type === 'text' ? Array.from(p.text).length : 100), 0),
    0,
  );
}
