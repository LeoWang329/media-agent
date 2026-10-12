export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage = { role: string; content: string | ContentPart[] | null };

export type MockPlan = { reply: string; userText: string; fail: boolean; slow: boolean };

export function toParts(content: ChatMessage['content']): ContentPart[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? []);
}

// 回复内容由请求决定，测试靠它断言，规则见 docs/dev-plan.md 9.1
export function planReply(messages: ChatMessage[]): MockPlan {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const parts = toParts(lastUser?.content ?? null);
  const texts = parts.flatMap((p) => (p.type === 'text' ? [p.text] : []));
  const userText = texts.join('\n');

  // 翻译提示词框：系统消息里写着「翻译成某种语言」，回复标出语言和要求，后面接原文
  const system = toParts(messages.find((m) => m.role === 'system')?.content ?? null)
    .flatMap((p) => (p.type === 'text' ? [p.text] : []))
    .join('\n');
  const language = system.match(/翻译成([^\s。，,]+)/)?.[1];
  if (language) {
    const requirement = system.match(/用户对这次翻译的要求[^\n]*\n([\s\S]*)$/)?.[1].trim();
    const reply = [`译文（${language}）${requirement ? `，按要求：${requirement}` : ''}`, userText].join('\n');
    return { reply, userText, fail: userText.includes('报错'), slow: userText.includes('慢') };
  }

  // 中文转标签（标签编辑窗里「让 AI 转成标签」）：只回一串标签
  if (system.includes('转成 Danbooru 标签')) return { reply: 'sitting, window, book, reading', userText, fail: false, slow: false };
  // 生图节点：系统消息带着生图的固定格式要求，框里是一串标签。blond hair 是官方别名，goldish hair 词库里没有。
  // 按格式要求里的话认哪一套：系统提示词是能被整套换掉的（docs/prompts/ 复制进工作文件夹后随便改），
  // 拿提示词的措辞来认会一改就崩——Krea2 认「框里只放一段英文自然语言描述」，IL/Pony 认「框里只放英文标签」
  const krea = system.includes('框里只放一段英文自然语言描述');
  const image = krea || system.includes('框里只放英文标签');
  // 图像编辑节点：四套编辑提示词共用一份固定格式要求，认「一个字都不会被程序改动」。
  // 哪个功能看提示词标题里的「（指令编辑）」这类；认不出按指令编辑算
  const edit = system.includes('一个字都不会被程序改动') ? editFnOf(system) : '';

  const pictureLabels: string[] = [];
  let imageCount = 0;
  parts.forEach((part, i) => {
    if (part.type !== 'image_url') return;
    imageCount += 1;
    const before = parts[i - 1];
    const label = before?.type === 'text' ? before.text.trim().match(/^<(Picture|Video) \d+>$/)?.[0] : undefined;
    if (label) pictureLabels.push(label);
  });

  const allImages = messages.flatMap((m) => toParts(m.content)).filter((p) => p.type === 'image_url').length;
  const lines = [
    image ? '<title>测试图片</title>' : '<title>测试标题</title>',
    imageCount ? `收到 ${imageCount} 张图：${pictureLabels.join('、')}` : '收到 0 张图',
    `说明：${texts[0] ?? ''}`,
    `历史消息 ${messages.filter((m) => m.role !== 'system').length} 条`,
    `请求里一共 ${allImages} 张图`,
  ];
  if (!userText.includes('只回答')) {
    const segments = segmentCount(messages);
    const box = edit
      ? (_summary: string, label?: string) => editBox(edit, label)
      : krea
        ? (_summary: string, label?: string) => [label ? `<prompt label="${label}">` : '<prompt>', 'An adult woman stands by a sunlit window. Warm light reveals the woven texture of her jacket, with a quiet street visible behind her.', '</prompt>'].join('\n')
        : image
          ? tagBox
          : (summary: string, label?: string) => promptBox(summary, label, segments);
    const boxes = userText.includes('三个方向')
      ? ['一', '二', '三'].map((n) => box(`测试概述（方向${n}）`, `方向${n}：测试方向${n}`))
      : userText.includes('几个方向')
        ? ['一', '二'].map((n) => box(`测试概述（方向${n}）`, `方向${n}：测试方向${n}`))
        : [box('测试概述')];
    for (const box of boxes) lines.push('', box);
  }

  return { reply: lines.join('\n'), userText, fail: userText.includes('报错'), slow: userText.includes('慢') };
}

// 视频节点的长视频分几段：看最近一次说时长的说明，写了「分 N 段生成」就是 N 段，没写是 1 段
function segmentCount(messages: ChatMessage[]): number {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue;
    const note = toParts(message.content).find((part) => part.type === 'text');
    const said = note?.type === 'text' ? note.text.match(/视频时长(?:改为)? \d+ 秒(?:，分 (\d+) 段生成)?/) : null;
    if (said) return Number(said[1] ?? 1);
  }
  return 1;
}

// 分段时每段都是一份完整的提示词，段与段之间单独一行 |
function promptBox(summary: string, label?: string, segments = 1): string {
  const segment = (n: number) => [
    'subject_definitions:',
    '<Subject 1> 是 <Picture 1> 里的测试主体。',
    '',
    'summary:',
    `[reference generation] ${summary}${segments > 1 ? `，第 ${n} 段` : ''}，引用了 <Picture 1>`,
    '',
    'retention_analysis:',
    '<Subject 1>（出现在 [Shot 1]）：fully_preserved - 测试主体保留。',
    '',
    'detailed_description:',
    '写实风格，室内暖光。',
    '[Shot 1] 中景，<Subject 1> 站在画面中间，镜头保持固定。',
    '',
    'overall_soundscape:',
    '安静的室内底噪。',
    '',
    'non_diegetic_music:',
    'N/A',
  ];
  const body = Array.from({ length: segments }, (_, i) => segment(i + 1).join('\n')).join('\n|\n');
  return [label ? `<prompt label="${label}">` : '<prompt>', body, '</prompt>'].join('\n');
}

function tagBox(_summary: string, label?: string): string {
  return [label ? `<prompt label="${label}">` : '<prompt>', '1girl, solo, long hair, blond hair, goldish hair, smile, hatsune miku', '</prompt>'].join('\n');
}

// 系统提示词标题里的功能名：编辑节点每个功能一套提示词，回复内容按功能各不相同，测试靠这个断言换功能真的换了
const EDIT_FNS = ['指令编辑', '换装', '局部重绘', '转真人'] as const;
type EditFn = (typeof EDIT_FNS)[number];

function editFnOf(system: string): EditFn {
  return EDIT_FNS.find((name) => system.includes(`（${name}）`)) ?? '指令编辑';
}

// 编辑节点的框：框里就是直接发给 ComfyUI 的那句话，四个功能各写一句不一样的
function editBox(fn: EditFn, label?: string): string {
  const body: Record<EditFn, string> = {
    指令编辑: 'Change her coat into a black studded leather biker jacket, keep her face, hair and the background exactly the same.',
    换装: 'Dress her in a red silk evening gown, keep her face, hair and pose exactly the same.',
    局部重绘: 'a white ceramic coffee cup on the wooden table',
    转真人: 'natural skin texture, film photograph, soft window light',
  };
  return [label ? `<prompt label="${label}">` : '<prompt>', body[fn], '</prompt>'].join('\n');
}
