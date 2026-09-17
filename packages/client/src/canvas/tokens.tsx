import type { CanvasImage } from '@media-agent/shared';
import { Fragment, memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Images = Record<string, CanvasImage> | undefined;

// 行内标记原样显示，只换字色：<d>台词</d>、<Picture N>、<Subject N>、[Shot N] At 时间点、任务类型、保留程度
const TOKEN =
  /<d>([\s\S]*?)<\/d>|<Picture (\d+)>|<Subject \d+>|\[Shot \d+\](?: At \d\d:\d\d\.\d{3})?|\[(?:reference generation|keyframe completion|video editing|video continuation|audio reuse|audio reference)(?: \+ [a-z ]+)*\]|\b(?:fully_preserved|partially_preserved|weak_reference)\b/g;

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'd'; inner: string }
  | { kind: 'pic'; text: string; number: number }
  | { kind: 'sub' | 'shot' | 'type'; text: string };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    const [whole, inner, picture] = match;
    if (inner !== undefined) out.push({ kind: 'd', inner });
    else if (picture !== undefined) out.push({ kind: 'pic', text: whole, number: Number(picture) });
    else if (whole.startsWith('<Subject')) out.push({ kind: 'sub', text: whole });
    else if (whole.startsWith('[Shot')) out.push({ kind: 'shot', text: whole });
    else out.push({ kind: 'type', text: whole });
    last = match.index + whole.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

// <Picture N> 的悬停说明：imgs 是这条消息当时带的图，没传就不说是哪张
function pictureTitle(number: number, imgs: string[] | undefined, images: Images) {
  if (!imgs) return { missing: false, title: undefined };
  const id = imgs[number - 1];
  if (!id) return { missing: true, title: `这条只带了 ${imgs.length} 张图，没有 ${number} 号` };
  return { missing: false, title: `${number} 号：${images?.[id]?.originalName ?? ''}` };
}

export function tokens(text: string, imgs?: string[], images?: Images): ReactNode {
  return tokenize(text).map((token, i) => {
    switch (token.kind) {
      case 'text':
        return <Fragment key={i}>{token.text}</Fragment>;
      case 'd':
        return (
          <span key={i} className="tk-d">
            <span className="tk-tag">&lt;d&gt;</span>
            {tokens(token.inner, imgs, images)}
            <span className="tk-tag">&lt;/d&gt;</span>
          </span>
        );
      case 'pic': {
        const { missing, title } = pictureTitle(token.number, imgs, images);
        return (
          <span key={i} className={`tk tk-pic${missing ? ' is-missing' : ''}`} title={title}>
            {token.text}
          </span>
        );
      }
      default:
        return (
          <span key={i} className={`tk tk-${token.kind}`}>
            {token.text}
          </span>
        );
    }
  });
}

// 剧本排法：行首的镜头号（连同时间点）、主体号、图片号放进左栏，正文在右栏
const SECTION = /^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music):\s*$/;
const LEAD = /^(\[Shot \d+\])(?: (At \d\d:\d\d\.\d{3},?))?\s*|^(<(?:Subject|Picture) \d+>)\s*/;

function promptLine(line: string, key: number, imgs: string[] | undefined, images: Images) {
  const match = line.match(LEAD);
  if (!match) {
    return (
      <div key={key} className="pb-line">
        {tokens(line, imgs, images)}
      </div>
    );
  }
  return (
    <div key={key} className={`pb-row${match[1] ? ' is-shot' : ''}`}>
      <div className="pb-gut">
        {match[1] ? (
          <>
            <span className="pb-shot">{match[1]}</span>
            {match[2] && <span className="pb-tc">{match[2]}</span>}
          </>
        ) : (
          tokens(match[3], imgs, images)
        )}
      </div>
      <div className="pb-line">{tokens(line.slice(match[0].length), imgs, images)}</div>
    </div>
  );
}

// 提示词框里的正文：按 summary: 这些小节分段，空行不占地方
export function promptBody(text: string, imgs: string[] | undefined, images: Images): ReactNode[] {
  const out: ReactNode[] = [];
  let section: { key: string; lines: ReactNode[] } | null = null;
  const closeSection = () => {
    if (!section) return;
    out.push(
      <div key={`s${out.length}`} className="pb-sec">
        <div className="pb-key">{section.key}</div>
        {section.lines}
      </div>,
    );
    section = null;
  };
  text.split('\n').forEach((line, i) => {
    if (SECTION.test(line)) {
      closeSection();
      section = { key: line, lines: [] };
    } else if (line.trim()) {
      const row = promptLine(line, i, imgs, images);
      if (section) section.lines.push(row);
      else out.push(row);
    }
  });
  closeSection();
  return out;
}

// ─── 框外的文字：Markdown，里面的标记照样换字色 ───────────────

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

const element = (tagName: string, className: string, children: HastNode[], title?: string): HastNode => ({
  type: 'element',
  tagName,
  properties: { className: className.split(' '), ...(title && { title }) },
  children,
});
const textNode = (value: string): HastNode => ({ type: 'text', value });

function tokenNodes(text: string, imgs: string[] | undefined, images: Images): HastNode[] {
  return tokenize(text).map((token) => {
    switch (token.kind) {
      case 'text':
        return textNode(token.text);
      case 'd':
        return element('span', 'tk-d', [element('span', 'tk-tag', [textNode('<d>')]), ...tokenNodes(token.inner, imgs, images), element('span', 'tk-tag', [textNode('</d>')])]);
      case 'pic': {
        const { missing, title } = pictureTitle(token.number, imgs, images);
        return element('span', `tk tk-pic${missing ? ' is-missing' : ''}`, [textNode(token.text)], title);
      }
      default:
        return element('span', `tk tk-${token.kind}`, [textNode(token.text)]);
    }
  });
}

type TokenOptions = { imgs?: string[]; images: Images; caret: boolean };

const BLOCKS = new Set(['p', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th']);

// 没开 HTML 时 <d> 这类标签是 raw 节点，这里先和相邻文字拼回一段再切标记；代码块里的不动
function rehypeTokens({ imgs, images, caret }: TokenOptions) {
  const walk = (node: HastNode) => {
    if (!node.children || node.tagName === 'code' || node.tagName === 'pre') return;
    const children: HastNode[] = [];
    let buffer = '';
    const flushText = () => {
      if (buffer) children.push(...tokenNodes(buffer, imgs, images));
      buffer = '';
    };
    for (const child of node.children) {
      if (child.type === 'text' || child.type === 'raw') buffer += child.value ?? '';
      else {
        flushText();
        walk(child);
        children.push(child);
      }
    }
    flushText();
    node.children = children;
  };
  return (tree: HastNode) => {
    walk(tree);
    if (!caret) return;
    // 光标跟在最后一段文字后面：顺着最后一个段落、列表项往里找
    let target = tree;
    for (;;) {
      const last = [...(target.children ?? [])].reverse().find((c) => !(c.type === 'text' && !c.value?.trim()));
      if (last?.type !== 'element' || !BLOCKS.has(last.tagName!)) break;
      target = last;
    }
    target.children = [...(target.children ?? []), element('span', 'caret', [])];
  };
}

export const Markdown = memo(function Markdown({ text, imgs, images, caret = false }: { text: string; imgs?: string[]; images: Images; caret?: boolean }) {
  return (
    <div className="intro markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeTokens, { imgs, images, caret }]]}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
