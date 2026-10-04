import { fileURLToPath } from 'node:url';
import { autodlOf, startServer } from './app';
import { defaultConfigDir } from './config';
import { openExternal } from './native/openExternal';

const PORT = 3711;
const url = `http://127.0.0.1:${PORT}`;
const serveClient = process.argv.includes('--serve-client');

const { app } = await startServer({
  port: PORT,
  configDir: defaultConfigDir(),
  clientDist: serveClient ? fileURLToPath(new URL('../../client/dist', import.meta.url)) : undefined,
});

// 按 Ctrl+C、关掉窗口时：这次 AutoDL 是程序开的，先关机再退出，见 docs/dev-plan.md 5.17。再按一次 Ctrl+C 不等了直接退
let exiting = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (exiting) process.exit(1);
    exiting = true;
    void autodlOf(app)
      .exit()
      .then((said) => {
        if (said) console.log(said);
        process.exit(0);
      });
  });
}

console.log(serveClient ? `提示词画布已启动：${url}` : `服务已启动：${url}，开发时请打开 http://localhost:5173`);
if (process.argv.includes('--open')) openExternal(url);
