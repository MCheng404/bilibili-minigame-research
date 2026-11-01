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

    // ===== HM UNITY INLINE =====
    /*
     * Unity 小游戏（别碰我的菜 / HarvestKing）的适配层。
     * 架构与 Laya 完全不同：
     *   Laya  —— 逻辑在 JS，能直接改 playerInfo
     *   Unity —— 逻辑在 wasm，JS 层看不到数值单例，
     *            唯一入口是**明文 JSON 存档**和 **wx 广告 API**
     * 所以这三个模块与 Laya 探针并存，靠引擎判定互斥启用。
     */
    (function () {
      var GG = (typeof globalThis !== 'undefined') ? globalThis : this;

      /*
       * 引擎判定 —— 必须**延迟**，不能只判一次。
       *
       * 时序：native 层在改写 bundle 源码时插入了 `globalThis.__hmUnity=1`，
       * 但那段代码要等 **bundle 执行**时才跑；
       * 而 inj.js 是在 bundle **编译之后**就注入运行的 ——
       * 那一刻 __hmUnity 还是 undefined。
       *
       * 所以这里持续轮询，直到认出 Unity 才加载模块。
       * 判据有三条，任意一条成立即可：
       *   1) __hmUnity        —— native 层改写 Unity bundle 时挂的标记
       *   2) GameGlobal.__cmgeSubpackages —— Unity 适配层的子包列表
       *   3) GameGlobal.unityNamespace   —— Unity 命名空间
       */
      function detectUnity() {
        try { if (GG.__hmUnity) return 1; } catch (e) {}
        try {
          if (GG.GameGlobal) {
            if (GG.GameGlobal.__cmgeSubpackages &&
                GG.GameGlobal.__cmgeSubpackages.length) return 1;
            if (GG.GameGlobal.unityNamespace) return 1;
            if (GG.GameGlobal.manager) return 1;
          }
        } catch (e) {}
        // __hmBridge 是 native 层在 Unity bundle 里挂的桥接，
        // 它只暴露 GameGlobal/wx/bl/canvas/document —— Laya 不会有
        try {
          if (typeof GG.__hmBridge === 'function') {
            var b = GG.__hmBridge();
            if (b && b.GameGlobal && b.GameGlobal.unityNamespace) return 1;
          }
        } catch (e) {}
        return 0;
      }

      var mods = ['harvest.js', 'unity_ui.js', 'harvest_adapt.js'];
      var tried = 0;

      function tryLoad() {
        if (tried) return;
        if (!detectUnity()) return;      // 还没认出来，下一轮再试
        tried = 1;
        for (var i = 0; i < mods.length; i++) {
          try {
            if (typeof GG.__hmModules === 'undefined') GG.__hmModules = {};
            if (GG.__hmModules[mods[i]]) continue;
            GG.__hmModules[mods[i]] = 1;
            // 模块源码在构建时内联到 G.__hmModuleSrc
            var src = GG.__hmModuleSrc && GG.__hmModuleSrc[mods[i]];
            if (src) (0, eval)(src);
          } catch (e) {
            try { GG.__hmUnityErr = (GG.__hmUnityErr || '') + mods[i] + ':' + e + ';'; } catch (e2) {}
          }
        }
        try { GG.__hmUnityLoaded = 1; } catch (e) {}
      }

      // 轮询：bundle 执行得晚（Unity 要下载编译 wasm），所以要多试几轮
      [0, 200, 600, 1200, 2500, 4000, 6000, 9000, 14000, 20000].forEach(function (ms) {
        setTimeout(function () { try { tryLoad(); } catch (e) {} }, ms);
      });
    })();
    // ===== /HM UNITY INLINE =====
    // ===== HM COMMON INLINE =====
    /* 本块由 build_common.py 自动生成，请改 nativelib/common.js */
    /* content-sha1: db9c27adfd9b */
/* =============================================================================
 * HM 通用脚本 —— 未适配小游戏的通用能力层
 * -----------------------------------------------------------------------------
 * 这份脚本不依赖任何具体游戏的数据结构，任何跑在 Laya / 小游戏容器里的
 * 游戏都能用，核心是**基础去广告**：
 *
 *   1. 接管平台对象上的 playVideo / playVideo_pre
 *      —— 通过 native 层在模块作用域里定义的 __hmBridge() 桥接函数拿到，
 *         即使平台对象是模块私有变量也能接管
 *   2. 递归扫描 globalThis，接管 wx / tt / 容器 SDK 上的
 *      createRewardedVideoAd / showInterstitialAd 等标准广告 API
 *
 * 它既可以单独作为注入脚本使用（一个完整可 eval 的文件），
 * 也可以被构建脚本内联进完整版 inj.js —— 两种形态共用同一份源码。
 *
 * 模式判定：
 *   通用模式   —— 没拿到 __hmg（数据单例），面板只显示通用功能
 *   适配模式   —— 拿到 __hmg，面板显示完整数值修改
 * 判定是延迟做的：注入发生在 bundle 被编译之后、游戏执行之前，
 * 那一刻 __hmg 还不存在，所以由探针的定时器持续检测。
 * ========================================================================== */

(function (G) {
  'use strict';
  if (!G) return;
  if (G.__hmCommon) return;      // 已加载
  G.__hmCommon = 1;
  // native 层加载磁盘脚本时会校验内容里含 "__hmw"，作为「这确实是我们的
  // 脚本」的标记，避免把写坏的文件喂给 V8。
  G.__hmw = G.__hmw || 'common';

  /* ------------------------------------------------------------------ 工具 */
  function isObj(v) {
    return v !== null && typeof v === 'object';
  }

  /** 延迟到下一帧执行，避免在模块初始化期间改动宿主对象 */
  function later(fn, ms) {
    try {
      if (typeof setTimeout === 'function') setTimeout(fn, ms || 0);
    } catch (e) {}
  }

  /* ------------------------------------------------------------ 免广告接管 */

  /** 被接管的广告方法名 */
  var AD_KEYS = {
    playVideo: 1, playVideoAd: 1, playVideo_pre: 1, playVideoPre: 1,
    showVideo: 1, showRewardVideo: 1, showRewardedVideo: 1,
    showVideoAd: 1, showAd: 1,
    createRewardedVideoAd: 1, createInterstitialAd: 1, createBannerAd: 1,
    showInterstitialAd: 1, showBannerAd: 1
  };

  /**
   * 把一个广告方法替换成「直接成功」版本。
   * 不同 API 的返回形态不同，必须分别处理，否则会把调用方的
   * `ad.show().then(...)` 链弄断：
   *   - playVideo / showVideo 一类   → 返回 Promise，resolve(1)
   *   - playVideo_pre 一类（布尔判断）→ 直接 return true
   *   - createRewardedVideoAd 一类   → 返回「广告对象」，show/load 直接成功
   */
  function patchAd(obj, key) {
    try {
      if (!obj || typeof obj[key] !== 'function') return 0;
      if (obj[key].__hm) return 1;
      var orig = obj[key];
      var fake;
      if (key === 'createRewardedVideoAd' || key === 'createInterstitialAd' ||
          key === 'createBannerAd') {
        fake = function () {
          var ad = {
            show: function () { return Promise.resolve(1); },
            load: function () { return Promise.resolve(1); },
            destroy: function () {},
            onClose: function () {}, offClose: function () {},
            onError: function () {}, offError: function () {},
            onLoad: function () {}, offLoad: function () {}
          };
          ad.__hm = 1;
          return ad;
        };
      } else if (/_pre$|^pre$/.test(key)) {
        fake = function () { return true; };
      } else {
        fake = function () {
          return new Promise(function (resolve) {
            setTimeout(function () { try { resolve(1); } catch (e) {} }, 30);
          });
        };
      }
      fake.__hm = 1;
      fake.__hmOrig = orig;
      obj[key] = fake;
      return 1;
    } catch (e) { return 0; }
  }

  /**
   * 递归扫描对象树，把识别到的广告方法接管掉。
   * 深度 2~3 层足够覆盖 globalThis → gg → platform / wx → API 的结构。
   */
  function scanAds(root, depth, seen) {
    var n = 0;
    if (!isObj(root) || depth < 0) return 0;
    try {
      var keys = Object.keys(root);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v;
        try { v = root[k]; } catch (e) { continue; }
        if (!v) continue;
        if (typeof v === 'function') {
          if (AD_KEYS[k]) n += patchAd(root, k);
        } else if (isObj(v) && k !== 'window' && k !== 'document' &&
                   k !== 'self' && k !== 'globalThis' && k !== 'Laya' &&
                   k !== 'laya' && k !== 'console') {
          if (seen.indexOf(v) >= 0) continue;
          seen.push(v);
          n += scanAds(v, depth - 1, seen);
        }
      }
    } catch (e) {}
    return n;
  }

  /**
   * 找到平台对象。优先用直接暴露的，其次用模块作用域桥接，
   * 最后扫描 globalThis 找带 platform 字段的对象。
   */
  function findPlatform() {
    var gg = G.__hmgg || G.gg || (G.GameGlobal && G.GameGlobal.gg) || null;
    if (!gg) {
      try {
        if (typeof G.__hmBridge === 'function') {
          var b = G.__hmBridge();
          if (b && b.gg) gg = b.gg;
        }
      } catch (e) {}
    }
    if (gg && gg.platform) return gg.platform;
    // 兜底：globalThis 里扫一个带 platform 子对象的
    try {
      var keys = Object.keys(G);
      for (var i = 0; i < keys.length; i++) {
        var v;
        try { v = G[keys[i]]; } catch (e) { continue; }
        if (isObj(v) && v.platform && typeof v.platform === 'object') return v.platform;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Unity 小游戏（别碰我的菜）走的是另一套广告机制：
   *   广告对象由 unity-sdk/ad.js 创建，游戏的 C# 通过 onClose 回调
   *   得知「广告看完了」。通用层的简易替换把 onClose 做成空函数，
   *   会让游戏永远等不到回调 —— 所以 Unity 模式下必须让位给
   *   harvest.js 的专用实现（它会真的触发 onClose）。
   */
  function isUnityGame() {
    try { if (G.__hmUnity) return 1; } catch (e) {}
    try {
      if (G.GameGlobal && G.GameGlobal.__cmgeSubpackages &&
          G.GameGlobal.__cmgeSubpackages.length) return 1;
    } catch (e) {}
    return 0;
  }

  /** 执行一次接管，返回接管到的入口数量 */
  function hookAds() {
    var n = 0;
    var p = findPlatform();
    if (p) {
      n += patchAd(p, 'playVideo');
      n += patchAd(p, 'playVideo_pre');
      n += patchAd(p, 'playVideoAd');
    }
    if (isUnityGame()) {
      // Unity：交给 harvest.js 的专用实现（会真的触发 onClose）
      try {
        if (typeof G.__hmHarvestHookAds === 'function') n += G.__hmHarvestHookAds();
      } catch (e) {}
      G.__hmAdOn = n > 0 ? 1 : 0;
      G.__hmAdN = n;
      return n;
    }
    n += scanAds(G, 2, []);
    G.__hmAdOn = n > 0 ? 1 : 0;
    G.__hmAdN = n;
    return n;
  }

  G.__hmHookAds = hookAds;
  G.__hmPatchAd = patchAd;
  G.__hmFindPlatform = findPlatform;

  /* -------------------------------------------------------- 通用模式的界面 */
  /*
   * 通用面板只放通用能力：
   *   - 免广告开关
   *   - 重新接管按钮（游戏可能自己重设方法）
   *   - 状态行（显示接管了几个广告入口、当前是通用还是适配模式）
   */
  G.__hmCommonLayout = {
    sections: [
      {
        title: '通用功能',
        rows: [
          { t: 'sw', label: '免广告', key: 'adFree', onChange: function (on) {
            if (!on) { G.__hmAdOff = 1; } else { G.__hmAdOff = 0; hookAds(); }
          }},
          { t: 'gear', label: '接管强度', key: 'scanDepth',
            opts: [
              { label: '浅', value: 1 },
              { label: '中', value: 2 },
              { label: '深', value: 3 }
            ],
            apply: function (v) { G.__hmScanDepth = v; hookAds(); }
          }
        ]
      }
    ],
    actions: [
      { label: '重新接管广告', color: '#2456B8', fn: function () {
        var n = hookAds();
        try { G.__hmTitle.text = 'HM 已接管 ' + n + ' 个广告入口'; } catch (e) {}
      }}
    ]
  };

  /* 默认配置：通用模式只需要这几项 */
  G.__hmCommonSet = {
    adFree: true,
    scanDepth: 2
  };

  /** 当前是否已经适配到具体游戏（拿到了数据单例） */
  G.__hmIsAdapted = function () {
    try { return !!(G.__hmg && G.__hmg.playerInfo); } catch (e) { return false; }
  };

  /** 模式：common / adapted */
  G.__hmMode = G.__hmIsAdapted() ? 'adapted' : 'common';

  /* 首次接管。延后一点，等游戏把 SDK 初始化完再扫，命中率更高。 */
  later(function () { hookAds(); }, 600);
  later(function () { hookAds(); }, 2500);
  later(function () { hookAds(); }, 6000);

})(typeof globalThis !== 'undefined' ? globalThis : this);
    // ===== /HM COMMON INLINE =====

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

    // 实际接管逻辑在通用层（common.js）里：
    //   - 平台对象上的 playVideo / playVideo_pre
    //   - globalThis 树里其它标准广告 API
    // 这里只做转发，顺带兼容旧的调用点。
    G.__hmAdHook = function () {
      try {
        if (typeof G.__hmHookAds === 'function') return G.__hmHookAds();
      } catch (e) {}
      return G.__hmAdOn || 0;
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

      // ---------------------------------------------------- 三选一场景次数
      // 游戏原生：战斗初始化时 s.getallCount = 1，所以「全都要」每场战斗
      // 只能点一次（按钮显示条件 getallCount > 0，点击时 getallCount--）。
      // 这里维持一个正值，按钮就常显、次数用不完；下一个战斗场景重建
      // battleSave 后会被重新赋回 1，500ms 循环再拉起来。
      if (SET.getAllNum > 0) {
        try { b.getallCount = SET.getAllNum; } catch (e) {}
      }
      // 「换一批」免费次数，同一套机制
      if (SET.refreshNum > 0) {
        try { b.freeRefCount = SET.refreshNum; } catch (e) {}
      }
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

    // ------------------------------------------------------------ 复活
    // 复活次数的来源链：
    //   getVipPrivilege(3) 读的是 a.vipCfg.find(e => e.vipLv == vipLv).privilege_3
    //   战斗初始化：s.reliveTime = g.getVipPrivilege(3)
    //   阵亡判定：reliveTime > 0 ? (reliveTime--, 开 Game_Relive) : 开 Game_Over
    // 所以改 vipCfg 的 privilege_3 能同时改到「初始值」和「每次消耗后的上限」。
    //
    // 注意：vipCfg 是远程配置（InitGameTable 里 JSON.parse 后整体覆盖），
    // 游戏重载配置就会打回原值，因此必须周期性重打，不能只打一次。
    G.__hmApplyRelive = function () {
      var n = SET.reliveNum || 0;
      if (n <= 0) return 0;
      var c = 0;
      try {
        var cfg = G.__hma && G.__hma.vipCfg;
        if (cfg && cfg.length) {
          for (var i = 0; i < cfg.length; i++) {
            try {
              if (cfg[i].privilege_3 !== n) { cfg[i].privilege_3 = n; c++; }
            } catch (e) {}
          }
        }
      } catch (e) {}
      // 已经开打的话，battleSave 里那份也保住
      try {
        var g = G.__hmg;
        if (g && g.playerInfo && g.playerInfo.battleSave) {
          var b = g.playerInfo.battleSave;
          if (b.reliveTime < n) { b.reliveTime = n; c++; }
        }
      } catch (e) {}
      G.__hmReliveMax = n;
      return c;
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
      n += G.__hmApplyRelive();
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
    /*
     * 模式自适应
     * ---------------------------------------------------------------
     * 注入发生在 bundle 编译之后、游戏执行之前，那时 __hmg 还不存在，
     * 所以不能在这里一次性判断。改成：
     *   - 布局配置做成函数，缺省时按当前模式构建
     *   - 探针的定时器持续检测 __hmg，一旦出现就切到适配模式并重建面板
     */
    G.__hmApplyMode = function () {
      var adapted = 0;
      try { adapted = (G.__hmg && G.__hmg.playerInfo) ? 1 : 0; } catch (e) {}
      var mode = adapted ? 'adapted' : 'common';
      if (mode === G.__hmMode) return 0;
      G.__hmMode = mode;
      G.__hmLayout = null;      // 强制按新模式重建布局
      // 注意：不能把 G.__hmSet 置 null ——
      // buildPanel 里要读 G.__hmSet[row.key] 取初始值，
      // 置空会让整个面板构建抛异常。
      // SET 本来就是完整版默认值，通用/适配两种模式共用即可。
      return 1;
    };

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
        getAllNum: 999,     // 三选一场景「全都要」可用次数（0 = 走原逻辑，每战 1 次）
        refreshNum: 99,     // 三选一场景「换一批」免费次数（0 = 走原逻辑）
        reliveNum: 999,     // 复活次数（0 = 走原逻辑，由 VIP privilege_3 决定）
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
    G.__hmBuildLayout = function () {
      if (G.__hmMode !== 'adapted') {
        // 通用模式：只有通用能力
        return G.__hmCommonLayout;
      }
      return {
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
              { t: 'num', label: '全都要次数', key: 'getAllNum', apply: function (v) {
                setPlayer(function (P) {
                  if (P.battleSave && v > 0) P.battleSave.getallCount = v;
                });
              }},
              { t: 'num', label: '复活次数', key: 'reliveNum', apply: function (v) {
                G.__hmApplyRelive();
              }},
              { t: 'num', label: '换一批次数', key: 'refreshNum', apply: function (v) {
                setPlayer(function (P) {
                  if (P.battleSave && v > 0) P.battleSave.freeRefCount = v;
                });
              }},
              { t: 'sw', half: true, label: '无限金币', key: 'btGold' },
              { t: 'sw', half: true, label: '无限血量', key: 'btHp' },
              { t: 'sw', half: true, label: '英雄强化', key: 'btHero' },
              { t: 'sw', half: true, label: '免广告', key: 'adFree', onChange: function (on) {
                G.__hmAdOn = on ? G.__hmAdOn : 0;
              }},
              { t: 'sw', half: true, label: '自动应用', key: 'autoApply' }
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
    };


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

      // 模式变了（通用 <-> 已适配）就丢掉旧面板，下一轮按新布局重建。
      // 注意：注入发生时 bundle 还没执行，__hmg 尚不存在，那时只能建通用面板；
      // 等 bundle 执行完拿到 __hmg，这里要按新模式重新生成布局。
      try {
        if (G.__hmApplyMode && G.__hmApplyMode()) {
          try { G.__hmDropUI(); } catch (e) {}
        }
      } catch (e) {}
      try {
        if (!G.__hmLayout && G.__hmBuildLayout) G.__hmLayout = G.__hmBuildLayout();
      } catch (e) {}

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
              R.relive = bb.reliveTime;
              R.reliveMax = G.__hmReliveMax || 0;
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
    // 模式检测：注入时 __hmg 还没设置（bundle 尚未执行），
    // 持续检测它是否出现，一旦出现就切到适配模式并重建面板。
    setInterval(function () {
      try {
        if (G.__hmApplyMode && G.__hmApplyMode()) {
          G.__hmDropUI();
          G.__hmUI();
        }
      } catch (e) {}
    }, 1200);
    setInterval(function () { try { G.__hmRefreshUI(); } catch (e) {} }, 600);
    // 战斗内单独跑快循环：2.5s 太慢，血量可能已经被打空
    if (G.__hmBattleAuto === undefined) G.__hmBattleAuto = true;
    setInterval(function () {
      try {
        // 复活次数：vipCfg 是远程配置会被覆盖，必须持续重打
        G.__hmApplyRelive();
        if (!G.__hmBattleAuto) return;
        var g = G.__hmg;
        if (g && g.playerInfo && g.playerInfo.battleSave) G.__hmBattle();
      } catch (e) {}
    }, 500);
  }
} catch (e) {}
