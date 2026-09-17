/* 提示词画布 · 共用脚本：主题、图标、提示条、菜单、确认框、自动保存状态 */
(function () {
  var saved = null;
  try { saved = localStorage.getItem('pc-theme'); } catch (e) {}
  document.documentElement.setAttribute('data-theme', saved || 'dark');
})();

var ICONS = {
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  translate: '<path d="M6 8.6l5.1 5.1M5.2 13.7l5.1-5.1 1.7-2.55M3.5 5.2h10.2M7.75 2.65h.85M20.5 20.5l-4.25-8.5-4.25 8.5M13.7 18.4h5.1"/>',
  edit: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-4-4l-10 10z"/><path d="M13.5 6.5l4 4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.4"/>',
  branch: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="8.5" r="2"/><path d="M6 7.5v9M18 10.5c0 4-5 3.5-10.5 6.5"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/>',
  more: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  'chev-left': '<path d="M14.5 6l-6 6 6 6"/>',
  'chev-right': '<path d="M9.5 6l6 6-6 6"/>',
  'chev-down': '<path d="M6 9.5l6 6 6-6"/>',
  undo: '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H15a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l4.5-4.5L15 5"/><path d="M19.5 9.5H9a5 5 0 0 0 0 10h3"/>',
  layout: '<rect x="3.5" y="9.5" width="6" height="5" rx="1.2"/><rect x="14.5" y="4" width="6" height="5" rx="1.2"/><rect x="14.5" y="15" width="6" height="5" rx="1.2"/><path d="M9.5 12h2.5v-5.5h2.5M12 12v5.5h2.5"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  folder: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  'folder-plus': '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M12 11v5M9.5 13.5h5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-9 8.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.5-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.5z"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  retry: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9"/><path d="M19.5 4.5V9H15"/><path d="M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15"/><path d="M4.5 19.5V15H9"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
  reveal: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5V12"/><path d="M3.5 7.5v10A1.5 1.5 0 0 0 5 19h6"/><circle cx="16.5" cy="16.5" r="3"/><path d="M21 21l-2.3-2.3"/>',
  collapse: '<path d="M4 14h6v6M20 10h-6V4M14 10l6-6M4 20l6-6"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6"/>',
  grip: '<circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
  doc: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4M9 12h6M9 15.5h6"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5l8-8M16 7l2.5 2.5M13.5 9.5l2 2"/>',
  plug: '<path d="M9 3.5V8M15 3.5V8M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5v4"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14 4.5v15"/>',
  at: '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  node: '<rect x="3.5" y="5" width="8" height="6" rx="1.5"/><rect x="12.5" y="13" width="8" height="6" rx="1.5"/><path d="M11.5 8h2.5a2 2 0 0 1 2 2v3"/>',
  logo: '<path d="M4 5.5h7v5H4zM13 13.5h7v5h-7z"/><path d="M11 8h3.5a2 2 0 0 1 2 2v3.5"/>',
  sparkle: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4"/>',
  wand: '<path d="M4.5 19.5l11-11M14 5l.8-1.8L16.5 4l-.8-1.7M19 9.5l1.8-.8L20 7M17.5 3.5v0"/>',
  swap: '<path d="M7 4.5L3.5 8 7 11.5M3.5 8H16M17 12.5l3.5 3.5-3.5 3.5M20.5 16H8"/>',
  hash: '<path d="M9 4L7.5 20M16.5 4L15 20M4.5 9h15.5M4 15h15.5"/>',
  warn: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.5h.01"/>'
};

function icon(name, cls) {
  return '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, el.dataset.iconClass));
    el.dataset.iconDone = '1';
  });
}

var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function fmtNum(n) { return Number(n).toLocaleString('en-US'); }

/* 主题 */
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('pc-theme', t); } catch (e) {}
  $$('[data-theme-toggle]').forEach(syncThemeBtn);
}
function syncThemeBtn(btn) {
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = icon(dark ? 'sun' : 'moon');
  btn.title = dark ? '切到亮色' : '切到暗色';
  btn.setAttribute('aria-label', btn.title);
}

/* 提示条 */
function toast(msg, opts) {
  opts = opts || {};
  var wrap = $('.toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toasts'; wrap.setAttribute('role', 'status'); wrap.setAttribute('popover', 'manual'); document.body.appendChild(wrap); }
  // 弹窗开着时它在最上层，提示条要重新放到最上层，不然会被弹窗的遮罩盖住
  if (wrap.showPopover) { try { wrap.hidePopover(); } catch (e) {} try { wrap.showPopover(); } catch (e) {} }
  var el = document.createElement('div');
  el.className = 'toast' + (opts.tone ? ' is-' + opts.tone : '');
  el.innerHTML = '<span class="toast-dot"></span><span>' + msg + '</span>';
  if (opts.action) {
    var b = document.createElement('button');
    b.className = 'btn btn-ghost btn-sm'; b.textContent = opts.action;
    b.onclick = function () { opts.onAction && opts.onAction(); el.remove(); };
    el.appendChild(b);
  }
  wrap.appendChild(el);
  setTimeout(function () { el.style.transition = 'opacity .2s'; el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 220); }, opts.ms || 2800);
}

/* 下拉菜单：items = [{label, icon, danger, note, sep, onClick}] */
var openMenuEl = null;
function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
function showMenu(anchor, items, align) {
  closeMenu();
  var m = document.createElement('div');
  m.className = 'menu'; m.setAttribute('role', 'menu');
  items.forEach(function (it) {
    if (it.sep) { m.appendChild(document.createElement('hr')); return; }
    if (it.note) { var n = document.createElement('div'); n.className = 'menu-note'; n.textContent = it.note; m.appendChild(n); return; }
    var b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    if (it.danger) b.className = 'is-danger';
    b.innerHTML = (it.icon ? icon(it.icon) : '') + '<span>' + it.label + '</span>';
    b.onclick = function (e) { e.stopPropagation(); closeMenu(); it.onClick && it.onClick(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  var r = anchor.getBoundingClientRect();
  var w = m.offsetWidth, h = m.offsetHeight;
  var left = align === 'left' ? r.left : r.right - w;
  var top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = r.top - h - 6;
  m.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + 'px';
  m.style.top = Math.max(8, top) + 'px';
  openMenuEl = m;
}
document.addEventListener('pointerdown', function (e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

/* 确认框 */
function confirmBox(o) {
  var d = document.createElement('dialog');
  d.className = 'dialog';
  d.innerHTML =
    '<div class="dialog-head"><h2>' + o.title + '</h2></div>' +
    '<div class="dialog-body"><p class="muted" style="font-size:13.5px">' + o.body + '</p></div>' +
    '<div class="dialog-foot"><button class="btn btn-secondary" value="cancel">' + (o.cancel || '取消') + '</button>' +
    '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" value="ok">' + o.ok + '</button></div>';
  document.body.appendChild(d);
  d.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { d.close(b.value); };
  });
  d.addEventListener('close', function () { if (d.returnValue === 'ok') o.onOk && o.onOk(); d.remove(); });
  d.showModal();
  d.querySelector('[value="ok"]').focus();
}

/* 自动保存状态：没有保存按钮，改动后显示正在写入 → 已写入 */
function markSaved() {
  $$('.save-state').forEach(function (el) {
    el.classList.add('is-writing');
    el.querySelector('.save-text').textContent = '正在写入工作文件夹…';
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      var d = new Date();
      var p = function (n) { return String(n).padStart(2, '0'); };
      el.classList.remove('is-writing');
      el.querySelector('.save-text').textContent = '已写入 ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }, 650);
  });
}

function copyText(text, label) {
  var done = function () { toast(label || '已复制'); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, done);
  else {
    var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    t.remove(); done();
  }
}

document.addEventListener('DOMContentLoaded', function () {
  hydrateIcons();
  $$('[data-theme-toggle]').forEach(function (b) {
    syncThemeBtn(b);
    b.addEventListener('click', function () {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  });
});
