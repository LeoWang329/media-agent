/* 画布工作台 · 弹层：资产库、上传清单、拼图、系统提示词原文；以及页面启动 */

document.addEventListener('click', function (e) {
  var c = e.target.closest('[data-close]');
  if (c) c.closest('dialog').close();
});

/* ─── 资产库 ───────────────────────────────────────────── */
var Assets = (function () {
  var dlg = $('#dlgAssets');
  var st = { mode: 'slots', folder: 'f1a', sel: [], q: '', slot: null, onPick: null };
  var folderSeq = 10;

  function imagesIn(fid) {
    var ids = Object.keys(IMAGES).filter(function (id) { return !IMAGES[id].collage || IMAGES[id].folder; });
    var root = FOLDERS.filter(function (f) { return f.id === fid; })[0];
    var inFolder = root ? [fid].concat(root.children.map(function (c) { return c.id; })) : [fid];
    return ids.filter(function (id) { return inFolder.indexOf(IMAGES[id].folder) >= 0; });
  }
  function folderInfo(fid) {
    for (var i = 0; i < FOLDERS.length; i++) {
      if (FOLDERS[i].id === fid) return FOLDERS[i];
      for (var j = 0; j < FOLDERS[i].children.length; j++) if (FOLDERS[i].children[j].id === fid) return FOLDERS[i].children[j];
    }
    return null;
  }
  function renderSide() {
    var html = '<div class="panel-title" style="padding:0 8px 6px">导入的文件夹</div>';
    FOLDERS.forEach(function (f) {
      html += '<div class="as-folder' + (st.folder === f.id && !st.q ? ' is-active' : '') + '" role="button" tabindex="0" data-folder="' + f.id + '" title="' + esc(f.path) + '">' +
        icon('folder', 'icon-sm') + '<span class="nm mono">' + esc(f.path) + '</span>' +
        '<span class="ct">' + (f.scanning ? '<span class="spinner" style="width:11px;height:11px"></span>' : fmtNum(f.count)) + '</span>' +
        '<button class="btn btn-ghost btn-icon btn-sm more" data-fmenu="' + f.id + '" aria-label="文件夹操作">' + icon('more') + '</button></div>';
      f.children.forEach(function (c) {
        html += '<div class="as-folder is-child' + (st.folder === c.id && !st.q ? ' is-active' : '') + '" role="button" tabindex="0" data-folder="' + c.id + '">' +
          '<span class="nm">' + esc(c.name) + '</span><span class="ct">' + fmtNum(c.count) + '</span></div>';
      });
    });
    html += '<button class="btn btn-secondary btn-sm" id="asImport" style="margin:10px 8px 0">' + icon('folder-plus') + '导入文件夹</button>' +
      '<p class="hint" style="padding:8px 8px 0">只记路径，不复制文件。移除文件夹也不会动你电脑上的图。</p>';
    $('#asSide').innerHTML = html;
  }
  function tile(id) {
    var im = IMAGES[id], n = Panel.node();
    var inSlot = n ? n.slots.indexOf(id) : -1;
    var selIdx = st.sel.indexOf(id);
    var sub = st.q ? '<div class="tile-path">' + esc(folderPath(im.folder)) + '</div>' : '';
    if (im.unsupported) {
      return '<div class="tile is-unsupported" title="' + esc(im.name) + ' 是 ' + im.unsupported + ' 格式，H3 只收 jpg、png、webp"><div class="tile-img"><div class="fmt"><b>' + im.unsupported + '</b>这个格式用不了</div></div>' +
        '<div class="tile-name">' + esc(im.name) + '</div>' + sub + '</div>';
    }
    return '<button class="tile' + (selIdx >= 0 ? ' is-selected' : '') + '" data-id="' + id + '" title="' + esc(im.name) + (im.w ? ' · ' + im.w + '×' + im.h : '') + ' · ' + esc(im.size || '') + '" data-od-id="asset-tile">' +
      '<div class="tile-img">' + thumbHTML(id) +
        (st.mode === 'slots' ? '<span class="check">' + (selIdx >= 0 ? selIdx + 1 : '') + '</span>' : '') +
        (inSlot >= 0 ? '<span class="tag in-slot">在 ' + (inSlot + 1) + ' 号</span>' : '') +
      '</div><div class="tile-name">' + esc(im.name) + '</div>' + sub + '</button>';
  }
  function renderGrid() {
    var grid = $('#asGrid'), ids, info = folderInfo(st.folder);
    if (st.q) {
      var q = st.q.toLowerCase();
      ids = Object.keys(IMAGES).filter(function (id) { return IMAGES[id].folder && IMAGES[id].name.toLowerCase().indexOf(q) >= 0; });
      $('#asCrumb').textContent = '在全部 ' + FOLDERS.length + ' 个文件夹里搜「' + st.q + '」';
      $('#asCount').textContent = ids.length + ' 个结果';
      grid.innerHTML = ids.length ? ids.map(tile).join('') : '<div class="as-empty">没有文件名包含「' + esc(st.q) + '」的图</div>';
      return;
    }
    $('#asCrumb').textContent = folderPath(st.folder);
    if (st.folder === 'f3') {
      $('#asCount').textContent = '';
      grid.innerHTML = '<div class="as-empty"><div style="color:var(--danger);display:inline-grid;place-items:center;margin-bottom:10px">' + icon('lock') + '</div>' +
        '<h3 style="color:var(--fg)">读不了这个文件夹</h3><p style="margin:6px auto 14px;max-width:44ch;font-size:13px">系统拒绝访问（EPERM）。可能是同步盘还没把它下载到这台电脑，或者当前账户没有读取权限。</p>' +
        '<button class="btn btn-secondary btn-sm" id="asRetry">' + icon('retry') + '重试</button></div>';
      return;
    }
    ids = imagesIn(st.folder);
    var loaded = ids.length, total = info ? info.count : loaded;
    $('#asCount').textContent = '已加载 ' + loaded + ' / ' + fmtNum(total) + ' 张';
    var html = ids.map(tile).join('');
    if (total > loaded) {
      for (var i = 0; i < 6; i++) html += '<div class="tile" aria-hidden="true"><div class="tile-img skeleton"></div><div class="tile-name skeleton" style="height:10px;border-radius:4px;margin-top:8px;width:70%"></div></div>';
      html += '<div class="as-more meta">往下滚继续加载缩略图</div>';
    }
    if (!ids.length && total === 0) html = '<div class="as-empty">这个文件夹里没有图</div>';
    grid.innerHTML = html;
  }
  function renderFoot() {
    var n = Panel.node(), btn = $('#asConfirm'), sel = $('#asSel');
    btn.hidden = st.mode !== 'slots';
    if (st.mode === 'browse') { sel.textContent = n ? '' : '在画布上选一个节点，就能把图放进它的槽位'; return; }
    if (st.mode !== 'slots') { sel.textContent = st.mode === 'replace' ? '点一张图直接替换' : '点一张图就好'; return; }
    var room = 9 - n.slots.length;
    var fresh = st.sel.filter(function (id) { return n.slots.indexOf(id) < 0; }).length;
    sel.innerHTML = st.sel.length
      ? '已选 <b class="mono">' + st.sel.length + '</b> 张，按点选顺序放进 ' + (n.slots.length + 1) + ' 号往后 · 槽位还剩 <span class="mono">' + room + '</span> 个' +
        (fresh > room ? ' · <span style="color:var(--warn)">多出来的 ' + (fresh - room) + ' 张放不进去</span>' : '')
      : '点图多选 · 槽位还剩 <span class="mono">' + room + '</span> 个';
    btn.disabled = !st.sel.length || room === 0;
    btn.textContent = st.sel.length ? '放进槽位（' + st.sel.length + '）' : '放进槽位';
  }
  function render() {
    var n = Panel.node();
    var titles = {
      slots: ['资产库', n ? '选几张放进「' + n.title + '」的槽位' : ''],
      browse: ['资产库', '图片原地引用，不会复制到别处'],
      replace: ['换掉 ' + (st.slot + 1) + ' 号槽位的图', '挑一张，编号还是 ' + (st.slot + 1) + ' 号'],
      ref: ['挑一张图插进句子里', '不在槽位里的图会先放进下一个空槽位'],
      collage: ['挑一张放进拼图格子', '']
    }[st.mode];
    $('#asTitle').textContent = titles[0]; $('#asSub').textContent = titles[1];
    renderSide(); renderGrid(); renderFoot();
  }

  $('#asSide').addEventListener('click', function (e) {
    var m = e.target.closest('[data-fmenu]');
    if (m) {
      e.stopPropagation();
      var f = folderInfo(m.dataset.fmenu);
      showMenu(m, [{ note: f.path }, { label: '从资产库移除', icon: 'x', danger: true, onClick: function () {
        confirmBox({ title: '从资产库移除这个文件夹？', body: '<span class="mono">' + esc(f.path) + '</span><br><br>只是不在资产库里显示了，电脑上的文件不会动。已经放进槽位的图不受影响。', ok: '移除', danger: true,
          onOk: function () { FOLDERS = FOLDERS.filter(function (x) { return x !== f; }); if (folderInfo(st.folder) == null) st.folder = FOLDERS[0] ? FOLDERS[0].id : ''; render(); toast('已移除，文件都还在原处'); } });
      } }]);
      return;
    }
    if (e.target.closest('#asImport')) { importFolder(); return; }
    var row = e.target.closest('[data-folder]');
    if (row) { st.folder = row.dataset.folder; st.q = ''; $('#asSearch').value = ''; render(); $('#asGrid').scrollTop = 0; }
  });
  $('#asGrid').addEventListener('click', function (e) {
    if (e.target.closest('#asRetry')) { toast('还是读不了：拒绝访问', { tone: 'danger' }); return; }
    var t = e.target.closest('.tile[data-id]'); if (!t) return;
    var id = t.dataset.id;
    if (st.mode === 'browse') { toast(IMAGES[id].name + ' · ' + IMAGES[id].w + '×' + IMAGES[id].h + ' · ' + IMAGES[id].size); return; }
    if (st.mode === 'slots') {
      var i = st.sel.indexOf(id);
      if (i >= 0) st.sel.splice(i, 1); else st.sel.push(id);
      renderGrid(); renderFoot(); return;
    }
    dlg.close();
    if (st.mode === 'replace') Panel.replaceSlot(st.slot, id);
    if (st.mode === 'ref') Panel.insertChip(id);
    if (st.mode === 'collage' && st.onPick) st.onPick(id);
  });
  $('#asConfirm').onclick = function () { var ids = st.sel.slice(); dlg.close(); Panel.addImages(ids); };
  var qTimer;
  $('#asSearch').addEventListener('input', function (e) { clearTimeout(qTimer); qTimer = setTimeout(function () { st.q = e.target.value.trim(); renderSide(); renderGrid(); }, 150); });

  function importFolder() {
    var d = document.createElement('dialog');
    d.className = 'dialog';
    d.innerHTML = '<div class="dialog-head"><h2>导入文件夹</h2></div><div class="dialog-body"><div class="field"><label for="impPath">文件夹路径</label>' +
      '<div class="input-group"><input class="input mono" id="impPath" value="D:\\素材\\春节街景" /><button class="btn btn-secondary" id="impBrowse">' + icon('folder') + '选择…</button></div>' +
      '<p class="hint">只记下路径，图还放在原处。子文件夹会一起列出来。</p></div></div>' +
      '<div class="dialog-foot"><button class="btn btn-secondary" value="cancel">取消</button><button class="btn btn-primary" value="ok">导入</button></div>';
    document.body.appendChild(d);
    d.querySelectorAll('[value]').forEach(function (b) { b.onclick = function () { d.close(b.value); }; });
    d.querySelector('#impBrowse').onclick = function () { toast('会打开系统的「选择文件夹」窗口'); };
    d.addEventListener('close', function () {
      var p = d.querySelector('#impPath').value.trim();
      if (d.returnValue === 'ok' && p) {
        folderSeq += 1;
        var f = { id: 'f' + folderSeq, path: p, count: 0, scanning: true, children: [] };
        FOLDERS.push(f); st.folder = f.id; render();
        setTimeout(function () { f.scanning = false; f.count = 128; if (dlg.open) render(); toast('「' + p + '」导入好了，128 张图'); }, 1600);
      }
      d.remove();
    });
    d.showModal();
  }

  return {
    open: function (opts) {
      st.mode = opts.mode; st.slot = opts.slot; st.onPick = opts.onPick; st.sel = []; st.q = '';
      if (!Panel.node() && st.mode !== 'collage') st.mode = 'browse';
      $('#asSearch').value = '';
      render();
      if (!dlg.open) dlg.showModal();
    }
  };
})();
$('#btnAssets').onclick = function () { Assets.open({ mode: G.sel ? 'slots' : 'browse' }); };

/* ─── 上传清单 ─────────────────────────────────────────── */
var Upload = (function () {
  var dlg = $('#dlgUpload'), cur = null;
  function open(n, box, imgs, v) {
    var used = {}, m, re = /<Picture (\d+)>/g;
    while ((m = re.exec(box.text))) used[+m[1]] = true;
    var missing = Object.keys(used).map(Number).filter(function (k) { return k > imgs.length; }).sort();
    var unused = imgs.map(function (id, i) { return i + 1; }).filter(function (k) { return !used[k]; });
    var verIdx = '';
    $('#upSub').textContent = n.title + ' · ' + (box.label || '提示词') + ' · 共 ' + imgs.length + ' 张，按编号顺序上传';
    var html = '';
    if (missing.length) html += '<div class="up-alert is-danger">' + icon('alert') + '<div>提示词里写了 <b class="mono">' + missing.map(function (k) { return '&lt;Picture ' + k + '&gt;'; }).join('、') + '</b>，但这条只带了 ' + imgs.length + ' 张图。上传前先改提示词，不然平台会找不到这张图。</div></div>';
    if (unused.length) html += '<div class="up-alert is-warn">' + icon('info') + '<div><b class="mono">' + unused.map(function (k) { return '&lt;Picture ' + k + '&gt;'; }).join('、') + '</b> 在提示词里没用到。可以不传，但编号要保持连续的话还是得传。</div></div>';
    html += '<div class="up-list">';
    var paths = [];
    imgs.forEach(function (id, i) {
      var im = IMAGES[id];
      var path = im.proc ? im.proc.copy : im.missing ? im.copy : (im.path || imagePath(id));
      paths.push((i + 1) + '. ' + path);
      var tag = im.proc ? '<span class="tag tag-warn">传处理过的副本</span>'
        : im.missing ? '<span class="tag tag-danger">原文件不在了，传程序存的副本</span>'
        : '<span class="tag tag-ok">' + icon('check') + '原图</span>';
      var note = im.proc ? im.proc.note + '。原文件在 <span class="mono">' + esc(imagePath(id)) + '</span>，不要传它'
        : im.missing ? '原来在 <s class="mono">' + esc(imagePath(id)) + '</s>，已经找不到了'
        : (im.w ? im.w + '×' + im.h + ' · ' : '') + esc(im.size || '');
      html += '<div class="up-row' + (used[i + 1] ? '' : ' is-unused') + '" data-od-id="upload-row-' + (i + 1) + '">' +
        '<div class="up-num">' + (i + 1) + '<small>号</small></div>' +
        '<div class="up-thumb">' + thumbHTML(id) + '</div>' +
        '<div class="up-info"><div class="up-name">' + esc(im.name) + tag + (used[i + 1] ? '' : '<span class="tag tag-warn">没用到</span>') + '</div>' +
          '<div class="up-path">' + esc(path) + '</div><div class="up-note">' + note + '</div></div>' +
        '<div class="up-acts"><button class="btn btn-secondary btn-sm" data-reveal="' + esc(path) + '">' + icon('reveal') + '在资源管理器里显示</button>' +
          '<button class="btn btn-ghost btn-sm" data-copy="' + esc(path) + '">' + icon('copy') + '复制路径</button></div></div>';
    });
    html += '</div>';
    if (!imgs.length) html += '<p class="muted" style="padding:28px 0;text-align:center">这条提示词没有带参考图，只要复制提示词就行。</p>';
    $('#upBody').innerHTML = html;
    $('#upFootNote').textContent = imgs.length ? '按 1 → ' + imgs.length + ' 的顺序传到第三方平台' : '';
    cur = { box: box, paths: paths };
    dlg.showModal();
  }
  $('#upBody').addEventListener('click', function (e) {
    var r = e.target.closest('[data-reveal]'), c = e.target.closest('[data-copy]');
    if (r) toast('已在资源管理器里选中 ' + r.dataset.reveal.split('\\').pop());
    if (c) copyText(c.dataset.copy, '已复制路径');
  });
  $('#upCopyAll').onclick = function () { copyText(cur.paths.join('\n'), '已复制 ' + cur.paths.length + ' 个路径'); };
  $('#upCopyPrompt').onclick = function () { copyText(cur.box.text, '已复制提示词'); };
  return { open: open };
})();

/* ─── 拼图 ─────────────────────────────────────────────── */
var Collage = (function () {
  var dlg = $('#dlgCollage');
  var st = { rows: 2, cols: 2, side: 1536, numbered: true, cells: ['a2', 'c1', 'a7', null], active: 3, dest: 'f1c', name: '分镜-新-2x2.jpg', pick: 'f1a' };
  var seq = 0, dragFrom = null;
  var ROW = ['第一排', '第二排', '第三排'], COL = ['左边', '中间', '右边'];
  function pos(i) {
    var r = Math.floor(i / st.cols), c = i % st.cols;
    if (st.rows === 2 && st.cols === 2) return (r ? '下' : '上') + (c ? '右' : '左');
    var rn = st.rows === 1 ? '' : ROW[r], cn = st.cols === 1 ? '' : st.cols === 2 ? ['左边', '右边'][c] : COL[c];
    return (rn + cn) || '整张';
  }
  function resize() {
    var n = st.rows * st.cols;
    while (st.cells.length < n) st.cells.push(null);
    st.cells.length = n;
    if (st.active >= n) st.active = 0;
  }
  function renderSettings() {
    var one = st.rows === 1 && st.cols === 1;
    $('#clSettings').innerHTML =
      '<div class="row-between"><span class="label">行数</span><div class="stepper"><button data-s="rows:-1"' + (st.rows <= 1 ? ' disabled' : '') + '>−</button><output>' + st.rows + '</output><button data-s="rows:1"' + (st.rows >= 3 ? ' disabled' : '') + '>+</button></div></div>' +
      '<div class="row-between"><span class="label">列数</span><div class="stepper"><button data-s="cols:-1"' + (st.cols <= 1 ? ' disabled' : '') + '>−</button><output>' + st.cols + '</output><button data-s="cols:1"' + (st.cols >= 3 ? ' disabled' : '') + '>+</button></div></div>' +
      (one ? '<p class="hint is-error" style="margin-top:-8px">1×1 不算拼图，至少要 2 格</p>' : '') +
      '<div class="field"><span class="label">每格边长</span><div class="seg"><button data-side="1024" aria-pressed="' + (st.side === 1024) + '">1024</button><button data-side="1536" aria-pressed="' + (st.side === 1536) + '">1536</button></div>' +
      '<p class="hint">格子是正方形，整张输出 <span class="mono">' + st.cols * st.side + '×' + st.rows * st.side + '</span></p></div>' +
      '<div class="field"><label class="switch"><input type="checkbox" id="clNum"' + (st.numbered ? ' checked' : '') + '><span class="track"></span>每格左上角加编号</label>' +
      '<p class="hint">' + (st.numbered ? '编号只是画在图上的数字，提示词里还是要用位置来指某一格。' : '不加编号时，在提示词里用「' + pos(0) + '」「' + pos(Math.min(st.cells.length - 1, st.cols + 1)) + '」这样的说法指某一格。') + '</p></div>' +
      '<div class="field"><label for="clDest">存到</label><select class="select" id="clDest">' +
        '<option value="f1c"' + (st.dest === 'f1c' ? ' selected' : '') + '>D:\\素材\\新年广告\\拼图</option>' +
        '<option value="f1a"' + (st.dest === 'f1a' ? ' selected' : '') + '>D:\\素材\\新年广告\\雨夜街拍</option>' +
        '<option value="x"' + (st.dest === 'x' ? ' selected' : '') + '>D:\\导出\\拼图（不在资产库里）</option></select>' +
        '<p class="hint">' + (st.dest === 'x' ? '这个文件夹没导入资产库，存好后在库里看不到。' : '这个文件夹在资产库里，存好马上能看到。') + '</p></div>' +
      '<div class="field"><label for="clName">文件名</label><input class="input mono" id="clName" value="' + esc(st.name) + '"></div>';
  }
  function renderBoard() {
    var b = $('#clBoard');
    b.style.gridTemplateColumns = 'repeat(' + st.cols + ',1fr)';
    b.style.gridTemplateRows = 'repeat(' + st.rows + ',1fr)';
    b.style.aspectRatio = st.cols + ' / ' + st.rows;
    b.innerHTML = st.cells.map(function (id, i) {
      return '<div class="cl-cell' + (i === st.active ? ' is-active' : '') + '" data-cell="' + i + '" draggable="' + (!!id) + '" title="' + pos(i) + '">' +
        (id ? '<img src="' + IMAGES[id].src + '" alt="' + esc(IMAGES[id].name) + '">' : '<div class="cl-empty">' + pos(i) + '<br>点右边的图放进来</div>') +
        (st.numbered ? '<span class="cl-no">' + (i + 1) + '</span>' : '') +
        (id ? '<button class="cl-x" data-clear="' + i + '" aria-label="清空这格">' + icon('x', 'icon-sm') + '</button>' : '') + '</div>';
    }).join('');
    var filled = st.cells.filter(Boolean).length;
    $('#clTip').textContent = '选中的格子（' + pos(st.active) + '）会放进你点的图；格子之间拖动可以互换位置。图完整放进格子，空的地方是白的。';
    $('#clFoot').innerHTML = '输出 <span class="mono">' + st.cols * st.side + '×' + st.rows * st.side + '</span> JPG · ' + st.cells.length + ' 格，已放 ' + filled + ' 张';
    var bad = (st.rows === 1 && st.cols === 1) || !filled;
    $('#clSave').disabled = bad; $('#clSaveSlot').disabled = bad || !Panel.node();
  }
  function renderPick() {
    var ids = Object.keys(IMAGES).filter(function (id) { var im = IMAGES[id]; return im.src && (im.folder === st.pick || (st.pick === 'f1' && /^f1/.test(im.folder || ''))); });
    $('#clPick').innerHTML = '<select class="select select-sm" id="clPickFolder" style="width:100%">' +
      '<option value="f1a"' + (st.pick === 'f1a' ? ' selected' : '') + '>雨夜街拍</option><option value="f1b"' + (st.pick === 'f1b' ? ' selected' : '') + '>灯与灯笼</option><option value="f2"' + (st.pick === 'f2' ? ' selected' : '') + '>E:\\图库\\项目封面</option></select>' +
      '<div class="cl-pick-grid">' + ids.map(function (id) { return '<button draggable="true" data-pick="' + id + '" title="' + esc(IMAGES[id].name) + '">' + thumbHTML(id) + '</button>'; }).join('') + '</div>';
  }
  function render() { resize(); renderSettings(); renderBoard(); renderPick(); }
  function put(id) {
    st.cells[st.active] = id;
    var next = st.cells.indexOf(null);
    if (next >= 0) st.active = next;
    renderBoard();
  }

  $('#clSettings').addEventListener('click', function (e) {
    var s = e.target.closest('[data-s]'), side = e.target.closest('[data-side]');
    if (s) { var p = s.dataset.s.split(':'); st[p[0]] = Math.min(3, Math.max(1, st[p[0]] + +p[1])); st.name = st.name.replace(/\d+x\d+/, st.rows + 'x' + st.cols); render(); }
    if (side) { st.side = +side.dataset.side; render(); }
  });
  $('#clSettings').addEventListener('change', function (e) {
    if (e.target.id === 'clNum') { st.numbered = e.target.checked; renderSettings(); renderBoard(); }
    if (e.target.id === 'clDest') { st.dest = e.target.value; renderSettings(); }
    if (e.target.id === 'clName') st.name = e.target.value;
  });
  $('#clBoard').addEventListener('click', function (e) {
    var x = e.target.closest('[data-clear]');
    if (x) { st.cells[+x.dataset.clear] = null; st.active = +x.dataset.clear; renderBoard(); return; }
    var c = e.target.closest('[data-cell]'); if (c) { st.active = +c.dataset.cell; renderBoard(); }
  });
  $('#clBoard').addEventListener('dragstart', function (e) { var c = e.target.closest('[data-cell]'); if (c) { dragFrom = { cell: +c.dataset.cell }; e.dataTransfer.setData('text/plain', 'cell'); } });
  $('#clPick').addEventListener('dragstart', function (e) { var b = e.target.closest('[data-pick]'); if (b) { dragFrom = { pick: b.dataset.pick }; e.dataTransfer.setData('text/plain', 'pick'); } });
  $('#clBoard').addEventListener('dragover', function (e) {
    var c = e.target.closest('[data-cell]'); if (!c || !dragFrom) return;
    e.preventDefault(); $$('.cl-cell').forEach(function (x) { x.classList.toggle('is-drop', x === c); });
  });
  $('#clBoard').addEventListener('drop', function (e) {
    var c = e.target.closest('[data-cell]'); if (!c || !dragFrom) return;
    e.preventDefault();
    var to = +c.dataset.cell;
    if (dragFrom.pick) st.cells[to] = dragFrom.pick;
    else { var t = st.cells[to]; st.cells[to] = st.cells[dragFrom.cell]; st.cells[dragFrom.cell] = t; }
    st.active = to; dragFrom = null; renderBoard();
  });
  document.addEventListener('dragend', function () { dragFrom = null; $$('.cl-cell').forEach(function (x) { x.classList.remove('is-drop'); }); });
  $('#clPick').addEventListener('click', function (e) { var b = e.target.closest('[data-pick]'); if (b) put(b.dataset.pick); });
  $('#clPick').addEventListener('change', function (e) { if (e.target.id === 'clPickFolder') { st.pick = e.target.value; renderPick(); } });

  function save(toSlot) {
    seq += 1;
    var id = 'k' + (10 + seq), dest = st.dest === 'x' ? null : st.dest;
    IMAGES[id] = { collage: { rows: st.rows, cols: st.cols, cells: st.cells.slice(), numbered: st.numbered }, name: st.name, folder: dest,
      path: dest ? null : 'D:\\导出\\拼图\\' + st.name, w: st.cols * st.side, h: st.rows * st.side, size: (st.rows * st.cols * 0.21).toFixed(1) + ' MB' };
    if (dest) FOLDERS.forEach(function (f) { f.children.forEach(function (c) { if (c.id === dest) c.count += 1; }); });
    dlg.close();
    var where = dest ? folderPath(dest) : 'D:\\导出\\拼图';
    if (toSlot) Panel.addImages([id], { quiet: true });
    toast('拼图存到了 ' + where + '\\' + st.name + (toSlot ? '，放进了 ' + Panel.node().slots.length + ' 号槽位' : '') + (dest ? '，资产库里已经能看到' : ''), { ms: 4500 });
  }
  $('#clSave').onclick = function () { save(false); };
  $('#clSaveSlot').onclick = function () { save(true); };
  return { open: function () { render(); dlg.showModal(); } };
})();

/* ─── 系统提示词原文 ────────────────────────────────────── */
var SysView = (function () {
  var dlg = $('#dlgSys');
  function textFor(name) {
    if (name === 't2v') return SYS_SNAPSHOT_REF2VA.replace('（参考模式）', '（纯文字模式）').replace('这一套用在有参考图、图提供人物、场景、服装、风格或分镜的时候。', '这一套用在没有参考图、全部靠文字描述的时候。');
    if (name === 'ref2va-台词多') return SYS_SNAPSHOT_REF2VA + '\n\n## 台词（这一套自己加的）\n\n- 每个镜头尽量安排一句短台词，台词写在 <d> 里，前面标 [中文]。';
    return SYS_SNAPSHOT_REF2VA;
  }
  $('#sysCopy').onclick = function () { copyText($('#sysPre').textContent, '已复制原文'); };
  return { open: function (v) {
    $('#sysTitle').textContent = v.sys + ' · ' + (v.sysAt || '') + ' 发送时';
    $('#sysPre').textContent = textFor(v.sys);
    dlg.showModal();
  } };
})();

/* ─── 翻译提示词 ───────────────────────────────────────────
   一个框单独发给模型翻，只问一次，整段一起回来。每个框每种语言只留最新一份。
   正在翻的记在 jobs 里，关掉弹窗也接着翻；秒数按开始时间算，重新打开接着往上走。 */
var Translate = (function () {
  var dlg = $('#dlgTranslate');
  var LANGS = ['英文', '中文', '日文', '韩文'], LANG_ID = { '英文': 'en', '中文': 'zh', '日文': 'ja', '韩文': 'ko' };
  var RUN_MS = 18000;   // 原型里假装翻 18 秒
  var jobs = {}, seq = 0, tick = null;
  var cur = null, lang = '英文';

  function keyOf(box, l) { return (box._tr || (box._tr = 't' + (++seq))) + '/' + l; }
  function jobOf(box, l) { return jobs[keyOf(box, l)]; }
  function savedOf(box, l) { return box.translations ? box.translations[l] : null; }
  function modelById(id) { return MODEL_CONFIGS.filter(function (m) { return m.id === id; })[0]; }
  function nodeModel() { return cur.fakeModel || modelById(cur.n.model); }
  function latestLang(box) {
    var best = null;
    LANGS.forEach(function (l) { var t = savedOf(box, l); if (t && (!best || t.ts > savedOf(box, best).ts)) best = l; });
    return best || '英文';
  }
  function stamp() {
    var d = new Date(), z = function (x) { return String(x).padStart(2, '0'); };
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  function secs(start) { return Math.max(0, Math.round((Date.now() - start) / 1000)) + ' 秒'; }
  function since(start) { return '<span class="mono" data-since="' + start + '">' + secs(start) + '</span>'; }
  function costOf(t) {
    var m = modelById(t.modelId);
    if (!m || !m.price) return null;
    var c = (t.tin * m.price.inp + t.tout * m.price.out) / 1e6;
    return m.price.cur + (c < 0.1 ? c.toFixed(3) : c.toFixed(2));
  }
  function makeTranslation(src, l, instruction, m) {
    var text = translationSample(src, l);
    return { text: text, at: stamp(), ts: Date.now(), modelId: m.id, modelName: m.model, instruction: instruction,
      tin: 640 + Math.round(src.length * 1.1), tout: Math.round(l === '英文' ? text.length / 3.8 : text.length * 0.95) };
  }

  /* ─── 渲染 ─── */
  function renderHead() {
    var m = nodeModel();
    $('#trSub').innerHTML = '<span class="tr-box" title="' + esc(cur.label) + '">' + esc(cur.label) + '</span>' +
      '<span class="tr-model" title="' + (m ? '用节点现在选的模型配置翻：' + esc(m.name + ' · ' + m.model) : '') + '">' +
      (m ? '<span class="tr-model-name">用「' + esc(m.name) + '」</span><span class="mono tr-model-id">' + esc(m.model) + '</span><span class="tr-model-name">翻</span>' : '<span>节点还没选模型配置</span>') + '</span>';
  }
  function renderLangs() {
    $('#trLangs').innerHTML = LANGS.map(function (l) {
      var job = jobOf(cur.box, l), t = savedOf(cur.box, l), state, said;
      if (job) { state = '<span class="tr-lang-state is-busy"><span class="spinner"></span>正在翻 ' + since(job.start) + '</span>'; said = '正在翻'; }
      else if (t) { state = '<span class="tr-lang-state is-done">' + icon('check', 'icon-sm') + esc(t.at) + '</span>'; said = t.at + ' 翻过'; }
      else { state = '<span class="tr-lang-state">还没翻过</span>'; said = '还没翻过'; }
      return '<button class="tr-lang" data-lang="' + l + '" aria-pressed="' + (l === lang) + '" aria-label="' + l + '，' + said + '" data-od-id="translate-lang-' + LANG_ID[l] + '">' +
        '<span class="tr-lang-name">' + l + '</span>' + state + '</button>';
    }).join('');
  }
  function renderRun() {
    var job = jobOf(cur.box, lang), t = savedOf(cur.box, lang), b = $('#trRun');
    b.disabled = !!job;
    b.className = 'btn ' + (t ? 'btn-secondary' : 'btn-primary');
    b.innerHTML = job ? '<span class="spinner"></span>正在翻译' : t ? icon('retry') + '重新翻译' : icon('translate') + '翻译';
    dlg.classList.toggle('has-text', !!t);
  }
  function renderMain() {
    var box = cur.box, job = jobOf(box, lang), t = savedOf(box, lang), el = $('#trMain'), html;
    el.classList.toggle('is-stale', !!(job && t));
    if (t) {
      var cost = costOf(t);
      html = (job ? '<div class="tr-banner" data-od-id="translate-retranslating"><span class="spinner"></span><div>' +
          '<b>正在重新翻译，已等 ' + since(job.start) + '。</b>下面是 ' + esc(t.at) + ' 翻的旧译文，照样能看、能复制，新的翻好后会替换它。' +
          (job.instruction ? '<div class="tr-banner-req">这次的要求：' + esc(job.instruction) + '</div>' : '') + '</div></div>' : '') +
        '<header class="tr-meta" data-od-id="translate-meta">' +
          '<div class="tr-meta-top"><h3>' + lang + '译文</h3>' + (job ? '<span class="tag tag-outline">旧译文</span>' : '') + '<span class="grow"></span>' +
            '<button class="btn btn-primary" id="trCopy" data-od-id="translate-copy">' + icon('copy') + '复制译文</button></div>' +
          '<div class="tr-meta-line meta"><span>' + esc(t.at) + ' 翻的</span>' +
            '<span class="mono tr-meta-model" title="' + esc(t.modelName) + '">' + esc(t.modelName) + '</span>' +
            '<span>输入 <span class="mono">' + fmtNum(t.tin) + '</span> · 输出 <span class="mono">' + fmtNum(t.tout) + '</span> tokens</span>' +
            (cost ? '<span class="mono">' + cost + '</span>' : '') + '</div>' +
          (t.instruction ? '<div class="tr-meta-req meta">当时的要求：' + esc(t.instruction) + '</div>' : '') +
        '</header>' +
        '<div class="tr-scroll" tabindex="0" aria-label="' + lang + '译文"><div class="pb-body" data-od-id="translate-text">' + Panel.promptHTML(t.text, cur.imgs) + '</div></div>';
    } else if (job) {
      html = '<div class="tr-state" data-od-id="translate-waiting"><span class="spinner"></span><h3>正在翻成' + lang + '</h3>' +
        '<p class="meta">已经等了 ' + since(job.start) + '，一般要几十秒。</p>' +
        '<p class="meta">可以关掉窗口去干别的，翻译不会停，翻好了页面底部会提示。</p>' +
        (job.instruction ? '<p class="tr-state-req">要求：' + esc(job.instruction) + '</p>' : '') + '</div>';
    } else {
      html = '<div class="tr-state" data-od-id="translate-empty"><h3>还没翻成' + lang + '</h3>' +
        '<p class="meta">这个框的原文有 <span class="mono">' + fmtNum(box.text.length) + '</span> 字，只把这一段发给模型，不带对话历史和图。翻好的会存下来，下次打开直接看。</p></div>';
    }
    el.innerHTML = html;
  }
  function refresh(withMain) { renderLangs(); renderRun(); if (withMain) renderMain(); }
  function setLang(l) {
    lang = l;
    var job = jobOf(cur.box, l), t = savedOf(cur.box, l);
    $('#trReq').value = job ? job.instruction : t ? t.instruction : '';
    dlg.classList.remove('is-req-open'); $('#trReqToggle').setAttribute('aria-expanded', 'false');
    renderHead(); refresh(true);
  }

  /* ─── 翻译 ─── */
  function fail(label, l, msg) { toast('「' + esc(label) + '」翻成' + l + '失败：' + esc(msg), { tone: 'danger', ms: 9000 }); }
  function start(instruction, agoSec, ms, error) {
    var key = keyOf(cur.box, lang);
    var job = jobs[key] = { box: cur.box, l: lang, label: cur.label, model: nodeModel(), instruction: instruction, start: Date.now() - agoSec * 1000 };
    job.timer = setTimeout(function () { finish(key, error); }, ms);
    refresh(true);
  }
  function finish(key, error) {
    var job = jobs[key]; if (!job) return;
    clearTimeout(job.timer); delete jobs[key];
    var here = dlg.open && cur && cur.box === job.box;
    if (error) { fail(job.label, job.l, error); if (here) refresh(job.l === lang); return; }
    job.box.translations = job.box.translations || {};
    job.box.translations[job.l] = makeTranslation(job.box.text, job.l, job.instruction, job.model);
    markSaved();
    if (here) refresh(job.l === lang);
    else toast('「' + esc(job.label) + '」翻成' + job.l + '了，点框上的「翻译」看', { ms: 5000 });
  }
  function run() {
    if (!cur || jobOf(cur.box, lang)) return;
    if (!nodeModel()) { fail(cur.label, lang, '这个节点没有可用的模型配置，请在面板顶部选一个'); return; }
    start($('#trReq').value.trim(), 0, RUN_MS);
  }

  /* ─── 原型用：切到各种状态 ─── */
  var LONG_MODEL = { id: 'm1', name: '海外备用（OpenRouter 转发）', model: 'openrouter/minimax/minimax-m2-her-preview-2026-08-15-longcontext' };
  var API_ERROR = '401 Unauthorized: {"error":{"message":"Incorrect API key provided: the key you passed is invalid or has been revoked. You can find your API key at https://platform.minimaxi.com/user-center/basic-information/interface-key","type":"authentication_error","code":"invalid_api_key"}}';
  var DEMO_REQ = '台词也翻译；语气口语一点';
  function proto(v) {
    var box = cur.box;
    function cancel(l) { var k = keyOf(box, l); if (jobs[k]) { clearTimeout(jobs[k].timer); delete jobs[k]; } }
    function put(instruction, m) { box.translations = box.translations || {}; box.translations[lang] = makeTranslation(box.text, lang, instruction, m); }
    function drop() { if (box.translations) delete box.translations[lang]; }
    cur.fakeModel = null;
    if (v !== 'finishNow' && v !== 'fresh') cancel(lang);
    switch (v) {
      case 'empty': drop(); setLang(lang); break;
      case 'first': drop(); setLang(lang); $('#trReq').value = DEMO_REQ; start(DEMO_REQ, 12, RUN_MS); break;
      case 'again': if (!savedOf(box, lang)) put('', modelById('m1')); setLang(lang); $('#trReq').value = DEMO_REQ; start(DEMO_REQ, 9, RUN_MS); break;
      case 'done': put('镜头术语用影视行业里的常见说法', modelById('m1')); setLang(lang); break;
      case 'plain': put('', modelById('m2')); setLang(lang); break;
      case 'longModel': cur.fakeModel = LONG_MODEL; put('', LONG_MODEL); setLang(lang); break;
      case 'failConfig': setLang(lang); fail(cur.label, lang, '这个节点没有可用的模型配置，请在面板顶部选一个'); break;
      case 'failApi': setLang(lang); start($('#trReq').value.trim(), 0, 1500, API_ERROR); break;
      case 'closedDone': setLang(lang); start($('#trReq').value.trim(), 26, 2500); dlg.close(); break;
      case 'fresh': LANGS.forEach(cancel); box.translations = {}; setLang(latestLang(box)); break;
      case 'finishNow': Object.keys(jobs).forEach(function (k) { if (jobs[k].box === box) finish(k); }); break;
    }
  }

  /* ─── 事件 ─── */
  dlg.addEventListener('click', function (e) {
    var lb = e.target.closest('[data-lang]');
    if (lb) { setLang(lb.dataset.lang); return; }
    if (e.target.closest('#trRun')) { run(); return; }
    if (e.target.closest('#trCopy')) {
      var t = savedOf(cur.box, lang);
      copyText(t.text, '已复制' + lang + '译文（' + fmtNum(t.text.length) + ' 字）');
      return;
    }
    if (e.target.closest('#trReqToggle')) {
      var on = dlg.classList.toggle('is-req-open');
      $('#trReqToggle').setAttribute('aria-expanded', String(on));
    }
  });
  $('#trReq').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
  });
  $('#trProto').addEventListener('change', function (e) { var v = e.target.value; e.target.value = ''; if (v && cur) proto(v); });
  dlg.addEventListener('close', function () { clearInterval(tick); tick = null; cur = null; });

  return {
    open: function (n, box, imgs) {
      cur = { n: n, box: box, imgs: imgs || [], label: box.label || '提示词', fakeModel: null };
      setLang(latestLang(box));
      if (!dlg.open) dlg.showModal();
      clearInterval(tick);
      tick = setInterval(function () { $$('[data-since]', dlg).forEach(function (s) { s.textContent = secs(+s.dataset.since); }); }, 1000);
      // 常用的是打开就复制走；还没翻过就直接写要求
      if (savedOf(box, lang)) $('#trCopy').focus({ focusVisible: false });
      else if (innerWidth > 720) $('#trReq').focus();
    }
  };
})();

/* ─── 启动 ─────────────────────────────────────────────── */
(function boot() {
  hydrateIcons();
  applyView();
  renderGraph();
  Panel.startBackground();
  var hash = location.hash.replace('#', '');
  var start = /^node=/.test(hash) ? hash.slice(5) : hash === 'translate' ? 'n1' : 'n9';
  if (innerWidth > 720 || /^node=/.test(hash)) {
    G.sel = start;
    document.body.classList.add('drawer-open');
    Panel.open(start);
    renderGraph();
  }
  fitAll(G.sel ? 0.9 : 0);
  if (G.sel) setTimeout(function () { ensureVisible(nodeById(G.sel)); }, 420);
  if (hash === 'assets') Assets.open({ mode: 'slots' });
  if (hash === 'upload') { var n = nodeById('n1'), t = THREADS.n1[1], v = t.versions[t.cur]; Upload.open(n, v.boxes[0], THREADS.n1[0].versions[0].imgs, v); }
  if (hash === 'collage') Collage.open();
  if (hash === 'translate') { var tn = nodeById('n1'), tp = THREADS.n1[1]; Translate.open(tn, tp.versions[tp.cur].boxes[2], THREADS.n1[0].versions[0].imgs); }
  addEventListener('resize', function () { renderEdges(); });
})();
