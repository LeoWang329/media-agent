import { composeChecked, splitTags, tagKey, type Family, type TagCheck } from '@media-agent/shared';
import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { api } from '../api';

// 校验过的标签按「系列|词库写法」记下来，同一个标签只问服务端一次。系列不同，固定开头和评级词算不算认识也不同
const useChecks = create<{ checks: Record<string, TagCheck> }>(() => ({ checks: {} }));

const keyOf = (family: Family | null, name: string) => `${family ?? ''}|${tagKey(name)}`;
const asking = new Map<string, Promise<void>>();

// 没校验过的拿去问服务端；已经在问的等它问完
export function checkTags(names: string[], family: Family | null): Promise<void> {
  const { checks } = useChecks.getState();
  const waits: Promise<void>[] = [];
  const missing: string[] = [];
  for (const name of new Set(names)) {
    const key = keyOf(family, name);
    if (checks[key]) continue;
    const pending = asking.get(key);
    if (pending) waits.push(pending);
    else if (!missing.some((other) => keyOf(family, other) === key)) missing.push(name);
  }
  if (missing.length) {
    const request = api<TagCheck[]>('/tags/check', { method: 'POST', body: { tags: missing, ...(family && { family }) } })
      .then((results) => rememberChecks(missing, results, family))
      .finally(() => missing.forEach((name) => asking.delete(keyOf(family, name))));
    missing.forEach((name) => asking.set(keyOf(family, name), request));
    waits.push(request);
  }
  return Promise.all(waits).then(() => undefined);
}

// 服务端已经校验过的（让 AI 转标签回来的），直接记下
export function rememberChecks(names: string[], checks: TagCheck[], family: Family | null) {
  useChecks.setState((s) => ({ checks: { ...s.checks, ...Object.fromEntries(names.map((name, i) => [keyOf(family, name), checks[i]])) } }));
}

// 词库更新了：之前的校验结果都不算数
export const forgetChecks = () => useChecks.setState({ checks: {} });

export const checkOf = (name: string, family: Family | null): TagCheck | undefined => useChecks.getState().checks[keyOf(family, name)];

// 拼成一串（复制和出图都用它）：别名换成标准名，不认识的原样照写。还没校验完的先问完再拼
export async function composeBox(text: string, family: Family | null): Promise<{ text: string; count: number }> {
  const items = splitTags(text);
  await checkTags(
    items.map((item) => item.name),
    family,
  ).catch(() => undefined);
  return { text: composeChecked(items, items.map((item) => checkOf(item.name, family)) as TagCheck[]), count: items.length };
}

// 这些标签的校验结果，没校验过的先去问；问不到的是 undefined，小块照原样显示
export function useTagChecks(names: string[], family: Family | null): (TagCheck | undefined)[] {
  const joined = names.join('\n');
  useEffect(() => {
    if (joined) checkTags(joined.split('\n'), family).catch(() => undefined);
  }, [joined, family]);
  return useChecks(useShallow((s) => names.map((name) => s.checks[keyOf(family, name)])));
}
