plugins {
    // AGP 9 内置 Kotlin 编译，不要再加 org.jetbrains.kotlin.android
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.hm.xposed"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.hm.xposed"
        minSdk = 29
        targetSdk = 37
        versionCode = 2
        versionName = "1.1"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = false
    }

    packaging {
        resources.excludes += setOf("META-INF/**")
    }
}

dependencies {
    // Xposed API 只在编译期可见，运行期由框架提供
    compileOnly("de.robv.android.xposed:api:82")

    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.13.0")

    // 小米 HyperOS 风格 Compose UI（Compose Multiplatform 库，Android 变体走 androidx）
    implementation("top.yukonga.miuix.kmp:miuix-ui:0.9.4")
    implementation("top.yukonga.miuix.kmp:miuix-icons:0.9.4")
}
