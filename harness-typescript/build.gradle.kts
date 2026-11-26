plugins {
    alias(libs.plugins.kotlin.jvm)
    `java-library`
}

dependencies {
    api(project(":harness-api"))
    // v2 — the module now assembles a nested Agent for delegation, so the loop is a real dependency, not
    // only a test fixture. app already depends on both modules, so this adds no cycle.
    implementation(project(":harness-core"))
    implementation(libs.graalvm.polyglot)
    implementation(libs.graalvm.js)
    testImplementation(project(":harness-core"))
    testImplementation(testFixtures(project(":harness-core")))
}
