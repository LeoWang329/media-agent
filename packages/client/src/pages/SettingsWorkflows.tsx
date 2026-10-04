import {
  guessFill,
  guessIsSure,
  missingNodeTypes,
  parseWorkflowFile,
  toFill,
  workflowSlots,
  type ComfyGraph,
  type FillChoice,
  type FillTarget,
  type ImportedWorkflow,
  type WorkflowFileProblem,
} from '@media-agent/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useComfyStore } from '../store/comfyStore';
import { nodeLabel, targetLabel, useWorkflowStore } from '../store/workflowStore';
import { confirmBox } from '../ui/confirm';
import { Dialog } from '../ui/Dialog';
import { whenDid } from '../ui/format';
import { Icon } from '../ui/Icon';
import { RenameInput } from '../ui/RenameInput';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';

// 设置「工作流」：内置流程和导入的工作流，导入、改名、重新指定往哪填、删除，见 docs/dev-plan.md 5.18

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

type Opened = { kind: 'import'; file: string; graph: ComfyGraph } | { kind: 'bad'; file: string; problem: WorkflowFileProblem } | { kind: 'remap'; workflow: ImportedWorkflow };

export function WorkflowsTab({ workFolder }: { workFolder: string | null }) {
  const list = useWorkflowStore((s) => s.list);
  const nodeTypes = useComfyStore((s) => s.options?.nodeTypes);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string; attempt: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!workFolder) return;
    useWorkflowStore.getState().load().catch(failed);
    void useComfyStore.getState().loadOptions();
  }, [workFolder]);

  if (!workFolder) return <p className="muted">工作流存在工作文件夹里，先在「工作文件夹」里选一个。</p>;

  const pickFile = () => {
    if (fileInput.current) fileInput.current.value = '';
    fileInput.current?.click();
  };

  const readFile = async (file: File) => {
    const parsed = parseWorkflowFile(await file.text());
    setOpened('graph' in parsed ? { kind: 'import', file: file.name, graph: parsed.graph } : { kind: 'bad', file: file.name, problem: parsed.problem });
  };

  // 名字重了提示换一个，输入框留着接着改
  const rename = async (workflow: ImportedWorkflow, next: string | null) => {
    const name = next?.trim();
    if (!name || name === workflow.name) return setRenaming(null);
    if (list?.some((w) => w.id !== workflow.id && w.name === name)) {
      toast(`已经有叫「${name}」的工作流了，换一个名字`, { tone: 'warn' });
      return setRenaming((r) => ({ id: workflow.id, draft: name, attempt: (r?.attempt ?? 0) + 1 }));
    }
    setRenaming(null);
    try {
      useWorkflowStore.getState().put(await trackWrite(api<ImportedWorkflow>(`/workflows/${workflow.id}`, { method: 'PATCH', body: { name } })));
    } catch (err) {
      failed(err);
    }
  };

  const remove = async (workflow: ImportedWorkflow) => {
    const ok = await confirmBox({ title: `删除「${workflow.name}」？`, body: '用这个工作流的节点会换回内置基础流程。已经出过的图和参数不受影响。', ok: '删除', danger: true });
    if (!ok) return;
    try {
      await trackWrite(api(`/workflows/${workflow.id}`, { method: 'DELETE' }));
      useWorkflowStore.getState().drop(workflow.id);
      toast('删掉了');
    } catch (err) {
      failed(err);
    }
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>工作流</h2>
          <p>出图的步骤。内置的基础流程不用管；你在 ComfyUI 里搭好的流程可以导进来，程序只往里填提示词、种子、尺寸，其他照原样。</p>
        </div>
        <button type="button" className="btn btn-primary" id="wfImport" onClick={pickFile}>
          <Icon name="plus" />
          导入工作流…
        </button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden data-testid="workflow-file" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
      </div>
      <div className="sx-list" data-od-id="workflow-list">
        <div className="card sx-wf">
          <div className="sx-wf-top">
            <b>内置基础流程</b>
            <span className="tag">自带</span>
          </div>
          <p className="hint">底模 → LoRA → 正负面提示词 → 空白画布 → 采样 → 出图。只用 ComfyUI 自带的节点。</p>
        </div>
        {list?.map((workflow) => {
          const missing = nodeTypes ? missingNodeTypes(workflow.graph, nodeTypes) : [];
          return (
            <div className="card sx-wf" key={workflow.id} data-wf={workflow.id}>
              <div className="sx-wf-top">
                {renaming?.id === workflow.id ? (
                  <RenameInput key={renaming.attempt} value={renaming.draft} className="sx-wf-rename" maxLength={60} onDone={(next) => void rename(workflow, next)} />
                ) : (
                  <b className="sx-wf-name">{workflow.name}</b>
                )}
                <span className="mono meta">
                  {workflow.file} · {whenDid(workflow.importedAt, '导入')}
                </span>
                <span className="grow" />
                <button type="button" className="btn btn-ghost btn-sm" data-wfa="rename" onClick={() => setRenaming({ id: workflow.id, draft: workflow.name, attempt: 0 })}>
                  <Icon name="edit" />
                  改名
                </button>
                <button type="button" className="btn btn-ghost btn-sm" data-wfa="map" onClick={() => setOpened({ kind: 'remap', workflow })}>
                  <Icon name="sliders" />
                  重新指定往哪填
                </button>
                <button type="button" className="btn btn-danger-ghost btn-sm" data-wfa="del" onClick={() => void remove(workflow)}>
                  <Icon name="trash" />
                  删除
                </button>
              </div>
              <FillMap graph={workflow.graph} rows={fillRows(workflow)} />
              {missing.length > 0 && (
                <div className="up-alert is-warn" style={{ margin: '10px 0 0' }}>
                  <Icon name="warn" />
                  <span>
                    这台 ComfyUI 上没有这几种节点：<b>{missing.join('、')}</b>。用这个工作流出图时会拦下来，不发，装好对应的插件后再出。
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {opened && <WorkflowDialog opened={opened} nodeTypes={nodeTypes} onPickAgain={pickFile} onClose={() => setOpened(null)} />}
    </>
  );
}

const fillRows = (workflow: Pick<ImportedWorkflow, 'fill'>): [string, FillTarget | string | null][] => [
  ['正面提示词', workflow.fill.positive],
  ['负面提示词', workflow.fill.negative],
  ['种子', workflow.fill.seed],
  ['尺寸', workflow.fill.width?.node ?? null],
];

// 往哪填的四行；尺寸只写节点
function FillMap({ graph, rows }: { graph: ComfyGraph; rows: [string, FillTarget | string | null][] }) {
  return (
    <div className="sx-map">
      {rows.map(([what, target]) => (
        <span key={what} style={{ display: 'contents' }}>
          <span className="meta">{what}</span>
          {target ? (
            <span className="mono">{typeof target === 'string' ? nodeLabel(graph, target) : targetLabel(graph, target, what === '种子')}</span>
          ) : (
            <span className="meta">不填，照工作流里原来的</span>
          )}
        </span>
      ))}
    </div>
  );
}

// 下拉里的一项写成「节点号\n输入名」
const keyOf = (target: FillTarget | null) => (target ? `${target.node}\n${target.input}` : '');
const targetOf = (key: string): FillTarget | null => {
  if (!key) return null;
  const [node, input] = key.split('\n');
  return { node, input };
};

const PROBLEMS: Record<WorkflowFileProblem, string> = {
  ui: '这是普通的工作流文件，不是 API 格式。',
  json: '这个文件不是 JSON，读不出来。',
  format: '这个文件不是 ComfyUI 的工作流。',
};

type DialogProps = { opened: Opened; nodeTypes: string[] | undefined; onPickAgain: () => void; onClose: () => void };

// 导入窗口：格式不对的说怎么再存一份；都认出来的直接列出来；认不准或有几个候选的列出节点让人挑；也用来重新指定往哪填
function WorkflowDialog({ opened, nodeTypes, onPickAgain, onClose }: DialogProps) {
  if (opened.kind === 'bad') {
    return (
      <Dialog className="wf-dialog" label="导入工作流" odId="dialog-import-workflow" onClose={onClose}>
        <div className="dialog-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2>导入工作流</h2>
            <span className="meta mono">{opened.file}</span>
          </div>
        </div>
        <div className="dialog-body">
          <div className="up-alert is-danger">
            <Icon name="warn" />
            <span>
              <b>{PROBLEMS[opened.problem]}</b>程序要的是 ComfyUI「导出（API）」存下来的 JSON，顶层是「节点号 → 节点内容」那种
              {opened.problem === 'ui' && (
                <>
                  ，这个文件顶层是 <span className="mono">nodes</span> 和 <span className="mono">links</span>
                </>
              )}
              。
            </span>
          </div>
          <p style={{ fontSize: 13.5, marginTop: 10 }}>请在 ComfyUI 里这样再存一份：</p>
          <ol className="sx-steps">
            <li>打开这个工作流。</li>
            <li>菜单「工作流」→「导出（API）」。老版本要先在设置里打开「开发者模式」，按钮叫「Save (API Format)」。</li>
            <li>把存下来的那个 JSON 拿来导入。</li>
          </ol>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            知道了
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              onPickAgain();
            }}
          >
            <Icon name="folder" />
            选另一个文件…
          </button>
        </div>
      </Dialog>
    );
  }
  return <FillDialog opened={opened} nodeTypes={nodeTypes} onClose={onClose} />;
}

function FillDialog({ opened, nodeTypes, onClose }: { opened: Exclude<Opened, { kind: 'bad' }>; nodeTypes: string[] | undefined; onClose: () => void }) {
  const graph = opened.kind === 'remap' ? opened.workflow.graph : opened.graph;
  const slots = useMemo(() => workflowSlots(graph), [graph]);
  const guess = useMemo(() => guessFill(graph), [graph]);
  const sure = opened.kind === 'import' && guessIsSure(guess);
  // 认不准的先选第一个候选，没有候选的不填
  const [choice, setChoice] = useState<{ positive: FillTarget | null } & Omit<FillChoice, 'positive'>>(() =>
    opened.kind === 'remap'
      ? { ...opened.workflow.fill, size: opened.workflow.fill.width?.node ?? null }
      : { positive: guess.positive[0] ?? slots.prompts[0] ?? null, negative: guess.negative[0] ?? null, seed: guess.seed[0] ?? null, size: guess.size[0] ?? null },
  );
  const [name, setName] = useState(opened.kind === 'import' ? opened.file.replace(/\.json$/i, '') : '');
  const [saving, setSaving] = useState(false);
  const missing = opened.kind === 'import' && nodeTypes ? missingNodeTypes(graph, nodeTypes) : [];

  const save = async () => {
    if (!choice.positive) return;
    const fill = toFill({ ...choice, positive: choice.positive });
    setSaving(true);
    try {
      const saved =
        opened.kind === 'import'
          ? await trackWrite(api<ImportedWorkflow>('/workflows', { method: 'POST', body: { name: name.trim(), file: opened.file, graph, fill } }))
          : await trackWrite(api<ImportedWorkflow>(`/workflows/${opened.workflow.id}`, { method: 'PATCH', body: { fill } }));
      useWorkflowStore.getState().put(saved);
      toast(opened.kind === 'import' ? '导入了，存在工作文件夹的 workflows 里' : '存好了');
      onClose();
    } catch (err) {
      failed(err);
      setSaving(false);
    }
  };

  const select = (what: string, key: keyof typeof choice, options: FillTarget[], optional: boolean) => (
    <div className="field">
      <label>
        {what}
        {optional && <span className="muted">（可以不填）</span>}
      </label>
      <select className="select mono" aria-label={what} data-fill={key} value={keyOf(choice[key] as FillTarget | null)} onChange={(e) => setChoice((c) => ({ ...c, [key]: targetOf(e.target.value) }))}>
        {optional && <option value="">不填，照工作流里原来的</option>}
        {options.map((target) => (
          <option key={keyOf(target)} value={keyOf(target)}>
            {targetLabel(graph, target, key === 'seed')}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Dialog className="wf-dialog" label={opened.kind === 'remap' ? '重新指定往哪填' : '导入工作流'} odId="dialog-import-workflow" onClose={onClose}>
      <div className="dialog-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>{opened.kind === 'remap' ? `重新指定「${opened.workflow.name}」往哪填` : '导入工作流'}</h2>
          <span className="meta mono">{opened.kind === 'remap' ? opened.workflow.file : opened.file}</span>
        </div>
      </div>
      <div className="dialog-body">
        {sure ? (
          <>
            <div className="up-alert is-ok">
              <Icon name="check" />
              <span>认出来了，程序会往这几处填：</span>
            </div>
            <FillMap graph={graph} rows={fillRows({ fill: toFill({ ...choice, positive: choice.positive! }) })} />
          </>
        ) : (
          <>
            {opened.kind === 'import' ? (
              <div className="up-alert is-warn">
                <Icon name="warn" />
                <span>
                  <b>有几处认不准。</b>程序不知道往哪填的地方先选了第一个候选。下面列出了工作流里能填的节点（节点号 · 类型 · 标题），看一下对不对。正面提示词一定要选，其他可以不填。
                </span>
              </div>
            ) : (
              <p className="hint">改了以后，用这个工作流出图时按新的填。</p>
            )}
            {slots.prompts.length ? (
              <div className="stack" style={{ gap: 12, marginTop: 12 }}>
                {select('正面提示词填进', 'positive', slots.prompts, false)}
                {select('负面提示词填进', 'negative', slots.prompts, true)}
                {select('种子填进', 'seed', slots.seeds, true)}
                <div className="field">
                  <label>
                    尺寸填进<span className="muted">（可以不填）</span>
                  </label>
                  <select className="select mono" aria-label="尺寸填进" data-fill="size" value={choice.size ?? ''} onChange={(e) => setChoice((c) => ({ ...c, size: e.target.value || null }))}>
                    <option value="">不填，照工作流里原来的</option>
                    {slots.sizes.map((node) => (
                      <option key={node} value={node}>
                        {nodeLabel(graph, node)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="up-alert is-danger" style={{ marginTop: 12 }}>
                <Icon name="warn" />
                <span>这个工作流里找不到能填提示词的地方，导不进来。</span>
              </div>
            )}
          </>
        )}
        {missing.length > 0 && (
          <div className="up-alert is-warn" style={{ marginTop: 12 }}>
            <Icon name="warn" />
            <span>
              这个工作流用到这几种节点，这台 ComfyUI 上没有：<b>{missing.join('、')}</b>。可以先导进来，装好对应的插件后才能出图。
            </span>
          </div>
        )}
        {opened.kind === 'import' && (
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="wfName">名字</label>
            <input className="input" id="wfName" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn btn-primary" disabled={saving || !choice.positive || (opened.kind === 'import' && !name.trim())} onClick={() => void save()}>
          {opened.kind === 'remap' ? '存' : '导入'}
        </button>
      </div>
    </Dialog>
  );
}
