/* =============================================================================
 * HM Unity 悬浮面板 —— 「别碰我的菜」(HarvestKing, Unity WebGL)
 * -----------------------------------------------------------------------------
 * 魔法领域的面板是画在 Laya.stage 上的，Unity 游戏没有 Laya，
 * 但宿主提供了真正的 DOM（document.body / createElement），
 * 所以这里用 **HTML + CSS** 叠一层浮层 —— 视觉规范与 Laya 版保持一致：
 *   浅蓝玻璃主题、95% 半透明、全圆角、可点元素有悬浮态、排版左右对称。
 *
 * 这份代码是**通用框架**的一部分：换一款 Unity 小游戏，
 * 只需改 __hmUnityLayout（布局描述）与 __hmUnityApply（写入函数），
 * 框架代码零改动。
 * ========================================================================== */

(function (G) {
  'use strict';
  if (!G) return;
  if (G.__hmUnityUI) return;
  G.__hmUnityUI = 1;
  G.__hmw = G.__hmw || 'unity';

  /* ------------------------------------------------------------------ 主题 */
  var THEME = {
    panelBg: 'rgba(20,42,78,0.95)',
    panelBorder: 'rgba(127,196,255,0.28)',
    primary: '#3D86D8',
    primaryHover: '#4E97E8',
    primaryBorder: '#7FC4FF',
    accent: '#7FC4FF',
    label: '#E8F2FF',
    section: '#9FC9F5',
    inputBg: 'rgba(10,26,52,0.72)',
    inputBorder: 'rgba(127,196,255,0.30)',
    gearOff: 'rgba(30,58,102,0.75)',
    gearOffHover: 'rgba(42,76,128,0.9)',
    footBg: 'rgba(14,32,62,0.96)',
    shadow: '0 18px 48px rgba(0,0,0,0.45)'
  };

  var R_PANEL = 18, R_CTRL = 11;

  /* -------------------------------------------------------------- 通用工具 */

  function el(tag, cls, parent) {
    var d = G.document.createElement(tag);
    if (cls) d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
  }

  function css(node, k, v) {
    try { node.style[k] = v; } catch (e) {}
  }

  function setText(node, t) {
    try { node.textContent = t; } catch (e) {}
  }

  /** 圆角矩形：两种实现（CSS 优先，降级到 canvas）都不依赖引擎 */
  function roundRect(node, r) {
    try { css(node, 'borderRadius', r + 'px'); } catch (e) {}
  }

  /* ------------------------------------------------------------ 组件构建器 */

  /**
   * 数值输入行：标签 + 输入框 + 应用按钮
   * 返回 { row, getValue }
   */
  function mkNumRow(parent, row) {
    var r = el('div', 'hm-row', parent);

    var lb = el('div', 'hm-label', r);
    setText(lb, row.label);

    var inp = el('input', 'hm-input', r);
    try {
      inp.type = 'text';
      inp.value = String(G.__hmUnitySet[row.key]);
      inp.inputMode = 'numeric';
    } catch (e) {}

    var btn = el('button', 'hm-btn hm-btn-primary', r);
    setText(btn, '应用');

    btn.addEventListener('click', function () {
      var v = parseInt(inp.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      G.__hmUnitySet[row.key] = v;
      try { if (row.apply) row.apply(v); } catch (e) {}
      setText(G.__hmUnityTitle, 'HM ' + row.label + ' = ' + v);
      refresh();
    });

    return r;
  }

  /**
   * 开关行。half=true 时半宽两列并排。
   */
  function mkSwitchRow(parent, row, halfIdx) {
    var r = el('div', 'hm-row' + (halfIdx >= 0 ? ' hm-half' : ''), parent);
    var lb = el('div', 'hm-label', r);
    setText(lb, row.label);

    var sw = el('div', 'hm-switch' + (G.__hmUnitySet[row.key] ? ' on' : ''), r);
    var knob = el('div', 'hm-knob', sw);

    sw.addEventListener('click', function () {
      var on = !G.__hmUnitySet[row.key];
      G.__hmUnitySet[row.key] = on;
      if (on) { sw.classList.add('on'); } else { sw.classList.remove('on'); }
      try { if (row.onChange) row.onChange(on); } catch (e) {}
    });
    return r;
  }

  /**
   * 挡位选择行：分段按钮组
   */
  function mkGearRow(parent, row) {
    var r = el('div', 'hm-row hm-row-stack', parent);
    var lb = el('div', 'hm-label', r);
    setText(lb, row.label);

    var grp = el('div', 'hm-gear', r);
    var sel = -1;
    for (var i = 0; i < row.opts.length; i++) {
      if (row.opts[i].value === G.__hmUnitySet[row.key]) sel = i;
    }
    if (sel < 0) sel = 0;

    for (var j = 0; j < row.opts.length; j++) {
      (function (idx, opt) {
        var b = el('button', 'hm-seg' + (idx === sel ? ' active' : ''), grp);
        setText(b, opt.label);
        b.addEventListener('click', function () {
          for (var k = 0; k < grp.children.length; k++) {
            grp.children[k].classList.remove('active');
          }
          b.classList.add('active');
          G.__hmUnitySet[row.key] = opt.value;
          try { if (row.apply) row.apply(opt.value); } catch (e) {}
          setText(G.__hmUnityTitle, 'HM ' + row.label + ' = ' + opt.label);
          refresh();
        });
      })(j, row.opts[j]);
    }
    return r;
  }

  /* ------------------------------------------------------------------ 面板 */

  var host = null;        // 浮层容器
  var panel = null;       // 面板本体
  var titleEl = null;
  var bodyEl = null;
  var footEl = null;
  var btnFloat = null;    // 折叠态圆钮
  var collapsed = false;

  function cssText() {
    return [
      '.hm-host{position:fixed;left:0;top:0;width:0;height:0;z-index:99999;',
        'font-family:"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif;',
        '-webkit-user-select:none;user-select:none;pointer-events:none}',
      '.hm-host *{box-sizing:border-box;margin:0;padding:0}',
      '.hm-btn-float{position:fixed;width:72px;height:72px;border-radius:36px;',
        'background:' + THEME.panelBg + ';border:2px solid ' + THEME.panelBorder + ';',
        'box-shadow:' + THEME.shadow + ';pointer-events:auto;display:flex;',
        'align-items:center;justify-content:center;color:' + THEME.accent + ';',
        'font-size:26px;font-weight:600;transition:transform .12s ease,background .12s ease}',
      '.hm-btn-float:hover{transform:scale(1.06);background:rgba(30,58,102,0.96)}',
      '.hm-btn-float:active{transform:scale(0.97)}',
      '.hm-panel{position:fixed;width:80%;max-width:760px;max-height:80%;',
        'background:' + THEME.panelBg + ';border:2px solid ' + THEME.panelBorder + ';',
        'border-radius:' + R_PANEL + 'px;box-shadow:' + THEME.shadow + ';',
        'pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;',
        'left:50%;top:50%;transform:translate(-50%,-50%);',
        'backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}',
      '.hm-head{height:56px;display:flex;align-items:center;padding:0 14px;',
        'border-bottom:1px solid ' + THEME.panelBorder + ';flex:0 0 auto;',
        'cursor:move}',
      '.hm-title{font-size:22px;font-weight:600;color:' + THEME.label + ';flex:1}',
      '.hm-close{width:38px;height:38px;border-radius:19px;',
        'background:' + THEME.gearOff + ';border:1px solid ' + THEME.inputBorder + ';',
        'color:' + THEME.accent + ';font-size:20px;line-height:1;cursor:pointer;',
        'display:flex;align-items:center;justify-content:center;transition:background .12s ease}',
      '.hm-close:hover{background:' + THEME.gearOffHover + '}',
      '.hm-body{flex:1 1 auto;overflow-y:auto;padding:14px 20px 16px}',
      '.hm-body::-webkit-scrollbar{width:6px}',
      '.hm-body::-webkit-scrollbar-thumb{background:rgba(127,196,255,0.35);border-radius:3px}',
      '.hm-sec{font-size:19px;color:' + THEME.section + ';margin:14px 0 10px;',
        'display:flex;align-items:center;gap:8px}',
      '.hm-sec::before{content:"";width:3px;height:16px;border-radius:2px;background:' + THEME.accent + '}',
      '.hm-row{display:flex;align-items:center;gap:10px;margin-bottom:12px}',
      '.hm-row-stack{flex-direction:column;align-items:stretch;gap:8px}',
      '.hm-half{width:calc(50% - 6px);margin-right:0}',
      '.hm-label{font-size:21px;color:' + THEME.label + ';flex:0 0 auto;min-width:104px}',
      '.hm-input{flex:1 1 auto;height:52px;border-radius:' + R_CTRL + 'px;',
        'background:' + THEME.inputBg + ';border:2px solid ' + THEME.inputBorder + ';',
        'color:' + THEME.label + ';font-size:23px;padding:0 14px;outline:none;',
        'font-family:inherit;transition:border-color .12s ease}',
      '.hm-input:focus{border-color:' + THEME.primaryBorder + '}',
      '.hm-btn{height:52px;border-radius:' + R_CTRL + 'px;font-size:23px;',
        'font-family:inherit;border:2px solid transparent;cursor:pointer;',
        'padding:0 18px;transition:background .12s ease,transform .1s ease;flex:0 0 auto}',
      '.hm-btn:active{transform:scale(0.97)}',
      '.hm-btn-primary{background:' + THEME.primary + ';border-color:' + THEME.primaryBorder + ';color:#fff}',
      '.hm-btn-primary:hover{background:' + THEME.primaryHover + '}',
      '.hm-switch{width:64px;height:36px;border-radius:18px;margin-left:auto;',
        'background:' + THEME.gearOff + ';border:2px solid ' + THEME.inputBorder + ';',
        'position:relative;cursor:pointer;flex:0 0 auto;transition:background .15s ease}',
      '.hm-switch.on{background:' + THEME.primary + ';border-color:' + THEME.primaryBorder + '}',
      '.hm-knob{position:absolute;top:2px;left:2px;width:28px;height:28px;border-radius:14px;',
        'background:#fff;transition:left .15s ease}',
      '.hm-switch.on .hm-knob{left:30px}',
      '.hm-gear{display:flex;gap:8px}',
      '.hm-seg{flex:1 1 0;height:50px;border-radius:' + R_CTRL + 'px;font-size:21px;',
        'font-family:inherit;cursor:pointer;border:2px solid rgba(150,200,250,0.32);',
        'background:' + THEME.gearOff + ';color:' + THEME.label + ';',
        'transition:background .12s ease,border-color .12s ease}',
      '.hm-seg:hover{background:' + THEME.gearOffHover + '}',
      '.hm-seg.active{background:' + THEME.primary + ';border-color:' + THEME.primaryBorder + ';color:#fff}',
      '.hm-foot{flex:0 0 auto;display:flex;gap:12px;padding:14px 20px;',
        'background:' + THEME.footBg + ';border-top:1px solid ' + THEME.panelBorder + '}',
      '.hm-foot .hm-btn{flex:1 1 0}'
    ].join('');
  }

  /** 注入样式表 */
  function ensureStyle() {
    try {
      if (G.document.getElementById('hm-unity-style')) return;
      var st = el('style', null, G.document.head || G.document.documentElement);
      st.id = 'hm-unity-style';
      st.textContent = cssText();
    } catch (e) {}
  }

  /** 重建面板内容（配置变化时刷新） */
  function refresh() {
    if (!bodyEl || !G.__hmUnityLayout) return;
    try {
      bodyEl.innerHTML = '';
    } catch (e) { return; }

    var layout = G.__hmUnityLayout;
    for (var si = 0; si < layout.sections.length; si++) {
      var sec = layout.sections[si];
      var st = el('div', 'hm-sec', bodyEl);
      setText(st, sec.title);

      var halfIdx = -1;
      for (var ri = 0; ri < sec.rows.length; ri++) {
        var row = sec.rows[ri];
        if (row.t === 'num') {
          mkNumRow(bodyEl, row);
        } else if (row.t === 'sw') {
          if (row.half) {
            halfIdx++;
            mkSwitchRow(bodyEl, row, halfIdx % 2);
            if (halfIdx % 2 === 1) halfIdx = -1;
          } else {
            mkSwitchRow(bodyEl, row, -1);
          }
        } else if (row.t === 'gear') {
          mkGearRow(bodyEl, row);
        }
      }
    }
  }

  /** 建面板（只建一次） */
  function build() {
    if (panel) return;
    var d = G.document;
    if (!d || !d.body) return;

    ensureStyle();

    host = el('div', 'hm-host', d.body);
    css(host, 'pointerEvents', 'none');

    // 折叠态圆钮
    btnFloat = el('button', 'hm-btn-float', host);
    setText(btnFloat, 'HM');
    css(btnFloat, 'right', '16px');
    css(btnFloat, 'bottom', '84px');
    btnFloat.addEventListener('click', function () { toggle(false); });

    // 面板
    panel = el('div', 'hm-panel', host);
    css(panel, 'display', 'none');

    var head = el('div', 'hm-head', panel);
    titleEl = el('div', 'hm-title', head);
    setText(titleEl, 'HM 修改器');

    var close = el('button', 'hm-close', head);
    setText(close, '×');
    close.addEventListener('click', function () { toggle(true); });

    bodyEl = el('div', 'hm-body', panel);

    footEl = el('div', 'hm-foot', panel);
    var acts = (G.__hmUnityLayout && G.__hmUnityLayout.actions) || [];
    for (var i = 0; i < acts.length; i++) {
      (function (act) {
        var b = el('button', 'hm-btn hm-btn-primary', footEl);
        setText(b, act.label);
        b.addEventListener('click', function () {
          try { act.fn(); } catch (e) {}
          refresh();
        });
      })(acts[i]);
    }

    // 标题栏拖动
    makeDraggable(head, panel);

    refresh();
  }

  /** 拖动实现：记录指针位移，改 left/top */
  function makeDraggable(handle, box) {
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', function (e) {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      var r = box.getBoundingClientRect();
      ox = r.left; oy = r.top;
      css(box, 'left', ox + 'px');
      css(box, 'top', oy + 'px');
      css(box, 'transform', 'none');
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var nx = ox + (e.clientX - sx);
      var ny = oy + (e.clientY - sy);
      var vw = G.innerWidth || 750, vh = G.innerHeight || 1334;
      nx = Math.max(0, Math.min(nx, vw - 60));
      ny = Math.max(0, Math.min(ny, vh - 60));
      css(box, 'left', nx + 'px');
      css(box, 'top', ny + 'px');
    });
    handle.addEventListener('pointerup', function () { dragging = false; });
    handle.addEventListener('pointercancel', function () { dragging = false; });
  }

  /** 折叠/展开 */
  function toggle(collapse) {
    collapsed = collapse;
    if (!panel) build();
    if (!panel) return;
    try {
      css(panel, 'display', collapse ? 'none' : 'flex');
      css(btnFloat, 'display', collapse ? 'flex' : 'none');
    } catch (e) {}
  }

  /** 圆钮位置记忆 */
  function loadPos() {
    try {
      var p = G.localStorage && G.localStorage.getItem('hm_unity_pos');
      if (!p) return;
      var o = JSON.parse(p);
      if (o && typeof o.left === 'number') {
        css(btnFloat, 'left', o.left + 'px');
        css(btnFloat, 'right', 'auto');
        css(btnFloat, 'top', o.top + 'px');
        css(btnFloat, 'bottom', 'auto');
      }
    } catch (e) {}
  }

  /* ------------------------------------------------------------- 对外接口 */

  G.__hmUnityBuildUI = build;
  G.__hmUnityRefreshUI = refresh;
  G.__hmUnityToggle = toggle;
  G.__hmUnityUIReady = function () { return !!(panel && G.__hmUnityLayout); };

  /* 布局与默认值由适配层提供（inj.js 里注入） */
  G.__hmUnityLayout = G.__hmUnityLayout || null;
  G.__hmUnitySet = G.__hmUnitySet || {};

  /* 等 DOM 与布局都就绪后再建面板 */
  function tryBuild() {
    try {
      if (!G.__hmUnityLayout) return;
      if (!G.document || !G.document.body) return;
      build();
      if (panel) {
        loadPos();
        toggle(true);
      }
    } catch (e) {}
  }

  G.__hmUnityTryBuild = tryBuild;

  [500, 1500, 3000, 6000, 10000].forEach(function (ms) {
    setTimeout(function () { tryBuild(); }, ms);
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
