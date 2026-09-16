// H3 对参考图的要求：每边 256 到 5760 像素，每张不超过 30 MB
export const MAX_IMAGE_SIDE = 5760;
export const MIN_IMAGE_SIDE = 256;
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export type ResizePlan = { width: number; height: number; reason: 'too-large' | 'too-small' };

// 长边超过 5760 缩到 5760；短边不到 256 放大到 256；两条冲突时以不超过 5760 为准。不用改尺寸时返回 null
export function planResize(width: number, height: number): ResizePlan | null {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  let scale = 1;
  let reason: ResizePlan['reason'] = 'too-large';
  if (long > MAX_IMAGE_SIDE) {
    scale = MAX_IMAGE_SIDE / long;
  } else if (short < MIN_IMAGE_SIDE) {
    scale = Math.min(MIN_IMAGE_SIDE / short, MAX_IMAGE_SIDE / long);
    reason = 'too-small';
  }
  if (scale === 1) return null;
  const size = (side: number) => Math.max(1, Math.round(side * scale));
  return { width: size(width), height: size(height), reason };
}

// 处理完仍不在范围内的极端长条图，槽位上标红
export const imageSizeFits = (width: number, height: number) =>
  Math.max(width, height) <= MAX_IMAGE_SIDE && Math.min(width, height) >= MIN_IMAGE_SIDE;

export const needsJpeg = (bytes: number) => bytes > MAX_IMAGE_BYTES;

// 文件超过 30 MB 时转成 JPEG，质量从 90 开始每次降 5，直到不超过 30 MB
export const JPEG_QUALITIES = Array.from({ length: 18 }, (_, i) => 90 - i * 5);
