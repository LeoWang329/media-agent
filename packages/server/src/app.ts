import express, { type ErrorRequestHandler } from 'express';
import http from 'node:http';
import path from 'node:path';
import { createImageJobs, type ImageJobs } from './comfy/jobs';
import { maskConfig, readConfig, requireWorkFolder, updateConfig } from './config';
import { HttpError } from './httpError';
import { testConnection } from './llm/testConnection';
import { openExternal } from './native/openExternal';
import { assetRoutes } from './routes/assets';
import { canvasRoutes } from './routes/canvases';
import { comfyRoutes } from './routes/comfy';
import { fragmentRoutes } from './routes/fragments';
import { imageRoutes } from './routes/images';
import { promptRoutes } from './routes/prompts';
import { tagRoutes } from './routes/tags';
import { readSettings, updateSettings } from './store/settings';
import { workFolderStatus } from './store/workFolder';
import { DEFAULT_TAG_SOURCES, type TagSources } from './tags/update';

export type AppOptions = {
  configDir: string;
  // 给了就托管打包好的前端（npm start）；开发时前端由 Vite 提供
  clientDist?: string;
  // 更新词库从哪下，测试换成假的
  tagSources?: TagSources;
};

// 出图任务挂在 app.locals 上，服务启动后接着取没出完的图，测试收尾时断开
export const imageJobsOf = (app: express.Express) => app.locals.imageJobs as ImageJobs;

export function createApp({ configDir, clientDist, tagSources = DEFAULT_TAG_SOURCES }: AppOptions): express.Express {
  const app = express();
  app.use(express.json());
  const api = express.Router();
  const imageJobs = createImageJobs(configDir);
  app.locals.imageJobs = imageJobs;

  api.get('/config', async (_req, res) => {
    res.json(maskConfig(await readConfig(configDir)));
  });

  api.put('/config', async (req, res) => {
    res.json(maskConfig(await updateConfig(configDir, req.body)));
  });

  api.get('/settings', async (_req, res) => {
    res.json(await readSettings(await requireWorkFolder(configDir)));
  });

  api.put('/settings', async (req, res) => {
    res.json(await updateSettings(await requireWorkFolder(configDir), req.body));
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
  api.use(tagRoutes(configDir, tagSources));
  api.use(fragmentRoutes(configDir));
  api.use(comfyRoutes(configDir));
  api.use(imageRoutes(configDir, imageJobs));

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
    const app = createApp(options);
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      imageJobsOf(app)
        .resume()
        .catch((err) => console.error('接着取没出完的图失败', err));
      resolve(server);
    });
  });
}
