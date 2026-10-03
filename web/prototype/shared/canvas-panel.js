/* 画布工作台 · 右侧对话面板：对话、版本、提示词框、槽位、未发出的改动、图片引用、生成与失败 */

var Panel = (function () {
  var P = { nodeId: null, items: [], copied: [] };
  var elThread = $('#thread'), elInput = $('#input');
  var streams = {}, sidSeq = 0, savedRange = null, lastStepPush = 0;
  var SECTION_RE = /^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music):\s*$/;

  function node() { return nodeById(P.nodeId); }
  function walk(arr, out) {
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      out.push({ p: p, arr: arr, idx: i });
      var v = p.versions[p.cur];
      if (v.rest) return walk(v.rest, out);
    }
    return out;
  }
  function now() { var d = new Date(), z = function (x) { return String(x).padStart(2, '0'); }; return z(d.getHours()) + ':' + z(d.getMinutes()); }
  function lastUserVersion(n) {
    var t = fullThread(n);
    for (var i = t.length - 1; i >= 0; i--) if (t[i].role === 'user') return t[i].versions[t[i].cur];
    return null;
  }
  function isStreaming(n) { return Object.keys(streams).some(function (k) { return streams[k].nodeId === n.id; }); }
  function modelOf(id) { return MODEL_CONFIGS.filter(function (m) { return m.id === id; })[0]; }
  function costOf(v) {
    var m = modelOf(v.model);
    if (!m || !m.price || v.manual || v.failed || v.tin == null) return null;
    return ((v.tin - v.tcache) * m.price.inp + v.tcache * m.price.cache + v.tout * m.price.out) / 1e6;
  }
  function fmtCost(c) { return '¥' + (c < 0.1 ? c.toFixed(3) : c.toFixed(2)); }
  function sumCost(arr) {
    var s = 0;
    arr.forEach(function (p) { p.versions.forEach(function (v) { s += costOf(v) || 0; if (v.rest) s += sumCost(v.rest); }); });
    return s;
  }

  /* ─── 行内标记：原样显示，只换字色 ───────────────────── */
  function tokens(raw, imgs) {
    var s = esc(raw);
    s = s.replace(/&lt;d&gt;([\s\S]*?)&lt;\/d&gt;/g, '<span class="tk-d"><span class="tk-tag">&lt;d&gt;</span>$1<span class="tk-tag">&lt;/d&gt;</span></span>');
    s = s.replace(/&lt;Picture (\d+)&gt;/g, function (m, n) {
      if (!imgs) return '<span class="tk tk-pic">' + m + '</span>';
      var id = imgs[+n - 1];
      if (!id) return '<span class="tk tk-pic is-missing" title="这条只带了 ' + imgs.length + ' 张图，没有 ' + n + ' 号">' + m + '</span>';
      return '<span class="tk tk-pic" title="' + n + ' 号：' + esc(IMAGES[id].name) + '">' + m + '</span>';
    });
    s = s.replace(/&lt;Subject \d+&gt;/g, '<span class="tk tk-sub">$&</span>');
    s = s.replace(/\[Shot \d+\]( At \d\d:\d\d\.\d{3})?/g, '<span class="tk tk-shot">$&</span>');
    s = s.replace(/\[(reference generation|keyframe completion|video editing|video continuation|audio reuse|audio reference)( \+ [a-z ]+)*\]/g, '<span class="tk tk-type">$&</span>');
    s = s.replace(/\b(fully_preserved|partially_preserved|weak_reference)\b/g, '<span class="tk tk-type">$&</span>');
    return s;
  }
  /* 剧本排法：行首的镜头号（连同时间点）、主体号、图片号放进左栏，正文在右栏 */
  var LEAD_RE = /^(\[Shot \d+\])(?: (At \d\d:\d\d\.\d{3},?))?\s*|^(<(?:Subject|Picture) \d+>)\s*/;
  function promptLine(line, imgs) {
    var m = line.match(LEAD_RE);
    if (!m) return '<div class="pb-line">' + tokens(line, imgs) + '</div>';
    var gut = m[1]
      ? '<span class="pb-shot">' + esc(m[1]) + '</span>' + (m[2] ? '<span class="pb-tc">' + esc(m[2]) + '</span>' : '')
      : tokens(m[3], imgs);
    return '<div class="pb-row' + (m[1] ? ' is-shot' : '') + '"><div class="pb-gut">' + gut + '</div>' +
      '<div class="pb-line">' + tokens(line.slice(m[0].length), imgs) + '</div></div>';
  }
  function promptHTML(text, imgs) {
    var html = '', open = false;
    text.split('\n').forEach(function (line) {
      if (SECTION_RE.test(line)) {
        if (open) html += '</div>';
        html += '<div class="pb-sec"><div class="pb-key">' + esc(line) + '</div>';
        open = true;
      } else if (line.trim()) {
        html += promptLine(line, imgs);
      }
    });
    return html + (open ? '</div>' : '');
  }

  /* ─── 渲染 ─────────────────────────────────────────── */
  function actBtn(act, label, ic, k, src, extra) {
    return '<button class="btn btn-ghost btn-sm" data-act="' + act + '" data-k="' + k + '" data-src="' + src + '"' + (extra || '') + ' title="' + label + '">' + icon(ic) + '<span class="lbl">' + label + '</span></button>';
  }
  function verSwitch(p, k) {
    if (p.versions.length < 2) return '';
    return '<span class="ver" title="同一位置有 ' + p.versions.length + ' 个版本">' +
      '<button data-act="vprev" data-k="' + k + '" data-src="o" aria-label="上一个版本"' + (p.cur === 0 ? ' disabled' : '') + '>' + icon('chev-left', 'icon-sm') + '</button>' +
      '<span>' + (p.cur + 1) + '/' + p.versions.length + '</span>' +
      '<button data-act="vnext" data-k="' + k + '" data-src="o" aria-label="下一个版本"' + (p.cur === p.versions.length - 1 ? ' disabled' : '') + '>' + icon('chev-right', 'icon-sm') + '</button></span>';
  }
  function imgsFor(src, k) {
    var all = P.copied.concat(P.items);
    var g = src === 'c' ? k : P.copied.length + k;
    for (var i = g - 1; i >= 0; i--) if (all[i].p.role === 'user') return all[i].p.versions[all[i].p.cur].imgs;
    return [];
  }

  function renderUser(it, k, src) {
    var ro = src === 'c', p = it.p, v = p.versions[p.cur];
    if (!ro && it.p._editing) return renderUserEdit(it, k, v);
    var imgs = v.imgs.map(function (id, i) {
      return '<div class="msg-img" title="' + (i + 1) + ' 号：' + esc(IMAGES[id].name) + '">' + thumbHTML(id) + '<span class="num-badge">' + (i + 1) + '</span></div>';
    }).join('');
    return '<div class="msg msg-user" data-od-id="msg-user">' +
      '<div class="msg-head"><span class="msg-role">需求</span><span class="msg-time">' + esc(v.at || '') + '</span>' + (ro ? '' : verSwitch(p, k)) +
        '<div class="msg-actions">' + (ro ? '' : actBtn('edit', '改这句', 'edit', k, src)) + actBtn('fork', '从这里岔出', 'branch', k, src) + '</div></div>' +
      '<div class="bubble">' +
        (v.auto ? '<div class="autonote"><span class="tag tag-outline" title="程序在发送时自动附上的说明，不是手打的">自动附加</span><span>' + tokens(v.auto, v.imgs) + '</span></div>' : '') +
        '<div class="msg-text">' + tokens(v.text, v.imgs) + '</div>' +
        (imgs ? '<div class="msg-imgs">' + imgs + '</div>' : '') +
        '<div class="meta" style="margin-top:8px">这条带了 ' + v.imgs.length + ' 张图 · ' + (v.size ? '<span class="mono">' + v.size + '</span> · ' + v.count + ' 张' : v.duration + ' 秒 · ' + v.ratio) + '</div>' +
      '</div></div>';
  }
  function renderUserEdit(it, k, v) {
    return '<div class="msg msg-user msg-edit">' +
      '<div class="msg-head"><span class="msg-role">改这句</span><span class="meta">改完会多出一个版本，原来的那版和它后面的对话都还在</span></div>' +
      '<textarea class="textarea" id="editArea" data-k="' + k + '">' + esc(v.text) + '</textarea>' +
      '<p class="hint" style="margin-top:6px">只改文字。那时候带的 ' + v.imgs.length + ' 张图、' + (v.size ? v.size + '、' + v.count + ' 张' : v.duration + ' 秒、' + v.ratio) + ' 照旧。</p>' +
      '<div class="row"><button class="btn btn-secondary btn-sm" data-act="editCancel" data-k="' + k + '" data-src="o">取消</button>' +
      '<button class="btn btn-primary btn-sm" data-act="editSend" data-k="' + k + '" data-src="o">' + icon('send') + '发送修改</button></div></div>';
  }

  function renderAI(it, k, src) {
    var ro = src === 'c', p = it.p, v = p.versions[p.cur];
    var imgs = imgsFor(src, k);
    var live = !!v.streaming;
    var tags = '';
    if (v.manual) tags += '<span class="tag">' + icon('edit') + '手动修改</span>';
    else if (v.regen) tags += '<span class="tag">重答</span>';
    if (v.stopped) tags += '<span class="tag tag-warn">已叫停</span>';
    var html = '<div class="msg msg-ai" data-od-id="msg-ai"' + (v._sid ? ' data-sid="' + v._sid + '"' : '') + '>' +
      '<div class="msg-head"><span class="msg-role">回复</span><span class="msg-time">' + esc(v.at || '') + '</span>' + tags + (ro ? '' : verSwitch(p, k)) +
      '<div class="msg-actions">' + (!ro && !v.manual && !live ? actBtn('regen', '重答', 'retry', k, src) : '') + (!live && !v.failed ? actBtn('fork', '从这里岔出', 'branch', k, src) : '') + '</div></div>';

    if (v.failed) {
      return html + '<div class="failbox" data-od-id="msg-failed"><div class="row" style="align-items:flex-start;gap:10px">' +
        '<span style="color:var(--danger);margin-top:2px">' + icon('warn') + '</span><div class="grow">' +
        '<p><b>请求失败</b> <span class="mono">' + esc(v.failed.code) + '</span> · ' + esc(v.failed.reason) + '</p>' +
        '<p class="meta" style="margin-top:2px">' + esc(v.failed.at) + ' · 失败的这条不会带进之后的对话</p></div>' +
        (ro ? '' : '<button class="btn btn-secondary btn-sm" data-act="retry" data-k="' + k + '" data-src="o">' + icon('retry') + '重试</button>') +
        '</div></div></div>';
    }

    html += ImgUI.thinkHTML(v);
    if (v._thinkStart) return html + '</div>';
    var image = isImageNode(node());
    var introLen = live ? v._is : v.intro ? v.intro.length : 0;
    var introDone = !live || v._is >= (v.intro || '').length;
    if (v.intro) html += '<div class="intro">' + tokens(v.intro.slice(0, introLen), imgs) + (live && !introDone ? '<span class="caret"></span>' : '') + '</div>';

    (v.boxes || []).forEach(function (b, j) {
      var shown = live ? v._bs[j] : b.text.length;
      if (live && (shown === 0 && (!introDone || j > 0 && v._bs[j - 1] < v.boxes[j - 1].text.length))) return;
      var writing = live && shown < b.text.length;
      var text = b.text.slice(0, shown);
      if (b._editing && !ro) { html += renderBoxEditor(b, k, j, imgs); return; }
      if (image) { html += ImgUI.boxHTML(node(), v, b, k, j, src, ro, { writing: writing, shown: shown }); return; }
      var long = b.text.length > 700 && !b._open && !writing;
      html += '<div class="pbox' + (b.starred ? ' is-starred' : '') + (writing || b.incomplete ? ' is-writing' : '') + '" data-od-id="prompt-box">' +
        '<div class="pb-head"><span class="pb-label' + (b.label ? '' : ' is-plain') + '">' + esc(b.label || '提示词') + '</span>' +
        '<div class="pb-actions">' +
          actBtn('copy', '复制', 'copy', k, src, ' data-j="' + j + '"') +
          (writing ? '' : actBtn('translate', '翻译', 'translate', k, src, ' data-j="' + j + '"')) +
          (ro ? '' : '<button class="btn btn-ghost btn-sm' + (b.starred ? ' is-star' : '') + '" data-act="star" data-k="' + k + '" data-j="' + j + '" data-src="o" title="' + (b.starred ? '取消星标' : '打星：这版效果好') + '">' + icon('star', b.starred ? 'icon-fill' : '') + '<span class="lbl">' + (b.starred ? '已打星' : '打星') + '</span></button>') +
          (ro || writing ? '' : actBtn('editBox', '手动改', 'edit', k, src, ' data-j="' + j + '"')) +
          actBtn('upload', '上传清单', 'list', k, src, ' data-j="' + j + '"') +
          (writing ? '' : actBtn('continue', '沿这个方向继续', 'arrow-right', k, src, ' data-j="' + j + '"')) +
        '</div></div>' +
        '<div class="pb-body' + (long ? ' is-clamped' : '') + '">' + promptHTML(text, imgs) + (writing ? '<span class="caret"></span>' : '') + '</div>' +
        (long ? '<div class="pb-more"><button class="btn btn-ghost btn-sm" data-act="expand" data-k="' + k + '" data-j="' + j + '" data-src="' + src + '">' + icon('chev-down') + '展开全文 · ' + fmtNum(b.text.length) + ' 字</button></div>' : '') +
        (writing ? '<div class="pb-foot"><span class="writing-tag"><span class="spinner"></span>还没写完</span><span class="mono">' + fmtNum(shown) + ' 字</span></div>' : '') +
        (b.incomplete ? '<div class="pb-foot" style="color:var(--warn)">' + icon('warn') + '叫停时还没写完，这条提示词不完整</div>' : '') +
      '</div>';
    });

    var meta = '';
    if (v.manual) meta = '手动修改，没有调用 AI';
    else {
      var m = modelOf(v.model);
      var c = costOf(v);
      meta = '<span class="row" style="gap:4px">' + icon('cpu', 'icon-sm') + '<span class="mono">' + esc(m ? m.model : v.model) + '</span></span>' +
        '<button data-act="sys" data-k="' + k + '" data-src="' + src + '" title="查看发这条时用的系统提示词原文">' + esc(v.sys) + '</button>' +
        (live ? '<span class="row" style="gap:6px"><span class="dot dot-live"></span>正在回复 · 已输出 <span class="mono">' + fmtNum(v.tout || 0) + '</span> tokens</span>'
              : '<span>输入 <span class="mono">' + fmtNum(v.tin) + '</span>' + (v.tcache ? '（缓存命中 <span class="mono">' + fmtNum(v.tcache) + '</span>）' : '') + ' · 输出 <span class="mono">' + fmtNum(v.tout) + '</span> tokens</span>' +
                (c != null ? '<span class="mono" style="color:var(--fg)">' + fmtCost(c) + '</span>' : '<span>没填价格</span>'));
    }
    return html + '<div class="msg-meta">' + meta + '</div></div>';
  }
  function renderBoxEditor(b, k, j, imgs) {
    return '<div class="pbox" data-od-id="prompt-box-editor"><div class="pb-head"><span class="pb-label">手动改' + (b.label ? '：' + esc(b.label) : '') + '</span>' +
      '<span class="meta">存成新版本，不会重新问 AI</span></div>' +
      '<div class="pb-editor"><div class="composer"><div class="composer-input" id="boxEditor" contenteditable="true">' + textToEditable(b.text, imgs) + '</div></div>' +
      '<div class="composer-error" id="boxEditorError" hidden></div>' +
      '<div class="row"><button class="btn btn-ghost btn-sm" data-act="boxRef">' + icon('at') + '引用图片</button><span class="grow"></span>' +
      '<button class="btn btn-secondary btn-sm" data-act="boxCancel" data-k="' + k + '" data-j="' + j + '" data-src="o">取消</button>' +
      '<button class="btn btn-primary btn-sm" data-act="boxSave" data-k="' + k + '" data-j="' + j + '" data-src="o">' + icon('check') + '存成新版本</button></div></div></div>';
  }

  function renderThread(keepScroll) {
    var n = node();
    var st = elThread.scrollTop, nearBottom = elThread.scrollHeight - elThread.clientHeight - st < 80;
    P.copied = (COPIED[n.id] || []).map(function (p, i) { return { p: p, arr: null, idx: i }; });
    P.items = walk(THREADS[n.id], []);
    var html = '';
    if (P.copied.length) {
      var parent = nodeById(n.forkFrom.node);
      html += '<details class="copied" data-od-id="copied-messages"><summary>' + icon('branch') + '<span class="grow">从「' + esc(parent ? parent.title : '已删除的节点') + '」复制来的 ' + P.copied.length + ' 条消息</span>' + icon('chev-down', 'chev') + '</summary><div class="copied-inner">' +
        P.copied.map(function (it, k) { return it.p.role === 'user' ? renderUser(it, k, 'c') : renderAI(it, k, 'c'); }).join('') + '</div></details>';
    }
    html += P.items.map(function (it, k) { return it.p.role === 'user' ? renderUser(it, k, 'o') : renderAI(it, k, 'o'); }).join('');
    if (!P.copied.length && !P.items.length) {
      html = '<div style="padding:48px 12px;text-align:center" class="stack"><h3>这个节点还没有对话</h3>' +
        '<p class="muted" style="margin-top:6px;font-size:13px">' + (isImageNode(n) ? '用中文写想要什么样的图，AI 会写成 Danbooru 标签。<br>槽位里放图，AI 能照着图写。' : '先在下面放参考图、选时长和比例，再写需求发出去。') + '<br>AI 第一次回复时会给节点起标题。</p></div>';
    }
    elThread.innerHTML = html;
    if (keepScroll === 'bottom' || (keepScroll && nearBottom)) elThread.scrollTop = elThread.scrollHeight;
    else if (keepScroll) elThread.scrollTop = st;
  }

  function renderHead() {
    var n = node(); if (!n) return;
    var t = $('#drTitle');
    if (t) { t.textContent = n.title; t.style.fontStyle = n.untitled ? 'italic' : ''; }
    var sub = [];
    if (n.forkFrom) {
      var p = nodeById(n.forkFrom.node);
      sub.push(icon('branch', 'icon-sm') + '<span>从' + (p ? '「<a href="#" data-goto="' + p.id + '">' + esc(p.title) + '</a>」' : '已删除的节点') + '第 ' + n.forkFrom.count + ' 条消息岔出</span>');
    }
    if (n.untitled) sub.push('<span>发出第一条后 AI 会起标题</span>');
    else if (n.titleManual) sub.push('<span>标题手动改过，AI 不再覆盖</span>');
    $('#drSub').innerHTML = sub.join('<span>·</span>');
    $('#cfgModel').innerHTML = MODEL_CONFIGS.map(function (m) { return '<option value="' + m.id + '"' + (m.id === n.model ? ' selected' : '') + '>' + esc(m.name) + ' · ' + esc(m.model) + '</option>'; }).join('');
    var opt = function (s) { return '<option value="' + esc(s) + '"' + (s === n.sys ? ' selected' : '') + '>' + esc(s) + (seriesOf(s) ? ' · ' + seriesOf(s) : '') + '</option>'; };
    $('#cfgSys').innerHTML = '<optgroup label="写视频提示词">' + SYSTEM_PROMPTS.filter(function (s) { return !seriesOf(s); }).map(opt).join('') + '</optgroup>' +
      '<optgroup label="写生图标签">' + SYSTEM_PROMPTS.filter(seriesOf).map(opt).join('') + '</optgroup>';
    var th = ImgUI.thinkLevel(n), te = $('#cfgThink');
    te.innerHTML = icon('brain', 'icon-sm') + '<span>' + (th.on ? '思考 ' + th.lv : th.model ? '不思考' : '不支持思考') + '</span>';
    te.title = th.on ? '写提示词时先思考，档位「' + th.lv + '」（跟设置里的总开关）。点一下去设置里改' : th.model ? '设置里写提示词的思考是「关」。点一下去设置里改' : '这套模型配置的「开思考的写法」是不支持。点一下去设置里改';
    te.classList.toggle('is-on', !!th.on);
    var c = sumCost(THREADS[n.id]);
    $('#drCost').textContent = c ? '这个节点花了 ' + fmtCost(c) : '';
  }

  /* ─── 槽位 ─────────────────────────────────────────── */
  function autoNote(n) {
    var prev = lastUserVersion(n), cur = n.slots, parts = [];
    var pic = function (i) { return '<Picture ' + i + '>'; };
    var img = isImageNode(n);
    if (!prev) return (cur.length ? '参考图共 ' + cur.length + ' 张，编号如下。' : '') + (img ? '' : '视频时长 ' + n.duration + ' 秒，画面比例 ' + n.ratio + '。');
    var p = prev.imgs;
    if (p.join() !== cur.join()) {
      if (cur.length > p.length && cur.slice(0, p.length).join() === p.join()) {
        var added = []; for (var i = p.length; i < cur.length; i++) added.push(pic(i + 1));
        parts.push('新增参考图：' + added.join('、') + '。');
      } else if (cur.length === p.length) {
        var changed = [], moved = false;
        cur.forEach(function (id, i) { if (id !== p[i]) { changed.push(pic(i + 1)); if (p.indexOf(id) >= 0) moved = true; } });
        parts.push(moved ? '参考图已重新编号，以下是当前全部 ' + cur.length + ' 张参考图，以此为准，之前的编号作废。' : changed.join('、') + ' 换成了下面的新图，其他不变。');
      } else {
        parts.push('参考图已重新编号，以下是当前全部 ' + cur.length + ' 张参考图，以此为准，之前的编号作废。');
      }
    }
    if (!img && prev.duration != null && prev.duration !== n.duration) parts.push('视频时长改为 ' + n.duration + ' 秒。');
    if (!img && prev.ratio != null && prev.ratio !== n.ratio) parts.push('画面比例改为 ' + n.ratio + '。');
    return parts.join('');
  }
  function hasPending(n) { return !!lastUserVersion(n) && !!autoNote(n); }

  function renderPending() {
    var n = node(), el = $('#pending'), prev = lastUserVersion(n);
    var note = prev ? autoNote(n) : '';
    if (!note) { el.hidden = true; return; }
    var map = '';
    if (/重新编号/.test(note)) {
      map = '<div style="margin-top:4px">' + n.slots.map(function (id, i) {
        var was = prev.imgs.indexOf(id);
        if (was === i) return '';
        return '<div>现在的 <span class="tk tk-pic">&lt;Picture ' + (i + 1) + '&gt;</span> 是 ' + esc(IMAGES[id].name) + (was >= 0 ? '（原来是 ' + (was + 1) + ' 号）' : '（新加的）') + '</div>';
      }).join('') + '</div>';
    }
    el.innerHTML = icon('info') + '<div class="grow"><b>有改动还没发出去。</b>下次发消息时会自动附上：<q>' + tokens(note, n.slots) + '</q>' + map + '</div>' +
      '<button class="btn btn-ghost btn-sm" id="revertPending" title="槽位、时长、比例回到上次发出时的样子">撤回改动</button>';
    el.hidden = false;
  }

  function renderSlots() {
    var n = node(), html = '';
    for (var i = 0; i < 9; i++) {
      var id = n.slots[i];
      if (id) {
        var im = IMAGES[id];
        var busy = n._processing && n._processing[id];
        var tip = (i + 1) + ' 号：' + im.name + (im.proc ? '\n程序处理过：' + im.proc.note : '') + (im.missing ? '\n原文件已经不在了，用的是程序存的那份' : '');
        html += '<div class="slot is-filled' + (n._flash && n._flash.indexOf(i) >= 0 ? ' is-renumbered' : '') + '" draggable="true" data-i="' + i + '" title="' + esc(tip) + '" tabindex="0" data-od-id="slot-' + (i + 1) + '">' +
          thumbHTML(id) + '<span class="num-badge">' + (i + 1) + '</span>' +
          (im.proc || im.missing ? '<span class="proc">' + (im.missing ? '副本' : '处理过') + '</span>' : '') +
          (busy ? '<div class="processing"><div><span class="spinner"></span>处理中</div></div>' : '') + '</div>';
      } else if (i === n.slots.length) {
        html += '<button class="slot is-empty is-next" data-next title="放图进 ' + (i + 1) + ' 号" data-od-id="slot-add">' + icon('plus') + '</button>';
      } else {
        html += '<div class="slot is-empty" aria-hidden="true">' + (i + 1) + '</div>';
      }
    }
    $('#slots').innerHTML = html;
    $('#slotCount').textContent = n.slots.length + '/9';
    $('#durVal').textContent = n.duration + ' 秒';
    $('#durDown').disabled = n.duration <= 4;
    $('#durUp').disabled = n.duration >= 15;
    $('#ratioSel').value = n.ratio;
    ImgUI.renderDock(n);
  }
  function refreshDock() {
    if (!node()) return;
    renderSlots(); renderPending(); updateRefChips(elInput); updateSendBtn();
    var ed = $('#boxEditor'); if (ed) updateRefChips(ed);
  }
  function slotChanged(label, fn, flash) {
    var n = node();
    var now = Date.now();
    if (!(label === '改时长' && G.undo.length && G.undo[G.undo.length - 1].label === label && now - lastStepPush < 1200)) pushUndo(label);
    lastStepPush = now;
    fn(n);
    if (flash && flash.length) { n._flash = flash; setTimeout(function () { n._flash = null; if (P.nodeId === n.id) renderSlots(); }, 1100); }
    refreshDock(); renderGraph(); markSaved();
  }
  function addImages(ids, opts) {
    var n = node(); opts = opts || {};
    var skipped = [], dup = [], put = [];
    ids.forEach(function (id) {
      var im = IMAGES[id];
      if (im.unsupported) { skipped.push(im.name + '（' + im.unsupported + ' 格式用不了）'); return; }
      if (n.slots.indexOf(id) >= 0) { dup.push(im.name); return; }
      put.push(id);
    });
    var room = 9 - n.slots.length;
    var over = put.length - room;
    if (over > 0) put = put.slice(0, room);
    if (put.length) {
      slotChanged('放图进槽位', function (n) {
        n._processing = n._processing || {};
        put.forEach(function (id) { n.slots.push(id); if (IMAGES[id].proc || IMAGES[id].w > 5760 || IMAGES[id].h > 5760) n._processing[id] = true; });
      });
      var pending = put.filter(function (id) { return n._processing[id]; });
      if (pending.length) setTimeout(function () {
        pending.forEach(function (id) { delete n._processing[id]; });
        if (P.nodeId === n.id) renderSlots();
        toast(pending.map(function (id) { return IMAGES[id].name; }).join('、') + ' 已处理：' + (IMAGES[pending[0]].proc ? IMAGES[pending[0]].proc.note : '尺寸调整到 H3 的范围内') + '。上传时要传处理过的那份');
      }, 1800);
    }
    if (over > 0) toast('槽位满了，只放进去 ' + put.length + ' 张，另外 ' + over + ' 张没放', { tone: 'warn', ms: 4000 });
    else if (put.length && !opts.quiet) toast('放进了 ' + put.length + ' 张，编号 ' + (n.slots.length - put.length + 1) + (put.length > 1 ? '–' + n.slots.length : '') + ' 号');
    if (skipped.length) toast('没放进去：' + skipped.join('、'), { tone: 'danger', ms: 4500 });
    if (dup.length && !opts.quiet) toast(dup.join('、') + ' 已经在槽位里了', { tone: 'warn' });
    return put;
  }
  function removeSlot(i) {
    var n = node(), id = n.slots[i];
    var follow = []; for (var k = i; k < n.slots.length - 1; k++) follow.push(k);
    slotChanged('删掉槽位里的图', function (n) { n.slots.splice(i, 1); }, follow);
    var msg = '删掉了 ' + (i + 1) + ' 号 ' + IMAGES[id].name + '。';
    if (follow.length) msg += '后面的往前补位：原来的 ' + (i + 2) + ' 号现在是 ' + (i + 1) + ' 号';
    toast(msg, { tone: follow.length ? 'warn' : undefined, ms: 4500, action: '撤销', onAction: doUndo });
    if (elInput.querySelector('.ref[data-img="' + id + '"]')) toast('输入框里引用了这张图，现在发不出去', { tone: 'danger', ms: 4500 });
  }
  function moveSlot(from, to) {
    if (from === to) return;
    var n = node(), lo = Math.min(from, to), hi = Math.max(from, to), flash = [];
    for (var k = lo; k <= hi; k++) flash.push(k);
    slotChanged('调整槽位顺序', function (n) { var id = n.slots.splice(from, 1)[0]; n.slots.splice(to, 0, id); }, flash);
    toast(IMAGES[n.slots[to]].name + ' 从 ' + (from + 1) + ' 号挪到 ' + (to + 1) + ' 号，中间的编号跟着变了', { tone: 'warn', ms: 4000 });
  }
  function replaceSlot(i, id) {
    var n = node();
    if (n.slots.indexOf(id) >= 0) { toast('这张图已经在 ' + (n.slots.indexOf(id) + 1) + ' 号了', { tone: 'warn' }); return; }
    if (IMAGES[id].unsupported) { toast(IMAGES[id].name + ' 是 ' + IMAGES[id].unsupported + ' 格式，H3 不支持', { tone: 'danger' }); return; }
    slotChanged('替换槽位里的图', function (n) { n.slots[i] = id; }, [i]);
    toast((i + 1) + ' 号换成了 ' + IMAGES[id].name + '，编号不变');
  }

  $('#slots').addEventListener('click', function (e) {
    if (e.target.closest('[data-next]')) { Assets.open({ mode: 'slots' }); return; }
    var s = e.target.closest('.slot.is-filled'); if (!s) return;
    var i = +s.dataset.i, n = node(), im = IMAGES[n.slots[i]];
    var items = [{ note: (i + 1) + ' 号 · ' + im.name + (im.proc ? ' · 处理过' : '') }];
    if (im.proc) items.push({ note: im.proc.note });
    if (im.missing) items.push({ note: '原文件已经不在了，用的是程序存的那份' });
    items.push({ label: '换一张（从资产库挑）', icon: 'swap', onClick: function () { Assets.open({ mode: 'replace', slot: i }); } });
    if (i > 0) items.push({ label: '往前挪一位', icon: 'chev-left', onClick: function () { moveSlot(i, i - 1); } });
    if (i < n.slots.length - 1) items.push({ label: '往后挪一位', icon: 'chev-right', onClick: function () { moveSlot(i, i + 1); } });
    items.push({ sep: true }, { label: '删掉这格', icon: 'trash', danger: true, onClick: function () { removeSlot(i); } });
    showMenu(s, items, 'left');
  });
  (function dnd() {
    var from = null, el = $('#slots');
    el.addEventListener('dragstart', function (e) {
      var s = e.target.closest('.slot.is-filled'); if (!s) return;
      from = +s.dataset.i; s.classList.add('is-drag-src'); e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'slot:' + from);
    });
    el.addEventListener('dragover', function (e) {
      var s = e.target.closest('.slot.is-filled'); if (from == null || !s) return;
      e.preventDefault();
      $$('.slot.is-drop', el).forEach(function (x) { x.classList.remove('is-drop'); });
      s.classList.add('is-drop');
    });
    el.addEventListener('drop', function (e) {
      var s = e.target.closest('.slot.is-filled'); if (from == null || !s) return;
      e.preventDefault(); var to = +s.dataset.i, f = from; from = null; moveSlot(f, to);
    });
    el.addEventListener('dragend', function () { from = null; $$('.slot', el).forEach(function (x) { x.classList.remove('is-drop', 'is-drag-src'); }); });
  })();

  $('#durDown').onclick = function () { slotChanged('改时长', function (n) { n.duration = Math.max(4, n.duration - 1); }); };
  $('#durUp').onclick = function () { slotChanged('改时长', function (n) { n.duration = Math.min(15, n.duration + 1); }); };
  $('#ratioSel').onchange = function (e) { var v = e.target.value; slotChanged('改比例', function (n) { n.ratio = v; }); };
  $('#pending').addEventListener('click', function (e) {
    if (!e.target.closest('#revertPending')) return;
    var prev = lastUserVersion(node());
    slotChanged('撤回没发出的改动', function (n) { n.slots = prev.imgs.slice(); n.duration = prev.duration; n.ratio = prev.ratio; });
    toast('已回到上次发出时的样子', { action: '撤销', onAction: doUndo });
  });
  $('#slotAssets').onclick = function () { Assets.open({ mode: 'slots' }); };
  $('#slotCollage').onclick = function () { Collage.open(); };
  $('#slotLocal').onclick = function () { $('#localFile').click(); };
  var localSeq = 0;
  $('#localFile').onchange = function (e) {
    var ids = [];
    Array.prototype.forEach.call(e.target.files, function (f) {
      localSeq += 1; var id = 'l' + localSeq;
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      var bad = ['heic', 'heif', 'gif'].indexOf(ext) >= 0 ? ext.toUpperCase() : null;
      IMAGES[id] = { src: bad ? null : URL.createObjectURL(f), name: f.name, folder: null, path: '（电脑里直接选的）' + f.name, w: 0, h: 0, size: (f.size / 1048576).toFixed(1) + ' MB', unsupported: bad };
      if (f.size > 30 * 1048576) IMAGES[id].proc = { note: '文件超过 30 MB，已重新压缩', copy: CANVAS_IMG + f.name };
      ids.push(id);
    });
    e.target.value = '';
    if (ids.length) addImages(ids);
  };

  /* ─── 输入框里的图片引用：跟着槽位走，不是死编号 ────── */
  function chipHTML(id) {
    return '<span class="ref" contenteditable="false" data-img="' + id + '">' + thumbHTML(id) + '<span class="ref-no"></span></span>';
  }
  function updateRefChips(root) {
    var n = node(); if (!n || !root) return;
    $$('.ref', root).forEach(function (r) {
      var i = n.slots.indexOf(r.dataset.img);
      r.classList.toggle('is-broken', i < 0);
      r.querySelector('.ref-no').textContent = i < 0 ? '已不在槽位' : 'Picture ' + (i + 1);
      r.title = IMAGES[r.dataset.img].name + (i < 0 ? '：这张图已经从槽位删掉了' : '：现在是 ' + (i + 1) + ' 号，调了顺序会自动跟着变');
    });
  }
  function textToEditable(text, imgs) {
    return esc(text).replace(/&lt;Picture (\d+)&gt;/g, function (m, k) { var id = imgs[+k - 1]; return id ? chipHTML(id) : m; }).replace(/\n/g, '<br>');
  }
  function serialize(root) {
    var n = node(), out = '', broken = [];
    (function walkDom(el) {
      el.childNodes.forEach(function (c) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.classList && c.classList.contains('ref')) {
          var i = n.slots.indexOf(c.dataset.img);
          if (i < 0) broken.push(c); else out += '<Picture ' + (i + 1) + '>';
        } else if (c.nodeName === 'BR') out += '\n';
        else { if (c.nodeName === 'DIV' && out && !/\n$/.test(out)) out += '\n'; walkDom(c); }
      });
    })(root);
    return { text: out.replace(/\u00a0/g, ' ').trim(), broken: broken };
  }
  function saveRange(root) {
    var sel = getSelection();
    if (sel.rangeCount && root.contains(sel.anchorNode)) savedRange = { root: root, range: sel.getRangeAt(0).cloneRange() };
    else savedRange = { root: root, range: null };
  }
  function insertChip(id) {
    var root = savedRange ? savedRange.root : elInput;
    var n = node();
    if (n.slots.indexOf(id) < 0) {
      if (n.slots.length >= 9) { toast('槽位满了，这张图放不进去，也就没法引用', { tone: 'danger' }); return; }
      if (!addImages([id], { quiet: true }).length) return;
      toast(IMAGES[id].name + ' 先放进了 ' + n.slots.length + ' 号槽位');
    }
    root.focus();
    var sel = getSelection(), range;
    if (savedRange && savedRange.range) range = savedRange.range;
    else { range = document.createRange(); range.selectNodeContents(root); range.collapse(false); }
    sel.removeAllRanges(); sel.addRange(range);
    var tmp = document.createElement('span'); tmp.innerHTML = chipHTML(id);
    var chip = tmp.firstChild, space = document.createTextNode('\u00a0');
    range.insertNode(space); range.insertNode(chip);
    range.setStartAfter(space); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
    updateRefChips(root); clearError();
  }
  function openRefPicker(anchor, root) {
    saveRange(root);
    closeRefPicker();
    var n = node();
    var lib = Object.keys(IMAGES).filter(function (id) { var im = IMAGES[id]; return im.folder === 'f1a' && im.src && n.slots.indexOf(id) < 0; }).slice(0, 6);
    var pop = document.createElement('div');
    pop.className = 'refpick'; pop.id = 'refpick';
    pop.innerHTML =
      '<h4>槽位里的图</h4>' + (n.slots.length ? '<div class="refpick-row">' + n.slots.map(function (id, i) {
        return '<button data-pick="' + id + '" title="' + (i + 1) + ' 号：' + esc(IMAGES[id].name) + '">' + thumbHTML(id) + '<span class="num-badge">' + (i + 1) + '</span></button>';
      }).join('') + '</div>' : '<p class="refpick-note">槽位还是空的</p>') +
      '<h4>资产库里的图</h4><p class="refpick-note">选了会先放进下一个空槽位（' + (n.slots.length < 9 ? (n.slots.length + 1) + ' 号' : '已经满了') + '）</p>' +
      '<div class="refpick-row">' + lib.map(function (id) { return '<button data-pick="' + id + '" title="' + esc(IMAGES[id].name) + '">' + thumbHTML(id) + '</button>'; }).join('') + '</div>' +
      '<button class="btn btn-ghost btn-sm" data-more>' + icon('image') + '在资产库里找…</button>';
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.max(8, r.top - pop.offsetHeight - 8) + 'px';
    pop.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]');
      if (b) { closeRefPicker(); insertChip(b.dataset.pick); return; }
      if (e.target.closest('[data-more]')) { closeRefPicker(); Assets.open({ mode: 'ref' }); }
    });
  }
  function closeRefPicker() { var p = $('#refpick'); if (p) p.remove(); }
  document.addEventListener('pointerdown', function (e) {
    var p = $('#refpick');
    if (p && !p.contains(e.target) && !e.target.closest('#btnRef,[data-act="boxRef"]')) closeRefPicker();
  });

  function showError(html) {
    var box = $('#composerError');
    box.innerHTML = icon('warn') + '<span>' + html + '</span>'; box.hidden = false;
    $('#composer').classList.add('is-error');
  }
  function clearError() { $('#composerError').hidden = true; $('#composer').classList.remove('is-error'); }

  elInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === '@') { e.preventDefault(); openRefPicker($('#btnRef'), elInput); }
    if (e.key === 'Escape') closeRefPicker();
  });
  elInput.addEventListener('input', function () { clearError(); updateSendBtn(); });
  elInput.addEventListener('paste', function (e) {
    e.preventDefault();
    var t = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, t);
  });
  $('#btnRef').onclick = function () { openRefPicker($('#btnRef'), elInput); };
  $('#btnSend').onclick = function () { if (isStreaming(node())) stopNode(node()); else send(); };

  function updateSendBtn() {
    var n = node(), b = $('#btnSend'); if (!n) return;
    if (isStreaming(n)) { b.innerHTML = icon('stop') + '停止'; b.className = 'btn btn-secondary'; b.disabled = false; return; }
    b.innerHTML = icon('send') + '发送'; b.className = 'btn btn-primary';
    b.disabled = !elInput.textContent.trim() && !elInput.querySelector('.ref');
  }

  /* ─── 发送与生成 ───────────────────────────────────── */
  function makeReply(n, text) {
    if (isImageNode(n)) {
      if (/三个方向/.test(text)) return { intro: '三个方向的区别在姿势和光线。没写质量词，程序会按 ' + seriesOf(n.sys) + ' 系列自动加。', boxes: [
        { label: '方向一：窗台侧坐，光束', text: T_DIR1, jobs: [] }, { label: '方向二：课桌托腮，侧光', text: T_DIR2, jobs: [] }, { label: '方向三：抱书回头，逆光', text: T_DIR3, jobs: [] }] };
      return { intro: '按你说的改了，其他标签没动。', boxes: [{ label: null, text: T_DIR1.replace('closed mouth', '(smile:1.2)').replace(', warm sunset glow', ''), jobs: [] }] };
    }
    if (/三个方向/.test(text)) return { intro: '按你的要求给了三个方向，区别在镜头运动和有没有台词。', boxes: [
      { label: '方向一：跟拍背影，结尾甩头', text: P_DIR1 }, { label: '方向二：慢推近景，无台词', text: P_DIR2 }, { label: '方向三：手持跟拍，一句台词', text: P_DIR3 }] };
    if (n.sys === 't2v' || !n.slots.length) return { intro: '没有参考图，人物和场景都按文字定义。', boxes: [{ label: null, text: P_T2V }] };
    return { intro: '按你说的改了，改动都在 detailed_description 里，其他部分保持不变。', boxes: [{ label: null, text: n.slots.length >= 4 ? P_SLOW_V3 : P_DIR2 }] };
  }
  function aiVersion(n, text) {
    var r = makeReply(n, text), hist = fullThread(n).length;
    var tin = 3200 + n.slots.length * 1480 + hist * 420;
    var th = ImgUI.thinkLevel(n);
    return { model: n.model, sys: n.sys, sysAt: '9月16日 ' + now(), at: now(), tin: tin, tout: 0, tcache: Math.round(tin * 0.78), intro: r.intro, boxes: r.boxes, _fail: /报错/.test(text),
             _thinkMs: th.on ? ({ '低': 4000, '中': 7000, '高': 11000 })[th.lv] : 0, _thinkText: th.on && th.model.think !== 'reasoning_effort' ? THINK_N9 : null };
  }
  function send(o) {
    var n = node(); if (!n || isStreaming(n)) return;
    var s = serialize(elInput);
    if (s.broken.length) {
      s.broken.forEach(function (c) { c.classList.remove('is-flash'); void c.offsetWidth; c.classList.add('is-flash'); });
      showError('第 ' + ($$('.ref', elInput).indexOf(s.broken[0]) + 1) + ' 处图片引用（' + esc(IMAGES[s.broken[0].dataset.img].name) + '）已经不在槽位里了，这条消息发不出去。把图放回槽位，或者删掉这处引用。');
      return;
    }
    if (!s.text) { elInput.focus(); return; }
    var note = autoNote(n);
    var uv = { auto: note || null, text: s.text, imgs: n.slots.slice(), at: '9月16日 ' + now() };
    if (isImageNode(n)) { uv.size = n.size; uv.count = n.count; } else { uv.duration = n.duration; uv.ratio = n.ratio; }
    var userPos = { role: 'user', cur: 0, versions: [uv] };
    var v = aiVersion(n, s.text);
    if (o && o.thinkHold) { v._thinkMs = 3600000; v._thinkStart = Date.now() - 12000; }   // 原型：停在「正在思考」
    var aiPos = { role: 'ai', cur: 0, versions: [v] };
    var items = walk(THREADS[n.id], []);
    var arr = items.length ? items[items.length - 1].arr : THREADS[n.id];
    arr.push(userPos, aiPos);
    elInput.innerHTML = ''; clearError();
    if (n.untitled) n._titleFrom = s.text;
    startStream(n.id, v, 6);
    renderAll('bottom');
    markSaved();
  }
  function startStream(nodeId, v, speed) {
    v.streaming = true; v.stopped = false;
    v._sid = v._sid || 's' + (++sidSeq);
    v._is = v._is || 0;
    v._bs = v._bs || v.boxes.map(function () { return 0; });
    var st = { nodeId: nodeId, v: v };
    streams[v._sid] = st;
    renderGraph();
    if (v._fail) {
      st.timer = setTimeout(function () {
        delete streams[v._sid]; v.streaming = false; delete v._fail;
        v.failed = { code: '500', reason: '上游返回 Internal Server Error', at: '9月16日 ' + now() };
        afterReply(nodeId, v, true);
      }, 1400);
      return;
    }
    if (v._thinkMs && !v.thinking) v._thinkStart = v._thinkStart || Date.now();
    st.timer = setInterval(function () {
      if (v._thinkStart) {
        if (Date.now() - v._thinkStart < v._thinkMs) { if (!st.painted) { st.painted = true; paint(nodeId, v); } return; }
        v.thinking = { ms: Date.now() - v._thinkStart, text: v._thinkText }; delete v._thinkStart; delete v._thinkText;
      }
      if (v._is < v.intro.length) v._is = Math.min(v.intro.length, v._is + speed);
      else {
        var j = -1;
        for (var i = 0; i < v._bs.length; i++) if (v._bs[i] < v.boxes[i].text.length) { j = i; break; }
        if (j < 0) { clearInterval(st.timer); delete streams[v._sid]; v.streaming = false; delete v._is; delete v._bs; afterReply(nodeId, v); return; }
        v._bs[j] = Math.min(v.boxes[j].text.length, v._bs[j] + speed * 3);
      }
      v.tout = Math.round((v._is + v._bs.reduce(function (a, b) { return a + b; }, 0)) * 1.2);
      paint(nodeId, v);
    }, 50);
  }
  function paint(nodeId, v) {
    if (P.nodeId !== nodeId) return;
    var el = elThread.querySelector('[data-sid="' + v._sid + '"]');
    if (!el) return;
    var atBottom = elThread.scrollHeight - elThread.clientHeight - elThread.scrollTop < 120;
    var list = P.items, k = -1;
    for (var i = 0; i < list.length; i++) if (list[i].p.versions[list[i].p.cur] === v) { k = i; break; }
    if (k < 0) return;
    var tmp = document.createElement('div'); tmp.innerHTML = renderAI(list[k], k, 'o');
    el.replaceWith(tmp.firstChild);
    if (atBottom) elThread.scrollTop = elThread.scrollHeight;
  }
  function stopNode(n) {
    Object.keys(streams).forEach(function (sid) {
      var st = streams[sid]; if (st.nodeId !== n.id) return;
      clearInterval(st.timer); clearTimeout(st.timer); delete streams[sid];
      var v = st.v;
      v.streaming = false; v.stopped = true;
      if (v._thinkStart) { v.thinking = { ms: Date.now() - v._thinkStart, text: null }; delete v._thinkStart; }
      v.intro = (v.intro || '').slice(0, v._is);
      v.boxes = v.boxes.map(function (b, j) {
        var shown = v._bs[j];
        if (!shown) return null;
        return shown < b.text.length ? { label: b.label, text: b.text.slice(0, shown), incomplete: true } : b;
      }).filter(Boolean);
      delete v._is; delete v._bs;
      afterReply(n.id, v);
      toast('已叫停，写出来的部分保留了');
    });
  }
  function summarize(text) {
    var m = text.match(/summary:\n(?:\[[^\]]+\] )?(?:目标视频里，)?([^\n]*)/);
    if (!m) return '';
    var names = {};
    text.replace(/<Subject (\d+)> 是 (?:<Picture \d+> 里的)?([^：，。\n]+)/g, function (x, k, nm) { names[k] = nm.replace(/^一(位|条|盏|个|把)/, ''); });
    var s = m[1].replace(/<Subject (\d+)>/g, function (x, k) { return names[k] || '主体'; }).replace(/<Picture \d+>/g, '参考图').split('。')[0];
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }
  function afterReply(nodeId, v, failed) {
    var n = nodeById(nodeId);
    if (n && !failed && v.boxes && v.boxes.length) {
      n.summary = v.boxes.length > 1 ? v.boxes.length + ' 个方向：' + v.boxes.map(function (b) { return (b.label || '').replace(/^方向.：/, ''); }).join('；') : summarize(v.boxes[0].text) || n.summary;
      if (n.untitled && !n.titleManual) {
        var src = (n._titleFrom || '').replace(/^沿第 \d+ 个方向（([^）]*)）往下改：/, '$1 ').replace(/<Picture \d+>/g, '');
        n.title = src.split(/[，。,.！？\n]/)[0].trim().slice(0, 12) || '雨夜新版本';
        n.untitled = false;
      }
    }
    renderGraph(); markSaved();
    if (n && P.nodeId === nodeId) renderAll(true);
    else if (n) toast('「' + n.title + '」' + (failed ? '请求失败了' : '回复完了'), { tone: failed ? 'danger' : undefined, action: '去看看', onAction: function () { selectNode(nodeId); } });
  }

  /* ─── 版本 ─────────────────────────────────────────── */
  function newVersion(it, v) {
    var p = it.p, old = p.versions[p.cur];
    if (!old.rest) old.rest = it.arr.splice(it.idx + 1);
    else it.arr.splice(it.idx + 1);
    p.versions.forEach(function (x) { if (!x.rest) x.rest = []; });
    v.rest = v.rest || [];
    p.versions.push(v); p.cur = p.versions.length - 1;
  }
  function switchVersion(k, dir) {
    var n = node();
    if (isStreaming(n)) { toast('正在生成，先叫停或等它写完再切版本', { tone: 'warn' }); return; }
    var p = P.items[k].p, to = p.cur + dir;
    if (to < 0 || to >= p.versions.length) return;
    var before = lastUserVersion(n), pending = hasPending(n) ? autoNote(n) : '';
    p.cur = to;
    var after = lastUserVersion(n);
    if (after === before) { renderAll(true); return; }
    p.cur -= dir;
    var apply = function () {
      p.cur = to; n.slots = after.imgs.slice(); n.duration = after.duration; n.ratio = after.ratio;
      renderAll(true); renderGraph(); markSaved();
      toast('切到第 ' + (to + 1) + ' 版，槽位变回那时候的 ' + after.imgs.length + ' 张图');
    };
    if (pending) confirmBox({ title: '有改动还没发出去', body: '当前有没发出去的改动：「' + esc(pending) + '」<br><br>切到第 ' + (to + 1) + ' 版后，槽位、时长、比例会变回那时候的样子，这些改动就没了。', ok: '仍然切换', onOk: apply });
    else apply();
  }

  /* ─── 面板上的点击 ─────────────────────────────────── */
  elThread.addEventListener('click', function (e) {
    if (ImgUI.onThreadClick(e)) return;
    var b = e.target.closest('[data-act]'); if (!b) return;
    var n = node(), src = b.dataset.src || 'o', k = +b.dataset.k, j = b.dataset.j != null ? +b.dataset.j : null;
    var list = src === 'c' ? P.copied : P.items, it = list[k];
    var v = it ? it.p.versions[it.p.cur] : null, box = v && j != null ? v.boxes[j] : null;
    var globalCount = (src === 'c' ? k : P.copied.length + k) + 1;
    switch (b.dataset.act) {
      case 'vprev': switchVersion(k, -1); break;
      case 'vnext': switchVersion(k, 1); break;
      case 'copy':
        if (isImageNode(n)) { copyText(Tags.join(Tags.parse(box.text)), '已复制 ' + Tags.parse(box.text).length + ' 个标签（一行英文，不含固定开头）'); break; }
        copyText(box.text, '已复制提示词（' + fmtNum(box.text.length) + ' 字）'); break;
      case 'translate': Translate.open(n, box, imgsFor(src, k)); break;
      case 'star':
        box.starred = !box.starred; renderAll(true); renderGraph(); markSaved();
        toast(box.starred ? '打了星。画布上这个节点会显示星标' : '取消了星标'); break;
      case 'expand': box._open = true; renderThread(true); break;
      case 'upload': Upload.open(n, box, imgsFor(src, k), v); break;
      case 'sys': SysView.open(v); break;
      case 'fork': forkNode(n, globalCount, null); break;
      case 'continue': {
        var label = box.label ? box.label.replace(/^方向.：/, '') : null;
        forkNode(n, globalCount, label ? '沿第 ' + (j + 1) + ' 个方向（' + label + '）往下改：' : '沿这版提示词往下改：');
        break;
      }
      case 'regen': {
        if (isStreaming(n)) return;
        var prevUser = P.items[k - 1] ? P.items[k - 1].p.versions[P.items[k - 1].p.cur] : lastUserVersion(n);
        var nv = aiVersion(n, prevUser ? prevUser.text : ''); nv.regen = true; nv._fail = false;
        newVersion(it, nv); startStream(n.id, nv, 6); renderAll('bottom'); break;
      }
      case 'retry': {
        var rv = aiVersion(n, ''); delete v.failed;
        Object.assign(v, rv, { _fail: false }); startStream(n.id, v, 6); renderAll('bottom'); break;
      }
      case 'edit':
        if (isStreaming(n)) { toast('正在生成，先叫停或等它写完', { tone: 'warn' }); return; }
        it.p._editing = true; renderThread(true);
        var ta = $('#editArea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); break;
      case 'editCancel': delete it.p._editing; renderThread(true); break;
      case 'editSend': {
        var text = $('#editArea').value.trim(); if (!text) return;
        delete it.p._editing;
        var old = v;
        newVersion(it, { auto: old.auto, text: text, imgs: old.imgs.slice(), duration: old.duration, ratio: old.ratio, at: '9月16日 ' + now() });
        var av = aiVersion(n, text);
        it.p.versions[it.p.cur].rest.push({ role: 'ai', cur: 0, versions: [av] });
        startStream(n.id, av, 6); renderAll('bottom'); markSaved();
        toast('改好了，这句现在有 ' + it.p.versions.length + ' 个版本，可以来回切'); break;
      }
      case 'editBox':
        if (isStreaming(n)) { toast('正在生成，先叫停或等它写完', { tone: 'warn' }); return; }
        box._editing = true; renderThread(true);
        var ed = $('#boxEditor'); updateRefChips(ed); ed.focus(); break;
      case 'boxRef': openRefPicker(b, $('#boxEditor')); break;
      case 'boxCancel': delete box._editing; renderThread(true); break;
      case 'boxSave': {
        var sr = serialize($('#boxEditor'));
        if (sr.broken.length) {
          var er = $('#boxEditorError'); er.hidden = false;
          er.innerHTML = icon('warn') + '<span>引用的 ' + esc(IMAGES[sr.broken[0].dataset.img].name) + ' 已经不在槽位里了，存不了。把图放回槽位，或者删掉这处引用。</span>';
          return;
        }
        delete box._editing;
        var boxes = v.boxes.map(function (x, i) { return { label: x.label, text: i === j ? sr.text : x.text }; });
        newVersion(it, { manual: true, at: now(), model: v.model, sys: v.sys, boxes: boxes });
        renderAll(true); markSaved();
        toast('存成了第 ' + it.p.versions.length + ' 版，标着「手动修改」'); break;
      }
      default: ImgUI.act(b.dataset.act, { n: n, box: box, v: v, it: it, k: k, j: j, src: src, el: b });
    }
  });
  elThread.addEventListener('keydown', function (e) {
    if (e.target.id === 'boxEditor' && e.key === '@') { e.preventDefault(); openRefPicker(e.target, e.target); }
    if (e.target.id === 'editArea' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) elThread.querySelector('[data-act="editSend"]').click();
  });
  $('#drSub').addEventListener('click', function (e) {
    var a = e.target.closest('[data-goto]'); if (!a) return;
    e.preventDefault(); selectNode(a.dataset.goto);
  });
  $('#drTitle').onclick = function () { renameNode(node(), true); };
  $('#drClose').onclick = closeDrawer;
  $('#drBack').onclick = closeDrawer;
  $('#drMenu').onclick = function () {
    var n = node(), kids = childrenOf(n.id).length;
    var items = [{ label: '重命名', icon: 'edit', onClick: function () { renameNode(n, true); } }];
    if (fullThread(n).length) items.push({ label: '从最后一条消息岔出', icon: 'branch', onClick: function () { forkNode(n, fullThread(n).length, null); } });
    if (kids) items.push({ label: n.collapsed ? '展开子节点' : '折叠子节点', icon: n.collapsed ? 'expand' : 'collapse', onClick: function () { toggleCollapse(n); } });
    items.push({ sep: true }, { label: '删除节点', icon: 'trash', danger: true, onClick: function () { deleteNode(n); } });
    showMenu($('#drMenu'), items);
  };
  $('#cfgModel').onchange = function (e) { var n = node(); n.model = e.target.value; markSaved(); toast('从下一条消息起用「' + modelOf(n.model).name + '」'); };
  $('#cfgSys').onchange = function (e) {
    var n = node(), was = seriesOf(n.sys); n.sys = e.target.value;
    var now = seriesOf(n.sys);
    if (now && !n.image) {
      var S = SERIES[now], ck = CHECKPOINTS.filter(function (c) { return c.series === now; })[0];
      n.size = n.size || '832×1216'; n.count = n.count || 4;
      n.image = { src: COMFY.use, workflow: 'builtin', ckpt: ck.name, loras: [], seedMode: 'random', seed: 0, steps: S.steps, cfg: S.cfg, sampler: S.sampler, scheduler: S.scheduler, rating: '全年龄', extraNeg: '' };
    } else if (now && was !== now && n.image) {
      var ck2 = CHECKPOINTS.filter(function (c) { return c.series === now; })[0]; n.image.ckpt = ck2.name; n.image.steps = SERIES[now].steps; n.image.cfg = SERIES[now].cfg;
    }
    markSaved(); renderAll(true); renderGraph();
    if (!!was !== !!now) toast(now ? '换成了生图用的提示词，这个节点变成生图节点：面板上的时长和比例换成了尺寸和张数。已有的对话不动' : '换回了视频提示词，面板上换回时长和比例。已有的对话不动', { ms: 5000 });
    else toast('从下一条消息起用系统提示词「' + esc(n.sys) + '」' + (now && was !== now ? '，底模换成了 ' + now + ' 系列的' : ''));
  };
  $('#cfgThink').onclick = function () { location.href = 'settings.html#thinking'; };

  function renderAll(scroll) { renderHead(); renderThread(scroll); refreshDock(); }

  return {
    open: function (id) {
      if (P.nodeId !== id) { elInput.innerHTML = ''; clearError(); closeRefPicker(); }
      P.nodeId = id; renderAll('bottom');
      var last = elThread.lastElementChild;
      if (last && last.classList.contains('msg-ai') && !isStreaming(node())) elThread.scrollTop = Math.max(0, last.offsetTop - 12);
    },
    renderHead: renderHead,
    refreshDock: refreshDock,
    rerender: function () { if (node()) renderAll(true); },
    sendText: function (t, o) { elInput.textContent = t; send(o); },
    /* 标签编辑窗、换掉不认识的标签：存成这条回复的新版本，不问 AI */
    saveManual: function (k, j, text, msg) {
      var it = P.items[k], v = it.p.versions[it.p.cur];
      var boxes = v.boxes.map(function (x, i) { return { label: x.label, text: i === j ? text : x.text, starred: i === j ? false : x.starred, jobs: i === j ? [] : x.jobs }; });
      newVersion(it, { manual: true, at: now(), model: v.model, sys: v.sys, boxes: boxes });
      renderAll(true); renderGraph(); markSaved();
      toast(msg + '（第 ' + it.p.versions.length + ' 版。原来那版和它出的图都还在，切回去能看到）', { ms: 4500 });
    },
    promptHTML: promptHTML,
    prefill: function (text) {
      elInput.textContent = text; updateSendBtn();
      elInput.focus();
      var r = document.createRange(); r.selectNodeContents(elInput); r.collapse(false);
      var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    },
    node: node,
    addImages: addImages,
    replaceSlot: replaceSlot,
    insertChip: insertChip,
    startBackground: function () {
      G.nodes.forEach(function (n) {
        THREADS[n.id].forEach(function (p) { var v = p.versions[p.cur]; if (v.streaming) { v.streaming = false; startStream(n.id, v, 1.2); } });
      });
    }
  };
})();
