import { createMockComfy } from './app';

const PORT = 3798;
// 假的 AutoDL 实例上的 SSH，传模型用
const SSH_PORT = 3797;

const mock = createMockComfy();
mock.server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-comfyui 已启动，设置里局域网 ComfyUI 的地址填 http://127.0.0.1:${PORT}`);
});
mock.ssh.server.listen(SSH_PORT, '127.0.0.1');
