import { useEffect, useRef, useState } from 'react';
import {
  editFnOf,
  editSettingsOf,
  EDIT_FNS,
  EDIT_PRESETS,
  FOUR_VIEW_INSTRUCTION,
  REAL_AUX_WORDS,
  REAL_LORAS,
  REAL_PEOPLE_LORAS,
  REAL_PEOPLE_STRENGTH,
  REAL_TRIGGER,
  REMIX_LORAS,
  scaledSize,
  UPSCALE_SCALES,
  type ChatNode,
  type EditFnId,
  type EditRealSettings,
  type EditSettings,
} from '@media-agent/shared';
import { imageFileUrl } from '../api';
import { Icon } from '../ui/Icon';
import { showMenu, type MenuItem } from '../ui/menu';
import { toast } from '../ui/toast';
import { useCanvasStore } from '../store/canvasStore';
import { useComfyStore } from '../store/comfyStore';
import { editStartBlock, startEdit } from './imageActions';
import { EMPTY_MASK, MaskEditor, maskIsEmpty, maskPng, type MaskShapes } from './MaskEditor';

// 图像编辑节点的编辑栏：功能 → 图（在 Dock 里）→ 提示词 → 这个功能自己的参数 → 开始，见 docs/dev-plan.md 5.36。
// 界面照 web/prototype/image-edit-node.html 和 docs/plan-image-edit-node-layout.md 第 4 节。

// 转真人开「换脸」时图 2 的角色名。EDIT_FNS 里一个功能只给了一个 role（那是图 1 的），
// 图 2 这个写在界面上，Dock 里的槽位底下标的也是它
export const SLOT_B_ROLE = '真人参考';

// 改动落到节点上（NodePatch.edit 是 Partial<EditSettings>，见 store/canvasStore.ts）
const patch = (node: ChatNode, next: Partial<EditSettings>) => useCanvasStore.getState().patchNode(node.id, { edit: next });

// 转真人那一整块都是 real 里的字段
const patchReal = (node: ChatNode, real: EditRealSettings, next: Partial<EditRealSettings>) => patch(node, { real: { ...real, ...next } });

// 深度迁移（控制强度）和风格 Remix（换人 / 风格那条 LoRA + 强度）各自那一块，跟 real 一样整块替换
const patchDepth = (node: ChatNode, depth: EditSettings['depth'], next: Partial<EditSettings['depth']>) => patch(node, { depth: { ...depth, ...next } });
const patchRemix = (node: ChatNode, remix: EditSettings['remix'], next: Partial<EditSettings['remix']>) => patch(node, { remix: { ...remix, ...next } });

// 这个功能要几张图：转真人开「换脸」才要第二张（图 2 当真人参考），别的一律一张
const needSlots = (fn: EditFnId, real: EditRealSettings) => (fn === 'real' && real.dual ? 2 : 1);

// 「功能」那一行：下拉 + 两句说明（要几张、这个功能干什么的）
export function EditFnBar({ node }: { node: ChatNode }) {
  const edit = editSettingsOf(node.edit, node.slots.length);
  const fn = editFnOf(edit.fn);
  const pick = (e: React.MouseEvent<HTMLElement>) => {
    // 菜单项只有 label/onClick 那种才是能点的按钮（带 note 的会画成一行说明），
    // 所以「还没做」的也照常列出来，点了给一句提示
    const items: MenuItem[] = EDIT_FNS.map((item) => ({
      label: item.ready ? item.name : `${item.name}（还没做）`,
      icon: item.id === edit.fn ? 'check' : 'wand',
      onClick: () => {
        if (!item.ready) return toast(`「${item.name}」还没做，下一批上`, { tone: 'danger' });
        // 换功能不动你已经选的图和写好的字：只有「要几张」对不上时说一句，见 layout 第 2 节
        void patch(node, { fn: item.id }).then((ok) => {
          const need = needSlots(item.id, edit.real);
          if (!ok || node.slots.length >= need) return;
          toast(need === 2 ? `换脸要 2 张图，现在只有 ${node.slots.length} 张` : `「${item.name}」要 1 张图，先在下面放一张`, { tone: 'warn' });
        });
      },
    }));
    showMenu(e.currentTarget, items, 'left');
  };
  return (
    <>
      <div className="edit-row">
        <span className="edit-lbl">功能</span>
        <button type="button" className="btn btn-secondary btn-sm edit-fn" id="editFn" data-od-id="edit-fn" onClick={pick}>
          <Icon name="wand" />
          {fn.name}
          <Icon name="chev-down" />
        </button>
      </div>
      <p className="edit-desc" id="editNeed">{fn.need}</p>
      <p className="edit-desc">{fn.desc}</p>
    </>
  );
}

// 「提示词」和「开始」那几行：选一条现成的填进正文，正文能改，右边是相似度和开始。
// 每个功能一块参数区：指令编辑 / 换装共用「提示词 + 相似度」，转真人那套完全是另一回事
//（谁写词 / 做法 / LoRA 两组），局部重绘多一块画掩码，深度迁移是「提示词 + 控制强度」，
// 风格 Remix 是「提示词 + 换人/风格 LoRA」，放大 / 高清是「倍数 + 放大模型 + 面部修复」（不用写字），
// 四视图是「额外要求」（主指令固定）。见 docs/plan-image-edit-node-layout.md 第 4 节
export function EditStartBar({ node }: { node: ChatNode }) {
  const edit = editSettingsOf(node.edit, node.slots.length);
  if (edit.fn === 'real') return <RealBar node={node} edit={edit} />;
  if (edit.fn === 'inpaint') return <InpaintBar node={node} edit={edit} />;
  if (edit.fn === 'depth') return <DepthBar node={node} edit={edit} />;
  if (edit.fn === 'remix') return <RemixBar node={node} edit={edit} />;
  if (edit.fn === 'upscale') return <UpscaleBar node={node} edit={edit} />;
  if (edit.fn === 'fourview') return <FourViewBar node={node} edit={edit} />;
  return <PromptBar node={node} edit={edit} />;
}

// 提示词那两行（下拉 + 正文），四个功能长得一样，抽出来共用：
// 指令编辑 / 换装用它、深度迁移和风格 Remix 换一拨现成句子和 placeholder 也用它
function PromptRow({ node, edit, presets, placeholder }: { node: ChatNode; edit: EditSettings; presets: typeof EDIT_PRESETS[EditFnId]; placeholder: string }) {
  return (
    <div className="edit-row">
      <span className="edit-lbl">提示词</span>
      <select
        className="select"
        id="editPreset"
        data-od-id="edit-preset"
        style={{ width: 190 }}
        value=""
        onChange={(e) => {
          const index = Number(e.target.value);
          if (index < 0) return patch(node, { text: '' });
          patch(node, { text: presets[index].text });
        }}
      >
        <option value="">选一条现成的…</option>
        {presets.map((preset, i) => (
          <option key={preset.name} value={i}>{`${preset.name} · ${preset.hint}`}</option>
        ))}
        <option value="-1">自己写（清空）</option>
      </select>
      <input
        className="input mono"
        id="editText"
        data-od-id="edit-text"
        style={{ flex: 1, minWidth: 0 }}
        placeholder={placeholder}
        value={edit.text}
        onChange={(e) => patch(node, { text: e.target.value })}
      />
    </div>
  );
}

// 深度迁移：提示词正文（照这个构图画成什么）+ 控制强度，见 docs/dev-plan.md 5.36、krea2Depth.ts。
// 出图尺寸跟图走，这一档没有「出图设置」那一套（照转真人那样写一句）
function DepthBar({ node, edit }: { node: ChatNode; edit: EditSettings }) {
  return (
    <>
      <PromptRow
        node={node}
        edit={edit}
        presets={EDIT_PRESETS.depth}
        placeholder="这张图重画成什么样，比如「雨夜霓虹街的电影感摄影」"
      />
      <div className="edit-row">
        {/* 控制强度 = Krea2ControlLoRALoader 的 strength。0 不行（loader 不注册 wrapper，Apply 会直接报错） */}
        <label className="edit-param">
          控制强度
          <input
            className="input mono"
            id="editDepthStrength"
            data-od-id="edit-depth-strength"
            style={{ width: 56 }}
            value={edit.depth.strength}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!Number.isFinite(value) || value < 0.1 || value > 1.5) return;
              patchDepth(node, edit.depth, { strength: value });
            }}
          />
        </label>
        <span className="meta" id="editDepthHint" data-od-id="edit-depth-hint">
          1 是官方推荐值；别填 0
        </span>
        <span className="grow" />
        <StartButton node={node} edit={edit} />
      </div>
      <p className="edit-desc" data-od-id="edit-depth-desc">
        用这张图的深度结构重新画：构图、透视、人物站位跟原图走，内容风格听上面那句话。深度图是从这张图现提的，扁平二次元插图提出来几乎是平的、控制会很弱，写实照片最稳。
      </p>
      {/* 尺寸这句得说实话：深度那一档照真机那份 JSON 出的是固定 1024×1024，不是跟着这张图走 */}
      <p className="edit-desc">出图固定 <span className="mono">1024×1024</span>（照真机跑通的那份），深度图会缩放到这个尺寸；步数 8 / CFG 1 / euler / simple 都固定。</p>
    </>
  );
}

// 风格 Remix / 换人：提示词正文 + 换人/风格 LoRA 下拉 + 强度，见 docs/dev-plan.md 5.36、krea2Remix.ts。
// 两条 LoRA 同一条接线，只换名字；换人放得开、RealCosplay 保守
function RemixBar({ node, edit }: { node: ChatNode; edit: EditSettings }) {
  const remix = edit.remix;
  return (
    <>
      <PromptRow
        node={node}
        edit={edit}
        presets={EDIT_PRESETS.remix}
        placeholder="重画成什么样，比如「同一个人在雨夜霓虹街上撑着透明伞」"
      />
      <div className="edit-row">
        <span className="edit-lbl">LoRA</span>
        <label className="edit-param">
          换人 / 风格
          <select
            className="select select-sm"
            id="editRemixLora"
            data-od-id="edit-remix-lora"
            style={{ maxWidth: 260 }}
            value={remix.lora.name}
            onChange={(e) => patchRemix(node, remix, { lora: { ...remix.lora, name: e.target.value } })}
          >
            {REMIX_LORAS.map((one) => (
              <option key={one.name} value={one.name}>
                {one.label}
              </option>
            ))}
            {/* 清单里没有了、但节点里存着的，照旧列出来，别悄悄换掉 */}
            {!REMIX_LORAS.some((one) => one.name === remix.lora.name) && <option value={remix.lora.name}>{remix.lora.name}</option>}
          </select>
        </label>
        <Strength
          id="editRemixLoraStrength"
          odId="edit-remix-lora-strength"
          label="强度"
          value={remix.lora.strength}
          onSet={(value) => patchRemix(node, remix, { lora: { ...remix.lora, strength: value } })}
        />
        <span className="grow" />
        <StartButton node={node} edit={edit} />
      </div>
      <p className="edit-desc" data-od-id="edit-remix-desc">
        「换人」放得开：身份（长相、发型）和衣服带过来，场景、姿势、画风听上面那句话；「风格 Remix」保守：连原图的构图和环境一起留住，只轻微 remix —— 想大变样用「换人」，想轻微改一版用「风格 Remix」。
      </p>
      <p className="edit-desc">参考图越靠近脸/头肩，提示词对服装姿势的自由度越大；全身参考会把衣服和姿势一起带过来。</p>
      {/* 尺寸这句得说实话：Remix 那一档照真机那两份 JSON 出的是固定 1024×1024，跟参考图大小无关 */}
      <p className="edit-desc">出图固定 <span className="mono">1024×1024</span>（跟这张参考图的大小无关）；步数 8 / CFG 1 / euler / simple 都固定。LoRA 名必须带 krea2/ 前缀，少了会被 ComfyUI 在提交阶段拒掉。</p>
    </>
  );
}

// 放大 / 高清：放大倍数 + 放大模型 + 面部修复开关，就这三样，见 docs/plan-image-edit-node.md 第 3 节。
// 走的是生图节点已有的那条内置放大路（放大模型先放大，重绘强度固定 0 = 只放大不重画；面部修复是部位重绘的一道）。
// **这个功能不用模型写字**：没有「提示词」那一行，也没有要写的「要改什么」
function UpscaleBar({ node, edit }: { node: ChatNode; edit: EditSettings }) {
  const up = edit.upscale;
  const options = useComfyStore((s) => s.options);
  const images = useCanvasStore((s) => s.detail?.images);
  const models = options?.upscaleModels ?? [];
  const detectors = options?.detectors ?? [];
  useEffect(() => {
    void useComfyStore.getState().loadOptions();
  }, []);
  // 放大模型选了这台 ComfyUI 上没有的（换了机器 / 模型删了）也照旧列出来，写着这台没有，别悄悄换掉
  const listed = !up.model || models.includes(up.model) ? models : [up.model, ...models];
  // 面部修复要一个检测模型（列表里第一个名字带 face 的）。这台一个检测模型都没有时开不了，说清为什么
  const toggleFace = (on: boolean) => {
    if (!on) return patch(node, { upscale: { ...up, face: '' } });
    const found = detectors.find((name) => /face/i.test(name)) ?? detectors[0];
    if (!found) return toast('这台 ComfyUI 上没有检测模型（ComfyUI 的 models/ultralytics 里放 .pt），面部修复开不了', { tone: 'warn' });
    patch(node, { upscale: { ...up, face: found } });
  };
  const source = images?.[node.slots[edit.slot]];
  const target = source?.width && source?.height ? scaledSize({ width: source.width, height: source.height }, up.scale) : null;
  return (
    <>
      <div className="edit-row">
        <span className="edit-lbl">放大</span>
        <div className="seg" id="editUpscaleScale" role="group" aria-label="放大倍数" data-od-id="edit-upscale-scale">
          {UPSCALE_SCALES.map((scale) => (
            <button key={scale} type="button" aria-pressed={up.scale === scale} onClick={() => patch(node, { upscale: { ...up, scale } })}>
              {scale}×
            </button>
          ))}
        </div>
        <select
          className="select select-sm"
          id="editUpscaleModel"
          data-od-id="edit-upscale-model"
          aria-label="放大模型"
          style={{ maxWidth: 220 }}
          value={up.model}
          onChange={(e) => patch(node, { upscale: { ...up, model: e.target.value } })}
        >
          <option value="">{models.length ? '用这台 ComfyUI 上的第一个' : '这台 ComfyUI 上没有放大模型'}</option>
          {listed.map((name) => (
            <option key={name} value={name}>
              {name}
              {!models.includes(name) ? '（这台 ComfyUI 上没有）' : ''}
            </option>
          ))}
        </select>
        <label className="edit-param">
          <input
            type="checkbox"
            id="editUpscaleFace"
            data-od-id="edit-upscale-face"
            checked={Boolean(up.face)}
            onChange={(e) => toggleFace(e.target.checked)}
          />
          面部修复
        </label>
        <span className="grow" />
        <StartButton node={node} edit={edit} />
      </div>
      <p className="edit-desc" data-od-id="edit-upscale-desc">
        <b>这个功能不用模型写字</b>：没有「提示词」那一行，选了图和倍数点「开始」就直接放大。
        {target ? ` 出图是这张图乘 ${up.scale} 倍：${target.width}×${target.height}。` : ' 出图是这张图乘上面的倍数（长宽取 8 的倍数）。'}
      </p>
      <p className="edit-desc">放大模型放大完缩回上面那个尺寸，<b>只放大不重画</b>，原来的像素一个都不改；勾了「面部修复」才在检测到的人脸上重画一道（检测不到脸就什么都不做）。</p>
      <p className="edit-desc">放大模型没选就用这台 ComfyUI 上第一个；底模按这份提示词说明段里的「底模:」走（没写按 IL）—— 这一块走的是内置 SDXL 那条路，跟节点上选的 Krea2 提示词不是一个底模。</p>
    </>
  );
}

// 四视图：主指令是固定的（FOUR_VIEW_INSTRUCTION，程序接在最前面、一个字都不改），框里那句只当额外要求，不写也行。
// 走的还是生图节点那个「做四视图」那条路（krea2_4panel + Krea2Edit 那两个节点），见 docs/prompts/edit-fourview.md
function FourViewBar({ node, edit }: { node: ChatNode; edit: EditSettings }) {
  return (
    <>
      <div className="edit-row">
        <span className="edit-lbl">额外要求</span>
        <input
          className="input mono"
          id="editText"
          data-od-id="edit-text"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="可以不写；想补一句就写，比如「保持红色外套」「背景留白」"
          value={edit.text}
          onChange={(e) => patch(node, { text: e.target.value })}
        />
      </div>
      <div className="edit-row">
        <span className="meta" data-od-id="edit-fourview-desc">
          主指令是固定的，程序接在最前面、一个字都不改；上面那句只当额外要求接在后面（不写就是只有主指令）。
        </span>
        <span className="grow" />
        <StartButton node={node} edit={edit} />
      </div>
      <p className="edit-desc mono" data-od-id="edit-fourview-instruction">
        {FOUR_VIEW_INSTRUCTION}
      </p>
      <p className="edit-desc">
        出的是角色设定纸：脸部特写 + 正面 / 侧面 / 背面全身。原图就是槽位里选中的那张；底模、LoRA、步数照生图节点那个「做四视图」的默认值。
      </p>
    </>
  );
}

// 指令编辑 / 换装：提示词下拉 + 正文 + 相似度 + 开始（深度迁移 / 风格 Remix 是 PromptRow 那套，一行挤下）
function PromptBar({ node, edit }: { node: ChatNode; edit: EditSettings }) {
  const presets = EDIT_PRESETS[edit.fn];
  const pickPreset = (index: number) => {
    if (index < 0) return patch(node, { text: '' });
    patch(node, { text: presets[index].text });
  };
  return (
    <>
      <div className="edit-row">
        <span className="edit-lbl">提示词</span>
        <select
          className="select"
          id="editPreset"
          data-od-id="edit-preset"
          style={{ width: 190 }}
          value=""
          onChange={(e) => pickPreset(Number(e.target.value))}
        >
          <option value="">选一条现成的…</option>
          {presets.map((preset, i) => (
            <option key={preset.name} value={i}>{`${preset.name} · ${preset.hint}`}</option>
          ))}
          <option value="-1">自己写（清空）</option>
        </select>
      </div>
      <div className="edit-row">
        <span className="edit-lbl" />
        <input
          className="input mono"
          id="editText"
          data-od-id="edit-text"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="一句话说要改什么，比如「把外套换成黑色皮衣，脸和背景别动」"
          value={edit.text}
          onChange={(e) => patch(node, { text: e.target.value })}
        />
      </div>
      <div className="edit-row">
        {/* 相似度（服务端 refBoost）只有编辑档这三条路用得上，转真人没有这一项 */}
        <label className="edit-param">
          相似度
          <input
            className="input mono"
            id="editBoost"
            data-od-id="edit-boost"
            style={{ width: 56 }}
            value={edit.refBoost}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!Number.isFinite(value) || value < 0 || value > 10) return;
              patch(node, { refBoost: value });
            }}
          />
        </label>
        <span className="grow" />
        <StartButton node={node} edit={edit} />
      </div>
    </>
  );
}

// 局部重绘：原图是槽位里选中的那张，掩码在这个面板里画（拖框 + 涂抹 + 擦，跟大图窗口同一个 MaskEditor），
// 底下是「这块画成什么」和重绘强度，见 docs/plan-image-edit-node-layout.md 第 4.4 节。
// 掩码放在模块里按节点记着（连它是照哪张图画的）：面板收起、消息树切换都不丢，换了原图自动作废
type KeptMask = { imageId: string; shapes: MaskShapes };
const nodeMasks = new Map<string, KeptMask>();

// 这个节点现在这份掩码：画的是这张图才算（换了原图就当没画）
const maskOf = (nodeId: string, imageId: string | undefined): MaskShapes => {
  const kept = nodeMasks.get(nodeId);
  return kept && imageId && kept.imageId === imageId ? kept.shapes : EMPTY_MASK;
};
const keepMask = (nodeId: string, imageId: string | undefined, mask: MaskShapes) => {
  if (!imageId || maskIsEmpty(mask)) nodeMasks.delete(nodeId);
  else nodeMasks.set(nodeId, { imageId, shapes: mask });
};

// 框上那个「开始」用在局部重绘这条上时：掩码得先在面板里画好，而且得跟这条框用的那张图同源。
// 画好了就在这儿导出成 PNG（跟面板底部那个「开始」用的是同一份 maskPng），没画返回 null
export async function drawnMask(node: ChatNode, imageId: string | undefined): Promise<string | null> {
  const canvasId = useCanvasStore.getState().canvasId;
  const shapes = maskOf(node.id, imageId);
  if (!canvasId || !imageId || maskIsEmpty(shapes)) return null;
  return maskPng(imageFileUrl(canvasId, imageId), shapes);
}

function InpaintBar({ node, edit }: { node: ChatNode; edit: EditSettings }) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const imageId = node.slots[edit.slot];
  const [mask, setMask] = useState<MaskShapes>(() => maskOf(node.id, imageId));
  // 换原图（点别的槽位、或者那张图被删了往后补位）：掩码是按上一张画的，作废。
  // 面板刚打开时不能清 —— 这份掩码就是上一次在这儿画的，接着画才对
  const wasImage = useRef(imageId);
  useEffect(() => {
    if (wasImage.current === imageId) return;
    wasImage.current = imageId;
    setMask(EMPTY_MASK);
    nodeMasks.delete(node.id);
  }, [node.id, imageId]);
  const src = canvasId && imageId ? imageFileUrl(canvasId, imageId) : '';
  const drawn = !maskIsEmpty(mask);
  // 缺什么由面板先说（掩码是这儿的形状，服务端看不见），够了才把掩码导出来发出去
  const block = editStartBlock(node) ?? (drawn ? null : '先在图上拖个框或者涂抹出要重画的地方');
  const go = () => {
    if (block) return toast(block, { tone: 'warn' });
    void maskPng(src, mask).then((png) => {
      // maskPng 读不出原图时是 null（浏览器里几乎只有格式不认才这样），这时别把没掩码的请求发出去
      if (!png) return toast('这张图读不出来，没法重绘', { tone: 'danger' });
      return startEdit(node.id, { mask: png });
    });
  };
  return (
    <>
      <div className="edit-row">
        <span className="edit-lbl">提示词</span>
        <select
          className="select"
          id="editPreset"
          data-od-id="edit-preset"
          style={{ width: 190 }}
          value=""
          onChange={(e) => {
            const index = Number(e.target.value);
            if (index < 0) return patch(node, { text: '' });
            patch(node, { text: EDIT_PRESETS.inpaint[index].text });
          }}
        >
          <option value="">选一条现成的…</option>
          {EDIT_PRESETS.inpaint.map((preset, i) => (
            <option key={preset.name} value={i}>{`${preset.name} · ${preset.hint}`}</option>
          ))}
          <option value="-1">自己写（清空）</option>
        </select>
        <input
          className="input mono"
          id="editText"
          data-od-id="edit-text"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="这块画成什么，比如「一件红色皮衣领子」"
          value={edit.text}
          onChange={(e) => patch(node, { text: e.target.value })}
        />
      </div>
      <div className="edit-row">
        <span className="edit-lbl">掩码</span>
        <span className="edit-mask-hint" id="editMaskState" data-od-id="edit-mask-state">
          {drawn ? '画好了：开始只重画这一块，别处一个像素不动' : imageId ? '还没画 —— 在下面这张图上拖框或涂抹' : '还没选图 —— 先在下面放一张要改的图'}
        </span>
      </div>
      {src && (
        <div className="edit-mask" data-od-id="edit-mask">
          <MaskEditor
            src={src}
            value={mask}
            onChange={(next) => {
              setMask(next);
              keepMask(node.id, imageId, next);
            }}
          />
        </div>
      )}
      <div className="edit-row">
        <label className="edit-param">
          重绘强度
          <input
            className="input mono"
            id="editInpaintDenoise"
            data-od-id="edit-inpaint-denoise"
            style={{ width: 56 }}
            value={edit.inpaint.denoise}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!Number.isFinite(value) || value < 0 || value > 1) return;
              patch(node, { inpaint: { denoise: value } });
            }}
          />
        </label>
        <span className="meta">1 是完全重画，0.5 到 0.8 保留原来的轮廓、只改细节</span>
        <span className="grow" />
        <StartButton node={node} edit={edit} block={block} onClick={go} />
      </div>
      {/* 这一块跟节点上选的提示词不是一个底模：见 docs/dev-plan.md 5.35、5.36 */}
      <p className="edit-desc" data-od-id="edit-inpaint-desc">
        这一块走 <b>SDXL 那条重绘流程</b>（E05：裁出掩码附近一块重画再拼回去），底模按上面那份提示词说明段里的「底模:」走（没写按 IL）—— 跟编辑档那几条 Krea2 的老路不是一个底模。
      </p>
    </>
  );
}

// 转真人：谁写词（反推 / 手输 + 辅助词）→ 做法（只转真人 / 换脸 + 图 2）→ LoRA 两组 → 版本。
// 跟那台上的工作流一一对应：「① 用反推吗」「② 双图吗」，见 docs/krea2-real-usage.md
function RealBar({ node, edit }: { node: ChatNode; edit: EditSettings }) {
  const real = edit.real;
  const images = useCanvasStore((s) => s.detail?.images);
  const filled = node.slots.length;
  const nameOf = (index: number) => {
    const name = images?.[node.slots[index]]?.originalName;
    return `${index + 1} 号${name ? ` · ${name}` : ''}`;
  };
  const setPeople = (people: EditRealSettings['people']) => patchReal(node, real, { people });
  // 开「换脸」时顺手把图 2 指到另一张（节点里还有别的话），不然图 1 图 2 会是同一张
  const turnDual = (dual: boolean) => {
    const other = node.slots.findIndex((_, i) => i !== edit.slot);
    const fix = dual && edit.slotB === edit.slot && other >= 0 ? { slotB: other } : {};
    void patch(node, { real: { ...real, dual }, ...fix });
  };
  return (
    <>
      {/* ① 谁写词 = 工作流里的「① 用反推吗」：反推让模型看图写，手输自己写、还能点辅助词 */}
      <div className="edit-row">
        <span className="edit-lbl">谁写词</span>
        <div className="seg" id="editWhoWrites" role="group" aria-label="谁写词" data-od-id="edit-who-writes">
          <button type="button" aria-pressed={real.reverse} onClick={() => patchReal(node, real, { reverse: true })}>
            反推（模型看图自己写）
          </button>
          <button type="button" aria-pressed={!real.reverse} onClick={() => patchReal(node, real, { reverse: false })}>
            手输
          </button>
        </div>
      </div>
      <div className="edit-row">
        <span className="edit-lbl">提示词</span>
        <input
          className="input mono"
          id="editText"
          data-od-id="edit-text"
          style={{ flex: 1, minWidth: 0, opacity: real.reverse ? 0.62 : 1 }}
          readOnly={real.reverse}
          placeholder={real.reverse ? '反推开着时这句话由模型写，跑完显示在这' : '这里写画面描述就行'}
          value={edit.text}
          onChange={(e) => patch(node, { text: e.target.value })}
        />
      </div>
      <p className="edit-desc" data-od-id="edit-who-writes-hint">
        {real.reverse
          ? '反推开着时这句话由模型写：跑图时工作流里的反推模型先看图写词，写完那句就是喂给生成模型的（多花 ~9 秒）。上面灰的那句是「手输」那条，反推不看它。'
          : `手输：主触发词（${REAL_TRIGGER}）固定加在最前面、一个字都别改，下面写画面描述；辅助词点一下就接在后面。别加 8k / masterpiece 这类通用质量词。`}
      </p>
      {!real.reverse && (
        <div className="edit-row">
          <span className="edit-lbl">辅助词</span>
          <div className="edit-aux" data-od-id="edit-aux-words">
            {REAL_AUX_WORDS.map((word) => (
              <button
                key={word}
                type="button"
                aria-pressed={hasAux(edit.text, word)}
                title="点一下接在那句话后面，再点一下拿掉"
                onClick={() => patch(node, { text: toggleAux(edit.text, word) })}
              >
                {word}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ② 做法 = 工作流里的「② 双图吗」：换脸才用得上图 2，多一行图 2 强度（0–10） */}
      <div className="edit-row">
        <span className="edit-lbl">做法</span>
        <div className="seg" id="editFaceMode" role="group" aria-label="做法" data-od-id="edit-face-mode">
          <button type="button" aria-pressed={!real.dual} onClick={() => turnDual(false)}>
            只转真人
          </button>
          <button type="button" aria-pressed={real.dual} onClick={() => turnDual(true)}>
            换脸（图 2 决定长相）
          </button>
        </div>
      </div>
      <p className="edit-desc" data-od-id="edit-face-hint">
        {real.dual
          ? `要两张：图 2 是「${SLOT_B_ROLE}」，它会把整颗头带过来（发色、发型、帽子全跟来），不是只换脸。`
          : '只要图 1：转成真人，长相照原图。'}
      </p>
      {real.dual && (
        <>
          <div className="edit-row">
            <span className="edit-lbl">图 2</span>
            <select
              className="select select-sm"
              id="editSlotB"
              data-od-id="edit-slot-b"
              aria-label={`图 2 是哪张（${SLOT_B_ROLE}）`}
              style={{ maxWidth: 230 }}
              value={String(edit.slotB)}
              onChange={(e) => patch(node, { slotB: Number(e.target.value) })}
            >
              {filled === 0 && <option value="0">（还没放图）</option>}
              {node.slots.map((id, i) => (
                <option key={`${i}-${id}`} value={i}>
                  {nameOf(i)}
                </option>
              ))}
            </select>
            <Strength
              id="editImage2"
              odId="edit-image2-strength"
              label="图 2 强度"
              value={real.image2Strength}
              onSet={(value) => patchReal(node, real, { image2Strength: value })}
            />
          </div>
          <p className="edit-desc">0.3–0.6 是脸有点像、发型还是自己的；1.0 全盘接管。图 2 那条「只换脸」得靠换脸节点，这条路做不到。</p>
          {filled < 2 && (
            <p className="edit-warn" data-od-id="edit-image2-warn">
              换脸要 2 张图，现在只有 {filled} 张 —— 先在下面再放一张当「{SLOT_B_ROLE}」
            </p>
          )}
        </>
      )}

      {/* ③ LoRA 两组：转真人那条默认 V3，人物那几条能挂好几个，都同时喂 CLIP、会跟参考图抢 */}
      <div className="edit-row">
        <span className="edit-lbl">LoRA</span>
        <label className="edit-param">
          转真人
          <select
            className="select select-sm"
            id="editRealLora"
            data-od-id="edit-real-lora"
            style={{ maxWidth: 240 }}
            value={real.lora.name}
            onChange={(e) => patchReal(node, real, { lora: { ...real.lora, name: e.target.value } })}
          >
            {REAL_LORAS.map((one) => (
              <option key={one.name} value={one.name}>
                {one.label}
              </option>
            ))}
            {/* 作者清单里没有了、但节点里存着的，照旧列出来，别悄悄换掉 */}
            {!REAL_LORAS.some((one) => one.name === real.lora.name) && <option value={real.lora.name}>{real.lora.name}</option>}
          </select>
        </label>
        <Strength
          id="editRealLoraStrength"
          odId="edit-real-lora-strength"
          label="强度"
          value={real.lora.strength}
          onSet={(value) => patchReal(node, real, { lora: { ...real.lora, strength: value } })}
        />
      </div>
      <p className="edit-desc">转真人 LoRA 默认 V3，作者建议 0.8–1.0 —— 可以换、可以调。</p>
      {real.people.map((one, i) => (
        <div className="edit-row" key={`${i}-${one.name}`}>
          <span className="edit-lbl">{i === 0 ? '人物' : ''}</span>
          <select
            className="select select-sm"
            aria-label={`第 ${i + 1} 个人物 LoRA`}
            data-od-id="edit-people-lora"
            style={{ maxWidth: 220 }}
            value={one.name}
            onChange={(e) => setPeople(real.people.map((item, j) => (j === i ? { ...item, name: e.target.value } : item)))}
          >
            {REAL_PEOPLE_LORAS.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.label}
              </option>
            ))}
            {!REAL_PEOPLE_LORAS.some((candidate) => candidate.name === one.name) && <option value={one.name}>{one.name}</option>}
          </select>
          <Strength
            id={`editPeopleStrength${i}`}
            odId="edit-people-strength"
            label="强度"
            value={one.strength}
            onSet={(value) => setPeople(real.people.map((item, j) => (j === i ? { ...item, strength: value } : item)))}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`删掉第 ${i + 1} 个人物 LoRA`}
            data-od-id="edit-people-remove"
            onClick={() => setPeople(real.people.filter((_, j) => j !== i))}
          >
            <Icon name="trash" />
            删掉
          </button>
        </div>
      ))}
      <div className="edit-row">
        <span className="edit-lbl">{real.people.length === 0 ? '人物' : ''}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          id="editAddPeopleLora"
          data-od-id="edit-add-people-lora"
          onClick={() => setPeople([...real.people, { name: REAL_PEOPLE_LORAS[0].name, strength: REAL_PEOPLE_STRENGTH }])}
        >
          <Icon name="plus" />
          加一个
        </button>
        <span className="meta">默认不加，强度 {REAL_PEOPLE_STRENGTH}</span>
      </div>
      <p className="edit-desc">只能挂 Krea2 家族的（SDXL / Pony 的不生效）；人物 LoRA 会同时喂文字理解、跟参考图抢，总强度别顶满，容易花图。</p>

      {/* ④ 版本：只有「无审查」这一档（作者原版这一轮不做），底模和文字理解换去审查那套，接线不变 */}
      <div className="edit-row">
        <span className="edit-lbl">版本</span>
        <span className="edit-param" id="editRealVersion" data-od-id="edit-real-version">无审查（默认）</span>
        <span className="grow" />
        <StartButton node={node} edit={edit} />
      </div>
      <p className="edit-desc">无审查：底模和文字理解都换成去审查那套。</p>
      <p className="edit-desc">尺寸不用填，跟着图 1 走（长边 1536、16 的倍数）；步数 8 / CFG 1 / euler / beta57 都固定。</p>
    </>
  );
}

// 「开始」：缺东西时按住；「换脸」差第二张图那条只提醒，不按住（点了弹一句话），见 layout 第 4.2 节。
// block / onClick 是给局部重绘用的：那儿还差一份画在面板上的掩码，得先把掩码导出来再发
function StartButton({ node, edit, block: fixed, onClick }: { node: ChatNode; edit: EditSettings; block?: string | null; onClick?: () => void }) {
  const block = fixed === undefined ? editStartBlock(node) : fixed;
  const warnOnly = Boolean(block) && edit.fn === 'real' && edit.real.dual && node.slots.length < 2;
  const title =
    block ??
    (edit.fn === 'real'
      ? '按这张图（和上面那些设置）转一版'
      : edit.fn === 'inpaint'
        ? '把画的那块重绘一版，别处不动'
        : edit.fn === 'depth'
          ? '按这张图的深度结构重画一版'
          : edit.fn === 'remix'
            ? '拿这张图当参考 Remix 一版'
            : edit.fn === 'upscale'
              ? '按这张图放大一档（放大模型，可选面部修复）；不用写提示词'
              : edit.fn === 'fourview'
                ? '把这张图里的角色做成四视图角色设定纸'
                : '按这张图和这句话改一版');
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      id="btnEditStart"
      data-od-id="btn-edit-start"
      disabled={Boolean(block) && !warnOnly}
      title={title}
      onClick={() => {
        if (onClick) return onClick();
        if (block) return toast(block, { tone: 'warn' });
        void startEdit(node.id);
      }}
    >
      <Icon name="wand" />
      开始
    </button>
  );
}

// 强度那种小数字框：填的不是数、或者不在 0–10 里就当没填
function Strength({ id, odId, label, value, onSet }: { id: string; odId: string; label: string; value: number; onSet: (value: number) => void }) {
  return (
    <label className="edit-param">
      {label}
      <input
        className="input mono"
        id={id}
        data-od-id={odId}
        style={{ width: 56 }}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!Number.isFinite(next) || next < 0 || next > 10) return;
          onSet(next);
        }}
      />
    </label>
  );
}

// 辅助词：那句提示词是按逗号分段的一句话，点一下接在最后，再点一下拿掉
const hasAux = (text: string, word: string) => segmentsOf(text).includes(word);
const toggleAux = (text: string, word: string) => {
  const parts = segmentsOf(text);
  return (parts.includes(word) ? parts.filter((one) => one !== word) : [...parts, word]).join(', ');
};
const segmentsOf = (text: string) => text.split(',').map((one) => one.trim()).filter(Boolean);
