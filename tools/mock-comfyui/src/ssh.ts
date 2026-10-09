import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
// ssh2 是 CommonJS 的包，Node 直接跑时只能整个默认导入
import ssh2, { type Connection, type Server, type ServerChannel } from 'ssh2';

// 假的 SSH，给往 AutoDL 传模型用，见 docs/dev-plan.md 9.5。
// 那台上的 /root/... 落在一个临时文件夹里；只认程序发的那几种命令：看剩余空间、列文件、看有没有、看多大、
// 建文件夹、cat 写文件、改名、删、curl 取大小和下载。curl 只真去取 127.0.0.1 的地址；hf-mirror.com 的给一个 4 KB 的假文件；
// civitai.com、huggingface.co 本站和真的那台一样连不上

export const MOCK_SSH_PASSWORD = 'mock-password';
const HF_FILE_BYTES = 4096;

export type MockSsh = {
  server: Server;
  // 测试用：收到的每条命令；那台还剩多少空间，能改
  commands: string[];
  state: { free: number };
  // 那台上的一个绝对路径对应到本机哪里
  local(remote: string): string;
  // 测试用：那台上的文件全清掉、命令记录清空、剩余空间复原。
  // 文件是落在一个临时文件夹里的，跨用例、跨轮次都在，e2e 每个文件开头清一次
  reset(): void;
  close(): Promise<void>;
};

type Io = { channel: ServerChannel; out: (text: string) => void; err: (text: string) => void; signal: AbortSignal };
type Simple = { args: string[]; stdout?: string; stderr?: string };

// 拆成一个个简单命令：认单引号、反斜杠、&&、||、;、>、2>
function parse(command: string): { simple: Simple; then: string | null }[] {
  const tokens: ({ word: string } | { op: string })[] = [];
  let word = '';
  let inWord = false;
  const push = () => {
    if (inWord) tokens.push({ word });
    word = '';
    inWord = false;
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      word += command.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (ch === '\\') {
      word += command[(i += 1)];
      inWord = true;
    } else if (ch === ' ') {
      push();
    } else if (command.startsWith('&&', i) || command.startsWith('||', i)) {
      push();
      tokens.push({ op: command.slice(i, i + 2) });
      i += 1;
    } else if (ch === ';') {
      push();
      tokens.push({ op: ';' });
    } else if (!inWord && command.startsWith('2>', i)) {
      push();
      tokens.push({ op: '2>' });
      i += 1;
    } else if (ch === '>') {
      push();
      tokens.push({ op: '>' });
    } else {
      word += ch;
      inWord = true;
    }
  }
  push();
  const parts: { simple: Simple; then: string | null }[] = [];
  let simple: Simple = { args: [] };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if ('word' in token) simple.args.push(token.word);
    else if (token.op === '>') simple.stdout = (tokens[(i += 1)] as { word: string }).word;
    else if (token.op === '2>') simple.stderr = (tokens[(i += 1)] as { word: string }).word;
    else {
      parts.push({ simple, then: token.op });
      simple = { args: [] };
    }
  }
  parts.push({ simple, then: null });
  return parts;
}

export function createMockSsh(): MockSsh {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-autodl-disk-'));
  const commands: string[] = [];
  const state = { free: 14 * 1024 ** 3 };
  const local = (remote: string) => path.join(root, ...remote.split('/').filter(Boolean));
  const remoteOf = (file: string) => `/${path.relative(root, file).split(path.sep).join('/')}`;

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : [];
    });
  }

  // curl 能连上哪些地址：本机的真去取；hf-mirror 给假文件；别的和那台一样连不上
  function reach(url: string): 'local' | 'mirror' | string {
    const host = new URL(url).hostname;
    if (host === '127.0.0.1' || host === 'localhost') return 'local';
    if (host === 'hf-mirror.com') return 'mirror';
    if (host === 'civitai.com' || host === 'huggingface.co') return `curl: (28) Failed to connect to ${host} port 443 after 30000 ms: Timeout was reached\n`;
    return `curl: (6) Could not resolve host: ${host}\n`;
  }

  async function curl(args: string[], io: Io): Promise<number> {
    const url = args.at(-1)!;
    const reached = reach(url);
    if (reached !== 'local' && reached !== 'mirror') {
      io.err(reached);
      return reached.includes('(28)') ? 28 : 6;
    }
    if (args.includes('-sSIL')) {
      if (reached === 'mirror') {
        io.out(`HTTP/2 200\r\ncontent-length: ${HF_FILE_BYTES}\r\n\r\n`);
        return 0;
      }
      const res = await fetch(url, { method: 'HEAD' });
      io.out(`HTTP/1.1 ${res.status} ${res.statusText}\r\n${res.headers.get('content-length') ? `content-length: ${res.headers.get('content-length')}\r\n` : ''}\r\n`);
      return 0;
    }
    const output = local(args[args.indexOf('-o') + 1]);
    if (reached === 'mirror') {
      fs.writeFileSync(output, Buffer.alloc(HF_FILE_BYTES, 7));
      return 0;
    }
    const res = await fetch(url, { signal: io.signal }).catch(() => null);
    if (!res) return 1;
    if (!res.ok || !res.body) {
      io.err(`curl: (22) The requested URL returned error: ${res.status}\n`);
      return 22;
    }
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(output)).catch(() => {});
    return io.signal.aborted ? 1 : 0;
  }

  async function run(simple: Simple, io: Io): Promise<number> {
    const quiet = simple.stderr === '/dev/null';
    const err = (text: string) => (quiet ? undefined : io.err(text));
    let [name, ...args] = simple.args;
    if (name === 'exec') [name, ...args] = args;
    const file = (index: number) => local(args[index]);
    switch (name) {
      case 'true':
        return 0;
      case 'echo':
        io.out(`${args.join(' ')}\n`);
        return 0;
      case 'df':
        io.out(`   Avail\n${state.free}\n`);
        return 0;
      case 'test':
        return fs.existsSync(file(1)) ? 0 : 1;
      case 'stat': {
        const target = file(args.length - 1);
        if (!fs.existsSync(target)) {
          err(`stat: cannot statx '${args.at(-1)}': No such file or directory\n`);
          return 1;
        }
        io.out(`${fs.statSync(target).size}\n`);
        return 0;
      }
      case 'mkdir':
        fs.mkdirSync(file(args.length - 1), { recursive: true });
        return 0;
      case 'mv':
        fs.renameSync(file(1), file(2));
        return 0;
      case 'rm':
        for (const target of args.filter((arg) => !arg.startsWith('-'))) fs.rmSync(local(target), { force: true });
        return 0;
      case 'find': {
        const dirs = args.slice(0, args.indexOf('-type'));
        let code = 0;
        for (const dir of dirs) {
          if (!fs.existsSync(local(dir))) {
            err(`find: '${dir}': No such file or directory\n`);
            code = 1;
            continue;
          }
          for (const found of walk(local(dir))) {
            const stat = fs.statSync(found);
            io.out(`${stat.size}\t${(stat.mtimeMs / 1000).toFixed(6)}\t${remoteOf(found)}\n`);
          }
        }
        return code;
      }
      case 'cat': {
        if (!simple.stdout) return 1;
        // 收到 EOF 才算写完；通道先关了就留下半截，跟真的一样
        const write = fs.createWriteStream(local(simple.stdout));
        await new Promise<void>((resolve) => {
          io.channel.pipe(write);
          write.on('finish', resolve);
          io.signal.addEventListener('abort', () => write.end(), { once: true });
        });
        return 0;
      }
      case 'curl':
        return curl(args, io);
      default:
        err(`mock-ssh：不认识这个命令 ${name}\n`);
        return 127;
    }
  }

  async function execute(command: string, io: Io): Promise<number> {
    let code = 0;
    let then: string | null = null;
    for (const part of parse(command)) {
      const skip = (then === '&&' && code !== 0) || (then === '||' && code === 0);
      if (!skip) code = await run(part.simple, io);
      then = part.then;
    }
    return code;
  }

  const hostKey = ssh2.utils.generateKeyPairSync('ed25519').private;
  const clients = new Set<Connection>();
  const server: Server = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'root' && ctx.password === MOCK_SSH_PASSWORD) ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('error', () => {});
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('pty', (accept) => accept?.());
        session.on('exec', (accept, _reject, info) => {
          const channel = accept();
          commands.push(info.command);
          const abort = new AbortController();
          channel.on('close', () => abort.abort());
          channel.on('error', () => {});
          const io: Io = { channel, signal: abort.signal, out: (text) => channel.write(text), err: (text) => channel.stderr.write(text) };
          execute(info.command, io)
            .catch((error: Error) => {
              io.err(`${error.message}\n`);
              return 1;
            })
            .then((code) => {
              if (abort.signal.aborted) return;
              channel.exit(code);
              channel.end();
            });
        });
      });
    });
  });

  return {
    server,
    commands,
    state,
    local,
    reset() {
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
      commands.length = 0;
      state.free = 14 * 1024 ** 3;
    },
    async close() {
      clients.forEach((client) => client.end());
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
