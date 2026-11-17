plugins {
    // Downloads a JDK 25 for the Java toolchain (see build.gradle.kts) when none is installed locally.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "agentic-harness"

dependencyResolutionManagement {
    repositories { mavenCentral() }
}

include(
    "harness-api",          // the contract: interfaces and data types extensions implement
    "harness-core",         // the agent loop and model client; no tools or other extensions
    "harness-typescript",   // loads TypeScript extension bundles into the JVM (GraalJS)
    "app",                  // the assembly: the one place that decides what the agent is made of
)

// Every folder under extensions/ is its own Gradle project, so attendees add one by creating a folder.
file("extensions").listFiles { f -> f.isDirectory && f.resolve("build.gradle.kts").exists() }
    ?.sortedBy { it.name }
    ?.forEach { include(":extensions:${it.name}") }
