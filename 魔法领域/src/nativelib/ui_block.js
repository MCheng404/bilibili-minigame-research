    // ================================================================
    // 通用悬浮面板框架（所有小程序游戏共用）
    // ---------------------------------------------------------------
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

    // ---------- 通用组件 ----------

    function refreshTop() {
      try {
        var f = findView();
        if (f.view) f.view.refreshUI();
      } catch (e) {}
    }

    /** 实心矩形（平面色块，无渐变） */
    function mkBox(parent, x, y, w, h, color) {
      var sp = new Laya.Sprite();
      try {
        sp.size(w, h);
        sp.pos(x, y);
        sp.mouseEnabled = true;
        if (color) sp.graphics.drawRect(0, 0, w, h, color);
      } catch (e) {}
      try { parent.addChild(sp); } catch (e) {}
      return sp;
    }

    /** 带边框矩形 */
    function mkFrame(parent, x, y, w, h, fill, borderColor, borderWidth) {
      var sp = new Laya.Sprite();
      try {
        sp.size(w, h);
        sp.pos(x, y);
        sp.mouseEnabled = true;
        sp.graphics.drawRect(0, 0, w, h, fill || null);
        if (borderColor) sp.graphics.drawRect(0, 0, w, h, null, borderColor, borderWidth || 2);
      } catch (e) {}
      try { parent.addChild(sp); } catch (e) {}
      return sp;
    }

    /** 文本标签 */
    function mkText(parent, text, x, y, fontSize, color) {
      var t = new Laya.Text();
      try {
        t.text = String(text);
        t.fontSize = fontSize;
        t.color = color || '#FFFFFF';
        t.pos(x, y);
        t.bold = false;
      } catch (e) {}
      try { parent.addChild(t); } catch (e) {}
      return t;
    }

    /** 数字输入框 */
    function mkInput(parent, value, x, y, w, h) {
      var t = new Laya.TextInput();
      try {
        t.size(w, h);
        t.pos(x, y);
        t.fontSize = 23;
        t.color = '#E8F0FF';
        t.bgColor = '#141C2B';
        t.borderColor = '#2C6BED';
        t.padding = '8,12,8,12';
        t.type = 'number';
        t.text = String(value);
      } catch (e) {}
      try { parent.addChild(t); } catch (e) {}
      return t;
    }

    /** 自绘开关 */
    function drawSwitch(sp, on) {
      try {
        sp.graphics.clear();
        sp.graphics.drawRect(0, 0, 72, 38, on ? '#1F7A4D' : '#39404D');
        sp.graphics.drawCircle(on ? 53 : 19, 19, 15, on ? '#7BE3A8' : '#8A93A6');
      } catch (e) {}
    }

    function mkSwitch(parent, on, x, y, onChange) {
      var sp = new Laya.Sprite();
      try { sp.size(72, 38); sp.pos(x, y); sp.mouseEnabled = true; } catch (e) {}
      drawSwitch(sp, on);
      try {
        sp.on('click', null, function () {
          on = !on;
          drawSwitch(sp, on);
          try { onChange(on); } catch (e) {}
        });
      } catch (e) {}
      try { parent.addChild(sp); } catch (e) {}
      return sp;
    }

    /**
     * 挡位选择器：一排等宽按钮，选中高亮。
     * opts = [{label:'1x', value:1.31}, ...]
     * 返回 { setSelected(idx), getSelected() }
     */
    function mkGearRow(parent, opts, selectedIdx, x, y, w, h, onSelect) {
      var n = opts.length;
      if (!n) return null;
      var gap = 6;
      var bw = Math.floor((w - gap * (n - 1)) / n);
      var btns = [];
      var cur = selectedIdx;

      function paint() {
        for (var i = 0; i < n; i++) {
          var active = (i === cur);
          try {
            btns[i].graphics.clear();
            btns[i].graphics.drawRect(0, 0, bw, h, active ? '#2456B8' : '#252D3B');
            btns[i].graphics.drawRect(0, 0, bw, h, null, active ? '#6EA8FF' : '#39404D', 2);
          } catch (e) {}
          try {
            if (btns[i].__label) {
              btns[i].__label.color = active ? '#FFFFFF' : '#8FB4DC';
            }
          } catch (e) {}
        }
      }

      for (var i = 0; i < n; i++) {
        var b = new Laya.Sprite();
        try {
          b.size(bw, h);
          b.pos(x + i * (bw + gap), y);
          b.mouseEnabled = true;
        } catch (e) {}
        var lbl = mkText(b, opts[i].label, 0, 0, 21, '#8FB4DC');
        try {
          // 文字居中
          lbl.x = Math.floor((bw - String(opts[i].label).length * 11) / 2);
          lbl.y = Math.floor((h - 26) / 2);
        } catch (e) {}
        b.__label = lbl;
        btns.push(b);
        try { parent.addChild(b); } catch (e) {}
        (function (idx) {
          try {
            btns[idx].on('click', null, function () {
              cur = idx;
              paint();
              try { onSelect(idx, opts[idx]); } catch (e) {}
            });
          } catch (e) {}
        })(i);
      }
      paint();

      return {
        setSelected: function (idx) { cur = idx; paint(); },
        getSelected: function () { return cur; }
      };
    }

    /** 标准按钮 */
    function mkBtn(parent, label, x, y, w, h, color, onClick) {
      var b = mkBox(parent, x, y, w, h, color);
      mkText(b, label, 0, 0, 23, '#FFFFFF');
      try {
        b.__label.x = Math.floor((w - String(label).length * 12) / 2);
        b.__label.y = Math.floor((h - 28) / 2);
      } catch (e) {}
      try { b.on('click', null, onClick); } catch (e) {}
      return b;
    }

    // ---------- 面板构建（配置驱动） ----------

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
        mini.graphics.drawCircle(R, R, R, 'rgba(44,107,237,0.94)');
        mini.graphics.drawCircle(R, R, R, null, '#9FD0FF', 2);
      } catch (e) {}
      try { stage.addChild(mini); } catch (e) {}
      mkText(mini, 'HM', R - 18, R - 14, 22, '#FFFFFF');
      try { mini.on('click', null, function () { setCollapsed(false); }); } catch (e) {}
      G.__hmMini = mini;

      // ---- 展开态：3/4 屏幕居中 ----
      var W = Math.floor(sw * 0.78);
      var H = Math.floor(sh * 0.78);
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
        body.graphics.drawRect(0, 0, W, H, 'rgba(10,14,26,0.97)');
        body.graphics.drawRect(0, 0, W, H, null, '#4DA6FF', 2);
      } catch (e) {}
      try { stage.addChild(body); } catch (e) {}
      G.__hmBody = body;

      // ---- 标题栏 ----
      var TB = 56;
      var bar = mkBox(body, 0, 0, W, TB, '#16324F');
      G.__hmTitle = mkText(bar, 'HM 修改器', 20, 15, 22, '#9FD0FF');

      // 关闭按钮（圆形）
      var CR = 20;
      var close = new Laya.Sprite();
      try {
        close.size(CR * 2, CR * 2);
        close.pos(W - CR * 2 - 12, (TB - CR * 2) / 2);
        close.mouseEnabled = true;
        close.graphics.drawCircle(CR, CR, CR, 'rgba(196,60,72,0.92)');
      } catch (e) {}
      mkText(close, '×', CR - 9, CR - 16, 28, '#FFFFFF');
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
      var FOOT = 84;
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
      var PAD = 20;
      var LW = 130;               // 标签列宽
      var AW = 80;                // 应用按钮宽
      var IW = W - LW - AW - PAD * 2 - 20;  // 输入框宽
      var y = 16;

      for (var si = 0; si < LAY.sections.length; si++) {
        var sec = LAY.sections[si];

        // 分组标题
        mkText(content, sec.title, PAD, y, 18, '#5C8CC0');
        y += 32;

        for (var ri = 0; ri < sec.rows.length; ri++) {
          var row = sec.rows[ri];

          if (row.t === 'num') {
            // ---- 数值输入行 ----
            mkText(content, row.label, PAD, y + 14, 21, '#8FB4DC');
            var inp = mkInput(content, G.__hmSet[row.key], PAD + LW, y, IW, 52);
            var btn = mkBox(content, PAD + LW + IW + 10, y, AW, 52, '#2456B8');
            mkText(btn, '应用', 0, 0, 21, '#FFFFFF');
            try {
              btn.__label.x = Math.floor((AW - 42) / 2);
              btn.__label.y = 14;
            } catch (e) {}
            (function (key, label, applyFn, input) {
              try {
                btn.on('click', null, function () {
                  var v = parseInt(input.text, 10);
                  if (isNaN(v) || v < 0) v = 0;
                  G.__hmSet[key] = v;
                  try { if (applyFn) applyFn(v); } catch (e) {}
                  try { G.__hmTitle.text = 'HM ' + label + ' = ' + v; } catch (e) {}
                  refreshTop();
                });
              } catch (e) {}
            })(row.key, row.label, row.apply, inp);
            y += 62;

          } else if (row.t === 'sw') {
            // ---- 开关行 ----
            mkText(content, row.label, PAD, y + 9, 21, '#8FB4DC');
            mkSwitch(content, !!G.__hmSet[row.key], W - 72 - PAD, y, function (on) {
              G.__hmSet[row.key] = on;
              try { if (row.onChange) row.onChange(on); } catch (e) {}
            });
            y += 52;

          } else if (row.t === 'gear') {
            // ---- 挡位选择行 ----
            mkText(content, row.label, PAD, y, 21, '#8FB4DC');
            y += 30;
            var gearW = W - PAD * 2;
            var gSel = -1;
            for (var gi = 0; gi < row.opts.length; gi++) {
              if (row.opts[gi].value === G.__hmSet[row.key]) gSel = gi;
            }
            if (gSel < 0) gSel = 0;
            mkGearRow(content, row.opts, gSel, PAD, y, gearW, 50, function (idx, opt) {
              G.__hmSet[row.key] = opt.value;
              try { if (row.apply) row.apply(opt.value); } catch (e) {}
              try { G.__hmTitle.text = 'HM ' + row.label + ' = ' + opt.label; } catch (e) {}
              refreshTop();
            });
            y += 62;
          }
        }
        y += 10;
      }

      try { content.size(W, y + 24); } catch (e) {}

      // ---- 底部固定按钮 ----
      var FY = H - FOOT;
      try { mkBox(body, 0, FY, W, FOOT, '#16324F'); } catch (e) {}
      var acts = LAY.actions || [];
      if (acts.length >= 2) {
        var bw = (W - PAD * 3) / 2;
        for (var ai = 0; ai < 2; ai++) {
          mkBtn(body, acts[ai].label, PAD + ai * (bw + PAD), FY + 14, bw, 56, acts[ai].color, acts[ai].fn);
        }
      } else if (acts.length === 1) {
        mkBtn(body, acts[0].label, PAD, FY + 14, W - PAD * 2, 56, acts[0].color, acts[0].fn);
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

