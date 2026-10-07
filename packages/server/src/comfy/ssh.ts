import type { Readable } from 'node:stream';
// ssh2 是 CommonJS 的包，Node 直接跑时只能整个默认导入
import ssh2, { type Client } from 'ssh2';
import { HttpError } from '../httpError';
import type { SshAccess } from './autodlApi';

// 经 SSH 在 AutoDL 那台上执行命令：传模型（./models）、删生成视频的存档（./videoJobs）共用。SSH 的密码每次现查，不存、不写日志

// 单引号包起来给 shell，里面的单引号写成 '\''
export const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

export function connect(access: SshAccess): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client();
    let ready = false;
    conn.on('ready', () => {
      ready = true;
      resolve(conn);
    });
    // 连上以后再出的错（比如断了）由正在跑的命令报
    conn.on('error', (err) => {
      if (!ready) reject(new HttpError(502, `连不上那台的 SSH：${err.message}`));
    });
    conn.connect({ ...access, readyTimeout: 30_000, keepaliveInterval: 15_000 });
  });
}

export type Ran = { code: number | null; out: string; err: string };

// 执行一条命令等它跑完。input 灌进标准输入；signal 停了就关掉这条通道，开了 pty 的那边的命令跟着被挂断
export function run(conn: Client, command: string, { input, pty = false, signal }: { input?: Readable; pty?: boolean; signal?: AbortSignal } = {}): Promise<Ran> {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty }, (error, channel) => {
      if (error) return reject(new HttpError(502, `在那台上执行命令失败：${error.message}`));
      let out = '';
      let err = '';
      channel.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
      channel.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
      // 那边先退出、还在往里灌的，算在退出码里，不另外报
      channel.on('error', () => {});
      const stop = () => channel.close();
      signal?.addEventListener('abort', stop, { once: true });
      channel.on('close', (code?: number | null) => {
        signal?.removeEventListener('abort', stop);
        resolve({ code: typeof code === 'number' ? code : null, out, err });
      });
      if (signal?.aborted) stop();
      else if (input) input.pipe(channel);
      else channel.end();
    });
  });
}

export const said = (ran: Ran) => (ran.err || ran.out).trim() || `退出码 ${ran.code ?? '没有'}`;

export async function must(conn: Client, command: string, what: string): Promise<string> {
  const ran = await run(conn, command);
  if (ran.code !== 0) throw new HttpError(502, `${what}：${said(ran)}`);
  return ran.out;
}
