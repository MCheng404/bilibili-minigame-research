package com.hm.xposed

import android.content.Context
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

    /** 目标路径：游戏自己的 files 目录，native 层能读 */
    const val TARGET = "/data/data/tv.danmaku.bili/files/hm_inject.js"

    /** 参考文件，用来对齐属主（bilibili 的 uid 是动态分配的，不能写死） */
    private const val REF = "/data/data/tv.danmaku.bili/files/libhmshim.so"

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

    /**
     * 部署到游戏目录。
     *
     * 需要 root：App 没有权限写别的 App 的 data 目录。
     * 用 --reference 对齐属主，避免 bilibili 的 uid 变化后失效。
     */
    suspend fun deploy(context: Context, file: File): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val cmd = listOf(
                "su", "-c",
                "cp '${file.absolutePath}' '$TARGET' && " +
                    "chown --reference='$REF' '$TARGET' && " +
                    "chmod 644 '$TARGET' && " +
                    "ls -la '$TARGET'"
            )
            val p = ProcessBuilder(cmd).start()
            val out = p.inputStream.bufferedReader().readText()
            val err = p.errorStream.bufferedReader().readText()
            if (!p.waitFor(20, TimeUnit.SECONDS)) {
                p.destroy()
                error("部署超时")
            }
            if (p.exitValue() != 0) {
                error((err + out).ifBlank { "退出码 " + p.exitValue() })
            }
            out
        }
    }

    /** 给用户看的手动部署命令 */
    fun manualCommand(localPath: String): String =
        "adb push $localPath $TARGET && adb shell su -c 'chown --reference=$REF $TARGET'"
}
