# 08 · Unity 小游戏适配（别碰我的菜）

> 以「别碰我的菜」（HarvestKing，APPID `biligame4c796ed3edca7cdc`）为例，
> 讲清楚 Unity WebGL 小游戏跟 Laya 小游戏的架构差异，以及适配方法。

## 1. 架构差异（最关键的一点）

| | 魔法领域（Laya） | 别碰我的菜（Unity WebGL） |
|---|---|---|
| 引擎 | LayaAir | Unity 2022.3.34f1 → WebGL **WASM** |
| 逻辑位置 | **JS**（混淆后仍在 JS 里） | **wasm 二进制** |
| 数值入口 | `playerInfo` 数据单例、`a` 配置表 | **只有存档** |
| 改写方式 | 直接赋值字段 | 拦截 `wx.setStorage` / `wx.getStorageSync` |
| 面板渲染 | `Laya.stage` 上的 Sprite | **HTML 浮层**（宿主有真 DOM） |

结论：**Unity 小游戏不能照搬 Laya 的探针**。
JS 层能看到的只有引擎适配层（`unity-sdk/*.js`）和平台 API，游戏状态一律在 wasm 内存里。

不过有一条好消息：Unity 适配层本身是 JS，
它把「存档读写」和「广告」都转成了 `wx` 调用 —— 这就是我们的切入口。

---

## 2. 游戏结构

```
/data/user/0/tv.danmaku.bili/app_mod_resource/cache/applet/
    biligame4c796ed3edca7cdc_min/1-0/
        game.js                     ← 入口，require 各模块
        blapp-adapter-unity-wasm-split.js   ← ★ 注入目标
        weapp-adapter.js
        webgl.wasm.framework.unityweb.js    ← Unity 框架（含 SendMessage）
        unity-sdk/
            ad.js                   ← 广告封装
            storage.js              ← 存档封装
            module-helper.js        ← JS→C# 桥接
            sdk.js / index.js ...
        unity-namespace.js
```

### 2.1 注入锚点

`blapp-adapter-unity-wasm-split.js` 有三个特征，native 层据此识别 Unity：

```c
got > 20000 && strstr(buf, "GameGlobal")
              && strstr(buf, "requirePlugin")
              && strstr(buf, "__cmgeSubpackages")
```

实测 9 个 Unity bundle 里**只有它**同时满足这三个特征。

**锚点安全性**：native 层改写是把代码插在最后一个 `}();` 之前。
Unity 的适配层是 CommonJS 打包产物，文件里有 4 处 `}();`，
但只有这一处在**文件末尾**（offset 115968 / 长度 115972）。
所以 native 层额外加了一道闸：

```c
size_t tail_len = (size_t)got - tail_off;
if (tail_len > 8) {           /* 锚点不在末尾 → 放弃改写 */
    LOGI("patch: unity anchor not at EOF (tail=%zu), skip", tail_len);
    return NULL;
}
```

> 插到中间会切在别的语句里，直接语法错误、**整个游戏起不来**。
> `webgl.wasm.framework.unityweb.js` 的最后一个 `}();` 在 93598 / 536115 处，
> 差了三万多字节 —— 幸好它不满足 Unity 特征，不会被选中。

### 2.2 JS → C# 桥接

`unity-sdk/module-helper.js`：

```js
_send: null,
init() { this._send = GameGlobal.Module.SendMessage; },
send(e, t = "") {
    this._send || this.init();
    this._send(_conf.MODULE_NAME, e, t);
}
```

这是宿主侧调用 wasm 的入口。反向（wasm 调 JS）用的是 Unity 标准的
`SendMessage(receiverName, methodName, value)`，
`game.js` 里用它通知 C#「B 站侧栏返回了」：

```js
SendMessage(harvestKingBilibiliLifecycle.receiverName,
            "BL_OnHarvestKingBilibiliShow", latestScene);
```

---

## 3. 存档结构

位置：`/data/data/tv.danmaku.bili/files/smallappGame/appsStorage/<APPID>/<md5>.0`

| 文件 | 内容 |
|---|---|
| `98hv93...0` | 键名索引表（`237f24...0` → `LocalGameData497642846`） |
| `237f24...0` | **真正的存档**（61875 字节） |

### 3.1 三层 JSON 嵌套

存档值是 **JSON 字符串套 JSON 字符串套 JSON**：

```
外层  = { Version, IntStorage, FloatStorage, StringStorage, UserPropsData }
              └─ StringStorage.Save_Data = 又一层 JSON 字符串
                                          └─ 最内层 = { accountLevel, currency, ... }
```

最内层是 .NET **Json.NET** 的格式（`$type` 标注类型）：

```json
{
  "$type": "SHelper.Data, Assembly-CSharp",
  "accountLevel": { "$type": "SHelper.AccountLevelStorage, Assembly-CSharp",
                    "currentLevel": 1, "currentExperience": 0 },
  "currency": { "$type": "SHelper.CurrencyStorage, Assembly-CSharp",
                "currencies": { "$values": [
                    { "$type": "SHelper.Currency, Assembly-CSharp",
                      "type": 4, "amount": 581.691 } ] },
                "incomeMultiplier": 1.0 },
  "advertisement": { "isNoAdsPurchased": false, ... },
  "chapters": { "currentChapterIndex": 3, "endlessChapterIndex": 4, ... },
  "soldier": { "_unlockeds": { "$values": [1,2,5,18,17,4,15,3,13] },
               "_saves": { "$values": [ { "type": 1, "level": 6 } ] } },
  ...
}
```

`unpack()` / `repack()` 负责拆包与还原，往返保持层级不变。

### 3.2 可改字段一览

| 存储 | 字段 | 作用 |
|---|---|---|
| `currency` | `currencies.$values[].amount` | 4 种货币（type 1/4/5/6） |
| `currency` | `incomeMultiplier` | 收益倍率 |
| `energyStorage` | `mainEnergy.currentEnergy` | 主体力 |
| `energyStorage` | `modesEnergy.currentEnergy` | 模式体力 |
| `accountLevel` | `currentLevel` / `currentExperience` | 账号等级与经验 |
| `chapters` | `currentChapterIndex` / `endlessChapterIndex` / `currentLevelIndex` / `endlessLevelIndex` | 章节关卡解锁 |
| `soldier` | `_saves.$values[].level` | 士兵等级 |
| `soldier` | `_unlockeds.$values` | 已解锁兵种 |
| `levelProgress` | `PlayerMoney` | 局内金币 |
| `levelProgress` | `ReviveCount` | 局内复活次数 |
| `levelProgress` | `PersonalBestWave` | 个人纪录波次 |
| `advertisement` | `isNoAdsPurchased` | **永久免广告** |
| `dynamicDifficulty` | `failCount` | 失败次数（归零 → 敌人不加速） |
| `chestBonus` | `usedToday` | 每日宝箱已用次数 |
| `battlePass` | `currentXp` / `currentLevel` / `isPremiumPurchased` | 战斗通行证 |
| `garden` | `isFeatureUnlocked` | 花园功能解锁 |
| `artifacts` | `isActive` / `totalPullCount` | 遗物系统 |

---

## 4. 改写机制

### 4.1 拦截点

`unity-sdk/storage.js` 封装了所有存档读写，最终落到 `wx`：

```js
getData(e, t) { ... wx.getStorageSync(e) ... }
setData(e, t) { this._cacheData[e] = t; this._handleList.push({type:"setData", ...}); ... }
// _doRun 里最终调 wx.setStorage({key, data})
```

所以接管这 4 个就够：

| API | 作用 |
|---|---|
| `wx.setStorage` | 写盘前改写 |
| `wx.setStorageSync` | 同步写盘前改写 |
| `wx.getStorageSync` | 读盘时改写（游戏启动读存档走这里） |
| `wx.getStorage` | 异步读盘时改写 |

### 4.2 为什么读写都要拦

只拦写不够 —— 游戏启动时把存档读进内存，
内存里还是原值。读也拦，游戏拿到的就是改过的值。

### 4.3 sweep 的坑（踩过）

`sweep` 是「主动扫全盘改写」，用 `wx.getStorageInfoSync()` 拿键列表再逐个读改写。

**坑**：如果用被 hook 过的 `getStorageSync` 读，读出来的**已经是改写过的值**，
再改写一次结果相同 → 被判定成「无需写入」而跳过 → **磁盘上留的还是旧值**。

修法：hook 时把原始实现存到 `G.__hmRawGetSync`，sweep 用原始版本读：

```js
var rawGet = G.__hmRawGetSync || wx.getStorageSync;
var v = rawGet.call(wx, keys[i]);
```

---

## 5. 去广告

### 5.1 Unity 的广告链路

```
C# (wasm) → SendMessage → unity-sdk/ad.js → wx.createRewardedVideoAd
                                                  ↓
                                          onClose 回调回传 C#
```

`unity-sdk/ad.js` 里：

```js
WXCreateRewardedVideoAd(e) {
  const t = wx.createRewardedVideoAd(r);
  t.onClose(e => { _moduleHelper.default.send("ADOnVideoCloseCallback", ...); });
  ...
}
```

### 5.2 关键差异：onClose 必须真的触发

通用层（`common.js`）的伪广告对象把 `onClose` 做成了**空函数**：

```js
var ad = { show: () => Promise.resolve(1), onClose: function () {}, ... };
```

这在 Laya 游戏里没问题（游戏自己用 `playVideo` 的 Promise）。
但在 Unity 里 —— C# 靠 `onClose` 才知道「广告看完了」，
空函数意味着**游戏永远等不到回调，奖励发不出去**。

所以 Unity 模式必须用专用实现：

```js
var ad = {
  show: function () {
    setTimeout(function () {
      if (closeCb) closeCb({ isEnded: true });   // ← 真的触发
    }, 30);
    return Promise.resolve(1);
  },
  onClose: function (cb) { closeCb = cb; },      // ← 记住回调
  ...
};
```

### 5.3 接管顺序与覆盖

- `common.js` 的 `scanAds` 会递归扫 `globalThis`，**先**接管 `wx.createRewardedVideoAd`
- `harvest.js` 后跑，看到 `__hm` 标记会跳过 → 结果用的是通用层的空 `onClose` 版本

两个解法，都做了：

1. `common.js` 里加 `isUnityGame()` 判定，Unity 模式下直接委托给 `__hmHarvestHookAds()`
2. `harvest.js` 的伪广告打 `__hmUnityAd` 标记，能**覆盖**通用层的版本

另外 `common.js` 的内联块之前是 patch_v16.py 一次性写进 `inj.js` 的静态副本，
改源文件不生效 —— 现在改成 `build_common.py` 每次从源文件重新生成（带 sha1 指纹）。

---

## 6. 面板：HTML 浮层

Unity 走 WebGL canvas，但**宿主有真 DOM**（`document.body`、`document.createElement`
在 `webgl.wasm.framework.unityweb.js` 里被大量使用）。所以面板直接用 HTML 叠一层。

### 6.1 视觉规范（与 Laya 版一致）

| 项 | 值 |
|---|---|
| 面板底 | `rgba(20,42,78,0.95)` |
| 主色 / 强调 | `#3D86D8` / `#7FC4FF` |
| 圆角 | 面板 18 / 控件 11 / 开关 18（胶囊） |
| 面板尺寸 | 80% 屏宽居中，max-height 80% |
| 折叠圆钮 | 72×72，圆角 36 |
| 标题栏 | 56px，可拖动 |
| 开关 | 64×36 |
| 挡位按钮 | 50px 高 |
| 输入框 | 52px 高 / 23px 字 |
| 按钮 | 52px 高 / 23px 字 |

### 6.2 结构

```
.hm-host (fixed, pointer-events:none)
├── .hm-btn-float      折叠态圆钮（pointer-events:auto）
└── .hm-panel          展开态
    ├── .hm-head       标题栏（pointerdown 拖动）+ 圆形 × 折叠
    ├── .hm-body       滚动区（overflow-y:auto）
    │   └── .hm-sec    分组
    │       ├── .hm-row.hm-half   两列开关
    │       ├── .hm-row            标签 + 输入框 + 应用按钮
    │       └── .hm-row-stack      标签 + .hm-gear 挡位组
    └── .hm-foot       底部固定按钮（一键应用 / 重新接管广告）
```

拖动用 Pointer Events + `setPointerCapture`，改 `left/top`（不是 `transform`），
所以先 `getBoundingClientRect()` 把居中定位转成绝对坐标。

---

## 7. 模块与构建

### 7.1 文件

| 文件 | 作用 |
|---|---|
| `nativelib/harvest.js` | 存档改写 + Unity 广告接管（通用框架） |
| `nativelib/unity_ui.js` | HTML 浮层面板（通用框架） |
| `nativelib/harvest_adapt.js` | 「别碰我的菜」的布局描述 + 写入函数（游戏适配层） |
| `nativelib/common.js` | 通用能力层（已加 Unity 让位逻辑） |
| `nativelib/inj.js` | 主注入脚本，内联 common.js + Unity 分发器 |

### 7.2 分发机制

Unity 三个模块以**字符串常量**挂在 `G.__hmModuleSrc` 上，
由 `inj.js` 里的分发器在判定为 Unity 引擎时才 `eval`：

```js
var isUnity = 0;
try { if (GG.__hmUnity) isUnity = 1; } catch (e) {}
if (!isUnity) {
  try {
    if (GG.GameGlobal && GG.GameGlobal.__cmgeSubpackages &&
        GG.GameGlobal.__cmgeSubpackages.length) isUnity = 1;
  } catch (e) {}
}
if (!isUnity) return;      // Laya 游戏直接跳过，不解析 Unity 模块
```

`__hmUnity` 由 native 层在改写 Unity bundle 时挂上；
`__cmgeSubpackages` 是兜底判定（宿主初始化后也能识别）。

### 7.3 构建

```bash
python build_common.py    # 把 common.js 重新内联进 inj.js（带 sha1 指纹，幂等）
python build_runtime.py   # 生成 hm_runtime.js（分发器前置块 + inj.js）与 inj_gen.h
```

`build_runtime.py` 产物两个：
- `nativelib/hm_runtime.js` —— 放设备上供 native 层运行时加载
- `nativelib/inj_gen.h` —— 编译进 `.so` 的兜底版本

### 7.4 native 层 Unity 分支

```c
if (got > 20000 && strstr(buf, "GameGlobal") &&
    strstr(buf, "requirePlugin") && strstr(buf, "__cmgeSubpackages")) {
    unity = 1;
}
```

Unity 分支注入的桥接暴露 `GameGlobal` / `wx` / `bl` / `canvas` / `document`：

```js
globalThis.__hmBridge = function () {
  var o = {};
  try { o.GameGlobal = (typeof GameGlobal !== 'undefined' ? GameGlobal : null); } catch (e) {}
  try { o.wx = (typeof wx !== 'undefined' ? wx : null); } catch (e) {}
  try { o.bl = (typeof bl !== 'undefined' ? bl : null); } catch (e) {}
  try { o.canvas = (typeof canvas !== 'undefined' ? canvas : null); } catch (e) {}
  try { o.document = (typeof document !== 'undefined' ? document : null); } catch (e) {}
  return o;
};
```

---

## 8. 校验清单

- [x] Unity 识别特征只命中 `blapp-adapter` 一个文件
- [x] 注入锚点在文件末尾（`tail_len <= 8`）
- [x] 存档解包 → 改写 → 重打包 往返一致、幂等
- [x] 拦截写盘生效（`setStorage` / `setStorageSync`）
- [x] 拦截读盘生效（`getStorageSync` / `getStorage`）
- [x] 非存档值原样透传（不误伤其它 key）
- [x] 广告 `onClose` 真的触发（带 `isEnded:true`）
- [x] HTML 面板能构建：按钮/输入框/标签/开关数量正确
- [x] 样式表注入成功
- [x] 折叠/展开切换正常
- [x] 点「应用」只改自己那一行（回归测试覆盖）
- [x] Laya 侧功能回归不受影响

---

## 9. 踩过的坑

| 坑 | 现象 | 修法 |
|---|---|---|
| `}();` 锚点不在末尾 | 插到 CommonJS 中间 → 语法错误、游戏起不来 | native 层校验 `tail_len <= 8` |
| `wx` 加载时捕获 | 注入时机早于宿主 API 初始化 → 拿到 null | 改成每次调用动态 `getWx()` |
| 通用层抢先接管广告 | Unity 的 `onClose` 是空函数 → 奖励发不出去 | common 层 Unity 分支委托 + harvest 覆盖 |
| sweep 读到已改写值 | 误判「无需写入」→ 磁盘留旧值 | 保留 `G.__hmRawGetSync`，sweep 用原始读取 |
| common.js 静态内联副本 | 改源文件不生效，调试被误导 | `build_common.py` 每次重新内联（sha1 指纹） |
| 脚本 eval 污染作用域 | 挂住的 node 进程 | 测试末尾 `process.exit(0)` |
