plugins {
    alias(libs.plugins.kotlin.jvm)
    `java-library`
    `java-test-fixtures`
}

dependencies {
    api(project(":harness-api"))
}
