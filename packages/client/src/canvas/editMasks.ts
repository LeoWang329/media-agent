import type { ChatNode } from '@media-agent/shared';
import { imageFileUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { toast } from '../ui/toast';
import { maskIsEmpty, maskPng } from './MaskEditor';

export async function drawnMask(node: ChatNode, imageId: string | undefined): Promise<string | null> {
  const mask = node.edit?.maskShapes;
  if (!imageId || !mask || mask.imageId !== imageId || maskIsEmpty(mask)) {
    toast('请为当前原图绘制有效掩码', { tone: 'warn' });
    return null;
  }
  return maskPng(imageFileUrl(useCanvasStore.getState().canvasId!, imageId), mask);
}
