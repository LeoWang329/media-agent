import { spawn } from 'node:child_process';

// 用系统默认程序打开网址或文件
export function openExternal(target: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'win32' ? ['explorer.exe', [target]]
    : process.platform === 'darwin' ? ['open', [target]]
    : ['xdg-open', [target]];
  // 打不开不影响服务
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
