/* 存档改写模块的往返测试：用真实存档验证解包/改写/重打包 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'nativelib/harvest.js'), 'utf8');

// 模拟 wx 存储
const store = {};
globalThis.wx = {
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  setStorage: (o) => { store[o.key] = o.data; if (o.success) o.success({}); },
  getStorage: (o) => { const d = (o.key in store ? store[o.key] : ''); if (o.success) o.success({ data: d }); },
  getStorageInfoSync: () => ({ keys: Object.keys(store) }),
  createRewardedVideoAd: function () { return { show: () => Promise.resolve(1), onClose() {} }; },
  createBannerAd: function () { return { show: () => Promise.resolve(1), onClose() {} }; },
  createInterstitialAd: function () { return { show: () => Promise.resolve(1), onClose() {} }; },
};

eval(src);

const raw = fs.readFileSync(path.join(__dirname, 'save1.bin'), 'utf8');
const HM = globalThis;

console.log('=== 解包检测 ===');
store['LocalGameData497642846'] = raw;
const u = (function () {
  const v = HM.wx.getStorageSync('LocalGameData497642846');
  return v;
})();
console.log('读回长度      :', u.length, '(应为', raw.length, ')');
console.log('检测到存档    :', HM.__hmHarvestDetected() ? '是 ✓' : '否 ✗');

console.log('\n=== 改写往返 ===');
const patched = HM.__hmHarvestPatch(raw);
console.log('原始长度      :', raw.length);
console.log('改写后长度    :', patched.length);

function readInner(v) {
  let cur = v;
  for (let i = 0; i < 4; i++) {
    let n;
    try { n = JSON.parse(cur); } catch (e) { break; }
    if (typeof n === 'string') { cur = n; continue; }
    return JSON.parse(n.StringStorage.Save_Data);
  }
  return null;
}
const d = readInner(patched);
console.log('\n=== 改写后的关键字段 ===');
console.log('  货币        :', d.currency.currencies.$values.map(c => c.amount).join(', '));
console.log('  收益倍率    :', d.currency.incomeMultiplier);
console.log('  主体力      :', d.energyStorage.mainEnergy.currentEnergy);
console.log('  模式体力    :', d.energyStorage.modesEnergy.currentEnergy);
console.log('  账号等级    :', d.accountLevel.currentLevel);
console.log('  免广告      :', d.advertisement.isNoAdsPurchased);
console.log('  当前章节    :', d.chapters.currentChapterIndex);
console.log('  无尽章节    :', d.chapters.endlessChapterIndex);
console.log('  士兵等级    :', d.soldier._saves.$values.map(s => s.level).join(', '));
console.log('  士兵解锁数  :', d.soldier._unlockeds.$values.length);
console.log('  局内金币    :', d.levelProgress.PlayerMoney);
console.log('  复活次数    :', d.levelProgress.ReviveCount);
console.log('  失败计数    :', d.dynamicDifficulty.failCount);
console.log('  宝箱已用    :', d.chestBonus.usedToday);
console.log('  通行证等级  :', d.battlePass.currentLevel, '| 高级已购', d.battlePass.isPremiumPurchased);
console.log('  花园解锁    :', d.garden.isFeatureUnlocked);
console.log('  遗物解锁    :', d.artifacts.isActive);

console.log('\n=== 幂等性（改两次结果一致）===');
const p2 = HM.__hmHarvestPatch(patched);
const d2 = readInner(p2);
const same = JSON.stringify(d) === JSON.stringify(d2);
console.log('两次改写一致  :', same ? '是 ✓' : '否 ✗');

console.log('\n=== 挂上拦截（boot 由定时器触发，这里显式调用）===');
console.log('存储钩子数    :', HM.__hmHarvestHookStorage());

console.log('\n=== 拦截写入生效 ===');
store['t1'] = 'not-a-save';
const before = store['t1'];
HM.wx.setStorageSync('t2', raw);
const w = readInner(store['t2']);
console.log('非存档值透传  :', store['t1'] === before ? '是 ✓' : '否 ✗');
console.log('存档写入改写  :', w.currency.currencies.$values[0].amount === 999999 ? '是 ✓' : '否 ✗');
console.log('  写入后货币  :', w.currency.currencies.$values.map(c => c.amount).join(', '));

console.log('\n=== 拦截读取生效 ===');
const rd = HM.wx.getStorageSync('t2');
const rdi = readInner(rd);
console.log('读取时改写    :', rdi.currency.currencies.$values[0].amount === 999999 ? '是 ✓' : '否 ✗');

console.log('\n=== 广告接管 ===');
console.log('接管数量      :', HM.__hmHarvestHookAds());
const ad = globalThis.wx.createRewardedVideoAd({ adUnitId: 'x' });
let closed = null;
ad.onClose((r) => { closed = r; });
console.log('伪广告有onClose:', typeof ad.onClose === 'function' ? '是 ✓' : '否 ✗');
ad.show().then(() => {
  setTimeout(() => {
    console.log('onClose 触发  :', closed ? '是 ✓ (' + JSON.stringify(closed) + ')' : '否 ✗');
    process.exit(0);
  }, 80);
});
