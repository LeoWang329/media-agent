import { createMockComfy } from './app';

const PORT = 3798;

createMockComfy().server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-comfyui 已启动，设置里局域网 ComfyUI 的地址填 http://127.0.0.1:${PORT}`);
});
