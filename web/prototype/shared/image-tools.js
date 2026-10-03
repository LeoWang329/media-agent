/* 画布 · 生图节点的两个窗口：出图设置、标签编辑窗 */

/* ─── 出图设置：每个节点各存一份。常动的放上面，很少动的收起来 ─── */
var GenCfg = (function () {
  var d, n;
  function sel(id, list, v, fmt) { return '<select class="select" id="' + id + '">' + list.map(function (x) { var val = typeof x === 'string' ? x : x.v; return '<option value="' + esc(val) + '"' + (val === v ? ' selected' : '') + '>' + esc(fmt ? fmt(x) : val) + '</option>'; }).join('') + '</select>'; }
  function render() {
    var im = n.image, sr = seriesOf(n.sys), wf = im.workflow !== 'builtin';
    var cks = CHECKPOINTS.filter(function (c) { return c.series === sr; });
    var other = CHECKPOINTS.length - cks.length;
    var src = COMFY.use;
    d.innerHTML =
      '<div class="dialog-head"><div class="stack" style="gap:2px"><h2>出图设置</h2><span class="meta">「' + esc(n.title) + '」自己的一份。新节点按 ' + sr + ' 系列的默认值填</span></div>' +
        '<button class="btn btn-ghost btn-icon" data-gc="close" aria-label="关闭">' + icon('x') + '</button></div>' +
      '<div class="dialog-body gc-body">' +
        '<div class="gc-sec"><h4>用哪台 ComfyUI<span class="meta">所有节点共用，只记在这台电脑上</span></h4>' +
          '<div class="seg gc-src"><button aria-pressed="' + (src === 'lan') + '" data-gc="lan">局域网那台</button><button aria-pressed="' + (src === 'autodl') + '" data-gc="autodl">AutoDL 实例</button></div>' +
          '<span class="gc-src-state">' + srcState() + '</span></div>' +
        '<div class="gc-sec"><h4>工作流</h4>' + sel('gcWf', WORKFLOWS.map(function (w) { return { v: w.id, t: w.name + (w.builtin ? '' : '（导入的）') }; }), im.workflow, function (x) { return x.t; }) +
          (wf ? '<p class="hint">' + icon('info', 'icon-sm') + '导入的工作流里，底模、LoRA、步数这些按它自己的来，这里不用填。程序只往里填提示词、种子、尺寸。' +
            (WORKFLOWS.filter(function (w) { return w.id === im.workflow; })[0].needs.length ? '<br><b class="gc-warn">这台 ComfyUI 上缺插件：' + WORKFLOWS.filter(function (w) { return w.id === im.workflow; })[0].needs.join('、') + '，出图前会拦下来。</b>' : '') + '</p>' : '') + '</div>' +
        (wf ? '' :
        '<div class="gc-sec"><h4>底模<span class="meta">只列标成 ' + sr + ' 的' + (other ? '，另有 ' + other + ' 个是别的系列' : '') + '</span></h4>' + sel('gcCkpt', cks.map(function (c) { return c.name; }), im.ckpt) + '</div>' +
        '<div class="gc-sec"><h4>LoRA<span class="meta">可以挂几个，各带强度</span></h4><div class="gc-loras">' +
          im.loras.map(function (l, i) { return '<div class="gc-lora">' + sel('gcL' + i, LORAS, l[0]) + '<input class="input mono" type="number" step="0.05" min="-2" max="2" value="' + l[1] + '" data-lw="' + i + '" aria-label="强度"><button class="btn btn-ghost btn-icon btn-sm" data-gc="rmLora" data-i="' + i + '" aria-label="去掉">' + icon('x') + '</button></div>'; }).join('') +
          '<button class="btn btn-ghost btn-sm" data-gc="addLora">' + icon('plus') + '挂一个 LoRA</button></div></div>') +
        '<div class="gc-sec"><h4>种子</h4><div class="row"><div class="seg"><button aria-pressed="' + (im.seedMode === 'random') + '" data-gc="seedRandom">每次随机</button><button aria-pressed="' + (im.seedMode === 'fixed') + '" data-gc="seedFixed">固定一个数</button></div>' +
          (im.seedMode === 'fixed' ? '<input class="input mono" id="gcSeed" style="width:150px" value="' + im.seed + '">' : '') + '</div>' +
          '<p class="hint">出几张就用几个种子，从这个数往上依次加 1。随机时第一个随机取。</p></div>' +
        '<details class="gc-more"' + (wf ? '' : '') + '><summary>' + icon('chev-down', 'icon-sm chev') + '很少动的<span class="meta mono">' + (wf ? '评级 ' + im.rating : im.steps + ' 步 · CFG ' + im.cfg + ' · ' + im.sampler + ' · ' + im.scheduler + ' · ' + im.rating) + '</span></summary><div class="gc-grid">' +
          (wf ? '' :
          '<div class="field"><label for="gcSteps">步数</label><input class="input mono" id="gcSteps" type="number" min="1" max="150" value="' + im.steps + '"></div>' +
          '<div class="field"><label for="gcCfg">CFG<span class="muted">（提示词管得多严）</span></label><input class="input mono" id="gcCfg" type="number" min="1" max="30" step="0.5" value="' + im.cfg + '"></div>' +
          '<div class="field"><label for="gcSampler">采样器</label>' + sel('gcSampler', SAMPLERS, im.sampler) + '</div>' +
          '<div class="field"><label for="gcSched">调度器</label>' + sel('gcSched', SCHEDULERS, im.scheduler) + '</div>') +
          '<div class="field gc-wide"><span class="label">评级</span><div class="seg" id="gcRating">' + ['不加', '全年龄', '擦边', '成人'].map(function (r) { return '<button aria-pressed="' + (im.rating === r) + '" data-rate="' + r + '">' + r + '</button>'; }).join('') + '</div>' +
            '<p class="hint">选了会在固定开头后面加一个评级词：' + sr + ' 系列写成 <span class="mono">' + (im.rating === '不加' ? '（不加）' : SERIES[sr].rating[im.rating]) + '</span>。</p></div>' +
          '<div class="field gc-wide"><label for="gcNeg">额外的负面词<span class="muted">（接在系列默认负面词后面）</span></label><input class="input mono" id="gcNeg" value="' + esc(im.extraNeg) + '" placeholder="比如：glasses, hat"></div>' +
        '</div></details>' +
      '</div>' +
      '<div class="dialog-foot"><span class="meta grow">改了自动存，下次点「生图」就用新的</span><button class="btn btn-primary" data-gc="close">好了</button></div>';
  }
  function srcState() {
    var a = COMFY.autodl;
    if (COMFY.use === 'lan') return COMFY.lan.state === 'down' ? '<span class="tag tag-danger">连不上</span>' : '<span class="tag tag-ok">' + icon('check') + '连得上</span><span class="meta mono">' + esc(COMFY.lan.url) + '</span>';
    return a.state === 'running' ? '<span class="tag tag-warn">' + icon('power') + '运行中 · 在扣钱</span>' : a.state === 'booting' ? '<span class="tag tag-accent">正在开机</span>' : '<span class="tag">已关机</span><span class="meta">点生图时自动开机</span>';
  }
  function open(node) {
    n = node;
    if (!d) {
      d = document.createElement('dialog'); d.className = 'dialog gc-dialog'; d.id = 'dlgGenCfg'; d.setAttribute('aria-label', '出图设置'); d.setAttribute('data-od-id', 'dialog-generation-settings');
      document.body.appendChild(d);
      d.addEventListener('click', function (e) {
        var b = e.target.closest('[data-gc],[data-rate]'); if (!b) return;
        var im = n.image, a = b.dataset.gc;
        if (b.dataset.rate) { im.rating = b.dataset.rate; return changed(); }
        if (a === 'close') { d.close(); return; }
        if (a === 'lan' || a === 'autodl') { COMFY.use = a; Comfy.render(); return changed(); }
        if (a === 'addLora') { im.loras.push([LORAS.filter(function (l) { return !im.loras.some(function (x) { return x[0] === l; }); })[0] || LORAS[0], 0.8]); return changed(); }
        if (a === 'rmLora') { im.loras.splice(+b.dataset.i, 1); return changed(); }
        if (a === 'seedRandom') { im.seedMode = 'random'; return changed(); }
        if (a === 'seedFixed') { im.seedMode = 'fixed'; return changed(); }
      });
      d.addEventListener('change', function (e) {
        var im = n.image, t = e.target;
        if (t.id === 'gcWf') im.workflow = t.value;
        else if (t.id === 'gcCkpt') im.ckpt = t.value;
        else if (/^gcL\d/.test(t.id)) im.loras[+t.id.slice(3)][0] = t.value;
        else if (t.dataset.lw != null) im.loras[+t.dataset.lw][1] = +t.value;
        else if (t.id === 'gcSeed') im.seed = +t.value || im.seed;
        else if (t.id === 'gcSteps') im.steps = +t.value;
        else if (t.id === 'gcCfg') im.cfg = +t.value;
        else if (t.id === 'gcSampler') im.sampler = t.value;
        else if (t.id === 'gcSched') im.scheduler = t.value;
        else if (t.id === 'gcNeg') im.extraNeg = t.value.trim();
        changed(t.id === 'gcWf');
      });
    }
    render(); hydrateIcons(d);
    if (!d.open) d.showModal();
  }
  function changed(full) {
    var open = d.querySelector('.gc-more') && d.querySelector('.gc-more').open;
    render(); if (open) d.querySelector('.gc-more').open = true;
    markSaved(); ImgUI.renderDock(n);
  }
  return { open: open };
})();

/* ─── 标签编辑窗：标签是一行文字里的小块，打字联想 ─────────── */
var TagEditor = (function () {
  var d, ed, sugEl, ctx = null, sugs = [], sugI = 0, state = {}, dragEl = null;
  var TO_TAGS = { '坐在窗边看书': ['sitting', 'windowsill', 'reading', 'open_book'], '风吹起头发': ['wind', 'floating_hair'], '回头看': ['looking_back'] };
  var FROM_IMAGE = ['1girl', 'solo', 'long_hair', 'brown_hair', 'book', 'window', 'blush', 'looking_at_viewer', 'hair_between_eyes', 'bowtie', 'indoors', 'sunset'];

  function build() {
    d = document.createElement('dialog'); d.className = 'dialog dialog-wide te-dialog'; d.id = 'dlgTags'; d.setAttribute('aria-label', '编辑标签'); d.setAttribute('data-od-id', 'dialog-tag-editor');
    d.innerHTML =
      '<div class="dialog-head te-head"><div class="stack grow" style="gap:2px;min-width:0"><h2>编辑标签</h2><span class="meta" id="teSub"></span></div>' +
        '<button class="btn btn-ghost btn-icon" data-te="close" aria-label="关闭">' + icon('x') + '</button></div>' +
      '<div class="te-banner" id="teBanner" hidden></div>' +
      '<div class="te-tools" data-od-id="tag-editor-tools">' +
        '<button class="btn btn-secondary btn-sm" data-te="frag">' + icon('plus') + '插片段</button>' +
        '<button class="btn btn-secondary btn-sm" data-te="pickMode">' + icon('check') + '挑几个存成片段</button>' +
        '<button class="btn btn-secondary btn-sm" data-te="interrogate">' + icon('scan') + '从图反推</button>' +
        '<span class="grow"></span><span class="meta te-count" id="teCount"></span></div>' +
      '<div class="te-main">' +
        '<div class="te-input" id="teInput" contenteditable="true" spellcheck="false" data-placeholder="打中文或英文找标签，比如「金发」「twin」。打逗号把前面打的字变成一个小块"></div>' +
        '<div class="te-sug" id="teSug" role="listbox" aria-label="候选标签"></div>' +
      '</div>' +
      '<section class="te-lib" id="teLib" data-od-id="tag-editor-common-tags"></section>' +
      '<div class="te-preview"><span class="label">复制和出图用的是这一串</span><p class="mono" id="tePreview"></p></div>' +
      '<div class="dialog-foot"><span class="meta grow">点小块调权重或删掉，按住拖动换顺序。存成这条回复的新版本，不问 AI</span>' +
        '<button class="btn btn-secondary" data-te="close">放弃</button><button class="btn btn-primary" data-te="save">' + icon('check') + '存成新版本</button></div>';
    document.body.appendChild(d);
    ed = d.querySelector('#teInput'); sugEl = d.querySelector('#teSug');
    d.addEventListener('click', onClick);
    ed.addEventListener('input', onInput);
    ed.addEventListener('keydown', onKey);
    ed.addEventListener('paste', function (e) { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
    ed.addEventListener('dragstart', function (e) { var c = e.target.closest('.te-chip'); if (!c) return; dragEl = c; c.classList.add('is-drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'chip'); });
    ed.addEventListener('dragover', function (e) {
      if (!dragEl) return; e.preventDefault();
      var c = e.target.closest('.te-chip'); $$('.te-chip.is-drop-l, .te-chip.is-drop-r', ed).forEach(function (x) { x.classList.remove('is-drop-l', 'is-drop-r'); });
      if (c && c !== dragEl) { var r = c.getBoundingClientRect(); c.classList.add(e.clientX < r.left + r.width / 2 ? 'is-drop-l' : 'is-drop-r'); }
    });
    ed.addEventListener('drop', function (e) {
      if (!dragEl) return; e.preventDefault();
      var c = e.target.closest('.te-chip');
      if (c && c !== dragEl) { var r = c.getBoundingClientRect(); if (e.clientX < r.left + r.width / 2) c.before(dragEl); else c.after(dragEl); }
      endDrag(); update();
    });
    ed.addEventListener('dragend', endDrag);
    d.addEventListener('close', function () { closeMini(); clearInterval(state.timer); });
  }
  function endDrag() { if (dragEl) dragEl.classList.remove('is-drag'); dragEl = null; $$('.te-chip', ed).forEach(function (x) { x.classList.remove('is-drop-l', 'is-drop-r'); }); }
  function chipEl(t) {
    var tmp = document.createElement('span');
    tmp.innerHTML = Tags.chip(t, null, { cls: 'te-chip', attrs: ' contenteditable="false" draggable="true" data-raw="' + esc(Tags.one(t)) + '"', unknownText: '不认识，照原样用' });
    return tmp.firstChild;
  }
  function open(n, b, k, j) {
    if (!d) build();
    ctx = { n: n, b: b, k: k, j: j }; state = { picking: false };
    ed.innerHTML = '';
    Tags.parse(b.text).forEach(function (t) { ed.appendChild(chipEl(t)); ed.appendChild(document.createTextNode(' ')); });
    $('#teSub', d).textContent = n.title + ' · ' + (b.label || '提示词') + ' · ' + seriesOf(n.sys) + ' 系列';
    d.classList.remove('is-picking');
    banner(); sugs = []; renderSug(); update(); hydrateIcons(d);
    if (!d.open) d.showModal();
    ed.focus(); caretEnd();
  }
  function caretEnd() { var r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  function chips() { return $$('.te-chip', ed); }
  function current() {
    return chips().map(function (c) { return Tags.parseOne(c.dataset.raw); });
  }
  function update() {
    var list = current(), st = Tags.stats(list);
    if (d.querySelector('#teLib')) drawLib();
    $('#tePreview', d).textContent = Tags.join(list) || '（还没有标签）';
    $('#teCount', d).innerHTML = '<span class="mono">' + st.n + '</span> 个标签' + (st.unknown ? ' · <span class="te-unk">' + st.unknown + ' 个不认识</span>' : '') + (state.picking ? ' · 选了 <span class="mono">' + $$('.te-chip.is-picked', ed).length + '</span> 个' : '');
    var pb = d.querySelector('[data-te="pickMode"]');
    var picked = $$('.te-chip.is-picked', ed).length;
    pb.innerHTML = icon('check') + (state.picking ? (picked ? '把选中的 ' + picked + ' 个存成片段' : '点小块挑几个…') : '挑几个存成片段');
    pb.classList.toggle('btn-primary', state.picking && picked > 0); pb.classList.toggle('btn-secondary', !(state.picking && picked > 0));
  }
  function banner() {
    var el = $('#teBanner', d), h = '';
    if (TAGLIB.state === 'updating') h = '<span class="spinner"></span><span><b>词库正在更新</b>，第 2 步 / 共 3 步：下别名。联想先用旧的（' + TAGLIB.at + '），下完自动换。<a class="linkish" href="settings.html#taglib">看进度</a></span>';
    if (state.busy) h = '<span class="spinner"></span><span><b>' + state.busy + '</b>，等了 <span class="mono" data-since="' + state.since + '">' + Math.round((Date.now() - state.since) / 1000) + ' 秒</span>。' + state.busyNote + '</span>' + (state.hold ? '' : '');
    el.innerHTML = h; el.hidden = !h;
  }
  /* 光标前面正在打的那段字 */
  function fragment() {
    var s = getSelection(); if (!s.rangeCount) return null;
    var node = s.anchorNode, off = s.anchorOffset;
    if (!node || node.nodeType !== 3 || !ed.contains(node)) return null;
    var before = node.nodeValue.slice(0, off), i = Math.max(before.lastIndexOf(','), before.lastIndexOf('，'));
    var frag = before.slice(i + 1).replace(/^\s+/, '');
    return { node: node, start: off - frag.length, end: off, text: frag };
  }
  function onInput() {
    var f = fragment();
    if (f && /[,，]/.test(f.node.nodeValue.slice(f.start - 1, f.start)) && f.text === '') {
      // 刚打了逗号：把逗号前那段变成小块
      var v = f.node.nodeValue, cut = f.start - 1, j = Math.max(v.lastIndexOf(',', cut - 1), v.lastIndexOf('，', cut - 1));
      var raw = v.slice(j + 1, cut).trim();
      if (raw) { replaceRange(f.node, j + 1, f.start, [Tags.parseOne(raw)]); }
      else f.node.nodeValue = v.slice(0, cut) + v.slice(f.start);
      sugs = []; renderSug(); update(); return;
    }
    if (!f || !f.text.trim()) { sugs = []; renderSug(); return; }
    sugs = Tags.search(f.text.trim(), 20); sugI = 0; state.frag = f.text.trim(); renderSug();
  }
  function renderSug() {
    var q = state.frag || '';
    if (!sugs.length && q && /[一-龥]/.test(q) && fragment()) {
      var th = THINK.uses.toTags === '跟总开关' ? THINK.level : THINK.uses.toTags;
      sugEl.innerHTML = '<div class="te-none"><span>词库里没有「' + esc(q) + '」。整句话可以让 AI 转成几个标签。</span>' +
        '<button class="btn btn-secondary btn-sm" data-te="toTags">' + icon('sparkles') + '让 AI 转成标签</button><span class="meta">用节点的「' + esc(modelName(ctx.n)) + '」问一次，思考：' + th + '，要几秒</span></div>';
      return;
    }
    if (!sugs.length) { sugEl.innerHTML = q && fragment() ? '<div class="te-none"><span>词库里没有「' + esc(q) + '」。按回车或逗号照原样加进去，会标「不认识」。</span></div>' : '<div class="te-hint">打字时这里出候选，最多 20 个。<span class="kbd">↑</span> <span class="kbd">↓</span> 选，<span class="kbd">Enter</span> 加。</div>'; return; }
    sugEl.innerHTML = sugs.map(function (x, i) {
      var r = x.r;
      return '<button class="te-s' + (i === sugI ? ' is-on' : '') + '" data-si="' + i + '" role="option" aria-selected="' + (i === sugI) + '">' +
        '<span class="te-s-en">' + esc(Tags.display(r.tag)) + '</span><span class="te-s-zh">' + esc(r.zh || '') + '</span>' +
        (x.via ? '<span class="te-s-via">靠别名 ' + esc(x.via) + ' 对上</span>' : '') +
        '<span class="tag">' + TAG_CAT[r.cat] + '</span><span class="mono te-s-n">' + Tags.fmtCount(r.count) + '</span></button>';
    }).join('');
  }
  function modelName(n) { var m = MODEL_CONFIGS.filter(function (x) { return x.id === n.model; })[0]; return m ? m.name : n.model; }
  function replaceRange(node, a, b, tags) {
    var v = node.nodeValue, after = document.createTextNode(' ' + v.slice(b).replace(/^\s+/, ''));
    node.nodeValue = v.slice(0, a);
    var ref = node.nextSibling, last = null;
    tags.forEach(function (t) { var c = chipEl(t); ed.insertBefore(c, ref); ed.insertBefore(document.createTextNode(' '), ref); last = c; });
    ed.insertBefore(after, ref);
    var r = document.createRange(); r.setStart(after, Math.min(1, after.length)); r.collapse(true); var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    update();
  }
  function pickSug(i) {
    var f = fragment(), x = sugs[i]; if (!f || !x) return;
    replaceRange(f.node, f.start, f.end, [Tags.check({ raw: x.r.tag, name: Tags.display(x.r.tag), w: 1 })]);
    sugs = []; state.frag = ''; renderSug();
  }
  function onKey(e) {
    if (e.key === 'ArrowDown' && sugs.length) { e.preventDefault(); sugI = (sugI + 1) % sugs.length; renderSug(); }
    else if (e.key === 'ArrowUp' && sugs.length) { e.preventDefault(); sugI = (sugI - 1 + sugs.length) % sugs.length; renderSug(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (sugs.length) pickSug(sugI);
      else { var f = fragment(); if (f && f.text.trim()) { replaceRange(f.node, f.start, f.end, [Tags.parseOne(f.text.trim())]); state.frag = ''; renderSug(); } }
    } else if (e.key === 'Escape' && sugs.length) { e.preventDefault(); e.stopPropagation(); sugs = []; renderSug(); }
  }
  /* 点小块：调权重、删掉；挑片段模式下是选中 */
  var mini = null;
  function closeMini() { if (mini) { mini.remove(); mini = null; } }
  function openMini(c) {
    closeMini();
    var t = Tags.parseOne(c.dataset.raw);
    mini = document.createElement('div'); mini.className = 'img-pop te-mini'; mini.setAttribute('data-od-id', 'popover-tag-weight');
    function draw() {
      mini.innerHTML = '<div class="te-mini-head"><b>' + esc(Tags.nameOf(t)) + '</b><span class="meta">' + esc(t.info ? (t.info.zh || '') + ' · ' + TAG_CAT[t.info.cat] + (t.info.count ? ' · 用过 ' + Tags.fmtCount(t.info.count) + ' 次' : '') : '词库里没有') + '</span></div>' +
        '<div class="row"><span class="label">权重</span><div class="stepper"><button data-w="-1" aria-label="减 0.1"' + (t.w <= 0.1 ? ' disabled' : '') + '>−</button><output>' + t.w.toFixed(1) + '</output><button data-w="1" aria-label="加 0.1"' + (t.w >= 2 ? ' disabled' : '') + '>+</button></div>' +
        (t.w !== 1 ? '<button class="btn btn-ghost btn-sm" data-w="0">回到 1.0</button>' : '') + '<span class="grow"></span><button class="btn btn-danger-ghost btn-sm" data-del>' + icon('trash') + '删掉</button></div>' +
        '<p class="hint">0.1 到 2.0，每次 0.1。1.0 是正常，大于 1 加强，小于 1 减弱。</p>';
    }
    draw(); mini.style.position = 'fixed'; d.appendChild(mini);  // 放进弹窗里，不然会被弹窗的遮罩盖住
    var r = c.getBoundingClientRect();
    mini.style.left = Math.max(8, Math.min(r.left, innerWidth - mini.offsetWidth - 8)) + 'px';
    mini.style.top = (r.bottom + 6) + 'px';
    mini.addEventListener('click', function (e) {
      var w = e.target.closest('[data-w]');
      if (w) {
        var dv = +w.dataset.w; t.w = dv === 0 ? 1 : Math.round(Math.min(2, Math.max(0.1, t.w + dv * 0.1)) * 10) / 10;
        var nc = chipEl(t); c.replaceWith(nc); c = nc; draw(); update(); return;
      }
      if (e.target.closest('[data-del]')) { var nx = c.nextSibling; if (nx && nx.nodeType === 3 && !nx.nodeValue.trim()) nx.remove(); c.remove(); closeMini(); update(); }
    });
  }
  document.addEventListener('pointerdown', function (e) { if (mini && !mini.contains(e.target) && !e.target.closest('.te-chip')) closeMini(); });

  /* 常用标签：按 Danbooru 官方标签分组，两层：大类、小类。点一下加进去，再点一下拿掉 */
  var lib = { g: 0, s: 0, adding: false };
  function inInput() { var o = {}; current().forEach(function (t) { o[t.k || Tags.key(t.name)] = 1; }); return o; }
  function drawLib() {
    var el = d.querySelector('#teLib'), G = TAG_GROUPS[lib.g], S = G.subs[lib.s] || G.subs[0], has = inInput();
    var n = S.tags.filter(function (r) { return has[r[0]]; }).length;
    el.innerHTML =
      '<div class="te-lib-top"><span class="label">常用标签</span><div class="seg te-lib-g" role="tablist">' + TAG_GROUPS.map(function (g, i) {
        return '<button role="tab" aria-pressed="' + (i === lib.g) + '" data-lg="' + i + '">' + g.name + '</button>'; }).join('') + '</div>' +
        '<span class="grow"></span><span class="meta">按 Danbooru 官方标签分组 · ' + esc(S.src.replace('tag_group:', '')) + '</span></div>' +
      '<div class="te-lib-subs">' + G.subs.map(function (s, i) {
        return '<button class="te-lib-s' + (i === lib.s ? ' is-on' : '') + '" data-ls="' + i + '">' + esc(s.name) + '</button>'; }).join('') +
        '<button class="te-lib-s is-add" data-lnew title="在「' + G.name + '」下面加一个自己的小类">' + icon('plus', 'icon-sm') + '新小类</button></div>' +
      '<div class="te-lib-tags">' + S.tags.map(function (r) {
        return '<button class="te-lt' + (has[r[0]] ? ' is-in' : '') + (r[3] ? ' is-own' : '') + '" data-lt="' + esc(r[0]) + '" title="' + esc(Tags.display(r[0]) + (r[2] ? ' · ' + r[2] : '') + (r[1] ? ' · 用过 ' + Tags.fmtCount(r[1]) + ' 次' : '') + (r[3] ? ' · 自己加的' : '') + (has[r[0]] ? ' · 已经在上面了，再点一下拿掉' : '')) + '">' +
          '<span class="te-lt-en">' + esc(Tags.display(r[0])) + '</span><span class="te-lt-zh">' + esc(r[2] || '') + '</span>' +
          (r[3] ? '<i class="te-lt-x" data-lx="' + esc(r[0]) + '" title="从这一类里去掉">' + icon('x', 'icon-sm') + '</i>' : '') + '</button>';
      }).join('') +
        (lib.adding ? '<span class="te-lt-addbox"><input class="input input-sm" id="teLibAdd" placeholder="英文或中文，回车加进「' + esc(S.name) + '」"></span>'
          : '<button class="te-lt is-add" data-ladd>' + icon('plus', 'icon-sm') + '加常用标签</button>') + '</div>' +
      '<div class="te-lib-foot meta"><span>「' + esc(S.name) + '」' + S.tags.length + ' 个' + (n ? '，上面用了 ' + n + ' 个' : '') + '</span><span>点一下加到最后，再点一下拿掉</span></div>';
    hydrateIcons(el);
    var ai = el.querySelector('#teLibAdd');
    if (ai) { ai.focus(); ai.onkeydown = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); lib.adding = false; drawLib(); return; }
      if (e.key !== 'Enter') return; e.preventDefault();
      var q = ai.value.trim(); if (!q) return;
      var hit = Tags.search(q, 1)[0], k = hit ? hit.r.tag : Tags.key(q);
      if (S.tags.some(function (r) { return r[0] === k; })) { toast('「' + esc(Tags.display(k)) + '」已经在这一类里了'); return; }
      S.tags.push([k, hit ? hit.r.count : 0, hit ? hit.r.zh || '' : '', 1]); lib.adding = false; drawLib(); markSaved();
      toast('「' + esc(Tags.display(k)) + '」加进了「' + esc(G.name) + ' › ' + esc(S.name) + '」' + (hit ? '' : '，词库里没有，照原样存'));
    }; }
  }
  function onLib(e) {
    var b;
    if ((b = e.target.closest('[data-lg]'))) { lib.g = +b.dataset.lg; lib.s = 0; lib.adding = false; drawLib(); return true; }
    if ((b = e.target.closest('[data-ls]'))) { lib.s = +b.dataset.ls; lib.adding = false; drawLib(); return true; }
    if ((b = e.target.closest('[data-lx]'))) {
      var S = TAG_GROUPS[lib.g].subs[lib.s]; S.tags = S.tags.filter(function (r) { return r[0] !== b.dataset.lx; }); drawLib(); markSaved(); return true;
    }
    if (e.target.closest('[data-ladd]')) { lib.adding = true; drawLib(); return true; }
    if (e.target.closest('[data-lnew]')) {
      var G = TAG_GROUPS[lib.g], nm = '新小类', i = 2; while (G.subs.some(function (s) { return s.name === nm; })) nm = '新小类 ' + i++;
      G.subs.push({ name: nm, src: '自己建的', tags: [] }); lib.s = G.subs.length - 1; lib.adding = true; drawLib();
      toast('在「' + G.name + '」下面建了「' + nm + '」，往里加几个常用标签吧'); return true;
    }
    if ((b = e.target.closest('[data-lt]'))) {
      var k = b.dataset.lt, c = chips().filter(function (x) { var t = Tags.parseOne(x.dataset.raw); return (t.k || Tags.key(t.name)) === k; })[0];
      if (c) { var nx = c.nextSibling; if (nx && nx.nodeType === 3 && !nx.nodeValue.trim()) nx.remove(); c.remove(); update(); }
      else { var tail = document.createTextNode(' '); ed.appendChild(tail); replaceRange(tail, 1, 1, [Tags.check({ raw: k, name: Tags.display(k), w: 1 })]); ed.scrollTop = ed.scrollHeight; }
      return true;
    }
    return false;
  }
  function onClick(e) {
    if (e.target.closest('#teLib')) { onLib(e); return; }
    var chip = e.target.closest('.te-chip');
    if (chip) {
      if (state.picking) { chip.classList.toggle('is-picked'); update(); }
      else openMini(chip);
      return;
    }
    var s = e.target.closest('[data-si]'); if (s) { ed.focus(); pickSug(+s.dataset.si); return; }
    var b = e.target.closest('[data-te],[data-fr],[data-ii]'); if (!b) return;
    if (b.dataset.fr) { insertFragment(b.dataset.fr); return; }
    if (b.dataset.ii) { interrogate(b.dataset.ii); return; }
    switch (b.dataset.te) {
      case 'close': d.close(); break;
      case 'save': save(); break;
      case 'frag': fragPop(b); break;
      case 'pickMode': {
        var picked = $$('.te-chip.is-picked', ed);
        if (state.picking && picked.length) saveFragment(picked);
        else { state.picking = !state.picking; d.classList.toggle('is-picking', state.picking); if (!state.picking) picked.forEach(function (x) { x.classList.remove('is-picked'); }); update(); }
        break;
      }
      case 'interrogate': imgPop(b); break;
      case 'toTags': toTags(); break;
    }
  }
  function save() {
    var list = current();
    var f = $$('.te-chip', ed).length;
    ed.childNodes.forEach(function (n) { if (n.nodeType === 3 && n.nodeValue.trim()) n.nodeValue.split(/[,，]/).forEach(function (x) { if (x.trim()) list.push(Tags.parseOne(x.trim())); }); });
    if (!list.length) { toast('一个标签都没有，存不了', { tone: 'warn' }); return; }
    d.close();
    Panel.saveManual(ctx.k, ctx.j, Tags.join(list), '存成了新版本，标着「手动修改」');
  }
  function insertAt(tags) {
    var s = getSelection(), node, pos;
    if (s.rangeCount && ed.contains(s.anchorNode) && s.anchorNode.nodeType === 3) { node = s.anchorNode; pos = s.anchorOffset; }
    else { node = document.createTextNode(' '); ed.appendChild(node); pos = 1; }
    replaceRange(node, pos, pos, tags);
  }
  /* 插片段 */
  function fragPop(btn) {
    closeMini();
    mini = document.createElement('div'); mini.className = 'img-pop te-frags'; mini.setAttribute('data-od-id', 'popover-insert-fragment');
    mini.innerHTML = '<input class="input" id="teFq" placeholder="搜片段名"><div class="te-fr-list"></div><p class="hint" style="margin:8px 2px 2px">插进来就是普通小块，和片段没有关系了。片段在设置里管。</p>';
    function draw(q) {
      var html = ['角色', '画风', '质量词', '其他'].map(function (c) {
        var list = FRAGMENTS.filter(function (f) { return f.cat === c && (!q || f.name.indexOf(q) >= 0); });
        if (!list.length) return '';
        return '<h4>' + c + '</h4>' + list.map(function (f) { return '<button class="te-fr" data-fr="' + f.id + '"><b>' + esc(f.name) + '</b><span class="mono meta">' + esc(f.text) + '</span></button>'; }).join('');
      }).join('');
      mini.querySelector('.te-fr-list').innerHTML = html || '<p class="gp-none">没有名字里带「' + esc(q) + '」的片段</p>';
    }
    draw(''); d.appendChild(mini);
    var r = btn.getBoundingClientRect();
    mini.style.position = 'fixed'; mini.style.left = r.left + 'px'; mini.style.top = (r.bottom + 6) + 'px';
    var q = mini.querySelector('#teFq'); q.focus();
    q.addEventListener('input', function () { draw(q.value.trim()); });
  }
  function insertFragment(id) {
    var f = FRAGMENTS.filter(function (x) { return x.id === id; })[0]; closeMini(); ed.focus();
    insertAt(Tags.parse(f.text));
    toast('插进了「' + esc(f.name) + '」的 ' + Tags.parse(f.text).length + ' 个标签');
  }
  function saveFragment(picked) {
    var text = Tags.join(picked.map(function (c) { return Tags.parseOne(c.dataset.raw); }));
    var dd = document.createElement('dialog'); dd.className = 'dialog'; dd.setAttribute('data-od-id', 'dialog-save-fragment');
    dd.innerHTML = '<div class="dialog-head"><h2>存成片段</h2></div><div class="dialog-body stack" style="gap:14px">' +
      '<div class="field"><label for="sfName">名字</label><input class="input" id="sfName" placeholder="比如：栗发少女的外观"><p class="hint" id="sfHint">写提示词时在编辑窗里搜这个名字插进来。</p></div>' +
      '<div class="field"><span class="label">分类</span><div class="seg" id="sfCat">' + ['角色', '画风', '质量词', '其他'].map(function (c, i) { return '<button aria-pressed="' + (i === 0) + '">' + c + '</button>'; }).join('') + '</div></div>' +
      '<div class="field"><span class="label">' + picked.length + ' 个标签</span><p class="mono te-sf-prev">' + esc(text) + '</p></div></div>' +
      '<div class="dialog-foot"><button class="btn btn-secondary" value="cancel">取消</button><button class="btn btn-primary" value="ok">存</button></div>';
    document.body.appendChild(dd); dd.showModal();
    dd.querySelector('#sfCat').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; $$('#sfCat button', dd).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); };
    dd.querySelectorAll('[value]').forEach(function (b) { b.onclick = function () {
      var name = dd.querySelector('#sfName').value.trim();
      if (b.value === 'ok') {
        var bad = !name ? '先起个名字' : FRAGMENTS.some(function (f) { return f.name === name; }) ? '已经有叫「' + name + '」的片段了，换一个名字' : '';
        if (bad) { var h = dd.querySelector('#sfHint'); h.textContent = bad; h.className = 'hint is-error'; dd.querySelector('#sfName').classList.add('is-error'); return; }
        FRAGMENTS.push({ id: 'f' + Date.now(), name: name, cat: dd.querySelector('#sfCat [aria-pressed="true"]').textContent, text: text });
        picked.forEach(function (x) { x.classList.remove('is-picked'); }); state.picking = false; d.classList.remove('is-picking'); update();
        toast('存好了片段「' + esc(name) + '」，以后在「插片段」里能搜到');
      }
      dd.close();
    }; });
    dd.addEventListener('close', function () { dd.remove(); });
  }
  /* 从图反推：槽位里的图，或这个节点出过的图 */
  function imgPop(btn) {
    closeMini();
    var n = ctx.n, mine = ImgUI.latestImages(n, 8);
    mini = document.createElement('div'); mini.className = 'img-pop te-ipick'; mini.setAttribute('data-od-id', 'popover-interrogate');
    mini.innerHTML = '<h4>槽位里的图</h4>' + (n.slots.length ? '<div class="gp-imgs">' + n.slots.map(function (id, i) { return '<button data-ii="s:' + id + '">' + thumbHTML(id) + '<span class="num-badge">' + (i + 1) + '</span></button>'; }).join('') + '</div>' : '<p class="gp-none">槽位是空的</p>') +
      '<h4>这个节点出过的图</h4>' + (mine.length ? '<div class="gp-imgs is-tall">' + mine.map(function (x) { return '<button data-ii="g:' + x.it.g + '"><img src="' + GEN[x.it.g].src + '" alt=""></button>'; }).join('') + '</div>' : '<p class="gp-none">还没出过图</p>') +
      '<p class="hint" style="margin:6px 2px 2px">ComfyUI 看图写出标签，加在末尾。要装 WD14 Tagger 插件，几秒到十几秒。</p>';
    d.appendChild(mini);
    var r = btn.getBoundingClientRect();
    mini.style.position = 'fixed'; mini.style.left = r.left + 'px'; mini.style.top = (r.bottom + 6) + 'px';
  }
  function busy(label, note, ms, done, hold) {
    state.busy = label; state.busyNote = note; state.since = Date.now() - (hold ? 7000 : 0); state.hold = hold; banner();
    d.querySelector('.te-main').classList.add('is-busy');
    if (hold) return;
    setTimeout(function () { state.busy = null; banner(); d.querySelector('.te-main').classList.remove('is-busy'); done(); }, ms);
  }
  function interrogate(src, hold) {
    closeMini();
    if (COMFY.use === 'lan' && COMFY.lan.state === 'down') { toast('连不上 ComfyUI，反推用不了。先在顶上的 ComfyUI 胶囊里看看哪台能用', { tone: 'danger', ms: 4500 }); return; }
    busy('ComfyUI 正在看图写标签', '写好的标签会加在末尾，已经有的不重复加。', 3200, function () {
      var have = current().map(function (t) { return t.k; });
      var add = FROM_IMAGE.filter(function (k) { return have.indexOf(k) < 0; }).map(function (k) { return Tags.check({ raw: k, name: Tags.display(k), w: 1 }); });
      var last = document.createTextNode(' '); ed.appendChild(last);
      replaceRange(last, 1, 1, add);
      toast('反推出 12 个标签，新加了 ' + add.length + ' 个，在最后面');
    }, hold);
  }
  function toTags(hold) {
    var f = fragment(), q = state.frag;
    busy('AI 正在把「' + q + '」转成标签', '用「' + modelName(ctx.n) + '」问一次，不带对话记录。', 2600, function () {
      var keys = TO_TAGS[q] || ['sitting', 'reading'];
      var ff = fragment() || f;
      if (ff) replaceRange(ff.node, ff.start, ff.end, keys.map(function (k) { return Tags.check({ raw: k, name: Tags.display(k), w: 1 }); }));
      sugs = []; state.frag = ''; renderSug();
      toast('「' + esc(q) + '」转成了 ' + keys.length + ' 个标签：' + keys.map(Tags.display).join(', '));
    }, hold);
  }
  /* 原型：直接停在某个等待状态 */
  function protoState(v) {
    if (!d || !d.open) return;
    if (v === 'toTags') { ed.focus(); caretEnd(); document.execCommand('insertText', false, ' 坐在窗边看书'); onInput(); toTags(true); }
    if (v === 'interrogate') interrogate('g:d3', true);
    if (v === 'libUpdating') { banner(); ed.focus(); caretEnd(); document.execCommand('insertText', false, ' 金发'); onInput(); }
  }
  return { open: open, protoState: protoState, banner: function () { if (d) banner(); } };
})();

/* 槽位区右边的尺寸、张数、出图设置 */
(function () {
  if (!$('#imgSize')) return;
  $('#imgSize').onchange = function (e) { var n = Panel.node(); n.size = e.target.value; markSaved(); renderGraph(); toast('下次生图按 ' + n.size + ' 出'); };
  $('#cntDown').onclick = function () { var n = Panel.node(); n.count = Math.max(1, n.count - 1); ImgUI.renderDock(n); markSaved(); };
  $('#cntUp').onclick = function () { var n = Panel.node(); n.count = Math.min(8, n.count + 1); ImgUI.renderDock(n); markSaved(); };
  $('#btnGenCfg').onclick = function () { GenCfg.open(Panel.node()); };
})();
