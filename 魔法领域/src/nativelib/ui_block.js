    function refreshTop() {
      try {
        var f = findView();
        if (f.view) f.view.refreshUI();
      } catch (e) {}
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

      var sw = stage.width || 400;
      var sh = stage.height || 800;

      // ---------------- 折叠态：圆形悬浮按钮 ----------------
      var R = 30;
      var mini = new Laya.Sprite();
      mini.name = 'hmMini';
      try {
        mini.size(R * 2, R * 2);
        mini.pos(
          (G.__hmPosX === undefined) ? sw - R * 2 - 12 : G.__hmPosX,
          (G.__hmPosY === undefined) ? Math.round(sh * 0.62) : G.__hmPosY
        );
        mini.mouseEnabled = true;
        mini.graphics.drawCircle(R, R, R, 'rgba(44,107,237,0.94)');
        mini.graphics.drawCircle(R, R, R, null, '#9FD0FF', 2);
      } catch (e) {}
      try { stage.addChild(mini); } catch (e) {}
      mkText(mini, 'HM', R - 15, R - 12, 19, '#FFFFFF');
      try { mini.on('click', null, function () { setCollapsed(false); }); } catch (e) {}
      G.__hmMini = mini;

      // ---------------- 展开态：3/4 屏幕居中 ----------------
      var W = Math.floor(sw * 0.75);
      var H = Math.floor(sh * 0.75);
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

      // 标题栏
      var TB = 50;
      var bar = mkBox(body, 0, 0, W, TB, '#16324F');
      G.__hmTitle = mkText(bar, 'HM 修改器', 18, 13, 20, '#9FD0FF');
      var CR = 18;
      var close = new Laya.Sprite();
      try {
        close.size(CR * 2, CR * 2);
        close.pos(W - CR * 2 - 10, (TB - CR * 2) / 2);
        close.mouseEnabled = true;
        close.graphics.drawCircle(CR, CR, CR, 'rgba(196,60,72,0.92)');
      } catch (e) {}
      mkText(close, '×', CR - 8, CR - 14, 25, '#FFFFFF');
      try {
        close.on('click', null, function () {
          G.__hmBodyX = body.x; G.__hmBodyY = body.y;
          G.__hmCollapsed = true;
          try { body.visible = false; } catch (e) {}
          try { mini.visible = true; } catch (e) {}
        });
      } catch (e) {}
      try { bar.addChild(close); } catch (e) {}

      // 拖动：标题栏拖面板，圆钮拖自己
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

      // ---------------- 中间滚动区 ----------------
      var FOOT = 76;
      var sc = null;
      try {
        sc = new Laya.Panel();
        sc.size(W, H - TB - FOOT);
        sc.pos(0, TB);
        sc.vScrollBarSkin = '';
        body.addChild(sc);
      } catch (e) {}
      var content = new Laya.Sprite();
      try { content.size(W, 10); sc.addChild(content); } catch (e) {}

      var LW = 110, AW = 66, PAD = 16;
      var IW = W - LW - AW - PAD * 2 - 16;
      var y = 14;

      function sectionTitle(txt) {
        mkText(content, txt, PAD, y, 14, '#5C8CC0');
        y += 26;
      }

      function numberRow(label, key, applyFn) {
        mkText(content, label, PAD, y + 10, 16, '#8FB4DC');
        var inp = mkInput(content, SET[key], PAD + LW, y, IW, 40);
        var btn = mkBox(content, PAD + LW + IW + 8, y, AW, 40, '#2456B8');
        mkText(btn, '应用', 14, 11, 15, '#FFFFFF');
        try {
          btn.on('click', null, function () {
            var v = parseInt(inp.text, 10);
            if (isNaN(v) || v < 0) v = 0;
            SET[key] = v;
            try { applyFn(v); } catch (e) {}
            try { G.__hmTitle.text = 'HM ' + label + ' = ' + v; } catch (e) {}
            refreshTop();
          });
        } catch (e) {}
        y += 48;
        return inp;
      }

      function switchRow(label, key, onChange) {
        mkText(content, label, PAD, y + 7, 16, '#8FB4DC');
        mkSwitch(content, !!SET[key], W - 62 - PAD, y, function (on) {
          SET[key] = on;
          try { if (onChange) onChange(on); } catch (e) {}
        });
        y += 42;
      }

      function setPlayer(fn) {
        var g = G.__hmg;
        if (!g || !g.playerInfo) return;
        try { fn(g.playerInfo); } catch (e) {}
      }

      sectionTitle('冒险数值');
      numberRow('钻石', 'diamond', function (v) { setPlayer(function (P) { P.outDiamondNum = v; }); });
      numberRow('木材', 'wood', function (v) { setPlayer(function (P) { P.woodNum = v; }); });
      numberRow('石头', 'stone', function (v) { setPlayer(function (P) { P.stoneNum = v; }); });
      numberRow('竞技币', 'pvpCoin', function (v) { setPlayer(function (P) { P.pvpCoin = v; }); });
      numberRow('神石', 'godStone', function (v) { setPlayer(function (P) { P.godStone = v; }); });
      numberRow('经验', 'exp', function (v) { setPlayer(function (P) { P.outExpNum = v; }); });
      numberRow('VIP 等级', 'vip', function (v) {
        var maxVip = (G.__hmMaxVip >= 0) ? G.__hmMaxVip : v;
        if (v > maxVip) v = maxVip;
        setPlayer(function (P) { P.vipLv = v; P.vipExp = 0; });
      });

      y += 8;
      sectionTitle('战斗与功能');
      numberRow('上阵上限', 'roleLimit', function (v) {
        setPlayer(function (P) { if (P.battleSave) P.battleSave.roleLimitNum = v; });
      });
      switchRow('无限金币', 'btGold');
      switchRow('无限血量/人数', 'btHp');
      switchRow('英雄强化', 'btHero');
      switchRow('免广告', 'adFree', function (on) { if (!on) G.__hmAdOn = 0; });
      switchRow('自动应用', 'autoApply');

      try { content.size(W, y + 24); } catch (e) {}

      // ---------------- 底部固定按钮 ----------------
      var FY = H - FOOT;
      try { mkBox(body, 0, FY, W, FOOT, '#16324F'); } catch (e) {}
      var bw = (W - PAD * 3) / 2;
      var b1 = mkBox(body, PAD, FY + 14, bw, 48, '#2456B8');
      mkText(b1, '一键拉满', 20, 14, 17, '#FFFFFF');
      try {
        b1.on('click', null, function () {
          var n = G.__hmApply();
          try { G.__hmTitle.text = 'HM 已应用 ' + n + ' 项'; } catch (e) {}
          refreshTop();
        });
      } catch (e) {}

      var b2 = mkBox(body, PAD * 2 + bw, FY + 14, bw, 48, '#1F7A4D');
      mkText(b2, '写入存档', 20, 14, 17, '#FFFFFF');
      try {
        b2.on('click', null, function () {
          try {
            G.__hmg.PlayerInfo_save();
            G.__hmTitle.text = 'HM 存档已提交';
          } catch (e) {
            try { G.__hmTitle.text = 'HM 存档失败'; } catch (e2) {}
          }
        });
      } catch (e) {}

      G.__hmRoleMax = G.__hmMaxRole();
      try { body.visible = !G.__hmCollapsed; } catch (e) {}
      try { mini.visible = !!G.__hmCollapsed; } catch (e) {}
      G.__hmRefreshUI();
      return body;
    };

