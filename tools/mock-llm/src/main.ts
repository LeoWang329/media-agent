import { createMockLlmApp } from './app';

const PORT = 3799;

createMockLlmApp().listen(PORT, '127.0.0.1', (err) => {
  if (err) throw err;
  console.log(`mock-llm 已启动，接口地址填 http://127.0.0.1:${PORT}/v1`);
});
