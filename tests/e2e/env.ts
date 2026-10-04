import os from 'node:os';
import path from 'node:path';

// 端到端测试用独立端口和临时目录，不和 npm run dev 的服务、真实配置冲突
export const E2E_APP_PORT = 3712;
export const MOCK_LLM_PORT = 3799;
export const MOCK_COMFY_PORT = 3798;
export const E2E_ROOT = path.join(os.tmpdir(), 'media-agent-e2e');
export const E2E_CONFIG_DIR = path.join(E2E_ROOT, 'config');
export const E2E_WORK_FOLDER = path.join(E2E_ROOT, 'work');
