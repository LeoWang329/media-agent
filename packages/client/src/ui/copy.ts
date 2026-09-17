import { toast } from './toast';

// 复制到剪贴板；本机 http 页面不算安全上下文时退回老办法
export function copyText(text: string, label = '已复制') {
  const done = () => toast(label);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, done);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } catch {
    // 复制不了也照样提示，和原型一致
  }
  area.remove();
  done();
}

export const fmtNum = (n: number) => Number(n).toLocaleString('en-US');
