/* 模型配置表单：首次设置和设置页共用。密钥只写不回显。 */

var MOCK_URL = 'http://127.0.0.1:3799/v1';

function modelFormHTML(c) {
  var p = c.price || { cur: '¥', inp: '', out: '', cache: '' };
  return '' +
    '<div class="mf-grid">' +
      '<div class="field"><label for="mf-name">名字</label><input class="input" id="mf-name" value="' + esc(c.name || '') + '" placeholder="比如：主力" autocomplete="off"><p class="hint is-error" data-err="name" hidden></p></div>' +
      '<div class="field"><label for="mf-model">模型名</label><input class="input mono" id="mf-model" value="' + esc(c.model || '') + '" placeholder="接口认的模型名" autocomplete="off"><p class="hint is-error" data-err="model" hidden></p></div>' +
      '<div class="field mf-wide"><label for="mf-url">接口地址</label><input class="input mono" id="mf-url" value="' + esc(c.url || '') + '" placeholder="https://…/v1" autocomplete="off" spellcheck="false">' +
        '<p class="hint is-error" data-err="url" hidden></p><p class="hint">OpenAI 兼容的接口。不想花钱调真模型，可以先跑假模型，<button type="button" class="linkish" data-mock>填本地假模型的地址</button>。</p></div>' +
      '<div class="field mf-wide" data-od-id="field-api-key"><label for="mf-key">密钥</label>' +
        '<div class="mf-keystate" id="mf-keystate"></div>' +
        '<input class="input mono" id="mf-key" type="password" autocomplete="new-password" spellcheck="false" placeholder="' + (c.keySet ? '输入新密钥可以替换，按回车存好' : '粘贴密钥，按回车存好') + '">' +
        '<p class="hint is-error" data-err="key" hidden></p><p class="hint">只存在这台电脑上，不进工作文件夹，另一台电脑要各填一次。存好后输入框会清空，不再显示。</p></div>' +
      '<div class="field"><label for="mf-long">发给模型的图片长边</label><div class="input-group"><input class="input mono" id="mf-long" type="number" min="512" max="4096" step="100" value="' + (c.longSide || 1600) + '"><span class="mf-unit">像素</span></div>' +
        '<p class="hint">另做一份小图发给 AI 看，越大看得越清楚，费用越高。不影响传给 H3 的图。</p></div>' +
    '</div>' +
    '<details class="mf-price"' + (c.price ? ' open' : '') + '><summary><span data-icon="chev-down" data-icon-class="icon-sm chev"></span>价格（可选）<span class="meta">' + (c.price ? p.cur + p.inp + ' / ' + p.cur + p.out + ' / ' + p.cur + p.cache : '没填就不显示花了多少钱') + '</span></summary>' +
      '<div class="mf-price-body">' +
        '<div class="field"><span class="label">币种</span><div class="seg" id="mf-cur"><button type="button" aria-pressed="' + (p.cur === '¥') + '">¥</button><button type="button" aria-pressed="' + (p.cur === '$') + '">$</button></div></div>' +
        '<div class="field"><label for="mf-pin">输入价</label><input class="input mono" id="mf-pin" type="number" min="0" step="0.01" value="' + p.inp + '" placeholder="0"></div>' +
        '<div class="field"><label for="mf-pout">输出价</label><input class="input mono" id="mf-pout" type="number" min="0" step="0.01" value="' + p.out + '" placeholder="0"></div>' +
        '<div class="field"><label for="mf-pcache">缓存命中价</label><input class="input mono" id="mf-pcache" type="number" min="0" step="0.01" value="' + p.cache + '" placeholder="0"></div>' +
        '<p class="hint mf-wide">都按每百万 tokens 填，留空当 0。命中缓存的输入按缓存价算，其余输入按输入价，输出按输出价。</p>' +
      '</div></details>' +
    '<div class="mf-test"><button type="button" class="btn btn-secondary" id="mf-test" data-od-id="btn-test-connection"><span data-icon="plug"></span>测试连接</button><span class="mf-result" id="mf-result" role="status"></span></div>';
}

function bindModelForm(root, c, onChange) {
  hydrateIcons(root);
  var q = function (s) { return root.querySelector(s); };
  function keyState() {
    q('#mf-keystate').innerHTML = c.keySet
      ? '<span class="tag tag-ok">' + icon('check') + '已配置</span><span class="meta">存在这台电脑上</span>'
      : '<span class="tag tag-warn">还没配置</span>';
  }
  keyState();
  function changed() { onChange && onChange(read()); }
  function read() {
    c.name = q('#mf-name').value.trim();
    c.model = q('#mf-model').value.trim();
    c.url = q('#mf-url').value.trim();
    c.longSide = +q('#mf-long').value || 1600;
    var inp = q('#mf-pin').value, out = q('#mf-pout').value, cache = q('#mf-pcache').value;
    var cur = q('#mf-cur [aria-pressed="true"]').textContent;
    c.price = inp || out || cache ? { cur: cur, inp: +inp || 0, out: +out || 0, cache: +cache || 0 } : null;
    return c;
  }
  function err(name, msg) {
    var h = q('[data-err="' + name + '"]'), input = q('#mf-' + name);
    h.hidden = !msg;
    h.textContent = msg || '';
    if (input) input.classList.toggle('is-error', !!msg);
  }
  function storeKey() {
    var k = q('#mf-key');
    if (!k.value) return false;
    var replaced = c.keySet;
    k.value = '';
    c.keySet = true;
    keyState();
    k.placeholder = '输入新密钥可以替换，按回车存好';
    toast(replaced ? '密钥已替换' : '密钥已存到这台电脑');
    return true;
  }

  root.addEventListener('change', function (e) { if (e.target.id === 'mf-key' && storeKey()) changed(); });
  root.addEventListener('keydown', function (e) { if (e.target.id === 'mf-key' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  root.addEventListener('input', function (e) {
    if (e.target.id === 'mf-key') { err('key', ''); return; }
    if (e.target.classList.contains('is-error')) err(e.target.id.replace('mf-', ''), '');
    changed();
  });
  root.addEventListener('click', function (e) {
    if (e.target.closest('[data-mock]')) { q('#mf-url').value = MOCK_URL; if (!q('#mf-model').value) q('#mf-model').value = 'mock-llm'; err('url', ''); changed(); toast('填好了。记得另开一个终端跑 npm run mock-llm'); }
    var seg = e.target.closest('#mf-cur button');
    if (seg) { root.querySelectorAll('#mf-cur button').forEach(function (b) { b.setAttribute('aria-pressed', b === seg); }); changed(); }
    if (e.target.closest('#mf-test')) test();
  });

  function test() {
    read();
    var r = q('#mf-result');
    var typed = !!q('#mf-key').value;
    if (!/^https?:\/\//.test(c.url)) { r.innerHTML = '<span class="tag tag-danger">' + icon('x') + '连不上</span> 接口地址要以 http:// 或 https:// 开头'; return; }
    if (!c.keySet && !typed) { r.innerHTML = '<span class="tag tag-danger">' + icon('x') + '还没填密钥</span>'; return; }
    r.innerHTML = '<span class="spinner"></span> 正在连接…';
    setTimeout(function () {
      if (c.url.indexOf('3799') >= 0) r.innerHTML = '<span class="tag tag-ok">' + icon('check') + '连得上</span> 本地假模型 · <span class="mono">38 ms</span>';
      else if (/wrong|bad/.test(c.url)) r.innerHTML = '<span class="tag tag-danger">' + icon('x') + '连不上</span> <span class="mono">401</span> 密钥不对或没有权限';
      else r.innerHTML = '<span class="tag tag-ok">' + icon('check') + '连得上</span> 找到模型 <span class="mono">' + esc(c.model || '（没填模型名）') + '</span> · <span class="mono">612 ms</span>';
    }, 900);
  }

  return {
    read: read,
    storeKey: storeKey,
    validate: function () {
      read();
      var ok = true;
      if (!c.name) { err('name', '起个名字，节点里靠它选'); ok = false; }
      if (!c.model) { err('model', '填接口认的模型名'); ok = false; }
      if (!/^https?:\/\//.test(c.url)) { err('url', '接口地址要以 http:// 或 https:// 开头'); ok = false; }
      if (!c.keySet && !q('#mf-key').value) { err('key', '还没填密钥'); ok = false; }
      return ok;
    }
  };
}
