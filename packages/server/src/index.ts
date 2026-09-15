import { fileURLToPath } from 'node:url';
import { startServer } from './app';
import { defaultConfigDir } from './config';
import { openExternal } from './native/openExternal';

const PORT = 3711;
const url = `http://127.0.0.1:${PORT}`;
const serveClient = process.argv.includes('--serve-client');

await startServer({
  port: PORT,
  configDir: defaultConfigDir(),
  clientDist: serveClient ? fileURLToPath(new URL('../../client/dist', import.meta.url)) : undefined,
});

console.log(serveClient ? `提示词画布已启动：${url}` : `服务已启动：${url}，开发时请打开 http://localhost:5173`);
if (process.argv.includes('--open')) openExternal(url);
