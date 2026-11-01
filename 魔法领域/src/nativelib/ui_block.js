// ===== HM UI BLOCK START =====
    // ================================================================
    // 通用悬浮面板框架（所有小程序游戏共用）
    // ---------------------------------------------------------------
    // 视觉规范：浅蓝主题 / 圆角 / 悬浮态 / 95% 半透明 / 对齐排版
    //
    // 游戏适配层只需提供 G.__hmLayout（布局描述）+ G.__hmSet（默认值），
    // 框架负责渲染、滚动、拖动、折叠、输入、开关、挡位选择。
    //
    // 布局描述格式：
    //   G.__hmLayout = {
    //     sections: [
    //       { title: '分组名', rows: [
    //         { t:'num',  label, key, apply(v) }        数值输入行
    //         { t:'sw',   label, key, onChange(on) }    开关行
    //         { t:'gear', label, key, opts:[{label,value}], apply(v) }  挡位行
    //       ]}
    //     ],
    //     actions: [ { label, color, fn() } ]           底部按钮
    //   }
    // ================================================================

    // ---------------- 主题 ----------------
    var THEME = {
      panel: 'rgba(20, 42, 78, 0.95)',
      bar: 'rgba(38, 76, 130, 0.95)',
      foot: 'rgba(30, 60, 104, 0.95)',
      border: 'rgba(150, 205, 255, 0.55)',
      section: '#8FD4FF',
      label: '#C8E6FF',
      text: '#EAF6FF',
      dim: '#9CC3E8',
      inputBg: 'rgba(9, 22, 44, 0.92)',
      inputBorder: '#4E9AD8',
      inputBorderHover: '#8CCBFF',
      primary: '#3D86D8',
      primaryHover: '#5BA6F2',
      primaryBorder: '#7FC4FF',
      secondary: '#2C6AA8',
      secondaryHover: '#4A8AC8',
      secondaryBorder: '#6FB4E8',
      gearOff: 'rgba(120, 158, 205, 0.20)',
      gearOffHover: 'rgba(130, 170, 220, 0.40)',
      swOn: '#3D86D8',
      swOnHover: '#5BA6F2',
      swOff: 'rgba(112, 145, 188, 0.45)',
      swKnob: '#EAF6FF',
      close: 'rgba(190, 66, 78, 0.92)',
      closeHover: 'rgba(216, 88, 100, 0.95)'
    };

    // 圆角半径
    var R_PANEL = 18, R_CTRL = 11, R_SEG = 9, R_TRACK = 19;

    // 排版度量
    var ROW_H = 52, SW_H = 46, PAD = 20, LBL_W = 132, GAP = 8, BTN_W = 78, IND = 14;

    // drawPath 可用性（引擎若不支持圆角路径则降级为直角矩形）
    var HAS_PATH = 0;
    try {
      if (typeof Laya !== 'undefined' && Laya.Sprite) {
        var _t = new Laya.Sprite();
        _t.graphics.drawPath(0, 0, ['moveTo', 0, 0, 'lineTo', 4, 0, 'arcTo', 4, 4, 0, 4, 2, 'closePath'], '#ffffff');
        HAS_PATH = 1;
      }
    } catch (e) { HAS_PATH = 0; }
    G.__hmHasPath = HAS_PATH;

    /** 完整圆角矩形路径 */
    function rrPath(x, y, w, h, r) {
      r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
      return [
        'moveTo', x + r, y,
        'lineTo', x + w - r, y,
        'arcTo', x + w, y, x + w, y + r, r,
        'lineTo', x + w, y + h - r,
        'arcTo', x + w, y + h, x + w - r, y + h, r,
        'lineTo', x + r, y + h,
        'arcTo', x, y + h, x, y + h - r, r,
        'lineTo', x, y + r,
        'arcTo', x, y, x + r, y, r,
        'closePath'
      ];
    }

    /** 仅上方两角圆角（用于标题栏，与面板圆角对齐） */
    function rrTopPath(x, y, w, h, r) {
      r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
      return [
        'moveTo', x, y + r,
        'arcTo', x, y, x + r, y, r,
        'lineTo', x + w - r, y,
        'arcTo', x + w, y, x + w, y + r, r,
        'lineTo', x + w, y + h,
        'lineTo', x, y + h,
        'closePath'
      ];
    }

    /** 仅下方两角圆角（用于底部栏） */
    function rrBottomPath(x, y, w, h, r) {
      r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
      return [
        'moveTo', x, y,
        'lineTo', x + w, y,
        'lineTo', x + w, y + h - r,
        'arcTo', x + w, y + h, x + w - r, y + h, r,
        'lineTo', x + r, y + h,
        'arcTo', x, y + h, x, y + h - r, r,
        'closePath'
      ];
    }

    /** 画圆角矩形；不支持路径时降级为直角 */
    function drawRR(sp, x, y, w, h, r, fill, stroke, lw) {
      try {
        if (HAS_PATH) {
          sp.graphics.drawPath(0, 0, rrPath(x, y, w, h, r), fill || null, stroke || null, lw || 2);
          return 1;
        }
      } catch (e) { HAS_PATH = 0; }
      try {
        if (fill) sp.graphics.drawRect(x, y, w, h, fill);
        if (stroke) sp.graphics.drawRect(x, y, w, h, null, stroke, lw || 2);
      } catch (e) {}
      return 0;
    }

    /** 文字像素宽度估算：CJK 按全角，其余按半角 */
    function labelWidth(s, fs) {
      s = String(s);
      var w = 0;
      for (var i = 0; i < s.length; i++) {
        w += (s.charCodeAt(i) > 0x2E80) ? fs : fs * 0.56;
      }
      return w;
    }

    /** 挂悬浮态（进入 / 离开） */
    function onHover(sp, repaint) {
      try {
        sp.on('mouseover', null, function () { try { repaint(1); } catch (e) {} });
        sp.on('mouseout', null, function () { try { repaint(0); } catch (e) {} });
      } catch (e) {}
    }

    // ---------------- 通用组件 ----------------

    function refreshTop() {
      try {
        var f = findView();
        if (f.view) f.view.refreshUI();
      } catch (e) {}
    }

    /** 纯文本标签 */
    function mkText(parent, text, x, y, fontSize, color) {
      var t = new Laya.Text();
      try {
        t.text = String(text);
        t.fontSize = fontSize;
        t.color = color || '#FFFFFF';
        t.pos(x, y);
      } catch (e) {}
      try { parent.addChild(t); } catch (e) {}
      return t;
    }

    /** 居中文字 */
    function mkTextCenter(parent, text, x, y, w, h, fontSize, color) {
      var t = mkText(parent, text, x, y, fontSize, color);
      try {
        t.x = Math.round(x + (w - labelWidth(text, fontSize)) / 2);
        t.y = Math.round(y + (h - fontSize * 1.25) / 2);
      } catch (e) {}
      return t;
    }

    /** 圆角输入框（圆角底 + 透明 TextInput 叠加） */
    function mkInput(parent, value, x, y, w, h) {
      var wrap = new Laya.Sprite();
      try { wrap.size(w, h); wrap.pos(x, y); wrap.mouseEnabled = true; } catch (e) {}

      function paint(hover) {
        try { wrap.graphics.clear(); } catch (e) {}
        drawRR(wrap, 0, 0, w, h, R_CTRL, THEME.inputBg,
          hover ? THEME.inputBorderHover : THEME.inputBorder, 2);
      }
      paint(0);
      onHover(wrap, paint);
      try { parent.addChild(wrap); } catch (e) {}

      var t = new Laya.TextInput();
      try {
        t.size(w - 22, 30);
        t.pos(x + 11, y + 12);
        t.fontSize = 22;
        t.color = THEME.text;
        t.bgColor = 'rgba(0,0,0,0)';
        t.borderColor = 'rgba(0,0,0,0)';
        t.padding = '0,0,0,0';
        t.type = 'number';
        t.align = 'left';
        t.text = String(value);
      } catch (e) {}
      try { parent.addChild(t); } catch (e) {}
      return t;
    }

    /** 圆角开关（胶囊轨道 + 圆形钮） */
    function mkSwitch(parent, on, x, y, onChange) {
      var W = 64, H = 36;
      var sp = new Laya.Sprite();
      try { sp.size(W, H); sp.pos(x, y); sp.mouseEnabled = true; } catch (e) {}

      function paint(hover) {
        try { sp.graphics.clear(); } catch (e) {}
        var track = on ? (hover ? THEME.swOnHover : THEME.swOn) : THEME.swOff;
        drawRR(sp, 0, 0, W, H, R_TRACK, track,
          on ? THEME.swOn : 'rgba(160,195,235,0.32)', 2);
        try { sp.graphics.drawCircle(on ? W - R_TRACK : R_TRACK, H / 2, 13, THEME.swKnob); } catch (e) {}
      }
      paint(0);
      onHover(sp, paint);
      try {
        sp.on('click', null, function () {
          on = !on;
          paint(0);
          try { onChange(on); } catch (e) {}
        });
      } catch (e) {}
      try { parent.addChild(sp); } catch (e) {}
      return sp;
    }

    /** 圆角按钮 */
    function mkBtn(parent, label, x, y, w, h, base, hover, border, onClick) {
      var sp = new Laya.Sprite();
      try { sp.size(w, h); sp.pos(x, y); sp.mouseEnabled = true; } catch (e) {}

      // 注意：参数名不能叫 h —— 会遮蔽外层表示按钮高度的 h，
      // 那样按钮会以 0 高度绘制，只剩一条边线。
      function paint(hv) {
        try { sp.graphics.clear(); } catch (e) {}
        drawRR(sp, 0, 0, w, h, R_CTRL, hv ? hover : base, border, 2);
      }
      paint(0);
      onHover(sp, paint);
      mkTextCenter(sp, label, 0, 0, w, h, 22, '#FFFFFF');
      try { sp.on('click', null, onClick); } catch (e) {}
      try { parent.addChild(sp); } catch (e) {}
      return sp;
    }

    /** 挡位分段按钮 */
    function mkSegBtn(parent, label, x, y, w, h, active, onClick) {
      var sp = new Laya.Sprite();
      try { sp.size(w, h); sp.pos(x, y); sp.mouseEnabled = true; } catch (e) {}
      var st = { active: !!active };

      function paint(hv) {
        try { sp.graphics.clear(); } catch (e) {}
        if (st.active) {
          drawRR(sp, 0, 0, w, h, R_SEG, hv ? THEME.primaryHover : THEME.primary, THEME.primaryBorder, 2);
        } else {
          drawRR(sp, 0, 0, w, h, R_SEG, hv ? THEME.gearOffHover : THEME.gearOff,
            'rgba(150,200,250,0.32)', 2);
        }
      }
      paint(0);
      onHover(sp, paint);
      var t = mkTextCenter(sp, label, 0, 0, w, h, 21, st.active ? '#FFFFFF' : THEME.dim);
      try { sp.on('click', null, onClick); } catch (e) {}
      try { parent.addChild(sp); } catch (e) {}
      return { sp: sp, label: t, set: function (a) { st.active = !!a; paint(0); try { t.color = a ? '#FFFFFF' : THEME.dim; } catch (e) {} } };
    }

    /**
     * 挡位选择器：一排等宽圆角按钮，选中高亮。
     * opts = [{label:'1x', value:1.31}, ...]
     */
    function mkGearRow(parent, opts, selectedIdx, x, y, w, h, onSelect) {
      var n = opts.length;
      if (!n) return null;
      var gap = 8;
      var bw = Math.floor((w - gap * (n - 1)) / n);
      var btns = [];
      var cur = selectedIdx;

      for (var i = 0; i < n; i++) {
        (function (idx) {
          var b = mkSegBtn(parent, opts[idx].label, x + idx * (bw + gap), y, bw, h, idx === cur, function () {
            cur = idx;
            for (var k = 0; k < btns.length; k++) btns[k].set(k === cur);
            try { onSelect(idx, opts[idx]); } catch (e) {}
          });
          btns.push(b);
        })(i);
      }

      return {
        setSelected: function (idx) {
          cur = idx;
          for (var k = 0; k < btns.length; k++) btns[k].set(k === cur);
        },
        getSelected: function () { return cur; }
      };
    }

    // ---------------- 面板构建（配置驱动） ----------------

    function buildPanel(stage) {
      var sw = stage.width || 400;
      var sh = stage.height || 800;

      // ---- 折叠态：圆形悬浮按钮 ----
      var R = 36;
      var mini = new Laya.Sprite();
      mini.name = 'hmMini';
      try {
        mini.size(R * 2, R * 2);
        mini.pos(
          (G.__hmPosX === undefined) ? sw - R * 2 - 16 : G.__hmPosX,
          (G.__hmPosY === undefined) ? Math.round(sh * 0.62) : G.__hmPosY
        );
        mini.mouseEnabled = true;
      } catch (e) {}
      function paintMini(h) {
        try { mini.graphics.clear(); } catch (e) {}
        try {
          mini.graphics.drawCircle(R, R, R, h ? 'rgba(70,140,235,0.98)' : 'rgba(48,112,208,0.94)');
          mini.graphics.drawCircle(R, R, R, null, h ? '#BFE0FF' : '#8CCBFF', 2);
        } catch (e) {}
      }
      paintMini(0);
      onHover(mini, paintMini);
      try { stage.addChild(mini); } catch (e) {}
      mkTextCenter(mini, 'HM', 0, 0, R * 2, R * 2, 22, '#FFFFFF');
      try { mini.on('click', null, function () { setCollapsed(false); }); } catch (e) {}
      G.__hmMini = mini;

      // ---- 展开态：3/4 屏幕居中 ----
      var W = Math.floor(sw * 0.80);
      var H = Math.floor(sh * 0.80);
      var BPX = Math.floor((sw - W) / 2);
      var BPY = Math.floor((sh - H) / 2);
      if (G.__hmBodyX !== undefined) { BPX = G.__hmBodyX; BPY = G.__hmBodyY; }

      var body = new Laya.Sprite();
      body.name = 'hmBody';
      try {
        body.size(W, H);
        body.pos(BPX, BPY);
        body.mouseEnabled = true;
        body.zOrder = 999999;
      } catch (e) {}
      try {
        if (HAS_PATH) {
          body.graphics.drawPath(0, 0, rrPath(0, 0, W, H, R_PANEL), THEME.panel, THEME.border, 2);
        } else {
          body.graphics.drawRect(0, 0, W, H, THEME.panel);
          body.graphics.drawRect(0, 0, W, H, null, THEME.border, 2);
        }
      } catch (e) {}
      try { stage.addChild(body); } catch (e) {}
      G.__hmBody = body;

      // ---- 标题栏（上部圆角，与面板对齐） ----
      var TB = 58;
      var bar = new Laya.Sprite();
      try { bar.size(W, TB); bar.pos(0, 0); bar.mouseEnabled = true; } catch (e) {}
      try {
        if (HAS_PATH) {
          bar.graphics.drawPath(0, 0, rrTopPath(0, 0, W, TB, R_PANEL), THEME.bar, null, 0);
        } else {
          bar.graphics.drawRect(0, 0, W, TB, THEME.bar);
        }
      } catch (e) {}
      try { body.addChild(bar); } catch (e) {}
      G.__hmTitle = mkText(bar, 'HM 修改器', 22, 17, 23, '#CFE9FF');

      // 关闭按钮（圆形）
      var CR = 19;
      var close = new Laya.Sprite();
      try {
        close.size(CR * 2, CR * 2);
        close.pos(W - CR * 2 - 14, (TB - CR * 2) / 2);
        close.mouseEnabled = true;
      } catch (e) {}
      function paintClose(h) {
        try { close.graphics.clear(); } catch (e) {}
        try {
          close.graphics.drawCircle(CR, CR, CR, h ? THEME.closeHover : THEME.close);
          close.graphics.drawCircle(CR, CR, CR, null, 'rgba(255,200,205,0.75)', 2);
        } catch (e) {}
      }
      paintClose(0);
      onHover(close, paintClose);
      mkTextCenter(close, '×', 0, 0, CR * 2, CR * 2, 26, '#FFFFFF');
      try {
        close.on('click', null, function () {
          G.__hmBodyX = body.x; G.__hmBodyY = body.y;
          G.__hmCollapsed = true;
          try { body.visible = false; } catch (e) {}
          try { mini.visible = true; } catch (e) {}
        });
      } catch (e) {}
      try { bar.addChild(close); } catch (e) {}

      // ---- 拖动 ----
      try {
        bar.on('mousedown', null, function (e) {
          G.__hmDrag = true; G.__hmTarget = body;
          G.__hmOX = e.stageX - body.x; G.__hmOY = e.stageY - body.y;
        });
        mini.on('mousedown', null, function (e) {
          G.__hmDrag = true; G.__hmTarget = mini;
          G.__hmOX = e.stageX - mini.x; G.__hmOY = e.stageY - mini.y;
        });
      } catch (e) {}
      if (!G.__hmDragBound) {
        G.__hmDragBound = 1;
        try {
          stage.on('mousemove', null, function (e) {
            var t = G.__hmTarget;
            if (!t || !G.__hmDrag) return;
            t.x = e.stageX - G.__hmOX;
            t.y = e.stageY - G.__hmOY;
            if (t.name === 'hmMini') { G.__hmPosX = t.x; G.__hmPosY = t.y; }
            else { G.__hmBodyX = t.x; G.__hmBodyY = t.y; }
          });
          stage.on('mouseup', null, function () { G.__hmDrag = false; });
        } catch (e) {}
      }

      // ---- 中间滚动区（配置驱动） ----
      var FOOT = 86;
      var sc = new Laya.Panel();
      try {
        sc.size(W, H - TB - FOOT);
        sc.pos(0, TB);
        sc.vScrollBarSkin = '';
        body.addChild(sc);
      } catch (e) {}
      var content = new Laya.Sprite();
      try { content.size(W, 10); sc.addChild(content); } catch (e) {}

      // ---- 渲染布局 ----
      var LAY = G.__hmLayout || { sections: [], actions: [] };
      // 内容列从 PAD+IND 到 W-PAD，保证左右边距对称
      var CW = W - PAD * 2 - IND;
      var IW = CW - LBL_W - 10 - BTN_W;
      var y = 18;

      for (var si = 0; si < LAY.sections.length; si++) {
        var sec = LAY.sections[si];

        // 分组标题（带左侧短竖线，视觉分组）
        mkText(content, sec.title, PAD + IND, y, 19, THEME.section);
        try {
          var tick = new Laya.Sprite();
          tick.size(4, 22);
          tick.pos(PAD, y - 1);
          tick.graphics.drawRect(0, 0, 4, 22, THEME.section);
          content.addChild(tick);
        } catch (e) {}
        y += 34;
        var halfCount = 0, halfRowY = y;

        for (var ri = 0; ri < sec.rows.length; ri++) {
          // 必须用 IIFE 包住每一轮：
          // row / inp 都是 var 声明的，函数作用域下所有轮次共享同一个变量，
          // 闭包捕获的是变量而不是值 —— 不包的话所有「应用」按钮
          // 读写的都是最后一行的输入框，开关/挡位的回调也会串行。
          (function (row) {
            if (row.t === 'num') {
              // ---- 数值输入行 ----
              mkText(content, row.label, PAD + IND, y + 14, 21, THEME.label);
              var inp = mkInput(content, G.__hmSet[row.key], PAD + IND + LBL_W, y, IW, ROW_H);
              mkBtn(content, '应用', PAD + IND + LBL_W + IW + 10, y, BTN_W, ROW_H,
                THEME.primary, THEME.primaryHover, THEME.primaryBorder, function () {
                  var v = parseInt(inp.text, 10);
                  if (isNaN(v) || v < 0) v = 0;
                  G.__hmSet[row.key] = v;
                  try { if (row.apply) row.apply(v); } catch (e) {}
                  try { G.__hmTitle.text = 'HM ' + row.label + ' = ' + v; } catch (e) {}
                  refreshTop();
                });
              y += ROW_H + 6;

            } else if (row.t === 'sw') {
              if (row.half) {
                // ---- 开关行（半宽，两列并排）----
                // 整宽排布时标签在最左、开关在最右，中间空一大片，
                // 视觉上很散。半宽两列把开关拉近标签，也省掉两行高度。
                var colW = Math.floor((CW - 16) / 2);
                var col = halfCount % 2;
                if (col === 0) halfRowY = y;
                var bx = PAD + IND + col * (colW + 16);
                mkText(content, row.label, bx, halfRowY + 9, 21, THEME.label);
                mkSwitch(content, !!G.__hmSet[row.key], bx + colW - 64, halfRowY, function (on) {
                  G.__hmSet[row.key] = on;
                  try { if (row.onChange) row.onChange(on); } catch (e) {}
                });
                halfCount++;
                if (halfCount % 2 === 0) y += SW_H + 6;
              } else {
                // ---- 开关行（整宽）----
                mkText(content, row.label, PAD + IND, y + 11, 21, THEME.label);
                mkSwitch(content, !!G.__hmSet[row.key], W - PAD - 72, y, function (on) {
                  G.__hmSet[row.key] = on;
                  try { if (row.onChange) row.onChange(on); } catch (e) {}
                });
                y += SW_H + 6;
              }

            } else if (row.t === 'gear') {
              // ---- 挡位选择行 ----
              mkText(content, row.label, PAD + IND, y, 21, THEME.label);
              y += 30;
              var gearW = CW;
              var gSel = -1;
              for (var gi = 0; gi < row.opts.length; gi++) {
                if (row.opts[gi].value === G.__hmSet[row.key]) gSel = gi;
              }
              if (gSel < 0) gSel = 0;
              mkGearRow(content, row.opts, gSel, PAD + IND, y, gearW, 46, function (idx, opt) {
                G.__hmSet[row.key] = opt.value;
                try { if (row.apply) row.apply(opt.value); } catch (e) {}
                try { G.__hmTitle.text = 'HM ' + row.label + ' = ' + opt.label; } catch (e) {}
                refreshTop();
              });
              y += 46 + 12;
            }
          })(sec.rows[ri]);
        }
        y += 8;
      }

      try { content.size(W, y + 24); } catch (e) {}

      // ---- 底部固定栏 ----
      var FY = H - FOOT;
      var foot = new Laya.Sprite();
      try { foot.size(W, FOOT); foot.pos(0, FY); foot.mouseEnabled = true; } catch (e) {}
      try {
        if (HAS_PATH) {
          foot.graphics.drawPath(0, 0, rrBottomPath(0, 0, W, FOOT, R_PANEL), THEME.foot, null, 0);
        } else {
          foot.graphics.drawRect(0, 0, W, FOOT, THEME.foot);
        }
      } catch (e) {}
      try { body.addChild(foot); } catch (e) {}

      var acts = LAY.actions || [];
      if (acts.length >= 2) {
        var bw = (W - PAD * 3) / 2;
        for (var ai = 0; ai < 2; ai++) {
          var a = acts[ai];
          mkBtn(foot, a.label, PAD + ai * (bw + PAD), 15, bw, 56,
            a.color || THEME.primary,
            a.colorHover || THEME.primaryHover,
            a.border || THEME.primaryBorder,
            a.fn);
        }
      } else if (acts.length === 1) {
        mkBtn(foot, acts[0].label, PAD, 15, W - PAD * 2, 56,
          acts[0].color || THEME.primary,
          acts[0].colorHover || THEME.primaryHover,
          acts[0].border || THEME.primaryBorder,
          acts[0].fn);
      }

      // ---- 初始状态 ----
      G.__hmRoleMax = G.__hmMaxRole();
      try { body.visible = !G.__hmCollapsed; } catch (e) {}
      try { mini.visible = !!G.__hmCollapsed; } catch (e) {}
      G.__hmRefreshUI();
      return body;
    }

    G.__hmUI = function () {
      var stage = null;
      try { stage = Laya.stage; } catch (e) {}
      if (!stage || typeof Laya.Sprite !== 'function') return null;

      var f = collect(stage);
      if (f.body && f.mini) {
        G.__hmBody = f.body;
        G.__hmMini = f.mini;
        try { G.__hmBody.visible = !G.__hmCollapsed; } catch (e) {}
        try { G.__hmMini.visible = !!G.__hmCollapsed; } catch (e) {}
        return f.body;
      }
      if (f.body) { try { stage.removeChild(f.body); } catch (e) {} }
      if (f.mini) { try { stage.removeChild(f.mini); } catch (e) {} }
      return buildPanel(stage);
    };
// ===== HM UI BLOCK END =====
