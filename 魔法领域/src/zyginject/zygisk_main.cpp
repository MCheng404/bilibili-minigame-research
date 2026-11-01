// hmzygisk —— 用 Zygisk 把 libhmshim.so 注入 B 站小游戏进程
//
// 与 LSPosed 方案的区别只在「谁把 .so 加载进目标进程」这一步：
//   LSPosed: Java 层 handleLoadPackage → System.load()
//   Zygisk : zygote fork 后 postAppSpecialize → dlopen()
// 之后 hmshim.c 的内部逻辑（定位引擎、hook Script::Compile、改源码、注入探针）
// 完全一致，两种方案共用同一份 .so。
//
// 之所以能直接 dlopen，是因为 postAppSpecialize 执行时进程已经完成 specialize，
// uid 已是 u0_xxxx（bilibili 自己的 uid），能读 /data/data/tv.danmaku.bili/files/。

#include <jni.h>
#include <dlfcn.h>
#include <android/log.h>
#include <cstring>
#include "zygisk.hpp"

#define LOG_TAG "HMZyg"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

// 目标进程与注入的库。换游戏/换 App 只改这两行。
static const char *kTargetProc = "tv.danmaku.bili:web";
static const char *kSoPath = "/data/data/tv.danmaku.bili/files/libhmshim.so";

class HmZygiskModule : public zygisk::ModuleBase {
public:
    void onLoad(zygisk::Api *api, JNIEnv *env) override {
        api_ = api;
        env_ = env;
    }

    void preAppSpecialize(zygisk::AppSpecializeArgs *args) override {
        matched_ = false;
        const char *n = env_->GetStringUTFChars(args->nice_name, nullptr);
        if (n) {
            strncpy(name_, n, sizeof(name_) - 1);
            name_[sizeof(name_) - 1] = '\0';
            env_->ReleaseStringUTFChars(args->nice_name, n);
            matched_ = (strcmp(name_, kTargetProc) == 0);
        }
        if (!matched_) {
            // 非目标进程：让 Zygisk 在 specialize 结束后把模块库从内存里卸掉
            api_->setOption(zygisk::Option::DLCLOSE_MODULE_LIBRARY);
        }
    }

    void postAppSpecialize(const zygisk::AppSpecializeArgs *) override {
        if (!matched_) return;
        void *h = dlopen(kSoPath, RTLD_NOW);
        if (h) {
            LOGI("injected into %s (handle=%p)", name_, h);
        } else {
            const char *e = dlerror();
            LOGI("dlopen %s failed: %s", kSoPath, e ? e : "unknown");
        }
    }

private:
    zygisk::Api *api_ = nullptr;
    JNIEnv *env_ = nullptr;
    char name_[256] = {0};
    bool matched_ = false;
};

REGISTER_ZYGISK_MODULE(HmZygiskModule)
