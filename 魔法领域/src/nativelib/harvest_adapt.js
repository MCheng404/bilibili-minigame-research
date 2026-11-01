/* =============================================================================
 * HM「别碰我的菜」适配层 —— HarvestKing (Unity WebGL WASM)
 * -----------------------------------------------------------------------------
 * 游戏档案：
 *   APPID      biligame4c796ed3edca7cdc
 *   引擎       Unity 2022.3.34f1 → WebGL WASM
 *   适配层     blapp-adapter-unity-wasm-split.js（CommonJS 打包产物）
 *   存档       wx.setStorage / wx.getStorageSync，值是明文 JSON
 *              （JSON 字符串套 JSON 串套 JSON，最内层是 .NET Json.NET 格式）
 *
 * 与魔法领域（Laya）的关键差异：
 *   Laya   —— 游戏逻辑在 JS，能直接改 playerInfo / 配置表
 *   Unity  —— 逻辑在 wasm，JS 层看不到任何数值单例
 *            唯一入口是**存档**（明文 JSON）和 **wx 广告 API**
 *
 * 所以本适配层做三件事：
 *   1. 接管 wx 存储 API，在读写瞬间改写存档字段（harvest.js）
 *   2. 接管 wx 广告 API，伪广告对象直接触发 onClose（免广告）
 *   3. 用 HTML 浮层渲染通用面板（unity_ui.js）
 * ========================================================================== */

(function (G) {
  'use strict';
  if (!G) return;
  if (G.__hmHarvestAdapt) return;
  G.__hmHarvestAdapt = 1;

  /* ------------------------------------------------------------- 默认配置 */
  /*
   * 这些值同时写进面板的默认值和存档改写规则。
   * CFG 存在 G.__hmHarvestCfg 上，harvest.js 读取它。
   */
  G.__hmUnitySet = G.__hmUnitySet || {
    money: 999999,
    energy: 9999,
    accountLevel: 999,
    chapter: 99,
    soldierLevel: 99,
    income: 99,
    adFree: true,
    revive: 999,
    sweep: true
  };

  /* --------------------------------------------------- 写入存档改写配置 */

  /** 把面板上的值同步到存档改写规则 */
  function syncCfg() {
    var s = G.__hmUnitySet;
    var c = G.__hmHarvestCfg;
    if (!c) return;
    c.money = s.money;
    c.energy = s.energy;
    c.accountLevel = s.accountLevel;
    c.chapter = s.chapter;
    c.soldierLevel = s.soldierLevel;
    c.income = s.income;
    c.noAds = !!s.adFree;
    c.on = true;
  }

  /** 改写一次存档（当前内存里的配置立即生效需要走 sweep） */
  function applyAll() {
    syncCfg();
    var n = 0;
    try {
      if (G.__hmHarvestSweep) n = G.__hmHarvestSweep();
    } catch (e) {}
    // 重新挂一次广告接管（游戏可能自己重设了）
    try { if (G.__hmHarvestHookAds) G.__hmHarvestHookAds(); } catch (e) {}
    try {
      if (G.__hmUnityTitle) {
        G.__hmUnityTitle.textContent =
          'HM 已应用 · 存档改写 ' + n + ' 项';
      }
    } catch (e) {}
    return n;
  }

  /* --------------------------------------------------------- 面板布局描述 */

  G.__hmUnityLayout = {
    sections: [
      {
        title: '养成数值',
        rows: [
          { t: 'num', label: '货币数量', key: 'money',
            apply: function () { applyAll(); } },
          { t: 'num', label: '体力上限', key: 'energy',
            apply: function () { applyAll(); } },
          { t: 'num', label: '收益倍率', key: 'income',
            apply: function () { applyAll(); } }
        ]
      },
      {
        title: '进度解锁',
        rows: [
          { t: 'num', label: '账号等级', key: 'accountLevel',
            apply: function () { applyAll(); } },
          { t: 'num', label: '章节序号', key: 'chapter',
            apply: function () { applyAll(); } },
          { t: 'num', label: '士兵等级', key: 'soldierLevel',
            apply: function () { applyAll(); } }
        ]
      },
      {
        title: '功能开关',
        rows: [
          { t: 'sw', half: true, label: '免广告', key: 'adFree',
            onChange: function (on) {
              syncCfg();
              if (on) { applyAll(); } else { G.__hmHarvestCfg.on = false; }
            } },
          { t: 'sw', half: true, label: '自动改写', key: 'sweep',
            onChange: function (on) {
              G.__hmHarvestAuto = on ? 1 : 0;
            } }
        ]
      }
    ],
    actions: [
      { label: '一键应用', fn: function () { applyAll(); } },
      { label: '重新接管广告', fn: function () {
          var n = 0;
          try { n = G.__hmHarvestHookAds ? G.__hmHarvestHookAds() : 0; } catch (e) {}
          try {
            G.__hmUnityTitle.textContent = 'HM 已接管 ' + n + ' 个广告入口';
          } catch (e) {}
        } }
    ]
  };

  /* --------------------------------------------------------- 自动改写轮询 */

  /*
   * 游戏会定期写存档（切关、领奖、结算都会写）。
   * 拦截 setStorage 只能保证「写出去的是改过的」，
   * 但游戏内存里的值还是原值 —— 所以还要在读的时候也改，
   * 并且定期把内存里的存档重新扫一遍。
   */
  G.__hmHarvestAuto = 1;
  setInterval(function () {
    try {
      if (!G.__hmHarvestAuto) return;
      if (G.__hmHarvestSweep) G.__hmHarvestSweep();
    } catch (e) {}
  }, 5000);

  /* 状态行：告诉用户当前识别到的情况 */
  setTimeout(function () {
    try {
      if (!G.__hmUnityTitle) return;
      var ok = G.__hmHarvestDetected && G.__hmHarvestDetected();
      G.__hmUnityTitle.textContent = ok
        ? 'HM 已识别存档'
        : 'HM 等待存档载入…';
    } catch (e) {}
  }, 8000);

})(typeof globalThis !== 'undefined' ? globalThis : this);
