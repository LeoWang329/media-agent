import path from 'node:path';
import { readConfig } from './config';
import { HttpError } from './httpError';

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// 接口参数里的文件路径只能在导入的资产文件夹或工作文件夹里
export async function allowedPath(configDir: string, value: unknown): Promise<string> {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new HttpError(400, '路径要是完整路径');
  const target = path.resolve(value);
  const { workFolder, assetFolders } = await readConfig(configDir);
  const roots = workFolder ? [...assetFolders, workFolder] : assetFolders;
  if (!roots.some((root) => isInside(root, target))) throw new HttpError(403, '这个路径不在导入的资产文件夹或工作文件夹里');
  return target;
}
