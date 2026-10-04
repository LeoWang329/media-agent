import { defineConfig } from '@playwright/test';
import { E2E_APP_PORT, MOCK_COMFY_PORT, MOCK_LLM_PORT } from './tests/e2e/env';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // 按文件名顺序跑：01 要从空配置开始
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${E2E_APP_PORT}`,
    browserName: 'chromium',
    viewport: { width: 1600, height: 900 },
  },
  webServer: [
    {
      command: 'npm run mock-llm',
      url: `http://127.0.0.1:${MOCK_LLM_PORT}/v1/models`,
      reuseExistingServer: true,
    },
    {
      command: 'npm run mock-comfyui',
      url: `http://127.0.0.1:${MOCK_COMFY_PORT}/system_stats`,
      reuseExistingServer: true,
    },
    {
      command: 'npm run e2e:serve',
      url: `http://127.0.0.1:${E2E_APP_PORT}/api/config`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
