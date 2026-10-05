import { FAMILIES, type ImagePreset, type PresetSettings } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { shortCheckpoint } from '../canvas/imageNode';
import { usePresetStore } from '../store/presetStore';
import { useWorkflowStore } from '../store/workflowStore';
import { confirmBox } from '../ui/confirm';
import { whenDid } from '../ui/format';
import { Icon } from '../ui/Icon';
import { RenameInput } from '../ui/RenameInput';
import { trackWrite } from '../ui/saveState';
import { toast } from '../ui/toast';

// 设置「预设」：出图设置整套存的名字，按系列列出来，能改名、删除；存和套用在节点的出图设置里，见 docs/dev-plan.md 5.21

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger', ms: 4500 });

// 一套预设里有什么，一行写完
function summary(settings: PresetSettings, workflowName: (id: string) => string | undefined): string {
  const size = `${settings.width}×${settings.height}`;
  if (settings.workflowId) return `用导入的工作流「${workflowName(settings.workflowId) ?? '已经删了'}」 · ${size}`;
  const passes = settings.details.filter((pass) => pass.on).length;
  const controls = settings.controls.filter((control) => control.on).length;
  return [
    settings.checkpoint ? shortCheckpoint(settings.checkpoint) : '底模没选',
    ...(settings.vae ? [`VAE ${shortCheckpoint(settings.vae)}`] : []),
    settings.loras.length ? `LoRA ${settings.loras.length} 个${settings.loraTarget === 'model' ? '（只作用在画图的模型）' : ''}` : '没挂 LoRA',
    `${settings.steps} 步 · CFG ${settings.cfg} · ${settings.sampler} · ${settings.scheduler}`,
    ...(settings.weighting === 'a1111' ? ['A1111 权重'] : []),
    ...(controls ? [`ControlNet ${controls} 个`] : []),
    settings.upscale.on ? `放大 ${settings.upscale.scale}×` : '不放大',
    passes ? `部位重绘 ${passes} 道` : '不重绘部位',
    size,
  ].join(' · ');
}

export function PresetsTab({ workFolder }: { workFolder: string | null }) {
  const list = usePresetStore((s) => s.list);
  const workflows = useWorkflowStore((s) => s.list);
  const [renaming, setRenaming] = useState<{ id: string; draft: string; attempt: number } | null>(null);

  useEffect(() => {
    if (!workFolder) return;
    usePresetStore.getState().load().catch(failed);
    useWorkflowStore.getState().load().catch(() => undefined);
  }, [workFolder]);

  if (!workFolder) return <p className="muted">预设存在工作文件夹里，先在「工作文件夹」里选一个。</p>;

  const workflowName = (id: string) => workflows?.find((w) => w.id === id)?.name;

  // 同一个系列里名字重了提示换一个，输入框留着接着改
  const rename = async (preset: ImagePreset, next: string | null) => {
    const name = next?.trim();
    if (!name || name === preset.name) return setRenaming(null);
    if (list?.some((p) => p.id !== preset.id && p.family === preset.family && p.name === name)) {
      toast(`${preset.family} 系列已经有叫「${name}」的预设了，换一个名字`, { tone: 'warn' });
      return setRenaming((r) => ({ id: preset.id, draft: name, attempt: (r?.attempt ?? 0) + 1 }));
    }
    setRenaming(null);
    try {
      usePresetStore.getState().put(await trackWrite(api<ImagePreset>(`/image-presets/${preset.id}`, { method: 'PATCH', body: { name } })));
    } catch (err) {
      failed(err);
    }
  };

  const remove = async (preset: ImagePreset) => {
    const ok = await confirmBox({ title: `删除预设「${preset.name}」？`, body: '套用过它的节点不受影响，各自留着自己的一份出图设置。', ok: '删除', danger: true });
    if (!ok) return;
    try {
      await trackWrite(api(`/image-presets/${preset.id}`, { method: 'DELETE' }));
      usePresetStore.getState().drop(preset.id);
      toast('删掉了');
    } catch (err) {
      failed(err);
    }
  };

  return (
    <>
      <div className="st-head">
        <div>
          <h2>预设</h2>
          <p>出图设置整套存个名字，换着用。在节点的出图设置里「存成预设」「套用预设」；这里能改名、删除。存张数、种子以外的全部设置，按系列分开。</p>
        </div>
      </div>
      {list && !list.length && <p className="muted">还没有预设。在节点的出图设置里点「存成预设」。</p>}
      {FAMILIES.map((family) => {
        const mine = list?.filter((preset) => preset.family === family) ?? [];
        if (!mine.length) return null;
        return (
          <div className="sx-list" key={family} data-od-id={`preset-list-${family}`}>
            <h3 className="sx-sub">{family} 系列</h3>
            {mine.map((preset) => (
              <div className="card sx-wf" key={preset.id} data-preset={preset.id}>
                <div className="sx-wf-top">
                  {renaming?.id === preset.id ? (
                    <RenameInput key={renaming.attempt} value={renaming.draft} className="sx-wf-rename" maxLength={40} onDone={(next) => void rename(preset, next)} />
                  ) : (
                    <b className="sx-wf-name">{preset.name}</b>
                  )}
                  <span className="meta">{whenDid(preset.updatedAt, '改')}</span>
                  <span className="grow" />
                  <button type="button" className="btn btn-ghost btn-sm" data-pa="rename" onClick={() => setRenaming({ id: preset.id, draft: preset.name, attempt: 0 })}>
                    <Icon name="edit" />
                    改名
                  </button>
                  <button type="button" className="btn btn-danger-ghost btn-sm" data-pa="del" onClick={() => void remove(preset)}>
                    <Icon name="trash" />
                    删除
                  </button>
                </div>
                <p className="hint mono">{summary(preset.settings, workflowName)}</p>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
