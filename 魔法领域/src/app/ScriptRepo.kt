package com.hm.xposed

import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * 注入脚本的下载与部署。
 *
 * 为什么要走这一套：
 *   注入脚本（inj.js）原本是编译进 libhmshim.so 的，改一次脚本就要重新
 *   编译 .so 并重新分发。现在 native 层改成**运行时从磁盘读脚本**，
 *   所以更新脚本只要把新的 inj.js 放到约定路径、重启游戏即可生效 ——
 *   不用重编译 .so，也不用更新 App。
 *
 * 约定路径（native 层按顺序找）：
 *   /data/data/tv.danmaku.bili/files/hm_inject.js      ← 首选
 *   /storage/emulated/0/Android/data/tv.danmaku.bili/files/hm_inject.js
 *   /data/local/tmp/hm_inject.js
 */
object ScriptRepo {

    private const val TAG = "HMScript"

    /** 与模块约定的同步广播 */
    private const val SYNC_ACTION = "com.hm.xposed.SYNC_SCRIPT"

    /** 目标路径：游戏自己的 files 目录，native 层能读 */
    const val TARGET = "/data/data/tv.danmaku.bili/files/hm_inject.js"

    /** 目标目录（属主要从这里取） */
    private const val TARGET_DIR = "/data/data/tv.danmaku.bili/files"

    /** 常见 su 路径。KernelSU 的 sucompat 会对已授权者呈现 /system/bin/su */
    private val SU_PATHS = listOf(
        "/system/bin/su",
        "/system/xbin/su",
        "/vendor/bin/su",
        "/su/bin/su",
        "su",
    )

    /** 常见的 root 管理器包名，用来引导用户去授权 */
    private val MANAGERS = listOf(
        "com.sukisu.ultra",          // SukiSU Ultra
        "me.weishu.kernelsu",        // KernelSU 官方
        "com.rifsnow.ksunext",       // KernelSU Next
        "io.github.magisk317.xinyi.relay",
        "com.topjohnwu.magisk",
    )

    /** root 授权状态 */
    enum class RootStatus {
        UNKNOWN,      // 还没检测过
        NO_MANAGER,   // 没有 root 管理器（找不到 su）
        DENIED,       // 有 su 但没被授权
        GRANTED,      // 已授权，可以提权
    }

    data class RootInfo(
        val status: RootStatus,
        val detail: String,
        val suPath: String?,
    )

    /** su 执行的一次尝试 */
    private sealed class Attempt {
        /** 跑起来了 */
        data class Ran(val code: Int, val out: String) : Attempt()
        /** 这个路径没有可执行的 su */
        object Missing : Attempt()
        /** su 存在但被内核/管理器拦下（典型：KernelSU 未授权） */
        object Blocked : Attempt()
    }

    // ------------------------------------------------------------ root 检测

    /**
     * 检测 root 授权状态。
     *
     * KernelSU 用的是**白名单机制**：没被授权的 App 连 su 都感知不到 ——
     * exec 会直接失败，而不是弹窗。所以这里要分清三种失败：
     *   路径不存在  → 没装 root 管理器
     *   被拦下      → 装了但没授权本 App（需要去管理器里点允许）
     *   跑起来非 0  → 授权了但命令失败
     */
    suspend fun checkRoot(): RootInfo = withContext(Dispatchers.IO) {
        var sawBinary = false
        var blocked = false
        for (p in SU_PATHS) {
            try {
                if (File(p).exists()) sawBinary = true
            } catch (e: Exception) {
            }
            when (val a = attempt(p, "id")) {
                is Attempt.Ran -> {
                    if (a.code == 0 && a.out.contains("uid=0")) {
                        Log.i(TAG, "root granted via $p")
                        return@withContext RootInfo(RootStatus.GRANTED, "已授权", p)
                    }
                    val msg = a.out.trim()
                    Log.w(TAG, "root denied via $p: $msg")
                    return@withContext RootInfo(
                        RootStatus.DENIED,
                        msg.ifBlank { "su 返回 ${a.code}" },
                        p,
                    )
                }
                is Attempt.Blocked -> blocked = true
                is Attempt.Missing -> {}
            }
        }
        when {
            blocked -> RootInfo(RootStatus.DENIED, "su 被拒绝执行，需要在 root 管理器里授权", null)
            sawBinary -> RootInfo(RootStatus.DENIED, "检测到 su 但无法提权", null)
            else -> RootInfo(RootStatus.NO_MANAGER, "未检测到 root 管理器", null)
        }
    }

    /** 执行一次 root 命令，区分「没这路径」和「被拦下」 */
    private fun attempt(suPath: String, cmd: String): Attempt = try {
        val pb = ProcessBuilder(suPath, "-c", cmd)
        // 合并 stderr，避免两个管道互相堵死
        pb.redirectErrorStream(true)
        val p = pb.start()
        val out = p.inputStream.bufferedReader().readText()
        val code = p.waitFor()
        Attempt.Ran(code, out)
    } catch (e: Exception) {
        val msg = (e.message ?: "").lowercase()
        Log.i(TAG, "su $suPath failed: ${e.javaClass.simpleName}: ${e.message}")
        if (msg.contains("no such file") || msg.contains("not found")) Attempt.Missing
        else Attempt.Blocked
    }

    // ------------------------------------------------------------ 脚本下载

    /** 下载到 App 私有目录 */
    private fun localFile(context: Context, name: String): File =
        File(context.filesDir, "scripts").apply { mkdirs() }.resolve(name)

    suspend fun download(context: Context, url: String, name: String = "hm_inject.js"): Result<File> =
        withContext(Dispatchers.IO) {
            runCatching {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 10000
                conn.readTimeout = 20000
                conn.setRequestProperty("User-Agent", "HM-MiniGame-Tool")
                if (conn.responseCode !in 200..299) {
                    error("HTTP ${conn.responseCode}")
                }
                val out = localFile(context, name)
                conn.inputStream.use { input ->
                    out.outputStream().use { output -> input.copyTo(output) }
                }
                // 校验：必须是我们的脚本
                val text = out.readText()
                if (!text.contains("__hmw")) error("下载内容不是注入脚本")
                out
            }
        }

    // ------------------------------------------------------------ 部署

    /**
     * 部署到游戏目录。
     *
     * 需要 root：App 没有权限写别的 App 的 data 目录。
     * 属主用**目标目录本身的 uid/gid** 对齐 —— Android 的 toybox chown
     * 不支持 --reference，而且 bilibili 的 uid 是动态分配的，不能写死。
     */
    suspend fun deploy(context: Context, file: File): Result<String> = withContext(Dispatchers.IO) {
        val root = checkRoot()
        if (root.status != RootStatus.GRANTED) {
            return@withContext Result.failure(
                IllegalStateException("需要 root 权限：${root.detail}")
            )
        }
        runCatching {
            val sh = "cp '${file.absolutePath}' '$TARGET' && " +
                "chown \$(stat -c %u '$TARGET_DIR'):\$(stat -c %g '$TARGET_DIR') '$TARGET' && " +
                "chmod 644 '$TARGET' && ls -la '$TARGET'"
            val r = attempt(root.suPath ?: "su", sh)
            if (r !is Attempt.Ran) error("su 执行失败")
            if (r.code != 0) error(r.out.trim().ifBlank { "退出码 ${r.code}" })
            r.out.trim()
        }
    }

    // ------------------------------------------------------------ 引导授权

    /** 拉起 root 管理器，让用户去给本 App 授权 */
    fun openRootManager(context: Context): Boolean {
        for (pkg in MANAGERS) {
            try {
                val i = context.packageManager.getLaunchIntentForPackage(pkg) ?: continue
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(i)
                return true
            } catch (e: Exception) {
            }
        }
        return false
    }

    /**
     * 请游戏进程里的模块立即同步脚本。
     *
     * 这是**首选**路径：模块跑在 tv.danmaku.bili:web 里，身份就是游戏自己，
     * 写游戏目录不需要 root；而 App 用 su 写别的 App 的私有目录会被
     * KernelSU 的 App Profile（SELinux 域）挡住。
     */
    fun requestSync(context: Context): Boolean = try {
        /*
         * 目标包必须是 **tv.danmaku.bili**，不是模块自己的包名。
         * 动态注册的 BroadcastReceiver 在系统里是按「调用进程的包名」登记的，
         * 而接收器是在 tv.danmaku.bili:web 进程里注册的 ——
         * 广播限定到 com.hm.xposed 的话系统找不到接收者（实测接收者数 = 0）。
         * 限定到 tv.danmaku.bili 就能送达 :web 进程。
         */
        val i = Intent(SYNC_ACTION).setPackage("tv.danmaku.bili")
        context.sendBroadcast(i)
        true
    } catch (e: Exception) {
        Log.w(TAG, "requestSync failed: ${e.message}")
        false
    }

    /** 手动部署的提示（不依赖 root 的方案不可用时） */
    fun manualCommandHint(): String =
        "模块在游戏进程里运行时才能同步；也可以用 adb 手动部署：" +
            "adb push hm_inject.js $TARGET"

    /** 给用户看的手动部署命令 */
    fun manualCommand(localPath: String): String =
        "adb push $localPath $TARGET && " +
            "adb shell su -c 'chown \$(stat -c %u $TARGET_DIR):\$(stat -c %g $TARGET_DIR) $TARGET'"

    /** 授权指引文案 */
    fun grantHint(): String =
        "请在 root 管理器里找到本应用（HM 小游戏工具），" +
            "打开「超级用户 / 授权」开关后重试"
}
