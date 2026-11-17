plugins {
    alias(libs.plugins.kotlin.jvm)
    `java-library`
}

dependencies {
    api(project(":harness-api"))

    testImplementation(project(":harness-core")) // LocalWorkspace
}
