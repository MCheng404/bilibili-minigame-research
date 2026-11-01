;(function(G){
  if (typeof G.__hmModuleSrc === "undefined") G.__hmModuleSrc = {};
  G.__hmModuleSrc["harvest.js"] = "/* =============================================================================\n * HM 存档改写 —— 「别碰我的菜」(HarvestKing, Unity WebGL)\n * -----------------------------------------------------------------------------\n * 这款游戏是 Unity 2022.3 编译的 WebGL WASM，游戏逻辑在 wasm 里，\n * JS 层看不到任何数值单例（没有 playerInfo、没有 a 配置表）。\n *\n * 但它的存档走的是**明文 JSON**：\n *   wx.setStorage({key: \"<md5>\", data: \"<JSON 字符串>\"})\n *\n * 存档值本身是「JSON 字符串套 JSON」：\n *   外层 = { Version, IntStorage, FloatStorage, StringStorage, UserPropsData }\n *   StringStorage.Save_Data = 又一层 JSON 字符串\n *   最内层 = { accountLevel, currency, chapters, soldier, ... }（.NET Json.NET 格式）\n *\n * 所以改数值的唯一可靠入口就是**拦截 wx.setStorage / wx.getStorageSync**，\n * 在读写瞬间把 JSON 里的字段改掉。\n * ========================================================================== */\n\n(function (G) {\n  'use strict';\n  if (!G) return;\n  if (G.__hmHarvest) return;      // 已加载\n  G.__hmHarvest = 1;\n  G.__hmw = G.__hmw || 'harvest';\n\n  /*\n   * wx 不能在模块加载时就捕获 —— 注入发生在 bundle 编译之后、\n   * 游戏执行之前，那时宿主 API 可能还没挂上。\n   * 改成每次调用时动态取，兼容性最好。\n   */\n  function getWx() {\n    try { if (G.wx) return G.wx; } catch (e) {}\n    try { if (G.GameGlobal && G.GameGlobal.wx) return G.GameGlobal.wx; } catch (e) {}\n    try {\n      if (G.GameGlobal && G.GameGlobal.__SmallApp && G.GameGlobal.__SmallApp.wx) {\n        return G.GameGlobal.__SmallApp.wx;\n      }\n    } catch (e) {}\n    return null;\n  }\n\n  /* ------------------------------------------------------------------ 工具 */\n\n  /**\n   * 存档值是「JSON 字符串套 JSON」，最外层还可能被再包一层引号。\n   * 这个函数把层级找出来，吐出 { outer, data }，失败返回 null。\n   */\n  function unpack(value) {\n    if (typeof value !== 'string') return null;\n    var levels = [value];\n    var cur = value;\n    for (var i = 0; i < 4; i++) {\n      var next;\n      try { next = JSON.parse(cur); } catch (e) { break; }\n      if (typeof next !== 'string') { levels.push(next); break; }\n      levels.push(next);\n      cur = next;\n    }\n    // 找最内层的对象\n    for (var j = levels.length - 1; j >= 0; j--) {\n      if (levels[j] && typeof levels[j] === 'object' &&\n          levels[j].StringStorage && levels[j].StringStorage.Save_Data) {\n        var inner;\n        try { inner = JSON.parse(levels[j].StringStorage.Save_Data); } catch (e) { continue; }\n        if (inner && typeof inner === 'object') {\n          return { outer: levels[j], data: inner, depth: j };\n        }\n      }\n    }\n    return null;\n  }\n\n  /** 把改好的存档重新序列化回原始层级结构 */\n  function repack(value, outer, data, depth) {\n    var s = JSON.stringify(data);\n    outer.StringStorage.Save_Data = s;\n    // depth 0 表示原始字符串里嵌的就是 outer；depth>0 说明外面还套了几层字符串\n    var out = JSON.stringify(outer);\n    for (var i = 1; i < depth; i++) out = JSON.stringify(out);\n    return out;\n  }\n\n  /** 取存档里的数值字段（可能不存在） */\n  function num(obj, key, dflt) {\n    try {\n      if (obj && typeof obj[key] === 'number') return obj[key];\n      return dflt;\n    } catch (e) { return dflt; }\n  }\n\n  /* --------------------------------------------------------- 数值改写规则 */\n\n  /**\n   * 各字段的放大规则。\n   * scale 为 null 表示不改成固定值，而是乘以倍率。\n   */\n  function applyRules(data, cfg) {\n    if (!data || typeof data !== 'object') return;\n\n    var money = cfg.money;          // 货币目标值\n    var lv = cfg.soldierLevel;      // 士兵等级上限\n    var energy = cfg.energy;        // 体力值\n    var accLv = cfg.accountLevel;   // 账号等级\n    var chapter = cfg.chapter;      // 章节解锁\n    var income = cfg.income;        // 收益倍率\n\n    // ---- 货币 ----\n    try {\n      var cur = data.currency;\n      if (cur && cur.currencies && cur.currencies.$values) {\n        for (var i = 0; i < cur.currencies.$values.length; i++) {\n          cur.currencies.$values[i].amount = money;\n        }\n      }\n      if (cur && typeof cur.incomeMultiplier === 'number') {\n        cur.incomeMultiplier = income;\n      }\n    } catch (e) {}\n\n    // ---- 体力 ----\n    try {\n      var es = data.energyStorage;\n      if (es) {\n        if (es.mainEnergy) es.mainEnergy.currentEnergy = energy;\n        if (es.modesEnergy) es.modesEnergy.currentEnergy = energy;\n      }\n    } catch (e) {}\n\n    // ---- 账号等级 ----\n    try {\n      if (data.accountLevel) {\n        data.accountLevel.currentLevel = accLv;\n        data.accountLevel.currentExperience = accLv * 100;\n      }\n    } catch (e) {}\n\n    // ---- 章节 / 关卡解锁 ----\n    try {\n      if (data.chapters) {\n        data.chapters.currentChapterIndex = chapter;\n        data.chapters.endlessChapterIndex = chapter;\n        data.chapters.currentLevelIndex = chapter;\n        data.chapters.endlessLevelIndex = chapter;\n      }\n    } catch (e) {}\n\n    // ---- 士兵等级 ----\n    try {\n      var sv = data.soldier && data.soldier._saves && data.soldier._saves.$values;\n      if (sv) {\n        for (var j = 0; j < sv.length; j++) {\n          if (typeof sv[j].level === 'number') sv[j].level = lv;\n        }\n      }\n    } catch (e) {}\n\n    // ---- 局内进度（血量 / 金币 / 复活次数）----\n    try {\n      var lp = data.levelProgress;\n      if (lp) {\n        if (typeof lp.PlayerMoney === 'number') lp.PlayerMoney = money;\n        if (typeof lp.ReviveCount === 'number') lp.ReviveCount = 999;\n        if (typeof lp.CurrentExpLevel === 'number') lp.CurrentExpLevel = 99;\n        if (typeof lp.CurrentExp === 'number') lp.CurrentExp = 999999;\n        if (typeof lp.PersonalBestWave === 'number') lp.PersonalBestWave = 9999;\n        if (typeof lp.HasActiveGame === 'boolean') lp.HasActiveGame = false;\n      }\n    } catch (e) {}\n\n    // ---- 动态难度（失败次数归零 → 敌人不加速）----\n    try {\n      if (data.dynamicDifficulty && typeof data.dynamicDifficulty.failCount === 'number') {\n        data.dynamicDifficulty.failCount = 0;\n      }\n    } catch (e) {}\n\n    // ---- 每日宝箱次数重置 ----\n    try {\n      if (data.chestBonus) {\n        data.chestBonus.usedToday = 0;\n        data.chestBonus.impressionsWithoutClaim = 0;\n      }\n    } catch (e) {}\n\n    // ---- 战斗通行证 ----\n    try {\n      if (data.battlePass) {\n        data.battlePass.currentXp = 999999;\n        data.battlePass.currentLevel = 99;\n        data.battlePass.isPremiumPurchased = true;\n      }\n    } catch (e) {}\n\n    // ---- 士兵/洒水器全部解锁 ----\n    try {\n      if (data.soldier && data.soldier._unlockeds) {\n        var maxSoldier = 40;\n        var un = [];\n        for (var u = 1; u <= maxSoldier; u++) un.push(u);\n        data.soldier._unlockeds.$values = un;\n      }\n    } catch (e) {}\n\n    // ---- 花园功能解锁 ----\n    try {\n      if (data.garden) {\n        data.garden.isFeatureUnlocked = true;\n        data.garden.isFeatureRecentlyActivated = true;\n      }\n    } catch (e) {}\n\n    // ---- 遗物系统解锁 ----\n    try {\n      if (data.artifacts) {\n        data.artifacts.isActive = true;\n        data.artifacts.isRecentlyActivated = true;\n        data.artifacts.totalPullCount = 999;\n      }\n    } catch (e) {}\n  }\n\n  /* --------------------------------------------------------- 拦截读写 */\n\n  var CFG = {\n    money: 999999,\n    income: 99,\n    energy: 9999,\n    accountLevel: 999,\n    chapter: 99,\n    soldierLevel: 99,\n    noAds: true,\n    on: true\n  };\n\n  /** 改写一个存档值；不是存档就原样返回 */\n  function patchValue(value) {\n    if (!CFG.on) return value;\n    var u = unpack(value);\n    if (!u) return value;\n    try {\n      applyRules(u.data, CFG);\n      // 免广告标记：这是存档里的字段，改了就永久无广告\n      if (CFG.noAds && u.data.advertisement) {\n        u.data.advertisement.isNoAdsPurchased = true;\n      }\n      /*\n       * 诊断：把 UI 环境状态写进存档顶层（Json.NET 会忽略未知字段，安全）。\n       * 存档改写是唯一确认可用的落盘通道 —— 探针写文件/storage 都不通，\n       * 但这个值会跟着游戏自己的存档写盘，能用 adb 读出来。\n       */\n      /*\n       * 诊断必须写进**游戏已知的字段** —— 写在外层未知字段会被\n       * .NET 反序列化丢掉（实测 __hmDiag 落不了盘）。\n       * previousVersion 是存档里已有的字符串字段，游戏只读不写。\n       */\n      /*\n       * 环境能力探针 —— 小游戏环境没有 DOM（document 是 adapter 伪造的，\n       * createElement 只支持 canvas/image），所以 HTML 面板根本不渲染。\n       * 这里把真实能力写进存档的已知字段（能落盘，实测有效），\n       * 用来确认该用 canvas 渲染还是 HTML 渲染。\n       */\n      try {\n        var env = [];\n        try { env.push('doc=' + (typeof G.document)); } catch (e) {}\n        try {\n          var d = G.document;\n          if (d) {\n            env.push('body=' + (d.body ? 1 : 0));\n            try {\n              var el = d.createElement('div');\n              env.push('div=' + (el ? (el.nodeType ? 'real' : 'fake') : 'null'));\n            } catch (e) { env.push('div=ERR'); }\n            try {\n              var cv = d.createElement('canvas');\n              env.push('cv=' + (cv && cv.getContext ? 'ctx' : 'none'));\n            } catch (e) { env.push('cv=ERR'); }\n          }\n        } catch (e) { env.push('dERR'); }\n        try {\n          var w = G.wx || (G.GameGlobal && G.GameGlobal.wx);\n          env.push('wx=' + (w ? 1 : 0));\n          env.push('wc=' + (w && w.createCanvas ? 1 : 0));\n          env.push('ts=' + (w && w.onTouchStart ? 1 : 0));\n          env.push('sys=' + (w && w.getSystemInfoSync ? 1 : 0));\n        } catch (e) { env.push('wERR'); }\n        try {\n          env.push('gg=' + (G.GameGlobal ? 1 : 0));\n          env.push('gc=' + (G.GameGlobal && G.GameGlobal.canvas ? 1 : 0));\n        } catch (e) {}\n        try {\n          var sc = G.GameGlobal && G.GameGlobal.canvas;\n          if (sc && sc.getContext) {\n            try { var g1 = sc.getContext('webgl') || sc.getContext('experimental-webgl'); env.push('gl=' + (g1 ? 1 : 0)); } catch (e) { env.push('gl=ERR'); }\n            try { var g2 = sc.getContext('2d'); env.push('2d=' + (g2 ? 1 : 0)); } catch (e) { env.push('2d=ERR'); }\n          }\n        } catch (e) {}\n        u.data.previousVersion = env.join('|').slice(0, 500);\n      } catch (e) {}\n\n      return repack(value, u.outer, u.data, u.depth);\n    } catch (e) {\n      return value;\n    }\n  }\n\n  /** 当前是否已适配（游戏存档结构被识别到了） */\n  var detected = 0;\n  function probe(value) {\n    var u = unpack(value);\n    if (!u) return 0;\n    detected = 1;\n    G.__hmHarvestOk = 1;\n    G.__hmHarvestData = u.data;\n    return 1;\n  }\n\n  /* --------------------------------------------------------- 接管 wx 存储 */\n\n  function hookStorage() {\n    var wx = getWx();\n    if (!wx) return 0;\n    var n = 0;\n\n    // ---- setStorage：写盘前改写 ----\n    try {\n      if (typeof wx.setStorage === 'function' && !wx.setStorage.__hm) {\n        var origSet = wx.setStorage;\n        var fSet = function (opts) {\n          try {\n            if (opts && typeof opts.data === 'string') {\n              opts.data = patchValue(opts.data);\n            }\n          } catch (e) {}\n          return origSet.call(wx, opts);\n        };\n        fSet.__hm = 1;\n        wx.setStorage = fSet;\n        n++;\n      }\n    } catch (e) {}\n\n    // ---- setStorageSync：同步写盘 ----\n    try {\n      if (typeof wx.setStorageSync === 'function' && !wx.setStorageSync.__hm) {\n        var origSetS = wx.setStorageSync;\n        var fSetS = function (key, data) {\n          try {\n            if (typeof data === 'string') data = patchValue(data);\n          } catch (e) {}\n          return origSetS.call(wx, key, data);\n        };\n        fSetS.__hm = 1;\n        wx.setStorageSync = fSetS;\n        n++;\n      }\n    } catch (e) {}\n\n    // ---- getStorageSync：读盘时改写（游戏启动读存档也走这里）----\n    try {\n      if (typeof wx.getStorageSync === 'function' && !wx.getStorageSync.__hm) {\n        var origGetS = wx.getStorageSync;\n        /*\n         * 记住原始实现。sweep 扫盘时必须用**原始**版本读：\n         * 被 hook 过的版本读出来已经是改写过的值，\n         * 再改写一次结果相同 → 会误判成「无需写入」而跳过，\n         * 磁盘上就留着旧值了。\n         */\n        G.__hmRawGetSync = origGetS;\n        var fGetS = function (key) {\n          var v = origGetS.call(wx, key);\n          try {\n            if (typeof v === 'string') {\n              probe(v);\n              v = patchValue(v);\n            }\n          } catch (e) {}\n          return v;\n        };\n        fGetS.__hm = 1;\n        wx.getStorageSync = fGetS;\n        n++;\n      }\n    } catch (e) {}\n\n    // ---- getStorage：异步读盘 ----\n    try {\n      if (typeof wx.getStorage === 'function' && !wx.getStorage.__hm) {\n        var origGet = wx.getStorage;\n        var fGet = function (opts) {\n          try {\n            if (opts && typeof opts.success === 'function') {\n              var succ = opts.success;\n              opts.success = function (res) {\n                try {\n                  if (res && typeof res.data === 'string') {\n                    probe(res.data);\n                    res.data = patchValue(res.data);\n                  }\n                } catch (e) {}\n                return succ.call(this, res);\n              };\n            }\n          } catch (e) {}\n          return origGet.call(wx, opts);\n        };\n        fGet.__hm = 1;\n        wx.getStorage = fGet;\n        n++;\n      }\n    } catch (e) {}\n\n    G.__hmHarvestHooks = n;\n    return n;\n  }\n\n  /* ------------------------------------------------- Unity 专用去广告接管 */\n\n  /**\n   * Unity 的广告走 unity-sdk/ad.js → wx.createRewardedVideoAd 等。\n   * 广告对象的 onClose 回调是 C# 通过 SendMessage 传进来的，\n   * 所以伪广告对象必须**真的触发 onClose**，\n   * 否则游戏永远等不到「广告看完了」的回调。\n   */\n  function hookUnityAds() {\n    var wx = getWx();\n    if (!wx) return 0;\n    var n = 0;\n    var keys = ['createRewardedVideoAd', 'createInterstitialAd', 'createBannerAd', 'createCustomAd'];\n    for (var i = 0; i < keys.length; i++) {\n      (function (key) {\n        try {\n          if (typeof wx[key] !== 'function') return;\n          /*\n           * 通用层（common.js）也会接管这些 API，而且**先跑**。\n           * 但通用层的伪广告 onClose 是空函数 —— 游戏的 C# 永远等不到\n           * 「广告看完」的回调，奖励发不出去。\n           * 所以这里必须覆盖通用层的版本：认得出 __hmUnity 标记就替换，\n           * 不能因为已经打过标记就跳过。\n           */\n          var prev = wx[key];\n          if (prev && prev.__hm && !prev.__hmUnityAd) {\n            // 通用层的版本没有真实 onClose，必须换掉\n          } else if (prev && prev.__hm) {\n            n++;      // 已经是本模块接管的，幂等跳过但要计数\n            return;\n          }\n          var orig = prev;\n          var fake = function () {\n            var closeCb = null, loadCb = null, errCb = null;\n            var ad = {\n              show: function () {\n                // 广告「看完了」→ 触发 onClose，带 isEnded=1 表示完整观看\n                setTimeout(function () {\n                  if (closeCb) { try { closeCb({ isEnded: true }); } catch (e) {} }\n                }, 30);\n                return Promise.resolve(1);\n              },\n              load: function () {\n                setTimeout(function () {\n                  if (loadCb) { try { loadCb({}); } catch (e) {} }\n                }, 10);\n                return Promise.resolve(1);\n              },\n              destroy: function () {},\n              setStyle: function () {},\n              onClose: function (cb) { closeCb = cb; },\n              offClose: function () { closeCb = null; },\n              onLoad: function (cb) { loadCb = cb; },\n              offLoad: function () { loadCb = null; },\n              onError: function (cb) { errCb = cb; },\n              offError: function () { errCb = null; },\n              onResize: function () {}, offResize: function () {}\n            };\n            ad.__hm = 1;\n            return ad;\n          };\n          fake.__hm = 1;\n          fake.__hmUnityAd = 1;     // 标记这是会真正触发 onClose 的版本\n          fake.__hmOrig = orig;\n          wx[key] = fake;\n          n++;\n        } catch (e) {}\n      })(keys[i]);\n    }\n    G.__hmHarvestAdN = n;\n    return n;\n  }\n\n  /* ------------------------------------------------------------- 对外接口 */\n\n  G.__hmHarvestCfg = CFG;\n  G.__hmHarvestPatch = patchValue;\n  G.__hmHarvestHookStorage = hookStorage;\n  G.__hmHarvestHookAds = hookUnityAds;\n  G.__hmHarvestDetected = function () { return detected; };\n\n  /**\n   * 主动扫描全部本地存档并改写（游戏已加载完时用）。\n   * 走 wx.getStorageInfoSync 拿到 key 列表，逐个读出来改。\n   */\n  G.__hmHarvestSweep = function () {\n    var changed = 0, seen = 0;\n    var wx = getWx();\n    if (!wx) return 0;\n    try {\n      var info = wx.getStorageInfoSync();\n      var keys = (info && info.keys) || [];\n      /*\n       * 必须用原始 getStorageSync 读 —— 被 hook 的版本返回的已经是\n       * 改写过的值，再改写结果相同就会被误判为「无需写入」，\n       * 结果磁盘上留的还是旧值。\n       */\n      var rawGet = G.__hmRawGetSync || wx.getStorageSync;\n      for (var i = 0; i < keys.length; i++) {\n        var v = null;\n        try { v = rawGet.call(wx, keys[i]); } catch (e) { continue; }\n        if (typeof v !== 'string') continue;\n        var u = unpack(v);\n        if (!u) continue;\n        seen++;\n        var nv = patchValue(v);\n        if (nv !== v) {\n          try { wx.setStorageSync(keys[i], nv); changed++; } catch (e) {}\n        }\n      }\n    } catch (e) {}\n    G.__hmHarvestSwept = seen;\n\n    /*\n     * 环境探针：写进**独立的 storage key**。\n     * 之前写 previousVersion 被游戏自己的序列化覆盖了 ——\n     * 游戏每次写盘都重置那个字段。\n     * 独立 key 不在 .NET 对象里，不会被覆盖，能稳定落盘。\n     */\n    try {\n      var w = getWx();\n      if (w && w.setStorageSync) {\n        w.setStorageSync('__hmEnv__', buildEnvProbe());\n      }\n    } catch (e) {}\n\n    return changed;\n  };\n\n  /** 环境能力探针 */\n  function buildEnvProbe() {\n    var env = [];\n    try { env.push('doc=' + (typeof G.document)); } catch (e) {}\n    try {\n      var d = G.document;\n      if (d) {\n        env.push('body=' + (d.body ? 1 : 0));\n        try {\n          var el = d.createElement('div');\n          env.push('div=' + (el ? (el.nodeType ? 'real' : 'fake') : 'null'));\n        } catch (e) { env.push('div=ERR'); }\n        try {\n          var cv = d.createElement('canvas');\n          env.push('cv=' + (cv && cv.getContext ? 'ctx' : 'none'));\n        } catch (e) { env.push('cv=ERR'); }\n      }\n    } catch (e) { env.push('dERR'); }\n    try {\n      var w = G.wx || (G.GameGlobal && G.GameGlobal.wx);\n      env.push('wx=' + (w ? 1 : 0));\n      env.push('wc=' + (w && w.createCanvas ? 1 : 0));\n      env.push('ts=' + (w && w.onTouchStart ? 1 : 0));\n    } catch (e) { env.push('wERR'); }\n    try {\n      env.push('gg=' + (G.GameGlobal ? 1 : 0));\n      env.push('gc=' + (G.GameGlobal && G.GameGlobal.canvas ? 1 : 0));\n    } catch (e) {}\n    try {\n      var sc = G.GameGlobal && G.GameGlobal.canvas;\n      if (sc && sc.getContext) {\n        try { var g1 = sc.getContext('webgl') || sc.getContext('experimental-webgl'); env.push('gl=' + (g1 ? 1 : 0)); } catch (e) { env.push('gl=ERR'); }\n        try { var g2 = sc.getContext('2d'); env.push('2d=' + (g2 ? 1 : 0)); } catch (e) { env.push('2d=ERR'); }\n      }\n    } catch (e) {}\n    try {\n      env.push('uiR=' + (typeof G.__hmUnityUIReady === 'function' && G.__hmUnityUIReady() ? 1 : 0));\n      env.push('lay=' + (G.__hmUnityLayout ? 1 : 0));\n      env.push('top=' + (G.__hmTopError || '-'));\n    } catch (e) {}\n    return env.join('|').slice(0, 500);\n  }\n\n  /* 首次接管。等游戏把 SDK 初始化完再扫，命中率更高。 */\n  function boot() {\n    hookStorage();\n    hookUnityAds();\n  }\n  G.__hmHarvestBoot = boot;\n\n  [300, 1200, 3000, 6000].forEach(function (ms) {\n    setTimeout(function () { try { boot(); } catch (e) {} }, ms);\n  });\n\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n";
  G.__hmModuleSrc["unity_ui.js"] = "/**\n * unity_ui.js —— Unity 小游戏的悬浮面板（canvas 版）\n *\n * 为什么不用 HTML：\n *   小游戏环境**没有 DOM**。document 是 adapter 伪造的，\n *   createElement 只支持 canvas/image 两种标签，div/style/appendChild\n *   全是空转，永远不渲染。实测 HTML 面板一个像素都显示不出来。\n *\n * 正确做法：\n *   1. wx.createCanvas() 开一个**离屏 2D canvas** 画面板\n *      （首次调用返回上屏 canvas，但 Unity 早就拿走了，所以我们拿到的是离屏的）\n *   2. 用 WebGL 把离屏 canvas 当纹理，贴到 Unity 的上屏 canvas 上\n *   3. 拦截 requestAnimationFrame，每帧在 Unity 画完之后补画一帧面板\n *   4. 触摸用 wx.onTouchStart/Move/End，自己做命中检测\n *\n * 坐标系：内部统一用 750x1334 虚拟分辨率，触摸坐标等比映射进来。\n */\n(function () {\n  var G = (typeof globalThis !== 'undefined') ? globalThis : this;\n  if (G.__hmUnityUI) return;\n  G.__hmUnityUI = 1;\n\n  /* ================================================================ 主题 */\n  var THEME = {\n    panel: 'rgba(20,42,78,0.95)',\n    panelBorder: 'rgba(120,180,240,0.35)',\n    head: 'rgba(30,58,102,0.98)',\n    foot: 'rgba(26,50,92,0.98)',\n    section: '#8FC5F5',\n    label: '#DCEBFB',\n    value: '#FFFFFF',\n    primary: '#3D86D8',\n    primaryHover: '#5AA0E8',\n    primaryBorder: 'rgba(150,200,250,0.45)',\n    gearOff: 'rgba(46,86,150,0.85)',\n    gearOffHover: 'rgba(66,116,190,0.95)',\n    inputBg: 'rgba(12,30,58,0.92)',\n    inputBorder: 'rgba(120,180,240,0.38)',\n    swOff: 'rgba(70,100,150,0.9)',\n    swOn: '#3D86D8',\n    swKnob: '#FFFFFF',\n    accent: '#7FC4FF'\n  };\n\n  var R_PANEL = 18, R_CTRL = 11, R_SEG = 10, R_TRACK = 18;\n  var VW = 750, VH = 1334;\n  var PAD = 22, IND = 14, LBL_W = 150, BTN_W = 92, ROW_H = 62, SW_H = 52;\n\n  /* ================================================================ 状态 */\n  var SW = 750, SH = 1334;\n  var collapsed = true;\n  var btnX = 620, btnY = 1180, btnR = 40;\n  var panelX = 45, panelY = 170, panelW = 660, panelH = 1000;\n  var headH = 60, footH = 84;\n  var scrollY = 0, scrollMax = 0;\n  var dirty = true;\n  var hoverId = null;\n  var hitRegions = [];\n  var titleText = 'HM 修改器';\n  var dragMode = 0, dragDX = 0, dragDY = 0;\n  var lastRect = null;        // 本次绘制覆盖的矩形（虚拟坐标），叠加时只贴这块\n\n  /* ================================================================ canvas */\n  var off = null, offCtx = null;\n  var mainCanvas = null;\n  var gl = null, glTex = null, glProg = null, glBuf = null, glLoc = null, glReady = 0;\n\n  function getWx() {\n    try { if (G.wx) return G.wx; } catch (e) {}\n    try { if (G.GameGlobal && G.GameGlobal.wx) return G.GameGlobal.wx; } catch (e) {}\n    return null;\n  }\n\n  function sysInfo() {\n    var w = getWx();\n    try { if (w && w.getSystemInfoSync) { var s = w.getSystemInfoSync(); if (s) return s; } } catch (e) {}\n    return { windowWidth: VW, windowHeight: VH, pixelRatio: 1 };\n  }\n\n  function ensureCanvas() {\n    if (off && offCtx) return true;\n    var w = getWx();\n    try {\n      if (w && w.createCanvas) {\n        off = w.createCanvas();\n      } else if (G.document && G.document.createElement) {\n        off = G.document.createElement('canvas');\n      } else {\n        return false;\n      }\n      off.width = VW; off.height = VH;\n      offCtx = off.getContext('2d');\n    } catch (e) { return false; }\n    return !!(off && offCtx);\n  }\n\n  /* ================================================================ 绘图工具 */\n  function rr(ctx, x, y, w, h, r) {\n    if (r > w / 2) r = w / 2;\n    if (r > h / 2) r = h / 2;\n    ctx.beginPath();\n    ctx.moveTo(x + r, y);\n    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);\n    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);\n    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);\n    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);\n    ctx.closePath();\n  }\n  function fillRR(ctx, x, y, w, h, r, fill, stroke, lw) {\n    rr(ctx, x, y, w, h, r);\n    if (fill) { ctx.fillStyle = fill; ctx.fill(); }\n    if (stroke) { ctx.lineWidth = lw || 2; ctx.strokeStyle = stroke; ctx.stroke(); }\n  }\n  function text(ctx, s, x, y, size, color, align, bold) {\n    ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';\n    ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';\n    ctx.fillText(String(s), x, y);\n  }\n\n  /* ================================================================ 命中区 */\n  var hitDY = 0;          // 内容区滚动偏移（绘制时 translate 了 -scrollY，命中区要同步减）\n  function clearHits() { hitRegions = []; hitDY = 0; }\n  function addHit(id, x, y, w, h, kind, data) {\n    hitRegions.push({ id: id, x: x, y: y + hitDY, w: w, h: h, kind: kind, data: data });\n  }\n  function hitTest(x, y) {\n    for (var i = hitRegions.length - 1; i >= 0; i--) {\n      var r = hitRegions[i];\n      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;\n    }\n    return null;\n  }\n\n  /* ================================================================ 面板绘制 */\n  function getSet() {\n    return G.__hmUnitySet || (G.__hmUnitySet = {});\n  }\n\n  function drawFloat(ctx) {\n    var cx = btnX, cy = btnY;\n    var hov = hoverId === 'float';\n    ctx.beginPath();\n    ctx.arc(cx, cy, btnR, 0, Math.PI * 2);\n    ctx.fillStyle = hov ? THEME.primaryHover : THEME.primary;\n    ctx.fill();\n    ctx.lineWidth = 3; ctx.strokeStyle = THEME.primaryBorder; ctx.stroke();\n    text(ctx, 'HM', cx, cy, 26, '#FFFFFF', 'center', true);\n    addHit('float', cx - btnR, cy - btnR, btnR * 2, btnR * 2, 'float', null);\n  }\n\n  function drawPanel(ctx) {\n    var L = G.__hmUnityLayout;\n    if (!L) return;\n    var x = panelX, y = panelY, w = panelW, h = panelH;\n\n    // 外框\n    fillRR(ctx, x, y, w, h, R_PANEL, THEME.panel, THEME.panelBorder, 2);\n\n    // 标题栏\n    fillRR(ctx, x, y, w, headH, R_PANEL, THEME.head, null);\n    ctx.fillStyle = THEME.head; ctx.fillRect(x, y + headH - R_PANEL, w, R_PANEL);\n    text(ctx, titleText, x + 22, y + headH / 2, 24, THEME.accent, 'left', true);\n\n    // 关闭钮\n    var cbS = 38, cbX = x + w - cbS - 14, cbY = y + (headH - cbS) / 2;\n    fillRR(ctx, cbX, cbY, cbS, cbS, cbS / 2,\n      hoverId === 'close' ? THEME.danger : 'rgba(232,115,115,0.55)',\n      'rgba(255,180,180,0.5)', 2);\n    text(ctx, '×', cbX + cbS / 2, cbY + cbS / 2 + 1, 26, '#fff', 'center', true);\n    addHit('close', cbX, cbY, cbS, cbS, 'close', null);\n\n    // 标题栏拖动区\n    addHit('head', x, y, w - cbS - 14, headH, 'dragHead', null);\n\n    // 内容区（裁剪 + 滚动）\n    var bodyY = y + headH, bodyH = h - headH - footH;\n    ctx.save();\n    rr(ctx, x + 1, bodyY, w - 2, bodyH, 4); ctx.clip();\n    ctx.translate(0, -scrollY);\n\n    clearHits();\n    addHit('close', cbX, cbY, cbS, cbS, 'close', null);\n    addHit('head', x, y, w - cbS - 14, headH, 'dragHead', null);\n    addHit('body', x, bodyY, w, bodyH, 'scroll', null);\n    hitDY = -scrollY;      // 内容区绘制时 translate 了 -scrollY，命中区同步\n\n    var cx0 = x + PAD + IND, cw = w - PAD * 2 - IND;\n    var cy = bodyY + 18;\n    var set = getSet();\n\n    for (var si = 0; si < L.sections.length; si++) {\n      var sec = L.sections[si];\n      text(ctx, sec.title, cx0, cy + 14, 21, THEME.section, 'left', true);\n      cy += 42;\n\n      var halfN = 0, halfY = cy;\n      for (var ri = 0; ri < sec.rows.length; ri++) {\n        (function (row) {\n          if (row.t === 'num') {\n            text(ctx, row.label, cx0, cy + ROW_H / 2, 21, THEME.label, 'left');\n            var vx = cx0 + LBL_W, vw = cw - LBL_W - BTN_W - 22;\n            fillRR(ctx, vx, cy, vw, ROW_H, R_CTRL,\n              hoverId === 'val:' + row.key ? 'rgba(20,44,86,0.98)' : THEME.inputBg,\n              THEME.inputBorder, 2);\n            text(ctx, String(set[row.key] != null ? set[row.key] : 0),\n              vx + vw / 2, cy + ROW_H / 2, 23, THEME.value, 'center');\n            addHit('val:' + row.key, vx, cy, vw, ROW_H, 'edit', row);\n\n            var bx = vx + vw + 12;\n            fillRR(ctx, bx, cy, BTN_W, ROW_H, R_CTRL,\n              hoverId === 'ap:' + row.key ? THEME.primaryHover : THEME.primary,\n              THEME.primaryBorder, 2);\n            text(ctx, '应用', bx + BTN_W / 2, cy + ROW_H / 2, 21, '#fff', 'center', true);\n            addHit('ap:' + row.key, bx, cy, BTN_W, ROW_H, 'apply', row);\n            cy += ROW_H + 10;\n\n          } else if (row.t === 'sw') {\n            if (row.half) {\n              var colW = Math.floor((cw - 16) / 2);\n              var col = halfN % 2;\n              if (col === 0) halfY = cy;\n              var bx2 = cx0 + col * (colW + 16);\n              text(ctx, row.label, bx2, halfY + SW_H / 2, 21, THEME.label, 'left');\n              var on = !!set[row.key];\n              var tw = 66, th = 36, tx = bx2 + colW - tw, ty = halfY + (SW_H - th) / 2;\n              fillRR(ctx, tx, ty, tw, th, R_TRACK, on ? THEME.swOn : THEME.swOff, null);\n              ctx.beginPath();\n              ctx.arc(tx + (on ? tw - th / 2 : th / 2), ty + th / 2, th / 2 - 3, 0, Math.PI * 2);\n              ctx.fillStyle = THEME.swKnob; ctx.fill();\n              addHit('sw:' + row.key, bx2, halfY, colW, SW_H, 'switch', row);\n              halfN++;\n              if (halfN % 2 === 0) cy += SW_H + 8;\n            } else {\n              text(ctx, row.label, cx0, cy + SW_H / 2, 21, THEME.label, 'left');\n              var on2 = !!set[row.key];\n              var tw2 = 66, th2 = 36, tx2 = cx0 + cw - tw2, ty2 = cy + (SW_H - th2) / 2;\n              fillRR(ctx, tx2, ty2, tw2, th2, R_TRACK, on2 ? THEME.swOn : THEME.swOff, null);\n              ctx.beginPath();\n              ctx.arc(tx2 + (on2 ? tw2 - th2 / 2 : th2 / 2), ty2 + th2 / 2, th2 / 2 - 3, 0, Math.PI * 2);\n              ctx.fillStyle = THEME.swKnob; ctx.fill();\n              addHit('sw:' + row.key, cx0, cy, cw, SW_H, 'switch', row);\n              cy += SW_H + 8;\n            }\n\n          } else if (row.t === 'gear') {\n            text(ctx, row.label, cx0, cy, 21, THEME.label, 'left');\n            cy += 32;\n            var opts = row.opts || [];\n            var segW = Math.floor((cw - (opts.length - 1) * 8) / opts.length);\n            var sel = -1;\n            for (var gi = 0; gi < opts.length; gi++) {\n              if (opts[gi].value === set[row.key]) sel = gi;\n            }\n            for (var gj = 0; gj < opts.length; gj++) {\n              var gx = cx0 + gj * (segW + 8);\n              var active = (gj === sel);\n              fillRR(ctx, gx, cy, segW, 48, R_SEG,\n                active ? (hoverId === 'gear:' + row.key + ':' + gj ? THEME.primaryHover : THEME.primary)\n                       : (hoverId === 'gear:' + row.key + ':' + gj ? THEME.gearOffHover : THEME.gearOff),\n                THEME.primaryBorder, 2);\n              text(ctx, opts[gj].label, gx + segW / 2, cy + 24, 21,\n                active ? '#fff' : THEME.label, 'center', active);\n              addHit('gear:' + row.key + ':' + gj, gx, cy, segW, 48, 'gear', { row: row, idx: gj });\n            }\n            cy += 48 + 14;\n          }\n        })(sec.rows[ri]);\n      }\n      cy += 12;\n    }\n    scrollMax = Math.max(0, cy - (bodyY + bodyH) + 24);\n    if (scrollY > scrollMax) scrollY = scrollMax;\n    ctx.restore();\n    hitDY = 0;\n\n    // 底部栏\n    var fy = y + h - footH;\n    fillRR(ctx, x + 1, fy, w - 2, footH, R_PANEL, THEME.foot, null);\n    ctx.fillStyle = THEME.foot; ctx.fillRect(x + 1, fy, w - 2, R_PANEL);\n    var acts = L.actions || [];\n    if (acts.length) {\n      var abw = Math.floor((w - PAD * 2 - (acts.length - 1) * 12) / acts.length);\n      for (var ai = 0; ai < acts.length; ai++) {\n        (function (act, idx) {\n          var ax = x + PAD + idx * (abw + 12), ay = fy + (footH - 56) / 2;\n          fillRR(ctx, ax, ay, abw, 56, R_CTRL,\n            hoverId === 'act:' + idx ? THEME.primaryHover : THEME.primary,\n            THEME.primaryBorder, 2);\n          text(ctx, act.label, ax + abw / 2, ay + 28, 22, '#fff', 'center', true);\n          addHit('act:' + idx, ax, ay, abw, 56, 'action', act);\n        })(acts[ai], ai);\n      }\n    }\n    // 重新加浮钮命中（clearHits 会清掉）\n    addHit('float', btnX - btnR, btnY - btnR, btnR * 2, btnR * 2, 'float', null);\n    addHit('head', x, y, w - 60, headH, 'dragHead', null);\n  }\n\n  /* ================================================================ WebGL 叠加 */\n  function findMainCanvas() {\n    try { if (G.GameGlobal && G.GameGlobal.canvas) return G.GameGlobal.canvas; } catch (e) {}\n    try { if (G.canvas && G.canvas.getContext) return G.canvas; } catch (e) {}\n    try {\n      if (G.GameGlobal && G.GameGlobal.manager && G.GameGlobal.manager.canvas) {\n        return G.GameGlobal.manager.canvas;\n      }\n    } catch (e) {}\n    return null;\n  }\n\n  function initGL() {\n    if (glReady) return glReady > 0;\n    mainCanvas = findMainCanvas();\n    if (!mainCanvas || !mainCanvas.getContext) { glReady = -1; return false; }\n    try {\n      gl = mainCanvas.getContext('webgl') || mainCanvas.getContext('experimental-webgl');\n    } catch (e) { gl = null; }\n    if (!gl) { glReady = -1; return false; }\n\n    var vs = 'attribute vec2 aPos;attribute vec2 aUV;varying vec2 vUV;' +\n      'void main(){vUV=aUV;gl_Position=vec4(aPos,0.0,1.0);}';\n    var fs = 'precision mediump float;varying vec2 vUV;uniform sampler2D uTex;' +\n      'void main(){vec4 c=texture2D(uTex,vUV);gl_FragColor=vec4(c.rgb,c.a);}';\n\n    function sh(type, src) {\n      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);\n      return s;\n    }\n    try {\n      glProg = gl.createProgram();\n      gl.attachShader(glProg, sh(gl.VERTEX_SHADER, vs));\n      gl.attachShader(glProg, sh(gl.FRAGMENT_SHADER, fs));\n      gl.linkProgram(glProg);\n      glBuf = gl.createBuffer();\n      glTex = gl.createTexture();\n      glLoc = {\n        aPos: gl.getAttribLocation(glProg, 'aPos'),\n        aUV: gl.getAttribLocation(glProg, 'aUV'),\n        uTex: gl.getUniformLocation(glProg, 'uTex')\n      };\n    } catch (e) { glReady = -1; return false; }\n    glReady = 1;\n    return true;\n  }\n\n  /* 保护：连续出错就永久关掉叠加，绝不把游戏画面搞黑 */\n  var overlayFails = 0;\n  function overlayDead() { return G.__hmOverlayOff || overlayFails >= 3; }\n\n  /**\n   * 把离屏 canvas 贴到上屏。\n   *\n   * 三条保命规则（踩过的坑）：\n   *   1. viewport / pixelStore 必须存取还原 —— 漏了 viewport，\n   *      Unity 之后按错误的视口渲染，整屏直接黑掉。\n   *   2. 只画面板那一小块矩形，不要全屏四边形 —— 万一混合有问题，\n   *      影响范围也只在面板那点地方。\n   *   3. canvas 上传的纹理是**预乘 alpha**，混合要用 ONE / ONE_MINUS_SRC_ALPHA。\n   */\n  function drawOverlay() {\n    if (!off || !glReady || !gl || overlayDead()) return;\n    var rect = lastRect;\n    if (!rect || rect.w <= 0 || rect.h <= 0) return;\n\n    var W = mainCanvas.width, H = mainCanvas.height;\n    if (!W || !H) return;\n\n    var old = null;\n    try {\n      old = {\n        prog: gl.getParameter(gl.CURRENT_PROGRAM),\n        tex: gl.getParameter(gl.TEXTURE_BINDING_2D),\n        active: gl.getParameter(gl.ACTIVE_TEXTURE),\n        buf: gl.getParameter(gl.ARRAY_BUFFER_BINDING),\n        blend: gl.isEnabled(gl.BLEND),\n        srgb: gl.getParameter(gl.BLEND_SRC_RGB),\n        drgb: gl.getParameter(gl.BLEND_DST_RGB),\n        sa: gl.getParameter(gl.BLEND_SRC_ALPHA),\n        da: gl.getParameter(gl.BLEND_DST_ALPHA),\n        vp: gl.getParameter(gl.VIEWPORT),\n        flip: gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),\n        pre: gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)\n      };\n    } catch (e) {}\n\n    // 虚拟坐标 -> NDC\n    var x0 = (rect.x / VW) * 2 - 1;\n    var x1 = ((rect.x + rect.w) / VW) * 2 - 1;\n    var y0 = 1 - ((rect.y + rect.h) / VH) * 2;\n    var y1 = 1 - (rect.y / VH) * 2;\n    // 对应 uv（离屏 canvas 原点左上）\n    var u0 = rect.x / VW, u1 = (rect.x + rect.w) / VW;\n    var v0 = rect.y / VH, v1 = (rect.y + rect.h) / VH;\n\n    try {\n      gl.useProgram(glProg);\n      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);\n      var data = new Float32Array([\n        x0, y1, u0, v0,\n        x1, y1, u1, v0,\n        x0, y0, u0, v1,\n        x1, y0, u1, v1\n      ]);\n      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);\n      gl.enableVertexAttribArray(glLoc.aPos);\n      gl.vertexAttribPointer(glLoc.aPos, 2, gl.FLOAT, false, 16, 0);\n      gl.enableVertexAttribArray(glLoc.aUV);\n      gl.vertexAttribPointer(glLoc.aUV, 2, gl.FLOAT, false, 16, 8);\n\n      gl.activeTexture(gl.TEXTURE0);\n      gl.bindTexture(gl.TEXTURE_2D, glTex);\n      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);\n      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);\n      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);\n      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);\n      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);\n      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);\n      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);\n\n      gl.enable(gl.BLEND);\n      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);\n      gl.uniform1i(glLoc.uTex, 0);\n      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);\n    } catch (e) {\n      overlayFails++;\n      try { G.__hmUnityGLErr = String(e); } catch (e2) {}\n    }\n\n    // 还原（即使上面抛了也要还原，否则 Unity 下一帧就废了）\n    if (old) {\n      try {\n        gl.bindTexture(gl.TEXTURE_2D, old.tex);\n        gl.activeTexture(old.active);\n        gl.bindBuffer(gl.ARRAY_BUFFER, old.buf);\n        gl.useProgram(old.prog);\n        gl.blendFuncSeparate(old.srgb, old.drgb, old.sa, old.da);\n        if (!old.blend) gl.disable(gl.BLEND);\n        if (old.vp) gl.viewport(old.vp[0], old.vp[1], old.vp[2], old.vp[3]);\n        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, old.flip ? 1 : 0);\n        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, old.pre ? 1 : 0);\n      } catch (e) {}\n    }\n  }\n\n  /* ================================================================ 帧循环 */\n  function frame() {\n    try {\n      if (overlayDead()) return;\n      if (!ensureCanvas()) return;\n      if (dirty) {\n        offCtx.clearRect(0, 0, VW, VH);\n        clearHits();\n        if (collapsed) {\n          drawFloat(offCtx);\n          lastRect = { x: btnX - btnR - 6, y: btnY - btnR - 6, w: btnR * 2 + 12, h: btnR * 2 + 12 };\n        } else {\n          drawPanel(offCtx);\n          drawFloat(offCtx);\n          lastRect = {\n            x: Math.min(panelX, btnX - btnR) - 8,\n            y: Math.min(panelY, btnY - btnR) - 8,\n            w: Math.max(panelX + panelW, btnX + btnR) - Math.min(panelX, btnX - btnR) + 16,\n            h: Math.max(panelY + panelH, btnY + btnR) - Math.min(panelY, btnY - btnR) + 16\n          };\n        }\n        if (stepOpen) {\n          drawStepper(offCtx);\n          lastRect = { x: 0, y: 0, w: VW, h: VH };\n        }\n        dirty = false;\n      }\n      if (!initGL()) return;\n      drawOverlay();\n    } catch (e) {\n      try { G.__hmUnityUIErr = String(e); } catch (e2) {}\n    }\n  }\n\n  function installFrameHook() {\n    /*\n     * rAF 包装是唯一能在 Unity 画完之后补画的时机，\n     * 但也是最容易把游戏整黑的地方 —— 所以：\n     *   - 只包一层，原样返回 handle（cancelAnimationFrame 才对得上）\n     *   - 里面任何异常都吞掉，绝不能影响 Unity 自己的回调\n     *   - 万一出事，G.__hmOverlayOff = 1 可一键关闭\n     */\n    var orig = G.requestAnimationFrame;\n    if (typeof orig === 'function' && !orig.__hmWrapped) {\n      var wrapped = function (cb) {\n        return orig.call(G, function (ts) {\n          var r;\n          try { r = cb ? cb(ts) : undefined; } catch (e) {}\n          try { frame(); } catch (e) {}\n          return r;\n        });\n      };\n      wrapped.__hmWrapped = 1;\n      wrapped.__hmOrig = orig;\n      try { G.requestAnimationFrame = wrapped; } catch (e) {}\n    }\n    // 兜底：面板展开期间用定时器补帧\n    if (!G.__hmUnityFrameTimer) {\n      G.__hmUnityFrameTimer = setInterval(function () {\n        if (overlayDead()) return;\n        if (!collapsed) { dirty = true; frame(); }\n      }, 150);\n    }\n    dirty = true;\n    setTimeout(frame, 60);\n  }\n\n  /* ================================================================ 触摸 */\n  function toVirtual(t) {\n    var s = sysInfo();\n    var wpx = s.windowWidth || VW, hpx = s.windowHeight || VH;\n    return {\n      x: (t.clientX / wpx) * VW,\n      y: (t.clientY / hpx) * VH\n    };\n  }\n\n  function applyRow(row) {\n    var v = getSet()[row.key];\n    try { if (row.apply) row.apply(v); } catch (e) {}\n  }\n\n  function handleTap(r, vx, vy) {\n    if (!r) return;\n    var set = getSet();\n    if (r.kind === 'float') {\n      collapsed = !collapsed; dirty = true;\n    } else if (r.kind === 'close') {\n      collapsed = true; dirty = true;\n    } else if (r.kind === 'apply') {\n      applyRow(r.data);\n      try { titleText = 'HM ' + r.data.label + ' = ' + set[r.data.key]; } catch (e) {}\n      dirty = true;\n    } else if (r.kind === 'switch') {\n      var on = !set[r.data.key];\n      set[r.data.key] = on;\n      try { if (r.data.onChange) r.data.onChange(on); } catch (e) {}\n      dirty = true;\n    } else if (r.kind === 'gear') {\n      var row = r.data.row, idx = r.data.idx;\n      var opt = row.opts[idx];\n      set[row.key] = opt.value;\n      try { if (row.apply) row.apply(opt.value); } catch (e) {}\n      try { titleText = 'HM ' + row.label + ' = ' + opt.label; } catch (e) {}\n      dirty = true;\n    } else if (r.kind === 'action') {\n      try { r.data.fn(); } catch (e) {}\n      dirty = true;\n    } else if (r.kind === 'edit') {\n      openEditor(r.data);\n    }\n  }\n\n  /* 数值输入：优先 wx.showKeyboard；没有就用长按 +/- 的步进器 */\n  var editRow = null, editVal = 0, stepTimer = 0;\n\n  function openEditor(row) {\n    editRow = row;\n    editVal = parseInt(getSet()[row.key], 10);\n    if (isNaN(editVal)) editVal = 0;\n    var w = getWx();\n    if (w && w.showKeyboard) {\n      try {\n        w.showKeyboard({\n          defaultValue: String(editVal),\n          maxLength: 10,\n          multiple: false,\n          confirmHold: false,\n          confirmType: 'done'\n        });\n        if (!w.__hmKbBound) {\n          w.__hmKbBound = 1;\n          if (w.onKeyboardConfirm) {\n            w.onKeyboardConfirm(function (res) {\n              if (!editRow) return;\n              var v = parseInt(res && res.value, 10);\n              if (isNaN(v) || v < 0) v = 0;\n              getSet()[editRow.key] = v;\n              applyRow(editRow);\n              try { titleText = 'HM ' + editRow.label + ' = ' + v; } catch (e) {}\n              editRow = null; dirty = true;\n            });\n          }\n          if (w.onKeyboardComplete) {\n            w.onKeyboardComplete(function () { editRow = null; dirty = true; });\n          }\n        }\n        return;\n      } catch (e) {}\n    }\n    // 退化：步进器浮层\n    stepOpen = true; dirty = true;\n  }\n\n  var stepOpen = false;\n\n  function drawStepper(ctx) {\n    if (!stepOpen || !editRow) return;\n    var w = 380, h = 190, x = (VW - w) / 2, y = (VH - h) / 2;\n    fillRR(ctx, x, y, w, h, R_PANEL, THEME.panel, THEME.panelBorder, 2);\n    text(ctx, editRow.label, x + w / 2, y + 30, 22, THEME.accent, 'center', true);\n    text(ctx, String(editVal), x + w / 2, y + 78, 34, '#fff', 'center', true);\n    var bw = 100, bh = 52, by = y + h - bh - 18;\n    fillRR(ctx, x + 22, by, bw, bh, R_CTRL, hoverId === 'stp-' ? THEME.primaryHover : THEME.primary, THEME.primaryBorder, 2);\n    text(ctx, '−', x + 22 + bw / 2, by + bh / 2, 30, '#fff', 'center', true);\n    fillRR(ctx, x + w / 2 - bw / 2, by, bw, bh, R_CTRL, hoverId === 'stpOK' ? THEME.primaryHover : THEME.primary, THEME.primaryBorder, 2);\n    text(ctx, '确定', x + w / 2, by + bh / 2, 22, '#fff', 'center', true);\n    fillRR(ctx, x + w - 22 - bw, by, bw, bh, R_CTRL, hoverId === 'stp+' ? THEME.primaryHover : THEME.primary, THEME.primaryBorder, 2);\n    text(ctx, '+', x + w - 22 - bw / 2, by + bh / 2, 30, '#fff', 'center', true);\n    addHit('stp-', x + 22, by, bw, bh, 'step', -1);\n    addHit('stpOK', x + w / 2 - bw / 2, by, bw, bh, 'stepOK', null);\n    addHit('stp+', x + w - 22 - bw, by, bw, bh, 'step', 1);\n  }\n\n  function onTouchStart(e) {\n    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);\n    if (!t) return;\n    var p = toVirtual(t);\n    if (stepOpen) {\n      var r = hitTest(p.x, p.y);\n      if (r && r.kind === 'step') { editVal = Math.max(0, editVal + r.data * 10); dirty = true; }\n      else if (r && r.kind === 'stepOK') {\n        if (editRow) {\n          getSet()[editRow.key] = editVal;\n          applyRow(editRow);\n          try { titleText = 'HM ' + editRow.label + ' = ' + editVal; } catch (e2) {}\n          editRow = null;\n        }\n        stepOpen = false; dirty = true;\n      }\n      return;\n    }\n    var hit = hitTest(p.x, p.y);\n    if (hit && (hit.kind === 'dragHead' || hit.kind === 'float')) {\n      dragMode = hit.kind === 'float' ? 2 : 1;\n      dragDX = p.x - (hit.kind === 'float' ? btnX : panelX);\n      dragDY = p.y - (hit.kind === 'float' ? btnY : panelY);\n      return;\n    }\n    if (hit && hit.kind === 'scroll') {\n      dragMode = 3; dragDY = p.y; return;\n    }\n    if (hit) { handleTap(hit, p.x, p.y); }\n  }\n\n  function onTouchMove(e) {\n    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);\n    if (!t || !dragMode) return;\n    var p = toVirtual(t);\n    if (dragMode === 2) {\n      btnX = Math.max(btnR, Math.min(VW - btnR, p.x - dragDX));\n      btnY = Math.max(btnR, Math.min(VH - btnR, p.y - dragDY));\n      dirty = true;\n    } else if (dragMode === 1) {\n      panelX = Math.max(-panelW / 2, Math.min(VW - panelW / 2, p.x - dragDX));\n      panelY = Math.max(0, Math.min(VH - headH, p.y - dragDY));\n      dirty = true;\n    } else if (dragMode === 3) {\n      var dy = p.y - dragDY;\n      dragDY = p.y;\n      scrollY = Math.max(0, Math.min(scrollMax, scrollY - dy));\n      dirty = true;\n    }\n  }\n\n  function onTouchEnd() { dragMode = 0; }\n\n  function installTouch() {\n    var w = getWx();\n    if (!w) return;\n    try {\n      if (w.onTouchStart) w.onTouchStart(onTouchStart);\n      if (w.onTouchMove) w.onTouchMove(onTouchMove);\n      if (w.onTouchEnd) w.onTouchEnd(onTouchEnd);\n      if (w.onTouchCancel) w.onTouchCancel(onTouchEnd);\n    } catch (e) {}\n  }\n\n  /* ================================================================ 对外 API */\n  G.__hmUnityBuildUI = function () {\n    ensureCanvas();\n    installTouch();\n    installFrameHook();\n    dirty = true;\n    return true;\n  };\n  G.__hmUnityRefreshUI = function () { dirty = true; };\n  G.__hmUnityToggle = function (toCollapsed) {\n    collapsed = (typeof toCollapsed === 'boolean') ? toCollapsed : !collapsed;\n    dirty = true;\n  };\n  G.__hmUnityUIReady = function () {\n    return !!(off && offCtx && G.__hmUnityLayout);\n  };\n  /* 调试/测试用：返回虚拟坐标下的命中区 */\n  G.__hmUnityHitTest = function (x, y) { return hitTest(x, y); };\n  G.__hmUnityState = function () {\n    return { collapsed: !!collapsed, scrollY: scrollY, hits: hitRegions.length,\n             gl: glReady, title: titleText };\n  };\n  // harvest_adapt.js 会写 G.__hmUnityTitle.textContent\n  G.__hmUnityTitle = {\n    get textContent() { return titleText; },\n    set textContent(v) { titleText = String(v); dirty = true; }\n  };\n\n  /* 记录环境能力，便于诊断 */\n  try {\n    var s0 = sysInfo();\n    SW = s0.windowWidth || VW; SH = s0.windowHeight || VH;\n  } catch (e) {}\n\n  // 自动构建\n  setTimeout(function () {\n    try { G.__hmUnityBuildUI(); } catch (e) {}\n  }, 200);\n})();\n";
  G.__hmModuleSrc["harvest_adapt.js"] = "/* =============================================================================\n * HM「别碰我的菜」适配层 —— HarvestKing (Unity WebGL WASM)\n * -----------------------------------------------------------------------------\n * 游戏档案：\n *   APPID      biligame4c796ed3edca7cdc\n *   引擎       Unity 2022.3.34f1 → WebGL WASM\n *   适配层     blapp-adapter-unity-wasm-split.js（CommonJS 打包产物）\n *   存档       wx.setStorage / wx.getStorageSync，值是明文 JSON\n *              （JSON 字符串套 JSON 串套 JSON，最内层是 .NET Json.NET 格式）\n *\n * 与魔法领域（Laya）的关键差异：\n *   Laya   —— 游戏逻辑在 JS，能直接改 playerInfo / 配置表\n *   Unity  —— 逻辑在 wasm，JS 层看不到任何数值单例\n *            唯一入口是**存档**（明文 JSON）和 **wx 广告 API**\n *\n * 所以本适配层做三件事：\n *   1. 接管 wx 存储 API，在读写瞬间改写存档字段（harvest.js）\n *   2. 接管 wx 广告 API，伪广告对象直接触发 onClose（免广告）\n *   3. 用 HTML 浮层渲染通用面板（unity_ui.js）\n * ========================================================================== */\n\n(function (G) {\n  'use strict';\n  if (!G) return;\n  if (G.__hmHarvestAdapt) return;\n  G.__hmHarvestAdapt = 1;\n\n  /* ------------------------------------------------------------- 默认配置 */\n  /*\n   * 这些值同时写进面板的默认值和存档改写规则。\n   * CFG 存在 G.__hmHarvestCfg 上，harvest.js 读取它。\n   */\n  G.__hmUnitySet = G.__hmUnitySet || {\n    money: 999999,\n    energy: 9999,\n    accountLevel: 999,\n    chapter: 99,\n    soldierLevel: 99,\n    income: 99,\n    adFree: true,\n    revive: 999,\n    sweep: true\n  };\n\n  /* --------------------------------------------------- 写入存档改写配置 */\n\n  /** 把面板上的值同步到存档改写规则 */\n  function syncCfg() {\n    var s = G.__hmUnitySet;\n    var c = G.__hmHarvestCfg;\n    if (!c) return;\n    c.money = s.money;\n    c.energy = s.energy;\n    c.accountLevel = s.accountLevel;\n    c.chapter = s.chapter;\n    c.soldierLevel = s.soldierLevel;\n    c.income = s.income;\n    c.noAds = !!s.adFree;\n    c.on = true;\n  }\n\n  /** 改写一次存档（当前内存里的配置立即生效需要走 sweep） */\n  function applyAll() {\n    syncCfg();\n    var n = 0;\n    try {\n      if (G.__hmHarvestSweep) n = G.__hmHarvestSweep();\n    } catch (e) {}\n    // 重新挂一次广告接管（游戏可能自己重设了）\n    try { if (G.__hmHarvestHookAds) G.__hmHarvestHookAds(); } catch (e) {}\n    try {\n      if (G.__hmUnityTitle) {\n        G.__hmUnityTitle.textContent =\n          'HM 已应用 · 存档改写 ' + n + ' 项';\n      }\n    } catch (e) {}\n    return n;\n  }\n\n  /* --------------------------------------------------------- 面板布局描述 */\n\n  G.__hmUnityLayout = {\n    sections: [\n      {\n        title: '养成数值',\n        rows: [\n          { t: 'num', label: '货币数量', key: 'money',\n            apply: function () { applyAll(); } },\n          { t: 'num', label: '体力上限', key: 'energy',\n            apply: function () { applyAll(); } },\n          { t: 'num', label: '收益倍率', key: 'income',\n            apply: function () { applyAll(); } }\n        ]\n      },\n      {\n        title: '进度解锁',\n        rows: [\n          { t: 'num', label: '账号等级', key: 'accountLevel',\n            apply: function () { applyAll(); } },\n          { t: 'num', label: '章节序号', key: 'chapter',\n            apply: function () { applyAll(); } },\n          { t: 'num', label: '士兵等级', key: 'soldierLevel',\n            apply: function () { applyAll(); } }\n        ]\n      },\n      {\n        title: '功能开关',\n        rows: [\n          { t: 'sw', half: true, label: '免广告', key: 'adFree',\n            onChange: function (on) {\n              syncCfg();\n              if (on) { applyAll(); } else { G.__hmHarvestCfg.on = false; }\n            } },\n          { t: 'sw', half: true, label: '自动改写', key: 'sweep',\n            onChange: function (on) {\n              G.__hmHarvestAuto = on ? 1 : 0;\n            } }\n        ]\n      }\n    ],\n    actions: [\n      { label: '一键应用', fn: function () { applyAll(); } },\n      { label: '重新接管广告', fn: function () {\n          var n = 0;\n          try { n = G.__hmHarvestHookAds ? G.__hmHarvestHookAds() : 0; } catch (e) {}\n          try {\n            G.__hmUnityTitle.textContent = 'HM 已接管 ' + n + ' 个广告入口';\n          } catch (e) {}\n        } }\n    ]\n  };\n\n  /* --------------------------------------------------------- 自动改写轮询 */\n\n  /*\n   * 游戏会定期写存档（切关、领奖、结算都会写）。\n   * 拦截 setStorage 只能保证「写出去的是改过的」，\n   * 但游戏内存里的值还是原值 —— 所以还要在读的时候也改，\n   * 并且定期把内存里的存档重新扫一遍。\n   */\n  G.__hmHarvestAuto = 1;\n  setInterval(function () {\n    try {\n      if (!G.__hmHarvestAuto) return;\n      if (G.__hmHarvestSweep) G.__hmHarvestSweep();\n    } catch (e) {}\n  }, 5000);\n\n  /* 状态行：告诉用户当前识别到的情况 */\n  setTimeout(function () {\n    try {\n      if (!G.__hmUnityTitle) return;\n      var ok = G.__hmHarvestDetected && G.__hmHarvestDetected();\n      G.__hmUnityTitle.textContent = ok\n        ? 'HM 已识别存档'\n        : 'HM 等待存档载入…';\n    } catch (e) {}\n  }, 8000);\n\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n";
})(typeof globalThis !== "undefined" ? globalThis : this);
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
   * 幂等：inj.js 会被注入到多个 context，同一个 context 也可能注入多次。
   * 但这个分发器在守卫**外面**（守卫内会被 __hmw12 拦掉，
   * 导致 Unity 标记到了也加载不了模块），所以要自己防重。
   */
  /*
   * 幂等：inj.js 会被注入到多个 context，同一个 context 也可能注入多次。
   * 但这个分发器在守卫**外面**（守卫内会被 __hmw12 拦掉，
   * 导致 Unity 标记到了也加载不了模块），所以要自己防重。
   *
   * 注意：不能简单用一个「已分发」标志锁死 ——
   * 第一次注入时可能还没拿到 Unity 标记（Unity bundle 尚未编译），
   * 锁死的话后面带着标记的注入就白进了。
   * 所以只在**真正加载完模块**后才置位。
   */
  if (GG.__hmUnityModulesLoaded) return;

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
    try {
      GG.__hmUnityLoaded = 1;
      GG.__hmUnityModulesLoaded = 1;   // 加载完才锁，之后的注入跳过
    } catch (e) {}
  }

  // 轮询：bundle 执行得晚（Unity 要下载编译 wasm），所以要多试几轮
  [0, 200, 600, 1200, 2500, 4000, 6000, 9000, 14000, 20000].forEach(function (ms) {
    setTimeout(function () { try { tryLoad(); } catch (e) {} }, ms);
  });

  /*
   * 诊断：把判定状态写进游戏自己的 files 目录。
   * 用 wx.getFileSystemManager 写 —— 那是宿主提供的落盘通道，
   * 比 console.log 可靠（宿主不一定把 console 转发到 logcat）。
   */
  function probe(tag) {
    try {
      var st = [
        tag,
        'unity=' + (GG.__hmUnity ? 1 : 0),
        'gg=' + (GG.GameGlobal ? 1 : 0),
        'cmge=' + ((GG.GameGlobal && GG.GameGlobal.__cmgeSubpackages) ?
          GG.GameGlobal.__cmgeSubpackages.length : -1),
        'ns=' + ((GG.GameGlobal && GG.GameGlobal.unityNamespace) ? 1 : 0),
        'mgr=' + ((GG.GameGlobal && GG.GameGlobal.manager) ? 1 : 0),
        'bridge=' + ((typeof GG.__hmBridge === 'function') ? 1 : 0),
        'loaded=' + (GG.__hmUnityLoaded ? 1 : 0),
        'mods=' + (GG.__hmModules ? Object.keys(GG.__hmModules).join('|') : ''),
        'err=' + (GG.__hmUnityErr || '')
      ].join(' ');
      var w = GG.wx || (GG.GameGlobal && GG.GameGlobal.wx);
      var wrote = 0;
      if (w && w.getFileSystemManager) {
        // 多路径尝试：沙箱根目录 / 绝对路径
        var paths = ['hm_probe.txt', '/hm_probe.txt',
                     'files/hm_probe.txt',
                     '/data/data/tv.danmaku.bili/files/hm_probe.txt'];
        for (var i = 0; i < paths.length; i++) {
          try {
            w.getFileSystemManager().writeFileSync(paths[i], st);
            wrote++;
          } catch (e) {}
        }
      }
      // 再试 console，多通道总有一个能通
      try { console.log('[HMUnity] ' + st + ' wrote=' + wrote); } catch (e) {}
    } catch (e) {
      try { GG.__hmProbeErr = String(e); } catch (e2) {}
    }
  }
  probe('init');
  setTimeout(function () { probe('t3s'); }, 3000);
  setTimeout(function () { probe('t10s'); }, 10000);
  setTimeout(function () { probe('t20s'); }, 20000);
})();
// ===== /HM UNITY INLINE =====

  if (!G.__hmw12) {
    G.__hmw12 = 1;

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
} catch (e) {
  /*
   * 顶层异常原来被静默吞掉，调试时完全看不到线索。
   * 现在把错误挂到 globalThis 上 —— native 层能从 ctx 里读到，
   * 也方便在宿主里用 console 查。
   */
  try {
    var GE = (typeof globalThis !== 'undefined') ? globalThis : this;
    GE.__hmTopError = String((e && e.stack) ? e.stack : e);
  } catch (e2) {}
}
