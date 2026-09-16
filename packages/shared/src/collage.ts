// 拼图：把几张图拼成一张宫格大图，每格正方形，图完整放进格子，空白补白色
export const COLLAGE_CELL_SIZES = [1024, 1536];
export const DEFAULT_COLLAGE_CELL = 1024;
export const COLLAGE_MAX_GRID = 3;
export const COLLAGE_JPEG_QUALITY = 92;

// 编号小框：字高约格子边长的 5%，离格子左上角 2%
const BADGE_FONT = 0.05;
const BADGE_MARGIN = 0.02;

export type CollageBox = { left: number; top: number; width: number; height: number };
export type CollageBadge = CollageBox & { radius: number; fontSize: number; number: number };
export type CollageLayout = { width: number; height: number; cells: CollageBox[]; badges: CollageBadge[] };

// 行数和列数各 1 到 3，1×1 不算拼图
export const isCollageGrid = (rows: number, columns: number) =>
  [rows, columns].every((n) => Number.isInteger(n) && n >= 1 && n <= COLLAGE_MAX_GRID) && rows * columns > 1;

export function collageLayout(rows: number, columns: number, cell: number, numbers: boolean): CollageLayout {
  const cells: CollageBox[] = Array.from({ length: rows * columns }, (_, i) => ({
    left: (i % columns) * cell,
    top: Math.floor(i / columns) * cell,
    width: cell,
    height: cell,
  }));
  const fontSize = Math.round(cell * BADGE_FONT);
  const margin = Math.round(cell * BADGE_MARGIN);
  const side = Math.round(fontSize * 1.6);
  const badges = numbers
    ? cells.map((box, i) => ({
        left: box.left + margin,
        top: box.top + margin,
        width: side,
        height: side,
        radius: Math.round(side * 0.25),
        fontSize,
        number: i + 1,
      }))
    : [];
  return { width: columns * cell, height: rows * cell, cells, badges };
}

// 等比缩放到刚好放进格子；比格子小的放大到贴边
export function fitInside(width: number, height: number, cell: number): { width: number; height: number } {
  const scale = cell / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// 放进格子后居中，左上角坐标
export const centerIn = (box: CollageBox, size: { width: number; height: number }) => ({
  left: box.left + Math.round((box.width - size.width) / 2),
  top: box.top + Math.round((box.height - size.height) / 2),
});

const two = (n: number) => String(n).padStart(2, '0');

export const collageFileName = (at: Date) =>
  `collage-${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}.jpg`;
