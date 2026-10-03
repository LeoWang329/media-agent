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
    const plan = planReply(messages);
    const { userText, fail, slow } = plan;
    // 带了思考参数：正文最后一行写出收到的参数，测试靠它断言程序发了什么；参数表示开着思考时，正文前先发思考原文
    const thinking = thinkingParams(req.body ?? {});
    const reply = thinking ? `${plan.reply}\n思考参数：${JSON.stringify(thinking.params)}` : plan.reply;
    const reasoning = thinking?.on ? ['思考：先弄清', '用户要什么，', '再按要求的', '格式写出来。'] : [];
    if (fail && !failedTexts.has(userText)) {
      failedTexts.add(userText);
      res.status(500).json({ error: { message: 'mock-llm：用户文字含「报错」，按约定返回 500', type: 'server_error' } });
      return;
    }

    const id = `mock-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = req.body?.model ?? MODEL_ID;
    const completionTokens = Array.from(reasoning.join('') + reply).length;
    const promptTokens = countPromptTokens(messages);
    const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };

    if (!req.body?.stream) {
      const message = { role: 'assistant', content: reply, ...(reasoning.length && { reasoning_content: reasoning.join('') }) };
      res.json({ id, object: 'chat.completion', created, model, usage, choices: [{ index: 0, message, finish_reason: 'stop' }] });
      return;
    }

    // 思考原文分 4 段、间隔 250 毫秒，共 1 秒；正文普通的每 20 个字一段、间隔 10 毫秒，含「慢」的分 12 段、间隔 500 毫秒，共 6 秒
    const steps = [
      ...reasoning.map((text) => ({ delta: { reasoning_content: text }, wait: 250 })),
      ...(slow ? splitInto(reply, 12) : splitEvery(reply, 20)).map((text) => ({ delta: { content: text }, wait: slow ? 500 : 10 })),
    ];
    const send = (data: object) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, ...data })}\n\n`);
    let index = 0;
    let timer: NodeJS.Timeout | undefined;
    const tick = () => {
      const delta = index === 0 ? { role: 'assistant', ...steps[index].delta } : steps[index].delta;
      send({ choices: [{ index: 0, delta, finish_reason: null }] });
      index += 1;
      if (index < steps.length) {
        timer = setTimeout(tick, steps[index].wait);
        return;
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      send({ choices: [], usage });
      res.end('data: [DONE]\n\n');
    };

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.on('close', () => clearTimeout(timer));
    timer = setTimeout(tick, steps[0].wait);
  });

  return app;
}

// 请求里的思考参数，见 docs/dev-plan.md 5.12；on 是这些参数让模型思考了
function thinkingParams(body: Record<string, unknown>): { params: Record<string, unknown>; on: boolean } | null {
  const params: Record<string, unknown> = {};
  for (const key of ['reasoning_effort', 'enable_thinking', 'thinking_budget', 'thinking']) {
    if (key in body) params[key] = body[key];
  }
  const model = typeof body.model === 'string' ? body.model : '';
  if (model.endsWith('reasoner')) params.model = model;
  if (!Object.keys(params).length) return null;
  const on =
    'reasoning_effort' in params ||
    params.enable_thinking === true ||
    (params.thinking as { type?: string } | undefined)?.type === 'enabled' ||
    'model' in params;
  return { params, on };
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
