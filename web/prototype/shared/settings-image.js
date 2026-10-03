/* 设置页 · 第三批加的几块：思考、ComfyUI、底模和默认值、工作流、词库、片段库、出的图 */

var SPROTO = (location.search.match(/proto=(\w+)/) || [])[1] || '';

/* 两套自带的生图系统提示词（原型里的示意稿，正式的在 P9 写） */
var IMAGE_PROMPT_TEXT = {
  il: '---\n用途: 生图\n底模: IL\n---\n\n# Illustrious 系列生图标签写手\n\n你替用户写交给 Illustrious（IL）系列底模的生图提示词。用户用中文说想要什么样的图，可能附几张参考图（程序按 <Picture 1>、<Picture 2> 编号发给你）。你写出的是一串 Danbooru 标准标签。\n\n## 标签怎么写\n\n- 只用 Danbooru 上的标准标签，英文，用英文逗号隔开。\n- 下划线写成空格；标签名里的括号写成 \\( 和 \\)，比如 watercolor \\(medium\\)。\n- 按这个顺序排：人数、角色、作品、外观、服装、表情和动作、构图、背景、画风。越靠前影响越大。\n- 要加强或减弱某个标签，写成 (tag:1.2)，只在真的需要时用。\n- 不写 masterpiece、best quality 这类质量词，也不写评级词，程序会按系列自动加。\n\n## 怎么和用户对话\n\n- 用中文交流。需求不清楚时不要反问，先按你的理解写一版，把假设写在框外面。\n- 能看图时，照着槽位里的图写外观、服装和构图。\n- 用户要几个方向，就给几个框，每个框标一句它和别的方向的区别。\n- 修改时只动用户要求的地方，其他标签保持不变。',
  pony: '---\n用途: 生图\n底模: Pony\n---\n\n# Pony 系列生图标签写手\n\n你替用户写交给 Pony Diffusion 系列底模的生图提示词。规则和 IL 那套一样，只用 Danbooru 标准标签。\n\n## 和 IL 不一样的地方\n\n- 不写 score_9、score_8_up 这些开头，程序会加。\n- 不写 rating_safe 这类评级词，程序按出图设置加。\n- Pony 对画师标签不敏感，用户要某种画风时，优先用描述画风的通用标签。',
  'il-厚涂': '---\n用途: 生图\n底模: IL\n---\n\n# Illustrious 系列生图标签写手（厚涂画风）\n\n复制自「il」，多加了一条：\n\n- 每个方向最后都加上 thick painting 风格的几个标签，光影写得重一点。'
};
var FORMAT_REQUIREMENT_IMAGE = '输出格式要求（生图）：\n\n1. 每个方向的标签单独放进一个提示词框：框以单独一行 <prompt> 开始，以单独一行 </prompt> 结束。框里只放英文标签，用英文逗号隔开，不写别的。\n2. 一次给出几个方向时，在开始标签里写一句简短标签说明这个方向，例如 <prompt label="方向一：窗台侧坐，光束">。\n3. 这个对话的第一次回复，在正文最前面单独一行给出标题：<title>标题</title>，不超过 12 个字，概括这张图。后面的回复不用再给。\n4. 假设、说明、给用户的话都写在框外面，用中文。';

var SImg = (function () {
  function head(t, p, extra) { return '<div class="st-head"><div><h2>' + t + '</h2><p>' + p + '</p></div>' + (extra || '') + '</div>'; }
  function where(s) { return '<span class="tag sx-where">' + icon(s === '本机' ? 'lock' : 'folder') + (s === '本机' ? '只存在这台电脑上' : '存在工作文件夹，两台电脑共用') + '</span>'; }
  function seg(id, list, v) { return '<div class="seg" id="' + id + '">' + list.map(function (x) { return '<button aria-pressed="' + (x === v) + '" data-v="' + x + '">' + x + '</button>'; }).join('') + '</div>'; }
  function bindSeg(id, fn) { $('#' + id).onclick = function (e) { var b = e.target.closest('button'); if (!b) return; $$('#' + id + ' button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); fn(b.dataset.v); markSaved(); }; }

  /* ─── 思考 ─── */
  function thinking(main) {
    var lv = ['关', '低', '中', '高'], opts = ['跟总开关'].concat(lv);
    var use = function (k, name, note) {
      return '<div class="kv-row"><span class="k">' + name + '</span><div class="stack" style="gap:4px"><select class="select" style="width:200px" data-use="' + k + '">' + opts.map(function (o) { return '<option' + (THINK.uses[k] === o ? ' selected' : '') + '>' + o + (o === '跟总开关' ? '（现在是「' + THINK.level + '」）' : '') + '</option>'; }).join('') + '</select><span class="hint">' + note + '</span></div></div>';
    };
    main.innerHTML = head('思考', '有的模型回答前会先想一会儿。想得越深越慢，花的钱也越多（想的部分按输出算钱）。这里管想不想、想多深。', where('共用')) +
      '<section class="card editor" data-od-id="thinking-settings"><div class="kv">' +
        '<div class="kv-row"><span class="k">总档位</span><div class="stack" style="gap:6px">' + seg('thLevel', lv, THINK.level) + '<span class="hint">下面选「跟总开关」的用途都按这一档。只能开关、调不了深浅的模型，低中高都当「开」。</span></div></div>' +
        use('write', '写提示词', '节点里聊天时。默认跟总开关。开了思考，回复前会先显示「正在思考 N 秒」，想完才出正文。') +
        use('translate', '翻译', '提示词框上的「翻译」。默认关，翻译用不着想，快也省钱。') +
        use('toTags', '转标签', '标签编辑窗里「让 AI 转成标签」。默认关，几秒就该回来。') +
      '</div></section>' +
      '<section class="card editor" style="margin-top:16px" data-od-id="thinking-model-styles"><h3 style="margin-bottom:4px">每套模型配置怎么开思考</h3><p class="hint" style="margin-bottom:12px">各家开思考的写法不一样，在每套模型配置里选「开思考的写法」。选「不支持」的，上面的档位对它不起作用。</p>' +
        '<div class="sx-list">' + MODELS.map(function (m) {
          return '<div class="sx-row"><b>' + esc(m.name) + '</b><span class="mono meta">' + esc(m.model) + '</span><span class="tag mono">' + esc(m.think || '不支持') + '</span>' +
            '<span class="meta grow">' + ({ '不支持': '什么都不发', reasoning_effort: '低中高发 low / medium / high，不发回思考原文', enable_thinking: '关发 false；低中高发 true 加思考预算，会发回思考原文', 'thinking.type': '关发 disabled，低中高都发 enabled', '换模型名': '关用「' + m.model + '」，低中高换成「' + (m.thinkModel || '') + '」，会发回思考原文' })[m.think || '不支持'] + '</span>' +
            '<a class="btn btn-ghost btn-sm" href="#models" data-sel="' + m.id + '">改</a></div>';
        }).join('') + '</div></section>';
    bindSeg('thLevel', function (v) { THINK.level = v; thinking(main); toast('总档位改成「' + v + '」'); });
    $$('[data-use]').forEach(function (s) { s.onchange = function () { THINK.uses[s.dataset.use] = s.value.replace(/（.*$/, ''); markSaved(); }; });
    $$('[data-sel]').forEach(function (a) { a.onclick = function () { window.selModel = a.dataset.sel; }; });
  }

  /* ─── ComfyUI 和 AutoDL ─── */
  function comfy(main) {
    var a = COMFY.autodl, l = COMFY.lan;
    var test = SPROTO === 'comfyFail' ? '<span class="tag tag-danger">' + icon('x') + '连不上</span> <span class="mono meta">connect ECONNREFUSED 192.168.1.20:8188</span>：地址不对，或者那台电脑上 ComfyUI 没开。' : '';
    var adState = a.state === 'running' ? '<span class="tag tag-warn">' + icon('power') + '运行中 · 在扣钱</span><span class="meta">开了 <span class="mono">' + (a.upMin || 23) + '</span> 分钟 · <span class="mono">' + a.idleLeft + '</span> 分钟后自动关机</span>' :
      a.state === 'booting' ? '<span class="tag tag-accent"><span class="spinner"></span>正在开机</span><span class="meta">等了 <span class="mono" data-since="' + a.since + '">' + Math.round((Date.now() - a.since) / 1000) + ' 秒</span></span>' :
      a.state === 'failed' ? '<span class="tag tag-danger">' + icon('x') + '开机失败</span>' : '<span class="tag">已关机</span><span class="meta">关机时只收系统盘的钱，每天 ¥0.1</span>';
    main.innerHTML = head('ComfyUI', '出图的程序跑在有显卡的电脑上，这台只有核显。两台都能接：局域网里那台，和 AutoDL 上租的实例。出图用哪台随时能切，所有节点共用。') +
      '<section class="card editor" data-od-id="comfy-source"><div class="row-between" style="margin-bottom:6px"><h3>出图用哪台</h3>' + where('本机') + '</div>' +
        '<div class="row" style="flex-wrap:wrap">' + seg('cfUse', ['局域网那台', 'AutoDL 实例'], COMFY.use === 'lan' ? '局域网那台' : 'AutoDL 实例') + '<span class="hint">两台电脑可能不在同一个网络里，所以各自记一份。</span></div></section>' +
      '<section class="card editor" style="margin-top:16px" data-od-id="comfy-lan"><div class="row-between" style="margin-bottom:10px"><h3>局域网那台</h3>' + where('共用') + '</div>' +
        '<div class="field"><label for="cfUrl">地址</label><div class="input-group"><input class="input mono" id="cfUrl" value="' + esc(l.url) + '" spellcheck="false"><button class="btn btn-secondary" id="cfTest">' + icon('plug') + '测试连接</button></div>' +
        '<p class="hint">那台电脑上 ComfyUI 启动时要加 <span class="mono">--listen</span>，局域网里才连得上。</p></div>' +
        '<div class="mf-test" id="cfResult" style="margin-top:12px">' + (test || '<span class="tag tag-ok">' + icon('check') + '连得上</span><span class="meta">ComfyUI <span class="mono">' + l.version + '</span> · ' + esc(l.gpu) + ' · 显存 <span class="mono">' + l.vram + '</span> · 上次测试 10月3日 16:20</span>') + '</div></section>' +
      '<section class="card editor" style="margin-top:16px" data-od-id="comfy-autodl"><div class="row-between" style="margin-bottom:10px"><h3>AutoDL 实例</h3><span class="row" style="gap:6px">' + where('本机').replace('只存在这台电脑上', 'Token 只存在这台电脑上') + '</span></div>' +
        '<div class="kv">' +
          '<div class="kv-row"><span class="k">开发者 Token</span><div class="stack" style="gap:6px" data-od-id="field-autodl-token"><div class="mf-keystate">' + (a.tokenSet ? '<span class="tag tag-ok">' + icon('check') + '已配置</span><span class="meta">存在这台电脑上</span>' : '<span class="tag tag-warn">还没配置</span>') + '</div>' +
            '<input class="input mono" id="adToken" type="password" autocomplete="new-password" spellcheck="false" placeholder="' + (a.tokenSet ? '输入新 Token 可以替换，按回车存好' : '粘贴 Token，按回车存好') + '">' +
            '<span class="hint">在 AutoDL 控制台「设置 → 开发者 Token」里拿。存好后输入框会清空，不再显示，另一台电脑要各填一次。</span></div></div>' +
          '<div class="kv-row"><span class="k">实例</span><div class="stack" style="gap:6px"><select class="select" id="adInst"><option>' + esc(a.instance + ' · ' + a.region + ' · ' + a.gpu + ' · ' + a.price) + '</option><option>旧的 SD 实例 · 华北A区 · RTX 3090 · 已经关机 58 天，再关 2 天会被释放</option></select><span class="hint">填了 Token 后列出账号下的实例。ComfyUI 要跑在实例的 6006 端口上。</span></div></div>' +
          '<div class="kv-row"><span class="k">状态</span><div class="stack" style="gap:8px"><div class="row" style="flex-wrap:wrap">' + adState + '</div>' +
            (a.state === 'failed' ? '<div class="cf-err">' + esc(Comfy.errText(a.error)) + '</div>' : '') +
            '<div class="row">' + (a.state === 'running' ? '<button class="btn btn-secondary" id="adOff">' + icon('power') + '现在关机</button>' : a.state === 'booting' ? '<button class="btn btn-secondary" id="adCancel">别开了</button>' : '<button class="btn btn-secondary" id="adOn">' + icon('power') + '开机</button>') + '</div></div></div>' +
          '<div class="kv-row"><span class="k">空闲多久自动关机</span><div class="stack" style="gap:6px"><div class="input-group" style="width:160px"><input class="input mono" id="adIdle" type="number" min="5" max="240" value="' + a.idleMin + '"><span class="mf-unit">分钟</span></div>' +
            '<span class="hint">程序最后一个出图任务结束后开始算。程序是开着的才管得到；按 Ctrl+C 关程序时，如果实例是程序开的，会先关机再退出。程序没开时管不了，记得自己看一眼。</span></div></div>' +
        '</div></section>';
    bindSeg('cfUse', function (v) { COMFY.use = v === '局域网那台' ? 'lan' : 'autodl'; Comfy.render(); });
    $('#cfTest').onclick = function () {
      var r = $('#cfResult'); r.innerHTML = '<span class="spinner"></span> 正在连…';
      setTimeout(function () { r.innerHTML = /192\.168\.1\.20/.test($('#cfUrl').value) && SPROTO !== 'comfyFail' ? '<span class="tag tag-ok">' + icon('check') + '连得上</span><span class="meta">ComfyUI <span class="mono">' + l.version + '</span> · ' + esc(l.gpu) + ' · 显存 <span class="mono">' + l.vram + '</span></span>' : test || '<span class="tag tag-danger">' + icon('x') + '连不上</span> 地址不对，或者那台电脑上 ComfyUI 没开。'; }, 900);
    };
    $('#cfUrl').oninput = function () { l.url = this.value; markSaved(); };
    $('#adToken').onchange = function () { if (!this.value) return; this.value = ''; var had = a.tokenSet; a.tokenSet = true; comfy(main); toast(had ? 'Token 已替换' : 'Token 已存到这台电脑'); };
    $('#adToken').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } };
    $('#adIdle').oninput = function () { a.idleMin = +this.value || 15; markSaved(); };
    if ($('#adOn')) $('#adOn').onclick = function () { Comfy.boot(function () { comfy(main); }); comfy(main); };
    if ($('#adOff')) $('#adOff').onclick = function () { a.state = 'off'; Comfy.render(); comfy(main); toast('AutoDL 实例已关机'); };
    if ($('#adCancel')) $('#adCancel').onclick = function () { a.state = 'off'; Comfy.render(); comfy(main); };
  }

  /* ─── 底模和默认值 ─── */
  function checkpoints(main) {
    var S = function (sr) {
      var d = SERIES[sr];
      var f = function (id, label, val, note, mono, wide) { return '<div class="field' + (wide ? ' mf-wide' : '') + '"><label for="' + id + '">' + label + '</label>' + (wide ? '<textarea class="textarea mono sx-ta" id="' + id + '" rows="2">' + esc(val) + '</textarea>' : '<input class="input' + (mono ? ' mono' : '') + '" id="' + id + '" value="' + esc(val) + '">') + '<p class="hint">' + note + '</p></div>'; };
      var m = function (id, label, val, list, note) { return '<div class="field"><label for="' + id + '">' + label + '</label><select class="select mono sx-sel" id="' + id + '">' + list.map(function (x) { return '<option' + (x === val ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select><p class="hint">' + note + '</p></div>'; };
      return '<section class="card editor" data-od-id="series-defaults-' + sr.toLowerCase() + '"><div class="row-between" style="margin-bottom:12px"><h3>' + sr + ' 系列的默认值</h3><span class="meta">新建生图节点时按这个填，节点里还能各自改</span></div>' +
        '<div class="mf-grid">' +
          f(sr + 'pre', '固定开头', d.prefix, '出图时加在正面提示词最前面。提示词框里不显示，也不用写。', true, true) +
          f(sr + 'neg', '默认负面词', d.neg, '不想在图里出现的东西。节点的出图设置里还能再加。', true, true) +
          '<div class="field mf-wide"><span class="label">评级词的写法</span><div class="sx-rate">' + ['全年龄', '擦边', '成人'].map(function (r) { return '<label><span class="meta">' + r + '</span><input class="input mono" value="' + d.rating[r] + '"></label>'; }).join('') + '</div><p class="hint">出图设置里选了评级，就把对应的词加在固定开头后面。</p></div>' +
          f(sr + 'st', '步数', d.steps, '画多少步。越多越细，也越慢。', true) +
          f(sr + 'cfg', 'CFG', d.cfg, '提示词管得多严。太高画面会发硬。', true) +
          m(sr + 'sa', '采样器', d.sampler, SAMPLERS, '画的算法，换了画风会有点变化。') +
          m(sr + 'sc', '调度器', d.scheduler, SCHEDULERS, '每一步画多少的节奏。') +
          f(sr + 'clip', 'clip skip', d.clip, '这两个系列都要设 2，不设出来是糊的。', true) +
          '<div class="mf-wide sx-sub">放大、参考图用的模型</div>' +
          m(sr + 'up', '放大模型', d.upscale, ['4x-AnimeSharp.pth', 'RealESRGAN_x4plus_anime_6B.pth', '4x-UltraSharp.pth'], '放大时先用它放大，再补细节。') +
          m(sr + 'cn', '姿势参考用的 ControlNet', d.cn, ['illustriousXL_openpose_v1.safetensors', 'noobaiXL_openpose.safetensors', 'xinsir_controlnet-openpose-sdxl-1.0.safetensors'], sr === 'IL' ? '推荐 Illustrious-XL ControlNet Openpose；NoobAI 一路的底模用 NoobAI-XL 的。' : 'Pony 没有专门的，用通用 SDXL 的 openpose（比如 xinsir 出的），效果差一些。') +
          m(sr + 'ipa', '画风参考用的 IP-Adapter', d.ipa, ['noobIPAMARK1_mark1.safetensors', 'ip-adapter-plus_sdxl_vit-h.safetensors'], sr === 'IL' ? '推荐 NoobAI 的 IP-Adapter。' : '推荐通用 SDXL 的 ip-adapter-plus_sdxl_vit-h。') +
          m(sr + 'cv', '配套的 CLIP Vision', d.clipv, ['CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors', 'CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors'], '要和上面的 IP-Adapter 配套。') +
        '</div></section>';
    };
    main.innerHTML = head('底模和默认值', '这些很少改，但要能改。底模和模型的列表是从 ComfyUI 读来的，两台装的可能不一样。', where('共用')) +
      '<section class="card editor" data-od-id="checkpoint-series"><div class="row-between" style="margin-bottom:6px"><h3>读到的底模各属哪个系列</h3><button class="btn btn-secondary btn-sm" id="ckRefresh">' + icon('refresh') + '从' + (COMFY.use === 'lan' ? '局域网那台' : 'AutoDL 实例') + '重新读</button></div>' +
        '<p class="hint" style="margin-bottom:10px">生图节点的底模下拉只列这个系列的。没标过的按文件名猜：名字里有 pony 的当 Pony，其他当 IL。猜错了在这里改。</p>' +
        '<div class="sx-list">' + CHECKPOINTS.map(function (c, i) {
          return '<div class="sx-row"><span class="mono grow sx-ck">' + esc(c.name) + '</span>' + (c.guessed ? '<span class="tag">按文件名猜的</span>' : '') +
            '<div class="seg" data-ck="' + i + '"><button aria-pressed="' + (c.series === 'IL') + '">IL</button><button aria-pressed="' + (c.series === 'Pony') + '">Pony</button></div></div>';
        }).join('') + '</div>' +
        '<div class="row" style="margin-top:12px;flex-wrap:wrap;gap:12px"><span class="label">反推用的模型</span><select class="select mono" style="width:auto" id="tagger"><option>wd-eva02-large-tagger-v3</option><option>wd-vit-tagger-v3</option><option>wd-swinv2-tagger-v3</option></select><span class="hint">WD14 Tagger 插件里的模型，标签编辑窗「从图反推」用它。</span></div></section>' +
      '<div class="sx-two">' + S('IL') + S('Pony') + '</div>';
    $$('[data-ck]').forEach(function (s) { s.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; var c = CHECKPOINTS[+s.dataset.ck]; c.series = b.textContent; c.guessed = false; checkpoints(main); markSaved(); toast(c.name + ' 标成了 ' + c.series); }; });
    $('#ckRefresh').onclick = function () { var b = this; b.innerHTML = '<span class="spinner"></span>正在读…'; setTimeout(function () { checkpoints(main); toast('读到 6 个底模、5 个 LoRA、3 个放大模型'); }, 900); };
  }

  /* ─── 工作流 ─── */
  function workflows(main) {
    main.innerHTML = head('工作流', '出图的步骤。内置的基础流程不用管；你在 ComfyUI 里搭好的流程可以导进来，程序只往里填提示词、种子、尺寸，其他照原样。', '<button class="btn btn-primary" id="wfImport">' + icon('plus') + '导入工作流…</button>') +
      '<div class="sx-list" data-od-id="workflow-list">' + WORKFLOWS.map(function (w) {
        if (w.builtin) return '<div class="card sx-wf"><div class="sx-wf-top"><b>内置基础流程</b><span class="tag">自带</span></div><p class="hint">底模 → LoRA → 正负面提示词 → 空白画布 → 采样 → 出图。只用 ComfyUI 自带的节点。放大、修脸、参考图生图都只用这套。</p></div>';
        return '<div class="card sx-wf" data-wf="' + w.id + '"><div class="sx-wf-top"><b class="sx-wf-name">' + esc(w.name) + '</b><span class="mono meta">' + esc(w.file) + ' · ' + w.at + ' 导入</span><span class="grow"></span>' +
          '<button class="btn btn-ghost btn-sm" data-wfa="rename">' + icon('edit') + '改名</button><button class="btn btn-ghost btn-sm" data-wfa="map">' + icon('sliders') + '重新指定往哪填</button><button class="btn btn-danger-ghost btn-sm" data-wfa="del">' + icon('trash') + '删除</button></div>' +
          '<div class="sx-map">' + [['正面提示词', w.map.pos], ['负面提示词', w.map.neg], ['种子', w.map.seed], ['尺寸', w.map.size]].map(function (r) { return '<span class="meta">' + r[0] + '</span><span class="mono">' + (r[1] ? esc(r[1]) : '<span class="meta">不填，照工作流里原来的</span>') + '</span>'; }).join('') + '</div>' +
          (w.needs.length ? '<div class="up-alert is-warn" style="margin:10px 0 0">' + icon('warn') + '<span>局域网那台 ComfyUI 上缺插件 <b>' + w.needs.join('、') + '</b>，用这个工作流出图时会拦下来，不发。装好后去 ComfyUI 一节重新读列表。</span></div>' : '') + '</div>';
      }).join('') + '</div>';
    $('#wfImport').onclick = function () { importDlg(SPROTO === 'wfBad' ? 'bad' : SPROTO === 'wfMap' ? 'map' : 'ok'); };
    $$('[data-wfa]').forEach(function (b) { b.onclick = function () {
      var w = WORKFLOWS.filter(function (x) { return x.id === b.closest('[data-wf]').dataset.wf; })[0];
      if (b.dataset.wfa === 'del') confirmBox({ title: '删除「' + esc(w.name) + '」？', body: '用这个工作流的节点会换回内置基础流程。已经出过的图和参数不受影响。', ok: '删除', danger: true, onOk: function () { WORKFLOWS.splice(WORKFLOWS.indexOf(w), 1); workflows(main); toast('删掉了'); } });
      if (b.dataset.wfa === 'map') importDlg('remap', w);
      if (b.dataset.wfa === 'rename') { var nm = b.closest('.sx-wf').querySelector('.sx-wf-name'); var inp = document.createElement('input'); inp.className = 'input'; inp.style.width = '220px'; inp.value = w.name; nm.replaceWith(inp); inp.focus(); inp.select(); var fin = function () { w.name = inp.value.trim() || w.name; workflows(main); markSaved(); }; inp.onblur = fin; inp.onkeydown = function (e) { if (e.key === 'Enter') fin(); }; }
    }; });
  }
  /* 导入窗口：ok 自动认出；bad 格式不对；map / remap 认不出或有几个候选，列出节点让他选 */
  var NODES = [
    ['3', 'KSampler', 'KSampler'], ['6', 'CLIPTextEncode', '正面 · 角色'], ['7', 'CLIPTextEncode', '负面'], ['12', 'CLIPTextEncode', '正面 · 背景'],
    ['5', 'EmptyLatentImage', '空白画布'], ['21', 'KSamplerAdvanced', '高清修复第二段'], ['30', 'LoadImage', '参考图']
  ];
  function importDlg(mode, w) {
    var d = document.createElement('dialog'); d.className = 'dialog'; d.style.width = 'min(640px, calc(100vw - 32px))'; d.setAttribute('data-od-id', 'dialog-import-workflow');
    var file = mode === 'bad' ? 'my-workflow.json' : mode === 'remap' ? w.file : 'regional-3girls-api.json';
    var pick = function (field, cands, sel, req) {
      return '<div class="field"><label>' + field + (req ? '' : '<span class="muted">（可以不填）</span>') + '</label><select class="select mono">' + (req ? '' : '<option>不填，照工作流里原来的</option>') +
        cands.map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div>';
    };
    var opts = function (t) { return NODES.filter(function (n) { return n[1] === t || (t === 'KS' && /KSampler/.test(n[1])); }).map(function (n) { return n[0] + ' · ' + n[1] + ' · ' + n[2]; }); };
    var body;
    if (mode === 'bad') body = '<div class="up-alert is-danger">' + icon('warn') + '<span><b>这是普通的工作流文件，不是 API 格式。</b>文件顶层有 <span class="mono">nodes</span> 和 <span class="mono">links</span>，程序要的是「节点号 → 节点内容」那种。</span></div>' +
      '<p style="font-size:13.5px;margin-top:10px">请在 ComfyUI 里这样再存一份：</p><ol class="sx-steps"><li>打开这个工作流。</li><li>菜单「工作流」→「导出（API）」。老版本要先在设置里打开「开发者模式」，按钮叫「Save (API Format)」。</li><li>把存下来的那个 JSON 拿来导入。</li></ol>';
    else if (mode === 'ok') body = '<div class="up-alert is-warn" style="background:var(--ok-soft);border-color:color-mix(in oklch,var(--ok) 35%,transparent)">' + icon('check') + '<span>认出来了，程序会往这几处填：</span></div>' +
      '<div class="sx-map" style="margin-top:8px"><span class="meta">正面提示词</span><span class="mono">6 · CLIPTextEncode · 正面</span><span class="meta">负面提示词</span><span class="mono">7 · CLIPTextEncode · 负面</span><span class="meta">种子</span><span class="mono">3 · KSampler · seed</span><span class="meta">尺寸</span><span class="mono">5 · EmptyLatentImage</span></div>' +
      '<div class="field" style="margin-top:12px"><label>名字</label><input class="input" value="三人区域构图"></div>';
    else body = (mode === 'map' ? '<div class="up-alert is-warn">' + icon('warn') + '<span><b>有几处认不准。</b>工作流里有 3 个 CLIPTextEncode、2 个采样器，程序不知道往哪个填。下面列出了工作流里的节点（节点号 · 类型 · 标题），选一下。正面提示词一定要选，其他可以不填。</span></div>' : '<p class="hint">改了以后，用这个工作流出图时按新的填。</p>') +
      '<div class="stack" style="gap:12px;margin-top:12px">' + pick('正面提示词填进', opts('CLIPTextEncode'), mode === 'remap' ? '6 · CLIPTextEncode · 正面 · 角色' : null, true) + pick('负面提示词填进', opts('CLIPTextEncode'), '7 · CLIPTextEncode · 负面') + pick('种子填进', opts('KS').map(function (x) { return x + (/Advanced/.test(x) ? ' · noise_seed' : ' · seed'); })) + pick('尺寸填进', opts('EmptyLatentImage'), '5 · EmptyLatentImage · 空白画布') + '</div>' +
      '<div class="up-alert is-warn" style="margin-top:12px">' + icon('warn') + '<span>这个工作流用到 <b>ComfyUI-Impact-Pack</b> 的节点，局域网那台上没有。可以先导进来，装好插件后才能出图。</span></div>';
    d.innerHTML = '<div class="dialog-head"><div class="stack" style="gap:2px"><h2>' + (mode === 'remap' ? '重新指定「' + esc(w.name) + '」往哪填' : '导入工作流') + '</h2><span class="meta mono">' + esc(file) + '</span></div></div><div class="dialog-body">' + body + '</div>' +
      '<div class="dialog-foot"><button class="btn btn-secondary" value="cancel">' + (mode === 'bad' ? '知道了' : '取消') + '</button>' + (mode === 'bad' ? '<button class="btn btn-primary" value="again">' + icon('folder') + '选另一个文件…</button>' : '<button class="btn btn-primary" value="ok">' + (mode === 'remap' ? '存' : '导入') + '</button>') + '</div>';
    document.body.appendChild(d); hydrateIcons(d); d.showModal();
    d.querySelectorAll('[value]').forEach(function (b) { b.onclick = function () { d.close(b.value); }; });
    d.addEventListener('close', function () {
      if (d.returnValue === 'ok' && mode !== 'remap') { WORKFLOWS.push({ id: 'wf' + Date.now(), name: mode === 'ok' ? '三人区域构图' : '区域提示词·三人', file: file, at: '10月3日', map: { pos: '6 · CLIPTextEncode · 正面', neg: '7 · CLIPTextEncode · 负面', seed: '3 · KSampler · seed', size: '5 · EmptyLatentImage' }, needs: mode === 'map' ? ['ComfyUI-Impact-Pack'] : [] }); workflows($('#main')); toast('导入了，存在工作文件夹的 workflows 里'); }
      if (d.returnValue === 'ok' && mode === 'remap') toast('存好了');
      if (d.returnValue === 'again') toast('会打开系统的「选择文件」窗口');
      d.remove();
    });
  }

  /* ─── 词库 ─── */
  var LIB_STEPS = ['下标签', '下别名', '下中文对照'];
  function taglib(main) {
    var up = TAGLIB.state === 'updating', bad = TAGLIB.state === 'failed';
    main.innerHTML = head('词库', '本机存的 Danbooru 标签，用来中文搜标签、给标签配中文、查出写错的标签。', where('共用')) +
      '<section class="card editor" data-od-id="tag-library"><div class="kv">' +
        '<div class="kv-row"><span class="k">哪天的</span><span class="mono">' + TAGLIB.at + '</span></div>' +
        '<div class="kv-row"><span class="k">标签</span><span><span class="mono">' + fmtNum(TAGLIB.tags) + '</span> 个 <span class="meta">· Danbooru 上用过 50 次以上的</span></span></div>' +
        '<div class="kv-row"><span class="k">有中文的</span><span><span class="mono">' + fmtNum(TAGLIB.zh) + '</span> 个 <span class="meta">· 按使用次数算 97.8% 有中文；画师大多没有，按原名搜</span></span></div>' +
        '<div class="kv-row"><span class="k">别名</span><span><span class="mono">' + fmtNum(TAGLIB.aliases) + '</span> 条 <span class="meta">· 旧写法会自动换成标准写法</span></span></div>' +
        '<div class="kv-row"><span class="k">来源</span><span class="meta">标签和别名：Danbooru 官方接口；中文：amenorira/danbooru-tags-data-zh（MIT 许可）</span></div>' +
      '</div>' +
      (up ? '<div class="sx-progress" data-od-id="tag-library-progress"><div class="row-between"><b>正在更新词库</b><span class="meta">开始了 <span class="mono" data-since="' + TAGLIB.since + '">' + Math.round((Date.now() - TAGLIB.since) / 1000) + ' 秒</span>，一共大约 4 分钟</span></div>' +
          '<ol class="sx-steps-p">' + LIB_STEPS.map(function (s, i) {
            var st = i < TAGLIB.step ? 'done' : i === TAGLIB.step ? 'now' : 'todo';
            return '<li class="is-' + st + '">' + (st === 'done' ? icon('check', 'icon-sm') : st === 'now' ? '<span class="spinner"></span>' : '<span class="sx-dot"></span>') + '<span>' + s + '</span><span class="meta mono">' +
              (i === 0 ? (st === 'done' ? '124,319 个' : '第 87 页 / 约 125 页') : i === 1 ? (st === 'now' ? '第 23 页 / 约 42 页' : st === 'done' ? '41,281 条' : '') : (st === 'now' ? '5 个文件里的第 2 个' : '')) + '</span></li>';
          }).join('') + '</ol><p class="hint">全部下完才整个换掉，中途失败旧的不动。更新时照样能用，联想先用旧词库。</p></div>' : '') +
      (bad ? '<div class="up-alert is-danger" style="margin-top:14px">' + icon('warn') + '<span><b>更新失败：第 2 步「下别名」出错了。</b>Danbooru 返回 <span class="mono">429 Too Many Requests</span>。旧词库没动，还能照常用。过一会儿再点更新。</span></div>' : '') +
      '<div class="row" style="margin-top:16px">' + (up ? '<button class="btn btn-secondary" id="libStop">停止更新</button>' : '<button class="btn btn-primary" id="libUpdate">' + icon('refresh') + '更新词库</button><span class="hint">Danbooru 天天有新角色。大约要 4 分钟，一页一页按顺序下。</span>') + '</div></section>';
    if ($('#libUpdate')) $('#libUpdate').onclick = function () { TAGLIB.state = 'updating'; TAGLIB.step = 0; TAGLIB.since = Date.now(); taglib(main); };
    if ($('#libStop')) $('#libStop').onclick = function () { TAGLIB.state = 'idle'; taglib(main); toast('停了，旧词库没动'); };
  }

  /* ─── 片段库 ─── */
  function fragments(main) {
    var cats = ['角色', '画风', '质量词', '其他'];
    main.innerHTML = head('片段库', '一小串常用的标签，起个名字存起来，写提示词时在标签编辑窗里搜名字插进去。在编辑窗里挑几个小块就能存成片段。', where('共用')) +
      cats.map(function (c) {
        var list = FRAGMENTS.filter(function (f) { return f.cat === c; });
        return '<section class="sx-fcat" data-od-id="fragments-' + c + '"><h3>' + c + ' <span class="meta mono">' + list.length + '</span></h3>' + (list.length ? list.map(function (f) {
          return '<div class="card sx-frag" data-fid="' + f.id + '"><div class="sx-wf-top"><b>' + esc(f.name) + '</b><span class="meta"><span class="mono">' + Tags.parse(f.text).length + '</span> 个标签</span><span class="grow"></span>' +
            '<select class="select select-sm" data-fcat aria-label="分类">' + cats.map(function (x) { return '<option' + (x === c ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
            '<button class="btn btn-ghost btn-sm" data-fa="rename">' + icon('edit') + '改名</button><button class="btn btn-ghost btn-sm" data-fa="edit">' + icon('tag') + '改内容</button><button class="btn btn-danger-ghost btn-sm" data-fa="del">' + icon('trash') + '删除</button></div>' +
            tagsHTML(f.text) + '</div>';
        }).join('') : '<p class="hint">还没有。</p>') + '</section>';
      }).join('');
    $$('[data-fcat]').forEach(function (s) { s.onchange = function () { var f = FRAGMENTS.filter(function (x) { return x.id === s.closest('[data-fid]').dataset.fid; })[0]; f.cat = s.value; fragments(main); markSaved(); }; });
    $$('[data-fa]').forEach(function (b) { b.onclick = function () {
      var f = FRAGMENTS.filter(function (x) { return x.id === b.closest('[data-fid]').dataset.fid; })[0];
      if (b.dataset.fa === 'del') confirmBox({ title: '删除片段「' + esc(f.name) + '」？', body: '已经插进提示词里的标签不受影响，插进去以后就和片段没关系了。', ok: '删除', danger: true, onOk: function () { FRAGMENTS.splice(FRAGMENTS.indexOf(f), 1); fragments(main); toast('删掉了'); } });
      if (b.dataset.fa === 'rename') { var nm = b.closest('.sx-wf-top').querySelector('b'); var inp = document.createElement('input'); inp.className = 'input'; inp.style.width = '200px'; inp.value = f.name; nm.replaceWith(inp); inp.focus(); inp.select();
        var fin = function () { var v = inp.value.trim(); if (v && v !== f.name && FRAGMENTS.some(function (x) { return x.name === v; })) { toast('已经有叫「' + esc(v) + '」的片段了，换一个名字', { tone: 'warn' }); inp.focus(); return; } f.name = v || f.name; fragments(main); markSaved(); };
        inp.onkeydown = function (e) { if (e.key === 'Enter') fin(); }; inp.onblur = fin; }
      if (b.dataset.fa === 'edit') {
        var d = document.createElement('dialog'); d.className = 'dialog'; d.style.width = 'min(640px, calc(100vw - 32px))';
        d.innerHTML = '<div class="dialog-head"><h2>改「' + esc(f.name) + '」的内容</h2></div><div class="dialog-body"><textarea class="textarea mono" id="frT" rows="4">' + esc(f.text) + '</textarea><div id="frP" style="margin-top:10px"></div><p class="hint" style="margin-top:8px">正式程序里用和节点里一样的标签编辑窗改，打字联想、拖动排序、点小块调权重。</p></div>' +
          '<div class="dialog-foot"><button class="btn btn-secondary" value="cancel">取消</button><button class="btn btn-primary" value="ok">存</button></div>';
        document.body.appendChild(d); d.showModal();
        var p = function () { d.querySelector('#frP').innerHTML = tagsHTML(d.querySelector('#frT').value); }; p(); d.querySelector('#frT').oninput = p;
        d.querySelectorAll('[value]').forEach(function (x) { x.onclick = function () { d.close(x.value); }; });
        d.addEventListener('close', function () { if (d.returnValue === 'ok') { f.text = d.querySelector('#frT').value.trim(); fragments(main); markSaved(); } d.remove(); });
      }
    }; });
  }

  /* ─── 出的图 ─── */
  function images(main) {
    main.innerHTML = head('出的图', '出的图先放在工作文件夹的临时文件夹里，按日期分子文件夹。大多用不上，挑出好的点「下载」存进资产库。', where('共用')) +
      '<section class="card editor" data-od-id="image-temp"><div class="kv">' +
        '<div class="kv-row"><span class="k">临时文件夹</span><span class="row" style="flex-wrap:wrap"><span class="mono">' + esc(IMAGE_TEMP) + '</span><button class="btn btn-secondary btn-sm" id="tmpOpen">' + icon('external') + '在资源管理器里打开</button></span></div>' +
        '<div class="kv-row"><span class="k">现在里面有</span><span><span class="mono">286</span> 张 · <span class="mono">512 MB</span> <span class="meta">· 按日期分在 6 个子文件夹里</span></span></div>' +
        '<div class="kv-row"><span class="k">谁来清</span><span>程序不自动删，你自己在资源管理器里清。清掉以后，节点里下载过的图改显示下载的那份；没下载过的显示「已清理」，参数还在，照样能「同样参数再来」。</span></div>' +
        '<div class="kv-row"><span class="k">上次下载到</span><span class="row" style="flex-wrap:wrap"><span class="mono">' + esc(LAST_DOWNLOAD) + '</span><span class="tag tag-ok">' + icon('check') + '在资产库里</span><span class="meta">只记在这台电脑上</span></span></div>' +
      '</div>' +
      '<div class="sx-days">' + [['2026-10-03', 46, '86 MB'], ['2026-10-02', 72, '128 MB'], ['2026-09-30', 64, '117 MB'], ['2026-09-28', 40, '71 MB'], ['2026-09-27', 36, '62 MB'], ['2026-09-25', 28, '48 MB']].map(function (r) {
        return '<div class="sx-day"><span class="mono">' + r[0] + '</span><span class="meta"><span class="mono">' + r[1] + '</span> 张 · <span class="mono">' + r[2] + '</span></span></div>';
      }).join('') + '</div></section>';
    $('#tmpOpen').onclick = function () { toast('已在资源管理器里打开 ' + IMAGE_TEMP); };
  }

  /* ─── 原型：设置页的几种状态 ─── */
  function applyProto() {
    var a = COMFY.autodl;
    if (SPROTO === 'libUpdating') { TAGLIB.state = 'updating'; TAGLIB.step = 1; TAGLIB.since = Date.now() - 97000; }
    if (SPROTO === 'libFail') TAGLIB.state = 'failed';
    if (/^boot/.test(SPROTO)) { COMFY.use = 'autodl'; a.state = 'failed'; a.error = { bootToken: 'token', bootBalance: 'balance', bootTimeout: 'timeout', bootGone: 'gone' }[SPROTO]; }
    if (SPROTO === 'autodlRunning') { a.state = 'running'; a.idleLeft = 12; a.upMin = 23; }
    if (SPROTO === 'booting') { COMFY.use = 'autodl'; a.state = 'booting'; a.since = Date.now() - 45000; }
  }
  applyProto();
  return { thinking: thinking, comfy: comfy, checkpoints: checkpoints, workflows: workflows, taglib: taglib, fragments: fragments, images: images, importDlg: importDlg };
})();
