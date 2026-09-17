import type { CanvasImage } from '@media-agent/shared';

// 程序处理过这张图时，说清楚改了什么
export function processedNote(image: CanvasImage): string | null {
  const p = image.processed;
  if (!p) return null;
  if (p.reason === 'too-large') return `长边 ${Math.max(p.originalWidth, p.originalHeight)} 超过 5760，已缩到 ${image.width}×${image.height}`;
  if (p.reason === 'too-small') {
    const side = p.originalWidth === p.originalHeight ? '边长' : '短边';
    return `${side} ${Math.min(p.originalWidth, p.originalHeight)} 小于 256，已放大到 ${image.width}×${image.height}`;
  }
  return '文件超过 30 MB，已重新压缩';
}

// 上传时只能用程序存的那份：原文件没了，或者是从文件夹直接拖进来的（没有原路径）
export function copyOnlyNote(image: CanvasImage): string | null {
  if (image.originalMissing) return '原文件已经不在了，用的是程序存的那份';
  if (!image.originalPath) return '从文件夹直接拖进来的，用的是程序存的那份';
  return null;
}

// 文件名后缀大写，比如 HEIC
export const extensionOf = (name: string) => (name.split('.').pop() ?? '').toUpperCase();
