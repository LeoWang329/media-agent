/* 画布 · 生图节点：标签框、出图记录、大图和参数、出图设置、思考。由 canvas-panel.js 调用。 */

var ImgUI = (function () {
  var PROTO = { fail: null };          // 原型里模拟出错：down / noCkpt / oom / missingNode / missingModel
  var POOL = { n10: ['e1', 'e2', 'e3', 'e4'], n11: ['e5', 'e6', 'e7', 'e8'] };
  var jobSeq = 100, poolIdx = 0;

  function series(n) { return seriesOf(n.sys); }
  function srcName(s) { return s === 'autodl' ? 'AutoDL' : '局域网'; }
  function wfName(id) { var w = WORKFLOWS.filter(function (x) { return x.id === id; })[0]; return w ? w.name : id; }
  function shortCkpt(s) { return s.replace(/\.safetensors$/, ''); }
  function sizeWH(s) { var m = s.split('×'); return { w: +m[0], h: +m[1] }; }
  function secs(ms) { return ms >= 60000 ? Math.floor(ms / 60000) + ' 分 ' + Math.round(ms % 60000 / 1000) + ' 秒' : (ms / 1000).toFixed(1).replace(/\.0$/, '') + ' 秒'; }

  /* 找某组出图挂在哪：节点、回复、框 */
  function eachBox(fn) {
    G.nodes.forEach(function (n) {
      if (!isImageNode(n)) return;
      (function walk(arr) {
        arr.forEach(function (p) { p.versions.forEach(function (v) { (v.boxes || []).forEach(function (b, j) { fn(n, v, b, j); }); if (v.rest) walk(v.rest); }); });
      })(THREADS[n.id] || []);
    });
  }
  function findJob(id) {
    var hit = null;
    eachBox(function (n, v, b, j) { (b.jobs || []).forEach(function (jb) { if (jb.id === id) hit = { n: n, v: v, b: b, j: j, job: jb }; }); });
    return hit;
  }
  function doneCount(jb) { return jb.items.filter(function (it) { return it.st === 'done'; }).length; }
  function latestImages(n, max) {
    var out = [];
    eachBox(function (nn, v, b) { if (nn !== n) return; (b.jobs || []).forEach(function (jb) { jb.items.forEach(function (it) { if (it.st === 'done' && it.g) out.push({ it: it, jb: jb }); }); }); });
    out.sort(function (a, b) { return b.jb.ts - a.jb.ts; });
    return out.slice(0, max || 5);
  }
  function liveJobs(n) {
    var out = [];
    eachBox(function (nn, v, b) { if (nn === n) (b.jobs || []).forEach(function (jb) { if (jb.live) out.push(jb); }); });
    return out;
  }
  function lastJob(n) {
    var last = null;
    eachBox(function (nn, v, b) { if (nn === n) (b.jobs || []).forEach(function (jb) { if (!last || jb.ts > last.ts) last = jb; }); });
    return last;
  }

  /* ─── 思考 ─────────────────────────────────────────── */
  function thinkHTML(v) {
    if (v._thinkStart) {
      return '<div class="think is-live" data-od-id="thinking-live"><span class="spinner"></span><span>正在思考 <span class="mono" data-since="' + v._thinkStart + '">' +
        Math.round((Date.now() - v._thinkStart) / 1000) + ' 秒</span></span><span class="meta">想完才开始写正文</span></div>';
    }
    if (!v.thinking) return '';
    var t = v.thinking, s = Math.round(t.ms / 1000) + ' 秒';
    if (!t.text) return '<div class="think" data-od-id="thinking-done">' + icon('brain', 'icon-sm') + '<span>思考了 <span class="mono">' + s + '</span></span><span class="meta">这家模型不发回思考的内容，只知道想了多久</span></div>';
    return '<details class="think think-open" data-od-id="thinking-done"><summary>' + icon('brain', 'icon-sm') + '<span>思考了 <span class="mono">' + s + '</span></span>' +
      '<span class="meta">' + fmtNum(t.text.length) + ' 字 · 不会带进下一轮对话</span>' + icon('chev-down', 'icon-sm chev') + '</summary><div class="think-body">' + esc(t.text) + '</div></details>';
  }
  function thinkLevel(n) {
    var m = MODEL_CONFIGS.filter(function (x) { return x.id === n.model; })[0];
    var lv = THINK.uses.write === '跟总开关' ? THINK.level : THINK.uses.write;
    if (!m || m.think === '不支持') return { on: false, text: '这套模型不支持思考' };
    return { on: lv !== '关', lv: lv, text: lv === '关' ? '思考：关' : '思考：' + lv, model: m };
  }

  /* ─── 提示词框（生图） ─────────────────────────────── */
  function abtn(a, label, ic, k, src, j, extra, cls) {
    return '<button class="btn ' + (cls || 'btn-ghost') + ' btn-sm" data-act="' + a + '" data-k="' + k + '" data-j="' + j + '" data-src="' + src + '"' + (extra || '') + ' title="' + label + '">' + icon(ic) + '<span class="lbl">' + label + '</span></button>';
  }
  function boxHTML(n, v, b, k, j, src, ro, o) {
    o = o || {};
    var text = o.writing ? b.text.slice(0, o.shown) : b.text;
    var list = Tags.parse(text), st = Tags.stats(list);
    var html = '<div class="pbox pbox-img' + (b.starred ? ' is-starred' : '') + (o.writing ? ' is-writing' : '') + '" data-od-id="image-prompt-box">' +
      '<div class="pb-head"><span class="pb-label' + (b.label ? '' : ' is-plain') + '">' + esc(b.label || '提示词') + '</span><div class="pb-actions">' +
        abtn('copy', '复制', 'copy', k, src, j) +
        (o.writing || ro ? '' : '<span class="split-btn">' + abtn('gen', '生图', 'sparkles', k, src, j, '', 'btn-secondary') +
          '<button class="btn btn-secondary btn-sm btn-icon" data-act="genMenu" data-k="' + k + '" data-j="' + j + '" data-src="' + src + '" title="用参考图出图：图生图、姿势参考、画风参考" aria-label="用参考图出图">' + icon('chev-down', 'icon-sm') + '</button></span>') +
        (ro ? '' : '<button class="btn btn-ghost btn-sm' + (b.starred ? ' is-star' : '') + '" data-act="star" data-k="' + k + '" data-j="' + j + '" data-src="o" title="' + (b.starred ? '取消星标' : '打星：这版效果好') + '">' + icon('star', b.starred ? 'icon-fill' : '') + '<span class="lbl">' + (b.starred ? '已打星' : '打星') + '</span></button>') +
        (ro || o.writing ? '' : abtn('editTags', '编辑', 'edit', k, src, j)) +
        (o.writing ? '' : abtn('continue', '沿这个方向继续', 'arrow-right', k, src, j)) +
      '</div></div>' +
      '<div class="pb-body tg-body" data-k="' + k + '" data-j="' + j + '" data-src="' + src + '">' +
        '<div class="tg-flow">' + list.map(function (t, i) { return Tags.chip(t, i, t.st === 'unknown' && !ro ? { tagName: 'button', attrs: ' data-act="unknownTag" data-k="' + k + '" data-j="' + j + '" data-src="' + src + '" data-ti="' + i + '"' } : null); }).join('') +
        (o.writing ? '<span class="caret"></span>' : '') + '</div></div>' +
      (o.writing ? '<div class="pb-foot"><span class="writing-tag"><span class="spinner"></span>还没写完</span><span class="mono">' + list.length + ' 个标签</span></div>' :
        '<div class="pb-foot tg-foot"><span class="mono">' + st.n + '</span> 个标签' +
          (st.alias ? '<span class="tg-foot-sep">·</span><span>' + st.alias + ' 处换成了标准写法</span>' : '') +
          (st.unknown ? '<span class="tg-foot-sep">·</span><span class="tg-foot-unknown">' + st.unknown + ' 个词库里没有</span>' : '') +
          '<span class="grow"></span><span class="meta">出图时前面加 <span class="mono">' + esc(SERIES[series(n)].prefix) + '</span></span></div>') +
      (o.writing ? '' : jobsHTML(n, b, k, j, ro)) +
      '</div>';
    return html;
  }

  /* ─── 出图记录：一组一行，按时间排，新的在下面 ─────── */
  function jobsHTML(n, b, k, j, ro) {
    var jobs = b.jobs || [];
    if (!jobs.length) return ro ? '' : '<div class="ig-empty meta">还没出过图。点「生图」按节点的出图设置出 <span class="mono">' + n.count + '</span> 张。</div>';
    var shown = jobs, hidden = 0;
    if (!b._allJobs && jobs.length > 3) { hidden = jobs.length - 3; shown = jobs.slice(-3); }
    return '<div class="ig-jobs" data-od-id="image-jobs">' +
      (hidden ? '<button class="ig-older" data-act="allJobs" data-k="' + k + '" data-j="' + j + '" data-src="' + (ro ? 'c' : 'o') + '">' + icon('chev-right', 'icon-sm') + '更早的 ' + hidden + ' 组（' + jobs.slice(0, hidden).reduce(function (s, x) { return s + doneCount(x); }, 0) + ' 张图）</button>' : '') +
      shown.map(function (jb) { return jobHTML(n, b, jb, ro); }).join('') + '</div>';
  }
  function kindLabel(jb) {
    return { gen: jb.note || '生图', upscale: '放大 ' + jb.scale + '×', face: '修脸', i2i: '图生图', pose: '姿势参考', style: '画风参考' }[jb.kind];
  }
  function sourceText(jb) {
    if (!jb.source) return '';
    var h = findJob(jb.source.job);
    return h ? '来自 ' + h.job.at + ' 那组第 ' + (jb.source.i + 1) + ' 张' : '来源那张已删掉';
  }
  function jobState(jb) {
    var c = { done: 0, running: 0, queued: 0, failed: 0, stopped: 0 };
    jb.items.forEach(function (it) { c[it.st]++; });
    if (jb.waitBoot) return { cls: 'is-live', html: '<span class="spinner"></span>AutoDL 正在开机，等了 <span class="mono" data-since="' + COMFY.autodl.since + '">' + Math.round((Date.now() - COMFY.autodl.since) / 1000) + ' 秒</span>，开好了再排队' };
    if (c.running || c.queued) return { cls: 'is-live', html: '<span class="dot dot-live"></span>正在出 · 出完 <span class="mono">' + c.done + '/' + jb.items.length + '</span>' + (c.queued ? ' · 还有 <span class="mono">' + c.queued + '</span> 张在排队' : '') };
    if (c.failed === jb.items.length) return { cls: 'is-failed', html: icon('warn', 'icon-sm') + (jb.notSent ? '没有发出去' : '<span class="mono">' + c.failed + '</span> 张都失败了') };
    var parts = ['出完 <span class="mono">' + c.done + '/' + jb.items.length + '</span>'];
    if (c.failed) parts.push('<span class="ig-bad">' + c.failed + ' 张失败</span>');
    if (c.stopped) parts.push(c.stopped + ' 张叫停了');
    return { cls: '', html: parts.join(' · ') };
  }
  function jobHTML(n, b, jb, ro) {
    var s = jobState(jb), wh = sizeWH(jb.size);
    var sel = jb.items.filter(function (it) { return it._sel; }).length;
    var done = doneCount(jb);
    var errs = jb.items.filter(function (it) { return it.st === 'failed' && it.err && it.err.msg; });
    var ref = jb.ref ? '<span class="ig-ref" title="参考图">' + (IMAGES[jb.ref.img] ? '<span class="ig-ref-im">' + thumbHTML(jb.ref.img) + '</span>' : '') + '强度 <span class="mono">' + jb.ref.strength + '</span></span>' : '';
    return '<section class="ig-job ' + s.cls + '" data-job="' + jb.id + '" data-od-id="image-job">' +
      '<header class="ig-head">' +
        '<span class="ig-kind' + (jb.kind !== 'gen' || jb.note ? ' is-derived' : '') + '">' + esc(kindLabel(jb)) + '</span>' +
        (jb.source ? '<span class="meta">' + esc(sourceText(jb)) + '</span>' : '') + ref +
        '<span class="ig-meta meta"><span class="mono">' + esc(jb.at) + '</span><span>' + jb.items.length + ' 张</span><span>' + srcName(jb.src) + '</span>' +
          (jb.workflow !== 'builtin' ? '<span>工作流「' + esc(wfName(jb.workflow)) + '」</span>' : '') + '<span class="mono">' + esc(jb.size) + '</span></span>' +
        '<span class="grow"></span>' +
        '<span class="ig-state">' + s.html + '</span>' +
        (!ro && (s.cls === 'is-live') ? '<button class="btn btn-ghost btn-sm" data-jact="stop" data-job="' + jb.id + '">' + icon('stop') + '叫停</button>' : '') +
        (!ro && done ? '<button class="btn btn-ghost btn-sm" data-jact="dl" data-job="' + jb.id + '" title="' + (sel ? '下载选中的 ' + sel + ' 张' : '把这组出完的 ' + done + ' 张都下载') + '">' + icon('download') + (sel ? '下载选中的 ' + sel + ' 张' : '下载') + '</button>' : '') +
      '</header>' +
      '<div class="ig-grid" style="--ar:' + wh.w + '/' + wh.h + '">' + jb.items.map(function (it, i) { return cellHTML(jb, it, i, ro); }).join('') + '</div>' +
      (errs.length ? errHTML(jb, errs[0].err, ro) : '') +
    '</section>';
  }
  function cellHTML(jb, it, i, ro) {
    var inner = '', cls = 'ig-cell is-' + it.st;
    var gone = it.cleared && !it.dl;
    if (it.st === 'done') {
      if (gone) { cls += ' is-cleared'; inner = '<span class="ig-ph">' + icon('trash', 'icon-sm') + '已清理<small>临时文件被删了<br>参数还在</small></span>'; }
      else inner = '<img src="' + GEN[it.g].src + '" alt="第 ' + (i + 1) + ' 张" loading="lazy" draggable="false">';
      inner += '<span class="ig-badges">' + (it.star ? '<span class="ig-star" title="打过星：这张好">' + icon('star', 'icon-fill icon-sm') + '</span>' : '') + '</span>';
      if (it.dl) inner += '<span class="ig-dl" title="' + esc('已下载到 ' + it.dl + (it.cleared ? '\n临时文件已经清掉了，这里显示的是下载的那份' : '')) + '">' + icon('download', 'icon-sm') + '已下载</span>';
      if (it.up) inner += '<span class="ig-up mono">' + jb.size + '</span>';
      if (!ro) inner += '<span class="ig-pick' + (it._sel ? ' is-on' : '') + '" data-pick="' + i + '" role="checkbox" aria-checked="' + !!it._sel + '" title="选中，一起下载">' + icon('check', 'icon-sm') + '</span>';
    } else if (it.st === 'running') {
      var p = Math.round((it.step || 0) / jb.steps * 100);
      inner = '<span class="ig-ph"><span class="mono">' + (it.step || 0) + '/' + jb.steps + ' 步</span><small>正在出</small></span><span class="ig-bar"><i style="width:' + p + '%"></i></span>';
    } else if (it.st === 'queued') {
      inner = '<span class="ig-ph">' + (jb.waitBoot ? '<small>等开机</small>' : '<span>排第 <b class="mono">' + it.pos + '</b></span><small>ComfyUI 一次出一张</small>') + '</span>';
    } else if (it.st === 'failed') {
      inner = '<span class="ig-ph">' + icon('warn', 'icon-sm') + '失败<small>' + esc(shortErr(it.err)) + '</small></span>';
    } else if (it.st === 'stopped') {
      inner = '<span class="ig-ph">' + icon('stop', 'icon-sm') + '已叫停</span>';
    }
    var clickable = it.st === 'done' || it.st === 'failed' || it.st === 'stopped';
    return '<div class="ig-item"><div class="' + cls + '"' + (it._sel ? ' data-sel' : '') + (clickable ? ' data-cell="' + jb.id + ':' + i + '" tabindex="0" role="button" aria-label="第 ' + (i + 1) + ' 张，看大图和参数"' : '') + '>' + inner + '</div>' +
      '<span class="ig-seed mono" title="种子">' + it.seed + '</span></div>';
  }
  var ERR = {
    down: { short: '连不上', title: '连不上 ComfyUI', msg: function (jb) { return (jb.src === 'autodl' ? 'AutoDL 实例的访问地址' : COMFY.lan.url) + ' 没有响应。地址不对，或者那台电脑上 ComfyUI 没开。'; }, raw: 'connect ECONNREFUSED 192.168.1.20:8188' },
    noCkpt: { short: '底模文件不在', title: '底模文件不在', msg: function (jb) { return '这台 ComfyUI 上找不到 ' + jb.ckpt + '。可能那台机器上删了或改了名。去出图设置里换一个底模，或者在设置里重新读底模列表。'; }, raw: function (jb) { return 'Prompt outputs failed validation: CheckpointLoaderSimple (#4): Value not in list: ckpt_name: \'' + jb.ckpt + '\''; } },
    oom: { short: '显存不够', title: '显存不够', msg: function () { return 'ComfyUI 跑到 KSampler 时报了 out of memory。可以把尺寸调小、少挂几个 LoRA，或者换 AutoDL 那台（24 GB）。出完的那几张留着。'; }, raw: 'torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.50 GiB. GPU 0 has a total capacity of 15.99 GiB of which 1.12 GiB is free.' },
    missingNode: { short: '缺插件', title: '这台 ComfyUI 缺插件，没有发出去', msg: function () { return '修脸要用 FaceDetailer 和 UltralyticsDetectorProvider 两个节点，这台 ComfyUI 上没有。要装 Impact Pack 和 Impact Subpack 两个插件，再放一个人脸检测模型（比如 face_yolov8m.pt）。装好后点设置里的「重新读列表」。'; }, raw: 'object_info 里没有：FaceDetailer, UltralyticsDetectorProvider' },
    missingModel: { short: '缺模型', title: '缺 ControlNet 模型，没有发出去', msg: function () { return '姿势参考要用 openpose 的 ControlNet 模型，这台 ComfyUI 的 models/controlnet 里一个都没有。IL 推荐 Illustrious-XL ControlNet Openpose；放进去以后在设置「底模和默认值」里选上。'; }, raw: 'ControlNetLoader.control_net_name 的可选值是空的' },
    boot: { short: '开机失败', title: 'AutoDL 开机失败，这组没有发出去', msg: function (jb, e) { return e.msg; }, raw: '' },
    restart: { short: '程序重启时没出完', title: '程序重启时这张还没出完', msg: function () { return 'ComfyUI 的队列和历史里都找不到它了。参数还在，可以同样参数再来。'; }, raw: '' }
  };
  function shortErr(e) { return e && ERR[e.kind] ? ERR[e.kind].short : '出错了'; }
  function errHTML(jb, e, ro) {
    var d = ERR[e.kind] || { title: '出错了', msg: function () { return e.msg; }, raw: '' };
    var raw = e.raw || (typeof d.raw === 'function' ? d.raw(jb) : d.raw);
    return '<div class="ig-err" data-od-id="image-job-error">' + icon('warn') + '<div class="grow"><b>' + esc(d.title) + '</b><p>' + esc(d.msg(jb, e)) + '</p>' +
      (raw ? '<code class="ig-raw">' + esc(raw) + '</code>' : '') + (e.node ? '<p class="meta">出错的地方：<span class="mono">' + esc(e.node) + '</span></p>' : '') + '</div>' +
      (ro ? '' : '<div class="ig-err-acts">' + (e.kind === 'noCkpt' ? '<button class="btn btn-secondary btn-sm" data-jact="settings" data-job="' + jb.id + '">' + icon('sliders') + '换底模</button>' : '') +
        (e.kind === 'missingNode' || e.kind === 'missingModel' ? '<a class="btn btn-secondary btn-sm" href="settings.html#checkpoints">' + icon('gear') + '去设置</a>' : '') +
        (e.kind === 'boot' ? '<a class="btn btn-secondary btn-sm" href="settings.html#comfy">' + icon('gear') + '去设置</a><button class="btn btn-secondary btn-sm" data-jact="useLan" data-job="' + jb.id + '">' + icon('server') + '改用局域网那台</button>' : '') +
        (e.kind !== 'missingNode' && e.kind !== 'missingModel' ? '<button class="btn btn-secondary btn-sm" data-jact="retry" data-job="' + jb.id + '">' + icon('retry') + '再出一次</button>' : '') + '</div>') +
      '</div>';
  }

  /* ─── 出图：建一组、排队、一张张出 ─────────────────── */
  function newJob(n, b, o) {
    var im = n.image, sr = series(n);
    var count = o.count || n.count, seed0 = o.seed != null ? o.seed : (im.seedMode === 'fixed' ? im.seed : Math.floor(Math.random() * 4e9));
    var jb = { id: 'j' + (++jobSeq), at: nowHM(), ts: Date.now(), kind: o.kind || 'gen', note: o.note, src: COMFY.use, workflow: o.kind && o.kind !== 'gen' ? 'builtin' : im.workflow,
               size: o.size || n.size, steps: im.steps, cfg: im.cfg, sampler: im.sampler, scheduler: im.scheduler, ckpt: im.ckpt, loras: im.loras.slice(), rating: im.rating, extraNeg: im.extraNeg,
               seed0: seed0, scale: o.scale, denoise: o.denoise, source: o.source, ref: o.ref, live: true, items: [] };
    for (var i = 0; i < count; i++) jb.items.push({ seed: o.seeds ? o.seeds[i] : seed0 + i, st: 'queued', pos: i + 1 });
    b.jobs = b.jobs || []; b.jobs.push(jb);
    var fail = PROTO.fail;
    if ((jb.kind === 'face' && (fail === 'missingNode')) || (jb.kind === 'pose' && fail === 'missingModel')) {
      jb.live = false; jb.notSent = true;
      jb.items.forEach(function (it) { it.st = 'failed'; it.err = { kind: fail, msg: ' ' }; });
      after(n); return jb;
    }
    if (COMFY.use === 'lan' && COMFY.lan.state === 'down' || fail === 'down') {
      jb.live = false; jb.items.forEach(function (it) { it.st = 'failed'; it.err = { kind: 'down', msg: ' ' }; });
      after(n); toast('连不上 ComfyUI，这组没出成', { tone: 'danger' }); return jb;
    }
    if (fail === 'noCkpt') {
      jb.live = false; jb.items.forEach(function (it) { it.st = 'failed'; it.err = { kind: 'noCkpt', msg: ' ', node: '4 · CheckpointLoaderSimple · ckpt_name' }; });
      after(n); toast('这台 ComfyUI 上找不到底模文件，这组没出成', { tone: 'danger' }); return jb;
    }
    if (COMFY.use === 'autodl' && COMFY.autodl.state !== 'running') {
      jb.waitBoot = true;
      Comfy.boot(function (err) {
        delete jb.waitBoot;
        if (err) { jb.live = false; jb.items.forEach(function (it) { it.st = 'failed'; it.err = { kind: 'boot', msg: Comfy.errText(err) }; }); after(n); return; }
        startJob(jb); after(n);
      }, o.bootOpts);
    } else startJob(jb);
    after(n);
    return jb;
  }
  function startJob(jb) { if (jb.items[0]) { jb.items[0].st = 'running'; jb.items[0].step = 0; delete jb.items[0].pos; } jb.items.forEach(function (it, i) { if (it.st === 'queued') it.pos = i; }); }
  function nowHM() { var d = new Date(), z = function (x) { return String(x).padStart(2, '0'); }; return z(d.getHours()) + ':' + z(d.getMinutes()); }
  function pick(n, jb, it) {
    if (jb.kind === 'upscale' || jb.kind === 'face') { var h = findJob(jb.source.job); return h ? h.job.items[jb.source.i].g : 'd3'; }
    var pool = POOL[n.id] || ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'];
    return pool[(poolIdx++) % pool.length];
  }
  function after(n) {
    renderGraph();
    if (Panel.node() && Panel.node().id === n.id) Panel.rerender();
    markSaved();
  }
  function paintJob(id) {
    var el = document.querySelector('[data-job="' + id + '"].ig-job'); if (!el) return;
    var h = findJob(id); if (!h) return;
    var tmp = document.createElement('div'); tmp.innerHTML = jobHTML(h.n, h.b, h.job, false);
    el.replaceWith(tmp.firstChild);
  }
  /* 每 0.5 秒推一步；原型里一张图 28 步大约 14 秒 */
  setInterval(function () {
    var touched = {};
    eachBox(function (n, v, b) {
      (b.jobs || []).forEach(function (jb) {
        if (!jb.live || jb.waitBoot || jb.hold) return;
        var run = jb.items.filter(function (it) { return it.st === 'running'; })[0];
        if (!run) return;
        run.step = (run.step || 0) + (jb.kind === 'face' ? 3 : 2);
        if (PROTO.fail === 'oom' && doneCount(jb) >= 1 && run.step > 8) {
          jb.items.forEach(function (it) { if (it.st === 'running' || it.st === 'queued') { it.st = 'failed'; it.err = { kind: 'oom', msg: ' ' }; delete it.pos; } });
          jb.live = false; touched[n.id] = n; toast('显存不够，这组后面几张没出成', { tone: 'danger' }); return;
        }
        if (run.step >= jb.steps) {
          run.st = 'done'; run.g = pick(n, jb, run); run.ms = 14000 + Math.round(Math.random() * 3000); delete run.step;
          if (jb.kind === 'upscale' || jb.kind === 'face') run.up = true;
          var next = jb.items.filter(function (it) { return it.st === 'queued'; })[0];
          if (next) { next.st = 'running'; next.step = 0; delete next.pos; jb.items.forEach(function (it) { if (it.st === 'queued') it.pos--; }); }
          else {
            jb.live = false; touched[n.id] = n;
            if (!Panel.node() || Panel.node().id !== n.id) toast('「' + esc(n.title) + '」出完 ' + doneCount(jb) + ' 张', { action: '去看看', onAction: function () { selectNode(n.id); } });
            if (COMFY.use === 'autodl') COMFY.autodl.idleLeft = COMFY.autodl.idleMin;
          }
          touched[n.id] = n;
        }
        paintJob(jb.id);
      });
    });
    Object.keys(touched).forEach(function (k) { renderGraph(); });
    if (Object.keys(touched).length) markSaved();
  }, 500);

  /* ─── 生图按钮旁的小三角：选参考图的方式 ─────────────── */
  var popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  document.addEventListener('pointerdown', function (e) { if (popEl && !popEl.contains(e.target) && !e.target.closest('[data-act="genMenu"],[data-act="unknownTag"]')) closePop(); });
  function placePop(anchor, w) {
    document.body.appendChild(popEl);
    var r = anchor.getBoundingClientRect();
    popEl.style.left = Math.max(8, Math.min(r.right - (w || popEl.offsetWidth), innerWidth - popEl.offsetWidth - 8)) + 'px';
    var top = r.bottom + 6;
    if (top + popEl.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - popEl.offsetHeight - 6);
    popEl.style.top = top + 'px';
  }
  var REF_MODES = [
    { v: 'gen', t: '不用参考图', d: '按节点的出图设置出', s: null },
    { v: 'i2i', t: '图生图', d: '照着整张图改，强度越高改得越多', s: 0.6, need: '只用 ComfyUI 自带节点' },
    { v: 'pose', t: '姿势参考', d: '照着图里人的姿势画', s: 0.8, need: '要 comfyui_controlnet_aux 插件和 openpose 的 ControlNet 模型' },
    { v: 'style', t: '画风参考', d: '照着图的画风画', s: 0.8, need: '要 ComfyUI_IPAdapter_plus 插件、IP-Adapter 模型和 CLIP Vision 模型' }
  ];
  function openGenMenu(anchor, n, b) {
    closePop();
    var st = b._ref || { mode: 'gen', img: n.slots[0] || null, s: 0.6 };
    b._ref = st;
    popEl = document.createElement('div'); popEl.className = 'img-pop gen-pop'; popEl.setAttribute('data-od-id', 'popover-reference-mode');
    function draw() {
      var m = REF_MODES.filter(function (x) { return x.v === st.mode; })[0];
      popEl.innerHTML = '<h4>这次怎么出</h4><div class="gp-modes">' + REF_MODES.map(function (x) {
          return '<label class="gp-mode' + (x.v === st.mode ? ' is-on' : '') + '"><input type="radio" name="gpm" value="' + x.v + '"' + (x.v === st.mode ? ' checked' : '') + '><span><b>' + x.t + '</b><small>' + x.d + '</small></span></label>';
        }).join('') + '</div>' +
        (st.mode === 'gen' ? '' :
          '<h4>参考图<span class="meta">从这个节点的槽位里选</span></h4>' +
          (n.slots.length ? '<div class="gp-imgs">' + n.slots.map(function (id, i) { return '<button class="' + (id === st.img ? 'is-on' : '') + '" data-img="' + id + '" title="' + (i + 1) + ' 号：' + esc(IMAGES[id].name) + '">' + thumbHTML(id) + '<span class="num-badge">' + (i + 1) + '</span></button>'; }).join('') + '</div>'
            : '<p class="gp-none">槽位里还没有图。出的图要先「下载」进资产库，才能放进槽位。</p>') +
          '<div class="gp-strength"><span class="label">强度</span><input type="range" min="0.1" max="1" step="0.05" value="' + st.s + '" id="gpS"><output class="mono">' + st.s + '</output></div>' +
          '<p class="gp-need">' + icon('info', 'icon-sm') + m.need + '</p>') +
        '<div class="gp-foot"><span class="meta"><span class="mono">' + n.count + '</span> 张 · <span class="mono">' + esc(n.size) + '</span> · ' + srcName(COMFY.use) + '</span><span class="grow"></span>' +
        '<button class="btn btn-primary btn-sm" id="gpGo"' + (st.mode !== 'gen' && !st.img ? ' disabled' : '') + '>' + icon('sparkles') + '生图</button></div>';
    }
    draw();
    placePop(anchor, 340);
    popEl.addEventListener('change', function (e) {
      if (e.target.name === 'gpm') { st.mode = e.target.value; var m = REF_MODES.filter(function (x) { return x.v === st.mode; })[0]; if (m.s) st.s = m.s; draw(); }
    });
    popEl.addEventListener('input', function (e) { if (e.target.id === 'gpS') { st.s = +e.target.value; e.target.nextElementSibling.textContent = st.s; } });
    popEl.addEventListener('click', function (e) {
      var im = e.target.closest('[data-img]'); if (im) { st.img = im.dataset.img; draw(); return; }
      if (e.target.closest('#gpGo')) {
        closePop();
        if (st.mode === 'gen') gen(n, b, {});
        else gen(n, b, { kind: st.mode, ref: { img: st.img, strength: st.s } });
      }
    });
  }
  function gen(n, b, o) {
    var jb = newJob(n, b, o);
    if (jb.live && !jb.waitBoot) toast('开始出 ' + jb.items.length + ' 张，按顺序排进 ComfyUI 的队列');
    if (jb.waitBoot) toast('AutoDL 实例关着，先开机，开好了再出图。开机一般要一两分钟');
    return jb;
  }

  /* ─── 不认识的标签：看候选，点一个换掉 ──────────────── */
  function openUnknown(anchor, n, b, ti, k, j) {
    closePop();
    var list = Tags.parse(b.text), t = list[ti];
    var near = (TAG_NEAR[Tags.nameOf(t)] || Tags.search(t.name.split(' ')[0], 5).map(function (x) { return x.r.tag; })).slice(0, 5);
    popEl = document.createElement('div'); popEl.className = 'img-pop unk-pop'; popEl.setAttribute('data-od-id', 'popover-unknown-tag');
    popEl.innerHTML = '<h4>词库里没有「' + esc(Tags.nameOf(t)) + '」</h4>' +
      '<p class="meta" style="margin:0 2px 8px">可能是 AI 编的，也可能是有意写的（比如某个 LoRA 的触发词）。出图时照原样写进去。点下面一个就换掉，存成新版本。</p>' +
      '<div class="unk-list">' + near.map(function (k2) {
        var r = TAGDB[k2];
        return '<button data-near="' + k2 + '"><span class="unk-en">' + esc(Tags.display(k2)) + '</span><span class="unk-zh">' + esc(r.zh || '') + '</span><span class="tag">' + TAG_CAT[r.cat] + '</span><span class="mono unk-n">' + Tags.fmtCount(r.count) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="gp-foot"><span class="meta">数字是 Danbooru 上用过的次数</span><span class="grow"></span><button class="btn btn-ghost btn-sm" data-keep>保持原样</button></div>';
    placePop(anchor, 360);
    popEl.addEventListener('click', function (e) {
      var nb = e.target.closest('[data-near]');
      if (nb) {
        closePop();
        var nt = Tags.check({ raw: nb.dataset.near, name: Tags.display(nb.dataset.near), w: t.w });
        list[ti] = nt;
        Panel.saveManual(k, j, Tags.join(list), '「' + Tags.nameOf(t) + '」换成了「' + Tags.display(nb.dataset.near) + '」，存成了新版本');
      }
      if (e.target.closest('[data-keep]')) { closePop(); toast('照原样留着，出图时原样写进去'); }
    });
  }

  /* ─── 大图和参数 ─────────────────────────────────── */
  var LB = { list: [], i: 0 };
  function lbDialog() {
    var d = $('#dlgImage');
    if (d) return d;
    d = document.createElement('dialog');
    d.className = 'dialog dialog-wide ib-dialog'; d.id = 'dlgImage'; d.setAttribute('aria-label', '看大图和参数'); d.setAttribute('data-od-id', 'dialog-image-viewer');
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      if (e.target === d) { d.close(); return; }
      var b = e.target.closest('[data-ib]'); if (!b) return;
      lbAct(b.dataset.ib, b);
    });
    d.addEventListener('keydown', function (e) {
      if (e.target.closest('input')) return;
      if (e.key === 'ArrowLeft') lbGo(-1); if (e.key === 'ArrowRight') lbGo(1);
    });
    return d;
  }
  function lbOpen(jobId, i) {
    var h = findJob(jobId); if (!h) return;
    LB.list = [];
    (h.b.jobs || []).forEach(function (jb) { jb.items.forEach(function (it, ii) { if (it.st === 'done' || it.st === 'failed' || it.st === 'stopped') LB.list.push({ job: jb.id, i: ii }); }); });
    LB.i = Math.max(0, LB.list.findIndex(function (x) { return x.job === jobId && x.i === i; }));
    LB.mode = null;
    lbRender(); var d = lbDialog(); if (!d.open) d.showModal();
    var c = d.querySelector('.ib-close'); if (c) c.focus({ focusVisible: false });
  }
  function lbGo(dir) { var t = LB.i + dir; if (t < 0 || t >= LB.list.length) return; LB.i = t; LB.mode = null; lbRender(); }
  function lbCur() { var x = LB.list[LB.i], h = findJob(x.job); return { h: h, jb: h.job, it: h.job.items[x.i], i: x.i }; }
  function kv(k, v, cls) { return '<div class="ib-kv"><span class="k">' + k + '</span><span class="v' + (cls ? ' ' + cls : '') + '">' + v + '</span></div>'; }
  function lbRender() {
    var c = lbCur(), jb = c.jb, it = c.it, n = c.h.n, b = c.h.b, sr = series(n);
    var gone = it.cleared && !it.dl, isDone = it.st === 'done';
    var pos = SERIES[sr].prefix, rate = SERIES[sr].rating[jb.rating];
    var neg = SERIES[sr].neg + (jb.extraNeg ? ', ' + jb.extraNeg : '');
    var builtin = jb.workflow === 'builtin';
    var stage = isDone && !gone ? '<img src="' + GEN[it.g].src + '" alt="">' :
      '<div class="ib-ph">' + (gone ? icon('trash') + '<b>临时文件被清掉了</b><span>这张没下载过，图已经没了。参数都还在，可以「同样参数再来」出一张一样的。</span>' :
        it.st === 'failed' ? icon('warn') + '<b>这张没出成</b><span>' + esc(shortErr(it.err)) + '。参数都还在，可以再来。</span>' : icon('stop') + '<b>这张叫停了</b><span>参数都还在，可以同样参数再来。</span>') + '</div>';
    var acts = isDone ? (
      '<div class="ib-acts">' +
        '<button class="btn btn-primary btn-sm" data-ib="dl"' + (gone ? ' disabled' : '') + '>' + icon('download') + (it.dl ? '再下载一份' : '下载') + '</button>' +
        '<button class="btn btn-secondary btn-sm' + (it.star ? ' is-star' : '') + '" data-ib="star">' + icon('star', it.star ? 'icon-fill' : '') + (it.star ? '已打星' : '打星（这张好）') + '</button>' +
        '<button class="btn btn-secondary btn-sm" data-ib="reveal"' + (gone ? ' disabled' : '') + '>' + icon('reveal') + '在资源管理器里显示</button>' +
        '<button class="btn btn-danger-ghost btn-sm" data-ib="del">' + icon('trash') + '删除</button>' +
      '</div>') : '';
    var more = '<div class="ib-acts ib-acts-2">' +
        '<button class="btn btn-secondary btn-sm" data-ib="same">' + icon('retry') + '同样参数再来</button>' +
        '<button class="btn btn-secondary btn-sm" data-ib="reseed">' + icon('sparkles') + '只换种子再来</button>' +
        (isDone && !gone ? '<button class="btn btn-secondary btn-sm' + (LB.mode === 'up' ? ' is-on' : '') + '" data-ib="upForm">' + icon('upscale') + '放大</button>' +
        '<button class="btn btn-secondary btn-sm' + (LB.mode === 'face' ? ' is-on' : '') + '" data-ib="faceForm">' + icon('face') + '修脸</button>' : '') +
      '</div>' +
      (LB.mode === 'up' ? '<div class="ib-form"><div class="seg" id="ibScale"><button aria-pressed="' + (LB.scale !== 2) + '" data-ib="s15">1.5×</button><button aria-pressed="' + (LB.scale === 2) + '" data-ib="s2">2×</button></div>' +
          '<label class="ib-num">重绘幅度 <input class="input mono" id="ibDen" type="number" min="0.05" max="1" step="0.05" value="0.35"></label><span class="grow"></span><button class="btn btn-primary btn-sm" data-ib="upGo">开始放大</button>' +
          '<p class="hint">放大到 <span class="mono">' + upSize(jb.size, LB.scale === 2 ? 2 : 1.5) + '</span>，用 ' + SERIES[sr].upscale + ' 先放大，再按同样的提示词和种子补细节。重绘幅度越大补得越多，也越容易走样。</p></div>' : '') +
      (LB.mode === 'face' ? '<div class="ib-form"><label class="ib-num">重绘幅度 <input class="input mono" id="ibFden" type="number" min="0.05" max="1" step="0.05" value="0.4"></label><span class="grow"></span><button class="btn btn-primary btn-sm" data-ib="faceGo">开始修脸</button>' +
          '<p class="hint">找到脸，按同样的底模、提示词和种子把脸重画清楚。要 ComfyUI 上装 Impact Pack 和 Impact Subpack。</p></div>' : '');
    var d = lbDialog();
    d.innerHTML =
      '<div class="ib-body">' +
        '<div class="ib-stage">' + stage +
          '<button class="ib-nav is-prev" data-ib="prev" aria-label="上一张"' + (LB.i === 0 ? ' disabled' : '') + '>' + icon('chev-left') + '</button>' +
          '<button class="ib-nav is-next" data-ib="next" aria-label="下一张"' + (LB.i === LB.list.length - 1 ? ' disabled' : '') + '>' + icon('chev-right') + '</button>' +
          '<span class="ib-count mono">' + (LB.i + 1) + ' / ' + LB.list.length + '</span>' +
        '</div>' +
        '<aside class="ib-side">' +
          '<div class="ib-top"><div class="stack grow" style="gap:2px;min-width:0"><span class="meta">' + esc(n.title) + ' · ' + esc(b.label || '提示词') + ' · ' + esc(kindLabel(jb)) + '</span>' +
            '<h2 class="ib-title"><span class="meta">种子</span> <span class="mono">' + it.seed + '</span></h2>' +
            '<div class="row" style="flex-wrap:wrap;gap:4px">' + (it.star ? '<span class="tag tag-star">' + icon('star', 'icon-fill') + '打过星</span>' : '') +
              (it.dl ? '<span class="tag tag-ok" title="' + esc(it.dl) + '">' + icon('download') + '已下载</span>' : '') + (it.cleared ? '<span class="tag tag-warn">临时文件已清理' + (it.dl ? '，显示的是下载的那份' : '') + '</span>' : '') +
              (jb.source ? '<span class="tag">' + esc(sourceText(jb)) + '</span>' : '') + '</div></div>' +
            '<button class="btn btn-ghost btn-icon ib-close" data-ib="close" aria-label="关闭">' + icon('x') + '</button></div>' +
          acts + more +
          '<div class="ib-params" data-od-id="image-params">' +
            '<div class="ib-prompt"><span class="k">正面提示词</span><p class="mono"><span class="ib-fixed" title="程序按 ' + sr + ' 系列自动加的固定开头">' + esc(pos) + ', </span>' + (jb.rating !== '不加' && rate ? '<span class="ib-fixed" title="评级词：' + jb.rating + '">' + rate + ', </span>' : '') + esc(Tags.join(Tags.parse(b.text))) + '</p></div>' +
            '<div class="ib-prompt"><span class="k">负面词</span><p class="mono"><span class="ib-fixed" title="' + sr + ' 系列默认负面词">' + esc(SERIES[sr].neg) + '</span>' + (jb.extraNeg ? ', ' + esc(jb.extraNeg) : '') + '</p></div>' +
            kv('尺寸', '<span class="mono">' + esc(it.up ? jb.size : jb.size) + '</span>') +
            (builtin ? kv('底模', '<span class="mono">' + esc(shortCkpt(jb.ckpt)) + '</span> <span class="tag">' + sr + '</span>') +
              kv('LoRA', jb.loras.length ? jb.loras.map(function (l) { return '<span class="mono">' + esc(l[0].replace(/\.safetensors$/, '')) + '</span> <span class="meta mono">' + l[1] + '</span>'; }).join('<br>') : '<span class="meta">没挂</span>') +
              kv('步数 · CFG', '<span class="mono">' + jb.steps + ' · ' + jb.cfg + '</span>') +
              kv('采样器 · 调度器', '<span class="mono">' + jb.sampler + ' · ' + jb.scheduler + '</span>') +
              kv('clip skip', '<span class="mono">' + SERIES[sr].clip + '</span>') : kv('底模、LoRA、步数', '<span class="meta">按工作流里原来的</span>')) +
            (jb.kind === 'upscale' || jb.kind === 'face' ? kv('重绘幅度', '<span class="mono">' + jb.denoise + '</span>') : '') +
            (jb.ref ? kv(kindLabel(jb), (IMAGES[jb.ref.img] ? esc(IMAGES[jb.ref.img].name) : '') + ' · 强度 <span class="mono">' + jb.ref.strength + '</span>') : '') +
            kv('工作流', builtin ? '内置基础流程' : '导入的「' + esc(wfName(jb.workflow)) + '」') +
            kv('ComfyUI', srcName(jb.src) + (jb.src === 'lan' ? ' <span class="meta mono">' + esc(COMFY.lan.url.replace('http://', '')) + '</span>' : ' <span class="meta">' + esc(COMFY.autodl.instance) + '</span>')) +
            kv('用时', it.ms ? '<span class="mono">' + secs(it.ms) + '</span>' : '<span class="meta">—</span>') +
            kv('出图时间', '<span class="mono">' + esc(jb.at) + '</span>') +
            (isDone ? kv('文件', '<span class="mono ib-path">' + esc(it.cleared ? (it.dl || '已清理') : IMAGE_TEMP + '\\2026-10-03\\' + jb.at.replace(':', '') + '00-' + it.seed + '.png') + '</span>') : '') +
          '</div>' +
          '<div class="ib-foot"><button class="btn btn-ghost btn-sm" data-ib="copyPos">' + icon('copy') + '复制正面提示词</button><button class="btn btn-ghost btn-sm" data-ib="copySeed">' + icon('copy') + '复制种子</button></div>' +
        '</aside>' +
      '</div>';
  }
  function upSize(s, k) { var w = sizeWH(s); return Math.round(w.w * k) + '×' + Math.round(w.h * k); }
  function lbAct(a, btn) {
    var c = lbCur(), jb = c.jb, it = c.it, h = c.h, d = lbDialog();
    switch (a) {
      case 'close': d.close(); break;
      case 'prev': lbGo(-1); break;
      case 'next': lbGo(1); break;
      case 'star': it.star = !it.star; lbRender(); after(h.n); toast(it.star ? '这张打了星。框下面和首页列图时排在前面' : '取消了这张的星'); break;
      case 'dl': Download.open([{ jb: jb, it: it, n: h.n }], function () { lbRender(); after(h.n); }); break;
      case 'reveal': toast('已在资源管理器里显示 ' + (it.cleared ? it.dl : IMAGE_TEMP + '\\2026-10-03\\…-' + it.seed + '.png')); break;
      case 'del':
        confirmBox({ title: '删掉这张图？', body: '临时文件夹里的文件直接删掉，不进回收站。' + (it.dl ? '下载过的那份（' + esc(it.dl) + '）不动。' : '这张没下载过，删了就找不回来，但同组别的图不受影响。'), ok: '删除', danger: true,
          onOk: function () { jb.items.splice(c.i, 1); if (!jb.items.length) h.b.jobs.splice(h.b.jobs.indexOf(jb), 1); d.close(); after(h.n); toast('删掉了'); } });
        break;
      case 'same': d.close(); gen(h.n, h.b, { count: 1, seeds: [it.seed], seed: it.seed, note: '同样参数再来 · 种子 ' + it.seed, size: jb.kind === 'gen' ? jb.size : undefined }); break;
      case 'reseed': d.close(); gen(h.n, h.b, { note: '只换种子再来 · 来自 ' + jb.at + ' 那组第 ' + (c.i + 1) + ' 张' }); break;
      case 'upForm': LB.mode = LB.mode === 'up' ? null : 'up'; LB.scale = LB.scale || 2; lbRender(); break;
      case 'faceForm': LB.mode = LB.mode === 'face' ? null : 'face'; lbRender(); break;
      case 's15': LB.scale = 1.5; lbRender(); break;
      case 's2': LB.scale = 2; lbRender(); break;
      case 'upGo': { var den = +$('#ibDen').value || 0.35; d.close(); gen(h.n, h.b, { kind: 'upscale', count: 1, seeds: [it.seed], seed: it.seed, scale: LB.scale || 2, denoise: den, size: upSize(jb.size, LB.scale || 2), source: { job: jb.id, i: c.i } }); break; }
      case 'faceGo': { var fd = +$('#ibFden').value || 0.4; d.close(); gen(h.n, h.b, { kind: 'face', count: 1, seeds: [it.seed], seed: it.seed, denoise: fd, size: jb.size, source: { job: jb.id, i: c.i } }); break; }
      case 'copyPos': { var sr = series(h.n); copyText(SERIES[sr].prefix + ', ' + Tags.join(Tags.parse(h.b.text)), '已复制正面提示词（含固定开头）'); break; }
      case 'copySeed': copyText(String(it.seed), '已复制种子 ' + it.seed); break;
    }
  }

  /* ─── 下载：选文件夹（记住上次），复制过去 ─────────── */
  var Download = (function () {
    function open(list, done) {
      var folder = LAST_DOWNLOAD, inLib = true;
      var dd = document.createElement('dialog'); dd.className = 'dialog'; dd.style.width = 'min(520px, calc(100vw - 32px))'; dd.setAttribute('data-od-id', 'dialog-download');
      function draw() {
        dd.innerHTML = '<div class="dialog-head"><div class="stack" style="gap:2px"><h2>下载 ' + list.length + ' 张图</h2><span class="meta">从临时文件夹复制一份过去，下载过的才能放进视频节点的槽位</span></div></div>' +
          '<div class="dialog-body"><div class="field"><span class="label">存到</span><div class="dl-folder"><span class="mono">' + esc(folder) + '</span>' +
          (inLib ? '<span class="tag tag-ok">' + icon('check') + '在资产库里</span>' : '<span class="tag tag-warn">不在资产库里</span>') + '<span class="grow"></span><button class="btn btn-secondary btn-sm" data-dl="pick">' + icon('folder') + '换个文件夹…</button></div>' +
          (inLib ? '<p class="hint">上次存的就是这里。</p>' : '<label class="switch" style="margin-top:6px"><input type="checkbox" id="dlImport" checked><span class="track"></span>顺便把这个文件夹导入资产库</label><p class="hint">不导入也能存，只是视频节点选图时在资产库里看不到它们。</p>') + '</div>' +
          '<div class="dl-names">' + list.map(function (x) { return '<div class="mono">' + esc(x.n.title) + '-' + x.it.seed + '.png</div>'; }).join('') + '</div></div>' +
          '<div class="dialog-foot"><button class="btn btn-secondary" data-dl="cancel">取消</button><button class="btn btn-primary" data-dl="ok">' + icon('download') + '下载</button></div>';
      }
      draw(); document.body.appendChild(dd); hydrateIcons(dd); dd.showModal();
      dd.addEventListener('click', function (e) {
        var b = e.target.closest('[data-dl]'); if (!b) return;
        if (b.dataset.dl === 'pick') { folder = 'D:\\下载\\生图挑出来的'; inLib = false; draw(); toast('会打开系统的「选择文件夹」窗口，原型里假装选了 ' + folder); }
        if (b.dataset.dl === 'cancel') dd.close();
        if (b.dataset.dl === 'ok') {
          list.forEach(function (x) { x.it.dl = folder + '\\' + x.n.title + '-' + x.it.seed + '.png'; delete x.it._sel; });
          var imp = !inLib && dd.querySelector('#dlImport') && dd.querySelector('#dlImport').checked;
          dd.close(); done && done();
          toast('下载了 ' + list.length + ' 张到 ' + esc(folder) + (imp ? '，这个文件夹也导入资产库了' : ''), { ms: 4000 });
        }
      });
      dd.addEventListener('close', function () { dd.remove(); });
    }
    return { open: open };
  })();

  /* ─── 面板上点到生图相关的东西 ─────────────────────── */
  function act(a, ctx) {
    var n = ctx.n, b = ctx.box;
    switch (a) {
      case 'gen': gen(n, b, {}); break;
      case 'genMenu': openGenMenu(ctx.el, n, b); break;
      case 'editTags': TagEditor.open(n, b, ctx.k, ctx.j); break;
      case 'unknownTag': openUnknown(ctx.el, n, b, +ctx.el.dataset.ti, ctx.k, ctx.j); break;
      case 'allJobs': b._allJobs = true; Panel.rerender(); break;
    }
  }
  function onThreadClick(e) {
    var pickEl = e.target.closest('[data-pick]');
    if (pickEl) {
      e.stopPropagation();
      var cellJob = pickEl.closest('[data-job]').dataset.job, h = findJob(cellJob), it = h.job.items[+pickEl.dataset.pick];
      it._sel = !it._sel; paintJob(cellJob); return true;
    }
    var cell = e.target.closest('[data-cell]');
    if (cell) { var p = cell.dataset.cell.split(':'); lbOpen(p[0], +p[1]); return true; }
    var ja = e.target.closest('[data-jact]');
    if (ja) {
      var hh = findJob(ja.dataset.job), jb = hh.job;
      if (ja.dataset.jact === 'stop') {
        jb.items.forEach(function (it) { if (it.st === 'running' || it.st === 'queued') { it.st = 'stopped'; delete it.pos; delete it.step; } });
        jb.live = false; delete jb.waitBoot; after(hh.n); toast('叫停了。出完的 ' + doneCount(jb) + ' 张留着；正在出的那张也让 ComfyUI 停了');
      }
      if (ja.dataset.jact === 'dl') {
        var sel = jb.items.filter(function (it) { return it._sel && it.st === 'done'; });
        if (!sel.length) sel = jb.items.filter(function (it) { return it.st === 'done' && !(it.cleared && !it.dl); });
        Download.open(sel.map(function (it) { return { jb: jb, it: it, n: hh.n }; }), function () { after(hh.n); });
      }
      if (ja.dataset.jact === 'retry') { PROTO.fail = null; if (COMFY.lan.state === 'down') COMFY.lan.state = 'ok'; Comfy.render(); gen(hh.n, hh.b, { seeds: jb.items.map(function (x) { return x.seed; }), seed: jb.seed0, count: jb.items.length, kind: jb.kind, ref: jb.ref, note: jb.note }); }
      if (ja.dataset.jact === 'settings') GenCfg.open(hh.n);
      if (ja.dataset.jact === 'useLan') { COMFY.use = 'lan'; COMFY.autodl.state = 'off'; Comfy.render(); gen(hh.n, hh.b, { seeds: jb.items.map(function (x) { return x.seed; }), seed: jb.seed0, count: jb.items.length }); }
      return true;
    }
    return false;
  }
  document.addEventListener('keydown', function (e) {
    var c = e.target.closest && e.target.closest('[data-cell]');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); c.click(); }
  });

  /* ─── 画布上的节点卡片（生图） ─────────────────────── */
  function cardParts(n) {
    var imgs = latestImages(n, 5), live = liveJobs(n), last = lastJob(n);
    var thumbs = imgs.length ? imgs.map(function (x) {
      var gone = x.it.cleared && !x.it.dl;
      return '<div class="gn-slot gn-gen' + (gone ? ' is-cleared' : '') + '">' + (gone ? '' : '<img class="im" src="' + GEN[x.it.g].src + '" alt="" loading="lazy" draggable="false">') + (x.it.star ? '<span class="gn-gstar">' + icon('star', 'icon-fill') + '</span>' : '') + '</div>';
    }).join('') : null;
    var tags = '<span class="tag tag-outline gn-kind">' + icon('sparkles') + '生图 · ' + series(n) + '</span>';
    if (live.length) {
      var tot = 0, dn = 0; live.forEach(function (jb) { tot += jb.items.length; dn += doneCount(jb); });
      tags += '<span class="tag tag-accent"><span class="dot dot-live"></span>' + (live.some(function (x) { return x.waitBoot; }) ? '等开机' : '出图 ' + dn + '/' + tot) + '</span>';
    } else if (last && last.items.every(function (it) { return it.st === 'failed'; })) tags += '<span class="tag tag-danger">' + icon('warn') + '出图失败</span>';
    return { thumbs: thumbs, tags: tags, foot: esc(n.size) + ' · ' + series(n) };
  }

  /* ─── 槽位区右边：尺寸、张数、出图设置 ─────────────── */
  function renderDock(n) {
    var on = isImageNode(n);
    $('#vidParams').hidden = on; $('#imgParams').hidden = !on;
    $('.dr-dock').classList.toggle('is-image', on);
    [['#slotAssets', '从资产库放图进槽位'], ['#slotLocal', '从电脑里直接选图'], ['#slotCollage', '几张图拼成一张宫格图']].forEach(function (x) { $(x[0]).title = x[1]; });
    if (!on) return;
    $('#imgSize').innerHTML = ['正方形', '竖', '横'].map(function (k) {
      return '<optgroup label="' + k + '">' + SIZES.filter(function (s) { return s.k === k; }).map(function (s) { return '<option' + (s.v === n.size ? ' selected' : '') + '>' + s.v + '</option>'; }).join('') + '</optgroup>';
    }).join('');
    $('#imgCount').textContent = n.count + ' 张';
    $('#cntDown').disabled = n.count <= 1; $('#cntUp').disabled = n.count >= 8;
    var im = n.image, wf = im.workflow !== 'builtin';
    $('#btnGenCfg').innerHTML = icon('sliders') + '出图设置<span class="lbl">' + (wf ? '工作流「' + esc(wfName(im.workflow)) + '」' : esc(shortCkpt(im.ckpt)) + (im.loras.length ? ' + ' + im.loras.length + ' 个 LoRA' : '')) + '</span>';
    $('#btnGenCfg').title = '出图设置：用哪台 ComfyUI、工作流、底模、LoRA、种子……每个节点各存一份';
  }

  return {
    PROTO: PROTO, thinkHTML: thinkHTML, thinkLevel: thinkLevel, boxHTML: boxHTML, act: act, onThreadClick: onThreadClick,
    cardParts: cardParts, renderDock: renderDock, findJob: findJob, eachBox: eachBox, gen: gen, newJob: newJob, lbOpen: lbOpen,
    latestImages: latestImages, doneCount: doneCount, paintJob: paintJob, after: after, closePop: closePop, Download: Download, kindLabel: kindLabel
  };
})();
