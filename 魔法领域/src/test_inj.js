// 本地 dry-run：用最小 Laya mock 验证 BFS 能否抓到 g.playerInfo
const fs = require('fs');

class Node {
  constructor(name) { this.name = name; this._children = []; this._components = []; this.parent = null; }
  get numChildren() { return this._children.length; }
  getChildAt(i) { return this._children[i]; }
  addChild(c) { c.parent = this; this._children.push(c); return c; }
  removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); c.parent = null; return c; }
}

// 游戏数据单例 g
const g = { playerInfo: { outDiamondNum: 11799, name: 'x', level: 3 }, bag: {}, cfg: {} };
// 逻辑组件：模拟挂在节点上的 Script，持有 g
class GameScript { constructor() { this.gameData = g; this.data = { root: g }; } }
// 视图类 Ye
class Ye {
  constructor() { this.lab_goldNum = null; }
  refreshUI() { this.lab_goldNum.text = String(g.playerInfo.outDiamondNum); }
}

const stage = new Node('Stage');
const scene = stage.addChild(new Node('Scene'));
const panel = scene.addChild(new Node('Panel'));
const box = panel.addChild(new Node('Box'));
const ye = new Ye();
const holder = box.addChild(new Node('DiamondBar'));
ye.lab_goldNum = holder.addChild(new Node('lab_goldNum'));
holder._components.push(new GameScript());
// 让 lab_goldNum 的父链能拿到 refreshUI：把 refreshUI 方法挂到 holder 上
holder.refreshUI = ye.refreshUI.bind(ye);

globalThis.Laya = { stage };
// 模拟 native 层改写源码后暴露的两个单例
globalThis.__hmg = g;
const N = parseInt(process.env.VIPN || '11', 10);
globalThis.__hma = {
  vipCfg: Array.from({ length: N }, (_, i) => ({ vipLv: i, vipExp: 100 * i })),
  roleUpgradeCfg: Array.from({ length: 30 }, (_, i) => ({ lv: i + 1, fragment: 10 * (i + 1) })),
  hero_upCost: Array.from({ length: 60 }, (_, i) => ({ level: i + 1, slice: 5 }))
};
globalThis.__hmgg = {
  platform: {
    config: { videoId: 'x' },
    playVideo: function (n) { return Promise.resolve(0); },
    playVideo_pre: function () { return false; }
  }
};
g.playerInfo.outCampInfo = [
  { roleId: 1, level: 3, skinLv: 0 },
  { roleId: 2, level: 7, skinLv: 1 }
];

const js = fs.readFileSync('nativelib/inj.js', 'utf8');
eval(js);

setTimeout(() => {
  globalThis.__hmdump();
  const b = globalThis.__hmt;
  let s = '';
  for (let i = 0; i < b.length && b[i]; i++) s += String.fromCharCode(b[i]);
  const body = s.slice(5);
  console.log(JSON.stringify(JSON.parse(decodeURIComponent(body)), null, 1));
  process.exit(0);
}, 100);
