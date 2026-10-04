import express from 'express';
import { MOCK_SSH_PASSWORD } from './ssh';

// 假的 AutoDL Art 开发者接口，返回的样子照真的，见 docs/dev-plan.md 9.5。
// 一个实例，开始是关着的；开机后 bootMs 变成运行中，关机后 stopMs 变成关机。6006 的访问地址指回 mock 自己，
// 所以开机后连的还是这个假的 ComfyUI

export const MOCK_AUTODL_PATH = '/autodl/api/v1/adl_dev/dev/instance/pro';
export const MOCK_AUTODL_TOKEN = 'mock-autodl-token';
export const MOCK_AUTODL_UUID = 'pro-mock00000001';

// sshCommand 给快照里的 ssh_command，指向假的 SSH
export type MockAutodlOptions = { bootMs?: number; stopMs?: number; sshCommand?: () => string };
export type MockAutodl = {
  router: express.Router;
  // 测试用：实例现在的状态、收到的开机关机请求；fail 里放了的，下一次这个接口按它返回错误
  instance: { status: string; startedAt: string | null; stoppedAt: string | null };
  calls: { action: string; body: unknown }[];
  fail: Partial<Record<'power_on' | 'power_off' | 'status' | 'list', { code: string; msg: string }>>;
  close(): void;
};

const time = (iso: string | null) => ({ Time: iso ?? '0001-01-01T00:00:00Z', Valid: Boolean(iso) });

export function createMockAutodl({ bootMs = 2000, stopMs = 500, sshCommand = () => 'ssh -p 10000 root@mock' }: MockAutodlOptions = {}): MockAutodl {
  const router = express.Router();
  const instance: MockAutodl['instance'] = { status: 'shutdown', startedAt: null, stoppedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() };
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

  const app = { application_uuid: 'MockApp001', current_version: '1.0', application_name: 'ComfyUI-测试', logo: '' };
  const item = () => ({
    created_at: '2026-10-01T10:00:00+08:00',
    uuid: MOCK_AUTODL_UUID,
    machine_id: 'mock',
    machine_alias: 'mock',
    region_sign: 'west-D',
    region_name: '西北B区',
    status: instance.status,
    sub_status: '',
    status_at: instance.startedAt ?? instance.stoppedAt,
    start_mode: 'gpu',
    is_desktop: false,
    charge_type: 'payg',
    req_gpu_amount: 1,
    expired_at: time(null),
    started_at: time(instance.startedAt),
    stopped_at: time(instance.stoppedAt),
    name: '',
    timed_shutdown_at: time(null),
    gpu_spec_uuid: 'v-32g-p',
    cg_application_info: app,
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
    if (action !== 'list' && uuid !== MOCK_AUTODL_UUID) return refuse(res, { code: 'RecordNotFoundError', msg: '未查询到相关实例' });
    next();
  });

  router.post('/list', (_req, res) => {
    reply(res, { list: [item()], page_index: 1, page_size: 100, offset: 0, max_page: 1, result_total: 1, page: 1 });
  });

  router.get('/status', (_req, res) => reply(res, instance.status));

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
      service_6006_domain: req.headers.host,
      service_6006_port: 6006,
      service_6006_port_protocol: 'http',
      cg_application_info: app,
    });
  });

  router.post('/power_on', (_req, res) => {
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

  router.post('/power_off', (_req, res) => {
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
    instance,
    calls,
    fail,
    close() {
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}
