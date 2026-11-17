// Builds the TypeScript extension bundle with npm, so `./gradlew :app:run` picks it up.
// Gradle downloads its own Node.js on first use, so nothing needs to be installed.

import com.github.gradle.node.npm.task.NpmTask

plugins {
    base
    alias(libs.plugins.node.gradle)
}

node {
    download = true
    version = "24.22.2"   // pinned so every attendee builds with the same toolchain; keep in sync with the Dockerfile
}

// npm's own failure ("npm.cmd finished with non-zero exit value 2") hides the actual tsc errors further up in the
// output. Turn it into a message that says what failed and what to look for.
fun NpmTask.failClearly(what: String, lookFor: String) {
    ignoreExitValue = true
    doLast {
        if (result?.exitValue != 0) throw GradleException(
            "$what failed. Scroll up to the `> Task $path` output and look for $lookFor\n" +
                "Fix that in extensions/typescript, then run the same command again."
        )
    }
}

val tscErrors = "type errors such as\n" +
    "    src/systemprompt/defaults/role.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\n" +
    "(file, line and column)"

val bundle = tasks.register<NpmTask>("bundle") {
    group = "build"
    description = "Type-checks and bundles src/ into dist/extension.js"
    dependsOn(tasks.npmInstall)
    args = listOf("run", "build")
    inputs.dir("src")
    inputs.dir(rootProject.file("harness-api/typescript"))
    inputs.files("package.json", "tsconfig.json")
    val output = file("dist/extension.js")
    outputs.file(output)
    // Remove the previous bundle first: after a failed build there is no bundle, rather than a stale one that the
    // harness would silently keep running.
    doFirst { output.delete() }
    failClearly("The TypeScript build (type-check + bundle)", "$tscErrors.")
}

tasks.assemble { dependsOn(bundle) }

// The TypeScript twin of DefaultsTest in Java and Kotlin: vitest, in the Node.js Gradle downloaded.
val npmTest = tasks.register<NpmTask>("npmTest") {
    group = "verification"
    description = "Type-checks and runs the vitest tests in test/"
    dependsOn(tasks.npmInstall)
    args = listOf("test")
    inputs.dir("src")
    inputs.dir("test")
    inputs.dir(rootProject.file("harness-api/typescript"))
    inputs.files("package.json", "tsconfig.json", "tsconfig.test.json", "vitest.config.mts")
    outputs.upToDateWhen { true } // no outputs of its own: up to date while the inputs are unchanged
    failClearly("The TypeScript tests (type-check + vitest)", "$tscErrors, or a failing test marked with FAIL or ×.")
}

tasks.check { dependsOn(npmTest) }
