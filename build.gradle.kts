import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm) apply false
}

// Compiles, tests and runs on a Java 25 toolchain. Gradle itself only needs JDK 17+: it uses an
// installed JDK 25 when it finds one, and otherwise downloads one (foojay resolver, settings.gradle.kts).
subprojects {
    plugins.withType<JavaPlugin> {
        extensions.configure<JavaPluginExtension> {
            toolchain { languageVersion = JavaLanguageVersion.of(25) }
        }
        tasks.withType<Test>().configureEach {
            useJUnitPlatform()
            // GraalJS uses native access and sun.misc.Unsafe; the JDK warns unless they are granted.
            jvmArgs("--enable-native-access=ALL-UNNAMED", "--sun-misc-unsafe-memory-access=allow")
        }
        dependencies {
            "testImplementation"(platform(rootProject.libs.junit.bom))
            "testImplementation"(rootProject.libs.junit.jupiter)
            "testRuntimeOnly"(rootProject.libs.junit.launcher)
        }
    }
    plugins.withId("org.jetbrains.kotlin.jvm") {
        extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
            compilerOptions { jvmTarget = JvmTarget.JVM_25 }
        }
    }
}
