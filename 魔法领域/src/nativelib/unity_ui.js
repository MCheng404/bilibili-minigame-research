/**
 * unity_ui.js —— Unity 小游戏的悬浮面板（canvas 版）
 *
 * 为什么不用 HTML：
 *   小游戏环境**没有 DOM**。document 是 adapter 伪造的，
 *   createElement 只支持 canvas/image 两种标签，div/style/appendChild
 *   全是空转，永远不渲染。实测 HTML 面板一个像素都显示不出来。
 *
 * 正确做法：
 *   1. wx.createCanvas() 开一个**离屏 2D canvas** 画面板
 *      （首次调用返回上屏 canvas，但 Unity 早就拿走了，所以我们拿到的是离屏的）
 *   2. 用 WebGL 把离屏 canvas 当纹理，贴到 Unity 的上屏 canvas 上
 *   3. 拦截 requestAnimationFrame，每帧在 Unity 画完之后补画一帧面板
 *   4. 触摸用 wx.onTouchStart/Move/End，自己做命中检测
 *
 * 坐标系：内部统一用 750x1334 虚拟分辨率，触摸坐标等比映射进来。
 */
(function () {
  var G = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (G.__hmUnityUI) return;
  G.__hmUnityUI = 1;

  /* ================================================================ 主题 */
  var THEME = {
    panel: 'rgba(20,42,78,0.95)',
    panelBorder: 'rgba(120,180,240,0.35)',
    head: 'rgba(30,58,102,0.98)',
    foot: 'rgba(26,50,92,0.98)',
    section: '#8FC5F5',
    label: '#DCEBFB',
    value: '#FFFFFF',
    primary: '#3D86D8',
    primaryHover: '#5AA0E8',
    primaryBorder: 'rgba(150,200,250,0.45)',
    gearOff: 'rgba(46,86,150,0.85)',
    gearOffHover: 'rgba(66,116,190,0.95)',
    inputBg: 'rgba(12,30,58,0.92)',
    inputBorder: 'rgba(120,180,240,0.38)',
    swOff: 'rgba(70,100,150,0.9)',
    swOn: '#3D86D8',
    swKnob: '#FFFFFF',
    accent: '#7FC4FF'
  };

  var R_PANEL = 18, R_CTRL = 11, R_SEG = 10, R_TRACK = 18;
  var VW = 750, VH = 1334;
  var PAD = 22, IND = 14, LBL_W = 150, BTN_W = 92, ROW_H = 62, SW_H = 52;

  /* ================================================================ 状态 */
  var SW = 750, SH = 1334;
  var collapsed = true;
  var btnX = 620, btnY = 1180, btnR = 40;
  var panelX = 45, panelY = 170, panelW = 660, panelH = 1000;
  var headH = 60, footH = 84;
  var scrollY = 0, scrollMax = 0;
  var dirty = true;
  var hoverId = null;
  var hitRegions = [];
  var titleText = 'HM 修改器';
  var dragMode = 0, dragDX = 0, dragDY = 0;

  /* ================================================================ canvas */
  var off = null, offCtx = null;
  var mainCanvas = null;
  var gl = null, glTex = null, glProg = null, glBuf = null, glLoc = null, glReady = 0;

  function getWx() {
    try { if (G.wx) return G.wx; } catch (e) {}
    try { if (G.GameGlobal && G.GameGlobal.wx) return G.GameGlobal.wx; } catch (e) {}
    return null;
  }

  function sysInfo() {
    var w = getWx();
    try { if (w && w.getSystemInfoSync) { var s = w.getSystemInfoSync(); if (s) return s; } } catch (e) {}
    return { windowWidth: VW, windowHeight: VH, pixelRatio: 1 };
  }

  function ensureCanvas() {
    if (off && offCtx) return true;
    var w = getWx();
    try {
      if (w && w.createCanvas) {
        off = w.createCanvas();
      } else if (G.document && G.document.createElement) {
        off = G.document.createElement('canvas');
      } else {
        return false;
      }
      off.width = VW; off.height = VH;
      offCtx = off.getContext('2d');
    } catch (e) { return false; }
    return !!(off && offCtx);
  }

  /* ================================================================ 绘图工具 */
  function rr(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  function fillRR(ctx, x, y, w, h, r, fill, stroke, lw) {
    rr(ctx, x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 2; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function text(ctx, s, x, y, size, color, align, bold) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';
    ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(String(s), x, y);
  }

  /* ================================================================ 命中区 */
  var hitDY = 0;          // 内容区滚动偏移（绘制时 translate 了 -scrollY，命中区要同步减）
  function clearHits() { hitRegions = []; hitDY = 0; }
  function addHit(id, x, y, w, h, kind, data) {
    hitRegions.push({ id: id, x: x, y: y + hitDY, w: w, h: h, kind: kind, data: data });
  }
  function hitTest(x, y) {
    for (var i = hitRegions.length - 1; i >= 0; i--) {
      var r = hitRegions[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  /* ================================================================ 面板绘制 */
  function getSet() {
    return G.__hmUnitySet || (G.__hmUnitySet = {});
  }

  function drawFloat(ctx) {
    var cx = btnX, cy = btnY;
    var hov = hoverId === 'float';
    ctx.beginPath();
    ctx.arc(cx, cy, btnR, 0, Math.PI * 2);
    ctx.fillStyle = hov ? THEME.primaryHover : THEME.primary;
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = THEME.primaryBorder; ctx.stroke();
    text(ctx, 'HM', cx, cy, 26, '#FFFFFF', 'center', true);
    addHit('float', cx - btnR, cy - btnR, btnR * 2, btnR * 2, 'float', null);
  }

  function drawPanel(ctx) {
    var L = G.__hmUnityLayout;
    if (!L) return;
    var x = panelX, y = panelY, w = panelW, h = panelH;

    // 外框
    fillRR(ctx, x, y, w, h, R_PANEL, THEME.panel, THEME.panelBorder, 2);

    // 标题栏
    fillRR(ctx, x, y, w, headH, R_PANEL, THEME.head, null);
    ctx.fillStyle = THEME.head; ctx.fillRect(x, y + headH - R_PANEL, w, R_PANEL);
    text(ctx, titleText, x + 22, y + headH / 2, 24, THEME.accent, 'left', true);

    // 关闭钮
    var cbS = 38, cbX = x + w - cbS - 14, cbY = y + (headH - cbS) / 2;
    fillRR(ctx, cbX, cbY, cbS, cbS, cbS / 2,
      hoverId === 'close' ? THEME.danger : 'rgba(232,115,115,0.55)',
      'rgba(255,180,180,0.5)', 2);
    text(ctx, '×', cbX + cbS / 2, cbY + cbS / 2 + 1, 26, '#fff', 'center', true);
    addHit('close', cbX, cbY, cbS, cbS, 'close', null);

    // 标题栏拖动区
    addHit('head', x, y, w - cbS - 14, headH, 'dragHead', null);

    // 内容区（裁剪 + 滚动）
    var bodyY = y + headH, bodyH = h - headH - footH;
    ctx.save();
    rr(ctx, x + 1, bodyY, w - 2, bodyH, 4); ctx.clip();
    ctx.translate(0, -scrollY);

    clearHits();
    addHit('close', cbX, cbY, cbS, cbS, 'close', null);
    addHit('head', x, y, w - cbS - 14, headH, 'dragHead', null);
    addHit('body', x, bodyY, w, bodyH, 'scroll', null);
    hitDY = -scrollY;      // 内容区绘制时 translate 了 -scrollY，命中区同步

    var cx0 = x + PAD + IND, cw = w - PAD * 2 - IND;
    var cy = bodyY + 18;
    var set = getSet();

    for (var si = 0; si < L.sections.length; si++) {
      var sec = L.sections[si];
      text(ctx, sec.title, cx0, cy + 14, 21, THEME.section, 'left', true);
      cy += 42;

      var halfN = 0, halfY = cy;
      for (var ri = 0; ri < sec.rows.length; ri++) {
        (function (row) {
          if (row.t === 'num') {
            text(ctx, row.label, cx0, cy + ROW_H / 2, 21, THEME.label, 'left');
            var vx = cx0 + LBL_W, vw = cw - LBL_W - BTN_W - 22;
            fillRR(ctx, vx, cy, vw, ROW_H, R_CTRL,
              hoverId === 'val:' + row.key ? 'rgba(20,44,86,0.98)' : THEME.inputBg,
              THEME.inputBorder, 2);
            text(ctx, String(set[row.key] != null ? set[row.key] : 0),
              vx + vw / 2, cy + ROW_H / 2, 23, THEME.value, 'center');
            addHit('val:' + row.key, vx, cy, vw, ROW_H, 'edit', row);

            var bx = vx + vw + 12;
            fillRR(ctx, bx, cy, BTN_W, ROW_H, R_CTRL,
              hoverId === 'ap:' + row.key ? THEME.primaryHover : THEME.primary,
              THEME.primaryBorder, 2);
            text(ctx, '应用', bx + BTN_W / 2, cy + ROW_H / 2, 21, '#fff', 'center', true);
            addHit('ap:' + row.key, bx, cy, BTN_W, ROW_H, 'apply', row);
            cy += ROW_H + 10;

          } else if (row.t === 'sw') {
            if (row.half) {
              var colW = Math.floor((cw - 16) / 2);
              var col = halfN % 2;
              if (col === 0) halfY = cy;
              var bx2 = cx0 + col * (colW + 16);
              text(ctx, row.label, bx2, halfY + SW_H / 2, 21, THEME.label, 'left');
              var on = !!set[row.key];
              var tw = 66, th = 36, tx = bx2 + colW - tw, ty = halfY + (SW_H - th) / 2;
              fillRR(ctx, tx, ty, tw, th, R_TRACK, on ? THEME.swOn : THEME.swOff, null);
              ctx.beginPath();
              ctx.arc(tx + (on ? tw - th / 2 : th / 2), ty + th / 2, th / 2 - 3, 0, Math.PI * 2);
              ctx.fillStyle = THEME.swKnob; ctx.fill();
              addHit('sw:' + row.key, bx2, halfY, colW, SW_H, 'switch', row);
              halfN++;
              if (halfN % 2 === 0) cy += SW_H + 8;
            } else {
              text(ctx, row.label, cx0, cy + SW_H / 2, 21, THEME.label, 'left');
              var on2 = !!set[row.key];
              var tw2 = 66, th2 = 36, tx2 = cx0 + cw - tw2, ty2 = cy + (SW_H - th2) / 2;
              fillRR(ctx, tx2, ty2, tw2, th2, R_TRACK, on2 ? THEME.swOn : THEME.swOff, null);
              ctx.beginPath();
              ctx.arc(tx2 + (on2 ? tw2 - th2 / 2 : th2 / 2), ty2 + th2 / 2, th2 / 2 - 3, 0, Math.PI * 2);
              ctx.fillStyle = THEME.swKnob; ctx.fill();
              addHit('sw:' + row.key, cx0, cy, cw, SW_H, 'switch', row);
              cy += SW_H + 8;
            }

          } else if (row.t === 'gear') {
            text(ctx, row.label, cx0, cy, 21, THEME.label, 'left');
            cy += 32;
            var opts = row.opts || [];
            var segW = Math.floor((cw - (opts.length - 1) * 8) / opts.length);
            var sel = -1;
            for (var gi = 0; gi < opts.length; gi++) {
              if (opts[gi].value === set[row.key]) sel = gi;
            }
            for (var gj = 0; gj < opts.length; gj++) {
              var gx = cx0 + gj * (segW + 8);
              var active = (gj === sel);
              fillRR(ctx, gx, cy, segW, 48, R_SEG,
                active ? (hoverId === 'gear:' + row.key + ':' + gj ? THEME.primaryHover : THEME.primary)
                       : (hoverId === 'gear:' + row.key + ':' + gj ? THEME.gearOffHover : THEME.gearOff),
                THEME.primaryBorder, 2);
              text(ctx, opts[gj].label, gx + segW / 2, cy + 24, 21,
                active ? '#fff' : THEME.label, 'center', active);
              addHit('gear:' + row.key + ':' + gj, gx, cy, segW, 48, 'gear', { row: row, idx: gj });
            }
            cy += 48 + 14;
          }
        })(sec.rows[ri]);
      }
      cy += 12;
    }
    scrollMax = Math.max(0, cy - (bodyY + bodyH) + 24);
    if (scrollY > scrollMax) scrollY = scrollMax;
    ctx.restore();
    hitDY = 0;

    // 底部栏
    var fy = y + h - footH;
    fillRR(ctx, x + 1, fy, w - 2, footH, R_PANEL, THEME.foot, null);
    ctx.fillStyle = THEME.foot; ctx.fillRect(x + 1, fy, w - 2, R_PANEL);
    var acts = L.actions || [];
    if (acts.length) {
      var abw = Math.floor((w - PAD * 2 - (acts.length - 1) * 12) / acts.length);
      for (var ai = 0; ai < acts.length; ai++) {
        (function (act, idx) {
          var ax = x + PAD + idx * (abw + 12), ay = fy + (footH - 56) / 2;
          fillRR(ctx, ax, ay, abw, 56, R_CTRL,
            hoverId === 'act:' + idx ? THEME.primaryHover : THEME.primary,
            THEME.primaryBorder, 2);
          text(ctx, act.label, ax + abw / 2, ay + 28, 22, '#fff', 'center', true);
          addHit('act:' + idx, ax, ay, abw, 56, 'action', act);
        })(acts[ai], ai);
      }
    }
    // 重新加浮钮命中（clearHits 会清掉）
    addHit('float', btnX - btnR, btnY - btnR, btnR * 2, btnR * 2, 'float', null);
    addHit('head', x, y, w - 60, headH, 'dragHead', null);
  }

  /* ================================================================ WebGL 叠加 */
  function findMainCanvas() {
    try { if (G.GameGlobal && G.GameGlobal.canvas) return G.GameGlobal.canvas; } catch (e) {}
    try { if (G.canvas && G.canvas.getContext) return G.canvas; } catch (e) {}
    try {
      if (G.GameGlobal && G.GameGlobal.manager && G.GameGlobal.manager.canvas) {
        return G.GameGlobal.manager.canvas;
      }
    } catch (e) {}
    return null;
  }

  function initGL() {
    if (glReady) return glReady > 0;
    mainCanvas = findMainCanvas();
    if (!mainCanvas || !mainCanvas.getContext) { glReady = -1; return false; }
    try {
      gl = mainCanvas.getContext('webgl') || mainCanvas.getContext('experimental-webgl');
    } catch (e) { gl = null; }
    if (!gl) { glReady = -1; return false; }

    var vs = 'attribute vec2 aPos;attribute vec2 aUV;varying vec2 vUV;' +
      'void main(){vUV=aUV;gl_Position=vec4(aPos,0.0,1.0);}';
    var fs = 'precision mediump float;varying vec2 vUV;uniform sampler2D uTex;' +
      'void main(){vec4 c=texture2D(uTex,vUV);gl_FragColor=vec4(c.rgb,c.a);}';

    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      return s;
    }
    try {
      glProg = gl.createProgram();
      gl.attachShader(glProg, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(glProg, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(glProg);
      glBuf = gl.createBuffer();
      glTex = gl.createTexture();
      glLoc = {
        aPos: gl.getAttribLocation(glProg, 'aPos'),
        aUV: gl.getAttribLocation(glProg, 'aUV'),
        uTex: gl.getUniformLocation(glProg, 'uTex')
      };
    } catch (e) { glReady = -1; return false; }
    glReady = 1;
    return true;
  }

  function drawOverlay() {
    if (!off || !glReady || !gl) return;
    try {
      var W = mainCanvas.width, H = mainCanvas.height;

      // 保存 Unity 的 GL 状态（缺 API 也不能挡住绘制本身）
      var old = {};
      try {
        old.prog = gl.getParameter(gl.CURRENT_PROGRAM);
        old.tex = gl.getParameter(gl.TEXTURE_BINDING_2D);
        old.active = gl.getParameter(gl.ACTIVE_TEXTURE);
        old.buf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        old.blend = gl.isEnabled(gl.BLEND);
        old.srgb = gl.getParameter(gl.BLEND_SRC_RGB);
        old.drgb = gl.getParameter(gl.BLEND_DST_RGB);
        old.sa = gl.getParameter(gl.BLEND_SRC_ALPHA);
        old.da = gl.getParameter(gl.BLEND_DST_ALPHA);
      } catch (e) {}

      gl.useProgram(glProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      // 全屏四边形：pos(-1..1) + uv(0..1)，v 翻转（canvas 原点在左上）
      var data = new Float32Array([
        -1, 1, 0, 0,
         1, 1, 1, 0,
        -1, -1, 0, 1,
         1, -1, 1, 1
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(glLoc.aPos);
      gl.vertexAttribPointer(glLoc.aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(glLoc.aUV);
      gl.vertexAttribPointer(glLoc.aUV, 2, gl.FLOAT, false, 16, 8);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);

      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.viewport(0, 0, W, H);
      gl.uniform1i(glLoc.uTex, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 还原
      try {
        gl.bindTexture(gl.TEXTURE_2D, old.tex);
        gl.activeTexture(old.active);
        gl.bindBuffer(gl.ARRAY_BUFFER, old.buf);
        gl.useProgram(old.prog);
        gl.blendFuncSeparate(old.srgb, old.drgb, old.sa, old.da);
        if (!old.blend) gl.disable(gl.BLEND);
      } catch (e) {}
    } catch (e) {
      try { G.__hmUnityGLErr = String(e); } catch (e2) {}
    }
  }

  /* ================================================================ 帧循环 */
  function frame() {
    try {
      if (!ensureCanvas()) return;
      if (dirty) {
        offCtx.clearRect(0, 0, VW, VH);
        clearHits();
        if (collapsed) {
          drawFloat(offCtx);
        } else {
          drawPanel(offCtx);
          drawFloat(offCtx);
        }
        if (stepOpen) drawStepper(offCtx);
        dirty = false;
      }
      if (!initGL()) return;
      drawOverlay();
    } catch (e) {
      try { G.__hmUnityUIErr = String(e); } catch (e2) {}
    }
  }

  function installFrameHook() {
    var raf = G.requestAnimationFrame || (G.wx && G.wx.requestAnimationFrame);
    if (raf && !raf.__hmWrapped) {
      var orig = raf;
      var wrapped = function (cb) {
        return orig.call(G, function (ts) {
          try { if (cb) cb(ts); } catch (e) {}
          frame();
        });
      };
      wrapped.__hmWrapped = 1;
      wrapped.__hmOrig = orig;
      try { G.requestAnimationFrame = wrapped; } catch (e) {}
      try { if (G.wx) G.wx.requestAnimationFrame = wrapped; } catch (e) {}
    }
    // 兜底：setInterval 兜住 rAF 没被调用的场景（面板展开时）
    if (!G.__hmUnityFrameTimer) {
      G.__hmUnityFrameTimer = setInterval(function () {
        if (!collapsed) { dirty = true; frame(); }
      }, 120);
    }
    // 首帧立刻画一次
    dirty = true;
    setTimeout(frame, 60);
  }

  /* ================================================================ 触摸 */
  function toVirtual(t) {
    var s = sysInfo();
    var wpx = s.windowWidth || VW, hpx = s.windowHeight || VH;
    return {
      x: (t.clientX / wpx) * VW,
      y: (t.clientY / hpx) * VH
    };
  }

  function applyRow(row) {
    var v = getSet()[row.key];
    try { if (row.apply) row.apply(v); } catch (e) {}
  }

  function handleTap(r, vx, vy) {
    if (!r) return;
    var set = getSet();
    if (r.kind === 'float') {
      collapsed = !collapsed; dirty = true;
    } else if (r.kind === 'close') {
      collapsed = true; dirty = true;
    } else if (r.kind === 'apply') {
      applyRow(r.data);
      try { titleText = 'HM ' + r.data.label + ' = ' + set[r.data.key]; } catch (e) {}
      dirty = true;
    } else if (r.kind === 'switch') {
      var on = !set[r.data.key];
      set[r.data.key] = on;
      try { if (r.data.onChange) r.data.onChange(on); } catch (e) {}
      dirty = true;
    } else if (r.kind === 'gear') {
      var row = r.data.row, idx = r.data.idx;
      var opt = row.opts[idx];
      set[row.key] = opt.value;
      try { if (row.apply) row.apply(opt.value); } catch (e) {}
      try { titleText = 'HM ' + row.label + ' = ' + opt.label; } catch (e) {}
      dirty = true;
    } else if (r.kind === 'action') {
      try { r.data.fn(); } catch (e) {}
      dirty = true;
    } else if (r.kind === 'edit') {
      openEditor(r.data);
    }
  }

  /* 数值输入：优先 wx.showKeyboard；没有就用长按 +/- 的步进器 */
  var editRow = null, editVal = 0, stepTimer = 0;

  function openEditor(row) {
    editRow = row;
    editVal = parseInt(getSet()[row.key], 10);
    if (isNaN(editVal)) editVal = 0;
    var w = getWx();
    if (w && w.showKeyboard) {
      try {
        w.showKeyboard({
          defaultValue: String(editVal),
          maxLength: 10,
          multiple: false,
          confirmHold: false,
          confirmType: 'done'
        });
        if (!w.__hmKbBound) {
          w.__hmKbBound = 1;
          if (w.onKeyboardConfirm) {
            w.onKeyboardConfirm(function (res) {
              if (!editRow) return;
              var v = parseInt(res && res.value, 10);
              if (isNaN(v) || v < 0) v = 0;
              getSet()[editRow.key] = v;
              applyRow(editRow);
              try { titleText = 'HM ' + editRow.label + ' = ' + v; } catch (e) {}
              editRow = null; dirty = true;
            });
          }
          if (w.onKeyboardComplete) {
            w.onKeyboardComplete(function () { editRow = null; dirty = true; });
          }
        }
        return;
      } catch (e) {}
    }
    // 退化：步进器浮层
    stepOpen = true; dirty = true;
  }

  var stepOpen = false;

  function drawStepper(ctx) {
    if (!stepOpen || !editRow) return;
    var w = 380, h = 190, x = (VW - w) / 2, y = (VH - h) / 2;
    fillRR(ctx, x, y, w, h, R_PANEL, THEME.panel, THEME.panelBorder, 2);
    text(ctx, editRow.label, x + w / 2, y + 30, 22, THEME.accent, 'center', true);
    text(ctx, String(editVal), x + w / 2, y + 78, 34, '#fff', 'center', true);
    var bw = 100, bh = 52, by = y + h - bh - 18;
    fillRR(ctx, x + 22, by, bw, bh, R_CTRL, hoverId === 'stp-' ? THEME.primaryHover : THEME.primary, THEME.primaryBorder, 2);
    text(ctx, '−', x + 22 + bw / 2, by + bh / 2, 30, '#fff', 'center', true);
    fillRR(ctx, x + w / 2 - bw / 2, by, bw, bh, R_CTRL, hoverId === 'stpOK' ? THEME.primaryHover : THEME.primary, THEME.primaryBorder, 2);
    text(ctx, '确定', x + w / 2, by + bh / 2, 22, '#fff', 'center', true);
    fillRR(ctx, x + w - 22 - bw, by, bw, bh, R_CTRL, hoverId === 'stp+' ? THEME.primaryHover : THEME.primary, THEME.primaryBorder, 2);
    text(ctx, '+', x + w - 22 - bw / 2, by + bh / 2, 30, '#fff', 'center', true);
    addHit('stp-', x + 22, by, bw, bh, 'step', -1);
    addHit('stpOK', x + w / 2 - bw / 2, by, bw, bh, 'stepOK', null);
    addHit('stp+', x + w - 22 - bw, by, bw, bh, 'step', 1);
  }

  function onTouchStart(e) {
    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    var p = toVirtual(t);
    if (stepOpen) {
      var r = hitTest(p.x, p.y);
      if (r && r.kind === 'step') { editVal = Math.max(0, editVal + r.data * 10); dirty = true; }
      else if (r && r.kind === 'stepOK') {
        if (editRow) {
          getSet()[editRow.key] = editVal;
          applyRow(editRow);
          try { titleText = 'HM ' + editRow.label + ' = ' + editVal; } catch (e2) {}
          editRow = null;
        }
        stepOpen = false; dirty = true;
      }
      return;
    }
    var hit = hitTest(p.x, p.y);
    if (hit && (hit.kind === 'dragHead' || hit.kind === 'float')) {
      dragMode = hit.kind === 'float' ? 2 : 1;
      dragDX = p.x - (hit.kind === 'float' ? btnX : panelX);
      dragDY = p.y - (hit.kind === 'float' ? btnY : panelY);
      return;
    }
    if (hit && hit.kind === 'scroll') {
      dragMode = 3; dragDY = p.y; return;
    }
    if (hit) { handleTap(hit, p.x, p.y); }
  }

  function onTouchMove(e) {
    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t || !dragMode) return;
    var p = toVirtual(t);
    if (dragMode === 2) {
      btnX = Math.max(btnR, Math.min(VW - btnR, p.x - dragDX));
      btnY = Math.max(btnR, Math.min(VH - btnR, p.y - dragDY));
      dirty = true;
    } else if (dragMode === 1) {
      panelX = Math.max(-panelW / 2, Math.min(VW - panelW / 2, p.x - dragDX));
      panelY = Math.max(0, Math.min(VH - headH, p.y - dragDY));
      dirty = true;
    } else if (dragMode === 3) {
      var dy = p.y - dragDY;
      dragDY = p.y;
      scrollY = Math.max(0, Math.min(scrollMax, scrollY - dy));
      dirty = true;
    }
  }

  function onTouchEnd() { dragMode = 0; }

  function installTouch() {
    var w = getWx();
    if (!w) return;
    try {
      if (w.onTouchStart) w.onTouchStart(onTouchStart);
      if (w.onTouchMove) w.onTouchMove(onTouchMove);
      if (w.onTouchEnd) w.onTouchEnd(onTouchEnd);
      if (w.onTouchCancel) w.onTouchCancel(onTouchEnd);
    } catch (e) {}
  }

  /* ================================================================ 对外 API */
  G.__hmUnityBuildUI = function () {
    ensureCanvas();
    installTouch();
    installFrameHook();
    dirty = true;
    return true;
  };
  G.__hmUnityRefreshUI = function () { dirty = true; };
  G.__hmUnityToggle = function (toCollapsed) {
    collapsed = (typeof toCollapsed === 'boolean') ? toCollapsed : !collapsed;
    dirty = true;
  };
  G.__hmUnityUIReady = function () {
    return !!(off && offCtx && G.__hmUnityLayout);
  };
  /* 调试/测试用：返回虚拟坐标下的命中区 */
  G.__hmUnityHitTest = function (x, y) { return hitTest(x, y); };
  G.__hmUnityState = function () {
    return { collapsed: !!collapsed, scrollY: scrollY, hits: hitRegions.length,
             gl: glReady, title: titleText };
  };
  // harvest_adapt.js 会写 G.__hmUnityTitle.textContent
  G.__hmUnityTitle = {
    get textContent() { return titleText; },
    set textContent(v) { titleText = String(v); dirty = true; }
  };

  /* 记录环境能力，便于诊断 */
  try {
    var s0 = sysInfo();
    SW = s0.windowWidth || VW; SH = s0.windowHeight || VH;
  } catch (e) {}

  // 自动构建
  setTimeout(function () {
    try { G.__hmUnityBuildUI(); } catch (e) {}
  }, 200);
})();
