// 注入探针 v12 —— 养成 + 战斗双模式
//
// native 层改写游戏 bundle 源码后挂到 globalThis：
//   __hmg  = 玩家数据单例 g
//   __hma  = 配置单例 a
//   __hmgg = 平台对象 gg
//
// 每个字段的写入上限都从配置表推导，不写死：
//   体力    -> a.powerCfg.max          （click_startGame 用 power>=consume 判开局）
//   兵种等级 -> a.roleUpgradeCfg 的 max lv  （checkStatus 里 find().fragment 无空判断）
//   英雄等级 -> a.hero_upCost 的 max level  （升级处 find().slice 同样无空判断）
//   VIP     -> a.vipCfg.length-1       （getVipValid 里 find().vipLv 无空判断）
//   神格    -> godLevel_small 必须 0..5，累计到 6 会自动进位 big+1
try {
  var G = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (!G.__hmw12) {
    G.__hmw12 = 1;
    var busy = 0;
    if (G.__hmCollapsed === undefined) G.__hmCollapsed = true;

    var WANT = {
      outDiamondNum: 888888,
      woodNum: 99999,
      stoneNum: 99999,
      pvpCoin: 99999,
      godStone: 99999,
      outExpNum: 999999,
      pvpTicket: 999,
      freeVideoNum: 999,
      freeChangeNum: 999,
      godExp: 999999,
      heroSlice_u: 99999,
      devilProp: 9999,
      pvpScore: 99999
    };

    function cfgMax(table, key) {
      var m = 0;
      try {
        if (!table || !table.length) return 0;
        for (var i = 0; i < table.length; i++) {
          var v = table[i][key];
          if (typeof v === 'number' && v > m) m = v;
        }
      } catch (e) {}
      return m;
    }

    // ------------------------------------------------------------ 免广告
    function hmPre() { return true; }
    hmPre.__hm = 1;
    function hmVideo() {
      return new Promise(function (resolve) {
        setTimeout(function () { try { resolve(1); } catch (e) {} }, 30);
      });
    }
    hmVideo.__hm = 1;

    G.__hmAdHook = function () {
      var gg = G.__hmgg || G.gg || (G.GameGlobal && G.GameGlobal.gg) || null;
      if (!gg || !gg.platform) { G.__hmAdOn = 0; return 0; }
      var p = gg.platform;
      try {
        if (typeof p.playVideo_pre !== 'function' || !p.playVideo_pre.__hm) p.playVideo_pre = hmPre;
        if (typeof p.playVideo !== 'function' || !p.playVideo.__hm) {
          if (typeof p.playVideo === 'function') p.__hmRealVideo = p.playVideo;
          p.playVideo = hmVideo;
        }
        G.__hmAdOn = 1;
        return 1;
      } catch (e) { G.__hmAdOn = 0; return 0; }
    };

    // ------------------------------------------------------------ 兵种
    G.__hmMaxRole = function () {
      var max = -1;
      try { if (G.__hma && G.__hma.roleUpgradeCfg) max = cfgMax(G.__hma.roleUpgradeCfg, 'lv'); } catch (e) {}
      if (max > 0) G.__hmRoleMax = max;
      return max;
    };

    G.__hmApplyRoles = function () {
      var g = G.__hmg;
      if (!g || !g.playerInfo) return 0;
      var max = G.__hmRoleMax;
      if (!(max > 0)) max = G.__hmMaxRole();
      if (!(max > 0)) return 0;
      var arr = g.playerInfo.outCampInfo;
      if (!arr || !arr.length) return 0;
      var n = 0;
      for (var i = 0; i < arr.length; i++) {
        try { arr[i].level = max; n++; } catch (e) {}
      }
      return n;
    };

    // ------------------------------------------------------------ 英雄
    // 英雄属性（atk/def/str/int）与 level 分开存储，只改 level 界面数字不会动。
    // 四项必须同值：升级逻辑里有防作弊判断 Math.min(atk,def,int,str)，
    // level>30 时 atk>3.5*p 会触发成长惩罚；全相等时永不触发。
    var HERO_ATTR = 9999;

    G.__hmApplyHeroes = function () {
      var g = G.__hmg;
      if (!g || !g.playerInfo) return 0;
      var max = 0;
      try { max = cfgMax(G.__hma && G.__hma.hero_upCost, 'level'); } catch (e) {}
      if (!(max > 0)) return 0;
      G.__hmHeroMax = max;
      var arr = g.playerInfo.outHeroList;
      if (!arr || !arr.length) return 0;
      var n = 0;
      for (var i = 0; i < arr.length; i++) {
        try {
          arr[i].level = max;
          arr[i].sliceNum = 99999;
          arr[i].atk = HERO_ATTR;
          arr[i].def = HERO_ATTR;
          arr[i].str = HERO_ATTR;
          arr[i].int = HERO_ATTR;
          n++;
        } catch (e) {}
      }
      return n;
    };

    // ------------------------------------------------------------ 天赋
    // talentList 格式 [[talentId, level], ...]，升级时 s ? s[1]++ : push([id,1])。
    // 等级上限硬编码为 3（天赋弹窗里 Math.min(talentDataLevel, 3)）。
    // 战斗读取走 battleSave.heroSaveInfo.talentList，那份是开战时复制的。
    var TALENT_MAX = 3;

    G.__hmApplyTalents = function () {
      var g = G.__hmg;
      if (!g || !g.playerInfo) return 0;
      var arr = g.playerInfo.outHeroList;
      if (!arr || !arr.length) return 0;
      var n = 0;
      for (var i = 0; i < arr.length; i++) {
        var tl = arr[i].talentList;
        if (!tl || !tl.length) continue;
        for (var j = 0; j < tl.length; j++) {
          try {
            if (tl[j] && tl[j].length >= 2) { tl[j][1] = TALENT_MAX; n++; }
          } catch (e) {}
        }
      }
      return n;
    };

    // ------------------------------------------------------------ 战斗内
    // 单位是挂在节点上的 Laya Script，字段：
    //   life_per 单兵血量  life_max/life_now 总血量  roleNum 剩余数量
    //   teamId 0=我方 1=敌方
    // 受击后游戏自己算 roleNum = ceil(life_now / life_per)，数量随血量下降，
    // 所以把 life_per 放大 + life_now 回满，就能同时做到不掉血和不减员。
    function eachUnit(fn) {
      var stage = null;
      try { stage = Laya.stage; } catch (e) {}
      if (!stage) return 0;
      var stack = [stage], guard = 0, n = 0;
      while (stack.length && guard++ < 6000) {
        var node = stack.pop();
        if (!node) continue;
        try {
          var cs = node._components;
          if (cs) {
            for (var i = 0; i < cs.length; i++) {
              var c = cs[i];
              if (c && typeof c.life_now === 'number' && typeof c.life_max === 'number'
                    && typeof c.life_per === 'number') {
                fn(c);
                n++;
              }
            }
          }
        } catch (e) {}
        try {
          var k = node.numChildren | 0;
          for (var j = 0; j < k; j++) stack.push(node.getChildAt(j));
        } catch (e) {}
      }
      return n;
    }

    G.__hmBattle = function () {
      var g = G.__hmg;
      if (!g || !g.playerInfo) return 0;
      var b = g.playerInfo.battleSave;
      if (!b) { G.__hmBattleOn_ = 0; return 0; }
      var n = 0;
      try { if (b.goldNow !== 999999) { b.goldNow = 999999; n++; } } catch (e) {}
      try { b.roleLimitNum = 20; n++; } catch (e) {}
      try {
        var h = b.heroSaveInfo;
        if (h) {
          h.mp_max = 9999; h.mp_now = 9999;
          h.atk = HERO_ATTR; h.def = HERO_ATTR;
          h.str = HERO_ATTR; h.int = HERO_ATTR;
          n++;
        }
      } catch (e) {}
      var units = eachUnit(function (u) {
        if (u.teamId !== 0) return;              // 只强化我方
        try {
          if (!u.__hmBoost) { u.__hmBoost = 1; u.life_per = Math.max(1, u.life_per) * 50; }
          var cnt = u.roleNum_init || u.roleNum || 1;
          u.life_max = cnt * u.life_per;
          u.life_now = u.life_max;
          u.roleNum = cnt;
        } catch (e) {}
      });
      G.__hmUnitCount = units;
      G.__hmBattleOn_ = 1;
      return n;
    };

    // ------------------------------------------------------------ 应用数值
    G.__hmApply = function () {
      var g = G.__hmg;
      if (!g || !g.playerInfo) return 0;
      var P = g.playerInfo, k, n = 0;
      for (k in WANT) {
        if (Object.prototype.hasOwnProperty.call(WANT, k)) {
          try { P[k] = WANT[k]; n++; } catch (e) {}
        }
      }
      // 体力：和 click_startGame 的 consume 判断共用同一个上限
      try {
        if (G.__hma && G.__hma.powerCfg && G.__hma.powerCfg.max > 0) {
          P.power = G.__hma.powerCfg.max;
          G.__hmPowerMax = G.__hma.powerCfg.max;
          n++;
        }
      } catch (e) {}

      // 阵营币是长度 5 的数组，整体赋值会被后续流程覆盖，逐项写更稳
      try {
        var cc = P.campCoinNum;
        if (cc && cc.length) {
          for (var i = 0; i < cc.length; i++) cc[i] = 99999;
          n++;
        }
      } catch (e) {}

      // 神格：small 上限 5，到 6 游戏自己会进位
      try {
        P.godLevel_big = 10;
        P.godLevel_small = 5;
        n++;
      } catch (e) {}

      // VIP
      try {
        var maxVip = -1;
        if (G.__hma && G.__hma.vipCfg && G.__hma.vipCfg.length) maxVip = G.__hma.vipCfg.length - 1;
        G.__hmMaxVip = maxVip;
        if (maxVip >= 0) {
          var want = 10;
          if (want > maxVip) want = maxVip;
          P.vipLv = want;
          try { P.vipExp = 0; } catch (e) {}
          G.__hmVip = want;
          n++;
        }
      } catch (e) {}

      n += G.__hmApplyRoles();
      n += G.__hmApplyHeroes();
      n += G.__hmApplyTalents();
      return n;
    };

    // ------------------------------------------------------------ 视图查找
    function findN(n, name, d) {
      if (!n || d > 16) return null;
      try {
        if (n.name === name) return n;
        var k = n.numChildren | 0;
        for (var i = 0; i < k; i++) { var r = findN(n.getChildAt(i), name, d + 1); if (r) return r; }
      } catch (e) {}
      return null;
    }
    function findView() {
      var stage = null, lbl = null, view = null;
      try { stage = Laya.stage; } catch (e) {}
      if (!stage) return { stage: null, lbl: null, view: null };
      try { lbl = findN(stage, 'lab_goldNum', 0); } catch (e) {}
      var p = lbl;
      while (p) {
        try { if (typeof p.refreshUI === 'function') { view = p; break; } } catch (e) {}
        p = p.parent;
      }
      return { stage: stage, lbl: lbl, view: view };
    }

    // ------------------------------------------------------------ 面板
    var rows = [];

    function mkText(parent, str, x, y, size, color) {
      var t = new Laya.Text();
      t.text = str;
      t.fontSize = size;
      t.color = color;
      t.pos(x, y);
      parent.addChild(t);
      return t;
    }
    function mkBox(parent, x, y, w, h, fill, stroke) {
      var s = new Laya.Sprite();
      s.size(w, h);
      s.pos(x, y);
      s.mouseEnabled = true;
      try {
        s.graphics.drawRect(0, 0, w, h, fill);
        if (stroke) s.graphics.drawRect(0, 0, w, h, null, stroke, 1);
      } catch (e) {}
      parent.addChild(s);
      return s;
    }

    function setCollapsed(v) {
      G.__hmCollapsed = !!v;
      try { if (G.__hmMini) G.__hmMini.visible = !!v; } catch (e) {}
      try { if (G.__hmBody) G.__hmBody.visible = !v; } catch (e) {}
    }

    function collect(stage) {
      var body = null, mini = null, extra = [], i, c, n;
      try {
        for (i = stage.numChildren - 1; i >= 0; i--) {
          c = stage.getChildAt(i);
          if (!c) continue;
          n = null;
          try { n = c.name; } catch (e) {}
          if (n === 'hmBody') { if (body) extra.push(c); else body = c; }
          else if (n === 'hmMini') { if (mini) extra.push(c); else mini = c; }
        }
      } catch (e) {}
      for (i = 0; i < extra.length; i++) {
        try { stage.removeChild(extra[i]); } catch (e) {}
      }
      return { body: body, mini: mini, removed: extra.length };
    }

    G.__hmDropUI = function () {
      var stage = null;
      try { stage = Laya.stage; } catch (e) {}
      if (!stage) return;
      try {
        for (var i = stage.numChildren - 1; i >= 0; i--) {
          var c = stage.getChildAt(i), n = null;
          try { n = c.name; } catch (e) {}
          if (n === 'hmBody' || n === 'hmMini') stage.removeChild(c);
        }
      } catch (e) {}
      G.__hmBody = null; G.__hmMini = null; rows = [];
    };

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
      var defX = Math.max(4, sw - 78);
      var px = (G.__hmPosX === undefined) ? defX : G.__hmPosX;
      var py = (G.__hmPosY === undefined) ? 250 : G.__hmPosY;

      // 折叠态
      var mini = mkBox(stage, px, py, 84, 34, 'rgba(16,40,72,0.92)', '#4DA6FF');
      mini.name = 'hmMini';
      mkText(mini, 'HM', 16, 7, 18, '#9FD0FF');
      try { mini.on('click', null, function () { setCollapsed(false); }); } catch (e) {}
      G.__hmMini = mini;

      // 展开态：放大到 300 x 452
      var W = 300, H = 520;
      var body = new Laya.Sprite();
      body.name = 'hmBody';
      body.size(W, H);
      body.pos((G.__hmPosX === undefined) ? Math.max(4, sw - W - 4) : G.__hmPosX, py);
      try { body.zOrder = 999999; } catch (e) {}
      body.mouseEnabled = true;
      try {
        body.graphics.drawRect(0, 0, W, H, 'rgba(10,14,26,0.95)');
        body.graphics.drawRect(0, 0, W, H, null, '#4DA6FF', 1);
      } catch (e) {}
      try { stage.addChild(body); } catch (e) {}
      G.__hmBody = body;

      var bar = mkBox(body, 0, 0, W, 30, '#16324F');
      G.__hmTitle = mkText(bar, 'HM 修改器', 12, 6, 17, '#9FD0FF');
      mkText(bar, 'v9', W - 62, 9, 13, '#5C8CC0');
      var fold = mkBox(bar, W - 34, 0, 34, 30, '#2456B8');
      mkText(fold, '—', 12, 4, 17, '#FFFFFF');
      try { fold.on('click', null, function () { setCollapsed(true); }); } catch (e) {}

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
            G.__hmPosX = t.x; G.__hmPosY = t.y;
          });
          stage.on('mouseup', null, function () { G.__hmDrag = false; });
        } catch (e) {}
      }

      rows = [];
      var y = 40;
      function addRow(label, getter) {
        mkText(body, label, 14, y, 15, '#7FA8D0');
        var v = mkText(body, '-', 116, y, 15, '#E8F0FF');
        rows.push({ t: v, g: getter });
        y += 26;
      }
      addRow('钻石', function (P) { return String(P.outDiamondNum); });
      addRow('木材', function (P) { return String(P.woodNum); });
      addRow('石头', function (P) { return String(P.stoneNum); });
      addRow('竞技币', function (P) { return String(P.pvpCoin); });
      addRow('神石', function (P) { return String(P.godStone); });
      addRow('VIP', function (P) { return String(P.vipLv) + (G.__hmMaxVip >= 0 ? ' / ' + G.__hmMaxVip : ''); });
      addRow('神格', function (P) { return P.godLevel_big + '.' + P.godLevel_small; });
      addRow('体力', function (P) { return String(P.power) + (G.__hmPowerMax ? ' / ' + G.__hmPowerMax : ''); });
      addRow('兵种', function (P) {
        var arr = P.outCampInfo || [];
        if (!arr.length) return G.__hmRoleMax > 0 ? '未解锁(上限' + G.__hmRoleMax + ')' : '未解锁';
        var mx = 0;
        for (var i = 0; i < arr.length; i++) if (arr[i].level > mx) mx = arr[i].level;
        return arr.length + '个 / Lv' + mx;
      });
      addRow('英雄', function (P) {
        var arr = P.outHeroList || [];
        if (!arr.length) return '无';
        var mx = 0;
        for (var i = 0; i < arr.length; i++) if (arr[i].level > mx) mx = arr[i].level;
        return arr.length + '个 / Lv' + mx;
      });
      addRow('天赋', function (P) {
        var arr = P.outHeroList || [];
        if (!arr.length) return '无';
        var tot = 0, mx = 0;
        for (var i = 0; i < arr.length; i++) {
          var tl = arr[i].talentList || [];
          tot += tl.length;
          for (var j = 0; j < tl.length; j++) if (tl[j] && tl[j][1] > mx) mx = tl[j][1];
        }
        return tot + '个 / Lv' + mx;
      });
      addRow('免广', function () { return G.__hmAdOn ? '已启用' : '未接管'; });
      addRow('战斗', function (P) {
        if (!P.battleSave) return '未进入';
        return '金币' + P.battleSave.goldNow + ' · 单位' + (G.__hmUnitCount || 0);
      });

      // 两列布局：6 个按钮排 3 行
      var BW = 132, BX1 = 14, BX2 = 154, BH = 34;
      function mkBtn(label, bx, by, bw, color, cb) {
        var b = mkBox(body, bx, by, bw, BH, color);
        mkText(b, label, 10, 8, 14, '#FFFFFF');
        try { b.on('click', null, cb); } catch (e) {}
        return b;
      }

      mkBtn('全部拉满', BX1, y + 2, BW, '#2456B8', function () {
        var n = G.__hmApply();
        try { G.__hmTitle.text = 'HM 已应用 ' + n + ' 项'; } catch (e) {}
        var fv = findView();
        try { if (fv.view) fv.view.refreshUI(); } catch (e) {}
        try { G.__hmRefreshUI(); } catch (e) {}
      });
      mkBtn('写入存档', BX2, y + 2, BW, '#1F7A4D', function () {
        try {
          G.__hmg.PlayerInfo_save();
          G.__hmTitle.text = 'HM 存档已提交';
        } catch (e) {
          try { G.__hmTitle.text = 'HM 存档失败'; } catch (e2) {}
        }
      });
      mkBtn('兵种满级', BX1, y + 42, BW, '#7A4BC4', function () {
        var n = G.__hmApplyRoles();
        try { G.__hmTitle.text = n > 0 ? ('HM 兵种 Lv' + G.__hmRoleMax + ' x' + n) : 'HM 兵种数据缺失'; } catch (e) {}
        try { G.__hmRefreshUI(); } catch (e) {}
      });
      mkBtn('英雄满级', BX2, y + 42, BW, '#A8552E', function () {
        var n = G.__hmApplyHeroes();
        try { G.__hmTitle.text = n > 0 ? ('HM 英雄 Lv' + G.__hmHeroMax + ' x' + n) : 'HM 英雄数据缺失'; } catch (e) {}
        try { G.__hmRefreshUI(); } catch (e) {}
      });
      mkBtn('天赋全满', BX1, y + 82, BW, '#2E8B7A', function () {
        var n = G.__hmApplyTalents();
        try { G.__hmTitle.text = n > 0 ? ('HM 天赋 Lv' + TALENT_MAX + ' x' + n) : 'HM 天赋数据缺失'; } catch (e) {}
        try { G.__hmRefreshUI(); } catch (e) {}
      });
      mkBtn('战斗强化', BX2, y + 82, BW, '#B04A6E', function () {
        var n = G.__hmBattle();
        try {
          G.__hmTitle.text = n > 0 ? ('HM 战斗已强化 · 单位' + (G.__hmUnitCount || 0)) : 'HM 未进入战斗';
        } catch (e) {}
        try { G.__hmRefreshUI(); } catch (e) {}
      });

      G.__hmRoleMax = G.__hmMaxRole();
      setCollapsed(G.__hmCollapsed);
      G.__hmRefreshUI();
      return body;
    };

    G.__hmRefreshUI = function () {
      var g = G.__hmg;
      if (!g || !g.playerInfo || !rows.length) return;
      var P = g.playerInfo;
      for (var i = 0; i < rows.length; i++) {
        try { rows[i].t.text = rows[i].g(P); } catch (e) {}
      }
    };

    // ------------------------------------------------------------ 主循环
    G.__hmdump = function () {
      if (busy) return;
      busy = 1;
      var R = { ts: Date.now() };
      try {
        var g = G.__hmg;
        R.gok = (g && g.playerInfo) ? 1 : 0;
        if (!g) R.gerr = G.__hmge || 'undef';
        R.aok = (G.__hma && G.__hma.vipCfg) ? 1 : 0;
        if (!R.aok) R.aerr = G.__hae || 'undef';
        R.ad = G.__hmAdHook();
        if (!R.ad) R.aderr = G.__hge || 'no gg';

        var f = findView();
        R.lb = f.lbl ? 1 : 0;
        R.vi = f.view ? 1 : 0;

        if (g && g.playerInfo) {
          var P = g.playerInfo;
          if (!G.__hmchg) {
            var rec = [], kk;
            for (kk in WANT) {
              if (Object.prototype.hasOwnProperty.call(WANT, kk)) {
                rec.push(kk + ':' + String(P[kk]) + '>' + WANT[kk]);
              }
            }
            G.__hmchg = rec.join(' | ');
          }
          R.chg = G.__hmchg;

          G.__hmApply();
          R.dia = P.outDiamondNum;
          R.vip = P.vipLv;
          R.maxVip = G.__hmMaxVip;
          R.roleMax = G.__hmRoleMax;
          R.heroMax = G.__hmHeroMax;
          R.powerMax = G.__hmPowerMax;
          R.power = P.power;
          R.god = P.godLevel_big + '.' + P.godLevel_small;
          try {
            var rs = P.outCampInfo || [];
            R.roleN = rs.length;
            var mx = 0;
            for (var i = 0; i < rs.length; i++) if (rs[i].level > mx) mx = rs[i].level;
            R.roleLv = mx;
            var hs = P.outHeroList || [];
            R.heroN = hs.length;
            var hmx = 0;
            for (var j = 0; j < hs.length; j++) if (hs[j].level > hmx) hmx = hs[j].level;
            R.heroLv = hmx;
            R.heroUnlocked = 0;
            for (var q = 0; q < hs.length; q++) if (hs[q].isUnlock) R.heroUnlocked++;
            R.campCoins = (P.campCoinNum || []).join(',');
          } catch (e) {}

          try {
            var bb = P.battleSave;
            R.bt = bb ? 1 : 0;
            if (bb) {
              R.gold = bb.goldNow;
              R.limit = bb.roleLimitNum;
              R.unit = G.__hmUnitCount || 0;
            }
            try { if (G.__hmBattleAuto) G.__hmBattle(); } catch (e) {}
            var tl0 = hs && hs.length ? (hs[0].talentList || []) : [];
            R.talN = tl0.length;
            R.talLv = 0;
            for (var tq = 0; tq < tl0.length; tq++) if (tl0[tq] && tl0[tq][1] > R.talLv) R.talLv = tl0[tq][1];
          } catch (e) {}

          try { if (f.view) f.view.refreshUI(); } catch (e) {}
          try { R.t2 = f.lbl ? String(f.lbl.text) : null; } catch (e) {}
        }

        try {
          G.__hmUI();
          G.__hmRefreshUI();
          var cc = collect(f.stage);
          R.ui = G.__hmBody ? (G.__hmCollapsed ? 2 : 1) : 0;
          R.uiDup = cc.removed;
        } catch (e) { R.uierr = String(e); }
      } catch (e) { R.e = String(e); }
      var s = 'HMR12|' + encodeURIComponent(JSON.stringify(R));
      var b = new Uint8Array(7000), n2;
      for (n2 = 0; n2 < s.length && n2 < 6980; n2++) b[n2] = s.charCodeAt(n2);
      G.__hmt = b;
      busy = 0;
    };

    try { G.__hmdump(); } catch (e) {}
    setInterval(function () { try { G.__hmdump(); } catch (e) {} }, 2500);
    setInterval(function () { try { G.__hmRefreshUI(); } catch (e) {} }, 600);
    // 战斗内单独跑快循环：2.5s 太慢，血量可能已经被打空
    if (G.__hmBattleAuto === undefined) G.__hmBattleAuto = true;
    setInterval(function () {
      try {
        if (!G.__hmBattleAuto) return;
        var g = G.__hmg;
        if (g && g.playerInfo && g.playerInfo.battleSave) G.__hmBattle();
      } catch (e) {}
    }, 500);
  }
} catch (e) {}
