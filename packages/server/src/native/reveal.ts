import { spawn } from 'node:child_process';
import path from 'node:path';

// 在资源管理器（Finder、文件管理器）里显示这个文件并选中它
export function revealInFolder(target: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'win32' ? ['explorer.exe', [`/select,${target}`]]
    : process.platform === 'darwin' ? ['open', ['-R', target]]
    : ['xdg-open', [path.dirname(target)]];
  // 打不开不影响服务
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
