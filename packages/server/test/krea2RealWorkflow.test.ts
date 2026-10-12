import { defaultRealSettings, kreaDefaults, kreaGraph, realLorasOf, REVERSE_PROMPT, REVERSE_PROMPT_DUAL, type ComfyGraph, type ImageJobParams } from '@media-agent/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 用户提供的标准 API 工作流，只替换了示例图名、手输示例，移除了 ShowText 的旧显示缓存。
const STANDARD: ComfyGraph = JSON.parse(readFileSync(new URL('../../../tests/fixtures/workflows/krea2-real-standard.json', import.meta.url), 'utf8'));

// 按 ComfyUI 的开关和 rgthree 的 LoRA 栈语义解析连线；忽略节点 id，比较实际执行链及每个输入。
function resolved(graph: ComfyGraph, id: string, output = 0): unknown {
  const node = graph[id];
  const valueOf = (value: unknown): unknown => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && graph[value[0]] && typeof value[1] === 'number'
    ? resolved(graph, value[0], value[1]) : value;
  if (node.class_type === 'LayerUtility: Boolean') return node.inputs.bool_value;
  if (node.class_type === 'PrimitiveStringMultiline') return node.inputs.value;
  if (node.class_type === 'LazySwitchKJ') return valueOf(node.inputs[valueOf(node.inputs.switch) ? 'on_true' : 'on_false']);
  if (node.class_type === 'Lora Loader Stack (rgthree)') {
    let model = valueOf(node.inputs.model);
    let clip = valueOf(node.inputs.clip);
    for (const slot of ['01', '02', '03', '04']) {
      const name = node.inputs[`lora_${slot}`];
      const strength = node.inputs[`strength_${slot}`];
      if (name === 'None' || strength === 0) continue;
      const inputs = { model, clip, lora_name: name, strength_model: strength, strength_clip: strength };
      model = { class_type: 'LoraLoader', inputs, output: 0 };
      clip = { class_type: 'LoraLoader', inputs, output: 1 };
    }
    return output === 0 ? model : clip;
  }
  return { class_type: node.class_type, inputs: Object.fromEntries(Object.entries(node.inputs).map(([key, value]) => [key, valueOf(value)])), output };
}

describe('转真人实际执行链与用户标准工作流一致', () => {
  for (const reverse of [false, true]) for (const dual of [false, true]) {
    it(`${reverse ? '反推' : '手输'} + ${dual ? '双图' : '单图'}：模型、LoRA、图像处理、采样、保存和提示词出口一致`, () => {
      const standard = structuredClone(STANDARD);
      standard['344'].inputs.bool_value = reverse;
      standard['345'].inputs.bool_value = dual;
      // 附件未带 WorkflowNotes 所读取的 UI 备注正文：使用现有项目的两份指令作为备注输入。
      standard['352'].inputs.system_prompt = dual ? REVERSE_PROMPT_DUAL : REVERSE_PROMPT;
      const real = { ...defaultRealSettings(), reverse, dual };
      const image = kreaDefaults('real');
      const params: ImageJobParams = {
        family: 'Krea2', positive: String(standard['346'].inputs.value), negative: '', workflow: { id: null, name: '内置流程', hash: '' },
        checkpoint: image.checkpoint!, textEncoder: image.textEncoder, vae: image.vae!, loras: [],
        width: image.width!, height: image.height!, steps: image.steps!, cfg: image.cfg!, sampler: image.sampler!, scheduler: image.scheduler!,
        krea: image.krea, real: { reverse, dual, image2Strength: real.image2Strength, loras: realLorasOf(real), uncensored: real.uncensored },
      };
      const actual = kreaGraph(params, Number(standard['221'].inputs.seed), 'scene.png', 'identity.png');
      for (const [type, id] of [['KSampler', '221'], ['SaveImage', '228'], ['ShowText|pysssss', '353']]) {
        const entry = Object.entries(actual).find(([, node]) => node.class_type === type);
        expect(entry, `缺少标准节点 ${type}`).toBeTruthy();
        expect(resolved(actual, entry![0])).toEqual(resolved(standard, id));
      }
      if (!reverse) expect(Object.values(actual).some((node) => node.class_type.startsWith('llama_cpp'))).toBe(false);
      if (!dual) expect(Object.values(actual).filter((node) => node.class_type === 'LoadImage')).toHaveLength(1);
    });
  }
});
