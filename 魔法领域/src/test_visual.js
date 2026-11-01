// 悬浮面板视觉专项测试：几何排版 + 圆角路径 + 悬浮态重绘
const fs = require('fs');
const path = require('path');

// ---------- 记录绘制调用的 mock ----------
const calls = [];
function rec(kind, args) { calls.push({ kind, args, stack: new Error().stack }); }

class LSprite {
  constructor() {
    this._children = [];
    this._handlers = {};
    this.x = 0; this.y = 0; this.width = 0; this.height = 0;
    this.name = '';
    this.mouseEnabled = false;
    this.graphics = {
      drawRect: (...a) => rec('rect', a),
      drawCircle: (...a) => rec('circle', a),
      drawPath: (...a) => rec('path', a),
      clear: () => {}
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
class LText extends LSprite {
  constructor() { super(); this.text = ''; this.fontSize = 14; this.color = '#fff'; }
}
class LInput extends LSprite {
  constructor() { super(); this.text = ''; this.fontSize = 14; this.bgColor = ''; this.borderColor = ''; this.padding = ''; this.type = ''; this.align = ''; this.valign = ''; }
}
class LPanel extends LSprite { constructor() { super(); this.vScrollBarSkin = ''; } }

const stage = new LSprite();
stage.width = 750; stage.height = 1334;

globalThis.Laya = { stage, Sprite: LSprite, Text: LText, TextInput: LInput, Panel: LPanel, timer: { scale: 1 } };

// ---------- 加载探针（剥掉外层 try/catch 的包裹，直接 eval 主体） ----------
let src = fs.readFileSync(path.join(__dirname, 'nativelib/inj.js'), 'utf8');
// 探针是 `try { ... } catch(e) {}` 结构，剥掉最外层 try
src = src.replace(/^\s*try\s*\{/, 'try {');
const wrapped = src;
globalThis.__hmRes = (function () {
  try { eval(wrapped); } catch (e) { return 'EVAL_ERR: ' + e.message; }
  return 'ok';
})();
if (globalThis.__hmRes !== 'ok') { console.log(globalThis.__hmRes); process.exit(1); }

const G = globalThis;
console.log('drawPath 支持 :', G.__hmHasPath ? '是（圆角生效）' : '否（降级为直角）');

// ---------- 面板构建 ----------
G.__hmCollapsed = false;
const body = G.__hmUI();
if (!body) { console.log('面板构建失败'); process.exit(1); }

// ---------- 几何检查 ----------
const W = body.width, H = body.height;
console.log('面板尺寸      :', W + ' x ' + H);
console.log('面板位置      :', body.x + ', ' + body.y, '(应居中:', Math.floor((750 - W) / 2) + ', ' + Math.floor((1334 - H) / 2) + ')');

function walk(node, depth, out) {
  out.push('  '.repeat(depth) + (node.text ? 'Text"' + node.text + '"' : node.__role || 'Sprite') +
    ' @' + node.x + ',' + node.y + ' ' + node.width + 'x' + node.height +
    (node.fontSize ? ' fs' + node.fontSize : ''));
  for (const c of node._children) walk(c, depth + 1, out);
  return out;
}
console.log('\n--- 元素树（前 40 项）---');
console.log(walk(body, 0, []).slice(0, 40).join('\n'));

// ---------- 圆角路径验证 ----------
const paths = calls.filter(c => c.kind === 'path');
const rects = calls.filter(c => c.kind === 'rect');
console.log('\n圆角路径调用  :', paths.length, '  直角矩形调用:', rects.length);
console.log('前 6 条 path 的弧角数:', paths.slice(0, 6).map(pp => (pp.args[2] || []).filter(x => x === 'arcTo').length).join(','));
if (paths.length > 1) {
  const p = paths[1].args[2];
  const arcs = p.filter(x => x === 'arcTo').length;
  console.log('面板路径弧角数:', arcs, '(完整圆角矩形应为 4)', arcs === 4 ? '✓' : '✗');
}

// ---------- 悬浮态验证 ----------
// 找应用按钮（第一个 '应用' 文本的父节点）
let appBtn = null;
(function find(n) {
  if (appBtn) return;
  if (n.text === '应用') { appBtn = n.parent; return; }
  for (const c of n._children) find(c);
})(body);

if (appBtn) {
  const before = calls.length;
  appBtn.emit('mouseover');
  const hoverCalls = calls.length - before;
  const outCalls = (() => { const b = calls.length; appBtn.emit('mouseout'); return calls.length - b; })();
  console.log('\n悬浮态        : mouseover 触发重绘', hoverCalls, '次 / mouseout', outCalls, '次',
    (hoverCalls > 0 && outCalls > 0) ? '✓' : '✗');
} else {
  console.log('\n未找到应用按钮 ✗');
}

// ---------- 输入框与应用动作 ----------
let input = null;
(function find(n) {
  if (input) return;
  if (n instanceof LInput) { input = n; return; }
  for (const c of n._children) find(c);
})(body);
if (input && appBtn) {
  input.text = '4242';
  appBtn.emit('click');
  console.log('输入+应用     : SET.diamond =', G.__hmSet.diamond, '(输入 4242)',
    G.__hmSet.diamond === 4242 ? '✓' : '✗');
}

// ---------- 多行回归：每个「应用」按钮必须只改自己那一行 ----------
// （回归 var 闭包共享 bug：曾导致所有按钮都读写最后一行的输入框）
const inputs = [];
const btns = [];
(function walk(n) {
  if (n instanceof LInput) inputs.push(n);
  if (n.text === '应用') btns.push(n.parent);
  for (const c of n._children) walk(c);
})(body);
console.log('输入框/应用按钮数:', inputs.length, '/', btns.length);

const keys = ['diamond','wood','stone','pvpCoin','godStone','exp','vip','roleLimit','getAllNum','reliveNum','refreshNum'];
let bad = 0;
for (let i = 0; i < Math.min(inputs.length, btns.length); i++) {
  inputs[i].text = String(1000 + i);
  btns[i].emit('click');
  const key = keys[i];
  const got = G.__hmSet[key];
  const want = 1000 + i;
  if (got !== want) { bad++; console.log('  ✗', key, '期望', want, '实际', got); }
}
console.log('每行独立写入  :', bad === 0 ? '✓ 全部正确' : ('✗ ' + bad + ' 行错乱'));

process.exit(0);
