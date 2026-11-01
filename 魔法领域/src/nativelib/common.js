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
