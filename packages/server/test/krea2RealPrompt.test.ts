import { REVERSE_PROMPT, REVERSE_PROMPT_DUAL, realModelsOf, REVERSE_LOADER, REVERSE_PARAMETERS, REAL_REVERSE_MODEL } from '@media-agent/shared';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 反推那两份系统提示词的原文只维护 docs/krea2-real-reverse-prompt.md（那份**不放** docs/prompts/：
// 那个目录里的 .md 会被当成可选系统提示词复制进工作文件夹）。代码里那两份常量得跟它一字不差。
// 这条放 server 这边测：shared 的 tsconfig 是 `types: []`，读不了文件，见 packages/shared/test/krea2Real.test.ts
const DOC = fileURLToPath(new URL('../../../docs/krea2-real-reverse-prompt.md', import.meta.url));

// 文档里那两个 ```text 代码块，按出现顺序
function textBlocks(): string[] {
  const found: string[] = [];
  let current: string[] | null = null;
  for (const line of readFileSync(DOC, 'utf8').split(/\r?\n/)) {
    if (/^```text\s*$/.test(line)) {
      current = [];
      continue;
    }
    if (current && /^```\s*$/.test(line)) {
      found.push(current.join('\n'));
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  return found;
}

describe('反推的系统提示词跟文档对齐', () => {
  it('文档里是单图、双图两个代码块，代码里那两份跟它们一模一样（漂了就挂这里）', () => {
    const [single, dual] = textBlocks();
    expect(single, 'docs/krea2-real-reverse-prompt.md 里应该有两个 ```text 代码块').toBeTruthy();
    expect(dual).toBeTruthy();
    // 先认出哪块是哪块（单图那块没有双图触发词），免得文档顺序换了还照样绿
    expect(single).not.toContain('TWO IMAGES');
    expect(dual).toContain('TWO IMAGES');
    expect(REVERSE_PROMPT).toBe(single);
    expect(REVERSE_PROMPT_DUAL).toBe(dual);
  });

  it('反推那两个节点上的参数就是调研里那一串', () => {
    // 模型 / mmproj 是那台上现成的两个文件，chat_handler 是 Qwen3.6
    expect(REAL_REVERSE_MODEL).toEqual({
      model: 'Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf',
      mmproj: 'mmproj-Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-f16.gguf',
      chatHandler: 'Qwen3.6',
    });
    expect(REVERSE_LOADER).toMatchObject({ n_ctx: 8192, vram_limit: -1, image_min_tokens: 0, image_max_tokens: 0, load_mtp: false });
    expect(REVERSE_PARAMETERS).toMatchObject({ max_tokens: 512, temperature: 0.6, repeat_penalty: 1.1, mirostat_mode: 0, state_uid: -1 });
  });

  it('转真人的模型组合按用户标准，两种旧保存标记都不再改变组合', () => {
    const standard = { checkpoint: 'krea2/Krea2-Moody-Mix-premium_int8_convrot.safetensors', textEncoder: 'qwen3vl_4b_fp8_scaled.safetensors' };
    expect(realModelsOf(true)).toEqual(standard);
    expect(realModelsOf(false)).toEqual(standard);
  });
});
