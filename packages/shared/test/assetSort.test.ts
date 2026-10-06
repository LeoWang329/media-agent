import { describe, expect, it } from 'vitest';
import { sortAssets, type AssetSort } from '../src';

const file = (name: string, mtime: number, folder = 'D:\\图') => ({ name, path: `${folder}\\${name}`, mtime });

describe('sortAssets', () => {
  const files = [file('b10.jpg', 300), file('b2.png', 100), file('A.webp', 200), file('c.jpg', 200)];
  const names = (sort: AssetSort) => sortAssets(files, sort).map((f) => f.name);

  it('四种排法；修改时间一样的按文件名；文件名不分大小写，里面的数字按大小比', () => {
    expect(names('time-desc')).toEqual(['b10.jpg', 'A.webp', 'c.jpg', 'b2.png']);
    expect(names('time-asc')).toEqual(['b2.png', 'A.webp', 'c.jpg', 'b10.jpg']);
    expect(names('name-asc')).toEqual(['A.webp', 'b2.png', 'b10.jpg', 'c.jpg']);
    expect(names('name-desc')).toEqual(['c.jpg', 'b10.jpg', 'b2.png', 'A.webp']);
  });

  it('文件名一样的按所在文件夹排；原来的数组不动', () => {
    const same = [file('a.jpg', 1, 'D:\\图\\乙'), file('a.jpg', 1, 'D:\\图\\甲')];
    expect(sortAssets(same, 'name-asc').map((f) => f.path)).toEqual(['D:\\图\\甲\\a.jpg', 'D:\\图\\乙\\a.jpg']);
    expect(same[0].path).toBe('D:\\图\\乙\\a.jpg');
  });
});
