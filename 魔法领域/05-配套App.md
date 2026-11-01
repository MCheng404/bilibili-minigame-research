# 05 · 配套 App（配置界面）

LSPosed 模块本身是一个普通 APK，除了注入逻辑外还带一个配置界面，
用小米 HyperOS 风格的 [Miuix](https://github.com/compose-miuix-ui/miuix) Compose 库绘制。

---

## 1. 界面结构

```
TopAppBar「HM 小游戏工具」
├── 状态卡片      注入方式 / 版本 / 目标应用 / 目标进程 / 作用域
├── SmallTitle    支持的游戏
├── 游戏卡片 ×N   图标 + 名称 + 引擎 + 章节 + 说明 + 能力清单
├── SmallTitle    使用前提
└── 提示卡片      四步操作指引 + 更新失效说明
```

新增一款游戏只需在 `SUPPORTED_GAMES` 里追加一条 `GameEntry`，界面会自动多出一张卡片：

```kotlin
private data class GameEntry(
    val name: String,        // 魔法领域
    val engine: String,      // Laya
    val chapter: String,     // 第 10 章 驯兽师
    val summary: String,     // 原理简述
    val features: List<String>,  // 能力清单
    val accent: Color,       // 强调色
)
```

游戏图标用**强调色方块 + 首字**代替，不额外打包图片资源，避免 APK 体积增长。

---

## 2. 依赖与构建

### 2.1 关键点：AGP 9 的内置 Kotlin

这个工程用的是 AGP 9.4.1。**从 AGP 9.0 起 Kotlin 编译是内置的**，
再显式加 `org.jetbrains.kotlin.android` 会直接报错：

```
The 'org.jetbrains.kotlin.android' plugin is no longer required for Kotlin support since AGP 9.0.
```

但 AGP 9.0 内置的 KGP 版本是 **2.2.10**，而 miuix 0.9.4 依赖
`kotlin-stdlib 2.4.20`。低版本编译器读不了高版本 metadata，
所以必须在顶层 build 文件里用 `buildscript` 把 KGP 抬上去：

```kotlin
// root-build.gradle.kts
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

plugins {
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
}
```

app 侧只需要两个插件：

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")   // Compose 编译器仍需单独加
}
```

### 2.2 依赖

```kotlin
dependencies {
    // Xposed API 只在编译期可见，运行期由框架提供
    compileOnly("de.robv.android.xposed:api:82")

    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.13.0")

    implementation("top.yukonga.miuix.kmp:miuix-ui:0.9.4")
    implementation("top.yukonga.miuix.kmp:miuix-icons:0.9.4")
}
```

miuix 是 Compose Multiplatform 库，Android 工程直接写无后缀坐标即可，
Gradle 会解析到 `-android` 变体，最终落到 androidx compose 上。

### 2.3 构建

```bash
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

---

## 3. Miuix API 速查（0.9.4 实测）

```kotlin
// 主题
val controller = remember { ThemeController(ColorSchemeMode.System) }
MiuixTheme(controller = controller) { /* content */ }

// 也可以直接传 colors，不接管系统深浅色
MiuixTheme(colors = MiuixTheme.colorScheme) { }

// 页面骨架
Scaffold(
    topBar = { TopAppBar(title = "标题") },
    containerColor = MiuixTheme.colorScheme.surface,
) { padding -> /* content */ }

// 卡片（有 onClick 重载，可做可点击卡片）
Card(
    modifier = Modifier.fillMaxWidth(),
    cornerRadius = CardDefaults.CornerRadius,
    insideMargin = CardDefaults.InsideMargin,
) {
    Text("内容")   // content 是 ColumnScope
}

// 分组小标题
SmallTitle("支持的游戏")

// 文本
Text(text = "...", fontSize = 13.sp, color = MiuixTheme.colorScheme.onSurface)
```

配色常用字段：`surface` / `onSurface` / `onSurfaceVariantSummary` / `background` / `onBackground`。

---

## 4. 作用域推荐（xposedscope）

LSPosed 支持通过清单元数据声明**推荐作用域**，管理器会在作用域页面把
这些应用标为推荐并默认勾选，用户不用自己去长列表里翻。

```xml
<!-- res/values/array.xml -->
<string-array name="xposedscope" translatable="false">
    <item>tv.danmaku.bili</item>
</string-array>
```

```xml
<!-- AndroidManifest.xml -->
<meta-data android:name="xposedmodule" android:value="true" />
<meta-data android:name="xposeddescription" android:value="@string/module_desc" />
<meta-data android:name="xposedminversion" android:value="93" />
<meta-data android:name="xposedscope" android:resource="@array/xposedscope" />
```

三个要点：

1. **`xposedminversion` 必须 ≥ 93**，`xposedscope` 是 API 93 引入的。
   本机 LSPosed v2.2.1 (7933) 满足。
2. 作用域写**主包** `tv.danmaku.bili` 即可。小游戏跑在 `:web` 子进程里，
   但作用域按包名匹配，勾主包就覆盖了所有子进程。
3. `xposedscope` 只在模块**首次加载**时被读取作为推荐。已经启用过的模块，
   LSPosed 会保留用户既有的作用域配置，不会覆盖。

验证模块状态（需要 root）：

```bash
adb shell "su -c 'cp /data/adb/lspd/config/modules_config.db /data/local/tmp/mc.db'"
adb pull /data/local/tmp/mc.db
```

```python
import sqlite3
c = sqlite3.connect('mc.db').cursor()
c.execute("SELECT * FROM modules_state WHERE module_pkg_name='com.hm.xposed'")
print(c.fetchall())          # ('com.hm.xposed', 0, 1, 0) → enabled=1
c.execute("SELECT * FROM scope WHERE module_pkg_name='com.hm.xposed'")
print(c.fetchall())          # ('com.hm.xposed', 'tv.danmaku.bili', 0)
```

---

## 5. 踩过的坑

### 5.1 编译 2 秒就结束，改动看起来没生效

`./gradlew :app:assembleDebug` 走增量编译，改一个文件确实只要几秒。
若怀疑 APK 没更新，最省事的判据是**改一个 ASCII 字符串**（例如版本号 `1.1` → `1.2`），
重装后截图比对。中文串在 dex 里用 MUTF-8 编码，`strings` 命令往往抓不到，
不适合用来判断 APK 是否更新。

### 5.2 长文本溢出卡片边界

`Card` 的 content 是 `ColumnScope`，内部 Column 的宽度由内容决定。
一条长中文文本会把 Column 撑得比卡片宽，表现为文字两端被裁。

两层修法，缺一不可：

1. `Card(modifier = Modifier.fillMaxWidth())` —— 先把卡片钉成全宽
2. 卡片内再套一层 `Column(Modifier.fillMaxWidth())`，每个 `Text` 也加
   `Modifier.fillMaxWidth()` —— 锁死测量宽度，让文本按卡片宽折行

另外长段落建议拆成两三个短 `Text`，比一整段更不容易出现边界问题。

### 5.3 截图是锁屏壁纸

`am start` 成功不代表界面在前台，设备可能已经休眠。截图前先：

```bash
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
```

### 5.4 截图太大无法查看

1440×3200 的 PNG 有 4 MB 多，需要先缩放或裁剪：

```python
from PIL import Image
im = Image.open('ui.png')
im.crop((0, int(im.height*0.6), im.width, im.height)) \
  .resize((640, 700)).convert('RGB').save('ui_bottom.png', quality=90)
```
