import type { Editor } from '@tiptap/react';
import { create } from 'zustand';
import { PICTURE_REF } from '../editor/document';

// 资产库弹窗的几种用法：往槽位里放、只是看看、换掉某个槽位的图、挑一张插进句子里
export type AssetsMode = 'slots' | 'browse' | 'replace' | 'ref';

// 上传清单：哪条回复的第几个提示词框，images 是那条回复当时带的图
export type UploadTarget = { nodeId: string; label?: string; text: string; images: string[] };

// 回复角落点开的系统提示词原文
export type SysTarget = { name: string; hash: string; at: string };

// 翻译窗口：哪条回复的第几个提示词框
export type TranslateTarget = { nodeId: string; messageId: string; promptIndex: number; label?: string };

// 放大看的槽位图
export type ZoomTarget = { imageId: string; title: string };

// 标签编辑窗：生图节点哪条回复的第几个提示词框
export type TagsTarget = { nodeId: string; messageId: string; promptIndex: number; label?: string };

// 出的一张图：哪条回复、哪一组、第几张
export type ImageTarget = { nodeId: string; messageId: string; jobId: string; index: number };

// 下载窗口：要下的几张，文件名用节点标题加种子
export type DownloadTarget = { nodeId: string; title: string; items: (ImageTarget & { seed: number })[] };

type Overlays = {
  assets: { mode: AssetsMode; slot?: number } | null;
  upload: UploadTarget | null;
  collage: boolean;
  sys: SysTarget | null;
  translate: TranslateTarget | null;
  zoom: ZoomTarget | null;
  tags: TagsTarget | null;
  writeTags: string | null; // 写标签：哪个节点的
  genSettings: string | null; // 出图设置：哪个节点的
  viewer: ImageTarget | null; // 看大图和参数
  download: DownloadTarget | null;
  // 引用图片的小窗贴着哪儿弹；images：手动改提示词时只能挑这条回复带的图
  refpick: { left: number; top: number; images?: string[] } | null;
};

export const CLOSED_OVERLAYS = {
  assets: null,
  upload: null,
  collage: false,
  sys: null,
  translate: null,
  zoom: null,
  tags: null,
  writeTags: null,
  genSettings: null,
  viewer: null,
  download: null,
  refpick: null,
} satisfies Overlays;

export const useOverlays = create<Overlays>(() => CLOSED_OVERLAYS);

export const openAssets = (mode: AssetsMode, slot?: number) => useOverlays.setState({ assets: { mode, slot }, refpick: null });
export const closeAssets = () => useOverlays.setState({ assets: null });

// 引用图片插到哪个编辑器的哪个位置。编辑器对象是活的，不放进状态里
type RefTarget = { editor: Editor; position: number; typedAt: boolean };
let refTarget: RefTarget | null = null;

// typedAt：这个 @ 已经打进去了（输入法打出来的那种），插图时把它删掉
export function openRefPicker(anchor: Element, editor: Editor, typedAt = false, images?: string[]) {
  refTarget = { editor, position: editor.state.selection.from, typedAt };
  const rect = anchor.getBoundingClientRect();
  useOverlays.setState({ refpick: { left: rect.left, top: rect.top, images } });
}

export const closeRefPicker = () => {
  if (useOverlays.getState().refpick) useOverlays.setState({ refpick: null });
};

// 挑资产库里的图插进句子：弹窗换成资产库之前记下的位置照样用
export const refEditor = () => (refTarget && !refTarget.editor.isDestroyed ? refTarget.editor : null);

// 在记下的位置插一个图片标签，后面跟一个空格，光标落在空格后面
export function insertRef(imageId: string) {
  const target = refTarget;
  if (!target || target.editor.isDestroyed) return;
  const { editor, position, typedAt } = target;
  const chain = editor.chain();
  if (typedAt && ['@', '＠'].includes(editor.state.doc.textBetween(position, position + 1))) chain.deleteRange({ from: position, to: position + 1 });
  chain
    .insertContentAt(position, [
      { type: PICTURE_REF, attrs: { imageId } },
      { type: 'text', text: ' ' },
    ])
    .setTextSelection(position + 2)
    .run();
  refTarget = { ...target, position: position + 2, typedAt: false };
  // 直接调 view.focus()：Tiptap 的 focus 命令要等下一帧，那之前接着打字会打到开头去
  editor.view.focus();
}
