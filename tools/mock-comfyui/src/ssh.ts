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
// civitai.com、huggingface.co 本站和真的那台一样连不上。
// 另外认「续写起点」量大小、规整那两步（见下面 LEAD_*），不做真的转码：照标记里的目标和出片大小回一份结果

export const MOCK_SSH_PASSWORD = 'mock-password';
const HF_FILE_BYTES = 4096;

// 和 packages/shared/src/video.ts 里的 LEAD_MARK 对着改：量一次、规整一份那两步的脚本开头带这行标记
export const LEAD_PROBE_MARK = '# media-agent:lead-probe';
export const LEAD_FIX_MARK = '# media-agent:lead-fix';
const INPUT_DIR = '/root/ComfyUI/input';

export type MockSsh = {
  server: Server;
  // 测试用：收到的每条命令；那台还剩多少空间，能改；续写起点量出来的是「已经一样」还是会「要规整」
  commands: string[];
  state: { free: number; lead: 'fits' | 'fix' };
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
  const state = { free: 14 * 1024 ** 3, lead: 'fits' as 'fits' | 'fix' };
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
      case 'cp': {
        // 接力那套把上一段出的片子拷进 ComfyUI 的 input 目录，见 docs/dev-plan.md 5.32
        const [from, to] = args.filter((arg) => !arg.startsWith('-'));
        if (!fs.existsSync(local(from))) {
          err(`cp: cannot stat '${from}': No such file or directory\n`);
          return 1;
        }
        fs.mkdirSync(path.dirname(local(to)), { recursive: true });
        fs.copyFileSync(local(from), local(to));
        return 0;
      }
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

  // 续写起点那两步（packages/server/src/comfy/videoLead.ts 发过来的）：标记后面是「目标文件（规整那步才有）宽 高」。
  // state.lead 是 fits 就回一份「已经和出片一个规格」的量法，是 fix 就回一份不一样的（尺寸不对、还没有声音），
  // 规整那一步把目标文件造出来（真的那边是 ffmpeg 转的），后面的 LoadVideo 才找得到它
  function leadReply(command: string, io: Io): number {
    const fix = command.includes(LEAD_FIX_MARK);
    const rest = command.slice(command.indexOf(fix ? LEAD_FIX_MARK : LEAD_PROBE_MARK) + (fix ? LEAD_FIX_MARK : LEAD_PROBE_MARK).length).trim();
    const parts = rest.split(/\s+/);
    // 路径是单引号包着传进来的，认的时候得把引号去掉
    const target = fix ? parts[0].replace(/^'+|'+$/g, '') : '';
    const [width, height] = (fix ? parts.slice(1, 3) : parts.slice(0, 2)).map(Number);
    const fits = state.lead === 'fits';
    const spec = fix || fits ? { width, height, fps: 24, audio: true } : { width: 640, height: 360, fps: 30, audio: false };
    // 和真 ffprobe 一样的字段：规整那步之后要按这些判「跟出片对不对得上」（h264、8 位 yuv420p、24 帧、32 kHz 立体声）
    const probed = {
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: spec.width, height: spec.height, avg_frame_rate: `${spec.fps}/1`, pix_fmt: 'yuv420p', color_transfer: 'bt709' },
        ...(spec.audio ? [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '32000', channels: 2 }] : []),
      ],
      format: { duration: '3.0' },
    };
    if (fix) {
      const file = local(target);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from('mock-fixed-lead'));
      io.out(`---FIXED---\n${JSON.stringify(probed)}\n`);
      return 0;
    }
    io.out(`---PROBE---\n${JSON.stringify(probed)}\n`);
    return 0;
  }

  async function execute(command: string, io: Io): Promise<number> {
    if (command.includes(LEAD_PROBE_MARK) || command.includes(LEAD_FIX_MARK)) return leadReply(command, io);
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
      state.lead = 'fits';
    },
    async close() {
      clients.forEach((client) => client.end());
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
