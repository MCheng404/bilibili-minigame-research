// hmshim.so —— 在 :web 进程里对 libMiniEngine.so 的 V8 编译入口做 inline hook
//
// 取符号的方式：先读 /proc/self/maps 找到模块基址，再解析磁盘上同一份 .so 的
// .dynsym/.dynstr 得到符号的 st_value，基址 + st_value 即运行期地址。
// 不用 dlopen(soname)：引擎是按绝对路径加载的，按名字查不到。

#include <android/log.h>
#include <elf.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define TAG "HMShim"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

#define MODULE_NAME "libMiniEngine.so"

/* 0 = 只挂钩记录，不执行任何 JS（干净模式） */
#define INJECT_ENABLED 1

#define SYM_SCRIPT_COMPILE \
    "_ZN2v86Script7CompileENS_5LocalINS_7ContextEEENS1_INS_6StringEEEPNS_12ScriptOriginE"
#define SYM_SC_COMPILE \
    "_ZN2v814ScriptCompiler7CompileENS_5LocalINS_7ContextEEEPNS0_6SourceENS0_14CompileOptionsENS0_13NoCacheReasonE"

#define SYM_ISOLATE_CUR "_ZN2v87Isolate10GetCurrentEv"
#define SYM_NEW_UTF8 "_ZN2v86String11NewFromUtf8EPNS_7IsolateEPKcNS_13NewStringTypeEi"
#define SYM_SCRIPT_RUN "_ZN2v86Script3RunENS_5LocalINS_7ContextEEE"
#define SYM_FUNC_CALL "_ZN2v88Function4CallENS_5LocalINS_7ContextEEENS1_INS_5ValueEEEiPS5_"

typedef void *(*compile3_fn)(void *ctx, void *src, void *origin);
typedef void *(*compile4_fn)(void *ctx, void *src, void *opts, void *reason);

static compile3_fn orig_script_compile = NULL;
typedef void *(*isolate_cur_fn)(void);
typedef void *(*new_utf8_fn)(void *iso, const char *s, int type, int len);
typedef void *(*run_fn)(void *script, void *ctx);
static isolate_cur_fn fn_isolate_cur = NULL;
static new_utf8_fn fn_new_utf8 = NULL;
static run_fn fn_run = NULL;
typedef void *(*func_call_fn)(void *ctx, void *recv, int argc, void *argv);
static func_call_fn orig_func_call = NULL;
static volatile unsigned long g_fc = 0;

static volatile int g_inject_count = 0;
static void *g_injected[8];
static __thread int t_in_hook = 0;
static compile4_fn orig_sc_compile = NULL;

static void *g_ctx = NULL;
static void *g_ctxs[24];
static volatile int g_ctxn = 0;
static volatile int g_rr = 0;
static volatile int g_hits = 0;
static long long g_first_ms = 0;

/* ---------------------------------------------------- 脚本源码提取（dump） */
/*
 * 游戏逻辑全在模块闭包里，JS 侧从 globalThis 出发不可达，内存扫描拿到的只是
 * 副本。所以换个思路：Script::Compile 的入参就是脚本源码，直接读出来落盘，
 * 就能离线看清 g 的定义和各处 outDiamondNum 的读写点。
 */
#define SYM_STR_U8LEN "_ZNK2v86String10Utf8LengthEPNS_7IsolateE"
#define SYM_STR_W8    "_ZNK2v86String9WriteUtf8EPNS_7IsolateEPciPii"

typedef int (*str_u8len_fn)(void *s, void *iso);
typedef int (*str_write8_fn)(void *s, void *iso, char *buf, int len, int *nchars, int opts);
static str_u8len_fn fn_u8len = NULL;
static str_write8_fn fn_w8 = NULL;
static volatile int g_dump_idx = 0;
static __thread int t_in_dump = 0;

#define DUMP_MAX_SCRIPTS 40
#define DUMP_MAX_BYTES   (12 * 1024 * 1024)

/*
 * 关键一步：游戏逻辑全在内层 IIFE 的作用域里，g 是那里的顶层 class。
 * 浏览器 API 层面没有任何入口能摸到它。但 Script::Compile 的入参就是源码
 * 文本 —— 在 IIFE 函数体闭合前插一句 globalThis.__hmg=g，就能把整个数据
 * 单例搬出来。插入点必须落在函数体内（} 之后、() 之前非法），所以插在
 * 最后一个 "}();" 的 } 之前。
 */
#define PATCH_SRC 1
static volatile int g_patch_done = 0;

static void *build_patched_source(void *src) {
#if PATCH_SRC
    if (g_patch_done) return NULL;
    if (!fn_u8len || !fn_w8 || !fn_new_utf8 || !fn_isolate_cur) return NULL;
    void *iso = fn_isolate_cur();
    if (!iso) return NULL;

    int n = fn_u8len(src, iso);
    if (n < 1000 || n > (8 * 1024 * 1024)) return NULL;
    char *buf = (char *)malloc((size_t)n + 1);
    if (!buf) return NULL;
    int got = fn_w8(src, iso, buf, n, NULL, 0);
    if (got <= 0) got = n;
    buf[got] = 0;

    if (!strstr(buf, "outDiamondNum")) { free(buf); return NULL; }

    char *last = NULL, *p = buf;
    while ((p = strstr(p, "}();")) != NULL) { last = p; p++; }
    if (!last) { LOGI("patch: no IIFE tail found"); free(buf); return NULL; }

    /*
     * 同时暴露配置单例 a：VIP 等级上限藏在 a.vipCfg.length 里，而
     * getVipValid() 对 find() 的返回值没做空判断，等级越界会直接抛异常，
     * 所以必须先拿到上限再决定能设到几级。
     */
    static const char INJ[] =
        ";try{globalThis.__hmg=g}catch(e){globalThis.__hmge=String(e)}"
        ";try{globalThis.__hma=a}catch(e){globalThis.__hae=String(e)}"
        ";try{globalThis.__hmgg=gg}catch(e){globalThis.__hge=String(e)}";
    size_t ilen = sizeof(INJ) - 1;
    size_t off = (size_t)(last - buf);
    size_t nlen = (size_t)got + ilen;
    char *nb = (char *)malloc(nlen + 1);
    if (!nb) { free(buf); return NULL; }
    memcpy(nb, buf, off);
    memcpy(nb + off, INJ, ilen);
    memcpy(nb + off + ilen, buf + off, (size_t)got - off);
    nb[nlen] = 0;
    free(buf);

    g_patch_done = 1;
    LOGI("source patched n=%d -> %zu at off=%zu", got, nlen, off);
    void *ns = fn_new_utf8(iso, nb, 0, (int)nlen);
    free(nb);
    if (!ns) LOGE("patch: NewFromUtf8 failed");
    return ns;
#else
    (void)src;
    return NULL;
#endif
}

static void dump_js_source(void *src) {
    if (!fn_u8len || !fn_w8) return;
    if (g_dump_idx >= DUMP_MAX_SCRIPTS) return;
    if (t_in_dump) return;
    void *iso = fn_isolate_cur ? fn_isolate_cur() : NULL;
    if (!iso) return;
    t_in_dump = 1;

    int n = fn_u8len(src, iso);
    if (n < 200 || n > DUMP_MAX_BYTES) { t_in_dump = 0; return; }
    char *buf = (char *)malloc((size_t)n + 1);
    if (!buf) { t_in_dump = 0; return; }
    int got = fn_w8(src, iso, buf, n, NULL, 0);
    if (got <= 0) got = n;
    buf[got] = 0;

    if (!strstr(buf, "outDiamondNum") && !strstr(buf, "playerInfo") &&
        !strstr(buf, "lab_goldNum") && !strstr(buf, "refreshUI")) {
        free(buf);
        t_in_dump = 0;
        return;
    }
    char path[160];
    int idx = g_dump_idx++;
    snprintf(path, sizeof(path), "/data/data/tv.danmaku.bili/files/hmjs_%02d.js", idx);
    FILE *f = fopen(path, "wb");
    if (f) {
        fwrite(buf, 1, (size_t)got, f);
        fclose(f);
        LOGI("dumped %s n=%d", path, got);
    } else {
        LOGE("dump open fail %s", path);
    }
    free(buf);
    t_in_dump = 0;
}


static long long now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

/* ---------------------------------------------------------------- 模块定位 */

typedef struct {
    uintptr_t base;
    char path[512];
} module_info;

static int find_module(module_info *out) {
    FILE *f = fopen("/proc/self/maps", "r");
    if (!f) return 0;
    char line[1024];
    out->base = 0;
    out->path[0] = 0;
    while (fgets(line, sizeof(line), f)) {
        if (!strstr(line, MODULE_NAME)) continue;
        unsigned long start, end, off;
        char perms[8], path[512];
        path[0] = 0;
        int n = sscanf(line, "%lx-%lx %7s %lx %*s %*s %511[^\n]", &start, &end, perms, &off, path);
        if (n < 5) continue;
        if (off != 0) continue;               /* 只取第一段作为基址 */
        if (!strstr(path, MODULE_NAME)) continue;
        out->base = (uintptr_t)start;
        snprintf(out->path, sizeof(out->path), "%s", path);
        break;
    }
    fclose(f);
    return out->base != 0;
}

/* 从磁盘上的同一份 .so 里查动态符号的 st_value */
static uintptr_t sym_value_from_file(const char *path, const char *name) {
    int fd = open(path, O_RDONLY);
    if (fd < 0) { LOGE("open %s failed", path); return 0; }
    struct stat st;
    if (fstat(fd, &st) != 0) { close(fd); return 0; }
    void *map = mmap(NULL, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
    close(fd);
    if (map == MAP_FAILED) return 0;

    uintptr_t result = 0;
    const Elf64_Ehdr *eh = (const Elf64_Ehdr *)map;
    if (memcmp(eh->e_ident, ELFMAG, SELFMAG) == 0 && eh->e_ident[EI_CLASS] == ELFCLASS64) {
        const Elf64_Shdr *sh = (const Elf64_Shdr *)((const char *)map + eh->e_shoff);
        for (int i = 0; i < eh->e_shnum; i++) {
            if (sh[i].sh_type != SHT_DYNSYM) continue;
            const Elf64_Sym *syms = (const Elf64_Sym *)((const char *)map + sh[i].sh_offset);
            size_t count = sh[i].sh_size / sizeof(Elf64_Sym);
            const Elf64_Shdr *strsh = &sh[sh[i].sh_link];
            const char *strs = (const char *)map + strsh->sh_offset;
            for (size_t k = 0; k < count; k++) {
                const char *sn = strs + syms[k].st_name;
                if (syms[k].st_name && strcmp(sn, name) == 0) {
                    result = (uintptr_t)syms[k].st_value;
                    break;
                }
            }
            if (result) break;
        }
    }
    munmap(map, (size_t)st.st_size);
    return result;
}

/* ---------------------------------------------------------------- inline hook */

static int patch_jump(void *target, void *handler, void **trampoline_out) {
    unsigned char *tramp = mmap(NULL, 4096, PROT_READ | PROT_WRITE | PROT_EXEC,
                                MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (tramp == MAP_FAILED) return -1;

    memcpy(tramp, target, 16);
    uint32_t *p = (uint32_t *)(tramp + 16);
    p[0] = 0x58000050u;                       /* ldr x16, #8 */
    p[1] = 0xD61F0200u;                       /* br  x16      */
    *(void **)(tramp + 24) = (char *)target + 16;
    __builtin___clear_cache((char *)tramp, (char *)tramp + 32);

    long page = sysconf(_SC_PAGESIZE);
    void *page_start = (void *)((uintptr_t)target & ~(uintptr_t)(page - 1));
    if (mprotect(page_start, (size_t)page * 2, PROT_READ | PROT_WRITE | PROT_EXEC) != 0) {
        LOGE("mprotect rwx failed %p", target);
        return -2;
    }
    uint32_t patch[2];
    patch[0] = 0x58000050u;
    patch[1] = 0xD61F0200u;
    memcpy(target, patch, 8);
    memcpy((char *)target + 8, &handler, 8);
    __builtin___clear_cache((char *)target, (char *)target + 16);
    mprotect(page_start, (size_t)page * 2, PROT_READ | PROT_EXEC);

    *trampoline_out = tramp;
    return 0;
}

/* ---------------------------------------------------------------- 注入 */

/* 周期性向已捕获的 Context 注入结构化探针，结果写进 Uint8Array 供内核读回 */
static volatile int g_seq = 0;
static void *g_inj_ctx[40];
static long long g_last_inject_ms = 0;

/*
 * 探针目标：拿到 g.playerInfo 这个 JS 对象本身，而不是内存里的数值副本。
 * 路径：Laya.stage -> 找名为 lab_goldNum 的节点 -> 沿 parent 上溯拿到持有
 * refreshUI 的视图实例(view) -> 以 view/整棵显示树/所有 _components 为根做
 * 对象图 BFS，命中「自己有 playerInfo 且其 outDiamondNum 是 number」的对象。
 * refreshUI() 每次都会重新从 g 读值刷新标签，所以 R.t1 就是权威真值，可用来
 * 交叉验证 BFS 命中的对象是否真的是目标。
 */
#include "inj_gen.h"

static void try_inject(void *ctx) {
    if (!INJECT_ENABLED) return;
    if (!ctx) return;
    if (!fn_isolate_cur || !fn_new_utf8 || !fn_run || !orig_script_compile) return;
    if (g_seq >= 32) return;
    if (t_in_hook) return;
    for (int i = 0; i < g_seq; i++) if (g_inj_ctx[i] == ctx) return;
    long long now = now_ms();

    int idx = g_seq++;
    if (idx < 40) g_inj_ctx[idx] = ctx;
    t_in_hook = 1;

    const char *js = INJ_JS;

    void *iso = fn_isolate_cur();
    if (iso) {
        char probe[128];
        snprintf(probe, sizeof(probe),
                 "try{var G=(typeof globalThis!=='undefined')?globalThis:this;"
                 "G.__hmsq=%d;G.__hmtag='HMTZ%d';}catch(e){}", 7700000 + idx, idx);
        void *ps = fn_new_utf8(iso, probe, 0, -1);
        if (ps) {
            void *psc = orig_script_compile(ctx, ps, NULL);
            if (psc) fn_run(psc, ctx);
        }
    }
    if (!iso) { LOGI("inject %d: no isolate", idx); t_in_hook = 0; return; }
    void *str = fn_new_utf8(iso, js, 0, -1);
    if (!str) { LOGI("inject %d: no string", idx); t_in_hook = 0; return; }
    void *script = orig_script_compile(ctx, str, NULL);
    if (!script) { LOGI("inject %d: no script", idx); t_in_hook = 0; return; }
    void *r = fn_run(script, ctx);
    LOGI("inject %d ok ctx=%p t=%lldms", idx, ctx, now - g_first_ms);
    t_in_hook = 0;
}

/* ---------------------------------------------------------------- handlers */

static void on_new_context(void *ctx) {
    if (g_first_ms == 0) g_first_ms = now_ms();
    int n = g_ctxn;
    for (int i = 0; i < n; i++) if (g_ctxs[i] == ctx) return;
    if (n < 24) { g_ctxs[n] = ctx; g_ctxn = n + 1; }
    LOGI("new ctx=%p idx=%d hits=%d t=%lldms", ctx, n, g_hits, now_ms() - g_first_ms);
}

static void *hook_script_compile(void *ctx, void *src, void *origin) {
    if (src) {
        dump_js_source(src);
        void *ps = build_patched_source(src);
        if (ps) {
            src = ps;
            /*
             * 能命中 patch 说明这就是游戏主 bundle，也就意味着当前 ctx 才是
             * 真正跑游戏的 context。前面可能已经往别的临时 ctx 注入过，这里
             * 把本 ctx 的去重记录作废，让下面再注入一次，保证探针落在主 ctx。
             */
            for (int i = 0; i < g_seq && i < 40; i++) {
                if (g_inj_ctx[i] == ctx) g_inj_ctx[i] = NULL;
            }
        }
    }
    void *r = orig_script_compile(ctx, src, origin);
    g_hits++;
    if (ctx && ctx != g_ctx) {
        g_ctx = ctx;
        on_new_context(ctx);
    } else if ((g_hits % 200) == 0) {
        LOGI("alive hits=%d ctx=%p", g_hits, g_ctx);
    }
    if (ctx) try_inject(ctx);
    return r;
}

static void *hook_sc_compile(void *ctx, void *src, void *opts, void *reason) {
    void *r = orig_sc_compile(ctx, src, opts, reason);
    g_hits++;
    if (ctx && ctx != g_ctx) {
        g_ctx = ctx;
        on_new_context(ctx);
    }
    if (ctx) try_inject(ctx);
    return r;
}

/* 每帧 JS 调用都走这里；每 400 次抽一次做注入，用来在游戏跑起来后反复取样 */
static void *hook_func_call(void *ctx, void *recv, int argc, void *argv) {
    void *r = orig_func_call(ctx, recv, argc, argv);
    unsigned long n = ++g_fc;
    if ((n % 400) == 0 && ctx) {
        g_ctx = ctx;
        g_last_inject_ms = 0;          /* 允许立即注入 */
        try_inject(ctx);
    }
    return r;
}

/* ---------------------------------------------------------------- installer */

static int try_install(void) {
    module_info mi;
    if (!find_module(&mi)) return 0;

    static int reported = 0;
    if (!reported) {
        reported = 1;
        LOGI("module base=0x%lx path=%s", (unsigned long)mi.base, mi.path);
    }

    uintptr_t v1 = sym_value_from_file(mi.path, SYM_SCRIPT_COMPILE);
    uintptr_t v2 = sym_value_from_file(mi.path, SYM_SC_COMPILE);
    if (!v1 && !v2) return 0;

    if (!fn_u8len) {
        uintptr_t p1 = sym_value_from_file(mi.path, SYM_STR_U8LEN);
        uintptr_t p2 = sym_value_from_file(mi.path, SYM_STR_W8);
        LOGI("syms u8len=%lx w8=%lx", (unsigned long)p1, (unsigned long)p2);
        if (p1 && p2) {
            fn_u8len = (str_u8len_fn)(mi.base + p1);
            fn_w8 = (str_write8_fn)(mi.base + p2);
        }
    }

    if (!fn_isolate_cur) {
        uintptr_t a = sym_value_from_file(mi.path, SYM_ISOLATE_CUR);
        uintptr_t b = sym_value_from_file(mi.path, SYM_NEW_UTF8);
        uintptr_t c = sym_value_from_file(mi.path, SYM_SCRIPT_RUN);
        LOGI("syms isolate=%lx newutf8=%lx run=%lx",
             (unsigned long)a, (unsigned long)b, (unsigned long)c);
        if (a && b && c) {
            fn_isolate_cur = (isolate_cur_fn)(mi.base + a);
            fn_new_utf8 = (new_utf8_fn)(mi.base + b);
            fn_run = (run_fn)(mi.base + c);
        }
    }

    if (v1 && !orig_script_compile) {
        void *tramp = NULL;
        if (patch_jump((void *)(mi.base + v1), (void *)hook_script_compile, &tramp) == 0) {
            orig_script_compile = (compile3_fn)tramp;
            LOGI("hooked Script::Compile @0x%lx", (unsigned long)(mi.base + v1));
        }
    }
    if (0 && !orig_func_call) {
        uintptr_t v3 = sym_value_from_file(mi.path, SYM_FUNC_CALL);
        if (v3) {
            void *tramp = NULL;
            if (patch_jump((void *)(mi.base + v3), (void *)hook_func_call, &tramp) == 0) {
                orig_func_call = (func_call_fn)tramp;
                LOGI("hooked Function::Call @0x%lx", (unsigned long)(mi.base + v3));
            }
        } else {
            LOGI("Function::Call 符号缺失");
        }
    }
    if (v2 && !orig_sc_compile) {
        void *tramp = NULL;
        if (patch_jump((void *)(mi.base + v2), (void *)hook_sc_compile, &tramp) == 0) {
            orig_sc_compile = (compile4_fn)tramp;
            LOGI("hooked ScriptCompiler::Compile @0x%lx", (unsigned long)(mi.base + v2));
        }
    }
    return 1;
}

static void *installer_thread(void *arg) {
    (void)arg;
    for (int i = 0; i < 900; i++) {
        if (try_install()) return NULL;
        usleep(200 * 1000);
    }
    LOGE("module never appeared");
    return NULL;
}

__attribute__((constructor)) static void on_load(void) {
    LOGI("loaded in pid=%d", getpid());
    pthread_t th;
    if (pthread_create(&th, NULL, installer_thread, NULL) == 0) {
        pthread_detach(th);
    }
}

int hmshim_ping(void) {
    LOGI("ping pid=%d hits=%d ctx=%p", getpid(), g_hits, g_ctx);
    return g_hits;
}
