plugins {
    alias(libs.plugins.kotlin.jvm)
    `java-library`
}

dependencies {
    api(project(":harness-api"))
    implementation(libs.graalvm.polyglot)
    implementation(libs.graalvm.js)
    testImplementation(project(":harness-core"))
    testImplementation(testFixtures(project(":harness-core")))
}
