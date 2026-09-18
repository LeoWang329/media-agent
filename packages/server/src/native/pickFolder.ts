import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Windows 的选文件夹窗口。挂在一个置顶的隐藏窗体下，免得弹在浏览器后面；
// 路径转成 base64 输出，免得控制台编码把中文路径弄乱
const WINDOWS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择文件夹'
$dialog.ShowNewFolderButton = $true
if ($env:MEDIA_AGENT_START_FOLDER) { $dialog.SelectedPath = $env:MEDIA_AGENT_START_FOLDER }
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath)))
}
$owner.Dispose()
`;

// macOS 的选文件夹窗口，交给系统的 choose folder。用户点取消时 AppleScript 抛 -128，
// 这里把它变成空输出，跟 Windows 那边保持一致；其它错误照抛，不静悄悄吞掉
function macScript(start?: string): string {
  const where = start ? ` default location POSIX file ${JSON.stringify(start)}` : '';
  return `
set out to ""
try
  set theFolder to choose folder with prompt "选择文件夹"${where}
  set out to POSIX path of theFolder
on error errMsg number errNum
  if errNum is -128 then
    set out to ""
  else
    error errMsg number errNum
  end if
end try
return out
`;
}

// 拿一个确实存在的目录当起始位置，否则 choose folder 一打开就报错
function existingDir(start?: string): string | undefined {
  if (!start) return undefined;
  try {
    return fs.statSync(start).isDirectory() ? start : undefined;
  } catch {
    return undefined;
  }
}

function pickFolderWindows(start?: string): Promise<string | null> {
  const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
  const env = { ...process.env, MEDIA_AGENT_START_FOLDER: start ?? '' };
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], { env }, (err, stdout) => {
      if (err) return reject(err);
      const output = stdout.trim();
      resolve(output ? Buffer.from(output, 'base64').toString('utf8') : null);
    });
  });
}

function pickFolderMac(start?: string): Promise<string | null> {
  // 挑文件夹可能翻很久，给个上限，免得窗口没人管一直挂着
  const options = { timeout: 5 * 60 * 1000 };
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', macScript(existingDir(start))], options, (err, stdout) => {
      if (err) return reject(err);
      const picked = stdout.trim();
      // POSIX path of 给的是 /a/b/ 这样带尾斜杠的，去掉；选到根目录时仍是 /
      resolve(picked ? path.resolve(picked) : null);
    });
  });
}

// 返回选中的路径；用户点了取消返回 null。start 是窗口一打开停在哪个文件夹
export function pickFolder(start?: string): Promise<string | null> {
  if (process.platform === 'win32') return pickFolderWindows(start);
  if (process.platform === 'darwin') return pickFolderMac(start);
  return Promise.reject(new Error('这个系统不能弹窗选择，请直接填写路径'));
}
