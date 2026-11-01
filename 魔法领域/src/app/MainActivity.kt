package com.hm.xposed

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Scaffold
import top.yukonga.miuix.kmp.basic.SmallTitle
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TopAppBar
import top.yukonga.miuix.kmp.theme.ColorSchemeMode
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.ThemeController

/**
 * 一款受支持的小游戏。
 *
 * 新增游戏时只改 [SUPPORTED_GAMES]，界面会自动多出一张卡片。
 * 每款游戏对应的注入细节放在 E:\Tools\BiliBiliweb\<游戏名>\ 里。
 */
private data class GameEntry(
    val name: String,
    val engine: String,
    val chapter: String,
    val summary: String,
    val features: List<String>,
    val accent: Color,
)

private val SUPPORTED_GAMES = listOf(
    GameEntry(
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
    ),
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val controller = remember { ThemeController(ColorSchemeMode.System) }
            MiuixTheme(controller = controller) {
                HomeScreen()
            }
        }
    }

    private fun launchBilibili() {
        val intent = packageManager.getLaunchIntentForPackage("tv.danmaku.bili")
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        }
    }
}

@Composable
private fun HomeScreen() {
    val cs = MiuixTheme.colorScheme
    Scaffold(
        topBar = { TopAppBar(title = "HM 小游戏工具") },
        containerColor = cs.surface,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(top = 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StatusCard()
            SmallTitle("支持的游戏")
            SUPPORTED_GAMES.forEach { game -> GameCard(game) }
            SmallTitle("使用前提")
            HintCard()
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun StatusCard() {
    val cs = MiuixTheme.colorScheme
    Card(modifier = Modifier.fillMaxWidth()) {
      Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "注入方式",
                    fontSize = 13.sp,
                    color = cs.onSurfaceVariantSummary,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "LSPosed / Zygisk 双通道",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = "版本",
                    fontSize = 13.sp,
                    color = cs.onSurfaceVariantSummary,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "1.2",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        InfoRow("目标应用", "哔哩哔哩（tv.danmaku.bili）")
        InfoRow("目标进程", "tv.danmaku.bili:web")
        InfoRow("作用域", "只需勾选主包，无需勾选子进程")
      }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    val cs = MiuixTheme.colorScheme
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(
            text = label,
            modifier = Modifier.width(76.dp),
            fontSize = 13.sp,
            color = cs.onSurfaceVariantSummary,
        )
        Text(
            text = value,
            modifier = Modifier.weight(1f),
            fontSize = 13.sp,
            color = cs.onSurface,
        )
    }
}

@Composable
private fun GameCard(game: GameEntry) {
    val cs = MiuixTheme.colorScheme
    Card(modifier = Modifier.fillMaxWidth()) {
      Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 游戏图标占位：用强调色方块代替，避免额外打包图片资源
            Box(
                modifier = Modifier
                    .size(46.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .background(game.accent),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = game.name.take(1),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = game.name,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "${game.engine} 引擎 · ${game.chapter}",
                    fontSize = 12.sp,
                    color = cs.onSurfaceVariantSummary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(game.accent.copy(alpha = 0.14f))
                    .padding(horizontal = 9.dp, vertical = 4.dp),
            ) {
                Text(
                    text = "已支持",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = game.accent,
                )
            }
        }

        Spacer(Modifier.height(12.dp))
        Text(
            text = game.summary,
            modifier = Modifier.fillMaxWidth(),
            fontSize = 13.sp,
            lineHeight = 19.sp,
            color = cs.onSurfaceVariantSummary,
        )

        Spacer(Modifier.height(10.dp))
        game.features.forEach { line ->
            Row(modifier = Modifier.padding(vertical = 2.dp)) {
                Text(text = "·", fontSize = 13.sp, color = game.accent)
                Spacer(Modifier.width(6.dp))
                Text(text = line, fontSize = 13.sp, color = cs.onSurface)
            }
        }

        Spacer(Modifier.height(12.dp))
        Text(
            text = "进入游戏后右下角会出现 HM 小条，点开即可调数值",
            modifier = Modifier.fillMaxWidth(),
            fontSize = 12.sp,
            color = cs.onSurfaceVariantSummary,
        )
      }
    }
}

@Composable
private fun HintCard() {
    val cs = MiuixTheme.colorScheme
    Card(modifier = Modifier.fillMaxWidth()) {
      Column(modifier = Modifier.fillMaxWidth()) {
        HintLine("1. 在 LSPosed 里启用本模块，作用域勾选「哔哩哔哩」")
        HintLine("2. 强制停止哔哩哔哩后重新打开，进入小游戏")
        HintLine("3. 首次进入会等待引擎加载，约 1–3 秒后面板出现")
        HintLine("4. 若面板未出现，先看右下角折叠条，或重开一次小游戏")
        Spacer(Modifier.height(10.dp))
        Text(
            text = "游戏大版本更新后引擎脚本会变，注入可能失效，",
            modifier = Modifier.fillMaxWidth(),
            fontSize = 12.sp,
            lineHeight = 18.sp,
            color = cs.onSurfaceVariantSummary,
        )
        Text(
            text = "需要重新 dump 并适配源码改写位置。",
            modifier = Modifier.fillMaxWidth(),
            fontSize = 12.sp,
            lineHeight = 18.sp,
            color = cs.onSurfaceVariantSummary,
        )
      }
    }
}

@Composable
private fun HintLine(text: String) {
    val cs = MiuixTheme.colorScheme
    Text(
        text = text,
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        fontSize = 13.sp,
        lineHeight = 19.sp,
        color = cs.onSurface,
    )
}
