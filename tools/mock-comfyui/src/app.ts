import express from 'express';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import sharp from 'sharp';
import { WebSocketServer, type WebSocket } from 'ws';
import { createMockAutodl, MOCK_AUTODL_PATH, type MockAutodl, type MockAutodlOptions } from './autodl';

// 假的 ComfyUI，接口和推送的样子照真的，见 docs/dev-plan.md 9.5。
// 正面提示词含「慢」的每步走得慢（测叫停），含「报错」的跑到一半出错，含「显存」的报显存不够。
// 假的 AutoDL 接口也挂在这里，见 ./autodl

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
type Task = { id: string; number: number; graph: Graph; clientId: string };
type Run = { task: Task; samplerId: string; timer?: NodeJS.Timeout; started: [string, Record<string, unknown>][] };
type ImageRef = { filename: string; subfolder: string; type: string };
type HistoryEntry = {
  prompt: [number, string, Graph, { client_id: string }, string[]];
  outputs: Record<string, { images: ImageRef[] }>;
  status: { status_str: 'success' | 'error'; completed: boolean; messages: [string, Record<string, unknown>][] };
};

export type MockComfyOptions = { stepMs?: number; slowStepMs?: number; autodl?: MockAutodlOptions };
export type MockComfy = { server: http.Server; autodl: MockAutodl; close(): Promise<void> };

const STEPS = 5;

const MODELS = {
  checkpoints: ['il-test.safetensors', 'pony-test.safetensors'],
  loras: ['detail-test.safetensors', 'IL/anime-style-test.safetensors', 'IL/detail-tweaker-test.safetensors'],
  samplers: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde'],
  schedulers: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple'],
  upscale: ['4x-test.pth'],
  controlnet: ['openpose-test.safetensors'],
  ipadapter: ['ip-adapter-test.safetensors'],
  clipVision: ['clip-vision-test.safetensors'],
  tagger: ['wd-v1-4-moat-tagger-v2'],
  detector: ['bbox/face_yolov8m.pt'],
};

// 下拉选项两种写法都有：老的 [[选项…], {…}]，新的 ['COMBO', {options: […]}]
const combo = (options: string[]) => [options, {}];
const comboV3 = (options: string[]) => ['COMBO', { options }];
const node = (required: Record<string, unknown> = {}, output: string[] = [], outputNode = false) => ({
  input: { required },
  output,
  output_node: outputNode,
});

const OBJECT_INFO: Record<string, ReturnType<typeof node>> = {
  CheckpointLoaderSimple: node({ ckpt_name: combo(MODELS.checkpoints) }, ['MODEL', 'CLIP', 'VAE']),
  LoraLoader: node({ model: ['MODEL'], clip: ['CLIP'], lora_name: combo(MODELS.loras), strength_model: ['FLOAT', {}], strength_clip: ['FLOAT', {}] }, ['MODEL', 'CLIP']),
  CLIPSetLastLayer: node({ clip: ['CLIP'], stop_at_clip_layer: ['INT', { min: -24, max: -1 }] }, ['CLIP']),
  CLIPTextEncode: node({ text: ['STRING', { multiline: true }], clip: ['CLIP'] }, ['CONDITIONING']),
  EmptyLatentImage: node({ width: ['INT', {}], height: ['INT', {}], batch_size: ['INT', {}] }, ['LATENT']),
  KSampler: node(
    {
      model: ['MODEL'],
      seed: ['INT', {}],
      steps: ['INT', {}],
      cfg: ['FLOAT', {}],
      sampler_name: comboV3(MODELS.samplers),
      scheduler: comboV3(MODELS.schedulers),
      positive: ['CONDITIONING'],
      negative: ['CONDITIONING'],
      latent_image: ['LATENT'],
      denoise: ['FLOAT', {}],
    },
    ['LATENT'],
  ),
  KSamplerAdvanced: node({}, ['LATENT']),
  VAEDecode: node({ samples: ['LATENT'], vae: ['VAE'] }, ['IMAGE']),
  VAEEncode: node({}, ['LATENT']),
  PreviewImage: node({ images: ['IMAGE'] }, [], true),
  SaveImage: node({ images: ['IMAGE'] }, [], true),
  LoadImage: node({}, ['IMAGE', 'MASK']),
  UpscaleModelLoader: node({ model_name: combo(MODELS.upscale) }, ['UPSCALE_MODEL']),
  ImageUpscaleWithModel: node({}, ['IMAGE']),
  ImageScale: node({}, ['IMAGE']),
  ControlNetLoader: node({ control_net_name: combo(MODELS.controlnet) }, ['CONTROL_NET']),
  ControlNetApplyAdvanced: node({}, ['CONDITIONING', 'CONDITIONING']),
  CLIPVisionLoader: node({ clip_name: comboV3(MODELS.clipVision) }, ['CLIP_VISION']),
  IPAdapterModelLoader: node({ ipadapter_file: combo(MODELS.ipadapter) }, ['IPADAPTER']),
  IPAdapterAdvanced: node({}, ['MODEL']),
  UltralyticsDetectorProvider: node({ model_name: combo(MODELS.detector) }, ['BBOX_DETECTOR', 'SEGM_DETECTOR']),
  FaceDetailer: node({}, ['IMAGE']),
  DWPreprocessor: node({}, ['IMAGE']),
  'WD14Tagger|pysssss': node({ model: combo(MODELS.tagger) }, ['STRING'], true),
};

function comboOptions(spec: unknown): unknown[] | null {
  if (!Array.isArray(spec)) return null;
  if (Array.isArray(spec[0])) return spec[0];
  if (spec[0] === 'COMBO') return (spec[1] as { options: unknown[] }).options;
  return null;
}

const findNode = (graph: Graph, type: string) => Object.keys(graph).find((id) => graph[id].class_type === type);
const linked = (graph: Graph, value: unknown) => (Array.isArray(value) ? graph[String(value[0])] : undefined);
const escapeXml = (text: string) => text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// 按真 ComfyUI 的规矩检查：节点类型要有，下拉项的值要在列表里
function validate(graph: Graph): object | null {
  for (const [id, item] of Object.entries(graph)) {
    if (!OBJECT_INFO[item.class_type]) {
      return {
        error: { type: 'invalid_prompt', message: `Cannot execute because node ${item.class_type} does not exist.`, details: `Node ID '#${id}'`, extra_info: {} },
        node_errors: {},
      };
    }
  }
  const outputs = Object.keys(graph).filter((id) => OBJECT_INFO[graph[id].class_type].output_node);
  const nodeErrors: Record<string, object> = {};
  for (const [id, item] of Object.entries(graph)) {
    const errors = Object.entries(OBJECT_INFO[item.class_type].input.required).flatMap(([name, spec]) => {
      const options = comboOptions(spec);
      const value = item.inputs[name];
      if (!options || Array.isArray(value) || options.includes(value)) return [];
      return [
        {
          type: 'value_not_in_list',
          message: 'Value not in list',
          details: `${name}: '${String(value)}' not in [${options.map((option) => `'${String(option)}'`).join(', ')}]`,
          extra_info: { input_name: name, received_value: value },
        },
      ];
    });
    if (errors.length) nodeErrors[id] = { errors, dependent_outputs: outputs, class_type: item.class_type };
  }
  if (!Object.keys(nodeErrors).length) return null;
  return { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: '', extra_info: {} }, node_errors: nodeErrors };
}

// 图按尺寸现画：背景颜色跟着种子变，写上种子和正面提示词的前 40 个字
async function drawImage(width: number, height: number, seed: number, positive: string): Promise<Buffer> {
  const color = `#${((seed * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(-6)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="${color}"/>
<rect x="24" y="24" width="${width - 48}" height="150" rx="12" fill="#ffffff"/>
<text x="48" y="90" font-size="40" font-family="Arial, sans-serif" fill="#000000">seed ${seed}</text>
<text x="48" y="145" font-size="28" font-family="Arial, sans-serif" fill="#000000">${escapeXml(positive.slice(0, 40))}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export function createMockComfy({ stepMs = 300, slowStepMs = 1200, autodl: autodlOptions }: MockComfyOptions = {}): MockComfy {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const autodl = createMockAutodl(autodlOptions);
  app.use(MOCK_AUTODL_PATH, autodl.router);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, string>();
  const queue: Task[] = [];
  const history = new Map<string, HistoryEntry>();
  const images = new Map<string, Buffer>();
  const prompts: unknown[] = [];
  let current: Run | null = null;
  let counter = 0;

  const sendTo = (clientId: string, type: string, data: Record<string, unknown>) => {
    for (const [ws, id] of clients) if (id === clientId) ws.send(JSON.stringify({ type, data }));
  };
  const remaining = () => queue.length + (current ? 1 : 0);
  const broadcastStatus = () => {
    for (const ws of clients.keys()) ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: remaining() } } } }));
  };
  const row = (task: Task) => [task.number, task.id, task.graph, { client_id: task.clientId }, Object.keys(task.graph).filter((id) => OBJECT_INFO[task.graph[id].class_type].output_node)];
  const record = (task: Task, outputs: HistoryEntry['outputs'], ok: boolean, messages: HistoryEntry['status']['messages']) => {
    history.set(task.id, {
      prompt: row(task) as HistoryEntry['prompt'],
      outputs,
      status: { status_str: ok ? 'success' : 'error', completed: ok, messages },
    });
  };

  // 一个一个跑，每个 5 步
  function runNext() {
    if (current || !queue.length) return;
    const task = queue.shift()!;
    const { graph } = task;
    const samplerId = findNode(graph, 'KSampler') ?? Object.keys(graph)[0];
    const sampler = graph[samplerId];
    const positive = String(linked(graph, sampler.inputs.positive)?.inputs.text ?? '');
    const latent = linked(graph, sampler.inputs.latent_image)?.inputs ?? {};
    const seed = Number(sampler.inputs.seed ?? 0);
    const wait = positive.includes('慢') ? slowStepMs : stepMs;
    const failure = positive.includes('显存')
      ? 'CUDA out of memory. Tried to allocate 2.00 GiB'
      : positive.includes('报错')
        ? 'mock-comfyui：正面提示词含「报错」，按约定出错'
        : null;
    const start = { prompt_id: task.id, timestamp: Date.now() };
    const run: Run = { task, samplerId, started: [['execution_start', start]] };
    current = run;
    sendTo(task.clientId, 'execution_start', start);
    sendTo(task.clientId, 'execution_cached', { nodes: [], prompt_id: task.id, timestamp: Date.now() });
    sendTo(task.clientId, 'executing', { node: samplerId, display_node: samplerId, prompt_id: task.id });
    broadcastStatus();

    let step = 0;
    const tick = async () => {
      step += 1;
      sendTo(task.clientId, 'progress', { value: step, max: STEPS, prompt_id: task.id, node: samplerId });
      if (failure && step === 2) {
        const error = {
          prompt_id: task.id,
          node_id: samplerId,
          node_type: sampler.class_type,
          executed: [],
          exception_message: failure,
          exception_type: failure.includes('CUDA') ? 'torch.OutOfMemoryError' : 'RuntimeError',
          traceback: [],
          current_inputs: {},
          current_outputs: {},
          timestamp: Date.now(),
        };
        record(task, {}, false, [...run.started, ['execution_error', error]]);
        current = null;
        sendTo(task.clientId, 'execution_error', error);
        sendTo(task.clientId, 'executing', { node: null, prompt_id: task.id });
        broadcastStatus();
        runNext();
        return;
      }
      if (step < STEPS) {
        run.timer = setTimeout(tick, wait);
        return;
      }
      const data = await drawImage(Number(latent.width ?? 512), Number(latent.height ?? 512), seed, positive);
      if (current !== run) return;
      // 有存图节点的按真的放进 output，不然是预览用的 temp
      const saveId = findNode(graph, 'SaveImage');
      const outputId = saveId ?? findNode(graph, 'PreviewImage') ?? samplerId;
      const ref = { filename: `ComfyUI_${saveId ? '' : 'temp_'}${randomUUID().slice(0, 5)}_00001_.png`, subfolder: '', type: saveId ? 'output' : 'temp' };
      images.set(ref.filename, data);
      const success = { prompt_id: task.id, timestamp: Date.now() };
      record(task, { [outputId]: { images: [ref] } }, true, [...run.started, ['execution_success', success]]);
      current = null;
      sendTo(task.clientId, 'executing', { node: outputId, display_node: outputId, prompt_id: task.id });
      sendTo(task.clientId, 'executed', { node: outputId, display_node: outputId, output: { images: [ref] }, prompt_id: task.id });
      sendTo(task.clientId, 'execution_success', success);
      sendTo(task.clientId, 'executing', { node: null, prompt_id: task.id });
      broadcastStatus();
      runNext();
    };
    run.timer = setTimeout(tick, wait);
  }

  app.get('/system_stats', (_req, res) => {
    res.json({
      system: { os: 'nt', ram_total: 68719476736, ram_free: 34359738368, comfyui_version: '0.3.60', python_version: '3.12.10', pytorch_version: '2.8.0+cu128', embedded_python: true, argv: ['main.py'] },
      devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', type: 'cuda', index: 0, vram_total: 25757220864, vram_free: 24000000000, torch_vram_total: 0, torch_vram_free: 0 }],
    });
  });

  app.get('/object_info', (_req, res) => {
    res.json(OBJECT_INFO);
  });

  app.post('/prompt', (req, res) => {
    prompts.push(req.body);
    const graph = req.body?.prompt as Graph;
    const problem = validate(graph ?? {});
    if (problem) {
      res.status(400).json(problem);
      return;
    }
    const task: Task = { id: randomUUID(), number: counter++, graph, clientId: String(req.body?.client_id ?? '') };
    queue.push(task);
    res.json({ prompt_id: task.id, number: task.number, node_errors: {} });
    broadcastStatus();
    setImmediate(runNext);
  });

  app.get('/queue', (_req, res) => {
    res.json({ queue_running: current ? [row(current.task)] : [], queue_pending: queue.map(row) });
  });

  app.post('/queue', (req, res) => {
    if (req.body?.clear) queue.length = 0;
    for (const id of req.body?.delete ?? []) {
      const index = queue.findIndex((task) => task.id === id);
      if (index >= 0) queue.splice(index, 1);
    }
    broadcastStatus();
    res.status(200).end();
  });

  // 带了 prompt_id 只停这一个（新版的做法）
  app.post('/interrupt', (req, res) => {
    const wanted = req.body?.prompt_id;
    const run = current;
    if (run && (!wanted || wanted === run.task.id)) {
      clearTimeout(run.timer);
      current = null;
      const data = { prompt_id: run.task.id, node_id: run.samplerId, node_type: 'KSampler', executed: [], timestamp: Date.now() };
      record(run.task, {}, false, [...run.started, ['execution_interrupted', data]]);
      sendTo(run.task.clientId, 'execution_interrupted', data);
      sendTo(run.task.clientId, 'executing', { node: null, prompt_id: run.task.id });
      broadcastStatus();
      setImmediate(runNext);
    }
    res.status(200).end();
  });

  app.get('/history/:id', (req, res) => {
    const entry = history.get(req.params.id);
    res.json(entry ? { [req.params.id]: entry } : {});
  });

  app.get('/view', (req, res) => {
    const data = req.query.type === 'temp' || req.query.type === 'output' ? images.get(String(req.query.filename)) : undefined;
    if (!data) {
      res.status(404).end();
      return;
    }
    res.type('image/png').send(data);
  });

  // 测试用：收到的每个 /prompt 请求体
  app.get('/_last-prompts', (_req, res) => {
    res.json(prompts);
  });

  // 测试用：假的 AutoDL 实例现在的状态、收到过的开机关机请求
  app.get('/_autodl', (_req, res) => {
    res.json({ instance: autodl.instance, calls: autodl.calls });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // 同一个 clientId 重连时顶掉旧的，和真的一样
      const clientId = url.searchParams.get('clientId') || randomUUID().replace(/-/g, '');
      for (const [other, id] of clients) if (id === clientId) clients.delete(other);
      clients.set(ws, clientId);
      ws.on('close', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: remaining() } }, sid: clientId } }));
    });
  });

  return {
    server,
    autodl,
    async close() {
      autodl.close();
      clearTimeout(current?.timer);
      current = null;
      queue.length = 0;
      for (const ws of wss.clients) ws.terminate();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
