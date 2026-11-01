// AGP 9 起 Kotlin 编译是内置的，不再需要 org.jetbrains.kotlin.android 插件。
// 但内置版本是 KGP 2.2.10，而 miuix 依赖 kotlin-stdlib 2.4.x，
// 低版本编译器读不了高版本 metadata，所以要在 buildscript 里显式抬到 2.4.21。
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
