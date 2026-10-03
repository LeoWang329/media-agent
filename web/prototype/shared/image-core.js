/* 生图共用：标签的拆分、校验、拼接和显示；ComfyUI / AutoDL 的状态胶囊。画布、首页、设置三页都用。 */

Object.assign(ICONS, {
  download: '<path d="M12 4.5v10M7.5 10.5l4.5 4.5 4.5-4.5M5 19.5h14"/>',
  brush: '<path d="M14.5 4.5l5 5-8 8-5-5z"/><path d="M6.5 12.5c-2 0-3 1.5-3 3.5 0 1.5-.5 2.5-1 3.5 2.5 0 6-.5 6-4.5"/>',
  brain: '<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.3A3 3 0 0 0 8 17.5a2.5 2.5 0 0 0 4 1.5V5.5A2.5 2.5 0 0 0 9 4.5z"/><path d="M15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.3A3 3 0 0 1 16 17.5a2.5 2.5 0 0 1-4 1.5"/>',
  server: '<rect x="4" y="4.5" width="16" height="6" rx="1.5"/><rect x="4" y="13.5" width="16" height="6" rx="1.5"/><path d="M7.5 7.5h.01M7.5 16.5h.01" stroke-width="2.4"/>',
  power: '<path d="M12 3.5v8"/><path d="M7 6.5a7 7 0 1 0 10 0"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
  upscale: '<rect x="3.5" y="10.5" width="10" height="10" rx="1.5"/><path d="M13 4.5h6.5V11M19.5 4.5l-7 7"/>',
  face: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01" stroke-width="2.4"/><path d="M8.8 14.5a4 4 0 0 0 6.4 0"/>',
  tag: '<path d="M3.5 12.5v-7a2 2 0 0 1 2-2h7l8 8-9 9z"/><path d="M8 8h.01" stroke-width="2.4"/>',
  scan: '<path d="M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3"/><path d="M8 12h8"/>',
  sliders: '<path d="M5 6.5h8M17 6.5h2M5 12h2M11 12h8M5 17.5h10M19 17.5h0"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  sparkles: '<path d="M10 3.5l1.6 4.4L16 9.5l-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z"/><path d="M17.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>'
});

var Tags = (function () {
  var EMOTICONS = ['^_^', '>_<', '@_@', '+_+', '=_=', 'o_o', '|_|', '0_0', 'u_u', '>_o', '._.', 'x_x', '<o>_<o>', '3_3', '6_9'];
  /* 拆：英文逗号分开，括号里的逗号不拆；(tag:1.2) 拆出权重，(tag) 当 1.1；\( \) 是标签名里的括号 */
  function split(text) {
    var out = [], cur = '', depth = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === '\\' && i + 1 < text.length) { cur += c + text.charAt(i + 1); i++; continue; }
      if (c === '(') depth++;
      if (c === ')') depth = Math.max(0, depth - 1);
      if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function key(name) { return name.toLowerCase().replace(/\\/g, '').replace(/ /g, '_'); }
  function display(k) { return EMOTICONS.indexOf(k) >= 0 ? k : k.replace(/_/g, ' '); }
  function parseOne(raw) {
    var w = 1, name = raw;
    var m = raw.match(/^\((.+):\s*([\d.]+)\)$/);
    if (m) { name = m[1]; w = Math.round(parseFloat(m[2]) * 10) / 10; }
    else if (/^\(.+\)$/.test(raw) && !/\\\)$/.test(raw)) { name = raw.slice(1, -1); w = 1.1; }
    return check({ raw: raw, name: name.trim(), w: w });
  }
  /* 校验：认识 / 别名 / 不认识 */
  function check(t) {
    var k = key(t.name);
    if (TAGDB[k]) { t.st = 'ok'; t.k = k; t.info = TAGDB[k]; }
    else if (TAG_ALIASES[k] && TAGDB[TAG_ALIASES[k]]) { t.st = 'alias'; t.from = t.name.replace(/\\/g, ''); t.k = TAG_ALIASES[k]; t.info = TAGDB[t.k]; }
    else if (QUALITY_WORDS.indexOf(t.name.toLowerCase()) >= 0) { t.st = 'ok'; t.k = k; t.info = { cat: 5, zh: '质量词', count: null }; }
    else { t.st = 'unknown'; t.k = k; t.info = null; }
    return t;
  }
  function parse(text) { return split(text).map(parseOne); }
  function nameOf(t) { return t.st === 'unknown' ? t.name.replace(/\\/g, '') : display(t.k); }
  /* 拼：别名换标准名，不认识的原样；下划线换空格；名字里的括号写成 \( \)；权重不是 1 写成 (tag:1.2) */
  function one(t) {
    var n = t.st === 'unknown' ? t.name : display(t.k).replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    return t.w === 1 ? n : '(' + n + ':' + t.w.toFixed(1).replace(/\.0$/, '.0') + ')';
  }
  function join(list) { return list.map(one).join(', '); }
  function fmtCount(n) {
    if (n == null) return '';
    if (n >= 10000) return (n / 10000 >= 100 ? Math.round(n / 10000) : (n / 10000).toFixed(1).replace(/\.0$/, '')) + ' 万';
    return fmtNum(n);
  }
  /* 一个标签小块：英文在上，中文在下 */
  function chip(t, i, opts) {
    opts = opts || {};
    var info = t.info, cat = info ? info.cat : -1;
    var catLbl = cat === 4 || cat === 3 || cat === 1 ? '<i class="tg-cat">' + TAG_CAT[cat] + '</i>' : '';
    var w = t.w !== 1 ? '<b class="tg-w' + (t.w < 1 ? ' is-down' : '') + '">' + t.w.toFixed(1) + '</b>' : '';
    var zh;
    if (t.st === 'unknown') zh = '<span class="tg-zh is-unknown">' + (opts.unknownText || '不认识 · 点开挑') + '</span>';
    else {
      var z = info.zh && key(info.zh) !== t.k ? info.zh : '';
      zh = '<span class="tg-zh">' + (z ? esc(z) : '<span class="tg-none">' + (cat === 1 ? '画师，没有中文' : '没有中文') + '</span>') +
        (t.st === 'alias' ? '<span class="tg-was">原来写的是 ' + esc(t.from) + '</span>' : '') + '</span>';
    }
    var title = nameOf(t) + (info && info.zh ? ' · ' + info.zh : '') + (info ? ' · ' + (TAG_CAT[cat] || '') + (info.count ? ' · 用过 ' + fmtCount(info.count) + ' 次' : '') : '') +
      (t.w !== 1 ? ' · 权重 ' + t.w.toFixed(1) : '') + (t.st === 'alias' ? '\n原来写的是 ' + t.from + '，程序换成了标准写法' : '') +
      (t.st === 'unknown' ? '\n词库里没有这个写法。可能是 AI 编的，也可能是有意写的（比如 LoRA 的触发词）' : '');
    var tagName = opts.tagName || 'span';
    return '<' + tagName + ' class="tg cat-' + cat + (t.st !== 'ok' ? ' is-' + t.st : '') + (opts.cls ? ' ' + opts.cls : '') + '"' +
      (i != null ? ' data-ti="' + i + '"' : '') + (opts.attrs || '') + ' title="' + esc(title) + '">' +
      '<span class="tg-en">' + catLbl + '<span class="tg-name">' + esc(nameOf(t)) + '</span>' + w + '</span>' + zh + '</' + tagName + '>';
  }
  function stats(list) {
    var s = { n: list.length, alias: 0, unknown: 0 };
    list.forEach(function (t) { if (t.st === 'alias') s.alias++; if (t.st === 'unknown') s.unknown++; });
    return s;
  }
  /* 联想：英文先比开头、再比中间、再比别名；中文比中文名，开头对上的在前；同档按使用次数 */
  function search(q, limit) {
    q = (q || '').trim(); if (!q) return [];
    var lim = limit || 20, rows = Object.keys(TAGDB).map(function (k) { return TAGDB[k]; });
    var tiers = [[], [], [], []];
    var en = /[a-z0-9_]/i.test(q) && !/[一-龥]/.test(q);
    if (en) {
      var qk = key(q);
      rows.forEach(function (r) { if (r.tag.indexOf(qk) === 0) tiers[0].push({ r: r }); else if (r.tag.indexOf(qk) > 0) tiers[1].push({ r: r }); });
      Object.keys(TAG_ALIASES).forEach(function (a) { if (a.indexOf(qk) >= 0 && TAGDB[TAG_ALIASES[a]]) tiers[2].push({ r: TAGDB[TAG_ALIASES[a]], via: a.replace(/_/g, ' ') }); });
    } else {
      rows.forEach(function (r) { if (!r.zh) return; if (r.zh.indexOf(q) === 0) tiers[0].push({ r: r }); else if (r.zh.indexOf(q) > 0) tiers[1].push({ r: r }); });
    }
    var seen = {}, out = [];
    tiers.forEach(function (t) {
      t.sort(function (a, b) { return b.r.count - a.r.count; }).forEach(function (x) { if (!seen[x.r.tag] && out.length < lim) { seen[x.r.tag] = 1; out.push(x); } });
    });
    return out;
  }
  return { split: split, parse: parse, parseOne: parseOne, check: check, key: key, display: display, nameOf: nameOf, one: one, join: join, chip: chip, stats: stats, search: search, fmtCount: fmtCount };
})();

/* 一个框里的标签整段：小块排成几行 */
function tagsHTML(text, opts) {
  var list = Tags.parse(text);
  return '<div class="tg-flow">' + list.map(function (t, i) { return Tags.chip(t, i, opts); }).join('') + '</div>';
}

/* ─── ComfyUI / AutoDL 状态 ─────────────────────────────────
   画布、首页、设置三页顶栏都有这个胶囊。AutoDL 开着就在扣钱，所以开着的时候用醒目的样子，一直挂着。 */
var Comfy = (function () {
  var tickT = null;
  function ad() { return COMFY.autodl; }
  function secsSince(t) { return Math.max(0, Math.round((Date.now() - t) / 1000)); }
  function label() {
    var a = ad();
    if (COMFY.use === 'lan') {
      var l = COMFY.lan;
      if (l.state === 'down') return { cls: 'is-down', dot: 'dot-danger', text: '局域网 ComfyUI 连不上' };
      return { cls: a.state === 'running' ? '' : '', dot: 'dot-ok', text: '局域网 ComfyUI', sub: '连得上' };
    }
    if (a.state === 'off') return { cls: '', dot: '', text: 'AutoDL 已关机', sub: '点生图时自动开机' };
    if (a.state === 'booting') return { cls: 'is-booting', spin: true, text: 'AutoDL 正在开机', sub: '等了 <span class="mono" data-since="' + a.since + '">' + secsSince(a.since) + ' 秒</span>' };
    if (a.state === 'failed') return { cls: 'is-down', dot: 'dot-danger', text: 'AutoDL 开机失败' };
    return { cls: 'is-running', dot: 'dot-warn', text: 'AutoDL 运行中', sub: a.busy ? '正在出图' : '<span class="mono">' + a.idleLeft + '</span> 分钟后自动关机' };
  }
  function pillHTML() {
    var l = label();
    return (l.spin ? '<span class="spinner"></span>' : '<span class="dot ' + (l.dot || '') + '"></span>') +
      '<span class="cf-txt">' + l.text + '</span>' + (l.sub ? '<span class="cf-sub">' + l.sub + '</span>' : '') + icon('chev-down', 'icon-sm');
  }
  /* AutoDL 开着时，另一处也提醒：不是正在用的那台也在扣钱 */
  function render() {
    $$('.cf-pill').forEach(function (p) {
      var l = label();
      p.className = 'cf-pill ' + l.cls + (COMFY.use === 'lan' && ad().state === 'running' ? ' has-autodl' : '');
      p.innerHTML = pillHTML() + (COMFY.use === 'lan' && ad().state === 'running' ? '<span class="cf-extra">' + icon('power', 'icon-sm') + 'AutoDL 也开着</span>' : '');
      p.title = '出图用哪台 ComfyUI，所有节点共用。点开切换、开机关机';
    });
    $$('[data-cf-render]').forEach(function (el) { el.innerHTML = panelHTML(); hydrateIcons(el); });
    if (!tickT) tickT = setInterval(function () {
      $$('[data-since]').forEach(function (s) { s.textContent = secsSince(+s.dataset.since) + ' 秒'; });
    }, 1000);
    document.dispatchEvent(new CustomEvent('comfy-change'));
  }
  function errText(e) {
    return { token: 'Token 不对：AutoDL 返回「' + 'invalid token' + '」。去设置里重新填开发者 Token。',
             balance: '余额不够，开不了机：AutoDL 返回「账户余额不足，请充值后再开机」。充值后再点开机。',
             timeout: '等了 5 分钟还没开好：实例状态一直是「开机中」。可以再试一次，或者先用局域网那台。',
             gone: '实例不存在：AutoDL 返回「instance not found」。可能已经被释放（连续关机 60 天会释放），去设置里重新选实例。' }[e] || e;
  }
  function panelHTML() {
    var a = ad(), l = COMFY.lan;
    var lanState = l.state === 'down'
      ? '<span class="tag tag-danger">' + icon('x') + '连不上</span><span class="meta">地址不对，或者那台电脑上 ComfyUI 没开</span>'
      : '<span class="tag tag-ok">' + icon('check') + '连得上</span><span class="meta mono">' + esc(l.gpu.replace('NVIDIA GeForce ', '')) + ' · ' + l.vram + '</span>';
    var adState;
    if (a.state === 'off') adState = '<span class="tag">已关机</span><span class="meta">关机时不扣显卡的钱</span>';
    else if (a.state === 'booting') adState = '<span class="tag tag-accent"><span class="spinner"></span>正在开机</span><span class="meta">等了 <span class="mono" data-since="' + a.since + '">' + secsSince(a.since) + ' 秒</span>，一般要一两分钟</span>';
    else if (a.state === 'failed') adState = '<span class="tag tag-danger">' + icon('x') + '开机失败</span>';
    else adState = '<span class="tag tag-warn">' + icon('power') + '运行中 · 在扣钱</span><span class="meta">开了 <span class="mono">' + (a.upMin || 23) + '</span> 分钟 · ' + (a.busy ? '正在出图，出完空闲 ' + a.idleMin + ' 分钟后关机' : '<span class="mono">' + a.idleLeft + '</span> 分钟后自动关机') + '</span>';
    return '' +
      '<div class="cf-pop-head"><b>出图用哪台 ComfyUI</b><span class="meta">所有节点共用，只记在这台电脑上</span></div>' +
      '<label class="cf-src' + (COMFY.use === 'lan' ? ' is-on' : '') + '"><input type="radio" name="cfsrc" value="lan"' + (COMFY.use === 'lan' ? ' checked' : '') + '>' +
        '<span class="cf-src-body"><span class="cf-src-name">' + icon('server') + '局域网那台</span><span class="mono meta">' + esc(l.url) + '</span><span class="cf-src-state">' + lanState + '</span></span></label>' +
      '<label class="cf-src' + (COMFY.use === 'autodl' ? ' is-on' : '') + '"><input type="radio" name="cfsrc" value="autodl"' + (COMFY.use === 'autodl' ? ' checked' : '') + '>' +
        '<span class="cf-src-body"><span class="cf-src-name">' + icon('server') + 'AutoDL 实例</span><span class="meta">' + esc(a.instance) + ' · ' + esc(a.region) + ' · ' + esc(a.gpu) + ' · <span class="mono">' + esc(a.price) + '</span></span>' +
        '<span class="cf-src-state">' + adState + '</span>' +
        (a.state === 'failed' && a.error ? '<span class="cf-err">' + esc(errText(a.error)) + '</span>' : '') +
        '<span class="cf-src-acts">' +
          (a.state === 'running' ? '<button class="btn btn-secondary btn-sm" data-cf="off">' + icon('power') + '现在关机</button>' :
           a.state === 'booting' ? '<button class="btn btn-secondary btn-sm" data-cf="cancelBoot">别开了</button>' :
           '<button class="btn btn-secondary btn-sm" data-cf="on">' + icon('power') + '开机</button>') +
          '<span class="meta">空闲 <span class="mono">' + a.idleMin + '</span> 分钟自动关机</span>' +
        '</span></span></label>' +
      '<p class="cf-note">' + icon('info', 'icon-sm') + '<span>程序关掉以后就管不了实例了。看到 AutoDL 还开着又不用，先点关机再关程序。</span></p>' +
      '<div class="cf-pop-foot"><button class="btn btn-ghost btn-sm" data-cf="refresh">' + icon('refresh') + '重新读底模和 LoRA 列表</button><span class="grow"></span><a class="btn btn-ghost btn-sm" href="settings.html#comfy">' + icon('gear') + '设置</a></div>';
  }
  var pop = null;
  function close() { if (pop) { pop.remove(); pop = null; } }
  function open(anchor) {
    if (pop) { close(); return; }
    pop = document.createElement('div');
    pop.className = 'cf-pop'; pop.setAttribute('data-cf-render', '');
    pop.setAttribute('data-od-id', 'comfy-popover');
    pop.innerHTML = panelHTML();
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
    pop.addEventListener('change', function (e) {
      if (e.target.name !== 'cfsrc') return;
      COMFY.use = e.target.value; render();
      toast(COMFY.use === 'lan' ? '换成局域网那台出图' : 'AutoDL 实例出图。' + (ad().state === 'off' ? '它现在关着，点生图时会先开机，要等一两分钟' : ''));
    });
    pop.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cf]'); if (!b) return;
      e.preventDefault();
      var a = ad();
      if (b.dataset.cf === 'on') boot();
      if (b.dataset.cf === 'off') confirmBox({ title: '关掉 AutoDL 实例？', body: '关机后不再按秒扣显卡的钱，只收系统盘的钱。下次出图要重新开机，等一两分钟。', ok: '关机', onOk: function () { a.state = 'off'; a.busy = false; render(); toast('AutoDL 实例已关机'); } });
      if (b.dataset.cf === 'cancelBoot') { a.state = 'off'; render(); toast('不开了。已经发出的开机请求会让它开好后马上关掉'); }
      if (b.dataset.cf === 'refresh') { b.innerHTML = '<span class="spinner"></span>正在读…'; setTimeout(function () { render(); toast('读到 6 个底模、5 个 LoRA、7 种采样器'); }, 900); }
    });
  }
  /* 开机：原型里把一两分钟压到 8 秒 */
  function boot(onReady, opts) {
    var a = ad(); opts = opts || {};
    if (a.state === 'running') { onReady && onReady(); return; }
    a.state = 'booting'; a.since = Date.now() - (opts.ago || 0) * 1000; a.error = null; render();
    if (opts.hold) return;
    setTimeout(function () {
      if (a.state !== 'booting') return;
      if (opts.fail) { a.state = 'failed'; a.error = opts.fail; render(); onReady && onReady(opts.fail); return; }
      a.state = 'running'; a.idleLeft = a.idleMin; a.upMin = 0; a.byApp = true; render();
      toast('AutoDL 实例开好了，开着就按秒扣钱，空闲 ' + a.idleMin + ' 分钟会自动关');
      onReady && onReady();
    }, opts.ms || 8000);
  }
  document.addEventListener('pointerdown', function (e) { if (pop && !pop.contains(e.target) && !e.target.closest('.cf-pill')) close(); });
  document.addEventListener('click', function (e) { var p = e.target.closest('.cf-pill'); if (p) open(p); });
  document.addEventListener('DOMContentLoaded', render);
  return { render: render, open: open, close: close, boot: boot, errText: errText, label: label };
})();
