# 提示词画布

需求为什么这么定看 `docs/requirements-interview.md`，具体怎么做看 `docs/dev-plan.md`，每个阶段的报告在 `docs/reports/`。

## 安装

需要 Node 24。

```bash
npm install
```

端到端测试用 Playwright 1.62 对应的 Chromium，本机没有的话先装一次：`npx playwright install chromium`。

## 运行

- `npm run dev`：开发用。同时起服务（127.0.0.1:3711）、前端（http://localhost:5173）、mock-llm（127.0.0.1:3799）和 mock-comfyui（127.0.0.1:3798），浏览器打开 http://localhost:5173。
- `npm start`：正式用。先打包前端，再由服务托管，并自动打开 http://127.0.0.1:3711。
- `npm run mock-llm`：只起假的大模型服务。设置页里接口地址填 `http://127.0.0.1:3799/v1`，模型名随便填。
- `npm run mock-comfyui`：只起假的 ComfyUI。设置里局域网 ComfyUI 的地址填 `http://127.0.0.1:3798`，底模选 `il-test.safetensors` 或 `pony-test.safetensors`。

本机配置（工作文件夹路径、各模型配置的密钥）存在 `%APPDATA%\media-agent\config.json`，其他系统是 `~/.media-agent/config.json`。模型配置本身（不含密钥）存在工作文件夹的 `model-configs.json`，两台机器共用。

## 测试

- `npm test`：vitest，跑 `packages/shared` 单元测试、`packages/server` 集成测试和 `tools/mock-llm` 的测试。
- `npm run test:e2e`：Playwright。会自己打包前端，在 3712 端口起一个用系统临时目录的服务，不碰本机真实配置。跑之前自动生成 `tests/fixtures/images/` 里的测试图片（不进 git）。
- `npm run typecheck`：类型检查。

测试只用 mock-llm 和 mock-comfyui，不调真模型，不连真的 ComfyUI 和 AutoDL。

## 约定

- 不要自动 git 提交，等用户说「提交」。

## 多 agent：新建 worktree

用户说「新建一个 worktree」时照这套来。这套是实测出来的，踩过的坑都在里面。

**建在哪。** `.dsh/worktrees/<名字>`，分支 `dsh/<名字>`，从最新 main 拉：

```bash
git worktree add .dsh/worktrees/<名字> -b dsh/<名字>
```

再往 `.git/info/exclude` 加一行 `.dsh/worktrees/`。**用 `.git/info/exclude` 不用 `.gitignore`**：worktree 是本机的，不该推给别人；已有的 `.claude/worktrees/` 就是这么办的。放仓库里面（而不是外面）是安全的——根 `tsconfig.json` 的 `include` 是白名单，`vitest.config.ts` 按项目写死了 `root`，都不会扫到嵌套目录。

**先装依赖。** 新 worktree 没有 `node_modules`，跑 `npm install`（缓存是热的，十几秒）。

**会话的工作目录改不过去，用绝对路径。** 会话的工作目录是 DSH 开会话时定的（`D:\cc\media_agent`），agent 自己改不了：每次 `pwsh` 都是新进程，`cd` 不跨调用；文件工具的相对路径固定按会话工作目录解析。所以在 worktree 里干活要：

- `pwsh`：每次都带 `workdir`（指向 worktree）
- 文件工具（read/write/edit）：**一律用绝对路径** `D:\cc\media_agent\.dsh\worktrees\<名字>\...`

**偷懒用相对路径就会静默改到主仓库**，所以每轮收尾都两边各 `git status` 对一次，确认主仓库只有该有的改动。想彻底切过去只能由用户在 DSH 里用那个目录重开会话。

**行尾坑，必踩。** 这台机器全局 `core.autocrlf=true`，仓库里**没有 `.gitattributes`**，所以新签出的文件全是 CRLF，而主仓库那份是 LF（早先签的）。`packages/server/test/imageNode.test.ts` 里硬编码了 `\n`，CRLF 下必挂。按 LF 重签一遍（一次性，不改共享配置）：

```powershell
git -c core.autocrlf=false ls-files | ForEach-Object { if (Test-Path -LiteralPath $_) { Remove-Item -LiteralPath $_ -Force } }
git -c core.autocrlf=false checkout -- .
```

注意：`checkout -- .` 和 `checkout-index -a -f` 都**不生效**（git 认为文件已是最新就不重写），必须先删。名字带中文的文件 PowerShell 删不掉（git 输出的是八进制转义路径），无所谓；`.bat` 本来就该是 CRLF。永久修法是给仓库加 `.gitattributes`（`* text=auto eol=lf`），会动到所有人，得先问用户。

**验证只在 worktree 里跑：**

```bash
npm run typecheck
npx vitest run --no-file-parallelism --retry=1
npm run test:e2e
```

vitest 的端口全是 `listen(0)`（系统分配），和主仓库那套互不干扰，可以同时跑。

**别起 dev 服务。** 3711/5173/3798/3799 是写死的，起了就和主仓库那套抢端口（会发生"两套 dev 抢端口、Vite 被挤死"）。要看界面就用 `npm run test:e2e`（3712 端口 + 独立临时工作文件夹），它驱动真实浏览器，等价于看真界面。

**改了 mock 的话，e2e 要换端口跑**（`dsh/session-1` 上已经改好了，见下）。原来 `tests/e2e/env.ts` 把 mock 端口写死 3798/3799，`playwright.config.ts` 对这两个是 `reuseExistingServer: true`，于是 e2e 会**复用主仓库 dev 起的旧进程**，测的还是旧代码——静默假绿。现在这三个端口能从环境变量覆盖（`tools/*/src/main.ts` 读 `PORT` / `SSH_PORT`，默认值没变），所以**不用停主仓库那套**：

```powershell
$env:E2E_MOCK_COMFY_PORT='3898'; $env:E2E_MOCK_LLM_PORT='3899'; $env:E2E_MOCK_COMFY_SSH_PORT='3897'
npm run test:e2e
```

**测试抖动。** `vitest` 并行跑时每次会随机挂一条（8~12ms 秒挂或几秒超时，每次不一样，单跑都过），加 `--retry=1` 就全绿，是抖动不是真错。判不准的时候先单跑那个文件。

**别拿 PowerShell 改仓库里的 UTF-8 源码。** `Set-Content` 会按 ANSI 重写，中文注释全变乱码、还可能吃掉换行（实测把 `tests/e2e/19-inpaint.spec.ts` 写坏过一次）。要改文件就用编辑器工具，别用 `Get-Content -Raw | ... | Set-Content`。

**交回。** 在自己分支上提交，**不要自己合进 main、不要自己推 main**，等用户看过。

