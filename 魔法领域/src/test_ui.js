// 专项验证：连续多轮 __hmdump 之后，stage 上 hmBody / hmMini 只能各有一个
const fs = require('fs');

class LSprite {
  constructor() {
    this.name = '';
    this._children = [];
    this.visible = true;
    this.x = 0; this.y = 0; this.width = 0; this.height = 0;
    this.graphics = { drawRect() {}, drawCircle() {}, clear() {} };
    this.parent = null;
    this.zOrder = 0;
    this.mouseEnabled = false;
  }
  size(w, h) { this.width = w; this.height = h; }
  pos(x, y) { this.x = x; this.y = y; }
  on() {}
  addChild(c) { this._children.push(c); c.parent = this; return c; }
  removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; }
  get numChildren() { return this._children.length; }
  getChildAt(i) { return this._children[i]; }
  getChildByName(n) { for (const c of this._children) if (c.name === n) return c; return null; }
}
class LText extends LSprite {
  constructor() { super(); this.text = ''; this.fontSize = 12; this.color = '#000'; }
}

const g = { playerInfo: {
  outDiamondNum: 11799, woodNum: 1, stoneNum: 1, pvpCoin: 1, godStone: 1,
  outExpNum: 1, pvpTicket: 1, freeVideoNum: 1, freeChangeNum: 1, vipLv: 0,
  power: 3, godLevel_big: 0, godLevel_small: 0, godExp: 0,
  campCoinNum: [0, 0, 0, 0, 0],
  outCampInfo: [{ roleId: 1, level: 3 }],
  outHeroList: [
    { id: 901, level: 1, isUnlock: true, talentList: [[10101, 1], [10102, 1]], equipSkillList: [99999] },
    { id: 902, level: 1, isUnlock: false, talentList: [[10103, 1]], equipSkillList: [] }
  ]
} };

const stage = new LSprite();
stage.width = 750;
stage.height = 1334;
stage.height = 1334;

class LInput extends LSprite {
  constructor() { super(); this.text = ''; this.fontSize = 14; this.bgColor = ''; this.borderColor = ''; this.padding = ''; this.type = ''; }
}
class LPanel extends LSprite {
  constructor() { super(); this.vScrollBarSkin = ''; }
}
globalThis.Laya = { stage, Sprite: LSprite, Text: LText, TextInput: LInput, Panel: LPanel, timer: { scale: 1 } };
globalThis.__hmg = g;
globalThis.__hma = {
  vipCfg: Array.from({ length: 11 }, (_, i) => ({ vipLv: i })),
  roleUpgradeCfg: Array.from({ length: 30 }, (_, i) => ({ lv: i + 1 })),
  hero_upCost: Array.from({ length: 60 }, (_, i) => ({ level: i + 1 })),
  powerCfg: { max: 120, consume: 6, value: 1, cd: 5 },
  gameSpeed_normal: 1.31,
  gameSpeed_double: 1.62
};
// 战斗数据
g.playerInfo.battleSave = {
  goldNow: 0,
  roleLimitNum: 6,
  heroSaveInfo: { mp_now: 30, mp_max: 30, atk: 12, def: 8, str: 8, int: 8 }
};
const ally = { teamId: 0, life_per: 100, life_max: 300, life_now: 200, roleNum: 2, roleNum_init: 3 };
const foe = { teamId: 1, life_per: 100, life_max: 300, life_now: 300, roleNum: 3, roleNum_init: 3 };
const battleNode = new LSprite();
battleNode._components = [ally, foe];
stage.addChild(battleNode);
globalThis.__ally = ally;
globalThis.__foe = foe;

globalThis.__hmgg = {
  platform: {
    config: { videoId: 'x' },
    playVideo: () => Promise.resolve(0),
    playVideo_pre: () => false
  }
};

eval(fs.readFileSync('nativelib/inj.js', 'utf8'));

function count(name) {
  let n = 0;
  for (let i = 0; i < stage.numChildren; i++) if (stage.getChildAt(i).name === name) n++;
  return n;
}

setTimeout(() => {
  const trace = [];
  for (let round = 1; round <= 6; round++) {
    globalThis.__hmdump();
    trace.push(`round${round}: body=${count('hmBody')} mini=${count('hmMini')}`);
  }
  console.log(trace.join('\n'));
  const P = g.playerInfo;
  console.log('--- 新字段实测 ---');
  console.log('power   =', P.power, '/ max', globalThis.__hma.powerCfg.max);
  console.log('god     =', P.godLevel_big + '.' + P.godLevel_small);
  console.log('campCoin=', P.campCoinNum.join(','));
  console.log('heroLv  =', P.outHeroList.map(x => x.level).join(','), 'max', globalThis.__hmHeroMax);
  console.log('heroAtk =', P.outHeroList.map(x => x.atk + '/' + x.def + '/' + x.str + '/' + x.int).join(' | '));
  console.log('talent  =', JSON.stringify(P.outHeroList.map(x => x.talentList)));
  globalThis.__hmBattle();
  const A = globalThis.__ally, F = globalThis.__foe;
  console.log('--- 战斗 ---');
  console.log('gold    =', P.battleSave.goldNow, '| limit =', P.battleSave.roleLimitNum);
  console.log('hero    = atk', P.battleSave.heroSaveInfo.atk, 'mp', P.battleSave.heroSaveInfo.mp_now + '/' + P.battleSave.heroSaveInfo.mp_max);
  console.log('ally    = life_now', A.life_now, '/', A.life_max, '| life_per', A.life_per, '| roleNum', A.roleNum);
  console.log('foe     = life_now', F.life_now, '/', F.life_max, '| life_per', F.life_per, '(应保持 100 不变)');
  console.log('--- 倍速 ---');
  globalThis.__hmApplySpeed();
  console.log('speed   =', globalThis.__hma.gameSpeed_normal, '/', globalThis.__hma.gameSpeed_double, '| Laya.timer.scale =', globalThis.Laya.timer.scale);
  console.log('spdFlag =', g.playerInfo.setting_doubleSpd);
  console.log('heroUnlock =', P.outHeroList.filter(x => x.isUnlock).length, '/', P.outHeroList.length);
  console.log('godExp  =', P.godExp, '| devilProp =', P.devilProp, '| pvpScore =', P.pvpScore);
  console.log('vip =', P.vipLv, '| wood =', P.woodNum, '| stone =', P.stoneNum);

  // 塌掉一个，模拟被场景切换清掉一半，看能否自愈
  const body = stage.getChildByName('hmBody');
  if (body) stage.removeChild(body);
  globalThis.__hmdump();
  console.log('after remove body:', `body=${count('hmBody')} mini=${count('hmMini')}`);

  // 人为塞两个重复，看是否会被清掉
  stage.addChild(Object.assign(new LSprite(), { name: 'hmBody' }));
  stage.addChild(Object.assign(new LSprite(), { name: 'hmBody' }));
  console.log('before purge: body =', count('hmBody'));
  globalThis.__hmdump();
  console.log('after purge : body =', count('hmBody'));

  console.log('ad hook:', globalThis.__hmgg.platform.playVideo_pre(), typeof globalThis.__hmgg.platform.playVideo);
  globalThis.__hmgg.platform.playVideo('x').then(v => {
    console.log('playVideo resolves to', v);
    process.exit(0);
  });
}, 50);
