import { parseWorkflowGraph, type FillTarget, type WorkflowFill } from '@media-agent/shared';
import express from 'express';
import { requireWorkFolder } from '../config';
import { HttpError } from '../httpError';
import { createWorkflow, listWorkflows, trashWorkflow, updateWorkflow, type WorkflowFields } from '../store/workflows';
import * as v from './validate';

// 导入的工作流：列出来、导入、改名和往哪填、删除，见 docs/dev-plan.md 5.18

function target(value: unknown, what: string): FillTarget {
  const { node, input } = (value ?? {}) as Record<string, unknown>;
  if (typeof node !== 'string' || typeof input !== 'string' || !node || !input) throw new HttpError(400, `${what}往哪填的格式不对`);
  return { node, input };
}

function fill(value: unknown): WorkflowFill {
  if (typeof value !== 'object' || value === null) throw new HttpError(400, '往哪填的格式不对');
  const fields = value as Record<string, unknown>;
  const optional = (key: string, what: string) => (fields[key] === null || fields[key] === undefined ? null : target(fields[key], what));
  return {
    positive: target(fields.positive, '正面提示词'),
    negative: optional('negative', '负面提示词'),
    seed: optional('seed', '种子'),
    width: optional('width', '宽'),
    height: optional('height', '高'),
  };
}

function graph(value: unknown): WorkflowFields['graph'] {
  const parsed = parseWorkflowGraph(value);
  if ('graph' in parsed) return parsed.graph;
  throw new HttpError(400, parsed.problem === 'ui' ? '这是普通的工作流文件，不是 API 格式。请在 ComfyUI 里用「导出（API）」再存一份' : '工作流的格式不对，要 ComfyUI「导出（API）」存下来的 JSON');
}

export function workflowRoutes(configDir: string): express.Router {
  const router = express.Router();
  const work = () => requireWorkFolder(configDir);

  router.get('/workflows', async (_req, res) => {
    res.json(await listWorkflows(await work()));
  });

  router.post('/workflows', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: WorkflowFields = { name: v.nonEmptyText(body.name, '工作流的名字').trim(), file: v.fileName(body.file), graph: graph(body.graph), fill: fill(body.fill) };
    res.status(201).json(await createWorkflow(await work(), fields));
  });

  router.patch('/workflows/:id', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: Partial<Pick<WorkflowFields, 'name' | 'fill'>> = {};
    if (body.name !== undefined) fields.name = v.nonEmptyText(body.name, '工作流的名字').trim();
    if (body.fill !== undefined) fields.fill = fill(body.fill);
    res.json(await updateWorkflow(await work(), v.uuid(req.params.id), fields));
  });

  router.delete('/workflows/:id', async (req, res) => {
    await trashWorkflow(await work(), v.uuid(req.params.id));
    res.status(204).end();
  });

  return router;
}
