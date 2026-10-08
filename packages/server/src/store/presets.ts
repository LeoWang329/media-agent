import { FAMILY_DEFAULTS, imageSettingsOf, type Family, type ImagePreset, type PresetSettings } from '@media-agent/shared';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { HttpError } from '../httpError';
import { readJson, writeJsonAtomic } from './jsonFile';
import { withLock } from './locks';

// 出图设置的预设：工作文件夹 image-presets.json，两台机器共用，见 docs/dev-plan.md 5.21
const presetsFile = (work: string) => path.join(work, 'image-presets.json');

// 后来加的项（ControlNet、E02 的几样），之前存的预设里没有，按新节点的默认值补上
export async function listPresets(work: string): Promise<ImagePreset[]> {
  return ((await readJson<ImagePreset[]>(presetsFile(work))) ?? []).map((preset) => {
    const { count: _count, seed: _seed, ...settings } = imageSettingsOf(preset.settings, FAMILY_DEFAULTS[preset.family], preset.family);
    return { ...preset, settings };
  });
}

// 读改写排队，免得两次保存互相覆盖
function changePresets<T>(work: string, change: (presets: ImagePreset[]) => { presets: ImagePreset[]; result: T }): Promise<T> {
  return withLock(`presets:${work}`, async () => {
    const { presets, result } = change(await listPresets(work));
    await writeJsonAtomic(presetsFile(work), presets);
    return result;
  });
}

// 同一个系列里名字不能重
function checkName(presets: ImagePreset[], family: Family, name: string, id?: string) {
  if (presets.some((preset) => preset.family === family && preset.name === name && preset.id !== id)) {
    throw new HttpError(409, `${family} 系列已经有叫「${name}」的预设`);
  }
}

export function createPreset(work: string, fields: { name: string; family: Family; settings: PresetSettings }): Promise<ImagePreset> {
  return changePresets(work, (presets) => {
    checkName(presets, fields.family, fields.name);
    const time = new Date().toISOString();
    const preset: ImagePreset = { id: randomUUID(), ...fields, createdAt: time, updatedAt: time };
    return { presets: [...presets, preset], result: preset };
  });
}

export function updatePreset(
  work: string,
  id: string,
  change: (current: ImagePreset) => { name?: string; settings?: PresetSettings },
): Promise<ImagePreset> {
  return changePresets(work, (presets) => {
    const current = presets.find((preset) => preset.id === id);
    if (!current) throw new HttpError(404, '找不到这个预设');
    const fields = change(current);
    if (fields.name !== undefined) checkName(presets, current.family, fields.name, id);
    const preset = { ...current, ...fields, updatedAt: new Date().toISOString() };
    return { presets: presets.map((item) => (item.id === id ? preset : item)), result: preset };
  });
}

export function deletePreset(work: string, id: string): Promise<void> {
  return changePresets(work, (presets) => {
    if (!presets.some((preset) => preset.id === id)) throw new HttpError(404, '找不到这个预设');
    return { presets: presets.filter((preset) => preset.id !== id), result: undefined };
  });
}
