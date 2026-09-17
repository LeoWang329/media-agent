import { TRANSLATE_LANGUAGES, type AspectRatio, type CanvasNodeLayout, type TranslateLanguage } from '@media-agent/shared';
import { HttpError } from '../httpError';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASPECT_RATIOS: AspectRatio[] = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

// 画布和节点 id 会拼进文件路径，只接受 UUID
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, 'id 格式不对');
  return value;
}

export function nonEmptyText(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${what}不能为空`);
  return value;
}

// 拖进来的文件名只当名字存着，不拼路径，不接受带斜杠的
export function fileName(value: unknown): string {
  const name = nonEmptyText(value, '文件名').trim();
  if (/[\\/]/.test(name)) throw new HttpError(400, '文件名不对');
  return name;
}

// 回收站里的文件夹名，只当名字用，不接受路径分隔符和上一级
export function trashName(value: unknown): string {
  const name = nonEmptyText(value, '回收站里的名字').trim();
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new HttpError(400, '回收站里的名字不对');
  return name;
}

export function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new HttpError(400, `${what}格式不对`);
  return value;
}

export function index(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new HttpError(400, `${what}序号不对`);
  return value;
}

export function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${what}格式不对`);
  return value;
}

export function finiteNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `${what}格式不对`);
  return value;
}

export function layouts(value: unknown): CanvasNodeLayout[] {
  if (!Array.isArray(value)) throw new HttpError(400, '节点位置格式不对');
  return value.map((item) => {
    const { id, x, y, collapsed } = (item ?? {}) as Record<string, unknown>;
    if (typeof collapsed !== 'boolean') throw new HttpError(400, '节点位置格式不对');
    return { id: uuid(id), x: finiteNumber(x, '节点位置'), y: finiteNumber(y, '节点位置'), collapsed };
  });
}

export function slots(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 9 || value.some((v) => typeof v !== 'string')) throw new HttpError(400, '槽位格式不对');
  return value;
}

export function duration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 4 || value > 15) throw new HttpError(400, '时长要是 4 到 15 的整数');
  return value;
}

export function language(value: unknown): TranslateLanguage {
  if (!TRANSLATE_LANGUAGES.includes(value as TranslateLanguage)) throw new HttpError(400, `翻译语言只能是${TRANSLATE_LANGUAGES.join('、')}`);
  return value as TranslateLanguage;
}

export function aspectRatio(value: unknown): AspectRatio {
  if (!ASPECT_RATIOS.includes(value as AspectRatio)) throw new HttpError(400, '画面比例格式不对');
  return value as AspectRatio;
}
