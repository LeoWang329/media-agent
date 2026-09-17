import { formatCost, messageCost, parseReply, TRANSLATE_LANGUAGES, type TranslateLanguage } from '@media-agent/shared';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useCanvasStore } from '../store/canvasStore';
import { copyText, fmtNum } from '../ui/copy';
import { Dialog } from '../ui/Dialog';
import { dayTime } from '../ui/format';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';
import { useOverlays, type TranslateTarget } from './overlays';
import { promptBody } from './tokens';

// 正在翻译的：开始的时间和这次写的要求。关掉窗口再打开还知道在翻。键是 节点/回复/框/语言
type Job = { start: number; instruction: string };
const useJobs = create<Record<string, Job>>(() => ({}));
const jobKey = (target: TranslateTarget, language: TranslateLanguage) => `${target.nodeId}/${target.messageId}/${target.promptIndex}/${language}`;

async function runTranslate(target: TranslateTarget, language: TranslateLanguage, instruction: string) {
  const key = jobKey(target, language);
  const label = target.label || '提示词';
  useJobs.setState({ [key]: { start: Date.now(), instruction } });
  let error: Error | null = null;
  try {
    await useCanvasStore.getState().translate(target.nodeId, target.messageId, target.promptIndex, language, instruction);
  } catch (err) {
    error = err as Error;
  }
  useJobs.setState((all) => {
    const rest = { ...all };
    delete rest[key];
    return rest;
  }, true);
  // 报错带上是哪个框：窗口关着的时候也知道
  if (error) {
    toast(`「${label}」翻成${language}失败：${error.message}`, { tone: 'danger', ms: 9000 });
    return;
  }
  // 窗口已经关了或换到别的框：翻好了说一声
  const open = useOverlays.getState().translate;
  if (open?.messageId !== target.messageId || open.promptIndex !== target.promptIndex) {
    toast(`「${label}」翻成${language}了，点框上的「翻译」看`, { ms: 5000 });
  }
}

const close = () => useOverlays.setState({ translate: null });
const waited = (start: number) => `${Math.max(0, Math.round((Date.now() - start) / 1000))} 秒`;

export function TranslateDialog() {
  const target = useOverlays((s) => s.translate);
  if (!target) return null;
  return <Translate key={`${target.messageId}/${target.promptIndex}`} target={target} />;
}

// 翻译一个提示词框：左边选语言、写要求，右边看译文。翻好的存下来，下次打开直接看、复制走，也能重新翻
function Translate({ target }: { target: TranslateTarget }) {
  const message = useCanvasStore((s) => s.nodes[target.nodeId]?.messages[target.messageId]);
  const modelConfigs = useCanvasStore((s) => s.modelConfigs);
  const nodeConfigId = useCanvasStore((s) => s.nodes[target.nodeId]?.modelConfigId);
  const images = useCanvasStore((s) => s.detail?.images);
  const jobs = useJobs();
  const saved = (message?.translations ?? []).filter((t) => t.promptIndex === target.promptIndex);
  const savedOf = (l: TranslateLanguage) => saved.find((t) => t.language === l);
  const jobOf = (l: TranslateLanguage): Job | undefined => jobs[jobKey(target, l)];
  // 打开时停在最近翻过的那种语言
  const [language, setLanguage] = useState<TranslateLanguage>(() => saved.at(-1)?.language ?? TRANSLATE_LANGUAGES[0]);
  const [instruction, setInstruction] = useState(() => jobOf(language)?.instruction ?? savedOf(language)?.instruction ?? '');
  // 窄屏上已经有译文时，要求那块先收起来
  const [reqOpen, setReqOpen] = useState(false);
  useSecondTick(TRANSLATE_LANGUAGES.some((l) => jobOf(l)));

  const label = target.label || '提示词';
  const current = savedOf(language);
  const job = jobOf(language);
  const nodeConfig = modelConfigs.find((m) => m.id === nodeConfigId);
  const usedConfig = modelConfigs.find((m) => m.id === current?.modelConfigId);
  const cost = current?.usage && usedConfig ? messageCost(current.usage, usedConfig.pricing) : null;
  const boxText = message ? (parseReply(message.text).prompts[target.promptIndex]?.text ?? '') : '';

  // 换语言时，要求换成那种语言正在翻或上次翻的时候写的
  const pick = (next: TranslateLanguage) => {
    setLanguage(next);
    setInstruction(jobOf(next)?.instruction ?? savedOf(next)?.instruction ?? '');
    setReqOpen(false);
  };
  const run = () => {
    if (!job && message) void runTranslate(target, language, instruction.trim());
  };

  return (
    <Dialog
      className={`dialog-sheet tr-dialog${current ? ' has-text' : ''}${reqOpen ? ' is-req-open' : ''}`}
      label="翻译提示词"
      odId="dialog-translate"
      onClose={close}
    >
      <div className="dialog-head tr-head">
        <div className="stack tr-title" style={{ gap: 2 }}>
          <h2>翻译提示词</h2>
          <div className="tr-sub" id="trSub" data-od-id="translate-source">
            <span className="tr-box" title={label}>
              {label}
            </span>
            {nodeConfig ? (
              <span className="tr-model" title={`用节点现在选的模型配置翻：${nodeConfig.name} · ${nodeConfig.model}`}>
                <span className="tr-model-name">用「{nodeConfig.name}」</span>
                <span className="mono tr-model-id">{nodeConfig.model}</span>
                <span className="tr-model-name">翻</span>
              </span>
            ) : (
              <span className="tr-model">节点还没选模型配置</span>
            )}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-icon tr-close" aria-label="关闭" title="关闭（Esc）" onClick={close}>
          <Icon name="x" />
        </button>
      </div>

      <div className="tr-body">
        <aside className="tr-side" data-od-id="translate-settings">
          <div className="stack" style={{ gap: 6 }}>
            <span className="panel-title" id="trLangTitle">
              翻成
            </span>
            <div className="tr-langs" id="trLangs" role="group" aria-labelledby="trLangTitle" data-od-id="translate-languages">
              {TRANSLATE_LANGUAGES.map((l) => {
                const lJob = jobOf(l);
                const lSaved = savedOf(l);
                const said = lJob ? '正在翻' : lSaved ? `${dayTime(lSaved.createdAt)} 翻过` : '还没翻过';
                return (
                  <button key={l} type="button" className="tr-lang" aria-pressed={l === language} aria-label={`${l}，${said}`} onClick={() => pick(l)}>
                    <span className="tr-lang-name">{l}</span>
                    {lJob ? (
                      <span className="tr-lang-state is-busy">
                        <span className="spinner" />
                        正在翻 <span className="mono">{waited(lJob.start)}</span>
                      </span>
                    ) : lSaved ? (
                      <span className="tr-lang-state is-done">
                        <Icon name="check" className="icon-sm" />
                        {dayTime(lSaved.createdAt)}
                      </span>
                    ) : (
                      <span className="tr-lang-state">还没翻过</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="button" className="btn btn-secondary tr-req-toggle" id="trReqToggle" aria-expanded={reqOpen} onClick={() => setReqOpen(!reqOpen)}>
            改要求、重新翻译
            <Icon name="chev-down" className="icon-sm" />
          </button>
          <div className="tr-req-wrap">
            <div className="field">
              <label htmlFor="trReq">
                要求<span className="muted">（选填）</span>
              </label>
              <textarea
                className="textarea"
                id="trReq"
                rows={3}
                placeholder="比如：台词也翻译；语气口语一点"
                data-od-id="translate-requirement"
                // 还没有译文就直接写要求；手机上不自动弹键盘
                data-autofocus={!current && window.innerWidth > 720 ? '' : undefined}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    run();
                  }
                }}
              />
            </div>
            <div className="tr-go">
              <button type="button" className={`btn ${current ? 'btn-secondary' : 'btn-primary'}`} id="trRun" data-od-id="translate-run" disabled={Boolean(job)} onClick={run}>
                {job ? <span className="spinner" /> : <Icon name={current ? 'retry' : 'translate'} />}
                {job ? '正在翻译' : current ? '重新翻译' : '翻译'}
              </button>
              <span className="meta">
                <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span>
              </span>
            </div>
            <div className="tr-rules" data-od-id="translate-default-rules">
              <p>不写要求时，下面这些保持原文不翻：</p>
              <ul>
                <li>
                  各部分的英文名，比如 <code>summary:</code>
                </li>
                <li>
                  <code>&lt;Picture 1&gt;</code>、<code>&lt;Subject 1&gt;</code>、<code>[Shot 1] At 00:02.500</code> 这类标记
                </li>
                <li>
                  <code>&lt;d&gt;</code> 里的台词
                </li>
                <li>英文双引号里的画面文字，比如招牌、字幕</li>
              </ul>
            </div>
          </div>
        </aside>

        <section className={`tr-main${job && current ? ' is-stale' : ''}`} id="trMain" data-od-id="translate-result">
          {current ? (
            <>
              {job && (
                <div className="tr-banner" data-od-id="translate-retranslating">
                  <span className="spinner" />
                  <div>
                    <b>
                      正在重新翻译，已等 <span className="mono">{waited(job.start)}</span>。
                    </b>
                    下面是 {dayTime(current.createdAt)} 翻的旧译文，照样能看、能复制，新的翻好后会替换它。
                    {job.instruction && <div className="tr-banner-req">这次的要求：{job.instruction}</div>}
                  </div>
                </div>
              )}
              <header className="tr-meta" id="trMeta" data-od-id="translate-meta">
                <div className="tr-meta-top">
                  <h3>{language}译文</h3>
                  {job && <span className="tag tag-outline">旧译文</span>}
                  <span className="grow" />
                  {/* 常用的是打开就复制走，焦点先放在这里 */}
                  <button
                    type="button"
                    className="btn btn-primary"
                    id="trCopy"
                    data-od-id="translate-copy"
                    data-autofocus=""
                    onClick={() => copyText(current.text, `已复制${language}译文（${fmtNum(current.text.length)} 字）`)}
                  >
                    <Icon name="copy" />
                    复制译文
                  </button>
                </div>
                <div className="tr-meta-line meta">
                  <span>{dayTime(current.createdAt)} 翻的</span>
                  <span className="mono tr-meta-model" title={current.modelName}>
                    {current.modelName}
                  </span>
                  {current.usage && (
                    <span>
                      输入 <span className="mono">{fmtNum(current.usage.promptTokens)}</span> · 输出 <span className="mono">{fmtNum(current.usage.completionTokens)}</span> tokens
                    </span>
                  )}
                  {cost !== null && usedConfig && <span className="mono">{formatCost(cost, usedConfig.pricing.currency)}</span>}
                </div>
                {current.instruction && <div className="tr-meta-req meta">当时的要求：{current.instruction}</div>}
              </header>
              <div className="tr-scroll" tabIndex={0} aria-label={`${language}译文`}>
                <div className="pb-body" data-testid="translation" data-od-id="translate-text">
                  {promptBody(current.text, message?.slotSnapshot, images)}
                </div>
              </div>
            </>
          ) : job ? (
            <div className="tr-state" id="trWaiting" data-od-id="translate-waiting">
              <span className="spinner" />
              <h3>正在翻成{language}</h3>
              <p className="meta">
                已经等了 <span className="mono">{waited(job.start)}</span>，一般要几十秒。
              </p>
              <p className="meta">可以关掉窗口去干别的，翻译不会停，翻好了页面底部会提示。</p>
              {job.instruction && <p className="tr-state-req">要求：{job.instruction}</p>}
            </div>
          ) : (
            <div className="tr-state" id="trEmpty" data-od-id="translate-empty">
              <h3>还没翻成{language}</h3>
              <p className="meta">
                这个框的原文有 <span className="mono">{fmtNum(boxText.length)}</span> 字，只把这一段发给模型，不带对话历史和图。翻好的会存下来，下次打开直接看。
              </p>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}

// 有正在翻的就每秒重画一次，几处等了多少秒一起往上走
function useSecondTick(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [on]);
}
