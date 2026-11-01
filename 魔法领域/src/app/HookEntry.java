package com.hm.xposed;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.lang.ref.WeakReference;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

/**
 * B 站小游戏（Cocos Creator 3 + libMiniEngine 内嵌 V8）注入模块。
 *
 * 演进过程：
 *   v1  hook X5 JsContext#evaluateScript     -> 从未被调用
 *   v2  hook X5 WebView 生命周期主动注入      -> 进程里根本没有 X5 WebView
 *   v3  hook Runtime#loadLibrary0 打印调用栈  -> 发现 com.bilibili.lib.v8
 *   v4  hook V8Engine 全部方法记参数          -> 命中 runScript(script, name, cb)
 *   v5  改写 runScript 入参注入               -> 按名缓存，未执行
 *   v9  独立脚本名执行 payload                -> 执行成功，但 ConsString 读不出
 *   v10 结果写入 Uint8Array（连续内存）       -> 拿到服务层全局键表
 *   v11 枚举 App/Service/bl/getApp()          -> 确认那是服务层，游戏不在这里
 *   v13 发现游戏是 Cocos3 + 明文 JS 落盘      -> 改走「改包内 JS」路线
 *   v15 快速轮询补丁线程                      -> 抢在小游戏容器解包之后、加载之前
 */
public class HookEntry implements IXposedHookLoadPackage {

    private static final String TAG = "HMHook";

    private static final String APPLET_ROOT =
            "/data/data/tv.danmaku.bili/app_mod_resource/cache/applet";
    private static final String PKG_ROOT =
            "/data/data/tv.danmaku.bili/files/playable_pkg";

    /** 服务层探针：结果写进 Uint8Array，避开 V8 ConsString 不连续的问题 */
    private static final String PAYLOAD = """
            (function(){
              var L=[],G=globalThis,B=8192,T="HMBUF9F3A:";
              function P(k,v){try{L.push(k+"="+v);}catch(e){}}
              P("t",Date.now());
              P("getApp",String(getApp()));
              P("pages",String(getCurrentPages().length));
              var s=L.join("\\n");
              var b=new Uint8Array(B);
              for(var i=0;i<T.length;i++)b[i]=T.charCodeAt(i);
              for(var i=0;i<s.length&&i<B-T.length-1;i++){
                var c=s.charCodeAt(i);
                b[T.length+i]=(c<128)?c:63;
              }
              G.__hmb=b;
            })();
            """;

    /**
     * 追加到小游戏 JS 文件末尾的探针。
     *
     * 标记用 String.fromCharCode 运行时拼装，源码与 dex 里都不存在这个字面量，
     * 所以内存里一旦出现，就只能是 JS 真的执行了。
     */
    private static final String PATCH_TMPL = """
            ;(function(){try{
              var G=(typeof globalThis!=='undefined')?globalThis:((typeof GameGlobal!=='undefined')?GameGlobal:this);
              function W(k,s){try{
                var T=String.fromCharCode(72,77,71,90,57,70,51,65)+k;
                var B=new Uint8Array(8192);
                for(var i=0;i<T.length;i++)B[i]=T.charCodeAt(i);
                for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);B[T.length+i]=(c<256)?c:63;}
                G['__hmg'+k]=B;}catch(e){}}
              W(':','src=__SRC__|t='+Date.now()+'|GG='+(typeof GameGlobal)+'|wx='+(typeof wx)+'|cc='+(typeof cc));
              setTimeout(function(){
                var s='src=__SRC__|';
                try{
                  var c=(typeof cc!=='undefined')?cc:G.cc;
                  s+='cc='+(typeof c);
                  if(c){
                    s+='|cck='+Object.getOwnPropertyNames(c).slice(0,60).join(',');
                    try{
                      var d=c.director;s+='|dir='+(typeof d);
                      if(d&&d.getScene){var sc=d.getScene();s+='|scene='+(sc?sc.name:'null');}
                    }catch(e2){s+='|E2='+(e2&&e2.message);}
                  }
                }catch(e){s+='|E1='+(e&&e.message);}
                W('@',s+'|t='+Date.now());
              },8000);
            }catch(e){}})();
            """;

    private static String buildPatch(String src) {
        return "\n" + PATCH_TMPL.replace("__SRC__", src);
    }

    /** 识别是否已经打过补丁 */
    /** 临时总开关：关掉后进程不再 dlopen gadget，便于确认它是否影响小游戏加载 */
    /** 总闸。false = 只加载不动作 */
    private static final boolean MASTER = true;

    /** 存档探查：只读遍历 smallappGame 下的存储目录 */
    private static final boolean STORAGE_DUMP = true;

    /** 外壳页写入钩子：容器生成 subContext.html / shell.game.html 的瞬间追加探针 */
    private static final boolean HTML_HOOK = false;

    /** 探测：HTML 到底走不走 WebView */
    private static final boolean WV_PROBE = true;

    /** 试验：在 :web 里加载我们自己编的最小原生库，验证是否只有 frida 会崩 */
    private static final boolean NATIVE_TEST = true;

    /** 文件补丁（game.js / shell html）：已证明无效，默认关 */
    private static final boolean FILE_PATCH = false;

    /** Java 层 V8Engine 钩子：属于服务层上下文，对游戏无效，默认关 */
    private static final boolean JAVA_HOOKS = false;

    private static final boolean GADGET_ENABLED = false;

    /** 隔离实验：只装 gadget，不碰 WebView / 文件 / Java 钩子 */
    private static final boolean ONLY_GADGET = false;

    private static final String MARK_JS = "fromCharCode(72,77,71,90";

    /** 改文件路线已证明无效：容器不执行 cache/applet 里的 JS，留作开关便于复现 */
    private static final boolean PATCH_JS = false;

    private static final List<Object> engines = new ArrayList<>();
    private static volatile boolean runnerStarted = false;
    private static volatile boolean fastPatchStarted = false;
    private static int scriptLogs = 0;

    /* ==================================================================
     * 注入脚本自动同步
     * ------------------------------------------------------------------
     * 模块跑在 tv.danmaku.bili:web 进程里，身份就是 bilibili 自己，
     * 写 /data/data/tv.danmaku.bili/files/ 根本不需要 root ——
     * 比让 App 通过 su 部署可靠得多（App 的 su 往往被 KernelSU 的
     * App Profile 限制了 SELinux 域，写不进别的 App 的私有目录）。
     *
     * native 层启动时会按顺序找这几个路径读脚本，读到就用磁盘上的，
     * 读不到才退回编译期内嵌的兜底版本。
     * ================================================================== */

    private static final String SCRIPT_URL =
            "https://raw.githubusercontent.com/MCheng404/bilibili-minigame-research"
            + "/master/scripts/hm_inject.js";
    private static final String SCRIPT_PATH =
            "/data/data/tv.danmaku.bili/files/hm_inject.js";
    private static final String SCRIPT_TS =
            "/data/data/tv.danmaku.bili/files/.hm_script_ts";
    /** App 用来请求立即同步的广播 */
    private static final String SYNC_ACTION = "com.hm.xposed.SYNC_SCRIPT";
    /** 6 小时内不重复拉取 */
    private static final long SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000L;

    /**
     * 更新时间戳文件。
     * 注意：File.setLastModified() 对**不存在的文件**是无效的（不会创建它），
     * 所以要先 createNewFile()，否则标记文件永远不出现，
     * 「6 小时内不重复拉」的判断也就永远不成立。
     */
    private static void touchTs(File ts) {
        try {
            if (!ts.exists()) ts.createNewFile();
            ts.setLastModified(System.currentTimeMillis());
        } catch (Throwable t) {
        }
    }

    private static void syncInjectScript() {
        try {
            File ts = new File(SCRIPT_TS);
            long last = ts.isFile() ? ts.lastModified() : 0L;
            if (last > 0 && System.currentTimeMillis() - last < SYNC_INTERVAL_MS) {
                File dst = new File(SCRIPT_PATH);
                if (dst.isFile() && dst.length() > 1024) return;   // 已有且新鲜，跳过
            }

            java.net.HttpURLConnection conn =
                    (java.net.HttpURLConnection) new java.net.URL(SCRIPT_URL).openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("User-Agent", "HM-MiniGame-Tool");
            int code = conn.getResponseCode();
            if (code != 200) {
                XposedBridge.log(TAG + ": script fetch http " + code);
                return;
            }
            java.io.InputStream in = conn.getInputStream();
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
            byte[] body = bos.toByteArray();

            // 校验：必须是我们的脚本，否则宁可不写
            String text = new String(body, "UTF-8");
            if (!text.contains("__hmw")) {
                XposedBridge.log(TAG + ": script rejected (no marker)");
                return;
            }

            File dst = new File(SCRIPT_PATH);
            if (dst.isFile() && dst.length() == body.length) {
                touchTs(ts);
                return;                                     // 内容长度一致，视为已是最新
            }
            // 先写临时文件再改名：避免 native 层读到写了一半的内容
            File tmp = new File(SCRIPT_PATH + ".tmp");
            java.io.FileOutputStream out = new java.io.FileOutputStream(tmp);
            out.write(body);
            out.close();
            if (!tmp.renameTo(dst)) {
                XposedBridge.log(TAG + ": script rename failed");
                return;
            }
            touchTs(ts);
            XposedBridge.log(TAG + ": script synced " + body.length + " bytes -> " + SCRIPT_PATH);
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": script sync failed -> " + t);
        }
    }

    /**
     * 注册「立即同步脚本」的广播接收器。
     *
     * App 没有权限写游戏目录（su 会被 KernelSU 的 App Profile 限制），
     * 但模块跑在游戏进程里、身份就是游戏自己，写自己的目录没问题。
     * 所以让 App 发广播，由模块在这里拉脚本 —— 全程不需要 root。
     */
    private static void registerSyncReceiver() {
        try {
            XposedBridge.hookAllMethods(android.app.Application.class, "onCreate",
                    new XC_MethodHook() {
                        @Override protected void beforeHookedMethod(MethodHookParam param) {
                            try {
                                android.content.Context ctx = (android.content.Context) param.thisObject;
                                android.content.BroadcastReceiver rc = new android.content.BroadcastReceiver() {
                                    @Override public void onReceive(android.content.Context c, android.content.Intent in) {
                                        if (SYNC_ACTION.equals(in.getAction())) {
                                            XposedBridge.log(TAG + ": 收到同步请求");
                                            syncInjectScript();
                                        }
                                    }
                                };
                                android.content.IntentFilter fl =
                                        new android.content.IntentFilter(SYNC_ACTION);
                                /*
                                 * Android 14 起必须显式指定导出标志，否则抛 SecurityException。
                                 * 这里必须用 RECEIVER_EXPORTED：接收器的组件属于模块 APK，
                                 * 而发送方（App）与游戏进程不同 UID，
                                 * 用 NOT_EXPORTED 的话广播根本收不到。
                                 * 安全性没问题 —— 广播只能触发「重新拉取固定 URL 的脚本」。
                                 */
                                if (android.os.Build.VERSION.SDK_INT >= 33) {
                                    ctx.registerReceiver(rc, fl, android.content.Context.RECEIVER_EXPORTED);
                                } else {
                                    ctx.registerReceiver(rc, fl);
                                }
                                XposedBridge.log(TAG + ": 同步广播接收器已注册");
                            } catch (Throwable t) {
                                XposedBridge.log(TAG + ": 注册同步接收器失败 -> " + t);
                            }
                        }
                    });
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": hook Application.onCreate 失败 -> " + t);
        }
    }

    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lp) {
        if (!"tv.danmaku.bili".equals(lp.packageName)) return;

        XposedBridge.log(TAG + ": v16 loaded in " + lp.packageName + " process=" + lp.processName);

        // 总闸：关闭时模块只打一行日志，不做任何挂钩、不写任何文件、不加载 gadget。
        // 用于确认「游戏卡在加载资源中」是否由模块行为引起。
        if (!MASTER) return;

        // 只在主进程装 gadget：:web / :download / :pushservice 也装过，
        // 那几个进程里挂 Interceptor 极可能拖死小游戏加载，逐一排除。
        boolean wantProc = "tv.danmaku.bili".equals(lp.processName)
                || "tv.danmaku.bili:web".equals(lp.processName);
        if (GADGET_ENABLED && wantProc) {
            // 必须异步：handleLoadPackage 在主线程，等待 Context 会直接 ANR
            final String proc = lp.processName;
            Thread gt = new Thread(new Runnable() {
                @Override public void run() { loadGadget(proc); }
            }, "HMHook-gadget");
            gt.setDaemon(true);
            gt.start();
        }

        if (HTML_HOOK) hookHtmlWriters(lp.classLoader);
        if (WV_PROBE) hookWebViewLoaders(lp.classLoader);

        if (lp.processName.endsWith(":web")) {
            registerSyncReceiver();
        }

        if (NATIVE_TEST && lp.processName.endsWith(":web")) {
            Thread nt = new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        // 先把最新脚本同步到位，native 层加载时就能读到
                        syncInjectScript();
                        File src = new File("/storage/emulated/0/Android/data/tv.danmaku.bili/files/libhmshim.so");
                        File dir = new File("/data/data/tv.danmaku.bili/files");
                        File dst = new File(dir, "libhmshim.so");
                        if (!dst.isFile() || dst.length() != src.length()) {
                            java.io.InputStream in = new java.io.FileInputStream(src);
                            java.io.FileOutputStream out = new java.io.FileOutputStream(dst);
                            byte[] b = new byte[8192];
                            int n;
                            while ((n = in.read(b)) > 0) out.write(b, 0, n);
                            out.close(); in.close();
                        }
                        System.load(dst.getAbsolutePath());
                        XposedBridge.log(TAG + ": 自研 .so 已加载 (web) len=" + dst.length());
                    } catch (Throwable t) {
                        XposedBridge.log(TAG + ": 自研 .so 加载失败 -> " + t);
                    }
                }
            }, "HMHook-native");
            nt.setDaemon(true);
            nt.start();
        }

        if (STORAGE_DUMP && "tv.danmaku.bili".equals(lp.processName)) {
            Thread st = new Thread(new Runnable() {
                @Override public void run() { dumpStorage(); }
            }, "HMHook-storage");
            st.setDaemon(true);
            st.start();
        }

        // 只开 WebView 远程调试：不注入原生库、不改文件、不碰 V8
        enableWebViewDebug(lp.classLoader);
        startWebViewDebugRetry(lp.classLoader);
        hookSystemWebView(lp.classLoader);

        if (FILE_PATCH) {
            tryPatchApplets("startup");
            patchShellHtml("startup");
            logPkgInfo();
        }
        if (JAVA_HOOKS) {
            hookRunScript(lp.classLoader);
            hookDebug(lp.classLoader);
            startPayloadRunner();
        }
    }

    /** 15ms 轮询：小游戏容器按需解包，必须在它读完文件之前把补丁写进去 */
    private void startFastPatcher() {
        if (true) return;   // 已证明文件注入无效，停掉 15ms 轮询，避免多进程争抢同一文件
        if (fastPatchStarted) return;
        fastPatchStarted = true;
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                long end = System.currentTimeMillis() + 20 * 60 * 1000L;
                while (System.currentTimeMillis() < end) {
                    try {
                        patchShellHtml("poll");
                    } catch (Throwable ignored) { }
                    try { Thread.sleep(15); } catch (InterruptedException e) { return; }
                }
            }
        }, "HMHook-patcher");
        t.setDaemon(true);
        t.start();
    }

    /**
     * 往小程序包里的 JS 入口追加探针。
     *
     * 用 Java 文件 I/O 而不是 shell：本进程就是 tv.danmaku.bili，
     * 拥有 app_data_file 的完整 SELinux 权限；root shell 会被类别集挡住。
     */
    private void tryPatchApplets(String why) {
        File root = new File(APPLET_ROOT);
        File[] applets = root.listFiles();
        if (applets != null) {
            for (File applet : applets) {
                File[] versions = applet.listFiles();
                if (versions == null) continue;
                for (File v : versions) {
                    patchOne(new File(v, "game.js"), "game", why);
                    patchOne(new File(v, "application.js"), "app", why);
                }
            }
        }
        if ("startup".equals(why)) {
            // 原始包目录也可能是容器真正读取的位置，一并补上
            deepPatch(new File(PKG_ROOT), 0, why);
        }
    }

    private void deepPatch(File dir, int depth, String why) {
        if (depth > 3 || dir == null) return;
        File[] items = dir.listFiles();
        if (items == null) return;
        for (File it : items) {
            if (it.isDirectory()) {
                deepPatch(it, depth + 1, why);
            } else {
                String n = it.getName();
                if ("game.js".equals(n)) patchOne(it, "game", why);
                else if ("application.js".equals(n)) patchOne(it, "app", why);
            }
        }
    }

    private void patchOne(File f, String src, String why) {
        if (!PATCH_JS) return;
        if (!f.isFile()) return;
        String text = readAll(f);
        if (text == null) return;
        if (text.contains(MARK_JS)) return;
        if ("game".equals(src) && !text.contains("__biliLaunchT0")) return;
        if ("app".equals(src) && !text.contains("Application")) return;
        if (writeAll(f, text + buildPatch(src))) {
            XposedBridge.log(TAG + ": patched[" + why + "] " + f.getAbsolutePath()
                    + " size=" + f.length() + " t=" + System.currentTimeMillis());
        }
    }

    /** 记录小程序包归档信息，判断容器到底从哪儿取代码 */
    private void logPkgInfo() {
        try {
            File dir = new File(PKG_ROOT, "biligame033733dcbd10ae9f");
            XposedBridge.log(TAG + ": pkgdir " + dir.getAbsolutePath()
                    + " exists=" + dir.exists() + " isDir=" + dir.isDirectory());
            listTree(dir, 0, new int[]{60});

            File cached = new File(APPLET_ROOT,
                    "biligame033733dcbd10ae9f_min_playable/1-0/game.js");
            String text = readAll(cached);
            if (text == null) {
                XposedBridge.log(TAG + ": cached game.js unreadable");
            } else {
                XposedBridge.log(TAG + ": cached game.js len=" + text.length()
                        + " marked=" + text.contains(MARK_JS)
                        + " head=" + text.substring(0, Math.min(40, text.length())).replace('\n', ' '));
            }

            // 归档形态探测：preinstall 里的 1-0 到底是目录还是压缩包
            File pre = new File("/data/data/tv.danmaku.bili/app_mod_resource/preinstall/applet",
                    "biligame033733dcbd10ae9f_min_playable/1-0");
            XposedBridge.log(TAG + ": preinstall 1-0 dir=" + pre.isDirectory()
                    + " file=" + pre.isFile() + " size=" + pre.length());
            if (pre.isFile()) {
                byte[] head = readHead(pre, 32);
                if (head != null) {
                    StringBuilder hex = new StringBuilder();
                    for (byte b : head) hex.append(String.format("%02x", b));
                    XposedBridge.log(TAG + ": preinstall head=" + hex);
                }
            }

            if (text != null && text.startsWith(SABOTAGE_HEAD)) {
                if (writeAll(cached, text.substring(SABOTAGE_HEAD.length()))) {
                    XposedBridge.log(TAG + ": sabotage removed, len=" + cached.length());
                }
            }
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": pkg info error -> " + t);
        }
    }

    private static final String SABOTAGE_HEAD = "throw new Error('HMSABOTAGE');\n";

    /** 小游戏外壳页目录（不同版本命名不一样，两个都试） */
    private static final String[] BASE_GAME_DIRS = {
            "/data/data/tv.danmaku.bili/files/smallgameGame/base_game",
            "/data/data/tv.danmaku.bili/files/smallappGame/base_game"
    };

    /**
     * 往外壳页里插的探针。
     *
     * shell.game.html / subContext.html 是容器每次启动时生成的页面，
     * 如果它们真的是游戏的文档，这段脚本就会在游戏自己的 JS 上下文里执行。
     */
    private static final String HTML_PROBE =
            "<script>try{var T=String.fromCharCode(72,77,71,83,57,70,51,65)+':';"
            + "var s='href='+location.href+'|cc='+(typeof cc)+'|GG='+(typeof GameGlobal)"
            + "+'|keys='+Object.keys(window).slice(0,60).join(',');"
            + "var B=new Uint8Array(4096);"
            + "for(var i=0;i<T.length;i++)B[i]=T.charCodeAt(i);"
            + "for(var i=0;i<s.length&&i<4000;i++){var c=s.charCodeAt(i);B[T.length+i]=(c<256)?c:63;}"
            + "window.__hmg=B;}catch(e){}</script>";

    private static final String HTML_MARK = "fromCharCode(72,77,71,83";

    /** 给外壳页打补丁：文件必须写完（以 </html> 结尾）才动手，避免写到一半被截断 */
    private void patchShellHtml(String why) {
        for (String d : BASE_GAME_DIRS) {
            File dir = new File(d);
            if (!dir.isDirectory()) continue;
            File[] items = dir.listFiles();
            if (items == null) continue;
            for (File f : items) {
                String n = f.getName();
                if (!n.endsWith(".html")) continue;
                String text = readAll(f);
                if (text == null || text.contains(HTML_MARK)) continue;
                if (!text.trim().endsWith("</html>") || !text.contains("</body>")) continue;
                int cut = text.lastIndexOf("</head>");
                if (cut < 0) continue;
                String out = text.substring(0, cut) + HTML_PROBE + text.substring(cut);
                if (writeAll(f, out)) {
                    XposedBridge.log(TAG + ": html[" + why + "] " + n + " size=" + f.length());
                }
            }
        }
    }

    /**
     * 打开 WebView 远程调试。
     *
     * 实测：小游戏由 files/smallGame/base_game/shell.game.html 承载，
     * 游戏跑在 WebView（iframe → subContext.html）里，不是直接在 libMiniEngine 的 V8 中。
     * 一旦 devtools 通道打开，就能用 CDP 的 Runtime.evaluate 直接读写游戏变量。
     */
    private void enableWebViewDebug(final ClassLoader cl) {
        // 系统 WebView 要求在 UI 线程切换调试开关，否则抛 RuntimeException
        try {
            final Class<?> wv = Class.forName("android.webkit.WebView", false, cl);
            new android.os.Handler(android.os.Looper.getMainLooper()).post(new Runnable() {
                @Override public void run() {
                    try {
                        Method m = wv.getMethod("setWebContentsDebuggingEnabled", boolean.class);
                        m.invoke(null, Boolean.TRUE);
                        if (!wvDebugOn) {
                            wvDebugOn = true;
                            XposedBridge.log(TAG + ": webview debug ON (system)");
                        }
                    } catch (Throwable t) {
                        Throwable c = (t.getCause() != null) ? t.getCause() : t;
                        XposedBridge.log(TAG + ": webview debug miss (system/UI) -> " + c);
                    }
                }
            });
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": webview class miss -> " + t);
        }
        try {
            Class<?> x5 = XposedHelpers.findClass("com.tencent.smtt.sdk.WebView", cl);
            Method m = x5.getMethod("setWebContentsDebuggingEnabled", boolean.class);
            m.invoke(null, Boolean.TRUE);
            if (!x5DebugOn) {
                x5DebugOn = true;
                XposedBridge.log(TAG + ": webview debug ON (x5)");
            }
        } catch (Throwable t) {
            Throwable c = (t.getCause() != null) ? t.getCause() : t;
            XposedBridge.log(TAG + ": webview debug miss (x5) -> " + c);
        }
    }

    private static volatile boolean wvDebugOn = false;
    private static volatile boolean x5DebugOn = false;

    /** 抓到的系统 WebView 实例 */
    private static final List<WeakReference<Object>> webViews = new ArrayList<>();
    private static volatile boolean wvInjectStarted = false;

    /** 记录 WebView 创建，然后定期用 evaluateJavascript 在里面跑探针 */
    private void hookSystemWebView(ClassLoader cl) {
        try {
            Class<?> wv = XposedHelpers.findClass("android.webkit.WebView", cl);
            XposedBridge.hookAllConstructors(wv, new XC_MethodHook() {
                @Override protected void afterHookedMethod(MethodHookParam param) {
                    Object o = param.thisObject;
                    synchronized (webViews) { webViews.add(new WeakReference<>(o)); }
                    XposedBridge.log(TAG + ": webview created size=" + webViews.size());
                }
            });
            XposedBridge.hookAllMethods(wv, "loadUrl", new XC_MethodHook() {
                @Override protected void afterHookedMethod(MethodHookParam param) {
                    Object a0 = (param.args != null && param.args.length > 0) ? param.args[0] : null;
                    XposedBridge.log(TAG + ": loadUrl " + String.valueOf(a0).substring(
                            0, Math.min(80, String.valueOf(a0).length())));
                }
            });
            XposedBridge.log(TAG + ": hooked system WebView");
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": system WebView hook miss -> " + t);
        }
    }

    private static final String JS_PROBE =
            "(function(){try{var o={href:location.href,rs:document.readyState,"
            + "cc:typeof cc,GG:typeof GameGlobal,wx:typeof wx,"
            + "keys:Object.keys(window).slice(0,80)};"
            + "try{o.ifr=document.querySelectorAll('iframe').length;}catch(e){}"
            + "return JSON.stringify(o);}catch(e){return 'ERR:'+e.message}})()";

    private void startWebViewInject() {
        if (true) return;   // 游戏不在 WebView 里，停掉探针轮询
        if (wvInjectStarted) return;
        wvInjectStarted = true;
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                for (int round = 0; round < 120; round++) {
                    try { Thread.sleep(3000); } catch (InterruptedException e) { return; }
                    List<Object> list = new ArrayList<>();
                    synchronized (webViews) {
                        for (WeakReference<Object> r : webViews) {
                            Object o = r.get();
                            if (o != null) list.add(o);
                        }
                    }
                    for (Object wv : list) {
                        evalIn(wv, JS_PROBE);
                    }
                }
            }
        }, "HMHook-wvinject");
        t.setDaemon(true);
        t.start();
    }

    /** 在指定 WebView 里执行 JS，结果走回调打日志。WebView 方法必须在主线程调用。 */
    private void evalIn(final Object wv, final String js) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() {
                try {
                    Method m = wv.getClass().getMethod("evaluateJavascript",
                            String.class, android.webkit.ValueCallback.class);
                    m.setAccessible(true);
                    m.invoke(wv, js, new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String value) {
                            XposedBridge.log(TAG + ": JS " + (value == null ? "null"
                                    : value.substring(0, Math.min(1500, value.length()))));
                        }
                    });
                } catch (Throwable t) {
                    Throwable c = (t.getCause() != null) ? t.getCause() : t;
                    XposedBridge.log(TAG + ": evalIn failed -> " + c);
                }
            }
        });
    }

    /**
     * 反复重试打开调试：WebView 提供者要等 zygote 拉起后才可用，
     * 进程刚 fork 出来时调用会抛 InvocationTargetException。
     */
    private void startWebViewDebugRetry(final ClassLoader cl) {
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                for (int i = 0; i < 60; i++) {
                    try { Thread.sleep(2000); } catch (InterruptedException e) { return; }
                    enableWebViewDebug(cl);
                }
            }
        }, "HMHook-wvdebug");
        t.setDaemon(true);
        t.start();
    }

    private static byte[] readHead(File f, int n) {
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            byte[] buf = new byte[n];
            int got = 0;
            while (got < n) {
                int r = in.read(buf, got, n - got);
                if (r <= 0) break;
                got += r;
            }
            byte[] out = new byte[got];
            System.arraycopy(buf, 0, out, 0, got);
            return out;
        } catch (Throwable t) {
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) { }
        }
    }

    private void listTree(File dir, int depth, int[] budget) {
        if (budget[0] <= 0 || dir == null) return;
        File[] items = dir.listFiles();
        if (items == null) {
            XposedBridge.log(TAG + ": tree " + dir.getName() + " unreadable");
            return;
        }
        for (File it : items) {
            if (budget[0]-- <= 0) return;
            StringBuilder sb = new StringBuilder("tree ");
            for (int i = 0; i < depth; i++) sb.append("  ");
            sb.append(it.getName());
            if (it.isDirectory()) {
                sb.append("/");
                XposedBridge.log(TAG + ": " + sb);
                if (depth < 2) listTree(it, depth + 1, budget);
            } else {
                sb.append(" ").append(it.length());
                XposedBridge.log(TAG + ": " + sb);
            }
        }
    }

    private static String readAll(File f) {
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Throwable t) {
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) { }
        }
    }

    private static boolean writeAll(File f, String text) {
        FileOutputStream out = null;
        try {
            out = new FileOutputStream(f, false);
            out.write(text.getBytes("UTF-8"));
            out.flush();
            return true;
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": write error -> " + t);
            return false;
        } finally {
            try { if (out != null) out.close(); } catch (Throwable ignored) { }
        }
    }

    /** 捕获每一个 V8Engine 实例，并记录脚本加载序列 */
    private void hookRunScript(ClassLoader cl) {
        try {
            Class<?> v8 = XposedHelpers.findClass("com.bilibili.lib.v8.V8Engine", cl);
            XposedBridge.hookAllMethods(v8, "runScript", new XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) {
                    synchronized (engines) {
                        boolean found = false;
                        for (Object o : engines) {
                            if (o == param.thisObject) { found = true; break; }
                        }
                        if (!found) {
                            engines.add(param.thisObject);
                            XposedBridge.log(TAG + ": engine#" + engines.size() + " discovered");
                        }
                    }
                    if (scriptLogs < 40 && param.args != null && param.args.length > 0
                            && param.args[0] instanceof String) {
                        String script = (String) param.args[0];
                        if (script.length() > 2000) {
                            scriptLogs++;
                            String name = param.args.length > 1 ? String.valueOf(param.args[1]) : "?";
                            XposedBridge.log(TAG + ": script '" + name + "' len=" + script.length());
                        }
                    }
                }
            });
            XposedBridge.log(TAG + ": hooked V8Engine#runScript");
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": runScript miss -> " + t);
        }
    }

    /** 把 V8 的调试开关强行打开（引擎初始化时传的是 false） */
    private void hookDebug(ClassLoader cl) {
        try {
            Class<?> v8 = XposedHelpers.findClass("com.bilibili.lib.v8.V8Engine", cl);
            XposedBridge.hookAllMethods(v8, "debug", new XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) {
                    if (param.args != null && param.args.length == 1
                            && param.args[0] instanceof Boolean) {
                        param.args[0] = Boolean.TRUE;
                    }
                }
            });
            XposedBridge.log(TAG + ": hooked V8Engine#debug");
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": debug miss -> " + t);
        }
    }

    /** 对每个引擎实例用全新脚本名执行 payload */
    private void startPayloadRunner() {
        if (runnerStarted) return;
        runnerStarted = true;

        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                int runs = 0;
                while (runs <= 60) {
                    try {
                        Thread.sleep(runs < 6 ? 3000 : 20000);
                    } catch (InterruptedException e) {
                        return;
                    }
                    List<Object> snapshot;
                    synchronized (engines) {
                        snapshot = new ArrayList<>(engines);
                    }
                    for (int ei = 0; ei < snapshot.size(); ei++) {
                        Object engine = snapshot.get(ei);
                        try {
                            for (Method m : engine.getClass().getMethods()) {
                                if (!"runScript".equals(m.getName())) continue;
                                if (m.getParameterTypes().length != 3) continue;
                                String name = "hm_probe_" + ei + "_" + System.nanoTime();
                                m.setAccessible(true);
                                m.invoke(engine, PAYLOAD, name, null);
                                runs++;
                            }
                        } catch (Throwable e) {
                            XposedBridge.log(TAG + ": payload failed engine#" + (ei + 1) + " -> " + e);
                        }
                    }
                }
            }
        }, "HMHook-payload");
        t.setDaemon(true);
        t.start();
    }

    /**
     * 把 frida-gadget 从模块 APK 里解出来加载。
     *
     * 不用 frida-server 附加：B 站有反调试，attach 会让进程自杀。
     * gadget 由进程自己 dlopen，不产生 ptrace 关系。
     */
    private void loadGadget(String procName) {
        try {
            // 包可见性限制让 getPackageInfo 查不到自己的模块包，改从 /proc/self/maps 里找
            // 应用专属外置目录：不需要任何存储权限就能读
            File src = new File("/storage/emulated/0/Android/data/tv.danmaku.bili/files/libfrida_gadget.so");
            if (!src.isFile()) src = new File("/sdcard/Android/data/tv.danmaku.bili/files/libfrida_gadget.so");
            XposedBridge.log(TAG + ": gadget 源 exists=" + src.isFile() + " size=" + src.length());
            if (!src.isFile()) return;

            File dir = new File("/data/data/tv.danmaku.bili/files");
            String suffix = "";
            int port = 27043;
            if (!"tv.danmaku.bili".equals(procName) && procName.contains(":")) {
                String sub = procName.substring(procName.indexOf(':') + 1);
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < sub.length(); i++) {
                    char ch = sub.charAt(i);
                    sb.append(Character.isLetterOrDigit(ch) ? ch : '_');
                }
                suffix = "_" + sb;
                port = 27043 + Math.abs(sb.toString().hashCode() % 40) + 1;
            }
            boolean isWeb = procName.endsWith(":web");
            String base = isWeb ? "libhmshim" : ("libfrida_gadget" + suffix);
            File so = new File(dir, base + ".so");
            File cfg = new File(dir, base + ".config");
            XposedBridge.log(TAG + ": gadget proc=" + procName + " port=" + port + " so=" + so.getName());

            if (!so.exists() || so.length() < 1024) {
                // 同一份文件硬链接，避免每个进程都占 39MB
                if (new File(dir, "libfrida_gadget.so").isFile() && suffix.length() > 0) {
                    try {
                        java.nio.file.Files.createLink(so.toPath(),
                                new File(dir, "libfrida_gadget.so").toPath());
                    } catch (Throwable t2) {
                        XposedBridge.log(TAG + ": 硬链接失败 " + t2);
                    }
                }
                if (so.exists()) { }
                else {
                java.io.InputStream in = new java.io.FileInputStream(src);
                FileOutputStream out = new FileOutputStream(so);
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                out.close(); in.close();
                }
            }

            String json = "{\"interaction\":{\"type\":\"listen\",\"address\":\"127.0.0.1\","
                    + "\"port\":" + port + ",\"on_load\":\"resume\"}}";
            FileOutputStream cf = new FileOutputStream(cfg);
            cf.write(json.getBytes("UTF-8"));
            cf.close();

            System.load(so.getAbsolutePath());
            XposedBridge.log(TAG + ": gadget loaded size=" + so.length());
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": gadget 失败 -> " + t);
        }
    }

    /** 只读：列出小游戏存储目录，找出存档文件 */
    private void dumpStorage() {
        String base = "/data/data/tv.danmaku.bili/files/smallappGame";
        String appid = "biligame033733dcbd10ae9f";
        String[] roots = {"appsStorage/" + appid, "AppData/" + appid};
        for (int r = 0; r < roots.length; r++) {
            File d = new File(base, roots[r]);
            if (!d.isDirectory()) {
                XposedBridge.log(TAG + ": [store] 缺失 " + roots[r]);
                continue;
            }
            XposedBridge.log(TAG + ": [store] 遍历 " + roots[r]);
            walk(d, 8, 0);
        }
    }

    /** 深度受限的遍历，只记录最近修改的文件并读小文件头部 */
    private static int walked = 0;

    private void walk(File f, int maxDepth, int depth) {
        if (depth > maxDepth) return;
        File[] kids = f.listFiles();
        if (kids == null) return;
        for (File k : kids) {
            if (k.isDirectory()) {
                walk(k, maxDepth, depth + 1);
                continue;
            }
            long len = k.length();
            long ageMin = (System.currentTimeMillis() - k.lastModified()) / 60000L;
            if (++walked > 600) return;
            String head = "";
            if (len > 0 && len <= 262144) {
                try {
                    byte[] buf = new byte[(int) len];
                    java.io.FileInputStream in = new java.io.FileInputStream(k);
                    int n = in.read(buf);
                    in.close();
                    String txt = new String(buf, 0, Math.max(n, 0), "UTF-8");
                    head = txt.replace(String.valueOf((char) 10), " ").substring(0, Math.min(220, txt.length()));
                } catch (Throwable ignored) { }
            }
            XposedBridge.log(TAG + ": [file] " + k.getAbsolutePath()
                    + " len=" + len + " age=" + ageMin + "m head=" + head);
        }
    }

    /** 追加到外壳页末尾的探针：标记在运行时拼装，dex 里不存在该字面量 */
    private static final String HTML_PATCH =
            ";try{(function(){"
            + "var G=(typeof globalThis!=='undefined')?globalThis:this;"
            + "if(G.__hmgv==='9F3A')return;"
            + "G.__hmgv='9F3A';"
            + "if(typeof console!=='undefined'&&console.log){console.log('HMGS exec ok');}"
            + "}catch(e){}})();" + String.valueOf((char) 10);

    /**
     * 容器每次启动都会重新生成 subContext.html / shell.game.html。
     * 轮询补丁抢不过它，所以改成在写入流关闭的那一刻追加。
     */
    private void hookHtmlWriters(ClassLoader cl) {
        try {
            de.robv.android.xposed.XposedBridge.hookAllConstructors(
                    java.io.FileOutputStream.class, new de.robv.android.xposed.XC_MethodHook() {
                        @Override protected void afterHookedMethod(MethodHookParam p) {
                            try {
                                Object a0 = p.args[0];
                                String path = (a0 instanceof File)
                                        ? ((File) a0).getAbsolutePath() : String.valueOf(a0);
                                de.robv.android.xposed.XposedHelpers
                                        .setAdditionalInstanceField(p.thisObject, "hmPath", path);
                            } catch (Throwable ignored) { }
                        }
                    });

            de.robv.android.xposed.XposedBridge.hookAllMethods(
                    java.io.FileOutputStream.class, "close", new de.robv.android.xposed.XC_MethodHook() {
                        @Override protected void afterHookedMethod(MethodHookParam p) {
                            try {
                                Object v = de.robv.android.xposed.XposedHelpers
                                        .getAdditionalInstanceField(p.thisObject, "hmPath");
                                if (!(v instanceof String)) return;
                                String path = (String) v;
                                if (path.endsWith("/subContext.html")
                                        || path.endsWith("/shell.game.html")) {
                                    appendPatch(path);
                                }
                            } catch (Throwable ignored) { }
                        }
                    });

            de.robv.android.xposed.XposedBridge.log(TAG + ": 已挂钩外壳页写入");
        } catch (Throwable t) {
            de.robv.android.xposed.XposedBridge.log(TAG + ": 外壳页钩子失败 -> " + t);
        }
    }

    /** 幂等插入：塞到最后一个 </script> 之前，确保引擎解析时能执行到 */
    private static volatile boolean patching = false;

    private void appendPatch(String path) {
        if (patching) return;
        patching = true;
        try {
            File f = new File(path);
            if (!f.isFile()) return;
            String text = readAll(f);
            if (text == null || text.contains("__hmgv")) return;
            int at = text.lastIndexOf("</script>");
            String outText;
            if (at > 0) {
                outText = text.substring(0, at) + HTML_PATCH + text.substring(at);
            } else {
                outText = text + HTML_PATCH;
            }
            java.io.FileOutputStream out2 = new java.io.FileOutputStream(f, false);
            out2.write(outText.getBytes("UTF-8"));
            out2.close();
            de.robv.android.xposed.XposedBridge.log(TAG + ": 外壳页已注入 " + path
                    + " at=" + at + " 新长度=" + f.length());
        } catch (Throwable t) {
            de.robv.android.xposed.XposedBridge.log(TAG + ": 注入失败 " + path + " -> " + t);
        } finally {
            patching = false;
        }
    }

    private String tailOf(File f, int n) {
        try {
            java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r");
            long len = raf.length();
            long from = Math.max(0, len - n);
            raf.seek(from);
            byte[] buf = new byte[(int) (len - from)];
            raf.readFully(buf);
            raf.close();
            return new String(buf, "UTF-8");
        } catch (Throwable t) {
            return "";
        }
    }

    /** 挂系统 WebView 与 X5 的所有载入方法，判断游戏 HTML 的入口 */
    private void hookWebViewLoaders(ClassLoader cl) {
        String[] classes = {"android.webkit.WebView", "com.tencent.smtt.sdk.WebView"};
        String[] methods = {"loadUrl", "loadData", "loadDataWithBaseURL"};
        for (int i = 0; i < classes.length; i++) {
            final String cn = classes[i];
            try {
                Class<?> c = de.robv.android.xposed.XposedHelpers.findClass(cn, cl);
                for (int j = 0; j < methods.length; j++) {
                    final String mn = methods[j];
                    de.robv.android.xposed.XposedBridge.hookAllMethods(c, mn,
                            new de.robv.android.xposed.XC_MethodHook() {
                                @Override protected void beforeHookedMethod(MethodHookParam p) {
                                    try {
                                        String s = pick(p.args);
                                        if (s != null) {
                                            de.robv.android.xposed.XposedBridge.log(
                                                    TAG + ": [wv] " + cn + "#" + mn + " " + s);
                                        }
                                    } catch (Throwable ignored) { }
                                }
                            });
                }
                de.robv.android.xposed.XposedBridge.log(TAG + ": 挂钩 " + cn);
            } catch (Throwable t) {
                de.robv.android.xposed.XposedBridge.log(TAG + ": " + cn + " 不可用");
            }
        }
    }

    /** 从参数里挑出最有信息量的字符串 */
    private String pick(Object[] args) {
        if (args == null) return null;
        String best = null;
        for (int i = 0; i < args.length; i++) {
            Object a = args[i];
            if (!(a instanceof String)) continue;
            String v = (String) a;
            if (v.length() > 200 || v.contains("<html") || v.contains("subContext")
                    || v.contains("shell.game")) {
                best = "arg" + i + " len=" + v.length() + " head="
                        + v.substring(0, Math.min(90, v.length())).replace(String.valueOf((char) 10), " ");
                if (v.contains("subContext") || v.contains("shell.game")) return best;
            }
        }
        if (best != null) return best;
        for (int i = 0; i < args.length && i < 3; i++) {
            if (args[i] instanceof String) {
                String v = (String) args[i];
                return "arg" + i + " " + v.substring(0, Math.min(70, v.length()));
            }
        }
        return null;
    }
}
