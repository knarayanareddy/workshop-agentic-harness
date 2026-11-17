plugins {
    alias(libs.plugins.kotlin.jvm)
    application
}

dependencies {
    implementation(project(":harness-core"))
    implementation(project(":harness-typescript"))
    implementation(project(":extensions:kotlin"))
    implementation(project(":extensions:java"))
}

application {
    mainClass = "com.jdriven.harness.app.MainKt"
    // GraalJS uses native access and sun.misc.Unsafe; the JDK warns about both unless they are granted.
    applicationDefaultJvmArgs = listOf("--enable-native-access=ALL-UNNAMED", "--sun-misc-unsafe-memory-access=allow")
}

tasks.named<JavaExec>("run") {
    workingDir = rootDir                 // workspace/ resolves from the repository root
    standardInput = System.`in`          // the REPL and the approval prompt read stdin
    // Build (without tests) every project first, so compile errors anywhere surface before the agent starts.
    dependsOn(rootProject.subprojects.map { p -> p.tasks.matching { it.name == "assemble" } })
}

// Not part of `build`, which needs no API key: run `./gradlew verifySetup` to confirm the key, endpoint and network.
tasks.register<JavaExec>("verifySetup") {
    group = "verification"
    description = "Sends one small request to the model to confirm the API key, endpoint and network"
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass = "com.jdriven.harness.app.VerifySetupKt"
}
