import { fillProblem, type ComfyGraph, type ImportedWorkflow, type WorkflowFill } from '@media-agent/shared';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../httpError';
import { readJson, trashName, writeJsonAtomic } from './jsonFile';
import { withLock } from './locks';

// 导入的工作流：工作文件夹 workflows/<id>.json，两台机器共用，见 docs/dev-plan.md 5.18
const workflowsDir = (work: string) => path.join(work, 'workflows');
const workflowFile = (work: string, id: string) => path.join(workflowsDir(work), `${id}.json`);

export type WorkflowFields = { name: string; file: string; graph: ComfyGraph; fill: WorkflowFill };

// 按导入的先后
export async function listWorkflows(work: string): Promise<ImportedWorkflow[]> {
  let names: string[];
  try {
    names = await fs.readdir(workflowsDir(work));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const workflows = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => readJson<ImportedWorkflow>(path.join(workflowsDir(work), name))));
  return workflows.filter((w): w is ImportedWorkflow => w !== null).sort((a, b) => a.importedAt.localeCompare(b.importedAt));
}

export async function readWorkflow(work: string, id: string): Promise<ImportedWorkflow> {
  const workflow = await readJson<ImportedWorkflow>(workflowFile(work, id));
  if (!workflow) throw new HttpError(404, '找不到这个工作流，可能已经删了');
  return workflow;
}

// 改名、新建排队做，名字不能和别的工作流重
function changeWorkflows<T>(work: string, change: (workflows: ImportedWorkflow[]) => Promise<T>): Promise<T> {
  return withLock(`workflows:${work}`, async () => change(await listWorkflows(work)));
}

function checkName(workflows: ImportedWorkflow[], name: string, id?: string) {
  if (workflows.some((w) => w.name === name && w.id !== id)) throw new HttpError(409, `已经有叫「${name}」的工作流，换一个名字`);
}

function checkFill(graph: ComfyGraph, fill: WorkflowFill) {
  const problem = fillProblem(graph, fill);
  if (problem) throw new HttpError(400, problem);
}

export function createWorkflow(work: string, fields: WorkflowFields): Promise<ImportedWorkflow> {
  return changeWorkflows(work, async (workflows) => {
    checkName(workflows, fields.name);
    checkFill(fields.graph, fields.fill);
    const workflow: ImportedWorkflow = {
      id: randomUUID(),
      name: fields.name,
      file: fields.file,
      hash: createHash('sha256').update(JSON.stringify(fields.graph)).digest('hex'),
      importedAt: new Date().toISOString(),
      graph: fields.graph,
      fill: fields.fill,
    };
    await writeJsonAtomic(workflowFile(work, workflow.id), workflow);
    return workflow;
  });
}

export function updateWorkflow(work: string, id: string, fields: Partial<Pick<WorkflowFields, 'name' | 'fill'>>): Promise<ImportedWorkflow> {
  return changeWorkflows(work, async (workflows) => {
    const current = await readWorkflow(work, id);
    if (fields.name !== undefined) checkName(workflows, fields.name, id);
    if (fields.fill) checkFill(current.graph, fields.fill);
    const workflow = { ...current, ...fields };
    await writeJsonAtomic(workflowFile(work, id), workflow);
    return workflow;
  });
}

// 删除挪进 .trash；用它的节点出图时换回内置流程
export function trashWorkflow(work: string, id: string): Promise<void> {
  return changeWorkflows(work, async () => {
    await readWorkflow(work, id);
    await fs.mkdir(path.join(work, '.trash'), { recursive: true });
    await fs.rename(workflowFile(work, id), path.join(work, '.trash', `${trashName('workflow', id)}.json`));
  });
}
