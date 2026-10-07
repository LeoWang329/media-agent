import express, { type ErrorRequestHandler } from 'express';
import http from 'node:http';
import path from 'node:path';
import { createAutodl, type Autodl, type AutodlOptions } from './comfy/autodl';
import { createImageJobs, type ImageJobs } from './comfy/jobs';
import { createModelTransfers, VIDEO_MODEL_DIRS } from './comfy/models';
import { createVideoJobs, type VideoJobs } from './comfy/videoJobs';
import { maskConfig, readConfig, requireWorkFolder, updateConfig } from './config';
import { HttpError } from './httpError';
import { testConnection } from './llm/testConnection';
import { openExternal } from './native/openExternal';
import { assetRoutes } from './routes/assets';
import { canvasRoutes } from './routes/canvases';
import { comfyRoutes } from './routes/comfy';
import { fragmentRoutes } from './routes/fragments';
import { presetRoutes } from './routes/presets';
import { imageRoutes } from './routes/images';
import { modelRoutes } from './routes/models';
import { promptRoutes } from './routes/prompts';
import { tagRoutes } from './routes/tags';
import { videoRoutes } from './routes/videos';
import { workflowRoutes } from './routes/workflows';
import { readSettings, updateSettings } from './store/settings';
import { workFolderStatus } from './store/workFolder';
import { DEFAULT_TAG_SOURCES, type TagSources } from './tags/update';

export type AppOptions = {
  configDir: string;
  // 给了就托管打包好的前端（npm start）；开发时前端由 Vite 提供
  clientDist?: string;
  // 更新词库从哪下，测试换成假的
  tagSources?: TagSources;
  // AutoDL 的接口地址和几个等待时间，测试换成 mock-comfyui 里假的
  autodl?: AutodlOptions;
  // 往 AutoDL 传模型时隔多久看一次下了多少，测试调小
  models?: { pollMs?: number };
};

// 出图、生成视频任务和两台 AutoDL 挂在 app.locals 上：服务启动后接着取没出完的图和视频，退出时关 AutoDL，测试收尾时断开
export const imageJobsOf = (app: express.Express) => app.locals.imageJobs as ImageJobs;
export const autodlOf = (app: express.Express) => app.locals.autodl as Autodl;
export const videoJobsOf = (app: express.Express) => app.locals.videoJobs as VideoJobs;
export const videoAutodlOf = (app: express.Express) => app.locals.videoAutodl as Autodl;

export function createApp({ configDir, clientDist, tagSources = DEFAULT_TAG_SOURCES, autodl: autodlOptions, models: modelOptions }: AppOptions): express.Express {
  const app = express();
  // 导入的工作流整份放在请求里，大的有好几百 KB
  app.use(express.json({ limit: '20mb' }));
  const api = express.Router();
  const autodl = createAutodl(configDir, autodlOptions);
  const videoAutodl = createAutodl(configDir, autodlOptions, 'videos');
  const imageJobs = createImageJobs(configDir, autodl);
  const videoJobs = createVideoJobs(configDir, videoAutodl);
  const models = createModelTransfers(autodl, modelOptions);
  const videoModels = createModelTransfers(videoAutodl, { ...modelOptions, dirs: VIDEO_MODEL_DIRS });
  app.locals.autodl = autodl;
  app.locals.imageJobs = imageJobs;
  app.locals.videoAutodl = videoAutodl;
  app.locals.videoJobs = videoJobs;

  api.get('/config', async (_req, res) => {
    res.json(maskConfig(await readConfig(configDir)));
  });

  // 换了 AutoDL 的 Token，重新查一次实例
  api.put('/config', async (req, res) => {
    res.json(maskConfig(await updateConfig(configDir, req.body)));
    if (req.body && 'autodlToken' in req.body) {
      void autodl.refresh();
      void videoAutodl.refresh();
    }
  });

  api.get('/settings', async (_req, res) => {
    res.json(await readSettings(await requireWorkFolder(configDir)));
  });

  // 换了 AutoDL 实例、改了空闲多久关机，马上照新的来
  api.put('/settings', async (req, res) => {
    res.json(await updateSettings(await requireWorkFolder(configDir), req.body));
    if (req.body && 'comfy' in req.body) {
      void autodl.refresh();
      void videoAutodl.refresh();
    }
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
  api.use(presetRoutes(configDir));
  api.use(comfyRoutes(configDir, autodl, videoAutodl));
  api.use(modelRoutes(models));
  api.use(modelRoutes(videoModels, '/comfy/video/models'));
  api.use(workflowRoutes(configDir));
  api.use(imageRoutes(configDir, imageJobs));
  api.use(videoRoutes(configDir, videoJobs));

  api.use(() => {
    throw new HttpError(404, '没有这个接口');
  });
  app.use('/api', api);

  if (clientDist) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html'), { dotfiles: 'allow' }));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    res.status(typeof err.status === 'number' ? err.status : 500).json({ error: err.message });
  };
  app.use(onError);
  return app;
}

export function startServer(options: AppOptions & { port: number }): Promise<{ server: http.Server; app: express.Express }> {
  return new Promise((resolve, reject) => {
    const app = createApp(options);
    const server = http.createServer(app);
    // 往 AutoDL 传一个几 GB 的底模要好一阵，不按 Node 默认的 5 分钟掐断请求
    server.requestTimeout = 0;
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      imageJobsOf(app)
        .resume()
        .catch((err) => console.error('接着取没出完的图失败', err));
      videoJobsOf(app)
        .resume()
        .catch((err) => console.error('接着取没出完的视频失败', err));
      resolve({ server, app });
    });
  });
}
