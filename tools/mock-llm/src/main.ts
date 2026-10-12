import { createMockLlmApp } from './app';

// 端口能从环境变量覆盖，见 tools/mock-comfyui/src/main.ts 里的说明
const PORT = Number(process.env.PORT ?? 3799);

createMockLlmApp().listen(PORT, '127.0.0.1', (err) => {
  if (err) throw err;
  console.log(`mock-llm 已启动，接口地址填 http://127.0.0.1:${PORT}/v1`);
});
