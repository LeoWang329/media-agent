const pad = (n: number) => String(n).padStart(2, '0');

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// 12:05
export const clock = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 17:36:41
export const clockSeconds = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// 9月16日 16:52
export const dayTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${clock(iso)}`;
};

// 首页卡片上「……动过」：刚刚、12 分钟前、今天 15:02、昨天 21:14、9月13日、2025年2月9日
export function relativeWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const minutes = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (sameDay(d, now)) return `今天 ${clock(iso)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `昨天 ${clock(iso)}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// 18.6 MB、96 KB
export const fmtSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
