/* =============================================================================
 * HM 存档改写 —— 「别碰我的菜」(HarvestKing, Unity WebGL)
 * -----------------------------------------------------------------------------
 * 这款游戏是 Unity 2022.3 编译的 WebGL WASM，游戏逻辑在 wasm 里，
 * JS 层看不到任何数值单例（没有 playerInfo、没有 a 配置表）。
 *
 * 但它的存档走的是**明文 JSON**：
 *   wx.setStorage({key: "<md5>", data: "<JSON 字符串>"})
 *
 * 存档值本身是「JSON 字符串套 JSON」：
 *   外层 = { Version, IntStorage, FloatStorage, StringStorage, UserPropsData }
 *   StringStorage.Save_Data = 又一层 JSON 字符串
 *   最内层 = { accountLevel, currency, chapters, soldier, ... }（.NET Json.NET 格式）
 *
 * 所以改数值的唯一可靠入口就是**拦截 wx.setStorage / wx.getStorageSync**，
 * 在读写瞬间把 JSON 里的字段改掉。
 * ========================================================================== */

(function (G) {
  'use strict';
  if (!G) return;
  if (G.__hmHarvest) return;      // 已加载
  G.__hmHarvest = 1;
  G.__hmw = G.__hmw || 'harvest';

  /*
   * wx 不能在模块加载时就捕获 —— 注入发生在 bundle 编译之后、
   * 游戏执行之前，那时宿主 API 可能还没挂上。
   * 改成每次调用时动态取，兼容性最好。
   */
  function getWx() {
    try { if (G.wx) return G.wx; } catch (e) {}
    try { if (G.GameGlobal && G.GameGlobal.wx) return G.GameGlobal.wx; } catch (e) {}
    try {
      if (G.GameGlobal && G.GameGlobal.__SmallApp && G.GameGlobal.__SmallApp.wx) {
        return G.GameGlobal.__SmallApp.wx;
      }
    } catch (e) {}
    return null;
  }

  /* ------------------------------------------------------------------ 工具 */

  /**
   * 存档值是「JSON 字符串套 JSON」，最外层还可能被再包一层引号。
   * 这个函数把层级找出来，吐出 { outer, data }，失败返回 null。
   */
  function unpack(value) {
    if (typeof value !== 'string') return null;
    var levels = [value];
    var cur = value;
    for (var i = 0; i < 4; i++) {
      var next;
      try { next = JSON.parse(cur); } catch (e) { break; }
      if (typeof next !== 'string') { levels.push(next); break; }
      levels.push(next);
      cur = next;
    }
    // 找最内层的对象
    for (var j = levels.length - 1; j >= 0; j--) {
      if (levels[j] && typeof levels[j] === 'object' &&
          levels[j].StringStorage && levels[j].StringStorage.Save_Data) {
        var inner;
        try { inner = JSON.parse(levels[j].StringStorage.Save_Data); } catch (e) { continue; }
        if (inner && typeof inner === 'object') {
          return { outer: levels[j], data: inner, depth: j };
        }
      }
    }
    return null;
  }

  /** 把改好的存档重新序列化回原始层级结构 */
  function repack(value, outer, data, depth) {
    var s = JSON.stringify(data);
    outer.StringStorage.Save_Data = s;
    // depth 0 表示原始字符串里嵌的就是 outer；depth>0 说明外面还套了几层字符串
    var out = JSON.stringify(outer);
    for (var i = 1; i < depth; i++) out = JSON.stringify(out);
    return out;
  }

  /** 取存档里的数值字段（可能不存在） */
  function num(obj, key, dflt) {
    try {
      if (obj && typeof obj[key] === 'number') return obj[key];
      return dflt;
    } catch (e) { return dflt; }
  }

  /* --------------------------------------------------------- 数值改写规则 */

  /**
   * 各字段的放大规则。
   * scale 为 null 表示不改成固定值，而是乘以倍率。
   */
  function applyRules(data, cfg) {
    if (!data || typeof data !== 'object') return;

    var money = cfg.money;          // 货币目标值
    var lv = cfg.soldierLevel;      // 士兵等级上限
    var energy = cfg.energy;        // 体力值
    var accLv = cfg.accountLevel;   // 账号等级
    var chapter = cfg.chapter;      // 章节解锁
    var income = cfg.income;        // 收益倍率

    // ---- 货币 ----
    try {
      var cur = data.currency;
      if (cur && cur.currencies && cur.currencies.$values) {
        for (var i = 0; i < cur.currencies.$values.length; i++) {
          cur.currencies.$values[i].amount = money;
        }
      }
      if (cur && typeof cur.incomeMultiplier === 'number') {
        cur.incomeMultiplier = income;
      }
    } catch (e) {}

    // ---- 体力 ----
    try {
      var es = data.energyStorage;
      if (es) {
        if (es.mainEnergy) es.mainEnergy.currentEnergy = energy;
        if (es.modesEnergy) es.modesEnergy.currentEnergy = energy;
      }
    } catch (e) {}

    // ---- 账号等级 ----
    try {
      if (data.accountLevel) {
        data.accountLevel.currentLevel = accLv;
        data.accountLevel.currentExperience = accLv * 100;
      }
    } catch (e) {}

    // ---- 章节 / 关卡解锁 ----
    try {
      if (data.chapters) {
        data.chapters.currentChapterIndex = chapter;
        data.chapters.endlessChapterIndex = chapter;
        data.chapters.currentLevelIndex = chapter;
        data.chapters.endlessLevelIndex = chapter;
      }
    } catch (e) {}

    // ---- 士兵等级 ----
    try {
      var sv = data.soldier && data.soldier._saves && data.soldier._saves.$values;
      if (sv) {
        for (var j = 0; j < sv.length; j++) {
          if (typeof sv[j].level === 'number') sv[j].level = lv;
        }
      }
    } catch (e) {}

    // ---- 局内进度（血量 / 金币 / 复活次数）----
    try {
      var lp = data.levelProgress;
      if (lp) {
        if (typeof lp.PlayerMoney === 'number') lp.PlayerMoney = money;
        if (typeof lp.ReviveCount === 'number') lp.ReviveCount = 999;
        if (typeof lp.CurrentExpLevel === 'number') lp.CurrentExpLevel = 99;
        if (typeof lp.CurrentExp === 'number') lp.CurrentExp = 999999;
        if (typeof lp.PersonalBestWave === 'number') lp.PersonalBestWave = 9999;
        if (typeof lp.HasActiveGame === 'boolean') lp.HasActiveGame = false;
      }
    } catch (e) {}

    // ---- 动态难度（失败次数归零 → 敌人不加速）----
    try {
      if (data.dynamicDifficulty && typeof data.dynamicDifficulty.failCount === 'number') {
        data.dynamicDifficulty.failCount = 0;
      }
    } catch (e) {}

    // ---- 每日宝箱次数重置 ----
    try {
      if (data.chestBonus) {
        data.chestBonus.usedToday = 0;
        data.chestBonus.impressionsWithoutClaim = 0;
      }
    } catch (e) {}

    // ---- 战斗通行证 ----
    try {
      if (data.battlePass) {
        data.battlePass.currentXp = 999999;
        data.battlePass.currentLevel = 99;
        data.battlePass.isPremiumPurchased = true;
      }
    } catch (e) {}

    // ---- 士兵/洒水器全部解锁 ----
    try {
      if (data.soldier && data.soldier._unlockeds) {
        var maxSoldier = 40;
        var un = [];
        for (var u = 1; u <= maxSoldier; u++) un.push(u);
        data.soldier._unlockeds.$values = un;
      }
    } catch (e) {}

    // ---- 花园功能解锁 ----
    try {
      if (data.garden) {
        data.garden.isFeatureUnlocked = true;
        data.garden.isFeatureRecentlyActivated = true;
      }
    } catch (e) {}

    // ---- 遗物系统解锁 ----
    try {
      if (data.artifacts) {
        data.artifacts.isActive = true;
        data.artifacts.isRecentlyActivated = true;
        data.artifacts.totalPullCount = 999;
      }
    } catch (e) {}
  }

  /* --------------------------------------------------------- 拦截读写 */

  var CFG = {
    money: 999999,
    income: 99,
    energy: 9999,
    accountLevel: 999,
    chapter: 99,
    soldierLevel: 99,
    noAds: true,
    on: true
  };

  /** 改写一个存档值；不是存档就原样返回 */
  function patchValue(value) {
    if (!CFG.on) return value;
    var u = unpack(value);
    if (!u) return value;
    try {
      applyRules(u.data, CFG);
      // 免广告标记：这是存档里的字段，改了就永久无广告
      if (CFG.noAds && u.data.advertisement) {
        u.data.advertisement.isNoAdsPurchased = true;
      }
      return repack(value, u.outer, u.data, u.depth);
    } catch (e) {
      return value;
    }
  }

  /** 当前是否已适配（游戏存档结构被识别到了） */
  var detected = 0;
  function probe(value) {
    var u = unpack(value);
    if (!u) return 0;
    detected = 1;
    G.__hmHarvestOk = 1;
    G.__hmHarvestData = u.data;
    return 1;
  }

  /* --------------------------------------------------------- 接管 wx 存储 */

  function hookStorage() {
    var wx = getWx();
    if (!wx) return 0;
    var n = 0;

    // ---- setStorage：写盘前改写 ----
    try {
      if (typeof wx.setStorage === 'function' && !wx.setStorage.__hm) {
        var origSet = wx.setStorage;
        var fSet = function (opts) {
          try {
            if (opts && typeof opts.data === 'string') {
              opts.data = patchValue(opts.data);
            }
          } catch (e) {}
          return origSet.call(wx, opts);
        };
        fSet.__hm = 1;
        wx.setStorage = fSet;
        n++;
      }
    } catch (e) {}

    // ---- setStorageSync：同步写盘 ----
    try {
      if (typeof wx.setStorageSync === 'function' && !wx.setStorageSync.__hm) {
        var origSetS = wx.setStorageSync;
        var fSetS = function (key, data) {
          try {
            if (typeof data === 'string') data = patchValue(data);
          } catch (e) {}
          return origSetS.call(wx, key, data);
        };
        fSetS.__hm = 1;
        wx.setStorageSync = fSetS;
        n++;
      }
    } catch (e) {}

    // ---- getStorageSync：读盘时改写（游戏启动读存档也走这里）----
    try {
      if (typeof wx.getStorageSync === 'function' && !wx.getStorageSync.__hm) {
        var origGetS = wx.getStorageSync;
        /*
         * 记住原始实现。sweep 扫盘时必须用**原始**版本读：
         * 被 hook 过的版本读出来已经是改写过的值，
         * 再改写一次结果相同 → 会误判成「无需写入」而跳过，
         * 磁盘上就留着旧值了。
         */
        G.__hmRawGetSync = origGetS;
        var fGetS = function (key) {
          var v = origGetS.call(wx, key);
          try {
            if (typeof v === 'string') {
              probe(v);
              v = patchValue(v);
            }
          } catch (e) {}
          return v;
        };
        fGetS.__hm = 1;
        wx.getStorageSync = fGetS;
        n++;
      }
    } catch (e) {}

    // ---- getStorage：异步读盘 ----
    try {
      if (typeof wx.getStorage === 'function' && !wx.getStorage.__hm) {
        var origGet = wx.getStorage;
        var fGet = function (opts) {
          try {
            if (opts && typeof opts.success === 'function') {
              var succ = opts.success;
              opts.success = function (res) {
                try {
                  if (res && typeof res.data === 'string') {
                    probe(res.data);
                    res.data = patchValue(res.data);
                  }
                } catch (e) {}
                return succ.call(this, res);
              };
            }
          } catch (e) {}
          return origGet.call(wx, opts);
        };
        fGet.__hm = 1;
        wx.getStorage = fGet;
        n++;
      }
    } catch (e) {}

    G.__hmHarvestHooks = n;
    return n;
  }

  /* ------------------------------------------------- Unity 专用去广告接管 */

  /**
   * Unity 的广告走 unity-sdk/ad.js → wx.createRewardedVideoAd 等。
   * 广告对象的 onClose 回调是 C# 通过 SendMessage 传进来的，
   * 所以伪广告对象必须**真的触发 onClose**，
   * 否则游戏永远等不到「广告看完了」的回调。
   */
  function hookUnityAds() {
    var wx = getWx();
    if (!wx) return 0;
    var n = 0;
    var keys = ['createRewardedVideoAd', 'createInterstitialAd', 'createBannerAd', 'createCustomAd'];
    for (var i = 0; i < keys.length; i++) {
      (function (key) {
        try {
          if (typeof wx[key] !== 'function') return;
          /*
           * 通用层（common.js）也会接管这些 API，而且**先跑**。
           * 但通用层的伪广告 onClose 是空函数 —— 游戏的 C# 永远等不到
           * 「广告看完」的回调，奖励发不出去。
           * 所以这里必须覆盖通用层的版本：认得出 __hmUnity 标记就替换，
           * 不能因为已经打过标记就跳过。
           */
          var prev = wx[key];
          if (prev && prev.__hm && !prev.__hmUnityAd) {
            // 通用层的版本没有真实 onClose，必须换掉
          } else if (prev && prev.__hm) {
            n++;      // 已经是本模块接管的，幂等跳过但要计数
            return;
          }
          var orig = prev;
          var fake = function () {
            var closeCb = null, loadCb = null, errCb = null;
            var ad = {
              show: function () {
                // 广告「看完了」→ 触发 onClose，带 isEnded=1 表示完整观看
                setTimeout(function () {
                  if (closeCb) { try { closeCb({ isEnded: true }); } catch (e) {} }
                }, 30);
                return Promise.resolve(1);
              },
              load: function () {
                setTimeout(function () {
                  if (loadCb) { try { loadCb({}); } catch (e) {} }
                }, 10);
                return Promise.resolve(1);
              },
              destroy: function () {},
              setStyle: function () {},
              onClose: function (cb) { closeCb = cb; },
              offClose: function () { closeCb = null; },
              onLoad: function (cb) { loadCb = cb; },
              offLoad: function () { loadCb = null; },
              onError: function (cb) { errCb = cb; },
              offError: function () { errCb = null; },
              onResize: function () {}, offResize: function () {}
            };
            ad.__hm = 1;
            return ad;
          };
          fake.__hm = 1;
          fake.__hmUnityAd = 1;     // 标记这是会真正触发 onClose 的版本
          fake.__hmOrig = orig;
          wx[key] = fake;
          n++;
        } catch (e) {}
      })(keys[i]);
    }
    G.__hmHarvestAdN = n;
    return n;
  }

  /* ------------------------------------------------------------- 对外接口 */

  G.__hmHarvestCfg = CFG;
  G.__hmHarvestPatch = patchValue;
  G.__hmHarvestHookStorage = hookStorage;
  G.__hmHarvestHookAds = hookUnityAds;
  G.__hmHarvestDetected = function () { return detected; };

  /**
   * 主动扫描全部本地存档并改写（游戏已加载完时用）。
   * 走 wx.getStorageInfoSync 拿到 key 列表，逐个读出来改。
   */
  G.__hmHarvestSweep = function () {
    var changed = 0, seen = 0;
    var wx = getWx();
    if (!wx) return 0;
    try {
      var info = wx.getStorageInfoSync();
      var keys = (info && info.keys) || [];
      /*
       * 必须用原始 getStorageSync 读 —— 被 hook 的版本返回的已经是
       * 改写过的值，再改写结果相同就会被误判为「无需写入」，
       * 结果磁盘上留的还是旧值。
       */
      var rawGet = G.__hmRawGetSync || wx.getStorageSync;
      for (var i = 0; i < keys.length; i++) {
        var v = null;
        try { v = rawGet.call(wx, keys[i]); } catch (e) { continue; }
        if (typeof v !== 'string') continue;
        var u = unpack(v);
        if (!u) continue;
        seen++;
        var nv = patchValue(v);
        if (nv !== v) {
          try { wx.setStorageSync(keys[i], nv); changed++; } catch (e) {}
        }
      }
    } catch (e) {}
    G.__hmHarvestSwept = seen;
    return changed;
  };

  /* 首次接管。等游戏把 SDK 初始化完再扫，命中率更高。 */
  function boot() {
    hookStorage();
    hookUnityAds();
  }
  G.__hmHarvestBoot = boot;

  [300, 1200, 3000, 6000].forEach(function (ms) {
    setTimeout(function () { try { boot(); } catch (e) {} }, ms);
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
