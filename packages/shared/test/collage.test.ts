import { describe, expect, it } from 'vitest';
import { centerIn, collageFileName, collageLayout, fitInside, isCollageGrid } from '../src';

describe('collageLayout', () => {
  it('2×2、边长 1024：整张 2048×2048，四个格子按行排', () => {
    const layout = collageLayout(2, 2, 1024, false);
    expect(layout).toMatchObject({ width: 2048, height: 2048, badges: [] });
    expect(layout.cells).toEqual([
      { left: 0, top: 0, width: 1024, height: 1024 },
      { left: 1024, top: 0, width: 1024, height: 1024 },
      { left: 0, top: 1024, width: 1024, height: 1024 },
      { left: 1024, top: 1024, width: 1024, height: 1024 },
    ]);
  });

  it('行列不一样时，宽是列数乘边长、高是行数乘边长', () => {
    expect(collageLayout(3, 2, 1536, false)).toMatchObject({ width: 3072, height: 4608 });
    expect(collageLayout(1, 3, 1024, false)).toMatchObject({ width: 3072, height: 1024 });
  });

  it('开编号：每格左上角一个小框，字高是格子边长的 5%，编号从 1 开始', () => {
    const { badges } = collageLayout(2, 2, 1024, true);
    expect(badges).toHaveLength(4);
    expect(badges[0]).toMatchObject({ left: 20, top: 20, fontSize: 51, number: 1 });
    expect(badges[1]).toMatchObject({ left: 1044, top: 20, number: 2 });
    expect(badges[3]).toMatchObject({ left: 1044, top: 1044, number: 4 });
    expect(badges[0].width).toBe(badges[0].height);
    expect(collageLayout(2, 2, 1536, true).badges[0]).toMatchObject({ left: 31, top: 31, fontSize: 77 });
  });
});

describe('fitInside 和 centerIn', () => {
  it('按长边等比缩放，比格子小的放大', () => {
    expect(fitInside(800, 600, 1024)).toEqual({ width: 1024, height: 768 });
    expect(fitInside(600, 800, 1024)).toEqual({ width: 768, height: 1024 });
    expect(fitInside(1024, 1024, 1024)).toEqual({ width: 1024, height: 1024 });
    expect(fitInside(200, 150, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it('短的那边居中，空出来的地方留白', () => {
    const [first, second] = collageLayout(1, 2, 1024, false).cells;
    expect(centerIn(first, { width: 1024, height: 768 })).toEqual({ left: 0, top: 128 });
    expect(centerIn(second, { width: 768, height: 1024 })).toEqual({ left: 1152, top: 0 });
  });
});

describe('isCollageGrid', () => {
  it('行列各 1 到 3，1×1 不算拼图', () => {
    expect(isCollageGrid(2, 2)).toBe(true);
    expect(isCollageGrid(1, 2)).toBe(true);
    expect(isCollageGrid(3, 3)).toBe(true);
    expect(isCollageGrid(1, 1)).toBe(false);
    expect(isCollageGrid(0, 2)).toBe(false);
    expect(isCollageGrid(2, 4)).toBe(false);
    expect(isCollageGrid(2.5, 2)).toBe(false);
  });
});

describe('collageFileName', () => {
  it('按本机时间命名', () => {
    expect(collageFileName(new Date(2026, 8, 16, 9, 5, 3))).toBe('collage-20260916-090503.jpg');
  });
});
