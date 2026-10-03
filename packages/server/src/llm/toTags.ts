import { familyWords, splitTags, thinkingLevelFor, type TagConvertResult } from '@media-agent/shared';
import { readConfig } from '../config';
import { imageFamily } from '../comfy/jobs';
import { HttpError } from '../httpError';
import { readNode } from '../store/canvases';
import { readToTagsInstructions } from '../store/prompts';
import { readSettings } from '../store/settings';
import { loadLibrary } from '../tags/library';
import { checkTag } from '../tags/search';
import { streamChatCompletion } from './chatStream';

export type ToTagsTarget = { configDir: string; work: string; canvasId: string; nodeId: string };

// 标签编辑窗里打的中文让模型转成标签：用节点现在选的模型配置问一次，不带对话历史和图，思考按「转标签」那档。
// 回来的标签按节点的系列校验，见 docs/dev-plan.md 5.15
export async function convertToTags({ configDir, work, canvasId, nodeId }: ToTagsTarget, text: string): Promise<TagConvertResult> {
  const node = await readNode(work, canvasId, nodeId);
  const family = await imageFamily(work, node.systemPromptName);
  const modelConfig = (await readConfig(configDir)).modelConfigs.find((m) => m.id === node.modelConfigId);
  if (!modelConfig) throw new HttpError(400, '这个节点没有可用的模型配置，请在面板顶部选一个');
  const settings = await readSettings(work);

  let reply = '';
  await streamChatCompletion({
    modelConfig,
    messages: [
      { role: 'system', content: await readToTagsInstructions() },
      { role: 'user', content: text },
    ],
    thinking: thinkingLevelFor(settings.thinking, 'tagging'),
    onDelta: (delta) => {
      reply += delta;
    },
  });
  const tags = reply.trim();
  const library = await loadLibrary(work);
  const known = familyWords(settings.defaults[family]);
  return { text: tags, checks: splitTags(tags).map((item) => checkTag(library, item.name, known)) };
}
