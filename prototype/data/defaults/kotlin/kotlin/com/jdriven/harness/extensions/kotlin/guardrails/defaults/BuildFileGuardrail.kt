package com.jdriven.harness.extensions.kotlin.guardrails.defaults

import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.TurnContext

/** The worked example from §5.3: one guardrail that uses two of the verbs, PREVENT and GATE. */
class BuildFileGuardrail : Guardrail {
    override val name = "build-file"

    private val buildFiles = setOf("build.gradle.kts", "settings.gradle.kts", "gradle.properties", "pom.xml", "package.json")

    override fun beforeToolUse(call: ToolCall, ctx: TurnContext): ToolDecision {
        // Covers write_file and edit_file (REVIEW F-7: edit_file used to bypass the deny).
        if (call.tool.name != "write_file" && call.tool.name != "edit_file") return ToolDecision.Allow

        val relative = ctx.workspace.relativize(ctx.workspace.resolve(call.input.string("path")))

        return when {
            relative.substringAfterLast('/') in buildFiles ->
                ToolDecision.Deny("$relative is build configuration — make the test pass, not the build")

            // edit_file keeps its v1 behaviour: only the build-file deny is broadened.
            call.tool.name == "write_file" && !relative.startsWith("src/") ->
                ToolDecision.Ask("write outside src/: $relative")

            else -> ToolDecision.Allow
        }
    }
}
