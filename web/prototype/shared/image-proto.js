/* 画布 · 原型切换框（只在原型里有）：切到需求 4.12 列的各种等待和出错状态 */
(function () {
  var sel = $('#proto'); if (!sel) return;
  var SNAP = JSON.stringify({ comfy: COMFY, lib: TAGLIB });
  var N9 = function () { return nodeById('n9'); }, N10 = function () { return nodeById('n10'); };
  function box(n, j) { var p = THREADS[n.id][1]; return p.versions[p.cur].boxes[j]; }
  function reset() {
    var s = JSON.parse(SNAP);
    Object.assign(COMFY.lan, s.comfy.lan); Object.assign(COMFY.autodl, s.comfy.autodl); COMFY.use = s.comfy.use;
    Object.assign(TAGLIB, s.lib); ImgUI.PROTO.fail = null;
    $$('dialog[open]').forEach(function (d) { d.close(); });
    ImgUI.closePop(); Comfy.close();
    Comfy.render();
  }
  function open(n) { selectNode(n.id); }
  function scrollToBox(j) {
    setTimeout(function () {
      var el = $$('#thread .pbox')[j]; var th = $('#thread');
      if (el) th.scrollTop = Math.max(0, el.offsetTop - 60);
    }, 80);
  }
  /* 在方向三下面造一组正在出的图 */
  function genOn(n, j, o) { var b = box(n, j); var jb = ImgUI.newJob(n, b, o || {}); scrollToBox(j); return jb; }
  var STATES = {
    normal: function () { open(N9()); },
    thinking: function () { open(N9()); Panel.sendText('方向三的头发再长一点，裙子换成百褶裙', { thinkHold: true }); },
    thinkDone: function () { open(N9()); setTimeout(function () { var t = $('#thread details.think'); if (t) { t.open = true; $('#thread').scrollTop = 0; } }, 60); },
    unknown: function () { open(N9()); setTimeout(function () { var u = $('#thread .tg.is-unknown'); if (u) { $('#thread').scrollTop = Math.max(0, u.closest('.pbox').offsetTop - 60); setTimeout(function () { u.click(); }, 60); } }, 80); },
    toTags: function () { open(N9()); TagEditor.open(N9(), box(N9(), 0), 1, 0); setTimeout(function () { TagEditor.protoState('toTags'); }, 50); },
    interrogate: function () { open(N9()); TagEditor.open(N9(), box(N9(), 0), 1, 0); setTimeout(function () { TagEditor.protoState('interrogate'); }, 50); },
    libUpdating: function () { TAGLIB.state = 'updating'; open(N9()); TagEditor.open(N9(), box(N9(), 0), 1, 0); setTimeout(function () { TagEditor.protoState('libUpdating'); }, 50); },
    running: function () { open(N9()); genOn(N9(), 2); },
    stopped: function () {
      open(N9());
      var b = box(N9(), 2), jb = ImgUI.newJob(N9(), b, {});
      jb.items.forEach(function (it, i) { if (i < 2) { it.st = 'done'; it.g = ['d7', 'd1'][i]; it.ms = 21000; } else it.st = 'stopped'; delete it.pos; delete it.step; });
      jb.live = false; ImgUI.after(N9()); scrollToBox(2);
    },
    cleared: function () {
      var b = box(N9(), 0); b.jobs[0].items[0].cleared = true; b.jobs[0].items[2].cleared = true; b.jobs[1].items[1].cleared = true;
      open(N9()); scrollToBox(0); toast('第 1 组第 1 张、第 2 组第 2 张没下载过，显示「已清理」；第 1 组第 3 张下载过，改显示下载的那份');
    },
    lightbox: function () { open(N9()); ImgUI.lbOpen('j1', 2); },
    booting: function () { COMFY.use = 'autodl'; open(N9()); genOn(N9(), 2, { bootOpts: { hold: true, ago: 45 } }); },
    bootToken: function () { COMFY.use = 'autodl'; open(N9()); genOn(N9(), 2, { bootOpts: { fail: 'token', ms: 1200 } }); },
    bootBalance: function () { COMFY.use = 'autodl'; open(N9()); genOn(N9(), 2, { bootOpts: { fail: 'balance', ms: 1200 } }); },
    bootTimeout: function () { COMFY.use = 'autodl'; open(N9()); genOn(N9(), 2, { bootOpts: { fail: 'timeout', ms: 1200, ago: 300 } }); },
    autodlRunning: function () { COMFY.use = 'autodl'; Object.assign(COMFY.autodl, { state: 'running', idleLeft: 12, upMin: 23, byApp: true }); Comfy.render(); open(N9()); setTimeout(function () { Comfy.open($('.cf-pill')); }, 120); },
    autodlForgot: function () { Object.assign(COMFY.autodl, { state: 'running', idleLeft: 9, upMin: 41, byApp: true }); Comfy.render(); open(N9()); },
    down: function () { COMFY.lan.state = 'down'; Comfy.render(); open(N9()); genOn(N9(), 2); },
    noCkpt: function () { open(N10()); setTimeout(function () { var e = $('#thread .ig-err'); if (e) $('#thread').scrollTop = Math.max(0, e.closest('.ig-job').offsetTop - 80); }, 80); },
    oom: function () { ImgUI.PROTO.fail = 'oom'; open(N9()); genOn(N9(), 2); },
    missingNode: function () { ImgUI.PROTO.fail = 'missingNode'; open(N9()); var b = box(N9(), 0); ImgUI.newJob(N9(), b, { kind: 'face', count: 1, seeds: [907715343], seed: 907715343, denoise: 0.4, source: { job: 'j2', i: 1 } }); scrollToBox(0); setTimeout(function () { var e = $$('#thread .ig-err').pop(); if (e) $('#thread').scrollTop = Math.max(0, e.offsetTop - 300); }, 120); },
    missingModel: function () { ImgUI.PROTO.fail = 'missingModel'; open(N10()); var p = THREADS.n10[1], b = p.versions[p.cur].boxes[0]; ImgUI.newJob(N10(), b, { kind: 'pose', ref: { img: 'g3', strength: 0.8 } }); setTimeout(function () { var e = $$('#thread .ig-err').pop(); if (e) $('#thread').scrollTop = Math.max(0, e.offsetTop - 300); }, 120); },
    video: function () { open(nodeById('n2')); }
  };
  /* 每次切换都重新打开页面，从干净的示例数据开始 */
  sel.addEventListener('change', function () {
    var v = sel.value;
    if (/^settings:/.test(v)) { location.href = v.slice(9); return; }
    location.href = 'canvas.html?proto=' + v;
  });
  var m = location.search.match(/proto=(\w+)/);
  if (m && STATES[m[1]]) {
    sel.value = m[1];
    setTimeout(function () { reset(); STATES[m[1]](); }, 30);
  }
})();
