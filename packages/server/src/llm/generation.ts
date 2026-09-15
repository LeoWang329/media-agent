import { addMessage, ancestorsOf, composeMessages, parseReply, titleAfterReply, type ChatNode, type Message, type StreamEvent } from '@media-agent/shared';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../config';
import { HttpError } from '../httpError';
import { updateCanvas, updateNode } from '../store/canvases';
import { readFormatRequirement, snapshotPrompt } from '../store/prompts';
import { streamChatCompletion } from './chatStream';

const PERSIST_INTERVAL = 1000;

const running = new Map<string, AbortController>();

export function stopGeneration(nodeId: string): boolean {
  const controller = running.get(nodeId);
  controller?.abort();
  return Boolean(controller);
}

export type GenerationTarget = { configDir: string; work: string; canvasId: string; nodeId: string };

// prepare 在节点上加好这次的 user 消息（send、edit 才有），并说明回复挂在哪条 user 消息下面
export type Prepare = (node: ChatNode) => { node: ChatNode; userMessage?: Message; replyTo: Message };

export async function runGeneration(target: GenerationTarget, res: Response, prepare: Prepare): Promise<void> {
  const { configDir, work, canvasId, nodeId } = target;
  if (running.has(nodeId)) throw new HttpError(409, '这个节点正在生成回复，先停止或等它写完');
  const controller = new AbortController();
  running.set(nodeId, controller);

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

    try {
      const { modelConfigs } = await readConfig(configDir);
      const modelConfig = modelConfigs.find((m) => m.id === node.modelConfigId);
      if (!modelConfig) throw new Error('这个节点没有可用的模型配置，请在面板顶部选一个');
      const prompt = await snapshotPrompt(work, node.systemPromptName);
      const messages = composeMessages(ancestorsOf(node, assistant.parentId!), prompt.text, await readFormatRequirement());
      assistant = { ...assistant, modelName: modelConfig.model, systemPromptHash: prompt.hash };

      let lastPersist = Date.now();
      const { usage } = await streamChatCompletion({
        modelConfig,
        messages,
        signal: controller.signal,
        onDelta: (text) => {
          assistant = { ...assistant, text: assistant.text + text };
          send({ type: 'delta', text });
          if (Date.now() - lastPersist >= PERSIST_INTERVAL) {
            lastPersist = Date.now();
            persist(assistant).catch((err) => console.error('保存生成中的回复失败', err));
          }
        },
      });
      if (usage) assistant = { ...assistant, usage };
    } catch (err) {
      // 点了停止：保留已收到的部分，不算失败
      if (!controller.signal.aborted) assistant = { ...assistant, text: '', error: (err as Error).message };
    }

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
  }
}
