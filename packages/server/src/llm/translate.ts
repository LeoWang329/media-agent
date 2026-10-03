import {
  parseReply,
  thinkingLevelFor,
  thinkingRequest,
  translateMessages,
  withTranslation,
  type PromptTranslation,
  type TranslateLanguage,
} from '@media-agent/shared';
import { readConfig } from '../config';
import { HttpError } from '../httpError';
import { readNode, updateNode } from '../store/canvases';
import { readTranslateInstructions } from '../store/prompts';
import { readSettings } from '../store/settings';
import { streamChatCompletion } from './chatStream';

export type TranslateTarget = { configDir: string; work: string; canvasId: string; nodeId: string; messageId: string; promptIndex: number };

// 翻译一个提示词框：用节点现在选的模型配置问一次，不带对话历史和图；译文存进那条回复，返回这份译文
export async function translatePrompt(target: TranslateTarget, language: TranslateLanguage, instruction: string): Promise<PromptTranslation> {
  const { configDir, work, canvasId, nodeId, messageId, promptIndex } = target;
  const node = await readNode(work, canvasId, nodeId);
  const message = node.messages[messageId];
  if (message?.role !== 'assistant') throw new HttpError(404, '找不到这条回复');
  const box = parseReply(message.text).prompts[promptIndex];
  if (!box) throw new HttpError(404, `这条回复里没有第 ${promptIndex + 1} 个提示词框`);
  const modelConfig = (await readConfig(configDir)).modelConfigs.find((m) => m.id === node.modelConfigId);
  if (!modelConfig) throw new HttpError(400, '这个节点没有可用的模型配置，请在面板顶部选一个');

  let text = '';
  const level = thinkingLevelFor((await readSettings(work)).thinking, 'translate');
  const { usage } = await streamChatCompletion({
    modelConfig,
    messages: translateMessages(await readTranslateInstructions(), language, instruction, box.text),
    thinking: level,
    onDelta: (delta) => {
      text += delta;
    },
  });
  const translation: PromptTranslation = {
    promptIndex,
    language,
    instruction: instruction.trim(),
    text: text.trim(),
    createdAt: new Date().toISOString(),
    modelConfigId: modelConfig.id,
    modelName: thinkingRequest(modelConfig, level).model,
    ...(usage && { usage }),
  };
  await updateNode(work, canvasId, nodeId, (current) => {
    const latest = current.messages[messageId];
    if (!latest) throw new HttpError(404, '找不到这条回复');
    return { ...current, messages: { ...current.messages, [messageId]: withTranslation(latest, translation) } };
  });
  return translation;
}
