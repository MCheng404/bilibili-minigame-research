# 魔法领域（B 站小游戏）修改文档

> 引擎：Laya（`libMiniEngine.so` 内嵌 V8）
> 进程：`tv.danmaku.bili:web`
> 状态：**已打通**。数值、等级、免广告、存档写入全部实测可用。
> 验证截图：`dump/screenshot_888888.png`（钻石 11799 → 888888）

---

## 分卷索引

| 文档 | 内容 |
|---|---|
| [01-原理与链路.md](./01-原理与链路.md) | 引擎结构、bundle 作用域分析、为什么对象图 BFS 走不通、源码改写的落点 |
| [02-字段与上限.md](./02-字段与上限.md) | 完整字段清单、每个字段的上限来源、危险字段与原因 |
| [03-部署与调试.md](./03-部署与调试.md) | 从编译到生效的完整步骤、常用调试命令 |
| [04-踩坑记录.md](./04-踩坑记录.md) | 10 个实际踩过的坑与判断依据 |

## 资源

| 目录 | 内容 |
|---|---|
| `dump/hmjs_00.js` | 从 `Script::Compile` 截获的原始游戏 bundle，673,321 字节 |
| `dump/syms.txt` | `libMiniEngine.so` 的完整动态符号表（49,556 条，`readelf --dyn-syms`） |
| `dump/screenshot_888888.png` | 修改生效后的界面截图 |
| `src/nativelib/hmshim.c` | 注入库源码（定位引擎、hook、源码改写、探针注入） |
| `src/nativelib/inj.js` | 游戏内探针 + 悬浮面板源码 |
| `src/nativelib/inj_gen.h` | 由 `inj.js` 自动生成的 C 字符串头文件 |
| `src/build_inj.py` | `inj.js` → `inj_gen.h` 转换脚本 |
| `src/readtag.py` | PC 侧回读探针结果 |
| `src/test_ui.js` | 完整本地 mock（伪造 Laya + 数据单例 + 配置表），改探针前先跑它 |
| `src/test_inj.js` | 简化本地 mock（只测数值逻辑） |
| `src/ctx.py` | 打印某关键字在 bundle 里的所有出现位置及上下文 |
| `src/find_g.py` | 定位 `g` 的定义、`PlayerInfo_save`、IIFE 尾部结构 |
| `src/brace_scan.py` | 括号平衡扫描（注入 JS 少花括号是最常见的坑） |
| `src/patch_src.py` | 在本地验证源码改写位置与语法 |

---

## 结论速览

### 数据位置

```js
// bundle 内层 IIFE 顶层的两个类
class c {                      // playerInfo 的数据结构
  constructor() {
    this.outDiamondNum = 0;
    this.woodNum = 0;
    ...
  }
}
class g {                      // 玩家数据单例（静态属性持有）
  static login() { ... }
}
// 视图类
class Ye extends ... {
  refreshUI() {
    this.ui_player.getChildByName("lab_goldNum").text =
        g.playerInfo.outDiamondNum.toString();
  }
}
```

`g` 不在任何可达对象图上，必须通过**源码改写**暴露。

### 关键改写

在 `libMiniEngine.so` 的 `Script::Compile` hook 里，把源码中**最后一个 `}();`
的 `}` 之前**插入：

```js
;try{globalThis.__hmg=g}catch(e){globalThis.__hmge=String(e)}
;try{globalThis.__hma=a}catch(e){globalThis.__hae=String(e)}
;try{globalThis.__hmgg=gg}catch(e){globalThis.__hge=String(e)}
```

改写后源码长度从 673,321 变成 673,382（增加 61 字节），插入点在偏移 673,314。

### 为什么改的是真值

界面刷新和购买判断**读的是同一个字段**：

```js
// 界面
this.ui_player.getChildByName("lab_goldNum").text = g.playerInfo.outDiamondNum.toString()

// 购买
if (g.playerInfo.outDiamondNum < i) return void Laya.stage.event(t.ShowTip, "金币不足");
g.playerInfo.outDiamondNum -= i
```

所以拿到的 `g.playerInfo` 就是权威数据源，不是显示副本。

### 存档

```js
static PlayerInfo_save() {
  ...
  gg.platform.userSave_upload(this.playerInfo, e, a)   // 上传的就是被改过的对象
}
```

登录时 `gg.platform.login()` 返回 `saveData`，用 `userSave_encryption` 解密后
赋给 `playerInfo`；`s.sVersion == e` 才复用存档，登录后强制 `sVersion = e`，
因此存档是持久的。**只要触发一次 `PlayerInfo_save()`，服务端存下的就是修改后的值。**

### 悬浮面板

用 Laya 显示对象直接画在 `Laya.stage` 上，不需要任何原生悬浮窗权限：

- 折叠态：右下角 `84×34` 的「HM」小条
- 展开态：`300×452` 面板，11 行数值 + 4 个功能按钮
- 标题栏和小条均可拖动，位置会记住
- 每 2.5 秒自检，被场景切换清掉会自动重建
- **同一时刻只允许存在一个实例**（多实例会叠在一起）

---

## 一句话总结

这类小游戏的数值不可能靠内存扫描改，因为真值在 V8 堆里的 JS 对象上，
而那个对象藏在模块闭包里。唯一的入口是 `Script::Compile` 的源码入参——
在 IIFE 闭合前注入一行把它挂到 `globalThis`，之后一切都变得直接。
