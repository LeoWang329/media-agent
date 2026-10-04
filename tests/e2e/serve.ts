import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../packages/server/src/app';
import { MOCK_AUTODL_PATH } from '../../tools/mock-comfyui/src/autodl';
import { E2E_APP_PORT, E2E_CONFIG_DIR, E2E_ROOT, MOCK_COMFY_PORT } from './env';

// 每次跑端到端测试都从空的本机配置开始
fs.rmSync(E2E_ROOT, { recursive: true, force: true });
fs.mkdirSync(E2E_CONFIG_DIR, { recursive: true });

await startServer({
  port: E2E_APP_PORT,
  configDir: E2E_CONFIG_DIR,
  clientDist: fileURLToPath(new URL('../../packages/client/dist', import.meta.url)),
  // AutoDL 用 mock-comfyui 里假的，开机后每 0.5 秒查一次
  autodl: { api: `http://127.0.0.1:${MOCK_COMFY_PORT}${MOCK_AUTODL_PATH}`, pollMs: 500 },
});
console.log(`端到端测试服务已启动：http://127.0.0.1:${E2E_APP_PORT}`);
