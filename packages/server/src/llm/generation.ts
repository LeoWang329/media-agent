import {
  addMessage,
  ancestorsOf,
  composeMessages,
  effectiveTurnLimit,
  parsePromptMeta,
  parseReply,
  recentTurns,
  thinkingLevelFor,
  thinkingOn,
  thinkingRequest,
  titleAfterReply,
  type ChatNode,
  type Message,
  type StreamEvent,
} from '@media-agent/shared';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../config';
import { HttpError } from '../httpError';
import { updateCanvas, updateNode } from '../store/canvases';
import { llmImageUrls } from '../store/images';
import { readFormatRequirement, snapshotPrompt } from '../store/prompts';
import { readSettings } from '../store/settings';
import { streamChatCompletion } from './chatStream';

const PERSIST_INTERVAL = 1000;

// done：这次生成连同收尾的落盘全部做完
const running = new Map<string, { controller: AbortController; done: Promise<void> }>();

export const isGenerating = (nodeId: string) => running.has(nodeId);

export function stopGeneration(nodeId: string): boolean {
  const run = running.get(nodeId);
  run?.controller.abort();
  return Boolean(run);
}

// 叫停这些节点的生成，等它们把已经写出来的部分存完
export async function stopGenerations(nodeIds: string[]): Promise<void> {
  await Promise.all(nodeIds.map((id) => (stopGeneration(id) ? running.get(id)?.done : undefined)));
}

export type GenerationTarget = { configDir: string; work: string; canvasId: string; nodeId: string };

// prepare 在节点上加好这次的 user 消息（send、edit 才有），并说明回复挂在哪条 user 消息下面
export type Prepare = (node: ChatNode) => { node: ChatNode; userMessage?: Message; replyTo: Message };

export async function runGeneration(target: GenerationTarget, res: Response, prepare: Prepare): Promise<void> {
  const { configDir, work, canvasId, nodeId } = target;
  if (running.has(nodeId)) throw new HttpError(409, '这个节点正在生成回复，先停止或等它写完');
  const controller = new AbortController();
  let finish!: () => void;
  running.set(nodeId, { controller, done: new Promise((resolve) => (finish = resolve)) });

  try {
    let userMessage: Message | undefined;
    let assistant!: Message;
    const node = await updateNode(work, canvasId, nodeId, (current) => {
      const prepared = prepare(current);
      userMessage = prepared.userMessage;
      const { replyTo } = prepared;
      assistant = {
        id: randomUUID(),
        parentId: replyTo.id,
        role: 'assistant',
        createdAt: new Date().toISOString(),
        text: '',
        slotSnapshot: [...replyTo.slotSnapshot],
        duration: replyTo.duration,
        aspectRatio: replyTo.aspectRatio,
        modelConfigId: current.modelConfigId,
        systemPromptName: current.systemPromptName,
      };
      return addMessage(prepared.node, assistant);
    });

    // 从这里开始是 SSE，出错也只能通过事件告诉前端
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (event: StreamEvent) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    if (userMessage) send({ type: 'user', message: userMessage });
    send({ type: 'assistant-start', message: assistant });

    // 节点在生成中途被删掉时，不再把它写回来
    const persist = (message: Message, updateTitle = false) =>
      updateNode(work, canvasId, nodeId, (current) => ({
        ...current,
        ...(updateTitle && { title: titleAfterReply(current, message) }),
        messages: { ...current.messages, [message.id]: message },
      })).then(
        () => undefined,
        (err) => {
          if (!(err instanceof HttpError && err.status === 404)) throw err;
        },
      );

    // 思考计时：从发出请求到收到第一个正文字
    let clock: { on: boolean; started: number; firstText?: number } | undefined;
    try {
      const { modelConfigs } = await readConfig(configDir);
      const modelConfig = modelConfigs.find((m) => m.id === node.modelConfigId);
      if (!modelConfig) throw new Error('这个节点没有可用的模型配置，请在面板顶部选一个');
      const prompt = await snapshotPrompt(work, node.systemPromptName);
      // 开头的说明段不发给模型；生图节点接生图的格式要求
      const meta = parsePromptMeta(prompt.text);
      const settings = await readSettings(work);
      // 设了只带最近几轮的，更前面的不发，见 docs/dev-plan.md 5.4
      const { path, kept, dropped } = recentTurns(ancestorsOf(node, assistant.parentId!), effectiveTurnLimit(node, settings), node.kind);
      const messages = composeMessages(path, meta.body, await readFormatRequirement(node.kind), await llmImageUrls(work, canvasId, path));
      const level = thinkingLevelFor(settings.thinking, 'chat');
      assistant = {
        ...assistant,
        modelName: thinkingRequest(modelConfig, level).model,
        systemPromptHash: prompt.hash,
        ...(dropped > 0 && { trimmed: { kept, dropped } }),
      };

      let lastPersist = Date.now();
      const persistSoon = () => {
        if (Date.now() - lastPersist < PERSIST_INTERVAL) return;
        lastPersist = Date.now();
        persist(assistant).catch((err) => console.error('保存生成中的回复失败', err));
      };
      const timing: { on: boolean; started: number; firstText?: number } = { on: thinkingOn(modelConfig, level), started: Date.now() };
      clock = timing;
      const { usage } = await streamChatCompletion({
        modelConfig,
        messages,
        thinking: level,
        signal: controller.signal,
        onDelta: (text) => {
          timing.firstText ??= Date.now();
          assistant = { ...assistant, text: assistant.text + text };
          send({ type: 'delta', text });
          persistSoon();
        },
        onReasoning: (text) => {
          assistant = { ...assistant, reasoning: (assistant.reasoning ?? '') + text };
          send({ type: 'reasoning', text });
          persistSoon();
        },
      });
      if (usage) assistant = { ...assistant, usage };
    } catch (err) {
      // 点了停止：保留已收到的部分，不算失败，记一下是叫停的
      if (controller.signal.aborted) assistant = { ...assistant, stopped: true };
      else assistant = { ...assistant, text: '', error: (err as Error).message };
    }
    if (clock && (clock.on || assistant.reasoning)) assistant = { ...assistant, thinkingMs: (clock.firstText ?? Date.now()) - clock.started };

    try {
      if (assistant.error) {
        await persist(assistant);
        send({ type: 'error', message: assistant });
      } else {
        const { title, prompts } = parseReply(assistant.text);
        assistant = { ...assistant, parsed: { ...(title !== undefined && { title }), prompts } };
        await persist(assistant, true);
        send({ type: 'done', message: assistant });
      }
      await updateCanvas(work, canvasId, () => {}).catch(() => {});
    } catch (err) {
      send({ type: 'error', message: { ...assistant, error: `保存回复失败：${(err as Error).message}` } });
    }
    res.end();
  } finally {
    running.delete(nodeId);
    finish();
  }
}
