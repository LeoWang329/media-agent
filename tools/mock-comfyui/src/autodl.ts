import express from 'express';
import { MOCK_SSH_PASSWORD } from './ssh';

// 假的 AutoDL Art 开发者接口，返回的样子照真的，见 docs/dev-plan.md 9.5。
// 两个实例：出图用的那台和生成视频用的那台，开始都是关着的；开机后 bootMs 变成运行中，关机后 stopMs 变成关机，各开各的。
// 6006 的访问地址都指回 mock 自己，所以开机后连的还是这个假的 ComfyUI；domain 给了就按它（测换域名）

export const MOCK_AUTODL_PATH = '/autodl/api/v1/adl_dev/dev/instance/pro';
export const MOCK_AUTODL_TOKEN = 'mock-autodl-token';
export const MOCK_AUTODL_UUID = 'pro-mock00000001';
export const MOCK_AUTODL_VIDEO_UUID = 'pro-mock00000002';

type InstanceState = { status: string; startedAt: string | null; stoppedAt: string | null };

// sshCommand 给快照里的 ssh_command，指向假的 SSH
// domain 给快照里的 6006 访问地址，默认指回 mock 自己；测换域名时给一个自己会变的
export type MockAutodlOptions = { bootMs?: number; stopMs?: number; sshCommand?: () => string; domain?: () => string };
export type MockAutodl = {
  router: express.Router;
  // 测试用：出图那台（instance）、按 uuid 的两台现在的状态、收到的开机关机请求；fail 里放了的，下一次这个接口按它返回错误
  instance: InstanceState;
  instances: Record<string, InstanceState>;
  calls: { action: string; body: unknown }[];
  fail: Partial<Record<'power_on' | 'power_off' | 'status' | 'list', { code: string; msg: string }>>;
  // 测试用：两台都回到关着、开机关机记录清零。状态是跨用例、跨轮次留着的，e2e 每个文件开头清一次
  reset(): void;
  close(): void;
};

const time = (iso: string | null) => ({ Time: iso ?? '0001-01-01T00:00:00Z', Valid: Boolean(iso) });

export function createMockAutodl({ bootMs = 2000, stopMs = 500, sshCommand = () => 'ssh -p 10000 root@mock', domain }: MockAutodlOptions = {}): MockAutodl {
  const router = express.Router();
  const off = (): InstanceState => ({ status: 'shutdown', startedAt: null, stoppedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  const instances: Record<string, InstanceState> = { [MOCK_AUTODL_UUID]: off(), [MOCK_AUTODL_VIDEO_UUID]: off() };
  const calls: MockAutodl['calls'] = [];
  const fail: MockAutodl['fail'] = {};
  const timers = new Set<NodeJS.Timeout>();
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };

  const apps: Record<string, { application_uuid: string; current_version: string; application_name: string; logo: string }> = {
    [MOCK_AUTODL_UUID]: { application_uuid: 'MockApp001', current_version: '1.0', application_name: 'ComfyUI-测试', logo: '' },
    [MOCK_AUTODL_VIDEO_UUID]: { application_uuid: 'MockApp002', current_version: '1.0', application_name: 'H3-测试', logo: '' },
  };
  const item = (uuid: string) => ({
    created_at: '2026-10-01T10:00:00+08:00',
    uuid,
    machine_id: 'mock',
    machine_alias: 'mock',
    region_sign: 'west-D',
    region_name: '西北B区',
    status: instances[uuid].status,
    sub_status: '',
    status_at: instances[uuid].startedAt ?? instances[uuid].stoppedAt,
    start_mode: 'gpu',
    is_desktop: false,
    charge_type: 'payg',
    req_gpu_amount: 1,
    expired_at: time(null),
    started_at: time(instances[uuid].startedAt),
    stopped_at: time(instances[uuid].stoppedAt),
    name: '',
    timed_shutdown_at: time(null),
    gpu_spec_uuid: 'v-32g-p',
    cg_application_info: apps[uuid],
  });

  // 出错时 HTTP 也是 200，看 code
  const reply = (res: express.Response, data: unknown) => res.json({ code: 'Success', msg: '', data });
  const refuse = (res: express.Response, error: { code: string; msg: string }) => res.json({ ...error, data: null });

  router.use((req, res, next) => {
    if (req.headers.authorization !== MOCK_AUTODL_TOKEN) return refuse(res, { code: 'AuthorizeFailed', msg: '登录超时，请重新登录; 登录失败，请重试' });
    const action = req.path.slice(1);
    if (action === 'power_on' || action === 'power_off') calls.push({ action, body: req.body });
    const error = fail[action as keyof MockAutodl['fail']];
    if (error) {
      delete fail[action as keyof MockAutodl['fail']];
      return refuse(res, error);
    }
    const uuid = req.method === 'GET' ? req.query.instance_uuid : req.body?.instance_uuid;
    if (action !== 'list' && !(typeof uuid === 'string' && uuid in instances)) return refuse(res, { code: 'RecordNotFoundError', msg: '未查询到相关实例' });
    next();
  });
  const instanceOf = (req: express.Request) => instances[String(req.method === 'GET' ? req.query.instance_uuid : req.body?.instance_uuid)];

  router.post('/list', (_req, res) => {
    const list = Object.keys(instances).map(item);
    reply(res, { list, page_index: 1, page_size: 100, offset: 0, max_page: 1, result_total: list.length, page: 1 });
  });

  router.get('/status', (req, res) => reply(res, instanceOf(req).status));

  router.get('/snapshot', (req, res) => {
    reply(res, {
      name: '',
      region_sign: 'west-D',
      payg_price: 1680,
      origin_pay_price: 1770,
      snapshot_gpu_alias_name: 'vGPU-32GB',
      cpu_arch: 'x86',
      ssh_command: sshCommand(),
      root_password: MOCK_SSH_PASSWORD,
      jupyter_token: 'mock-jupyter',
      service_6006_domain: domain ? domain() : req.headers.host,
      service_6006_port: 6006,
      service_6006_port_protocol: 'http',
      cg_application_info: apps[String(req.query.instance_uuid)],
    });
  });

  router.post('/power_on', (req, res) => {
    const instance = instanceOf(req);
    if (instance.status === 'shutdown') {
      instance.status = 'starting';
      later(() => {
        instance.status = 'running';
        instance.startedAt = new Date().toISOString();
        instance.stoppedAt = null;
      }, bootMs);
    }
    reply(res, null);
  });

  router.post('/power_off', (req, res) => {
    const instance = instanceOf(req);
    if (instance.status === 'running') {
      instance.status = 'shutting_down';
      later(() => {
        instance.status = 'shutdown';
        instance.startedAt = null;
        instance.stoppedAt = new Date().toISOString();
      }, stopMs);
    }
    reply(res, null);
  });

  return {
    router,
    instance: instances[MOCK_AUTODL_UUID],
    instances,
    calls,
    fail,
    // 就地改，别换成新对象：instance 那个引用是外面拿着的
    reset() {
      timers.forEach(clearTimeout);
      timers.clear();
      for (const one of Object.values(instances)) Object.assign(one, off());
      calls.length = 0;
    },
    close() {
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}
