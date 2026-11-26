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

// Two bundles: the v1 extension (always) and the v2 layer (used when HARNESS_V2=1).
val bundle = tasks.register<NpmTask>("bundle") {
    group = "build"
    description = "Type-checks, then bundles src/ into dist/extension.js and src/v2/ into dist/extension-v2.js"
    dependsOn(tasks.npmInstall)
    args = listOf("run", "typecheck", "bundle:v2", "bundle")
    inputs.dir("src")
    inputs.dir("policy")
    inputs.dir(rootProject.file("harness-api/typescript"))
    inputs.files("package.json", "tsconfig.json")
    val outputs2 = listOf(file("dist/extension.js"), file("dist/extension-v2.js"))
    outputs.files(outputs2)
    // Remove the previous bundles first: after a failed build there is no bundle, rather than a stale one that the
    // harness would silently keep running.
    doFirst { outputs2.forEach { it.delete() } }
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
    inputs.dir("policy")
    inputs.dir(rootProject.file("harness-api/typescript"))
    inputs.files("package.json", "tsconfig.json", "tsconfig.test.json", "vitest.config.mts")
    outputs.upToDateWhen { true } // no outputs of its own: up to date while the inputs are unchanged
    failClearly("The TypeScript tests (type-check + vitest)", "$tscErrors, or a failing test marked with FAIL or ×.")
}

tasks.check { dependsOn(npmTest) }
