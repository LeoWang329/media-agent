import { execFile } from 'node:child_process';

// Windows 的选文件夹窗口。挂在一个置顶的隐藏窗体下，免得弹在浏览器后面；
// 路径转成 base64 输出，免得控制台编码把中文路径弄乱
const SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择文件夹'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath)))
}
$owner.Dispose()
`;

// 返回选中的路径；用户点了取消返回 null
export function pickFolder(): Promise<string | null> {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], (err, stdout) => {
      if (err) return reject(err);
      const output = stdout.trim();
      resolve(output ? Buffer.from(output, 'base64').toString('utf8') : null);
    });
  });
}
