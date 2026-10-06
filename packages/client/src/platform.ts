// 服务端只监听 127.0.0.1，用户必然是在同一台机器上开浏览器，所以平台判断问浏览器就够了，
// 不用再让服务端多传一个字段

const ua = navigator.userAgent;

export const isWindows = /Windows/.test(ua);

const isMac = /Macintosh|Mac OS X/.test(ua);

// 工作文件夹要填绝对路径，示例得跟着系统走，不然 mac 上照着填会被拒
export const workFolderExample = isWindows
  ? 'D:\\同步盘\\提示词画布'
  : isMac
    ? '/Users/你的用户名/提示词画布'
    : '/home/你的用户名/提示词画布';

// macOS 上这个位置叫「访达」，不叫资源管理器
export const fileManagerName = isWindows ? '资源管理器' : isMac ? '访达' : '文件管理器';
