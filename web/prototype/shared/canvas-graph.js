/* 画布工作台 · 节点图：渲染、拖动、平移缩放、折叠、自动排整齐、撤销 */

var NODE_W = 264;
var THREADS = {};
CANVAS.nodes.forEach(function (n) { THREADS[n.id] = n.thread || []; delete n.thread; });

var G = {
  nodes: CANVAS.nodes,
  sel: null,
  view: { x: 80, y: 180, z: 1 },
  undo: [], redo: []
};

/* ─── helpers ──────────────────────────────────────────── */
function nodeById(id) { for (var i = 0; i < G.nodes.length; i++) if (G.nodes[i].id === id) return G.nodes[i]; return null; }
function childrenOf(id) { return G.nodes.filter(function (n) { return n.parent === id; }).sort(function (a, b) { return a.y - b.y; }); }
function descendants(id) {
  var out = [];
  childrenOf(id).forEach(function (c) { out.push(c); out = out.concat(descendants(c.id)); });
  return out;
}
function isHidden(n) {
  var p = n.parent ? nodeById(n.parent) : null;
  while (p) { if (p.collapsed) return true; p = p.parent ? nodeById(p.parent) : null; }
  return false;
}
function thumbHTML(id, cls) {
  var im = IMAGES[id];
  if (!im) return '';
  if (im.collage) {
    var c = im.collage;
    return '<div class="collage-thumb ' + (cls || '') + '" style="grid-template-columns:repeat(' + c.cols + ',1fr);grid-template-rows:repeat(' + c.rows + ',1fr)">' +
      c.cells.map(function (cid) { return cid && IMAGES[cid] ? '<img src="' + IMAGES[cid].src + '" alt="" loading="lazy" draggable="false">' : '<span></span>'; }).join('') + '</div>';
  }
  if (!im.src) return '';
  return '<img class="im ' + (cls || '') + '" src="' + im.src + '" alt="' + esc(im.name) + '" loading="lazy" draggable="false">';
}

/* 把一串位置按「当前版本」展开成实际显示的对话 */
function flattenThread(positions) {
  var out = [];
  for (var i = 0; i < positions.length; i++) {
    var p = positions[i];
    out.push(p);
    var v = p.versions[p.cur];
    if (v.rest) return out.concat(flattenThread(v.rest));
  }
  return out;
}
/* fork 时把前面的对话复制一份，之后父节点再怎么改都不影响它 */
var COPIED = {};
function copyThread(src, count) { return JSON.parse(JSON.stringify(fullThread(src).slice(0, count))); }
function fullThread(n) { return (COPIED[n.id] || []).concat(flattenThread(THREADS[n.id])); }
G.nodes.forEach(function (n) { if (n.forkFrom) COPIED[n.id] = copyThread(nodeById(n.forkFrom.node), n.forkFrom.count); });
function lastAIVersion(n) {
  var t = fullThread(n);
  for (var i = t.length - 1; i >= 0; i--) {
    if (t[i].role !== 'ai') continue;
    var v = t[i].versions[t[i].cur];
    if (!v.failed) return v;
  }
  return null;
}
function nodeState(n) {
  var own = flattenThread(THREADS[n.id]);
  var last = own[own.length - 1];
  var lv = last && last.role === 'ai' ? last.versions[last.cur] : null;
  var starred = THREADS[n.id].some(function hasStar(p) {
    return p.versions.some(function (v) {
      return (v.boxes || []).some(function (b) { return b.starred; }) || (v.rest || []).some(hasStar);
    });
  });
  var ai = lastAIVersion(n);
  return {
    streaming: !!(lv && lv.streaming),
    failed: !!(lv && lv.failed),
    starred: starred,
    dirs: ai && ai.boxes ? ai.boxes.length : 0
  };
}

/* ─── render ───────────────────────────────────────────── */
var elWorld = $('#world'), elNodes = $('#nodes'), elEdges = $('#edges'), elViewport = $('#viewport');

function nodeCard(n) {
  var st = nodeState(n);
  var shown = n.slots.slice(0, 5);
  var slots = shown.map(function (id, i) {
    return '<div class="gn-slot">' + thumbHTML(id) + '<span class="num-badge">' + (i + 1) + '</span></div>';
  }).join('');
  if (n.slots.length > 5) slots += '<div class="gn-slot gn-slot-more">+' + (n.slots.length - 5) + '</div>';
  if (!n.slots.length) slots = '<span class="gn-noimg">没有参考图</span>';
  var hiddenCount = n.collapsed ? descendants(n.id).length : 0;
  var tags = '', foot = n.duration + '秒 · ' + n.ratio;
  /* 生图节点：出过图的显示最近出的图；时长比例那行换成尺寸和系列 */
  var ip = isImageNode(n) ? ImgUI.cardParts(n) : null;
  if (ip) { if (ip.thumbs) slots = ip.thumbs; tags += ip.tags; foot = ip.foot; }
  if (st.streaming) tags += '<span class="tag tag-accent"><span class="dot dot-live"></span>生成中</span>';
  if (st.failed) tags += '<span class="tag tag-danger">' + icon('warn') + '请求失败</span>';
  if (st.dirs) tags += '<span class="tag">' + st.dirs + ' 个方向</span>';
  return '' +
    '<div class="gn-top">' +
      '<div class="gn-title">' + esc(n.title) + '</div>' +
      (st.starred ? '<span class="gn-star" title="有打星的版本">' + icon('star', 'icon-fill') + '</span>' : '') +
      '<button class="btn btn-ghost btn-icon btn-sm gn-menu" data-act="menu" aria-label="节点操作">' + icon('more') + '</button>' +
    '</div>' +
    '<div class="gn-sum">' + esc(n.summary || '还没有提示词') + '</div>' +
    '<div class="gn-slots' + (ip && ip.thumbs ? ' is-gen' : '') + '">' + slots + '</div>' +
    '<div class="gn-foot">' + tags + '<span class="grow"></span><span class="meta">' + foot + '</span></div>' +
    (hiddenCount ? '<button class="gn-collapsed" data-act="expand" title="展开">' + icon('chev-right', 'icon-sm') + '收起了 ' + hiddenCount + ' 个节点</button>' : '');
}

function renderGraph() {
  var existing = {};
  $$('.gnode', elNodes).forEach(function (el) { existing[el.dataset.id] = el; });
  G.nodes.forEach(function (n) {
    var el = existing[n.id];
    delete existing[n.id];
    if (isHidden(n)) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'gnode';
      el.dataset.id = n.id;
      el.setAttribute('data-od-id', 'graph-node-' + n.id);
      el.tabIndex = 0;
      if (n._new) { el.classList.add('is-new'); delete n._new; }
      elNodes.appendChild(el);
    }
    el.innerHTML = nodeCard(n);
    el.classList.toggle('is-selected', G.sel === n.id);
    el.style.transform = 'translate(' + n.x + 'px,' + n.y + 'px)';
  });
  Object.keys(existing).forEach(function (k) { existing[k].remove(); });
  renderEdges();
  updateUndoButtons();
}
function renderEdges() {
  var off = 4000, html = '';
  G.nodes.forEach(function (n) {
    if (!n.parent || isHidden(n)) return;
    var p = nodeById(n.parent);
    if (!p) return;
    var pe = elNodes.querySelector('[data-id="' + p.id + '"]'), ce = elNodes.querySelector('[data-id="' + n.id + '"]');
    var ph = pe ? pe.offsetHeight : 170, ch = ce ? ce.offsetHeight : 170;
    var x1 = p.x + NODE_W + off, y1 = p.y + ph / 2 + off, x2 = n.x + off, y2 = n.y + ch / 2 + off;
    var dx = Math.max(40, (x2 - x1) / 2);
    var active = G.sel === n.id || G.sel === p.id;
    html += '<path class="' + (active ? 'is-active' : '') + '" d="M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2 + '"/>';
  });
  elEdges.innerHTML = html;
}

/* ─── view: pan & zoom ─────────────────────────────────── */
function applyView() {
  elWorld.style.transform = 'translate(' + G.view.x + 'px,' + G.view.y + 'px) scale(' + G.view.z + ')';
  $('#zoomVal').textContent = Math.round(G.view.z * 100) + '%';
}
function zoomAt(factor, cx, cy) {
  var z = Math.min(2, Math.max(0.3, G.view.z * factor));
  var k = z / G.view.z;
  G.view.x = cx - (cx - G.view.x) * k;
  G.view.y = cy - (cy - G.view.y) * k;
  G.view.z = z;
  applyView();
}
function usableWidth() {
  var open = document.body.classList.contains('drawer-open');
  if (!open || innerWidth <= 1180) return innerWidth;
  return innerWidth - $('#drawer').offsetWidth;
}
/* minZ：打开页面时不缩到字看不清，放不下就以选中的节点为准 */
function fitAll(minZ) {
  var vis = G.nodes.filter(function (n) { return !isHidden(n); });
  if (!vis.length) return;
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  vis.forEach(function (n) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W + (n.collapsed ? 150 : 0)); maxY = Math.max(maxY, n.y + 190);
  });
  var w = usableWidth() - 80, h = innerHeight - 150;
  var z = Math.min(1.1, Math.max(minZ || 0.3, Math.min(w / (maxX - minX), h / (maxY - minY))));
  G.view.z = z;
  // 放得下就居中；放不下就从左上角开始排，保证根节点在视野里
  G.view.x = 40 + Math.max(0, (w - (maxX - minX) * z) / 2) - minX * z;
  G.view.y = 80 + Math.max(0, (h - (maxY - minY) * z) / 2) - minY * z;
  animateView();
}
function animateView() {
  elWorld.style.transition = 'transform .35s var(--ease)';
  applyView();
  setTimeout(function () { elWorld.style.transition = ''; }, 380);
}
function ensureVisible(n) {
  var sx = n.x * G.view.z + G.view.x, sy = n.y * G.view.z + G.view.y;
  var w = NODE_W * G.view.z, right = usableWidth();
  if (innerWidth <= 720) return;
  var moved = false;
  if (sx + w > right - 24) { G.view.x -= (sx + w) - (right - 48); moved = true; }
  if (sx < 24) { G.view.x += 48 - sx; moved = true; }
  if (sy < 70) { G.view.y += 90 - sy; moved = true; }
  if (sy + 180 * G.view.z > innerHeight - 60) { G.view.y -= (sy + 180 * G.view.z) - (innerHeight - 80); moved = true; }
  if (moved) animateView();
}

var pointers = {}, pinchStart = null, pan = null, drag = null;
elViewport.addEventListener('pointerdown', function (e) {
  pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var ids = Object.keys(pointers);
  if (ids.length === 2) {
    var a = pointers[ids[0]], b = pointers[ids[1]];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), z: G.view.z };
    pan = null; drag = null;
    return;
  }
  var nodeEl = e.target.closest('.gnode');
  if (nodeEl) {
    if (e.target.closest('button')) return;
    var n = nodeById(nodeEl.dataset.id);
    drag = { n: n, el: nodeEl, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false, snap: snapshot() };
    nodeEl.setPointerCapture(e.pointerId);
    return;
  }
  pan = { sx: e.clientX, sy: e.clientY, ox: G.view.x, oy: G.view.y, moved: false };
  elViewport.setPointerCapture(e.pointerId);
});
elViewport.addEventListener('pointermove', function (e) {
  if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var ids = Object.keys(pointers);
  if (pinchStart && ids.length === 2) {
    var a = pointers[ids[0]], b = pointers[ids[1]];
    var d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((pinchStart.z * d / pinchStart.d) / G.view.z, (a.x + b.x) / 2, (a.y + b.y) / 2);
    return;
  }
  if (drag) {
    var dx = (e.clientX - drag.sx) / G.view.z, dy = (e.clientY - drag.sy) / G.view.z;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.el.classList.add('is-dragging');
    drag.n.x = Math.round(drag.ox + dx); drag.n.y = Math.round(drag.oy + dy);
    drag.el.style.transform = 'translate(' + drag.n.x + 'px,' + drag.n.y + 'px)';
    renderEdges();
  } else if (pan) {
    var mx = e.clientX - pan.sx, my = e.clientY - pan.sy;
    if (!pan.moved && Math.hypot(mx, my) < 3) return;
    pan.moved = true;
    elViewport.classList.add('is-panning');
    G.view.x = pan.ox + mx; G.view.y = pan.oy + my;
    applyView();
  }
});
function endPointer(e) {
  delete pointers[e.pointerId];
  if (Object.keys(pointers).length < 2) pinchStart = null;
  if (drag) {
    drag.el.classList.remove('is-dragging');
    if (drag.moved) { pushUndo('移动节点', drag.snap); markSaved(); }
    else selectNode(drag.n.id);
    drag = null;
  }
  if (pan) {
    elViewport.classList.remove('is-panning');
    if (!pan.moved && e.type === 'pointerup' && innerWidth > 720) closeDrawer();
    pan = null;
  }
}
elViewport.addEventListener('pointerup', endPointer);
elViewport.addEventListener('pointercancel', endPointer);
elViewport.addEventListener('wheel', function (e) {
  e.preventDefault();
  if (e.ctrlKey || Math.abs(e.deltaY) >= 40 && e.deltaX === 0) zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
  else { G.view.x -= e.deltaX; G.view.y -= e.deltaY; applyView(); }
}, { passive: false });

elNodes.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-act]');
  if (!b) return;
  var n = nodeById(b.closest('.gnode').dataset.id);
  if (b.dataset.act === 'menu') nodeMenu(b, n);
  if (b.dataset.act === 'expand') toggleCollapse(n);
});
elNodes.addEventListener('keydown', function (e) {
  var el = e.target.closest('.gnode');
  if (el && e.key === 'Enter') selectNode(el.dataset.id);
});

$('#zoomIn').onclick = function () { zoomAt(1.2, usableWidth() / 2, innerHeight / 2); };
$('#zoomOut').onclick = function () { zoomAt(1 / 1.2, usableWidth() / 2, innerHeight / 2); };
$('#zoomVal').onclick = function () { zoomAt(1 / G.view.z, usableWidth() / 2, innerHeight / 2); };
$('#zoomFit').onclick = function () { fitAll(); };

/* ─── node actions ─────────────────────────────────────── */
function nodeMenu(anchor, n) {
  var kids = childrenOf(n.id).length;
  var items = [
    { label: '打开对话', icon: 'panel', onClick: function () { selectNode(n.id); } },
    { label: '重命名', icon: 'edit', onClick: function () { renameNode(n); } }
  ];
  if (kids) items.push({ label: n.collapsed ? '展开子节点' : '折叠子节点（' + descendants(n.id).length + ' 个）', icon: n.collapsed ? 'expand' : 'collapse', onClick: function () { toggleCollapse(n); } });
  items.push({ sep: true });
  items.push({ label: '删除节点', icon: 'trash', danger: true, onClick: function () { deleteNode(n); } });
  showMenu(anchor, items);
}
function toggleCollapse(n) {
  pushUndo(n.collapsed ? '展开子节点' : '折叠子节点');
  n.collapsed = !n.collapsed;
  if (!n.collapsed) descendants(n.id).forEach(function (d) { d._new = true; });
  if (G.sel && isHidden(nodeById(G.sel))) closeDrawer();
  renderGraph(); markSaved();
}
function renameNode(n, fromDrawer) {
  var target = fromDrawer ? $('#drTitle') : elNodes.querySelector('[data-id="' + n.id + '"] .gn-title');
  if (!target) return;
  var input = document.createElement('input');
  input.className = 'input ws-rename'; input.value = n.title; input.maxLength = 24;
  target.replaceWith(input);
  input.focus(); input.select();
  var done = false;
  function finish(save) {
    if (done) return; done = true;
    var v = input.value.trim();
    if (save && v && v !== n.title) {
      pushUndo('改名');
      n.title = v; n.titleManual = true;
      markSaved();
      toast('已改名。之后 AI 不会再覆盖这个标题');
    }
    input.replaceWith(target);
    renderGraph(); Panel.renderHead();
  }
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
  input.addEventListener('blur', function () { finish(true); });
  input.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
}
function deleteNode(n) {
  var ds = descendants(n.id);
  var body = ds.length
    ? '会连同它下面的 <b>' + ds.length + ' 个子节点</b>一起删掉，一共 ' + (ds.length + 1) + ' 个节点：' + [n].concat(ds).map(function (x) { return '「' + esc(x.title) + '」'; }).join('、') + '。<br><br>删掉后可以按 Ctrl+Z 撤销。'
    : '这个节点没有子节点。删掉后可以按 Ctrl+Z 撤销。';
  confirmBox({
    title: '删除「' + esc(n.title) + '」？', body: body, danger: true,
    ok: ds.length ? '删除 ' + (ds.length + 1) + ' 个节点' : '删除',
    onOk: function () {
      pushUndo('删除节点');
      var ids = [n.id].concat(ds.map(function (d) { return d.id; }));
      G.nodes = G.nodes.filter(function (x) { return ids.indexOf(x.id) < 0; });
      if (ids.indexOf(G.sel) >= 0) closeDrawer();
      renderGraph(); markSaved();
      toast('已删除 ' + ids.length + ' 个节点', { action: '撤销', onAction: doUndo });
    }
  });
}
var nodeSeq = 20;
function newNodeId() { nodeSeq += 1; return 'n' + nodeSeq; }
function addRootNode() {
  pushUndo('新建节点');
  var maxY = G.nodes.filter(function (n) { return !n.parent; }).reduce(function (m, n) { return Math.max(m, n.y); }, 0);
  var n = { id: newNodeId(), title: '新节点', parent: null, x: 0, y: maxY + 260, collapsed: false, model: 'm1', sys: 'ref2va',
            slots: [], duration: 8, ratio: '16:9', summary: '', _new: true, untitled: true };
  G.nodes.push(n); THREADS[n.id] = [];
  renderGraph(); markSaved();
  selectNode(n.id);
  setTimeout(function () { ensureVisible(n); }, 60);
}
/* 从某条消息岔出新节点：复制它（含）之前的对话 */
function forkNode(src, count, prefill) {
  pushUndo('岔出新节点');
  var kids = childrenOf(src.id);
  var y = kids.length ? kids[kids.length - 1].y + 230 : src.y;
  var n = { id: newNodeId(), title: '新节点', parent: src.id, forkFrom: { node: src.id, count: count }, x: src.x + 344, y: y, collapsed: false,
            model: src.model, sys: src.sys, slots: src.slots.slice(), duration: src.duration, ratio: src.ratio,
            size: src.size, count: src.count, image: src.image ? JSON.parse(JSON.stringify(src.image)) : undefined,
            summary: src.summary, _new: true, untitled: true };
  G.nodes.push(n); THREADS[n.id] = []; COPIED[n.id] = copyThread(src, count);
  if (src.collapsed) src.collapsed = false;
  renderGraph(); markSaved();
  selectNode(n.id);
  setTimeout(function () { ensureVisible(n); }, 60);
  if (prefill) Panel.prefill(prefill);
  toast('已岔出新节点，复制了前 ' + count + ' 条消息');
  return n;
}

function selectNode(id) {
  G.sel = id;
  document.body.classList.add('drawer-open');
  renderGraph();
  Panel.open(id);
  var n = nodeById(id);
  setTimeout(function () { ensureVisible(n); }, 30);
}
function closeDrawer() {
  if (!G.sel) return;
  G.sel = null;
  document.body.classList.remove('drawer-open');
  renderGraph();
}

/* ─── auto layout ──────────────────────────────────────── */
function autoLayout() {
  pushUndo('自动排整齐');
  var GAP_X = 344, cursor = 0;
  function place(n, depth) {
    n.x = depth * GAP_X;
    var el = elNodes.querySelector('[data-id="' + n.id + '"]');
    var h = (el ? el.offsetHeight : 180) + 40;
    var kids = n.collapsed ? [] : childrenOf(n.id);
    if (!kids.length) { n.y = cursor; cursor += h; return; }
    kids.forEach(function (k) { place(k, depth + 1); });
    n.y = Math.round((kids[0].y + kids[kids.length - 1].y) / 2);
  }
  G.nodes.filter(function (n) { return !n.parent; }).sort(function (a, b) { return a.y - b.y; })
    .forEach(function (r) { place(r, 0); cursor += 40; });
  elWorld.classList.add('is-animating');
  renderGraph();
  setTimeout(function () { elWorld.classList.remove('is-animating'); renderEdges(); }, 420);
  markSaved();
  toast('已排整齐：子节点在父节点右边，兄弟节点上下排', { action: '撤销', onAction: doUndo });
}

/* ─── undo / redo（不含已经发出去的消息） ───────────────── */
function snapshot() {
  return JSON.stringify(G.nodes.map(function (n) {
    var o = {}; for (var k in n) if (k.charAt(0) !== '_') o[k] = n[k]; return o;
  }));
}
function pushUndo(label, snap) {
  G.undo.push({ label: label, snap: snap || snapshot() });
  if (G.undo.length > 50) G.undo.shift();
  G.redo = [];
  updateUndoButtons();
}
function restore(snapStr) {
  G.nodes = JSON.parse(snapStr);
  if (G.sel && (!nodeById(G.sel) || isHidden(nodeById(G.sel)))) closeDrawer();
  elWorld.classList.add('is-animating');
  renderGraph();
  setTimeout(function () { elWorld.classList.remove('is-animating'); renderEdges(); }, 420);
  if (G.sel) Panel.refreshDock();
  markSaved();
}
function doUndo() {
  var u = G.undo.pop(); if (!u) return;
  G.redo.push({ label: u.label, snap: snapshot() });
  restore(u.snap);
  toast('已撤销：' + u.label + (G.undo.length ? '（还能撤销 ' + G.undo.length + ' 步）' : ''));
}
function doRedo() {
  var r = G.redo.pop(); if (!r) return;
  G.undo.push({ label: r.label, snap: snapshot() });
  restore(r.snap);
  toast('已重做：' + r.label);
}
function updateUndoButtons() {
  var u = $('#btnUndo'), r = $('#btnRedo');
  u.disabled = !G.undo.length; r.disabled = !G.redo.length;
  u.title = G.undo.length ? '撤销：' + G.undo[G.undo.length - 1].label + '（Ctrl+Z）' : '没有可以撤销的操作';
  r.title = G.redo.length ? '重做：' + G.redo[G.redo.length - 1].label + '（Ctrl+Shift+Z）' : '没有可以重做的操作';
}
document.addEventListener('keydown', function (e) {
  var t = e.target;
  var typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  if (typing) return; // 写字时 Ctrl+Z 撤销的是打的字
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
  if (e.key === 'Escape' && !$('dialog[open]')) closeDrawer();
});
$('#btnUndo').onclick = doUndo;
$('#btnRedo').onclick = doRedo;
$('#btnLayout').onclick = autoLayout;
$('#btnNewNode').onclick = addRootNode;
$('#btnMore').onclick = function () {
  showMenu($('#btnMore'), [
    { label: '自动排整齐', icon: 'layout', onClick: autoLayout },
    { label: '撤销', icon: 'undo', onClick: doUndo },
    { label: '重做', icon: 'redo', onClick: doRedo },
    { sep: true },
    { label: '资产库', icon: 'image', onClick: function () { Assets.open({ mode: 'browse' }); } },
    { label: '切换明暗', icon: 'sun', onClick: function () { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); } },
    { label: '设置', icon: 'gear', onClick: function () { location.href = 'settings.html'; } }
  ]);
};

/* 画布改名 */
$('#canvasTitle').onclick = function () {
  var b = $('#canvasTitle');
  var input = document.createElement('input');
  input.className = 'input ws-rename'; input.value = b.textContent;
  b.replaceWith(input); input.focus(); input.select();
  function fin(save) {
    if (save && input.value.trim()) { b.textContent = input.value.trim(); document.title = b.textContent + ' · 提示词画布'; markSaved(); }
    input.replaceWith(b);
  }
  input.onkeydown = function (e) { if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); };
  input.onblur = function () { fin(true); };
};

/* 面板宽度拖动 */
(function () {
  var h = $('#drawerResize'), startX, startW;
  try { var w = parseInt(localStorage.getItem('pc-drawer-w'), 10); if (w) document.body.style.setProperty('--drawer-w', w + 'px'); } catch (e) {}
  h.addEventListener('pointerdown', function (e) {
    startX = e.clientX; startW = $('#drawer').offsetWidth; h.setPointerCapture(e.pointerId); h.classList.add('is-active');
  });
  h.addEventListener('pointermove', function (e) {
    if (startX == null) return;
    var w = Math.min(Math.max(440, startW - (e.clientX - startX)), Math.min(960, innerWidth - 320));
    document.body.style.setProperty('--drawer-w', w + 'px');
  });
  h.addEventListener('pointerup', function () {
    startX = null; h.classList.remove('is-active');
    try { localStorage.setItem('pc-drawer-w', $('#drawer').offsetWidth); } catch (e) {}
  });
})();
