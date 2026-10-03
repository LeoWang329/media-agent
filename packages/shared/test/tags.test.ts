import { describe, expect, it } from 'vitest';
import { composeTags, formatTag, splitTags, tagKey } from '../src/tags';

describe('splitTags', () => {
  it('按英文逗号和换行拆，去掉空项和两边空格', () => {
    expect(splitTags('1girl, solo,\nlong hair,, ').map((item) => item.raw)).toEqual(['1girl', 'solo', 'long hair']);
  });

  it('(tag:1.2) 是 1.2，(tag) 是 1.1，套几层乘几次；括号里的逗号不拆', () => {
    expect(splitTags('(smile:1.2), (blush), ((open mouth)), ((closed eyes):0.9)')).toEqual([
      { raw: '(smile:1.2)', name: 'smile', weight: 1.2 },
      { raw: '(blush)', name: 'blush', weight: 1.1 },
      { raw: '((open mouth))', name: 'open mouth', weight: 1.21 },
      { raw: '((closed eyes):0.9)', name: 'closed eyes', weight: 0.99 },
    ]);
  });

  it('\\( \\) 是标签名里的括号，不算加权', () => {
    expect(splitTags('hatsune miku \\(cosplay\\), (ganyu \\(genshin impact\\):1.1), (kafka \\(honkai: star rail\\))')).toEqual([
      { raw: 'hatsune miku \\(cosplay\\)', name: 'hatsune miku \\(cosplay\\)', weight: 1 },
      { raw: '(ganyu \\(genshin impact\\):1.1)', name: 'ganyu \\(genshin impact\\)', weight: 1.1 },
      { raw: '(kafka \\(honkai: star rail\\))', name: 'kafka \\(honkai: star rail\\)', weight: 1.1 },
    ]);
  });

  it('两头是括号但不是同一对的，不算加权', () => {
    expect(splitTags('(a) (b)').map(({ name, weight }) => ({ name, weight }))).toEqual([{ name: '(a) (b)', weight: 1 }]);
  });
});

describe('tagKey', () => {
  it('小写，空格当下划线，去掉括号转义', () => {
    expect(tagKey('  Long   Hair ')).toBe('long_hair');
    expect(tagKey('Hatsune Miku \\(Cosplay\\)')).toBe('hatsune_miku_(cosplay)');
    expect(tagKey('^_^')).toBe('^_^');
  });
});

describe('formatTag 和 composeTags', () => {
  it('下划线换空格，颜文字保留；括号转义；权重不是 1 时写成 (tag:权重)', () => {
    expect(formatTag('long_hair')).toBe('long hair');
    expect(formatTag('^_^')).toBe('^_^');
    expect(formatTag('hatsune_miku_(cosplay)', 1.2)).toBe('(hatsune miku \\(cosplay\\):1.2)');
    expect(formatTag('smile', 1.1 * 1.1)).toBe('(smile:1.21)');
  });

  it('有标准名的按标准名写，不认识的原样照写；拆开再拼回去，权重不变', () => {
    const items = splitTags('Long_Hair, (Smile:1.2), golden hair, sitting by the window');
    const tags: Record<string, string> = { long_hair: 'long_hair', smile: 'smile' };
    const composed = composeTags(items.map((item) => ({ ...item, tag: tags[tagKey(item.name)] })));
    expect(composed).toBe('long hair, (smile:1.2), golden hair, sitting by the window');
    expect(splitTags(composed).map((item) => item.weight)).toEqual([1, 1.2, 1, 1]);
  });
});
