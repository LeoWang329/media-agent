import { execFile } from 'node:child_process';

// Windows 的选文件夹窗口。后台进程弹的窗口会被系统压在浏览器后面，所以先显示一个透明的 1 像素置顶窗体，
// 窗口挂在它下面才会跟着置顶（窗体不显示的话置顶不生效）；
// 路径转成 base64 输出，免得控制台编码把中文路径弄乱
const SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$owner = New-Object System.Windows.Forms.Form -Property @{
  TopMost = $true; ShowInTaskbar = $false; FormBorderStyle = 'None'; Opacity = 0
  StartPosition = 'Manual'; Size = New-Object System.Drawing.Size(1, 1)
  Location = New-Object System.Drawing.Point(($screen.X + $screen.Width / 2), ($screen.Y + $screen.Height / 2))
}
$owner.Show()
$owner.Activate()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择文件夹'
$dialog.ShowNewFolderButton = $true
if ($env:MEDIA_AGENT_START_FOLDER) { $dialog.SelectedPath = $env:MEDIA_AGENT_START_FOLDER }
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath)))
}
$owner.Dispose()
`;

// 返回选中的路径；用户点了取消返回 null。start 是窗口一打开停在哪个文件夹
export function pickFolder(start?: string): Promise<string | null> {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const env = { ...process.env, MEDIA_AGENT_START_FOLDER: start ?? '' };
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], { env }, (err, stdout) => {
      if (err) return reject(err);
      const output = stdout.trim();
      resolve(output ? Buffer.from(output, 'base64').toString('utf8') : null);
    });
  });
}
