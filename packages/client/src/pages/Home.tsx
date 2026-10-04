import { splitTags, type CanvasImage, type Config, type Family, type GeneratedRef, type HomeCanvas, type HomeData, type HomeNode, type ImageJob, type StarredPrompt } from '@media-agent/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, imageThumbUrl } from '../api';
import { generatedThumb } from '../canvas/imageActions';
import { splitError } from '../canvas/nodeInfo';
import { tokens } from '../canvas/tokens';
import { UploadList } from '../canvas/UploadDialog';
import { ComfyPill } from '../components/ComfyPill';
import { TagChip } from '../tags/TagChip';
import { composeBox, useTagChecks } from '../tags/tagStore';
import { confirmBox } from '../ui/confirm';
import { copyText, fmtNum } from '../ui/copy';
import { Dialog } from '../ui/Dialog';
import { relativeWhen, whenDid } from '../ui/format';
import { Icon } from '../ui/Icon';
import { showMenu, showMenuAt, type MenuItem } from '../ui/menu';
import { RenameInput } from '../ui/RenameInput';
import { ThemeToggle } from '../ui/theme';
import { toast } from '../ui/toast';

type Images = Record<string, CanvasImage> | undefined;

const failed = (err: unknown) => toast((err as Error).message, { tone: 'danger' });
const workdirLink = { pathname: '/settings', hash: 'workdir' };
const nodeLink = (canvasId: string, nodeId: string) => ({ pathname: `/canvas/${canvasId}`, hash: `node=${nodeId}` });

// 首页：接着改上次的节点、找回打过星的提示词、管理画布；这台机器上要处理的事只在有问题时出现
export function Home() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<Config | null>(null);
  // 读工作文件夹时是 loading，读不出来是 error
  const [view, setView] = useState<'loading' | 'error' | 'ready'>('loading');
  const [data, setData] = useState<HomeData | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [upload, setUpload] = useState<StarredPrompt | null>(null);

  const load = () =>
    api<HomeData>('/home').then((next) => {
      setData(next);
      setView('ready');
    });
  // 新建、改名、删除之后悄悄再读一遍，读不出来只提示，页面不动
  const refresh = () => load().catch(failed);

  useEffect(() => {
    document.title = '首页 · 提示词画布';
    api<Config>('/config').then((loaded) => {
      if (!loaded.workFolder) return navigate('/setup', { replace: true });
      setConfig(loaded);
      load().catch(() => setView('error'));
    }, failed);
  }, [navigate]);

  // 按名字找画布：打字停一下再筛
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 120);
    return () => clearTimeout(timer);
  }, [search]);

  if (!config) return null;
  const work = config.workFolder!;
  const sep = work.includes('\\') ? '\\' : '/';
  const ready = view === 'ready' && data ? data : null;
  const titleOf = (canvasId: string) => ready?.canvases.find((c) => c.id === canvasId)?.title ?? '';
  const missingKeys = config.modelConfigs.filter((m) => !m.apiKey);

  const retry = () => {
    setView('loading');
    load().catch((err: Error) => {
      setView('error');
      toast(`还是打不开：${err.message}`, { tone: 'danger' });
    });
  };

  const clearSearch = () => {
    setSearch('');
    setQuery('');
    searchInput.current?.focus();
  };

  const rename = async (canvas: HomeCanvas, next: string | null) => {
    setRenamingId(null);
    const title = next?.trim();
    if (!title || title === canvas.title) return;
    try {
      await api(`/canvases/${canvas.id}`, { method: 'PATCH', body: { title } });
      toast(`已改名为「${title}」`);
      await refresh();
    } catch (err) {
      failed(err);
    }
  };

  const remove = async (canvas: HomeCanvas) => {
    const ok = await confirmBox({
      title: `删除「${canvas.title}」？`,
      body: (
        <>
          里面的 {canvas.nodeCount} 个节点和图片副本会一起移到工作文件夹的回收站，不是真删：<br />
          <span className="mono" style={{ fontSize: 12 }}>{`${work}${sep}.trash`}</span>
        </>
      ),
      ok: '移到回收站',
      danger: true,
    });
    if (!ok) return;
    try {
      const { trash } = await api<{ trash: string }>(`/canvases/${canvas.id}`, { method: 'DELETE' });
      await refresh();
      toast(`「${canvas.title}」已移到回收站`, {
        action: '撤销',
        ms: 8000,
        onAction: () => {
          api('/canvases/restore', { method: 'POST', body: { trash } })
            .then(refresh)
            .then(() => toast(`已撤销，「${canvas.title}」回来了`), failed);
        },
      });
    } catch (err) {
      failed(err);
    }
  };

  const menuItems = (canvas: HomeCanvas): MenuItem[] => [
    { label: '打开', icon: 'arrow-right', onClick: () => navigate(`/canvas/${canvas.id}`) },
    { label: '改名', icon: 'edit', onClick: () => setRenamingId(canvas.id) },
    { sep: true },
    { label: '删除（移到回收站）', icon: 'trash', danger: true, onClick: () => void remove(canvas) },
  ];

  const allCanvases = ready?.canvases ?? [];
  const q = query.trim().toLowerCase();
  const shownCanvases = q ? allCanvases.filter((c) => c.title.toLowerCase().includes(q)) : allCanvases;

  return (
    <>
      <header className="appbar" data-od-id="home-appbar">
        <Link className="brand" to="/"><span className="brand-mark"><Icon name="logo" /></span>提示词画布</Link>
        <span className="spacer" />
        <ComfyPill />
        <Link
          className={`path-pill hide-sm${view === 'error' ? ' is-error' : ''}`}
          to={workdirLink}
          title={view === 'error' ? '工作文件夹打不开，点一下去设置里换' : '工作文件夹，点一下去设置里换'}
          data-od-id="workdir-pill"
        >
          <Icon name="folder" className="icon-sm" />
          <span>{work}</span>
        </Link>
        <ThemeToggle />
        <Link className="btn btn-ghost" to="/settings" data-od-id="link-settings"><Icon name="gear" /><span className="hide-sm">设置</span></Link>
        <span className="vr hide-sm" />
        {/* 文件夹没读出来时新建也写不进去 */}
        <button type="button" className="btn btn-primary" id="btnNew" aria-label="新建画布" data-od-id="btn-new-canvas" disabled={!ready} onClick={() => setCreating(true)}>
          <Icon name="plus" /><span className="hide-sm">新建画布</span>
        </button>
      </header>

      <main className="hm-page" data-od-id="home-page">
        {ready && missingKeys.length > 0 && (
          <section className="hm-issues" aria-label="这台机器上要处理的事" data-od-id="machine-issues">
            {missingKeys.map((m) => (
              <div key={m.id} className="hm-issue" data-od-id="issue-key-missing">
                <Icon name="key" />
                <p className="grow">
                  <b>这台机器上还没填「{m.name}」的密钥</b>
                  <span className="mono hm-issue-model">{m.model}</span>
                  <span className="hm-issue-why">用这套模型配置发消息会失败。密钥只存在本机，换了电脑要再填一次。</span>
                </p>
                <Link className="btn btn-secondary btn-sm" to={{ pathname: '/settings', hash: 'models' }} data-od-id="btn-fill-key">去设置里填</Link>
              </div>
            ))}
          </section>
        )}

        {view === 'loading' && (
          <div className="hm-loading" role="status" data-od-id="home-loading">
            <span className="spinner" />
            <span>正在读取工作文件夹 <span className="mono">{work}</span>。在同步盘上、画布又多的时候要等一会儿。</span>
          </div>
        )}

        {view === 'error' && (
          <section className="hm-state" role="alert" data-od-id="workdir-error">
            <Icon name="alert" />
            <h2>打不开工作文件夹</h2>
            <p className="hm-state-path mono">{work}</p>
            <p className="muted">这个路径现在读不到。可能是同步盘还没连上，或者文件夹被挪走、改了名。连上同步盘后点「重试」；文件夹换了地方，就去设置里重新选。</p>
            <div className="row hm-state-acts">
              <button type="button" className="btn btn-secondary" id="retry" onClick={retry}><Icon name="retry" />重试</button>
              <Link className="btn btn-primary" to={workdirLink}><Icon name="folder" />去设置里换</Link>
            </div>
          </section>
        )}

        {ready && !allCanvases.length && (
          <section className="hm-state" data-od-id="no-canvas">
            <Icon name="node" />
            <h2>还没有画布</h2>
            <p className="muted">工作文件夹 <span className="mono">{work}</span> 里还没有画布。一个创作项目建一张画布，在里面建节点、写需求、反复试。</p>
            <div className="row hm-state-acts">
              <button type="button" className="btn btn-primary btn-lg" id="stateNew" onClick={() => setCreating(true)}><Icon name="plus" />新建第一张画布</button>
            </div>
          </section>
        )}

        {(view === 'loading' || (ready && allCanvases.length > 0)) && (
          <div className="hm-layout" id="layout">
            <section className="hm-sec hm-recent-sec" aria-labelledby="recentTitle" data-od-id="recent-nodes">
              <header className="hm-sec-head">
                <h2 id="recentTitle">最近动过的节点</h2>
                <span className="meta" id="recentMeta">{ready?.recentNodes.length ? '跨全部画布，点一下直接进节点的对话' : ''}</span>
              </header>
              <div className="hm-recent" id="recent">
                {!ready ? (
                  Array.from({ length: 6 }, (_, i) => <NodeSkeleton key={i} />)
                ) : ready.recentNodes.length ? (
                  ready.recentNodes.map((node) => <NodeCard key={node.id} node={node} canvasTitle={titleOf(node.canvasId)} images={ready.images[node.canvasId]} />)
                ) : (
                  <div className="hm-empty" data-od-id="recent-empty">
                    <h3>还没有发过消息的节点</h3>
                    <p>打开一张画布，建个节点、发出第一条需求，它就会出现在这里，下次点一下就能接着改。</p>
                  </div>
                )}
              </div>
            </section>

            <aside className="hm-sec hm-stars-sec" aria-labelledby="starsTitle" data-od-id="starred-prompts">
              <header className="hm-sec-head">
                <h2 id="starsTitle">打过星的提示词</h2>
                <span className="meta" id="starsMeta">{ready?.starred.length ? `${ready.starred.length} 条 · 新写的在前` : ''}</span>
              </header>
              <div className="hm-stars" id="stars">
                {!ready ? (
                  Array.from({ length: 3 }, (_, i) => <StarSkeleton key={i} />)
                ) : ready.starred.length ? (
                  ready.starred.map((prompt) =>
                    prompt.image ? (
                      <StarImageItem
                        key={`${prompt.messageId}-${prompt.promptIndex}`}
                        prompt={prompt}
                        family={prompt.image.family}
                        canvasTitle={titleOf(prompt.canvasId)}
                        onQueued={() => void refresh()}
                      />
                    ) : (
                      <StarItem
                        key={`${prompt.messageId}-${prompt.promptIndex}`}
                        prompt={prompt}
                        canvasTitle={titleOf(prompt.canvasId)}
                        images={ready.images[prompt.canvasId]}
                        onUpload={() => setUpload(prompt)}
                      />
                    ),
                  )
                ) : (
                  <div className="hm-empty is-plain" data-od-id="starred-empty">
                    <h3>还没打过星</h3>
                    <p>
                      效果好的那版，在对话里的提示词框上点「<Icon name="star" className="icon-sm hm-inline-icon" />打星」，它就会出现在这里，以后不用再翻版本找。
                    </p>
                  </div>
                )}
              </div>
            </aside>

            <section className="hm-sec hm-canvas-sec" aria-labelledby="canvasTitle" data-od-id="all-canvases">
              <header className="hm-sec-head">
                <h2 id="canvasTitle">全部画布</h2>
                <span className="meta" id="canvasMeta">
                  {!ready ? '' : q ? `找到 ${shownCanvases.length} 个，共 ${allCanvases.length} 个` : `${allCanvases.length} 个 · 最近动过的在前`}
                </span>
                <span className="grow" />
                <label className="hm-search" data-od-id="canvas-search">
                  <Icon name="search" className="icon-sm" />
                  <input
                    ref={searchInput}
                    className="input"
                    id="search"
                    type="search"
                    placeholder="按名字找画布"
                    autoComplete="off"
                    aria-label="按名字找画布"
                    disabled={!ready}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </header>
              <div className="hm-canvases" id="canvases">
                {!ready ? (
                  Array.from({ length: 8 }, (_, i) => <CanvasSkeleton key={i} />)
                ) : shownCanvases.length ? (
                  shownCanvases.map((canvas) => (
                    <article
                      key={canvas.id}
                      className={`hm-cv${canvas.id === freshId ? ' is-new' : ''}`}
                      data-id={canvas.id}
                      data-od-id={`canvas-card-${canvas.id}`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        showMenuAt(e.clientX, e.clientY, menuItems(canvas));
                      }}
                    >
                      <Link className="hm-cv-link" to={`/canvas/${canvas.id}`} aria-label={`打开「${canvas.title}」`} />
                      <div className="hm-cv-cover">
                        {canvas.cover ? (
                          <img className="im" src={imageThumbUrl(canvas.id, canvas.cover)} alt="" loading="lazy" />
                        ) : (
                          <div className="hm-cv-empty">{canvas.nodeCount ? '还没放过图' : '还没有节点'}</div>
                        )}
                        {canvas.generating > 0 && (
                          <span className="tag hm-cv-live"><span className="dot dot-live" />{canvas.generating} 个节点正在生成</span>
                        )}
                      </div>
                      <div className="hm-cv-body">
                        <div className="grow">
                          {renamingId === canvas.id ? (
                            <RenameInput value={canvas.title} className="hm-cv-rename" maxLength={30} onDone={(next) => void rename(canvas, next)} />
                          ) : (
                            <h3 className="hm-cv-title" title={canvas.title}>{canvas.title}</h3>
                          )}
                          <div className="meta hm-cv-meta">
                            <span><span className="num">{canvas.nodeCount}</span> 个节点</span>
                            {canvas.stars > 0 && (
                              <span className="hm-cv-stars"><Icon name="star" className="icon-fill icon-sm" /><span className="num">{canvas.stars}</span> 个打过星</span>
                            )}
                          </div>
                          <div className="meta">{whenDid(canvas.updatedAt, '动过')}</div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm hm-cv-menu"
                          data-menu
                          aria-label="画布操作"
                          onClick={(e) => showMenu(e.currentTarget, menuItems(canvas))}
                        >
                          <Icon name="more" />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="hm-empty hm-span" data-od-id="search-empty">
                    <h3>没有名字里带「{query.trim()}」的画布</h3>
                    <p>
                      换个词试试，或者 <button type="button" className="linkish" id="clearSearch" onClick={clearSearch}>清空搜索</button> 看全部 {allCanvases.length} 个。
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      {creating && (
        <NewCanvasDialog
          onClose={() => setCreating(false)}
          onCreated={async (id, title) => {
            setCreating(false);
            setFreshId(id);
            await refresh();
            toast(`建好了「${title}」`);
          }}
        />
      )}

      {upload && (
        <UploadList
          canvasId={upload.canvasId}
          images={data?.images[upload.canvasId]}
          where={`${titleOf(upload.canvasId)} › ${upload.nodeTitle}`}
          target={{ nodeId: upload.nodeId, label: upload.label, text: upload.text, images: upload.images }}
          onClose={() => setUpload(null)}
        />
      )}
    </>
  );
}

// 槽位里的图拼成一个方块；排不满格子时最后一张横着占满，不留空格
function Mosaic({ canvasId, ids, images }: { canvasId: string; ids: string[]; images: Images }) {
  if (!ids.length) {
    return <div className="hm-mosaic is-empty">没有<br />参考图</div>;
  }
  const cols = ids.length === 1 ? 1 : ids.length <= 4 ? 2 : 3;
  const rows = Math.ceil(ids.length / cols);
  const spare = cols * rows - ids.length;
  return (
    <div className="hm-mosaic" style={{ '--cols': cols, '--rows': rows } as CSSProperties} aria-label={`槽位里的 ${ids.length} 张图`}>
      {ids.map((id, i) => (
        <span key={`${i}-${id}`} className="hm-cell" style={spare && i === ids.length - 1 ? { gridColumn: `span ${spare + 1}` } : undefined}>
          <img className="im" src={imageThumbUrl(canvasId, id)} alt={images?.[id]?.originalName ?? ''} loading="lazy" />
        </span>
      ))}
    </div>
  );
}

// 出过图的生图节点：最近出的图拼成一个方块，两列
function GenMosaic({ node, refs }: { node: HomeNode; refs: GeneratedRef[] }) {
  const cols = refs.length === 1 ? 1 : 2;
  const rows = Math.ceil(refs.length / cols);
  const spare = cols * rows - refs.length;
  return (
    <div className="hm-mosaic is-gen" style={{ '--cols': cols, '--rows': rows } as CSSProperties} aria-label={`最近出的 ${refs.length} 张图`}>
      {refs.map((ref, i) => (
        <span key={`${ref.jobId}:${ref.index}`} className="hm-cell" style={spare && i === refs.length - 1 ? { gridColumn: `span ${spare + 1}` } : undefined}>
          <GenThumb src={generatedThumb(node.canvasId, node.id, ref)} />
        </span>
      ))}
    </div>
  );
}

// 出的一张图；临时文件清掉了、也没下载过的写「已清理」
function GenThumb({ src }: { src: string }) {
  const [gone, setGone] = useState(false);
  return gone ? <span className="hm-gone">已清理</span> : <img className="im" src={src} alt="" loading="lazy" onError={() => setGone(true)} />;
}

function NodeCard({ node, canvasTitle, images }: { node: HomeNode; canvasTitle: string; images: Images }) {
  const failure = node.error ? splitError(node.error) : null;
  const generated = node.generated;
  return (
    <Link className={`hm-node${failure ? ' is-failed' : ''}`} to={nodeLink(node.canvasId, node.id)} data-node={node.id} data-od-id={`recent-node-${node.id}`}>
      {generated?.images.length ? <GenMosaic node={node} refs={generated.images} /> : <Mosaic canvasId={node.canvasId} ids={node.slots} images={images} />}
      <div className="hm-node-body">
        <div className="hm-node-top">
          {node.image && (
            <span className="tag tag-outline hm-kind">
              <Icon name="sparkles" />
              生图{node.image.family ? ` · ${node.image.family}` : ''}
            </span>
          )}
          <h3 className="hm-node-title" title={node.title}>{node.title}</h3>
          {node.starred && (
            <span className="hm-star" title="有打过星的提示词" aria-label="打过星">
              <Icon name="star" className="icon-fill icon-sm" />
            </span>
          )}
          <span className="grow" />
          {node.generating ? (
            <span className="tag hm-live"><span className="dot dot-live" />正在生成</span>
          ) : failure ? (
            <span className="tag tag-danger" title={failure.code ? `${failure.code} · ${failure.reason}` : failure.reason}>
              <Icon name="warn" />回复失败
            </span>
          ) : generated?.live ? (
            <span className="tag hm-live">
              <span className="dot dot-live" />出图 <span className="mono">{generated.live.done}/{generated.live.total}</span>
            </span>
          ) : (
            generated?.failed && (
              <span className="tag tag-danger">
                <Icon name="warn" />出图失败
              </span>
            )
          )}
        </div>
        <p className="hm-sum">{node.summary ? tokens(node.summary) : <span className="muted">还没有提示词</span>}</p>
        <div className="hm-node-meta meta">
          <span className="hm-cv-name" title={`在「${canvasTitle}」里`}>{canvasTitle}</span>
          <span>{relativeWhen(node.updatedAt)}</span>
          <span>{node.directionCount ? `${node.directionCount} 个方向` : '没有方向'}</span>
          <span className="mono">{node.image ? `${node.image.width}×${node.image.height}` : `${node.duration}秒 · ${node.aspectRatio}`}</span>
        </div>
      </div>
    </Link>
  );
}

function StarItem({ prompt, canvasTitle, images, onUpload }: { prompt: StarredPrompt; canvasTitle: string; images: Images; onUpload: () => void }) {
  const label = prompt.label || '提示词';
  return (
    <article className="hm-star-item" data-star={`${prompt.messageId}-${prompt.promptIndex}`} data-od-id={`starred-prompt-${prompt.messageId}-${prompt.promptIndex}`}>
      <h3 className="hm-star-label" title={label}>{label}</h3>
      <p className="hm-sum">{tokens(prompt.summary)}</p>
      <div className="hm-star-media">
        {prompt.images.length ? (
          <span className="hm-strip" aria-label={`用了 ${prompt.images.length} 张图`}>
            {prompt.images.map((id, i) => (
              <span key={`${i}-${id}`} title={`${i + 1} 号：${images?.[id]?.originalName ?? ''}`}>
                <img className="im" src={imageThumbUrl(prompt.canvasId, id)} alt="" loading="lazy" />
              </span>
            ))}
          </span>
        ) : (
          <span className="meta">没用参考图</span>
        )}
        <span className="meta mono">{prompt.duration}秒 · {prompt.aspectRatio}</span>
      </div>
      <StarWhere prompt={prompt} canvasTitle={canvasTitle} />
      <div className="hm-star-acts">
        <button type="button" className="btn btn-secondary btn-sm" title="复制提示词原文" onClick={() => copyText(prompt.text, `已复制提示词（${fmtNum(prompt.text.length)} 字）`)}>
          <Icon name="copy" />复制
        </button>
        {prompt.translations.length > 0 && <span className="hm-tr-label">译文</span>}
        {prompt.translations.map((t) => (
          <button
            key={t.language}
            type="button"
            className="btn btn-ghost btn-sm"
            title={`复制${t.language}译文`}
            onClick={() => copyText(t.text, `已复制${t.language}译文（${fmtNum(t.text.length)} 字）`)}
          >
            <Icon name="copy" />{t.language}
          </button>
        ))}
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" title="要传哪几张图、按什么顺序" onClick={onUpload}>
          <Icon name="list" />上传清单
        </button>
      </div>
    </article>
  );
}

// 去节点的链接：画布 › 节点 · 什么时候写的
function StarWhere({ prompt, canvasTitle }: { prompt: StarredPrompt; canvasTitle: string }) {
  return (
    <Link className="hm-star-where" to={nodeLink(prompt.canvasId, prompt.nodeId)} title="跳到这个节点">
      <span className="hm-cv-name">{canvasTitle}</span>
      <span className="hm-sep">›</span>
      <span className="hm-where-node">{prompt.nodeTitle}</span>
      <span className="hm-where-time">{whenDid(prompt.createdAt, '写的')}</span>
      <Icon name="arrow-right" className="icon-sm" />
    </Link>
  );
}

const SHOWN_TAGS = 10;

const SHOWN_IMAGES = 6;

// 打过星的生图框：显示前 10 个标签和这个框出过的图（打过星的在前）；复制的是拼好的一串，和画布上的复制一样。
// 「再出图」按节点现在的出图设置再出一组
function StarImageItem({ prompt, family, canvasTitle, onQueued }: { prompt: StarredPrompt; family: Family | null; canvasTitle: string; onQueued: () => void }) {
  const navigate = useNavigate();
  const label = prompt.label || '提示词';
  const generated = prompt.image?.generated ?? [];
  const starredCount = generated.filter((ref) => ref.starred).length;
  const items = useMemo(() => splitTags(prompt.text), [prompt.text]);
  const shown = items.slice(0, SHOWN_TAGS);
  const checks = useTagChecks(
    shown.map((item) => item.name),
    family,
  );
  const copy = async () => {
    const composed = await composeBox(prompt.text, family);
    copyText(composed.text, `已复制提示词（${composed.count} 个标签）`);
  };
  const regenerate = async () => {
    try {
      const job = await api<ImageJob>(`/canvases/${prompt.canvasId}/nodes/${prompt.nodeId}/messages/${prompt.messageId}/images`, {
        method: 'POST',
        body: { promptIndex: prompt.promptIndex },
      });
      toast(`「${prompt.nodeTitle}」这个框又排上了 ${job.images.length} 张，按节点现在的出图设置`, {
        action: '去看看',
        onAction: () => navigate(nodeLink(prompt.canvasId, prompt.nodeId)),
      });
      onQueued();
    } catch (err) {
      failed(err);
    }
  };
  return (
    <article className="hm-star-item is-image" data-star={`${prompt.messageId}-${prompt.promptIndex}`} data-od-id={`starred-image-${prompt.messageId}-${prompt.promptIndex}`}>
      <div className="hm-star-top">
        <span className="tag tag-outline hm-kind">
          <Icon name="sparkles" />
          生图{family ? ` · ${family}` : ''}
        </span>
        <h3 className="hm-star-label" title={label}>{label}</h3>
      </div>
      <div className="tg-flow hm-tags">
        {shown.map((item, i) => (
          <TagChip key={i} item={item} check={checks[i]} unknownText="不认识" />
        ))}
        {items.length > SHOWN_TAGS && (
          <span className="hm-more meta">
            还有 <span className="mono">{items.length - SHOWN_TAGS}</span> 个
          </span>
        )}
      </div>
      {generated.length ? (
        <>
          <div className="hm-gen-strip" aria-label={`这个框出过的 ${generated.length} 张图`}>
            {generated.slice(0, SHOWN_IMAGES).map((ref) => (
              <span key={`${ref.jobId}:${ref.index}`} className={`hm-gen${ref.starred ? ' is-star' : ''}`}>
                <GenThumb src={generatedThumb(prompt.canvasId, prompt.nodeId, ref)} />
                {ref.starred && (
                  <i>
                    <Icon name="star" className="icon-fill" />
                  </i>
                )}
              </span>
            ))}
          </div>
          <div className="meta hm-gen-meta">
            <span>
              <span className="mono">{generated.length}</span> 张
              {starredCount > 0 && (
                <>
                  ，打星 <span className="mono">{starredCount}</span> 张
                </>
              )}
            </span>
            <span className="mono">
              {prompt.image!.width}×{prompt.image!.height}
            </span>
          </div>
        </>
      ) : (
        <div className="meta">还没出过图</div>
      )}
      <StarWhere prompt={prompt} canvasTitle={canvasTitle} />
      <div className="hm-star-acts">
        <button type="button" className="btn btn-secondary btn-sm" title="复制整串标签，可以贴进 ComfyUI" onClick={() => void copy()}>
          <Icon name="copy" />复制
        </button>
        <button type="button" className="btn btn-ghost btn-sm" data-regen title="用节点现在的出图设置，再出一组" onClick={() => void regenerate()}>
          <Icon name="sparkles" />再出图
        </button>
      </div>
    </article>
  );
}

// 读取中占位的卡片
function NodeSkeleton() {
  return (
    <div className="hm-node is-skeleton" aria-hidden="true">
      <div className="hm-mosaic skeleton" />
      <div className="hm-node-body">
        <div className="skeleton hm-sk" style={{ width: '46%', height: 14 }} />
        <div className="skeleton hm-sk" style={{ width: '92%' }} />
        <div className="skeleton hm-sk" style={{ width: '70%' }} />
        <div className="skeleton hm-sk" style={{ width: '58%' }} />
      </div>
    </div>
  );
}

function StarSkeleton() {
  return (
    <div className="hm-star-item" aria-hidden="true">
      <div className="skeleton hm-sk" style={{ width: '60%', height: 14 }} />
      <div className="skeleton hm-sk" style={{ width: '94%' }} />
      <div className="skeleton hm-sk" style={{ width: '40%', height: 24 }} />
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <div className="hm-cv" aria-hidden="true">
      <div className="hm-cv-cover skeleton" />
      <div className="hm-cv-body">
        <div className="grow">
          <div className="skeleton hm-sk" style={{ width: '70%', height: 14 }} />
          <div className="skeleton hm-sk" style={{ width: '50%' }} />
        </div>
      </div>
    </div>
  );
}

function NewCanvasDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, title: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    const value = title.trim();
    if (!value) return setError('先起个名字');
    try {
      const canvas = await api<{ id: string }>('/canvases', { method: 'POST', body: { title: value } });
      await onCreated(canvas.id, value);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Dialog label="新建画布" odId="dialog-new-canvas" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="dialog-head"><h2>新建画布</h2></div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="newTitle">画布名字</label>
            <input
              className={`input${error ? ' is-error' : ''}`}
              id="newTitle"
              maxLength={30}
              placeholder="比如：春节回家短片"
              autoComplete="off"
              data-autofocus
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError('');
              }}
            />
            <p className={`hint row-between${error ? ' is-error' : ''}`}>
              <span id="newHint">{error || '一个创作项目一张画布，建好后在里面建节点。'}</span>
              <span className="mono" id="newCount">{Array.from(title).length}/30</span>
            </p>
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="btn btn-primary" id="newOk">新建</button>
        </div>
      </form>
    </Dialog>
  );
}
