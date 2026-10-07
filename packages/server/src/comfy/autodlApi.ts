import type { AutodlInstance } from '@media-agent/shared';

// 调 AutoDL Art 的开发者接口：列实例、查状态、取访问地址、开机关机，见 docs/dev-plan.md 5.17。
// 出错时 message 直接给用户看，带上 AutoDL 的原话。快照里的 root 密码、SSH 地址只在传模型时现取，不存不打印

export const AUTODL_API = 'https://www.autodl.art/api/v1/adl_dev/dev/instance/pro';

// AutoDL 那边出的错，接口里按 502 回。noGpu：开机时那台主机没有空闲的显卡
export class AutodlError extends Error {
  status = 502;
  noGpu: boolean;

  constructor(message: string, noGpu = false) {
    super(message);
    this.noGpu = noGpu;
  }
}

export type AutodlAccess = { api: string; token: string };

type Reply<T> = { code?: string; msg?: string; data?: T };
type Time = { Time?: string; Valid?: boolean };
type ListItem = {
  uuid: string;
  name?: string;
  region_name?: string;
  status?: string;
  req_gpu_amount?: number;
  started_at?: Time;
  stopped_at?: Time;
  cg_application_info?: { application_name?: string };
};
type Snapshot = { payg_price?: number; snapshot_gpu_alias_name?: string; service_6006_domain?: string; ssh_command?: string; root_password?: string };

export type SshAccess = { host: string; port: number; username: string; password: string };

async function call<T>({ api, token }: AutodlAccess, method: 'GET' | 'POST', action: string, body: Record<string, string | number>): Promise<T> {
  const query = method === 'GET' ? `?${new URLSearchParams(Object.entries(body).map(([k, v]): [string, string] => [k, String(v)]))}` : '';
  let res: Response;
  try {
    res = await fetch(`${api}/${action}${query}`, {
      method,
      headers: { Authorization: token, ...(method === 'POST' && { 'Content-Type': 'application/json' }) },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const { message, cause } = err as Error & { cause?: Error };
    throw new AutodlError(`连不上 AutoDL：${cause?.message ?? message}`);
  }
  const text = await res.text();
  let reply: Reply<T> = {};
  try {
    reply = JSON.parse(text);
  } catch {
    // 不是 JSON 的原样报出去
  }
  if (res.ok && reply.code === 'Success') return reply.data as T;
  throw new AutodlError(describe(reply, `${res.status} ${text.slice(0, 300)}`), noFreeGpu(reply));
}

// 那台主机没有空闲的显卡：code 文档没写，按原话里说的认；说的是余额的不算
function noFreeGpu(reply: Reply<unknown>): boolean {
  const said = `${reply.code ?? ''} ${reply.msg ?? ''}`;
  if (/余额|欠费|balance/i.test(said)) return false;
  return /资源不足/.test(said) || (/GPU|显卡/i.test(said) && /不足|不够|占满|没有空闲|无空闲|售罄|insufficient|not enough|unavailable/i.test(said));
}

// 出错时 HTTP 也是 200，看 code：Token 不对是 AuthorizeFailed，实例不存在是 RecordNotFoundError；余额不够的 code 文档没写，按原话里有没有「余额」认
function describe(reply: Reply<unknown>, fallback: string): string {
  const said = reply.msg || reply.code || fallback;
  if (reply.code === 'AuthorizeFailed') return `Token 不对：AutoDL 返回「${said}」。去设置里重新填开发者 Token`;
  if (reply.code === 'RecordNotFoundError') return `实例不存在：AutoDL 返回「${said}」。可能已经被释放（连续关机 60 天会释放），去设置里重新选实例`;
  if (/余额|欠费|balance/i.test(`${reply.code ?? ''} ${reply.msg ?? ''}`)) return `余额不够，开不了机：AutoDL 返回「${said}」。充值后再开机`;
  return `AutoDL 返回「${said}」${reply.code && reply.msg ? `（${reply.code}）` : ''}`;
}

const timeOf = (time: Time | undefined) => (time?.Valid && time.Time ? new Date(time.Time).toISOString() : null);

// 价格的单位是千分之一元
function toInstance(item: ListItem, snapshot: Snapshot | null): AutodlInstance {
  const gpu = snapshot?.snapshot_gpu_alias_name ?? '';
  const amount = item.req_gpu_amount ?? 1;
  return {
    uuid: item.uuid,
    name: [item.name, item.cg_application_info?.application_name].filter(Boolean).join(' · ') || item.uuid,
    region: item.region_name ?? '',
    gpu: gpu && amount > 1 ? `${gpu} × ${amount}` : gpu,
    price: typeof snapshot?.payg_price === 'number' ? snapshot.payg_price / 1000 : null,
    status: item.status ?? '',
    startedAt: item.status === 'running' ? timeOf(item.started_at) : null,
    stoppedAt: item.status === 'shutdown' ? timeOf(item.stopped_at) : null,
  };
}

const snapshot = (access: AutodlAccess, uuid: string) => call<Snapshot>(access, 'GET', 'snapshot', { instance_uuid: uuid });

// 账号下的全部实例；显卡和价格要从各自的快照里取，取不到就空着
export async function listInstances(access: AutodlAccess): Promise<AutodlInstance[]> {
  const data = await call<{ list?: ListItem[] }>(access, 'POST', 'list', { page_index: 1, page_size: 100 });
  return Promise.all((data?.list ?? []).map(async (item) => toInstance(item, await snapshot(access, item.uuid).catch(() => null))));
}

// 选的那个实例现在怎样。显卡和价格不会变，给了就不再取快照
export async function findInstance(access: AutodlAccess, uuid: string, known?: Pick<AutodlInstance, 'gpu' | 'price'>): Promise<AutodlInstance> {
  const data = await call<{ list?: ListItem[] }>(access, 'POST', 'list', { page_index: 1, page_size: 100 });
  const item = data?.list?.find((one) => one.uuid === uuid);
  if (!item) throw new AutodlError('实例不存在：账号下没有这个实例了。可能已经被释放（连续关机 60 天会释放），去设置里重新选实例');
  const instance = toInstance(item, known ? null : await snapshot(access, uuid).catch(() => null));
  return known ? { ...instance, ...known } : instance;
}

// running 是开着；shutdown 是关了；别的是正在开机、正在关机这类
export const instanceStatus = (access: AutodlAccess, uuid: string) => call<string>(access, 'GET', 'status', { instance_uuid: uuid });

// ComfyUI 跑在实例的 6006 端口上，AutoDL 给的访问地址只有域名和端口。真的 AutoDL 是 https，跟它的接口一样；mock 的接口是 http，地址也是 http
export async function comfyAddress(access: AutodlAccess, uuid: string): Promise<string> {
  const domain = (await snapshot(access, uuid))?.service_6006_domain;
  if (!domain) throw new AutodlError('AutoDL 没给这个实例 6006 端口的访问地址。ComfyUI 要跑在实例的 6006 端口上');
  return `${new URL(access.api).protocol}//${domain}`;
}

// 传模型用：地址、端口、用户从 ssh_command（ssh -p 12345 root@host）里拆，密码是 root_password
export async function sshAccess(access: AutodlAccess, uuid: string): Promise<SshAccess> {
  const shot = await snapshot(access, uuid);
  const match = /-p\s+(\d+)\s+([^@\s]+)@(\S+)/.exec(shot?.ssh_command ?? '');
  if (!match || !shot?.root_password) throw new AutodlError('AutoDL 没给这个实例的 SSH 地址和密码，传不了模型');
  return { port: Number(match[1]), username: match[2], host: match[3], password: shot.root_password };
}

export async function powerOn(access: AutodlAccess, uuid: string): Promise<void> {
  await call(access, 'POST', 'power_on', { instance_uuid: uuid, payload: 'gpu' });
}

export async function powerOff(access: AutodlAccess, uuid: string): Promise<void> {
  await call(access, 'POST', 'power_off', { instance_uuid: uuid });
}
