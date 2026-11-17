plugins {
    alias(libs.plugins.kotlin.jvm)
    `java-library`
}

dependencies {
    // Part of the contract: ContentBlock.ToolUse carries the model's raw JSON input.
    api(libs.kotlinx.serialization.json)
}
