/* 首页：接着改上次的节点、找回打过星的提示词、管理画布；这台机器上要处理的事只在有问题时出现
   「新年广告片」的节点和提示词从 canvas-data.js 里算出来；其他画布只有标题、封面和节点数 */
(function () {
  var NOW = Date.parse('2026-09-16T17:52:00');   // 原型里的「现在」
  var MAIN = 'cv-7f3a2b';
  var TODAY = '2026-09-16T';

  /* ─── 小工具 ─────────────────────────────────────────── */
  function at(s) { return Date.parse(s); }
  function pad(x) { return String(x).padStart(2, '0'); }
  function when(t) {
    var d = new Date(t), now = new Date(NOW), mins = Math.round((NOW - t) / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + ' 分钟前';
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    if (d.toDateString() === new Date(NOW - 864e5).toDateString()) return '昨天 ' + hm;
    var md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '年' + md;
  }
  /* 「今天 16:58 写的」「3 分钟前写的」：时间以数字结尾时补个空格 */
  function whenDid(t, verb) { var w = when(t); return w + (/\d$/.test(w) ? ' ' : '') + verb; }
  /* 标记照原样显示，只换字色，和对话里的提示词框一样 */
  function marked(text) {
    return esc(text)
      .replace(/&lt;(Picture|Subject) \d+&gt;/g, function (m, kind) { return '<span class="tk ' + (kind === 'Picture' ? 'tk-pic' : 'tk-sub') + '">' + m + '</span>'; })
      .replace(/\[Shot \d+\]( At \d\d:\d\d\.\d{3})?/g, '<span class="tk tk-shot">$&</span>')
      .replace(/\[(reference generation|keyframe completion|video editing|video continuation|audio reuse|audio reference)( \+ [a-z ]+)*\]/g, '<span class="tk tk-type">$&</span>');
  }
  /* 一句话概括：框里 summary: 那一段；没有就取前两行 */
  function summaryOf(text) {
    var lines = text.split('\n'), start = -1;
    for (var i = 0; i < lines.length; i++) if (/^\s*summary\s*:/i.test(lines[i])) { start = i; break; }
    if (start < 0) return lines.filter(function (l) { return l.trim(); }).slice(0, 2).join('');
    var parts = [lines[start].replace(/^\s*summary\s*:/i, '')];
    for (var j = start + 1; j < lines.length && !/^[a-z_]+:\s*$/.test(lines[j]); j++) parts.push(lines[j]);
    return parts.map(function (l) { return l.trim(); }).filter(Boolean).join('');
  }
  function thumb(id) {
    var im = IMAGES[id];
    if (!im) return '';
    if (im.collage) {
      var c = im.collage;
      return '<div class="collage-thumb" style="grid-template-columns:repeat(' + c.cols + ',1fr);grid-template-rows:repeat(' + c.rows + ',1fr)">' +
        c.cells.map(function (cid) { return cid && IMAGES[cid] ? '<img src="' + IMAGES[cid].src + '" alt="" loading="lazy">' : '<span></span>'; }).join('') + '</div>';
    }
    return im.src ? '<img class="im" src="' + im.src + '" alt="' + esc(im.name) + '" loading="lazy">' : '';
  }
  function odId(s) { return String(s).replace(/[^a-z0-9]+/gi, '-').toLowerCase(); }

  /* ─── 「新年广告片」：节点状态和打过星的框 ───────────────── */
  var THR = {};
  CANVAS.nodes.forEach(function (n) { THR[n.id] = n.thread || []; });
  function nodeOf(id) { return CANVAS.nodes.filter(function (n) { return n.id === id; })[0]; }
  function flatten(positions) {
    var out = [];
    for (var i = 0; i < positions.length; i++) {
      var p = positions[i]; out.push(p);
      var v = p.versions[p.cur];
      if (v.rest) return out.concat(flatten(v.rest));
    }
    return out;
  }
  function fullThread(n) {
    var copied = n.forkFrom ? fullThread(nodeOf(n.forkFrom.node)).slice(0, n.forkFrom.count) : [];
    return copied.concat(flatten(THR[n.id]));
  }
  function hasStar(positions) {
    return positions.some(function f(p) {
      return p.versions.some(function (v) { return (v.boxes || []).some(function (b) { return b.starred; }) || (v.rest || []).some(f); });
    });
  }
  // 节点最后动过的时间（原型里写死；n6、n7 岔出来后还没发过消息，不进「最近动过」）
  var TOUCHED = { n3: '17:50', n5: '17:42', n1: '17:40', n4: '17:36', n2: '17:24', n8: '17:02' };

  var MAIN_NODES = CANVAS.nodes.map(function (n) {
    var own = flatten(THR[n.id]);
    if (!own.length) return null;
    var last = own[own.length - 1], lv = last.role === 'ai' ? last.versions[last.cur] : null;
    var t = fullThread(n), ai = null;
    for (var i = t.length - 1; i >= 0 && !ai; i--) if (t[i].role === 'ai' && !t[i].versions[t[i].cur].failed) ai = t[i].versions[t[i].cur];
    return {
      id: n.id, canvas: MAIN, title: n.title, href: 'canvas.html#node=' + n.id,
      summary: ai && ai.boxes ? summaryOf(ai.boxes[0].text) : '', dirs: ai && ai.boxes ? ai.boxes.length : 0,
      slots: n.slots, duration: n.duration, ratio: n.ratio, starred: hasStar(THR[n.id]),
      live: !!(lv && lv.streaming), failed: lv && lv.failed ? lv.failed : null,
      ts: at(TODAY + TOUCHED[n.id] + ':00')
    };
  }).filter(Boolean);

  var MAIN_STARS = [];
  CANVAS.nodes.forEach(function (n) {
    THR[n.id].forEach(function (p, i) {
      if (p.role !== 'ai') return;
      var u = THR[n.id][i - 1], uv = u ? u.versions[u.cur] : null;
      p.versions.forEach(function (v, vi) {
        (v.boxes || []).forEach(function (b, j) {
          if (!b.starred) return;
          MAIN_STARS.push({
            key: [n.id, i, vi, j].join('-'), canvas: MAIN, nodeTitle: n.title, href: 'canvas.html#node=' + n.id,
            label: b.label || '提示词', text: b.text, summary: summaryOf(b.text), translations: b.translations || {},
            imgs: uv ? uv.imgs : n.slots, duration: uv ? uv.duration : n.duration, ratio: uv ? uv.ratio : n.ratio,
            ts: at(TODAY + v.at + ':00')
          });
        });
      });
    });
  });
  MAIN_STARS.sort(function (a, b) { return b.ts - a.ts; });

  /* ─── 其他画布：原型里只有标题、封面、节点数，外加两个最近动过的节点 ─── */
  var OTHER_NODES = [
    { id: 'cv-2c91d0-n3', canvas: 'cv-2c91d0', title: '推门进店·慢动作', slots: ['b1'], duration: 6, ratio: '9:16', dirs: 2, starred: false,
      summary: '[reference generation] 目标视频里，<Subject 1> 用头顶开咖啡馆的玻璃门慢慢走进来，停在吧台前抬头看店员，尾巴轻轻摇，一个镜头，无台词。', ts: at('2026-09-15T21:14:00') },
    { id: 'cv-5e07aa-n9', canvas: 'cv-5e07aa', title: '侧光转台·表盘特写', slots: ['b2'], duration: 5, ratio: '1:1', dirs: 3, starred: false,
      summary: '[reference generation] 目标视频里，<Subject 1> 放在黑色转台上缓慢旋转，一道侧光扫过表圈和刻度，最后停在表盘正面，两个镜头，无台词。', ts: at('2026-09-13T15:30:00') }
  ];

  var BASE_CANVASES = [
    { id: MAIN, title: '新年广告片', nodes: CANVAS.nodes.length, cover: 'k2', href: 'canvas.html' },
    { id: 'cv-2c91d0', title: '咖啡馆里的萨摩耶', nodes: 5, cover: 'b1', ts: at('2026-09-15T21:14:00') },
    { id: 'cv-5e07aa', title: '腕表新品 · 侧光', nodes: 11, cover: 'b2', ts: at('2026-09-13T15:30:00') },
    { id: 'cv-91b4c3', title: '橘猫开冰箱', nodes: 2, cover: 'b3', ts: at('2026-09-10T11:02:00') },
    { id: 'cv-3a6f18', title: '城市夜跑', nodes: 6, cover: 'b4', ts: at('2026-09-08T22:40:00') },
    { id: 'cv-d2e470', title: '外婆的厨房', nodes: 14, cover: 'b5', ts: at('2026-09-02T19:15:00') },
    { id: 'cv-0b8c59', title: '地铁里的纸飞机', nodes: 3, cover: 'b6', ts: at('2026-08-29T09:48:00') },
    { id: 'cv-7a1e3d', title: '雪山越野', nodes: 7, cover: 'b7', ts: at('2026-08-21T16:05:00') },
    { id: 'cv-c4f962', title: '毕业季短片', nodes: 23, cover: 'b8', ts: at('2026-07-03T14:20:00') },
    { id: 'cv-68d2b7', title: '江边烟花', nodes: 4, cover: 'b9', ts: at('2026-02-09T23:10:00') }
  ];
  // 「新年广告片」的动过时间、星标节点数、正在生成的节点数从节点算
  BASE_CANVASES[0].ts = Math.max.apply(null, MAIN_NODES.map(function (n) { return n.ts; }));
  BASE_CANVASES[0].stars = MAIN_NODES.filter(function (n) { return n.starred; }).length;
  BASE_CANVASES[0].live = MAIN_NODES.filter(function (n) { return n.live; }).length;

  // 几十个画布时补进来的（只有标题、封面、节点数）
  var MORE_TITLES = ['春节回家短片', '咖啡豆烘焙过程', '新品耳机开箱 · 白色款', '早高峰地铁站延时', '雨后的老街 · 胶片感', '宠物医院的一天',
    '奶茶店开业 15 秒', '登山鞋防水测试', '海边日落求婚', '城市骑行片头', '面馆老板的一天', '夜市烟火气', '绘本改编 · 小熊找妈妈 第一集',
    '电动车雨夜续航广告', '公益短片 · 独居老人的晚饭', '品牌周年庆开场 30 秒倒计时', '高铁窗外', '书店打烊前十分钟', '樱花季 · 大学校园',
    '健身房清晨', '冬至饺子', '旧相机修复记录', '露营夜晚篝火', '机场送别', '游戏发布会预告片·赛博城市高空俯冲镜头第二版（竖屏）', '外卖骑手雨中送餐'];
  var MORE_COVERS = ['a2', 'a5', 'a6', 'a7', 'a9', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'u1', 'u2', 'u3', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10', 'u11', 'u12', 'a3', null];

  var KEYS_MISSING = [{ name: '备用', model: 'deepseek-chat' }];

  /* ─── 状态 ─────────────────────────────────────────────── */
  var S;
  function reset() {
    S = { view: 'ready', canvases: BASE_CANVASES.map(function (c) { return Object.assign({}, c); }),
      nodes: MAIN_NODES.concat(OTHER_NODES), stars: MAIN_STARS.slice(), keys: KEYS_MISSING.slice(), q: '' };
    $('#search').value = '';
  }
  function canvasOf(id) { return S.canvases.filter(function (c) { return c.id === id; })[0]; }
  function sorted() { return S.canvases.slice().sort(function (a, b) { return b.ts - a.ts; }); }
  function recentNodes() { return S.nodes.filter(function (n) { return canvasOf(n.canvas); }).sort(function (a, b) { return b.ts - a.ts; }).slice(0, 8); }
  function starList() { return S.stars.filter(function (s) { return canvasOf(s.canvas); }); }

  /* ─── 渲染 ─────────────────────────────────────────────── */
  function renderIssues() {
    $('#issues').innerHTML = S.view === 'ready' && S.keys.length
      ? '<section class="hm-issues" aria-label="这台机器上要处理的事" data-od-id="machine-issues">' + S.keys.map(function (k) {
          return '<div class="hm-issue" data-od-id="issue-key-missing">' + icon('key') +
            '<p class="grow"><b>这台机器上还没填「' + esc(k.name) + '」的密钥</b><span class="mono hm-issue-model">' + esc(k.model) + '</span>' +
            '<span class="hm-issue-why">用这套模型配置发消息会失败。密钥只存在本机，换了电脑要再填一次。</span></p>' +
            '<a class="btn btn-secondary btn-sm" href="settings.html#models" data-od-id="btn-fill-key">去设置里填</a></div>';
        }).join('') + '</section>'
      : '';
  }

  function mosaic(ids) {
    if (!ids.length) return '<div class="hm-mosaic is-empty">没有<br>参考图</div>';
    var cols = ids.length === 1 ? 1 : ids.length <= 4 ? 2 : 3, rows = Math.ceil(ids.length / cols);
    var spare = cols * rows - ids.length;   // 最后一张横向占满剩下的格子，不留空格
    return '<div class="hm-mosaic" style="--cols:' + cols + ';--rows:' + rows + '" aria-label="槽位里的 ' + ids.length + ' 张图">' +
      ids.map(function (id, i) {
        return '<span class="hm-cell"' + (spare && i === ids.length - 1 ? ' style="grid-column:span ' + (spare + 1) + '"' : '') + '>' + thumb(id) + '</span>';
      }).join('') + '</div>';
  }
  function nodeCard(r) {
    var cv = canvasOf(r.canvas);
    var status = r.live ? '<span class="tag hm-live"><span class="dot dot-live"></span>正在生成</span>'
      : r.failed ? '<span class="tag tag-danger" title="' + esc(r.failed.code + ' · ' + r.failed.reason) + '">' + icon('warn') + '回复失败</span>' : '';
    return '<a class="hm-node' + (r.failed ? ' is-failed' : '') + '" href="' + (r.href || '#') + '" data-node="' + r.id + '" data-od-id="recent-node-' + odId(r.id) + '">' +
      mosaic(r.slots) +
      '<div class="hm-node-body">' +
        '<div class="hm-node-top"><h3 class="hm-node-title" title="' + esc(r.title) + '">' + esc(r.title) + '</h3>' +
          (r.starred ? '<span class="hm-star" title="有打过星的提示词" aria-label="打过星">' + icon('star', 'icon-fill icon-sm') + '</span>' : '') +
          '<span class="grow"></span>' + status + '</div>' +
        '<p class="hm-sum">' + (r.summary ? marked(r.summary) : '<span class="muted">还没有提示词</span>') + '</p>' +
        '<div class="hm-node-meta meta"><span class="hm-cv-name" title="在「' + esc(cv.title) + '」里">' + esc(cv.title) + '</span>' +
          '<span>' + when(r.ts) + '</span><span>' + (r.dirs ? r.dirs + ' 个方向' : '没有方向') + '</span>' +
          '<span class="mono">' + r.duration + '秒 · ' + r.ratio + '</span></div>' +
      '</div></a>';
  }
  function renderRecent() {
    var list = recentNodes();
    $('#recentMeta').textContent = list.length ? '跨全部画布，点一下直接进节点的对话' : '';
    $('#recent').innerHTML = list.length ? list.map(nodeCard).join('')
      : '<div class="hm-empty" data-od-id="recent-empty"><h3>还没有发过消息的节点</h3><p>打开一张画布，建个节点、发出第一条需求，它就会出现在这里，下次点一下就能接着改。</p></div>';
  }

  function strip(ids) {
    if (!ids.length) return '<span class="meta">没用参考图</span>';
    return '<span class="hm-strip" aria-label="用了 ' + ids.length + ' 张图">' + ids.map(function (id, i) {
      return '<span title="' + (i + 1) + ' 号：' + esc(IMAGES[id].name) + '">' + thumb(id) + '</span>';
    }).join('') + '</span>';
  }
  function starItem(s) {
    var cv = canvasOf(s.canvas), langs = Object.keys(s.translations);
    return '<article class="hm-star-item" data-star="' + s.key + '" data-od-id="starred-prompt-' + odId(s.key) + '">' +
      '<h3 class="hm-star-label" title="' + esc(s.label) + '">' + esc(s.label) + '</h3>' +
      '<p class="hm-sum">' + marked(s.summary) + '</p>' +
      '<div class="hm-star-media">' + strip(s.imgs) + '<span class="meta mono">' + s.duration + '秒 · ' + s.ratio + '</span></div>' +
      '<a class="hm-star-where" href="' + (s.href || '#') + '" data-go title="跳到这个节点">' +
        '<span class="hm-cv-name">' + esc(cv.title) + '</span><span class="hm-sep">›</span><span class="hm-where-node">' + esc(s.nodeTitle) + '</span>' +
        '<span class="hm-where-time">' + whenDid(s.ts, '写的') + '</span>' + icon('arrow-right', 'icon-sm') + '</a>' +
      '<div class="hm-star-acts">' +
        '<button class="btn btn-secondary btn-sm" data-copy="" title="复制提示词原文">' + icon('copy') + '复制</button>' +
        (langs.length ? '<span class="hm-tr-label">译文</span>' + langs.map(function (l) {
          return '<button class="btn btn-ghost btn-sm" data-copy="' + l + '" title="复制' + l + '译文">' + icon('copy') + l + '</button>';
        }).join('') : '') +
        '<span class="grow"></span><button class="btn btn-ghost btn-sm" data-upload title="要传哪几张图、按什么顺序">' + icon('list') + '上传清单</button>' +
      '</div></article>';
  }
  function renderStars() {
    var list = starList();
    $('#starsMeta').textContent = list.length ? list.length + ' 条 · 新写的在前' : '';
    $('#stars').innerHTML = list.length ? list.map(starItem).join('')
      : '<div class="hm-empty is-plain" data-od-id="starred-empty"><h3>还没打过星</h3><p>效果好的那版，在对话里的提示词框上点「' + icon('star', 'icon-sm hm-inline-icon') + '打星」，它就会出现在这里，以后不用再翻版本找。</p></div>';
  }

  function canvasCard(c) {
    var cover = c.cover ? thumb(c.cover) : '<div class="hm-cv-empty">' + (c.nodes ? '还没放过图' : '还没有节点') + '</div>';
    return '<article class="hm-cv' + (c._new ? ' is-new' : '') + '" data-id="' + c.id + '" data-od-id="canvas-card-' + c.id + '">' +
      '<a class="hm-cv-link" href="' + (c.href || '#') + '" aria-label="打开「' + esc(c.title) + '」"></a>' +
      '<div class="hm-cv-cover">' + cover +
        (c.live ? '<span class="tag hm-cv-live"><span class="dot dot-live"></span>' + c.live + ' 个节点正在生成</span>' : '') + '</div>' +
      '<div class="hm-cv-body"><div class="grow">' +
        '<h3 class="hm-cv-title" title="' + esc(c.title) + '">' + esc(c.title) + '</h3>' +
        '<div class="meta hm-cv-meta"><span><span class="num">' + c.nodes + '</span> 个节点</span>' +
          (c.stars ? '<span class="hm-cv-stars">' + icon('star', 'icon-fill icon-sm') + '<span class="num">' + c.stars + '</span> 个打过星</span>' : '') + '</div>' +
        '<div class="meta">' + whenDid(c.ts, '动过') + '</div>' +
      '</div><button class="btn btn-ghost btn-icon btn-sm hm-cv-menu" data-menu aria-label="画布操作">' + icon('more') + '</button></div>' +
    '</article>';
  }
  function renderCanvases() {
    var all = sorted(), q = S.q.trim().toLowerCase();
    var list = q ? all.filter(function (c) { return c.title.toLowerCase().indexOf(q) >= 0; }) : all;
    $('#canvasMeta').textContent = q ? '找到 ' + list.length + ' 个，共 ' + all.length + ' 个' : all.length + ' 个 · 最近动过的在前';
    $('#canvases').innerHTML = list.length ? list.map(canvasCard).join('')
      : '<div class="hm-empty hm-span" data-od-id="search-empty"><h3>没有名字里带「' + esc(S.q.trim()) + '」的画布</h3><p>换个词试试，或者 <button class="linkish" id="clearSearch">清空搜索</button> 看全部 ' + all.length + ' 个。</p></div>';
    S.canvases.forEach(function (c) { delete c._new; });
  }

  function skeletons() {
    var node = '<div class="hm-node is-skeleton" aria-hidden="true"><div class="hm-mosaic skeleton"></div><div class="hm-node-body">' +
      '<div class="skeleton hm-sk" style="width:46%;height:14px"></div><div class="skeleton hm-sk" style="width:92%"></div><div class="skeleton hm-sk" style="width:70%"></div><div class="skeleton hm-sk" style="width:58%"></div></div></div>';
    var star = '<div class="hm-star-item" aria-hidden="true"><div class="skeleton hm-sk" style="width:60%;height:14px"></div><div class="skeleton hm-sk" style="width:94%"></div><div class="skeleton hm-sk" style="width:40%;height:24px"></div></div>';
    var cv = '<div class="hm-cv" aria-hidden="true"><div class="hm-cv-cover skeleton"></div><div class="hm-cv-body"><div class="grow"><div class="skeleton hm-sk" style="width:70%;height:14px"></div><div class="skeleton hm-sk" style="width:50%"></div></div></div></div>';
    $('#recentMeta').textContent = ''; $('#starsMeta').textContent = ''; $('#canvasMeta').textContent = '';
    $('#recent').innerHTML = new Array(6).join(node) + node;
    $('#stars').innerHTML = new Array(3).join(star) + star;
    $('#canvases').innerHTML = new Array(8).join(cv) + cv;
  }

  function render() {
    renderIssues();
    var pill = $('#workdirPill');
    pill.classList.toggle('is-error', S.view === 'error');
    pill.title = S.view === 'error' ? '工作文件夹打不开，点一下去设置里换' : '工作文件夹，点一下去设置里换';
    var ps = $('#pageState'), layout = $('#layout');
    $('#search').disabled = S.view !== 'ready';
    $('#btnNew').disabled = S.view !== 'ready';   // 文件夹没读出来时新建也写不进去
    if (S.view === 'loading') {
      ps.innerHTML = '<div class="hm-loading" role="status" data-od-id="home-loading"><span class="spinner"></span><span>正在读取工作文件夹 <span class="mono">' + esc(WORKDIR) + '</span>。在同步盘上、画布又多的时候要等一会儿。</span></div>';
      layout.hidden = false; skeletons(); return;
    }
    if (S.view === 'error') {
      ps.innerHTML = '<section class="hm-state" role="alert" data-od-id="workdir-error">' + icon('alert') +
        '<h2>打不开工作文件夹</h2>' +
        '<p class="hm-state-path mono">' + esc(WORKDIR) + '</p>' +
        '<p class="muted">这个路径现在读不到。可能是同步盘还没连上，或者文件夹被挪走、改了名。连上同步盘后点「重试」；文件夹换了地方，就去设置里重新选。</p>' +
        '<div class="row hm-state-acts"><button class="btn btn-secondary" id="retry" data-icon="retry">重试</button>' +
        '<a class="btn btn-primary" href="settings.html#workdir" data-icon="folder">去设置里换</a></div></section>';
      layout.hidden = true; hydrateIcons(ps); return;
    }
    if (!S.canvases.length) {
      ps.innerHTML = '<section class="hm-state" data-od-id="no-canvas">' + icon('node') +
        '<h2>还没有画布</h2>' +
        '<p class="muted">工作文件夹 <span class="mono">' + esc(WORKDIR) + '</span> 里还没有画布。一个创作项目建一张画布，在里面建节点、写需求、反复试。</p>' +
        '<div class="row hm-state-acts"><button class="btn btn-primary btn-lg" id="stateNew" data-icon="plus">新建第一张画布</button></div></section>';
      layout.hidden = true; hydrateIcons(ps); return;
    }
    ps.innerHTML = ''; layout.hidden = false;
    renderRecent(); renderStars(); renderCanvases();
  }

  /* ─── 画布：打开、改名、删除、新建、搜索 ─────────────────── */
  function notBuilt() {
    toast('原型里只做了「新年广告片」这张画布的内容', { action: '去看看', onAction: function () { location.href = 'canvas.html'; } });
  }
  function rename(art, c) {
    var h = art.querySelector('.hm-cv-title');
    var input = document.createElement('input');
    input.className = 'input hm-cv-rename'; input.value = c.title; input.maxLength = 30;
    h.replaceWith(input); input.focus(); input.select();
    var done = false;
    function fin(save) {
      if (done) return; done = true;
      var v = input.value.trim();
      if (save && v && v !== c.title) { c.title = v; toast('已改名为「' + esc(v) + '」'); markSaved(); }
      render();
    }
    input.onkeydown = function (e) { if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); };
    input.onblur = function () { fin(true); };
  }
  function removeNow(c) {
    var i = S.canvases.indexOf(c);
    S.canvases.splice(i, 1); render();
    toast('「' + esc(c.title) + '」已移到回收站', { action: '撤销', ms: 8000, onAction: function () {
      S.canvases.splice(i, 0, c); render(); toast('已撤销，「' + esc(c.title) + '」回来了');
    } });
  }
  function remove(c) {
    confirmBox({
      title: '删除「' + esc(c.title) + '」？',
      body: '里面的 ' + c.nodes + ' 个节点和图片副本会一起移到工作文件夹的回收站，不是真删：<br><span class="mono" style="font-size:12px">' + esc(WORKDIR) + '\\.trash\\' + c.id + '</span>',
      ok: '移到回收站', danger: true, onOk: function () { removeNow(c); }
    });
  }

  document.addEventListener('click', function (e) {
    var close = e.target.closest('[data-close]');
    if (close) { close.closest('dialog').close(); return; }

    var node = e.target.closest('.hm-node[data-node]');
    if (node && node.getAttribute('href') === '#') { e.preventDefault(); notBuilt(); return; }

    var item = e.target.closest('.hm-star-item[data-star]');
    if (item) {
      var s = S.stars.filter(function (x) { return x.key === item.dataset.star; })[0];
      var cp = e.target.closest('[data-copy]');
      if (cp) {
        var l = cp.dataset.copy, text = l ? s.translations[l].text : s.text;
        copyText(text, l ? '已复制' + l + '译文（' + fmtNum(text.length) + ' 字）' : '已复制提示词（' + fmtNum(text.length) + ' 字）');
        return;
      }
      if (e.target.closest('[data-upload]')) { openUpload(s); return; }
      if (e.target.closest('[data-go]') && !s.href) { e.preventDefault(); notBuilt(); }
      return;
    }

    var art = e.target.closest('.hm-cv[data-id]');
    if (art) {
      var c = canvasOf(art.dataset.id);
      var m = e.target.closest('[data-menu]');
      if (m) {
        e.preventDefault();
        showMenu(m, [
          { label: '打开', icon: 'arrow-right', onClick: function () { if (c.href) location.href = c.href; else notBuilt(); } },
          { label: '改名', icon: 'edit', onClick: function () { rename(art, c); } },
          { sep: true },
          { label: '删除（移到回收站）', icon: 'trash', danger: true, onClick: function () { remove(c); } }
        ]);
        return;
      }
      if (e.target.closest('.hm-cv-link') && !c.href) { e.preventDefault(); notBuilt(); }
      return;
    }

    if (e.target.closest('#clearSearch')) { S.q = ''; $('#search').value = ''; renderCanvases(); $('#search').focus(); return; }
    if (e.target.closest('#retry')) { S.view = 'loading'; render(); setTimeout(function () { S.view = 'error'; render(); toast('还是打不开：找不到这个路径', { tone: 'danger' }); }, 1400); return; }
    if (e.target.closest('#stateNew')) { openNew(); }
  });

  var qTimer;
  $('#search').addEventListener('input', function (e) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { S.q = e.target.value; renderCanvases(); }, 120);
  });

  var dlg = $('#dlgNew');
  function newHint(msg, bad) {
    $('#newHint').textContent = msg;
    $('#newHint').parentNode.className = 'hint row-between' + (bad ? ' is-error' : '');
    $('#newTitle').classList.toggle('is-error', !!bad);
  }
  function openNew() {
    $('#newTitle').value = ''; $('#newCount').textContent = '0/30';
    newHint('一个创作项目一张画布，建好后在里面建节点。');
    dlg.showModal();
  }
  $('#btnNew').onclick = openNew;
  $('#newTitle').addEventListener('input', function (e) {
    $('#newCount').textContent = Array.from(e.target.value).length + '/30';
    if (e.target.value.trim()) newHint('一个创作项目一张画布，建好后在里面建节点。');
  });
  $('#newOk').onclick = function (e) {
    if (!$('#newTitle').value.trim()) { e.preventDefault(); newHint('先起个名字', true); $('#newTitle').focus(); }
  };
  dlg.addEventListener('close', function () {
    var v = $('#newTitle').value.trim();
    if (dlg.returnValue !== 'ok' || !v) return;
    if (S.view !== 'ready') S.view = 'ready';
    S.canvases.unshift({ id: 'cv-' + Math.random().toString(16).slice(2, 8), title: v, nodes: 0, stars: 0, ts: Date.now(), cover: null, _new: true });
    render(); markSaved();
    toast('建好了「' + esc(v) + '」');
  });

  /* ─── 上传清单 ─────────────────────────────────────────── */
  var upCur = null;
  function openUpload(s) {
    var used = {}, m, re = /<Picture (\d+)>/g;
    while ((m = re.exec(s.text))) used[+m[1]] = true;
    var missing = Object.keys(used).map(Number).filter(function (k) { return k > s.imgs.length; }).sort();
    var unused = s.imgs.map(function (id, i) { return i + 1; }).filter(function (k) { return !used[k]; });
    $('#upSub').textContent = canvasOf(s.canvas).title + ' › ' + s.nodeTitle + ' · ' + s.label + ' · 共 ' + s.imgs.length + ' 张，按编号顺序上传';
    var html = '';
    if (missing.length) html += '<div class="up-alert is-danger">' + icon('alert') + '<div>提示词里写了 <b class="mono">' + missing.map(function (k) { return '&lt;Picture ' + k + '&gt;'; }).join('、') + '</b>，但这条只带了 ' + s.imgs.length + ' 张图。上传前先改提示词，不然平台会找不到这张图。</div></div>';
    if (unused.length) html += '<div class="up-alert is-warn">' + icon('info') + '<div><b class="mono">' + unused.map(function (k) { return '&lt;Picture ' + k + '&gt;'; }).join('、') + '</b> 在提示词里没用到。可以不传，但编号要保持连续的话还是得传。</div></div>';
    var paths = [];
    html += '<div class="up-list">' + s.imgs.map(function (id, i) {
      var im = IMAGES[id];
      var path = im.proc ? im.proc.copy : im.missing ? im.copy : imagePath(id);
      paths.push((i + 1) + '. ' + path);
      var tag = im.proc ? '<span class="tag tag-warn">传处理过的副本</span>'
        : im.missing ? '<span class="tag tag-danger">原文件不在了，传程序存的副本</span>'
        : '<span class="tag tag-ok">' + icon('check') + '原图</span>';
      var note = im.proc ? im.proc.note + '。原文件在 <span class="mono">' + esc(imagePath(id)) + '</span>，不要传它'
        : im.missing ? '原来在 <s class="mono">' + esc(imagePath(id)) + '</s>，已经找不到了'
        : (im.w ? im.w + '×' + im.h + ' · ' : '') + esc(im.size || '');
      return '<div class="up-row' + (used[i + 1] ? '' : ' is-unused') + '">' +
        '<div class="up-num">' + (i + 1) + '<small>号</small></div><div class="up-thumb">' + thumb(id) + '</div>' +
        '<div class="up-info"><div class="up-name">' + esc(im.name) + tag + (used[i + 1] ? '' : '<span class="tag tag-warn">没用到</span>') + '</div>' +
          '<div class="up-path">' + esc(path) + '</div><div class="up-note">' + note + '</div></div>' +
        '<div class="up-acts"><button class="btn btn-secondary btn-sm" data-reveal="' + esc(path) + '">' + icon('reveal') + '在资源管理器里显示</button>' +
          '<button class="btn btn-ghost btn-sm" data-copy-path="' + esc(path) + '">' + icon('copy') + '复制路径</button></div></div>';
    }).join('') + '</div>';
    if (!s.imgs.length) html += '<p class="muted" style="padding:28px 0;text-align:center">这条提示词没有带参考图，只要复制提示词就行。</p>';
    $('#upBody').innerHTML = html;
    $('#upFootNote').textContent = s.imgs.length ? '按 1 → ' + s.imgs.length + ' 的顺序传到第三方平台' : '';
    upCur = { text: s.text, paths: paths };
    $('#dlgUpload').showModal();
  }
  $('#upBody').addEventListener('click', function (e) {
    var r = e.target.closest('[data-reveal]'), c = e.target.closest('[data-copy-path]');
    if (r) toast('已在资源管理器里选中 ' + r.dataset.reveal.split('\\').pop());
    if (c) copyText(c.dataset.copyPath, '已复制路径');
  });
  $('#upCopyAll').onclick = function () { copyText(upCur.paths.join('\n'), '已复制 ' + upCur.paths.length + ' 个路径'); };
  $('#upCopyPrompt').onclick = function () { copyText(upCur.text, '已复制提示词（' + fmtNum(upCur.text.length) + ' 字）'); };

  /* ─── 原型用：切到各种状态 ─────────────────────────────── */
  function proto(v) {
    reset();
    switch (v) {
      case 'loading': S.view = 'loading'; break;
      case 'error': S.view = 'error'; break;
      case 'noCanvas': S.canvases = []; S.nodes = []; S.stars = []; break;
      case 'noNodes':
        S.canvases = [
          { id: MAIN, title: '新年广告片', nodes: 2, stars: 0, cover: null, ts: at(TODAY + '17:48:00'), href: 'canvas.html' },
          { id: 'cv-new01', title: '春节回家短片', nodes: 0, stars: 0, cover: null, ts: at(TODAY + '17:30:00') }
        ];
        S.nodes = []; S.stars = []; break;
      case 'noStars':
        S.stars = [];
        S.nodes = S.nodes.map(function (n) { return Object.assign({}, n, { starred: false }); });
        S.canvases.forEach(function (c) { c.stars = 0; }); break;
      case 'keysOk': S.keys = []; break;
      case 'many':
        MORE_TITLES.forEach(function (t, i) {
          S.canvases.push({ id: 'cv-m' + pad(i), title: t, nodes: (i * 7) % 19 + (i % 3 ? 1 : 0), stars: i % 5 === 0 ? 1 : 0, cover: MORE_COVERS[i],
            ts: at('2026-02-01T10:00:00') - i * 5 * 864e5 });
        });
        break;
      case 'searchMiss': S.q = '咖啡机'; $('#search').value = S.q; break;
    }
    render();
    if (v === 'deleted') removeNow(canvasOf('cv-2c91d0'));
  }
  $('#proto').addEventListener('change', function (e) { proto(e.target.value); });

  hydrateIcons();
  reset();
  render();
})();
