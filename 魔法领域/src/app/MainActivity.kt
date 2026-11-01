package com.hm.xposed

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
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

// miuix 的 CardDefaults.InsideMargin 是 PaddingValues(0.dp)，
// 不显式指定的话内容会完全贴着卡片边缘。
private val CARD_PADDING = PaddingValues(horizontal = 16.dp, vertical = 14.dp)

// SmallTitleDefaults.InsideMargin 是 (28.dp, 8.dp)，页面本身已有 16.dp 横向 padding，
// 叠加后小标题会比卡片多缩进 28.dp。这里收窄到与卡片左边缘基本齐平。
private val TITLE_PADDING = PaddingValues(horizontal = 2.dp, vertical = 8.dp)

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
    val context = LocalContext.current

    // 目录来自仓库的 catalog.json —— 新增游戏只要改仓库，App 不用重新发布
    var catalog by remember { mutableStateOf(CatalogRepo.cached(context)) }
    var loading by remember { mutableStateOf(true) }
    var refreshKey by remember { mutableIntStateOf(0) }

    // root 授权状态：决定「更新脚本」能不能一键完成
    var rootInfo by remember { mutableStateOf<ScriptRepo.RootInfo?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(refreshKey) {
        loading = true
        // 先用缓存顶上，再等远端结果替换掉
        catalog = CatalogRepo.cached(context) ?: catalog
        catalog = CatalogRepo.load(context)
        loading = false
    }

    // 启动时顺手检测一次 root 授权
    LaunchedEffect(Unit) {
        rootInfo = ScriptRepo.checkRoot()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = "HM 小游戏工具",
                actions = {
                    // 用文字而不是图标：miuix 的 Icon 只接受 ImageVector，
                    // 为了一个刷新按钮引入 material-icons 不划算
                    Text(
                        text = if (loading) "拉取中…" else "刷新",
                        modifier = Modifier
                            .clickable(enabled = !loading) { refreshKey++ }
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        fontSize = 14.sp,
                        color = if (loading) cs.onSurfaceVariantSummary else cs.onSurface,
                    )
                },
            )
        },
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
            StatusCard(
                catalog = catalog,
                loading = loading,
                rootInfo = rootInfo,
                onCheckRoot = {
                    scope.launch { rootInfo = ScriptRepo.checkRoot() }
                },
            )
            SmallTitle("支持的游戏", insideMargin = TITLE_PADDING)
            val games = catalog?.games.orEmpty()
            if (games.isEmpty()) {
                Text(
                    text = if (loading) "正在拉取目录…" else "暂时拿不到游戏目录",
                    modifier = Modifier.fillMaxWidth(),
                    fontSize = 14.sp,
                    color = cs.onSurfaceVariantSummary,
                )
            } else {
                games.forEach { game -> GameCard(game) }
            }
            SmallTitle("使用前提", insideMargin = TITLE_PADDING)
            HintCard()
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun StatusCard(
    catalog: Catalog?,
    loading: Boolean,
    rootInfo: ScriptRepo.RootInfo?,
    onCheckRoot: () -> Unit,
) {
    val cs = MiuixTheme.colorScheme
    Card(
        modifier = Modifier.fillMaxWidth(),
        insideMargin = CARD_PADDING,
    ) {
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
        InfoRow("脚本同步", "游戏进程自动完成（无需 root）")
        InfoRow(
            label = "root 权限",
            value = when (rootInfo?.status) {
                ScriptRepo.RootStatus.GRANTED -> "已授权（" + (rootInfo.suPath ?: "su") + "）"
                ScriptRepo.RootStatus.DENIED -> "未授权"
                ScriptRepo.RootStatus.NO_MANAGER -> "未检测到管理器"
                else -> "检测中…"
            },
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            Text(
                text = "检测权限",
                modifier = Modifier
                    .clip(RoundedCornerShape(9.dp))
                    .background(Color(0xFF3D86D8).copy(alpha = 0.14f))
                    .clickable { onCheckRoot() }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                fontSize = 13.sp,
                color = Color(0xFF3D86D8),
            )
        }
        InfoRow(
            label = "游戏目录",
            value = when {
                loading -> "拉取中…"
                catalog == null -> "未获取"
                catalog.source == "remote" ->
                    "仓库 v" + catalog.version +
                        (if (catalog.updatedAt.isNotBlank()) " · " + catalog.updatedAt.take(10) else "")
                catalog.source == "cache" -> "本地缓存"
                else -> "内置数据"
            },
        )
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
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var scriptState by remember(game.id) { mutableStateOf("") }
    var scriptCmd by remember(game.id) { mutableStateOf("") }
    var scriptBusy by remember(game.id) { mutableStateOf(false) }
    var rootState by remember(game.id) { mutableStateOf<ScriptRepo.RootStatus?>(null) }
    Card(
        modifier = Modifier.fillMaxWidth(),
        insideMargin = CARD_PADDING,
    ) {
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
            val tagText: String
            val tagColor: Color
            when (game.status) {
                "full" -> { tagText = "已支持"; tagColor = game.accent }
                "planned" -> { tagText = "计划中"; tagColor = Color(0xFF8A93A6) }
                else -> { tagText = "通用去广告"; tagColor = Color(0xFF5C8CC0) }
            }
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(tagColor.copy(alpha = 0.14f))
                    .padding(horizontal = 9.dp, vertical = 4.dp),
            ) {
                Text(
                    text = tagText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = tagColor,
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

        // 注入脚本：可以从仓库直接更新，不用重新发布 App
        if (game.scriptUrl != null) {
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "注入脚本",
                        fontSize = 12.sp,
                        color = cs.onSurfaceVariantSummary,
                    )
                    // 长按可复制：部署失败时把命令和错误一起复制走
                    SelectionContainer {
                        Text(
                            text = if (scriptState.isBlank()) "模块自动同步中" else scriptState,
                            fontSize = 13.sp,
                            color = if (scriptState.startsWith("已部署")) cs.onSurface else Color(0xFFE08A6B),
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (scriptCmd.isNotBlank()) {
                        Text(
                            text = scriptCmd,
                            fontSize = 11.sp,
                            color = cs.onSurfaceVariantSummary,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Spacer(Modifier.width(10.dp))
                // 按钮按 root 授权状态切换：先检测 → 未授权就去授权 → 已授权才更新
                val btnText = when {
                    scriptBusy -> "处理中…"
                    rootState == ScriptRepo.RootStatus.DENIED -> "去授权"
                    rootState == ScriptRepo.RootStatus.NO_MANAGER -> "去授权"
                    else -> "立即同步"
                }
                Text(
                    text = btnText,
                    modifier = Modifier
                        .clip(RoundedCornerShape(9.dp))
                        .background(game.accent.copy(alpha = 0.14f))
                        .clickable(enabled = !scriptBusy) {
                            when (rootState) {
                                ScriptRepo.RootStatus.DENIED,
                                ScriptRepo.RootStatus.NO_MANAGER -> {
                                    // 未授权：拉起 root 管理器让用户点允许
                                    val opened = ScriptRepo.openRootManager(context)
                                    scriptState = if (opened)
                                        "已打开 root 管理器，请给本应用授权后重试"
                                    else
                                        "未找到 root 管理器，请手动授权：" + ScriptRepo.grantHint()
                                    scriptCmd = ScriptRepo.grantHint()
                                }
                                else -> {
                                    // 主路径其实不依赖这里：模块跑在游戏进程里，
                                    // 自己会把最新脚本同步到游戏目录。这个按钮
                                    // 只是「立刻强制同步一次」的覆盖手段。
                                    scriptBusy = true
                                    scriptState = "正在同步…"
                                    scope.launch {
                                        val r = ScriptRepo.download(context, game.scriptUrl)
                                        val msg = r.fold(
                                            onSuccess = { f ->
                                                ScriptRepo.deploy(context, f).fold(
                                                    onSuccess = {
                                                        scriptCmd = ""
                                                        "已部署 " + f.length() + " 字节，重启游戏生效"
                                                    },
                                                    onFailure = {
                                                        scriptCmd = ScriptRepo.manualCommand(f.absolutePath)
                                                        "部署失败：" + (it.message ?: "未知错误")
                                                    },
                                                )
                                            },
                                            onFailure = {
                                                scriptCmd = ""
                                                "下载失败：" + (it.message ?: "未知错误")
                                            },
                                        )
                                        scriptState = msg
                                        scriptBusy = false
                                    }
                                }
                            }
                        }
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                    fontSize = 13.sp,
                    color = game.accent,
                )
            }
        }

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
    Card(
        modifier = Modifier.fillMaxWidth(),
        insideMargin = CARD_PADDING,
    ) {
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
