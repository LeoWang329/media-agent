import { activePath, editFnOf, editSettingsOf, EDIT_FNS, REVERSE_SEED, REMIX_LORAS, type ChatNode, type EditFnId, type EditSettings, type PartialEditSettings } from '@media-agent/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { imageFileUrl } from '../api';
import { useCanvasStore } from '../store/canvasStore';
import { useComfyStore } from '../store/comfyStore';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';
import { LEVEL_LABELS } from '../ui/thinking';
import { TURN_LIMIT_CHOICES, turnLimitLabel, turnLimitOf } from '../ui/turnLimit';
import { Thread } from './Thread';
import { EMPTY_MASK, MaskEditor, maskIsEmpty, type MaskShapes } from './MaskEditor';
import { editStartBlock, startEdit } from './imageActions';
import { drawnMask } from './editMasks';
import { showEditTab, useEditCandidate, useEditWorkspace, type EditTab } from './editWorkspaceStore';
import { EditResults } from './EditResults';

export const SLOT_B_ROLE = '真人参考';
const TABS: { id: EditTab; label: string }[] = [{ id: 'create', label: '创作' }, { id: 'execute', label: '执行' }, { id: 'results', label: '结果' }];
const patch = (node: ChatNode, change: PartialEditSettings) => {
  const store = useCanvasStore.getState();
  const current = store.nodes[node.id] ?? node;
  const edit = editSettingsOf(current.edit, current.slots.length);
  const { real, inpaint, upscale, remix, depth, ...fields } = change;
  return store.patchNode(node.id, { edit: {
    ...fields,
    ...(real && { real: { ...edit.real, ...real, lora: { ...edit.real.lora, ...real.lora } } }),
    ...(inpaint && { inpaint: { ...edit.inpaint, ...inpaint } }),
    ...(upscale && { upscale: { ...edit.upscale, ...upscale } }),
    ...(remix && { remix: { ...edit.remix, ...remix, lora: { ...edit.remix.lora, ...remix.lora } } }),
    ...(depth && { depth: { ...edit.depth, ...depth } }),
  } });
};
const fnName = (fn: EditFnId) => fn === 'upscale' ? '放大高清' : editFnOf(fn).name;

export function EditWorkspace({ node }: { node: ChatNode }) {
  const tab = useEditWorkspace((s) => s.tabs[node.id] ?? 'execute');
  const context = useEditWorkspace((s) => s.context === node.id);
  useEffect(() => {
    const execute = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter' || e.defaultPrevented) return;
      const target = e.target as Element;
      if (!target.closest('#drawer') || target.closest('dialog[open]')) return;
      const button = document.getElementById('editStart') as HTMLButtonElement | null;
      if (!button || button.disabled) return;
      e.preventDefault(); button.click();
    };
    document.addEventListener('keydown', execute);
    return () => document.removeEventListener('keydown', execute);
  }, []);
  return (
    <div className="dr-body edit-workspace" id="editWorkspace" data-od-id="edit-workspace">
      <div className="edit-tabs" role="tablist" aria-label="改图工作区">
        {TABS.map((t, i) => (
          <button key={t.id} type="button" className="btn btn-secondary" id={`editTab-${t.id}`} role="tab" aria-controls={`editPane-${t.id}`} aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1}
            onClick={() => showEditTab(node.id, t.id)}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (i + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
              showEditTab(node.id, TABS[next].id);
              document.getElementById(`editTab-${TABS[next].id}`)?.focus();
            }}
          >{t.label}</button>
        ))}
      </div>
      <section id="editPane-create" role="tabpanel" aria-labelledby="editTab-create" hidden={tab !== 'create'}><Thread node={node} embedded visible={tab === 'create'} /></section>
      <section id="editPane-execute" role="tabpanel" aria-labelledby="editTab-execute" hidden={tab !== 'execute'}><Execution node={node} /></section>
      <section id="editPane-results" role="tabpanel" aria-labelledby="editTab-results" hidden={tab !== 'results'}><EditResults node={node} /></section>
      {context && <ContextDialog node={node} />}
    </div>
  );
}

export function EditFnBar({ node }: { node: ChatNode }) {
  const edit = editSettingsOf(node.edit, node.slots.length);
  const results = Object.values(node.messages).flatMap((m) => m.images ?? []).reduce((n, j) => n + j.images.filter((i) => i.status === 'done').length, 0);
  return (
    <div className="edit-node-ui" id="editFnControls">
      <div className="edit-toprow">
        <label htmlFor="editOp">功能</label>
        <select id="editOp" aria-label="改图功能" data-od-id="edit-fn" value={edit.fn} onChange={(e) => void patch(node, { fn: e.target.value as EditFnId, candidate: null })}>
          {EDIT_FNS.map((fn) => <option key={fn.id} value={fn.id}>{fnName(fn.id)}</option>)}
        </select>
        <button type="button" className="btn btn-secondary" onClick={() => showEditTab(node.id, 'execute')}><Icon name="sliders" />参数</button>
        <button type="button" className="btn btn-secondary" id="editResultsButton" onClick={() => showEditTab(node.id, 'results')}><Icon name="image" />结果{results ? ` ${results}` : ''}</button>
      </div>
      <small id="editOpHint">{editFnOf(edit.fn).desc}</small>
    </div>
  );
}

export function EditStartBar({ node }: { node: ChatNode }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); }, [node.edit, node.slots]);
  const live = Object.values(node.messages).flatMap((m) => m.images ?? []).find((j) => j.images.some((i) => i.status === 'queued' || i.status === 'running'));
  const run = async () => {
    if (sending) return;
    setSending(true); setError('');
    try {
      const invalid = document.querySelector<HTMLInputElement>('#editPane-execute input[aria-invalid="true"]');
      if (invalid) { invalid.focus(); throw new Error('请按参数的允许范围填写'); }
      await useCanvasStore.getState().patchesSaved();
      const current = useCanvasStore.getState().nodes[node.id];
      const edit = editSettingsOf(current.edit, current.slots.length);
      const candidate = edit.candidate && current.messages[edit.candidate.messageId];
      if (edit.candidate && (!candidate || (!edit.source && !candidate.parsed?.prompts[edit.candidate.promptIndex]))) throw new Error('候选已经不存在，请重新选择或复用文字');
      if (candidate && !edit.source) {
        const origin = candidate.slotSnapshot[candidate.edit?.slot ?? edit.slot];
        if (!origin || !current.slots.includes(origin)) throw new Error('候选绑定的原图已不在当前素材中；请恢复原图，或明确复用文字到当前设置');
      }
      const blocked = editStartBlock(current, edit);
      if (blocked) throw new Error(blocked);
      const mask = edit.fn === 'inpaint' ? await drawnMask(current, current.slots[edit.slot]) : undefined;
      if (edit.fn === 'inpaint' && !mask) throw new Error('请为当前原图绘制有效掩码');
      const job = await startEdit(node.id, { ...(mask && { mask }) });
      if (job) showEditTab(node.id, 'results');
    } catch (err) {
      setError((err as Error).message); showEditTab(node.id, 'execute');
    } finally { setSending(false); }
  };
  return (
    <div className="edit-node-ui" id="editStartBar">
      <div className="edit-startrow">
        <button type="button" className="btn btn-primary" id="editStart" data-od-id="edit-start" disabled={sending} onClick={() => void run()}><Icon name="send" />{sending ? '正在提交…' : '开始改图'}</button>
        <span className="edit-status" id="editRunStatus" aria-live="polite">{live ? live.images.some((i) => i.status === 'running') ? '正在生成' : '等待执行资源' : '原图和历史保留'}</span>
      </div>
      {error && <div className="wb-note error" role="alert" id="editDockError">{error}</div>}
    </div>
  );
}

export function Field({ id, label, help, children }: { id?: string; label: string; help?: string; children: ReactNode }) {
  return <div className="wb-field"><label htmlFor={id}>{label}</label>{children}{help && <span className="hint">{help}</span>}</div>;
}
function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="wb-section"><div className="wb-sectionhead"><h3>{title}</h3></div>{children}</section>; }
function Note({ children, warning = false }: { children: ReactNode; warning?: boolean }) { return <div className={`wb-note${warning ? ' warning' : ''}`}>{children}</div>; }
function NumberField({ id, label, value, min, max, step = 1, onSet, help }: { id: string; label: string; value: number; min: number; max: number; step?: number; onSet: (n: number) => void; help?: string }) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(String(value)); setInvalid(false); }, [value]);
  return <Field id={id} label={label} help={help}><input id={id} type="number" value={draft} min={min} max={max} step={step} aria-invalid={invalid} onChange={(e) => {
    setDraft(e.target.value);
    const n = e.target.valueAsNumber;
    const bad = !e.target.validity.valid || !Number.isFinite(n);
    setInvalid(bad); if (!bad) onSet(n);
  }} /></Field>;
}

function Execution({ node }: { node: ChatNode }) {
  const edit = editSettingsOf(node.edit, node.slots.length);
  const fn = editFnOf(edit.fn);
  const images = useCanvasStore((s) => s.detail?.images);
  const busy = useCanvasStore((s) => Boolean(s.streams[node.id]) || Boolean(s.detail?.nodes.find((n) => n.id === node.id)?.generating));
  const options = useComfyStore((s) => s.options);
  const [maskOpen, setMaskOpen] = useState(false);
  const [savingCandidate, setSavingCandidate] = useState(false);
  const [seedDraft, setSeedDraft] = useState(edit.seed ?? 1834201172);
  const [customSize, setCustomSize] = useState(false);
  useEffect(() => { if (edit.seed != null) setSeedDraft(edit.seed); }, [edit.seed]);
  useEffect(() => { void useComfyStore.getState().loadOptions(); }, []);
  const entries = activePath(node).filter((m) => m.role === 'assistant').flatMap((message) => (message.parsed?.prompts ?? []).map((box) => ({ message, box })));
  const textNeeded = fn.writes && !(edit.fn === 'real' && edit.real.reverse);
  const candidateValue = edit.candidate ? `${edit.candidate.messageId}:${edit.candidate.promptIndex}` : '';
  const clearCandidate = () => void patch(node, { candidate: null, source: null });
  const saveCandidate = async () => {
    if (!edit.text.trim()) return toast('请先填写编辑文字', { tone: 'warn' });
    if (savingCandidate) return;
    setSavingCandidate(true);
    try {
      await useCanvasStore.getState().patchesSaved();
      const before = Object.keys(useCanvasStore.getState().nodes[node.id].messages);
      const ok = edit.candidate
        ? await useCanvasStore.getState().editPrompt(node.id, edit.candidate.messageId, edit.candidate.promptIndex, edit.text)
        : await useCanvasStore.getState().writeBox(node.id, edit.text);
      if (!ok) return;
      const current = useCanvasStore.getState().nodes[node.id];
      const message = activePath(current).find((m) => m.role === 'assistant' && !before.includes(m.id));
      if (message) await useEditCandidate(current, message, edit.candidate?.promptIndex ?? 0);
      showEditTab(node.id, 'create');
      toast('已保存候选版本，原版本与结果保留');
    } finally { setSavingCandidate(false); }
  };
  const candidate = edit.candidate && node.messages[edit.candidate.messageId];
  const original = candidate && candidate.slotSnapshot[candidate.edit?.slot ?? edit.slot];
  const missingOrigin = Boolean(candidate && !edit.source && (!original || !node.slots.includes(original)));
  const patchReal = (real: Partial<EditSettings['real']>) => void patch(node, { real });
  const size = edit.fourview ?? { width: 1536, height: 1024 };
  const preset = customSize ? 'custom' : size.width === 1536 && size.height === 1024 ? '1536x1024' : size.width === 1024 && size.height === 1024 ? '1024x1024' : 'custom';
  return (
    <>
      {(textNeeded || edit.fn === 'fourview') && <Section title="执行文字">
        {entries.length ? <Field id="wbCandidate" label="执行候选" help="新回复不会自动覆盖执行文字；选择候选后再执行。">
          <select id="wbCandidate" value={candidateValue} onChange={(e) => {
            const selected = entries.find((x) => `${x.message.id}:${x.box.index}` === e.target.value);
            if (selected) void useEditCandidate(node, selected.message, selected.box.index); else clearCandidate();
          }}><option value="">直接填写 · 未选择候选</option>{entries.map((x, i) => <option key={`${x.message.id}:${x.box.index}`} value={`${x.message.id}:${x.box.index}`}>{i + 1} · {x.box.label || '提示词'}</option>)}</select>
        </Field> : <Note>还没有候选。可以直接手写执行文字，或在「创作」中辅助编写。</Note>}
        {missingOrigin && <Note warning>候选绑定的原图已不在当前素材中；请恢复原图，或复用文字到当前设置。</Note>}
        <Field id="wbText" label={`${edit.fn === 'fourview' ? '额外要求（选填）' : edit.fn === 'inpaint' ? '区域内容' : edit.fn === 'outfit' ? '服装要求' : edit.fn === 'real' ? '手输提示词' : edit.fn === 'depth' || edit.fn === 'remix' ? '新画面描述' : '编辑指令'}${textNeeded && edit.fn !== 'fourview' ? ' *' : ''}`} help={fn.desc}>
          <textarea id="wbText" rows={3} data-od-id="edit-text" value={edit.text} onChange={(e) => void patch(node, { text: e.target.value })} />
        </Field>
        <button type="button" className="btn btn-secondary" disabled={busy || savingCandidate} onClick={() => void saveCandidate()}><Icon name="doc" />{savingCandidate ? '正在保存…' : '保存候选'}</button>
        <button type="button" className="btn btn-secondary" onClick={() => {
          showEditTab(node.id, 'create');
          if (edit.text.trim()) void useCanvasStore.getState().patchNode(node.id, { draft: edit.text });
        }}><Icon name="brain" />辅助编写</button>
        <button type="button" className="btn btn-secondary" onClick={clearCandidate}><Icon name="copy" />复用文字</button>
      </Section>}
      <Section title="操作参数">
        {edit.fn === 'real' && <>
          <div className="wb-columns">
            <Field id="wbDual" label="图像模式"><select id="wbDual" value={edit.real.dual ? 'dual' : 'single'} onChange={(e) => patchReal({ dual: e.target.value === 'dual' })}><option value="single">单图</option><option value="dual">双图</option></select></Field>
            <Field id="wbPromptSource" label="提示词来源"><select id="wbPromptSource" value={edit.real.reverse ? 'interrogate' : 'manual'} onChange={(e) => patchReal({ reverse: e.target.value === 'interrogate' })}><option value="manual">手输</option><option value="interrogate">反推图 1</option></select></Field>
          </div>
          {edit.real.dual && <>
            <Field id="wbRef2" label="人物外观参考" help="只参与生成，反推仍只读取原图。"><select id="wbRef2" value={edit.slotB === edit.slot ? '' : String(edit.slotB)} onChange={(e) => void patch(node, { slotB: e.target.value ? Number(e.target.value) : edit.slot })}><option value="">未指定 · 按现行规则回退</option>{node.slots.map((id, i) => i !== edit.slot && <option key={id} value={i}>图 {i + 1} · {images?.[id]?.originalName ?? id}</option>)}</select></Field>
            {edit.slotB === edit.slot && <Note warning>当前未指定不同的外观参考，执行时由原图兼作参考。</Note>}
            <NumberField id="wbStrength" label="真人参考强度" value={edit.real.image2Strength} min={0} max={1} step={0.1} onSet={(n) => patchReal({ image2Strength: n })} help="强度不代表身份相似度保证。" />
          </>}
          {edit.real.reverse && <Note>反推只读取原图，输出独立记录并作为生成提示词；不会与手输文字混合。</Note>}
          <NumberField id="wbInterrogateSeed" label="反推种子" value={edit.real.reverseSeed ?? REVERSE_SEED} min={0} max={Number.MAX_SAFE_INTEGER} onSet={(n) => patchReal({ reverseSeed: n })} />
          <div className="wb-contract"><strong>标准执行契约</strong>Moody-Mix premium · FP8 文字理解<br />V3 转真人 LoRA + k2_nice_body<br />Easy_QwenEdit2509 · 8 步 · CFG 1 · euler · beta57<br />实际长边 1536；通用宽高不改变输出尺寸。</div>
        </>}
        {edit.fn === 'inpaint' && <>
          <button type="button" className="btn btn-secondary" id="wbMaskEditor" onClick={() => node.slots[edit.slot] ? setMaskOpen(true) : toast('请先选择原图', { tone: 'warn' })}><Icon name="edit" />编辑掩码</button>
          <Note warning={!edit.maskShapes || edit.maskShapes.imageId !== node.slots[edit.slot]}>{edit.maskShapes?.imageId === node.slots[edit.slot] && !maskIsEmpty(edit.maskShapes) ? '掩码已保存 · 与当前原图绑定' : '还没有有效掩码；请涂出要重画的区域。'}</Note>
          <NumberField id="wbFeather" label="羽化范围（像素）" value={edit.inpaint.feather ?? 32} min={0} max={128} step={4} onSet={(n) => void patch(node, { inpaint: { feather: n } })} />
          <NumberField id="wbDenoise" label="区域重绘强度" value={edit.inpaint.denoise} min={0} max={1} step={0.05} onSet={(n) => void patch(node, { inpaint: { denoise: n } })} />
        </>}
        {edit.fn === 'depth' && <><NumberField id="wbControl" label="深度控制强度 *" value={edit.depth.strength} min={0.1} max={2} step={0.1} onSet={(n) => void patch(node, { depth: { strength: n } })} /><Note>实际输出 1024 × 1024；通用宽高不适用。</Note></>}
        {edit.fn === 'remix' && <>
          <Field id="wbVariant" label="操作变体"><select id="wbVariant" value={edit.remix.lora.name === REMIX_LORAS[1].name ? 'RealCosplay' : 'ReID'} onChange={(e) => void patch(node, { remix: { lora: { name: REMIX_LORAS[e.target.value === 'RealCosplay' ? 1 : 0].name } } })}><option>ReID</option><option>RealCosplay</option></select></Field>
          <Field id="wbLora" label="对应 LoRA *"><input id="wbLora" value={edit.remix.lora.name} onChange={(e) => void patch(node, { remix: { lora: { name: e.target.value } } })} /></Field>
          <Note>实际输出 1024 × 1024。</Note>
        </>}
        {edit.fn === 'outfit' && <Field id="wbLora" label="换装 LoRA" help="沿用换装专用工作流与依赖。"><input id="wbLora" value={edit.outfitLora ?? ''} placeholder="krea2/krea_outfittransfer.safetensors" onChange={(e) => void patch(node, { outfitLora: e.target.value })} /></Field>}
        {edit.fn === 'upscale' && <>
          <Field id="wbScale" label="放大倍率"><select id="wbScale" value={edit.upscale.scale} onChange={(e) => void patch(node, { upscale: { scale: Number(e.target.value) } })}>{edit.upscale.scale === 1.5 && <option value="1.5">1.5 倍（历史设置）</option>}<option value="2">2 倍</option><option value="4">4 倍</option></select></Field>
          <Field id="wbUpscaler" label="放大模型"><select id="wbUpscaler" value={edit.upscale.model} onChange={(e) => void patch(node, { upscale: { model: e.target.value } })}><option value="">使用当前环境的默认模型</option>{[...new Set([edit.upscale.model, ...(options?.upscaleModels ?? [])])].filter(Boolean).map((name) => <option key={name}>{name}</option>)}</select></Field>
          <Field id="wbFace" label="面部修复"><select id="wbFace" value={edit.upscale.face ? 'on' : 'off'} onChange={(e) => {
            const detector = options?.detectors.find((name) => /face/i.test(name)) ?? options?.detectors[0];
            if (e.target.value === 'on' && !detector) return toast('当前环境缺少面部检测模型', { tone: 'warn' });
            void patch(node, { upscale: { face: e.target.value === 'on' ? detector! : '' } });
          }}><option value="off">关闭</option><option value="on">单独启用</option></select></Field>
          <Note>基础放大重绘强度：0。面部修复是额外阶段。</Note>
        </>}
        {edit.fn === 'fourview' && <>
          <Field id="wbFourPreset" label="尺寸预设"><select id="wbFourPreset" value={preset} onChange={(e) => { setCustomSize(e.target.value === 'custom'); if (e.target.value !== 'custom') { const [width, height] = e.target.value.split('x').map(Number); void patch(node, { fourview: { width, height } }); } }}><option value="1536x1024">1536 × 1024</option><option value="1024x1024">1024 × 1024</option><option value="custom">自定义</option></select></Field>
          <div className="wb-columns"><NumberField id="wbFourW" label="宽度" value={size.width} min={256} max={4096} step={8} onSet={(width) => void patch(node, { fourview: { ...size, width } })} /><NumberField id="wbFourH" label="高度" value={size.height} min={256} max={4096} step={8} onSet={(height) => void patch(node, { fourview: { ...size, height } })} /></div>
          <Note>固定主指令负责四个视角；额外要求仅追加，空白也可执行。</Note>
        </>}
        {edit.fn === 'edit' && <Note>Krea2 编辑工作流 · 原图 + 编辑指令</Note>}
      </Section>
      <Section title="种子与任务"><div className="wb-columns">
        <Field id="wbSeedMode" label="出图种子"><select id="wbSeedMode" value={edit.seed == null ? 'random' : 'fixed'} onChange={(e) => void patch(node, { seed: e.target.value === 'fixed' ? seedDraft : null })}><option value="random">随机</option><option value="fixed">固定</option></select></Field>
        <NumberField id="wbSeed" label="种子" value={edit.seed ?? seedDraft} min={0} max={2147483647} onSet={(seed) => { setSeedDraft(seed); if (edit.seed != null) void patch(node, { seed }); }} />
      </div><Note>当前设置只影响新任务；已提交任务保留独立快照。</Note></Section>
      <p className="wb-caption">任务快照独立保存，历史参数保持原样。</p>
      {maskOpen && <MaskDialog key={node.slots[edit.slot]} node={node} onClose={() => setMaskOpen(false)} />}
    </>
  );
}

function MaskDialog({ node, onClose }: { node: ChatNode; onClose: () => void }) {
  const edit = editSettingsOf(node.edit, node.slots.length);
  const imageId = node.slots[edit.slot];
  const [shapes, setShapes] = useState<MaskShapes>(() => edit.maskShapes?.imageId === imageId ? edit.maskShapes : EMPTY_MASK);
  return <Dialog className="edit-node-dialog" label="局部重绘掩码" onClose={onClose}>
    <div className="dialog-head"><h2>局部重绘掩码</h2><button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={onClose}><Icon name="x" /></button></div>
    <div className="dialog-body"><p className="wb-note">涂出要重画的区域；未涂区域及羽化范围外保留原像素。</p><MaskEditor src={imageFileUrl(node.canvasId, imageId)} value={shapes} onChange={setShapes} initialTool="brush" /></div>
    <div className="dialog-foot"><button type="button" className="btn btn-secondary" onClick={onClose}>取消</button><button type="button" className="btn btn-primary" disabled={maskIsEmpty(shapes)} onClick={() => void patch(node, { maskShapes: { imageId, ...shapes } }).then((ok) => ok && onClose())}>保存掩码</button></div>
  </Dialog>;
}

function ContextDialog({ node }: { node: ChatNode }) {
  const close = () => useEditWorkspace.setState({ context: null });
  const [rounds, setRounds] = useState(String(node.turnLimit ?? 'follow'));
  const [thinking, setThinking] = useState(node.thinking ?? 'follow');
  return <Dialog className="edit-node-dialog" label="上下文与思考" onClose={close}>
    <div className="dialog-head"><h2>上下文与思考</h2><button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={close}><Icon name="x" /></button></div>
    <div className="dialog-body"><Field id="wbRounds" label="下次请求保留轮数"><select id="wbRounds" value={rounds} onChange={(e) => setRounds(e.target.value)}><option value="follow">跟随全局默认</option>{TURN_LIMIT_CHOICES.map((limit) => <option key={limit} value={String(limit)}>{turnLimitLabel(limit)}</option>)}</select></Field><Field id="wbThinking" label="本节点思考"><select id="wbThinking" value={thinking} onChange={(e) => setThinking(e.target.value as typeof thinking)}><option value="follow">跟随全局与用途默认</option>{Object.entries(LEVEL_LABELS).map(([level, label]) => <option key={level} value={level}>{label}</option>)}</select></Field><Note>修改只影响下次辅助编写，历史和任务快照保留。</Note></div>
    <div className="dialog-foot"><button type="button" className="btn btn-primary" onClick={() => void useCanvasStore.getState().patchNode(node.id, { turnLimit: rounds === 'follow' ? 'follow' : turnLimitOf(rounds), thinking }).then((ok) => ok && close())}>应用</button></div>
  </Dialog>;
}
