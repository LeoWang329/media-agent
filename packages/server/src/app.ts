import express, { type ErrorRequestHandler } from 'express';
import http from 'node:http';
import path from 'node:path';
import { maskConfig, readConfig, requireWorkFolder, updateConfig } from './config';
import { HttpError } from './httpError';
import { testConnection } from './llm/testConnection';
import { openExternal } from './native/openExternal';
import { assetRoutes } from './routes/assets';
import { canvasRoutes } from './routes/canvases';
import { promptRoutes } from './routes/prompts';
import { workFolderStatus } from './store/workFolder';

export type AppOptions = {
  configDir: string;
  // 给了就托管打包好的前端（npm start）；开发时前端由 Vite 提供
  clientDist?: string;
};

export function createApp({ configDir, clientDist }: AppOptions): express.Express {
  const app = express();
  app.use(express.json());
  const api = express.Router();

  api.get('/config', async (_req, res) => {
    res.json(maskConfig(await readConfig(configDir)));
  });

  api.put('/config', async (req, res) => {
    res.json(maskConfig(await updateConfig(configDir, req.body)));
  });

  api.get('/work-folder', async (_req, res) => {
    const work = await requireWorkFolder(configDir);
    const { modelConfigs } = await readConfig(configDir);
    res.json({ path: work, modelConfigs: modelConfigs.length, ...(await workFolderStatus(work)) });
  });

  api.post('/work-folder/open', async (_req, res) => {
    openExternal(await requireWorkFolder(configDir));
    res.status(204).end();
  });

  api.post('/llm/test', async (req, res) => {
    const { modelConfigs } = await readConfig(configDir);
    const modelConfig = modelConfigs.find((m) => m.id === req.body?.modelConfigId);
    if (!modelConfig) throw new HttpError(404, '找不到这个模型配置');
    res.json(await testConnection(modelConfig));
  });

  api.use(assetRoutes(configDir));
  api.use(canvasRoutes(configDir));
  api.use(promptRoutes(configDir));

  api.use(() => {
    throw new HttpError(404, '没有这个接口');
  });
  app.use('/api', api);

  if (clientDist) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    res.status(typeof err.status === 'number' ? err.status : 500).json({ error: err.message });
  };
  app.use(onError);
  return app;
}

export function startServer(options: AppOptions & { port: number }): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createApp(options));
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve(server));
  });
}
