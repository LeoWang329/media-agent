import type { JSONContent } from '@tiptap/core';

// 编辑器里的图片小标签。文档里存的是 imageId，显示和发送时的编号都按当前槽位现算，
// 所以调完槽位顺序，标签和发出去的 <Picture N> 自动跟着变。
export const PICTURE_REF = 'pictureRef';

const PICTURE_TAG = /<Picture (\d+)>/g;

export const pictureNumber = (imageId: string, slots: string[]) => slots.indexOf(imageId) + 1;

// 一行文字里的 <Picture N> 换成小标签；编号在槽位里找不到对应的图时按原样留着
function inlineContent(line: string, slots: string[]): JSONContent[] {
  const parts: JSONContent[] = [];
  let last = 0;
  for (const match of line.matchAll(PICTURE_TAG)) {
    const imageId = slots[Number(match[1]) - 1];
    if (!imageId) continue;
    const before = line.slice(last, match.index);
    if (before) parts.push({ type: 'text', text: before });
    parts.push({ type: PICTURE_REF, attrs: { imageId } });
    last = match.index + match[0].length;
  }
  const rest = line.slice(last);
  if (rest) parts.push({ type: 'text', text: rest });
  return parts;
}

export function textToDoc(text: string, slots: string[]): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => {
      const content = inlineContent(line, slots);
      return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
    }),
  };
}

// 每个段落一行；图已经不在槽位里时写成 <Picture ?>，这种情况发送前会拦下来
export function docToText(doc: JSONContent, slots: string[]): string {
  return (doc.content ?? [])
    .map((block) =>
      (block.content ?? [])
        .map((node) => {
          if (node.type !== PICTURE_REF) return node.text ?? '';
          const picture = pictureNumber(String(node.attrs?.imageId ?? ''), slots);
          return picture ? `<Picture ${picture}>` : '<Picture ?>';
        })
        .join(''),
    )
    .join('\n');
}

// 文档里所有小标签指向的 imageId，按出现顺序
export function docPictures(doc: JSONContent): string[] {
  return (doc.content ?? []).flatMap((block) =>
    (block.content ?? []).flatMap((node) => (node.type === PICTURE_REF ? [String(node.attrs?.imageId ?? '')] : [])),
  );
}
