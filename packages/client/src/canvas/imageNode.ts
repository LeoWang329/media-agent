import { DEFAULT_IMAGE_SIZE, IMAGE_SIZES, type ChatNode, type PromptInfo } from '@media-agent/shared';
import { useCanvasStore } from '../store/canvasStore';

// 节点现在选的系统提示词：生图的带着系列；这套提示词已经不在了时是 undefined，当视频节点
export const usePromptInfo = (name: string): PromptInfo | undefined => useCanvasStore((s) => s.prompts.find((p) => p.name === name));

export const promptUse = (info: PromptInfo | undefined) => info?.use ?? 'video';

// 面板上的尺寸和张数：节点改过的用节点的，没改过的是默认的竖图 832×1216、4 张
export const imageSize = (node: ChatNode) => node.image ?? { ...DEFAULT_IMAGE_SIZE, count: 4 };

export const sizeText = (size: { width: number; height: number }) => `${size.width}×${size.height}`;

// 尺寸下拉框分三组：正方形、竖的、横的
export const SIZE_GROUPS = [
  { label: '正方形', sizes: IMAGE_SIZES.filter((s) => s.width === s.height) },
  { label: '竖', sizes: IMAGE_SIZES.filter((s) => s.width < s.height) },
  { label: '横', sizes: IMAGE_SIZES.filter((s) => s.width > s.height) },
];
