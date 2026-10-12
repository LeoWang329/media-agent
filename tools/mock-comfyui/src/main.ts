import { createMockComfy } from './app';

// 端口能从环境变量覆盖：主机上已经有一套 dev 占着这两个端口时（多 agent 各用一个 worktree），
// 端到端测试用别的端口自己起一套，不用先停那一套
const PORT = Number(process.env.PORT ?? 3798);
// 假的 AutoDL 实例上的 SSH，传模型用
const SSH_PORT = Number(process.env.SSH_PORT ?? 3797);

const mock = createMockComfy();
mock.server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-comfyui 已启动，设置里局域网 ComfyUI 的地址填 http://127.0.0.1:${PORT}`);
});
mock.ssh.server.listen(SSH_PORT, '127.0.0.1');
