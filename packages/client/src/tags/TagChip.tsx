import { displayTag, tagKey, unescapeTag, type TagCheck, type TagItem } from '@media-agent/shared';
import type { HTMLAttributes } from 'react';
import { fmtNum } from '../ui/copy';

// Danbooru 的五个分类
export const TAG_CATEGORIES: Record<number, string> = { 0: '通用', 1: '画师', 3: '作品', 4: '角色', 5: '元标签' };

// 使用次数：一万以上写成「219 万」「3.4 万」
export function fmtCount(count: number): string {
  if (count < 10000) return fmtNum(count);
  const wan = count / 10000;
  return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, '')} 万`;
}

// 权重写一位小数；模型写了两位的照写
export const fmtWeight = (weight: number) => (Number.isInteger(weight * 10) ? weight.toFixed(1) : String(weight));

// 小块上显示的名字：认识的按词库的写法，不认识的照框里写的
export const chipName = (item: TagItem, check: TagCheck | undefined) => (check?.tag ? displayTag(check.tag) : unescapeTag(item.name));

// 鼠标停在小块上看到的全部信息
export function chipTitle(item: TagItem, check: TagCheck | undefined): string {
  const parts = [chipName(item, check)];
  if (check?.zh) parts.push(check.zh);
  if (check?.category !== undefined) parts.push(TAG_CATEGORIES[check.category] ?? '');
  if (check?.count) parts.push(`用过 ${fmtCount(check.count)} 次`);
  if (item.weight !== 1) parts.push(`权重 ${fmtWeight(item.weight)}`);
  let title = parts.filter(Boolean).join(' · ');
  if (check?.status === 'alias') title += `\n原来写的是 ${unescapeTag(item.name)}，程序换成了标准写法`;
  if (check?.status === 'unknown') title += '\n词库里没有这个写法。可能是 AI 编的，也可能是有意写的（比如 LoRA 的触发词）';
  return title;
}

type Props = HTMLAttributes<HTMLElement> & {
  item: TagItem;
  check: TagCheck | undefined; // 还没校验完时没有，先只显示名字
  unknownText?: string;
  as?: 'span' | 'button';
};

// 一个标签小块：英文在上，中文在下。角色、作品、画师标出分类；权重不是 1 标出来；
// 别名注明原来写的是什么；不认识的用虚线框
export function TagChip({ item, check, unknownText = '不认识 · 点开挑', as = 'span', className, ...rest }: Props) {
  const category = check?.category ?? -1;
  const status = check?.status ?? 'ok';
  const name = chipName(item, check);
  let zh;
  if (!check) zh = <span className="tg-zh">&nbsp;</span>;
  else if (status === 'unknown') zh = <span className="tg-zh is-unknown">{unknownText}</span>;
  else {
    // 中文名和英文一样的（画师名多是这样）当没有中文
    const text = check.zh && tagKey(check.zh) !== tagKey(name) ? check.zh : '';
    zh = (
      <span className="tg-zh">
        {text || <span className="tg-none">{category === 1 ? '画师，没有中文' : '没有中文'}</span>}
        {status === 'alias' && <span className="tg-was">原来写的是 {unescapeTag(item.name)}</span>}
      </span>
    );
  }
  const Tag = as;
  return (
    <Tag
      {...(as === 'button' && { type: 'button' as const })}
      {...rest}
      className={`tg cat-${category}${status !== 'ok' ? ` is-${status}` : ''}${className ? ` ${className}` : ''}`}
      title={chipTitle(item, check)}
      data-testid="tag-chip"
    >
      <span className="tg-en">
        {[1, 3, 4].includes(category) && <i className="tg-cat">{TAG_CATEGORIES[category]}</i>}
        <span className="tg-name">{name}</span>
        {item.weight !== 1 && <b className={`tg-w${item.weight < 1 ? ' is-down' : ''}`}>{fmtWeight(item.weight)}</b>}
      </span>
      {zh}
    </Tag>
  );
}
