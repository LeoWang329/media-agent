import type { JSONContent } from '@tiptap/core';

// 编辑器里的图片小标签。文档里存的是 imageId，显示和发送时的编号都按当前槽位现算，
// 所以调完槽位顺序，标签和发出去的 <Picture N> 自动跟着变。
export const PICTURE_REF = 'pictureRef';

// 回复和发出去的文字里是 <Picture N>；输入框草稿里存的是 <Picture #图片 id>
const PICTURE_TAG = /<Picture (?:(\d+)|#([0-9a-f-]{36}))>/g;

export const pictureNumber = (imageId: string, slots: string[]) => slots.indexOf(imageId) + 1;

// 一行文字里的 <Picture N> 换成小标签；编号在槽位里找不到对应的图时按原样留着。
// <Picture #图片 id> 直接还原成那张图，图已经不在槽位里也照样还原（显示成「已不在槽位」，发送时拦下）
function inlineContent(line: string, slots: string[]): JSONContent[] {
  const parts: JSONContent[] = [];
  let last = 0;
  for (const match of line.matchAll(PICTURE_TAG)) {
    const imageId = match[2] ?? slots[Number(match[1]) - 1];
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

function serialize(doc: JSONContent, picture: (imageId: string) => string): string {
  return (doc.content ?? [])
    .map((block) =>
      (block.content ?? []).map((node) => (node.type === PICTURE_REF ? picture(String(node.attrs?.imageId ?? '')) : (node.text ?? ''))).join(''),
    )
    .join('\n');
}

// 每个段落一行；图已经不在槽位里时写成 <Picture ?>，这种情况发送前会拦下来
export const docToText = (doc: JSONContent, slots: string[]) =>
  serialize(doc, (imageId) => {
    const picture = pictureNumber(imageId, slots);
    return picture ? `<Picture ${picture}>` : '<Picture ?>';
  });

// 输入框草稿按图存、不按编号：之后挪了或删了槽位里的图，切回来还是指着原来那张
export const docToDraft = (doc: JSONContent) => serialize(doc, (imageId) => `<Picture #${imageId}>`);

// 文档里所有小标签指向的 imageId，按出现顺序
export function docPictures(doc: JSONContent): string[] {
  return (doc.content ?? []).flatMap((block) =>
    (block.content ?? []).flatMap((node) => (node.type === PICTURE_REF ? [String(node.attrs?.imageId ?? '')] : [])),
  );
}
