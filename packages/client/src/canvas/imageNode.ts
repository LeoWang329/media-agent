import { DEFAULT_IMAGE_SIZE, IMAGE_SIZES, KREA2_SIZES, KREA2_TEXT_SIZE, imageSettingsOf, type ChatNode, type ComfyOptions, type Family, type ImageSettings, type PromptInfo } from '@media-agent/shared';
import { useCanvasStore } from '../store/canvasStore';

// 节点现在选的系统提示词：生图的带着系列；这套提示词已经不在了时是 undefined
export const usePromptInfo = (name: string): PromptInfo | undefined => useCanvasStore((s) => s.prompts.find((p) => p.name === name));

// 面板上的尺寸和张数：节点改过的用节点的，没改过的是默认的竖图 832×1216、4 张
export const imageSize = (node: ChatNode) => node.image ?? (useCanvasStore.getState().prompts.find((p) => p.name === node.systemPromptName)?.family === 'Krea2' ? { ...KREA2_TEXT_SIZE, count: 1 } : { ...DEFAULT_IMAGE_SIZE, count: 4 });

// 节点的出图设置：改过的用节点自己的，没改过的（包括后来加的项）按系列的默认值，和服务端一样
export function useImageSettings(node: ChatNode, family: Family): ImageSettings {
  const defaults = useCanvasStore((s) => s.defaults[family]);
  return imageSettingsOf(node.image, defaults, family);
}

// 出图用哪个底模：节点选过的；没选过的用这台 ComfyUI 上这个系列的第一个，和服务端一样
export const effectiveCheckpoint = (image: ImageSettings, family: Family, options: ComfyOptions | null) =>
  image.checkpoint || (family === 'Krea2' ? options?.kreaModels[0] : options?.checkpoints.find((c) => c.family === family)?.name) || '';

// 底模文件名去掉 .safetensors
export const shortCheckpoint = (name: string) => name.replace(/\.safetensors$/, '');

export const sizeText = (size: { width: number; height: number }) => `${size.width}×${size.height}`;

// 尺寸下拉框分三组：正方形、竖的、横的
export const SIZE_GROUPS = [
  { label: '正方形', sizes: IMAGE_SIZES.filter((s) => s.width === s.height) },
  { label: '竖', sizes: IMAGE_SIZES.filter((s) => s.width < s.height) },
  { label: '横', sizes: IMAGE_SIZES.filter((s) => s.width > s.height) },
];

export const KREA2_SIZE_GROUPS = [
  { label: '正方形', sizes: KREA2_SIZES.filter((s) => s.width === s.height) },
  { label: '竖', sizes: KREA2_SIZES.filter((s) => s.width < s.height) },
  { label: '横', sizes: KREA2_SIZES.filter((s) => s.width > s.height) },
];
