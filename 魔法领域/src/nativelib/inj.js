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
      if (SET.btGold) {
        try { if (b.goldNow !== 999999) { b.goldNow = 999999; n++; } } catch (e) {}
      }
      try {
        if (SET.roleLimit >= 0) { b.roleLimitNum = SET.roleLimit; }
      } catch (e) {}
      if (SET.btHero) {
        try {
          var h = b.heroSaveInfo;
          if (h) {
            h.mp_max = 9999; h.mp_now = 9999;
            h.atk = HERO_ATTR; h.def = HERO_ATTR;
            h.str = HERO_ATTR; h.int = HERO_ATTR;
            n++;
          }
        } catch (e) {}
      }
      var units = 0;
      if (SET.btHp) {
        units = eachUnit(function (u) {
          if (u.teamId !== 0) return;              // 只强化我方
          try {
            if (!u.__hmBoost) { u.__hmBoost = 1; u.life_per = Math.max(1, u.life_per) * 50; }
            var cnt = u.roleNum_init || u.roleNum || 1;
            u.life_max = cnt * u.life_per;
            u.life_now = u.life_max;
            u.roleNum = cnt;
          } catch (e) {}
        });
      }
      G.__hmUnitCount = units;
      G.__hmBattleOn_ = 1;
      try { G.__hmApplySpeed(); } catch (e) {}
      return n;
    };

    // ------------------------------------------------------------ 应用数值
    // ------------------------------------------------------------ 倍速
    // 游戏原生机制：a.gameSpeed_normal(1.31) / a.gameSpeed_double(1.62)，
    // 战斗开始按 setting_doubleSpd 二选一设 Laya.timer.scale。
    // 把两个配置值都改成目标挡位，游戏所有重设路径都会落到我们的值上。
    // 另外在战斗循环里强制回写，防止被 Tween/结算等处的 scale=1 覆盖。
    G.__hmApplySpeed = function () {
      var g = G.__hmg;
      var sp = SET.speed || 1.62;
      try {
        if (G.__hma) {
          G.__hma.gameSpeed_normal = sp;
          G.__hma.gameSpeed_double = sp;
        }
      } catch (e) {}
      try { if (g && g.playerInfo) g.playerInfo.setting_doubleSpd = true; } catch (e) {}
      try { Laya.timer.scale = sp; } catch (e) {}
      G.__hmSpeedNow = sp;
      return sp;
    };

    G.__hmApply = function () {
      var g = G.__hmg;
      if (!g || !g.playerInfo) return 0;
      var P = g.playerInfo, n = 0;
      try { P.outDiamondNum = SET.diamond; n++; } catch (e) {}
      try { P.woodNum = SET.wood; n++; } catch (e) {}
      try { P.stoneNum = SET.stone; n++; } catch (e) {}
      try { P.pvpCoin = SET.pvpCoin; n++; } catch (e) {}
      try { P.godStone = SET.godStone; n++; } catch (e) {}
      try { P.outExpNum = SET.exp; n++; } catch (e) {}
      // 这些不在面板输入框里，仍按固定值拉满
      try {
        P.pvpTicket = 999; P.freeChangeNum = 999; P.pvpScore = 99999;
        P.heroSlice_u = 99999; P.devilProp = 9999; P.godExp = 999999;
        if (SET.adFree) P.freeVideoNum = 999;
        n++;
      } catch (e) {}

      // 体力：上限来自 powerCfg.max（开局判 power>=consume）
      try {
        if (G.__hma && G.__hma.powerCfg && G.__hma.powerCfg.max > 0) {
          P.power = G.__hma.powerCfg.max;
          G.__hmPowerMax = G.__hma.powerCfg.max;
          n++;
        }
      } catch (e) {}

      // 阵营币是长度 5 的数组，逐项写（整体赋值会被后续流程覆盖）
      try {
        var cc = P.campCoinNum;
        if (cc && cc.length) {
          for (var i = 0; i < cc.length; i++) cc[i] = 99999;
          n++;
        }
      } catch (e) {}

      // 神格：small 上限 5，到 6 游戏自己进位
      try {
        P.godLevel_big = 10;
        P.godLevel_small = 5;
        n++;
      } catch (e) {}

      // VIP：getVipValid 里 find().vipLv 无空判断，必须按上限截断
      try {
        var maxVip = -1;
        if (G.__hma && G.__hma.vipCfg && G.__hma.vipCfg.length) maxVip = G.__hma.vipCfg.length - 1;
        G.__hmMaxVip = maxVip;
        if (maxVip >= 0) {
          var want = SET.vip;
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
    // ------------------------------------------------------------ 可配置项
    // 数值目标（输入框可直接改）+ 各功能开关。挂在 globalThis 上，
    // 面板重建/场景切换都不会丢。
    if (!G.__hmSet) {
      G.__hmSet = {
        diamond: 888888,
        wood: 99999,
        stone: 99999,
        pvpCoin: 99999,
        godStone: 99999,
        exp: 999999,
        vip: 10,
        roleLimit: 20,
        speed: 1.62,       // 游戏倍速挡位（1.31/1.62/3/4）
        btGold: true,      // 局内金币
        btHp: true,        // 我方血量/人数
        btHero: true,      // 英雄四维与法力
        adFree: true,      // 免广告
        autoApply: true    // 自动应用
      };
    }
    var SET = G.__hmSet;

    // ------------------------------------------------------------ 布局配置
    // 这是"游戏适配层"：告诉通用面板框架要显示什么、每个控件做什么。
    // 换一款游戏时只需改这里 + __hmApply 系列函数，框架本身不用动。
    if (!G.__hmLayout) {
      G.__hmLayout = {
        sections: [
          {
            title: '冒险数值',
            rows: [
              { t: 'num', label: '钻石', key: 'diamond', apply: function (v) {
                setPlayer(function (P) { P.outDiamondNum = v; });
              }},
              { t: 'num', label: '木材', key: 'wood', apply: function (v) {
                setPlayer(function (P) { P.woodNum = v; });
              }},
              { t: 'num', label: '石头', key: 'stone', apply: function (v) {
                setPlayer(function (P) { P.stoneNum = v; });
              }},
              { t: 'num', label: '竞技币', key: 'pvpCoin', apply: function (v) {
                setPlayer(function (P) { P.pvpCoin = v; });
              }},
              { t: 'num', label: '神石', key: 'godStone', apply: function (v) {
                setPlayer(function (P) { P.godStone = v; });
              }},
              { t: 'num', label: '经验', key: 'exp', apply: function (v) {
                setPlayer(function (P) { P.outExpNum = v; });
              }},
              { t: 'num', label: 'VIP 等级', key: 'vip', apply: function (v) {
                var maxVip = (G.__hmMaxVip >= 0) ? G.__hmMaxVip : v;
                if (v > maxVip) v = maxVip;
                setPlayer(function (P) { P.vipLv = v; P.vipExp = 0; });
              }}
            ]
          },
          {
            title: '战斗与功能',
            rows: [
              { t: 'gear', label: '游戏倍速', key: 'speed',
                opts: [
                  { label: '1x', value: 1.31 },
                  { label: '2x', value: 1.62 },
                  { label: '3x', value: 3 },
                  { label: '4x', value: 4 }
                ],
                apply: function (v) { G.__hmApplySpeed(); }
              },
              { t: 'num', label: '上阵上限', key: 'roleLimit', apply: function (v) {
                setPlayer(function (P) { if (P.battleSave) P.battleSave.roleLimitNum = v; });
              }},
              { t: 'sw', label: '无限金币', key: 'btGold' },
              { t: 'sw', label: '无限血量/人数', key: 'btHp' },
              { t: 'sw', label: '英雄强化', key: 'btHero' },
              { t: 'sw', label: '免广告', key: 'adFree', onChange: function (on) {
                G.__hmAdOn = on ? G.__hmAdOn : 0;
              }},
              { t: 'sw', label: '自动应用', key: 'autoApply' }
            ]
          }
        ],
        actions: [
          { label: '一键拉满', color: '#2456B8', fn: function () {
            var n = G.__hmApply();
            try { G.__hmTitle.text = 'HM 已应用 ' + n + ' 项'; } catch (e) {}
            refreshTop();
          }},
          { label: '写入存档', color: '#1F7A4D', fn: function () {
            try {
              G.__hmg.PlayerInfo_save();
              G.__hmTitle.text = 'HM 存档已提交';
            } catch (e) {
              try { G.__hmTitle.text = 'HM 存档失败'; } catch (e2) {}
            }
          }}
        ]
      };
    }

    function setPlayer(fn) {
      var g = G.__hmg;
      if (!g || !g.playerInfo) return;
      try { fn(g.playerInfo); } catch (e) {}
    }

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

    // 文本输入框。Laya 的 TextInput 没有皮肤时也能用，靠 bgColor/borderColor 兜底，
    // 点一下会弹系统键盘（小游戏容器支持）。
    function mkInput(parent, value, x, y, w, h) {
      var t = new Laya.TextInput();
      try {
        t.size(w, h);
        t.pos(x, y);
        t.fontSize = 17;
        t.color = '#E8F0FF';
        t.bgColor = '#141C2B';
        t.borderColor = '#2C6BED';
        t.padding = '6,10,6,10';
        t.type = 'number';
        t.text = String(value);
      } catch (e) {}
      try { parent.addChild(t); } catch (e) {}
      return t;
    }

    function drawSwitch(sp, on) {
      try {
        sp.graphics.clear();
        sp.graphics.drawRect(0, 0, 62, 32, on ? '#1F7A4D' : '#39404D');
        sp.graphics.drawCircle(on ? 46 : 16, 16, 13, on ? '#7BE3A8' : '#8A93A6');
      } catch (e) {}
    }

    function mkSwitch(parent, on, x, y, onChange) {
      var sp = new Laya.Sprite();
      try { sp.size(62, 32); sp.pos(x, y); sp.mouseEnabled = true; } catch (e) {}
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
