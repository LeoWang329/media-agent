import os from 'node:os';
import path from 'node:path';

// 端到端测试用独立端口和临时目录，不和 npm run dev 的服务、真实配置冲突。
// 这几个都能从环境变量覆盖：同一台机器上可能同时有另一份仓库在跑 e2e（多 agent 各一个 worktree），
// 端口和临时目录撞上会互相把工作文件夹 rmSync 掉、测试跑到一半就挂。默认值没变。
const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
export const E2E_APP_PORT = port('E2E_APP_PORT', 3712);
// mock 的两个端口：主机上已经有一套 dev 占着 3798/3799 时，覆盖一下就能自己起一套假的，
// 不然 playwright.config.ts 的 reuseExistingServer 会复用那一套，测的还是旧代码
export const MOCK_LLM_PORT = port('E2E_MOCK_LLM_PORT', 3799);
export const MOCK_COMFY_PORT = port('E2E_MOCK_COMFY_PORT', 3798);
export const MOCK_COMFY_SSH_PORT = port('E2E_MOCK_COMFY_SSH_PORT', 3797);
export const E2E_ROOT = process.env.E2E_ROOT ?? path.join(os.tmpdir(), 'media-agent-e2e');
export const E2E_CONFIG_DIR = path.join(E2E_ROOT, 'config');
export const E2E_WORK_FOLDER = path.join(E2E_ROOT, 'work');
