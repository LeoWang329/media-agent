import { MODEL_KINDS, nameFromUrl, remotePathProblem, sizeText, type ModelKind, type ModelTransfer, type RemoteModelFile, type RemoteModels } from '@media-agent/shared';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import type { Client } from 'ssh2';
import { HttpError } from '../httpError';
import type { Autodl } from './autodl';
import { loadObjectInfo } from './options';
import { connect, must, quote, run, said } from './ssh';

// 往 AutoDL 那台传模型、给链接让它下、列出来、删，见 docs/dev-plan.md 5.22。
// 经 SSH 在那台上执行命令：从电脑传的灌进 cat 的标准输入，给链接的让 curl 下。SSH 的密码每次现查，不存、不写日志。
// 先写成 .part，完了再改名；停了、断了、出错了删掉半截的

// 那台镜像的 extra_model_paths.yaml 里配好的：自己传的放 autodl-tmp/models 下，检测模型只认 ComfyUI 自己的文件夹
const MODELS_ROOT = '/root/autodl-tmp/models';
export const MODEL_DIRS: Record<ModelKind, string> = {
  checkpoint: `${MODELS_ROOT}/checkpoints`,
  lora: `${MODELS_ROOT}/loras`,
  upscale: `${MODELS_ROOT}/upscale_models`,
  bbox: '/root/ComfyUI/models/ultralytics/bbox',
  segm: '/root/ComfyUI/models/ultralytics/segm',
  controlnet: `${MODELS_ROOT}/controlnet`,
  ipadapter: `${MODELS_ROOT}/ipadapter`,
  clipVision: `${MODELS_ROOT}/clip_vision`,
  vae: `${MODELS_ROOT}/vae`,
};
// 生成视频那台只传 LoRA，放在它的 extra_model_paths.yaml 里配好的文件夹
export const VIDEO_MODEL_DIRS: Partial<Record<ModelKind, string>> = { lora: `${MODELS_ROOT}/loras` };
// 看剩余空间的地方，和上面这些在同一块盘上
const DISK = '/root/autodl-tmp';

// 只留最近这么多个完了的，列表里看得到结果
const KEEP_FINISHED = 20;

export type ModelTransfers = ReturnType<typeof createModelTransfers>;
export type UploadParams = { id: string; kind: ModelKind; folder: string; name: string; size: number; replace: boolean };
export type DownloadParams = { kind: ModelKind; url: string; folder: string; name: string; replace: boolean };

type Target = { relative: string; full: string; dir: string; part: string };

function targetOf(dirs: Partial<Record<ModelKind, string>>, kind: ModelKind, folder: string, name: string): Target {
  if (!dirs[kind]) throw new HttpError(400, '模型类型不对');
  const problem = remotePathProblem(folder, name);
  if (problem) throw new HttpError(400, problem);
  const relative = folder ? `${folder}/${name}` : name;
  const full = `${dirs[kind]}/${relative}`;
  return { relative, full, dir: path.posix.dirname(full), part: `${full}.part` };
}

async function freeSpace(conn: Client): Promise<number> {
  const out = await must(conn, `df -B1 --output=avail ${quote(DISK)}`, '看不了那台还剩多少空间');
  return Number(out.trim().split(/\s+/).at(-1)) || 0;
}

// 同名的已经有了不换掉的、空间不够的，都不开始
async function ensureRoom(conn: Client, target: Target, size: number | null, replace: boolean): Promise<void> {
  if (!replace && (await run(conn, `test -e ${quote(target.full)}`)).code === 0) throw new HttpError(409, `那台上已经有「${target.relative}」了`);
  if (size === null) return;
  const free = await freeSpace(conn);
  if (free < size) throw new HttpError(400, `那台只剩 ${sizeText(free)}，这个文件 ${sizeText(size)}，还差 ${sizeText(size - free)}`);
}

// 给链接的：HuggingFace 本站那台连不上，换成国内镜像
function mirror(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new HttpError(400, '链接不对，要像 https://… 这样');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new HttpError(400, '链接要以 http:// 或 https:// 开头');
  if (parsed.hostname === 'huggingface.co' || parsed.hostname === 'www.huggingface.co') parsed.hostname = 'hf-mirror.com';
  return parsed.toString();
}

// curl -I 跟着跳转时会有好几段响应头，看最后一段；不是 2xx 的不算
function contentLength(headers: string): number | null {
  const blocks = headers.split(/\r?\n\r?\n/).filter((block) => block.startsWith('HTTP/'));
  const last = blocks.at(-1);
  if (!last || !/^HTTP\/\S+\s+2\d\d/.test(last)) return null;
  const match = /^content-length:\s*(\d+)/im.exec(last);
  return match ? Number(match[1]) : null;
}

// dirs 是这台能传哪几类、各放哪；生成视频那台用 VIDEO_MODEL_DIRS
export function createModelTransfers(autodl: Autodl, { pollMs = 1000, dirs = MODEL_DIRS }: { pollMs?: number; dirs?: Partial<Record<ModelKind, string>> } = {}) {
  const kinds = MODEL_KINDS.map(({ kind }) => kind).filter((kind) => dirs[kind]);
  const transfers: ModelTransfer[] = [];
  const stops = new Map<string, AbortController>();
  let downloads: Promise<void> = Promise.resolve();

  const busy = (transfer: ModelTransfer) => transfer.state === 'queued' || transfer.state === 'running';
  const syncBusy = () => autodl.setBusy('models', transfers.some(busy));

  function add(transfer: ModelTransfer): ModelTransfer {
    transfers.push(transfer);
    const finished = transfers.filter((one) => !busy(one));
    for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) transfers.splice(transfers.indexOf(old), 1);
    syncBusy();
    return transfer;
  }

  function finish(transfer: ModelTransfer, state: 'done' | 'failed' | 'stopped', error?: string): void {
    transfer.state = state;
    if (error) transfer.error = error;
    stops.delete(transfer.id);
    syncBusy();
  }

  // 连上那台。boot 为真时关着的先开机，跟出图一样；列表、删除不开机
  async function open(boot: boolean): Promise<Client> {
    if (boot) await autodl.ensureReady();
    else if (!(await autodl.address())) {
      const { state, error } = autodl.current();
      if (state === 'unset') throw new HttpError(409, '先在设置里填 AutoDL 的开发者 Token、选好实例');
      throw new HttpError(409, state === 'unknown' && error ? `查不到实例现在怎样：${error}` : '实例关着，开机后才看得到');
    }
    return connect(await autodl.ssh());
  }

  // 传完、下完、删了，出图设置里马上能选到、选不到
  async function refreshOptions(): Promise<void> {
    const url = await autodl.address().catch(() => null);
    if (url) await loadObjectInfo(url, true).catch(() => {});
  }

  async function list(): Promise<RemoteModels> {
    const conn = await open(false);
    try {
      const free = await freeSpace(conn);
      // 只列普通文件：公共模型库链接过来的是软链接，不列
      const out = await must(conn, `find ${kinds.map((kind) => quote(dirs[kind]!)).join(' ')} -type f -printf '%s\\t%T@\\t%p\\n' 2>/dev/null; true`, '列不出那台上的模型');
      const files: RemoteModelFile[] = [];
      for (const line of out.split('\n')) {
        const [bytes, time, full] = line.replace(/\r$/, '').split('\t');
        const kind = full && kinds.find((one) => full.startsWith(`${dirs[one]}/`));
        if (!kind) continue;
        files.push({
          kind,
          path: full.slice(dirs[kind]!.length + 1),
          bytes: Number(bytes),
          modifiedAt: new Date(Number(time) * 1000).toISOString(),
          partial: full.endsWith('.part'),
        });
      }
      const order = (kind: ModelKind) => MODEL_KINDS.findIndex((item) => item.kind === kind);
      files.sort((a, b) => order(a.kind) - order(b.kind) || a.path.localeCompare(b.path));
      return { free, files };
    } finally {
      conn.end();
    }
  }

  // 从电脑传之前：同名的有没有、空间够不够。关着的先开机
  async function check(kind: ModelKind, folder: string, name: string, size: number, replace: boolean): Promise<{ free: number }> {
    const target = targetOf(dirs, kind, folder, name);
    const conn = await open(true);
    try {
      await ensureRoom(conn, target, size, replace);
      return { free: await freeSpace(conn) };
    } finally {
      conn.end();
    }
  }

  // 从电脑传：本机服务一边收一边灌给那台的 cat，传完才返回
  async function upload(input: Readable, { id, kind, folder, name, size, replace }: UploadParams): Promise<ModelTransfer> {
    const target = targetOf(dirs, kind, folder, name);
    if (transfers.some((one) => one.id === id)) throw new HttpError(409, '这个已经在传了');
    const transfer = add({ id, way: 'upload', kind, path: target.relative, done: 0, total: size, state: 'running' });
    const stop = new AbortController();
    stops.set(id, stop);
    // 页面关了、断了：不再等它，删掉半截的
    const lost = () => {
      if (!input.readableEnded) stop.abort('lost');
    };
    input.once('error', lost);
    input.once('close', lost);
    let conn: Client | null = null;
    try {
      conn = await open(true);
      await ensureRoom(conn, target, size, replace);
      const counted = input.pipe(
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            transfer.done += chunk.length;
            done(null, chunk);
          },
        }),
      );
      const ran = await run(conn, `mkdir -p ${quote(target.dir)} && cat > ${quote(target.part)}`, { input: counted, signal: stop.signal });
      if (stop.signal.aborted) throw new HttpError(409, stop.signal.reason === 'lost' ? '没传完：页面关了或者断了' : '停了');
      if (ran.code !== 0) throw new HttpError(502, `往那台上写出错：${said(ran)}`);
      const got = Number((await must(conn, `stat -c %s ${quote(target.part)}`, '传完了却查不到文件')).trim());
      if (got !== size) throw new HttpError(502, `没传完：传上去 ${sizeText(got)}，文件有 ${sizeText(size)}`);
      await must(conn, `mv -f ${quote(target.part)} ${quote(target.full)}`, '传完了改不成真名字');
      finish(transfer, 'done');
      void refreshOptions();
      return { ...transfer };
    } catch (err) {
      if (conn) await run(conn, `rm -f ${quote(target.part)}`).catch(() => {});
      if (stop.signal.reason === 'stopped') finish(transfer, 'stopped');
      else finish(transfer, 'failed', (err as Error).message);
      throw err;
    } finally {
      input.off('error', lost);
      input.off('close', lost);
      conn?.end();
    }
  }

  // 给链接让那台下：先看同名的、取大小、看空间，都过了排进去，一个一个下
  async function download({ kind, url, folder, name, replace }: DownloadParams): Promise<ModelTransfer> {
    const source = mirror(url);
    const target = targetOf(dirs, kind, folder, name || nameFromUrl(source));
    const conn = await open(true);
    let total: number | null;
    try {
      const head = await run(conn, `curl -sSIL --max-time 30 ${quote(source)}`);
      if (head.code !== 0) throw new HttpError(502, `那台下不了这个链接：${said(head)}`);
      total = contentLength(head.out);
      await ensureRoom(conn, target, total, replace);
    } finally {
      conn.end();
    }
    if (transfers.some((one) => busy(one) && one.kind === kind && one.path === target.relative)) throw new HttpError(409, `「${target.relative}」已经在下了`);
    const transfer = add({ id: randomUUID(), way: 'download', kind, path: target.relative, url: source, done: 0, total, state: 'queued' });
    const stop = new AbortController();
    stops.set(transfer.id, stop);
    downloads = downloads.then(() => fetchOnRemote(transfer, target, source, stop.signal));
    return { ...transfer };
  }

  async function fetchOnRemote(transfer: ModelTransfer, target: Target, source: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return finish(transfer, 'stopped');
    transfer.state = 'running';
    let conn: Client | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      conn = await open(true);
      const watching = conn;
      // 每隔一会儿看一次下了多少
      let looking = false;
      timer = setInterval(() => {
        if (looking) return;
        looking = true;
        run(watching, `stat -c %s ${quote(target.part)} 2>/dev/null || echo 0`)
          .then((ran) => (transfer.done = Number(ran.out.trim()) || transfer.done))
          .catch(() => {})
          .finally(() => (looking = false));
      }, pollMs);
      const ran = await run(conn, `mkdir -p ${quote(target.dir)} && exec curl -fsSL -o ${quote(target.part)} ${quote(source)}`, { pty: true, signal });
      clearInterval(timer);
      if (signal.aborted) throw new Error('停了');
      if (ran.code !== 0) throw new Error(`那台下不了这个链接：${said(ran)}`);
      await must(conn, `mv -f ${quote(target.part)} ${quote(target.full)}`, '下完了改不成真名字');
      transfer.done = Number((await must(conn, `stat -c %s ${quote(target.full)}`, '下完了却查不到文件')).trim()) || transfer.done;
      finish(transfer, 'done');
      void refreshOptions();
    } catch (err) {
      clearInterval(timer);
      if (conn) await run(conn, `rm -f ${quote(target.part)}`).catch(() => {});
      if (signal.aborted) finish(transfer, 'stopped');
      else finish(transfer, 'failed', (err as Error).message);
    } finally {
      conn?.end();
    }
  }

  // 排着的直接算停了；在传的关掉通道，删掉半截的由传的那边做
  function stop(id: string): ModelTransfer {
    const transfer = transfers.find((one) => one.id === id);
    if (!transfer) throw new HttpError(404, '找不到这个传输');
    stops.get(id)?.abort('stopped');
    if (transfer.state === 'queued') finish(transfer, 'stopped');
    return transfer;
  }

  // 删一个自己传的；没传完的 .part 也能删
  async function remove(kind: ModelKind, relative: string): Promise<void> {
    const name = path.posix.basename(relative);
    const folder = relative.includes('/') ? path.posix.dirname(relative) : '';
    const target = targetOf(dirs, kind, folder, name.endsWith('.part') ? name.slice(0, -'.part'.length) : name);
    const conn = await open(false);
    try {
      await must(conn, `rm -f ${quote(name.endsWith('.part') ? target.part : target.full)}`, '删不掉');
    } finally {
      conn.end();
    }
    void refreshOptions();
  }

  return { kinds, list, check, upload, download, stop, remove, transfers: () => transfers.map((one) => ({ ...one })) };
}
