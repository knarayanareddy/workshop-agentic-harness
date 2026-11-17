plugins {
    `java-library`
}

dependencies {
    api(project(":harness-api"))

    testImplementation(project(":harness-core")) // LocalWorkspace
}
