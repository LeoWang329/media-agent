# 提示词画布

需求为什么这么定看 `docs/requirements-interview.md`，具体怎么做看 `docs/dev-plan.md`，每个阶段的报告在 `docs/reports/`。

## 安装

需要 Node 24。

```bash
npm install
```

端到端测试用 Playwright 1.62 对应的 Chromium，本机没有的话先装一次：`npx playwright install chromium`。

## 运行

- `npm run dev`：开发用。同时起服务（127.0.0.1:3711）、前端（http://localhost:5173）和 mock-llm（127.0.0.1:3799），浏览器打开 http://localhost:5173。
- `npm start`：正式用。先打包前端，再由服务托管，并自动打开 http://127.0.0.1:3711。
- `npm run mock-llm`：只起假的大模型服务。设置页里接口地址填 `http://127.0.0.1:3799/v1`，模型名随便填。

本机配置（工作文件夹路径、各模型配置的密钥）存在 `%APPDATA%\media-agent\config.json`，其他系统是 `~/.media-agent/config.json`。模型配置本身（不含密钥）存在工作文件夹的 `model-configs.json`，两台机器共用。

## 测试

- `npm test`：vitest，跑 `packages/shared` 单元测试、`packages/server` 集成测试和 `tools/mock-llm` 的测试。
- `npm run test:e2e`：Playwright。会自己打包前端，在 3712 端口起一个用系统临时目录的服务，不碰本机真实配置。跑之前自动生成 `tests/fixtures/images/` 里的测试图片（不进 git）。
- `npm run typecheck`：类型检查。

测试只用 mock-llm，不调真模型。

## 约定

- 不要自动 git 提交，等用户说「提交」。
