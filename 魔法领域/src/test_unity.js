/* Unity 模式端到端测试：
 * 模拟宿主的 DOM + wx 存储 + 广告 API，
 * 跑完整的运行时脚本，验证：
 *   1) Unity 引擎判定 → 只有 Unity 模块被加载
 *   2) 存档改写生效（读写都改）
 *   3) 广告接管生效且 onClose 真的会触发
 *   4) HTML 面板能构建出来，元素齐全
 */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 迷你 DOM
class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.classList = {
      _s: new Set(),
      add: (c) => this.classList._s.add(c),
      remove: (c) => this.classList._s.delete(c),
      contains: (c) => this.classList._s.has(c),
    };
    this._text = '';
    this._listeners = {};
    this.id = '';
  }
  set className(v) {
    this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() { return [...this.classList._s].join(' '); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    if (this.children.length) return this.children.map(c => c.textContent).join('');
    return this._text;
  }
  set innerHTML(v) { if (v === '') this.children = []; }
  get innerHTML() { return ''; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
  dispatch(ev, arg) {
    const hs = this._listeners[ev] || [];
    for (const h of hs) h.call(this, arg || { preventDefault() {} });
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 750, height: 1334 }; }
  setPointerCapture() {}
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (sel === 'button' && c.tagName === 'button') out.push(c);
        if (sel === 'input' && c.tagName === 'input') out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  walk(fn) { fn(this); for (const c of this.children) c.walk(fn); }
}

const body = new El('body');
const head = new El('head');
const doc = {
  body, head, documentElement: head,
  createElement: (t) => new El(t),
  getElementById: (id) => {
    let found = null;
    const walk = (n) => {
      if (n.id === id) { found = n; return; }
      for (const c of n.children) walk(c);
    };
    walk(head); walk(body);
    return found;
  },
  addEventListener() {},
};

// ------------------------------------------------------------- 迷你 wx 存储
const store = {};
let adCloseFired = 0;

globalThis.wx = {
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  setStorage: (o) => { store[o.key] = o.data; if (o.success) o.success({}); if (o.complete) o.complete(); },
  getStorage: (o) => { const d = (o.key in store ? store[o.key] : ''); if (o.success) o.success({ data: d }); },
  getStorageInfoSync: () => ({ keys: Object.keys(store) }),
  createRewardedVideoAd: function () {
    return {
      show: () => Promise.resolve(1),
      onClose(cb) { this._cb = cb; },
      offClose() {},
      onLoad() {}, offLoad() {}, onError() {}, offError() {}, destroy() {},
    };
  },
  createBannerAd: function () { return { show: () => Promise.resolve(1), onClose() {}, onLoad() {}, offLoad() {}, onError() {}, offError() {}, destroy() {} }; },
  createInterstitialAd: function () { return { show: () => Promise.resolve(1), onClose() {}, onLoad() {}, offLoad() {}, onError() {}, offError() {}, destroy() {} }; },
};

globalThis.document = doc;
globalThis.innerWidth = 750;
globalThis.innerHeight = 1334;
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
};

// --------------------------------------------------------- 模拟 Unity 环境
globalThis.__hmUnity = 1;
globalThis.GameGlobal = { __cmgeSubpackages: ['wasmcode', 'data-package'] };

// ---------------------------------------------------------- 跑运行时脚本
const runtime = fs.readFileSync(path.join(__dirname, 'nativelib/hm_runtime.js'), 'utf8');
eval(runtime);

const HM = globalThis;

/*
 * 分发器现在是**延迟**判定（轮询等 Unity 特征出现），
 * 所以这里必须等它加载完，不能同步往下跑。
 */
function waitForUnity(cb, timeoutMs) {
  const t0 = Date.now();
  (function poll() {
    if (HM.__hmModules && HM.__hmModules['harvest.js']) return cb(true);
    if (Date.now() - t0 > (timeoutMs || 8000)) return cb(false);
    setTimeout(poll, 50);
  })();
}

waitForUnity(function (loaded) {
console.log('=== 1. Unity 引擎判定 ===');
console.log('异步加载完成    :', loaded ? '是 ✓' : '否 ✗ (超时)');
console.log('Unity 模块已加载  :', HM.__hmModules ? Object.keys(HM.__hmModules).join(', ') : '(无)');
console.log('存档改写模块      :', HM.__hmHarvest ? '是 ✓' : '否 ✗');
console.log('Unity 面板模块    :', HM.__hmUnityUI ? '是 ✓' : '否 ✗');
console.log('适配层            :', HM.__hmHarvestAdapt ? '是 ✓' : '否 ✗');
console.log('Unity 异常        :', HM.__hmUnityErr || '(无) ✓');

console.log('\n=== 2. 存档改写 ===');
const raw = fs.readFileSync(path.join(__dirname, 'save1.bin'), 'utf8');
store['LocalGameData497642846'] = raw;

// 显式挂 hook（boot 由定时器触发）
console.log('存储钩子数        :', HM.__hmHarvestHookStorage());
console.log('广告接管数        :', HM.__hmHarvestHookAds());

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

const rd = readInner(HM.wx.getStorageSync('LocalGameData497642846'));
console.log('读取时改写        :', rd.currency.currencies.$values[0].amount === 999999 ? '是 ✓' : '否 ✗');
console.log('  货币            :', rd.currency.currencies.$values.map(c => c.amount).join(', '));
console.log('  体力            :', rd.energyStorage.mainEnergy.currentEnergy);
console.log('  免广告          :', rd.advertisement.isNoAdsPurchased);

HM.wx.setStorageSync('t2', raw);
const wr = readInner(store['t2']);
console.log('写入时改写        :', wr.currency.currencies.$values[0].amount === 999999 ? '是 ✓' : '否 ✗');

console.log('\n=== 3. 广告接管 ===');
const ad = globalThis.wx.createRewardedVideoAd({ adUnitId: 'x' });
let closed = null;
ad.onClose((r) => { closed = r; adCloseFired++; });
ad.show().then(() => {
  setTimeout(() => {
    console.log('onClose 触发      :', closed ? '是 ✓ ' + JSON.stringify(closed) : '否 ✗');

    console.log('\n=== 4. HTML 面板 ===');
    HM.__hmUnityTryBuild();
    console.log('面板已构建        :', HM.__hmUnityUIReady() ? '是 ✓' : '否 ✗');

    let btns = [], inputs = [], labels = [], segs = [], switches = [];
    body.walk((n) => {
      if (n.tagName === 'button') btns.push(n);
      if (n.tagName === 'input') inputs.push(n);
      if (n.classList.contains('hm-label')) labels.push(n);
      if (n.classList.contains('hm-seg')) segs.push(n);
      if (n.classList.contains('hm-switch')) switches.push(n);
    });
    console.log('按钮数            :', btns.length);
    console.log('输入框数          :', inputs.length);
    console.log('标签数            :', labels.length);
    console.log('挡位按钮数        :', segs.length);
    console.log('开关数            :', switches.length);
    console.log('样式表已注入      :', HM.document.getElementById('hm-unity-style') ? '是 ✓' : '否 ✗');

    console.log('\n=== 5. 交互 ===');
    // 找一个「应用」按钮并点击
    const applyBtn = btns.find(b => b.textContent === '应用');
    if (applyBtn && inputs.length) {
      inputs[0].value = '777777';
      applyBtn.dispatch('click');
      const d2 = readInner(store['t2'] || HM.wx.getStorageSync('LocalGameData497642846'));
      console.log('点击应用后货币    :', d2.currency.currencies.$values[0].amount, '(应为 777777)');
      console.log('配置已同步        :', HM.__hmUnitySet.money === 777777 ? '是 ✓' : '否 ✗');
    }
    // 开关切换
    if (switches.length) {
      const before = HM.__hmUnitySet.adFree;
      switches[0].dispatch('click');
      console.log('开关切换          :', HM.__hmUnitySet.adFree !== before ? '是 ✓' : '否 ✗');
    }
    // 一键应用
    const oneKey = btns.find(b => b.textContent === '一键应用');
    if (oneKey) {
      oneKey.dispatch('click');
      console.log('一键应用可用      : 是 ✓');
    }

    console.log('\n=== 6. 折叠/展开 ===');
    HM.__hmUnityToggle(false);
    let panel = null;
    body.walk((n) => { if (!panel && n.classList.contains('hm-panel')) panel = n; });
    console.log('展开后 display    :', panel && panel.style.display === 'flex' ? '是 ✓' : '否 ✗');
    HM.__hmUnityToggle(true);
    console.log('折叠后 display    :', panel && panel.style.display === 'none' ? '是 ✓' : '否 ✗');

    process.exit(0);
  }, 100);
});
});
