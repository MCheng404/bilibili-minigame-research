package com.hm.xposed

import android.content.Context
import android.graphics.Color as AndroidColor
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * 一款受支持的小游戏。
 *
 * 正常情况下这些数据来自仓库根目录的 catalog.json，
 * App 启动时拉取 —— 新增游戏只要往仓库加一条记录，
 * App 不用重新发布。
 */
data class GameEntry(
    val id: String,
    val name: String,
    val engine: String,
    val chapter: String,
    val summary: String,
    val features: List<String>,
    val accent: Color,
    /** full = 完整数值支持；generic = 仅通用去广告；planned = 计划中 */
    val status: String,
    /** 注入脚本的下载地址，为空表示用内置脚本 */
    val scriptUrl: String?,
    /** 文档地址 */
    val docsUrl: String?,
)

data class Catalog(
    val version: Int,
    val updatedAt: String,
    val games: List<GameEntry>,
    /** remote = 刚从仓库拉到；cache = 本地缓存；builtin = 内置兜底 */
    val source: String,
)

/**
 * 仓库目录的拉取与缓存。
 *
 * 拉取顺序：GitHub raw → jsDelivr → 代理 → 本地缓存 → 内置兜底。
 * 任何一个源成功即返回，后面的不再尝试。
 */
object CatalogRepo {

    private const val REPO = "MCheng404/bilibili-minigame-research"

    private val SOURCES = listOf(
        "https://raw.githubusercontent.com/$REPO/master/catalog.json",
        "https://cdn.jsdelivr.net/gh/$REPO@master/catalog.json",
        "https://ghproxy.net/https://raw.githubusercontent.com/$REPO/master/catalog.json",
    )

    private const val PREFS = "hm_catalog"
    private const val KEY_JSON = "json"

    /** 拉不到时的内置兜底，保证离线也能看到内容 */
    private val BUILTIN = listOf(
        GameEntry(
            id = "magic-realm",
            name = "魔法领域",
            engine = "Laya",
            chapter = "第 10 章 驯兽师",
            summary = "跑在 libMiniEngine.so 内嵌 V8 里，数据单例藏在模块 IIFE 闭包中，" +
                "通过改写 Script::Compile 的源码把它暴露到 globalThis 后再改。",
            features = listOf(
                "钻石 / 木材 / 石头 / 竞技币 / 神石",
                "VIP 等级、神格、体力、经验",
                "兵种与英雄满级、天赋全满",
                "免广告直接领奖励、一键写入存档",
            ),
            accent = Color(0xFF2C6BED),
            status = "full",
            scriptUrl = null,
            docsUrl = null,
        ),
    )

    /** 读本地缓存，没有则返回 null。用于「先显示缓存，再刷新远端」 */
    fun cached(context: Context): Catalog? = readCache(context)?.copy(source = "cache")

    /**
     * 拉远端目录。三个源并行请求，取最先成功的那个；
     * 全失败则退回缓存，再退回内置数据。
     */
    suspend fun load(context: Context): Catalog = withContext(Dispatchers.IO) {
        coroutineScope {
            val pending = SOURCES.map { src -> async(Dispatchers.IO) { src to fetch(src) } }
            for (d in pending) {
                val json = d.await()?.second ?: continue
                val parsed = parse(json) ?: continue
                writeCache(context, json)
                return@coroutineScope parsed.copy(source = "remote")
            }
        }
        readCache(context)?.copy(source = "cache")
            ?: Catalog(0, "内置数据", BUILTIN, "builtin")
    }

    private fun fetch(url: String): String? = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("User-Agent", "HM-MiniGame-Tool")
        if (conn.responseCode in 200..299) {
            conn.inputStream.bufferedReader().use { r: BufferedReader -> r.readText() }
        } else {
            null
        }
    } catch (e: Exception) {
        null
    }

    fun parse(json: String): Catalog? = try {
        val root = JSONObject(json)
        val arr = root.optJSONArray("games")
        val games = ArrayList<GameEntry>()
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val feats = ArrayList<String>()
                val fa = o.optJSONArray("features")
                if (fa != null) for (j in 0 until fa.length()) feats.add(fa.optString(j))
                games.add(
                    GameEntry(
                        id = o.optString("id"),
                        name = o.optString("name"),
                        engine = o.optString("engine"),
                        chapter = o.optString("chapter"),
                        summary = o.optString("summary"),
                        features = feats,
                        accent = parseColor(o.optString("accent", "#2C6BED")),
                        status = o.optString("status", "full"),
                        scriptUrl = o.optString("scriptUrl").ifBlank { null },
                        docsUrl = o.optString("docsUrl").ifBlank { null },
                    )
                )
            }
        }
        if (games.isEmpty()) null
        else Catalog(
            version = root.optInt("version", 0),
            updatedAt = root.optString("updatedAt", ""),
            games = games,
            source = "remote",
        )
    } catch (e: Exception) {
        null
    }

    private fun parseColor(hex: String): Color = try {
        Color(AndroidColor.parseColor(hex))
    } catch (e: Exception) {
        Color(0xFF2C6BED)
    }

    private fun readCache(context: Context): Catalog? = try {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val json = prefs.getString(KEY_JSON, null) ?: return null
        parse(json)
    } catch (e: Exception) {
        null
    }

    private fun writeCache(context: Context, json: String) {
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_JSON, json).apply()
        } catch (e: Exception) {
        }
    }
}
