import { DEFAULT_IMAGE_LONG_SIDE } from '@media-agent/shared';
import { readConfig } from '../config';
import { readNode } from '../store/canvases';

// 发给模型的小图按节点所选模型配置的发图长边缩；不知道是哪个节点时用默认值
export async function imageLongSide(configDir: string, work: string, canvasId: string, nodeId: string | undefined): Promise<number> {
  if (nodeId === undefined) return DEFAULT_IMAGE_LONG_SIDE;
  const node = await readNode(work, canvasId, nodeId);
  return (await readConfig(configDir)).modelConfigs.find((m) => m.id === node.modelConfigId)?.imageLongSide ?? DEFAULT_IMAGE_LONG_SIDE;
}
