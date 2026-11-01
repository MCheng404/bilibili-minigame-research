// 通用模式专项测试：未适配游戏的基础去广告 + 模式自适应
const fs = require('fs');
const path = require('path');

// ---------- mock ----------
class LSprite {
  constructor() {
    this._children = []; this._handlers = {};
    this.x = 0; this.y = 0; this.width = 0; this.height = 0;
    this.name = ''; this.mouseEnabled = false; this.parent = null;
    const self = this;
    this.graphics = {
      drawRect() {}, drawCircle() {}, drawPath() {}, clear() {}
    };
  }
  size(w, h) { this.width = w; this.height = h; return this; }
  pos(x, y) { this.x = x; this.y = y; return this; }
  addChild(c) { c.parent = this; this._children.push(c); return c; }
  removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); c.parent = null; return c; }
  get numChildren() { return this._children.length; }
  getChildAt(i) { return this._children[i]; }
  getChildByName(n) { for (const c of this._children) if (c.name === n) return c; return null; }
  on(ev, caller, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); return this; }
  emit(ev, arg) { const hs = this._handlers[ev]; if (hs) for (const h of hs) h.call(this, arg || {}); }
}
class LText extends LSprite { constructor() { super(); this.text = ''; this.fontSize = 14; this.color = '#fff'; } }
class LInput extends LSprite { constructor() { super(); this.text = ''; this.fontSize = 22; this.bgColor = ''; this.borderColor = ''; this.padding = ''; this.type = ''; this.align = ''; } }
class LPanel extends LSprite { constructor() { super(); this.vScrollBarSkin = ''; } }

const stage = new LSprite();
stage.width = 750; stage.height = 1334;
globalThis.Laya = { stage, Sprite: LSprite, Text: LText, TextInput: LInput, Panel: LPanel, timer: { scale: 1 } };

// ---------- 模拟一个「未适配」的小游戏环境 ----------
// 平台对象在模块闭包里，只能通过 native 层的 __hmBridge 桥接拿到
const innerPlatform = {
  playVideo: function (name) { return Promise.resolve(0); },
  playVideo_pre: function () { return false; },
  config: { videoId: 'abc' }
};
globalThis.__hmBridge = function () {
  return { gg: { platform: innerPlatform } };
};
// globalThis 上还有标准广告 API
globalThis.wx = {
  createRewardedVideoAd: function () {
    return { show: function () { return Promise.reject('no ad'); }, destroy() {} };
  }
};
let scanned = 0;
globalThis.tt = {
  createInterstitialAd: function () { scanned++; return { show: () => Promise.resolve(1) }; }
};

let src = fs.readFileSync(path.join(__dirname, 'nativelib/inj.js'), 'utf8');
src = src.replace(/\} catch \(e\) \{\}\s*$/, '} catch (e) { globalThis.__hmErr = (e && e.stack) ? e.stack : String(e); }');
eval(src);
if (globalThis.__hmErr) { console.log('探针异常:\n' + globalThis.__hmErr); process.exit(1); }

const GM = globalThis;

// ---------- 1. 通用模式判定 ----------
console.log('模式            :', GM.__hmMode, GM.__hmMode === 'common' ? '✓ 通用' : '✗');
console.log('是否已适配      :', GM.__hmIsAdapted() ? '是' : '否（正确，未适配）');

// ---------- 2. 桥接接管平台对象的 playVideo ----------
console.log('\n--- 桥接接管 ---');
GM.__hmHookAds();
console.log('playVideo_pre   :', innerPlatform.playVideo_pre(), '(应为 true)');
innerPlatform.playVideo('测试').then(e => {
  console.log('playVideo 结果  :', e, '(应为 1，表示"看完广告")');
  return null;
}).then(() => {
  // ---------- 3. globalThis 扫描接管标准广告 API ----------
  console.log('\n--- 全局扫描接管 ---');
  console.log('__hmAdN(接管数) :', GM.__hmAdN);
  const wxAd = globalThis.wx.createRewardedVideoAd();
  console.log('wx 视频广告对象  :', wxAd.__hm ? '已被接管 ✓' : '未接管 ✗');
  wxAd.show().then(v => console.log('wx ad.show()     :', v, '(应为 1)'));
  globalThis.tt.createInterstitialAd();
  console.log('tt 插屏广告      :', scanned === 0 ? '已被接管 ✓' : '未接管 ✗');

  // ---------- 4. 通用布局 ----------
  console.log('\n--- 通用布局 ---');
  const layout = GM.__hmBuildLayout();
  console.log('分组            :', layout.sections.map(s => s.title).join(', '));
  console.log('行              :', layout.sections[0].rows.map(r => r.label + '(' + r.t + ')').join(', '));
  console.log('底部按钮        :', layout.actions.map(a => a.label).join(', '));

  // ---------- 5. 面板构建（通用模式） ----------
  for (const c of stage._children.slice()) {
    if (c.name === 'hmBody' || c.name === 'hmMini') stage.removeChild(c);
  }
  GM.__hmCollapsed = false;
  const body = GM.__hmUI();
  const texts = [];
  (function walk(n) { if (n.text) texts.push(n.text); for (const c of n._children) walk(c); })(body);
  console.log('面板文本        :', texts.join(' | '));
  console.log('含数值输入框    :', texts.some(t => t === '应用') ? '是 ✗ 通用模式不该有数值项' : '否 ✓');

  // ---------- 6. 切到适配模式 ----------
  console.log('\n--- 模式切换 ---');
  globalThis.__hmg = { playerInfo: { outDiamondNum: 1, vipLv: 0 } };
  const changed = GM.__hmApplyMode();
  console.log('检测到切换      :', changed ? '✓' : '✗');
  console.log('新模式          :', GM.__hmMode, GM.__hmMode === 'adapted' ? '✓' : '✗');
  const l2 = GM.__hmBuildLayout();
  console.log('适配模式分组    :', l2.sections.map(s => s.title).join(', '));

  process.exit(0);
});
