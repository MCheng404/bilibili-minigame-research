// 从探针真实构建结果渲染面板 SVG —— 预览图与游戏内所见完全一致
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'panel_preview.svg';

// ---------- 记录绘制 ----------
const drawLog = [];   // { owner, kind, args }

class LSprite {
  constructor() {
    this._children = [];
    this._handlers = {};
    this.x = 0; this.y = 0; this.width = 0; this.height = 0;
    this.name = ''; this.mouseEnabled = false; this.parent = null;
    const self = this;
    this.graphics = {
      drawRect: (...a) => drawLog.push({ owner: self, kind: 'rect', args: a }),
      drawCircle: (...a) => drawLog.push({ owner: self, kind: 'circle', args: a }),
      drawPath: (...a) => drawLog.push({ owner: self, kind: 'path', args: a }),
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
  constructor() { super(); this.text = ''; this.fontSize = 22; this.bgColor = ''; this.borderColor = ''; this.padding = ''; this.type = ''; this.align = ''; }
}
class LPanel extends LSprite { constructor() { super(); this.vScrollBarSkin = ''; } }

const stage = new LSprite();
stage.width = 750; stage.height = 1334;
globalThis.Laya = { stage, Sprite: LSprite, Text: LText, TextInput: LInput, Panel: LPanel, timer: { scale: 1 } };

let src = fs.readFileSync(path.join(__dirname, 'nativelib/inj.js'), 'utf8');
// 把探针最外层的 catch 改成记录错误，方便定位被吞掉的异常
src = src.replace(/\} catch \(e\) \{\}\s*$/, '} catch (e) { globalThis.__hmErr = (e && e.stack) ? e.stack : String(e); }');
eval(src);
if (globalThis.__hmErr) { console.log('探针异常:' + globalThis.__hmErr); process.exit(1); }

const GM = globalThis;
GM.__hmCollapsed = false;
// 探针的 __hmdump 内部有 try/catch，构建失败会留下半成品面板，
// 这里先清掉再强制重建，异常就会直接抛出来。
for (const c of stage._children.slice()) {
  if (c.name === 'hmBody' || c.name === 'hmMini') stage.removeChild(c);
}
const body = GM.__hmUI();

// ---------- Laya 路径 → SVG ----------
// Laya arcTo(x1,y1,x2,y2,r)：从当前点 P 画圆弧到 E=(x2,y2)，
// 圆心 O = P + r * n，n 为入射方向的右转 90° 法线（指向图形内部）。
// 我们的圆角矩形全部顺时针，故 SVG sweep-flag = 1。
function layaPathToSvg(px, py, p) {
  let d = '';
  let cx = 0, cy = 0, dirX = 0, dirY = -1;   // 初始方向按「向上」，rrTopPath 首段即用到
  for (let i = 0; i < p.length; i++) {
    const cmd = p[i];
    if (cmd === 'moveTo') {
      cx = p[i + 1]; cy = p[i + 2];
      d += `M ${cx} ${cy} `; i += 2;
    }
    else if (cmd === 'lineTo') {
      const nx = p[i + 1], ny = p[i + 2];
      const dx = nx - cx, dy = ny - cy;
      const len = Math.hypot(dx, dy) || 1;
      dirX = dx / len; dirY = dy / len;       // 真实入射方向
      cx = nx; cy = ny;
      d += `L ${cx} ${cy} `; i += 2;
    }
    else if (cmd === 'arcTo') {
      const ex = p[i + 3], ey = p[i + 4], r = p[i + 5];
      // 圆心 = 当前点 + r * n，n 为入射方向右转 90° 的法线（指向图形内部）
      const nx = -dirY, ny = dirX;
      const ox = cx + r * nx, oy = cy + r * ny;
      d += `A ${r} ${r} 0 0 1 ${ex} ${ey} `;
      // 出射方向 = (E-O) 右转 90°
      const rx = ex - ox, ry = ey - oy;
      const rl = Math.hypot(rx, ry) || 1;
      dirX = -ry / rl; dirY = rx / rl;
      cx = ex; cy = ey;
      i += 5;
    }
    else if (cmd === 'closePath') { d += 'Z '; }
  }
  return d;
}

// ---------- 收集绘制顺序 ----------
const order = [];
(function collect(node) {
  order.push(node);
  for (const c of node._children) collect(c);
})(stage);

// 建立 owner -> 绘制列表
const byOwner = new Map();
for (const c of drawLog) {
  if (!byOwner.has(c.owner)) byOwner.set(c.owner, []);
  byOwner.get(c.owner).push(c);
}

// ---------- 生成 SVG ----------
const W = stage.width, H = stage.height;
const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
parts.push(`<rect width="${W}" height="${H}" fill="#101a2c"/>`);   // 模拟游戏背景

// 背景：画一个模拟战斗场景的底
parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#16233a"/>`);
for (let i = 0; i < 14; i++) {
  const gx = (i * 97) % W, gy = (i * 163) % H;
  parts.push(`<circle cx="${gx}" cy="${gy}" r="${18 + (i % 5) * 7}" fill="#1d2f4c" opacity="0.7"/>`);
}

function abs(node, x, y) {
  let ox = 0, oy = 0, n = node;
  while (n && n.parent) { ox += n.x; oy += n.y; n = n.parent; }
  return [ox + x, oy + y];
}

for (const node of order) {
  const draws = byOwner.get(node);
  if (draws) {
    for (const d of draws) {
      const a = d.args;
      if (d.kind === 'rect') {
        const [x, y, w, h, fill, stroke, lw] = a;
        const [ax, ay] = abs(node, x, y);
        if (fill) parts.push(`<rect x="${ax}" y="${ay}" width="${w}" height="${h}" fill="${fill}"/>`);
        if (stroke) parts.push(`<rect x="${ax}" y="${ay}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-width="${lw || 2}"/>`);
      } else if (d.kind === 'circle') {
        const [cx, cy, r, fill, stroke, lw] = a;
        const [ax, ay] = abs(node, cx, cy);
        if (fill) parts.push(`<circle cx="${ax}" cy="${ay}" r="${r}" fill="${fill}"/>`);
        if (stroke) parts.push(`<circle cx="${ax}" cy="${ay}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${lw || 2}"/>`);
      } else if (d.kind === 'path') {
        const [ox, oy, p, fill, stroke, lw] = a;
        const dstr = layaPathToSvg(ox, oy, p);
        const [ax, ay] = abs(node, ox, oy);
        parts.push(`<g transform="translate(${ax},${ay})"><path d="${dstr}" fill="${fill || 'none'}"${stroke ? ` stroke="${stroke}" stroke-width="${lw || 2}"` : ''}/></g>`);
      }
    }
  }
  // 文本
  if (node instanceof LText && node.text !== '') {
    const [ax, ay] = abs(node, 0, 0);
    const baseline = ay + node.fontSize * 0.95;
    parts.push(`<text x="${ax}" y="${baseline}" font-size="${node.fontSize}" fill="${node.color}" font-family="Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif">${String(node.text).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
  }
  if (node instanceof LInput && node.text !== '') {
    const [ax, ay] = abs(node, 0, 0);
    const baseline = ay + node.fontSize * 0.95;
    parts.push(`<text x="${ax}" y="${baseline}" font-size="${node.fontSize}" fill="${node.color || '#EAF6FF'}" font-family="'JetBrains Mono', Consolas, monospace">${String(node.text)}</text>`);
  }
}
parts.push('</svg>');

fs.writeFileSync(OUT, parts.join('\n'), 'utf8');
console.log('已生成', OUT, '| 绘制调用', drawLog.length, '| 文本节点',
  order.filter(n => (n instanceof LText || n instanceof LInput) && n.text !== '').length);
process.exit(0);
