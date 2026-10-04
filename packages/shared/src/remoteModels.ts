import type { ModelKind } from './types';

// 往 AutoDL 那台传的模型：有哪几类、子文件夹和文件名的规矩，见 docs/dev-plan.md 5.22

export const MODEL_KINDS: { kind: ModelKind; label: string }[] = [
  { kind: 'checkpoint', label: '底模' },
  { kind: 'lora', label: 'LoRA' },
  { kind: 'upscale', label: '放大' },
  { kind: 'bbox', label: '检测（找框）' },
  { kind: 'segm', label: '检测（找轮廓）' },
  { kind: 'controlnet', label: 'ControlNet' },
  { kind: 'ipadapter', label: 'IP-Adapter' },
  { kind: 'clipVision', label: 'CLIP Vision' },
  { kind: 'vae', label: 'VAE' },
];

export const modelKindLabel = (kind: ModelKind) => MODEL_KINDS.find((item) => item.kind === kind)?.label ?? kind;

// 链接里的文件名：路径最后一段，不带 ? 后面的
export function nameFromUrl(url: string): string {
  const last =
    url
      .trim()
      .replace(/[?#].*$/, '')
      .replace(/^[a-z]+:\/\/[^/]*/i, '')
      .split('/')
      .filter(Boolean)
      .at(-1) ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// 子文件夹可以空着，能有几层；文件名一层。不能带 ..、空的一段、\ 和看不见的字符，没传完的 .part 不能当名字。没问题返回 null
export function remotePathProblem(folder: string, name: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(folder + name)) return '名字里不能有换行这类看不见的字符';
  if (!name.trim()) return '文件名不能空着';
  if (/[\\/]/.test(name)) return '文件名里不能有 / 或 \\';
  if (name === '.' || name === '..') return '文件名不能是 . 或 ..';
  if (name.endsWith('.part')) return '文件名不能以 .part 结尾，没传完的文件用这个';
  if (folder.startsWith('/')) return '子文件夹不能以 / 开头';
  if (folder && folder.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) return '子文件夹里不能有 ..、\\ 或空的一段';
  if (`${folder}/${name}`.length > 240) return '子文件夹加文件名太长了';
  return null;
}

// 文件多大：1 GB 以上写 GB，不然写 MB
export const sizeText = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);
