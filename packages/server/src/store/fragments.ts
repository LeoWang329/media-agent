import type { Fragment, FragmentCategory } from '@media-agent/shared';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { HttpError } from '../httpError';
import { readJson, writeJsonAtomic } from './jsonFile';
import { withLock } from './locks';

// 片段库：工作文件夹 fragments.json，两台机器共用，见 docs/dev-plan.md 5.16
const fragmentsFile = (work: string) => path.join(work, 'fragments.json');

export const FRAGMENT_CATEGORIES: FragmentCategory[] = ['character', 'style', 'quality', 'other'];

export type FragmentFields = { name: string; category: FragmentCategory; text: string };

export async function listFragments(work: string): Promise<Fragment[]> {
  return (await readJson<Fragment[]>(fragmentsFile(work))) ?? [];
}

// 读改写排队，免得两次保存互相覆盖；名字不能和别的片段重
function changeFragments<T>(work: string, change: (fragments: Fragment[]) => { fragments: Fragment[]; result: T }): Promise<T> {
  return withLock(`fragments:${work}`, async () => {
    const { fragments, result } = change(await listFragments(work));
    await writeJsonAtomic(fragmentsFile(work), fragments);
    return result;
  });
}

function checkName(fragments: Fragment[], name: string, id?: string) {
  if (fragments.some((fragment) => fragment.name === name && fragment.id !== id)) throw new HttpError(409, `已经有叫「${name}」的片段，换一个名字`);
}

export function createFragment(work: string, fields: FragmentFields): Promise<Fragment> {
  return changeFragments(work, (fragments) => {
    checkName(fragments, fields.name);
    const time = new Date().toISOString();
    const fragment: Fragment = { id: randomUUID(), ...fields, createdAt: time, updatedAt: time };
    return { fragments: [...fragments, fragment], result: fragment };
  });
}

export function updateFragment(work: string, id: string, fields: Partial<FragmentFields>): Promise<Fragment> {
  return changeFragments(work, (fragments) => {
    const current = fragments.find((fragment) => fragment.id === id);
    if (!current) throw new HttpError(404, '找不到这个片段');
    if (fields.name !== undefined) checkName(fragments, fields.name, id);
    const fragment = { ...current, ...fields, updatedAt: new Date().toISOString() };
    return { fragments: fragments.map((item) => (item.id === id ? fragment : item)), result: fragment };
  });
}

export function deleteFragment(work: string, id: string): Promise<void> {
  return changeFragments(work, (fragments) => {
    if (!fragments.some((fragment) => fragment.id === id)) throw new HttpError(404, '找不到这个片段');
    return { fragments: fragments.filter((fragment) => fragment.id !== id), result: undefined };
  });
}
