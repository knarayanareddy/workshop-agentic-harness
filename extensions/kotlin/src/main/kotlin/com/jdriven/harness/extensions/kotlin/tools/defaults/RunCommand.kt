package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.ShellCommand
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome

/**
 * Lets the model build, run tests and use the shell.
 * The only tool with side effects beyond the workspace files, so it is the usual target for guardrails.
 */
object RunCommand : Tool {

    override val name = "run_command"

    override val description =
        "Run a shell command in the workspace root (${ShellCommand.SHELL}) and return its exit code and combined output. " +
            "Times out after ${ShellCommand.TIMEOUT_SECONDS} seconds; output is limited to the last ${ShellCommand.MAX_OUTPUT} characters."

    override val inputSchema = JsonSchema.obj().string("command", "The command line to run").build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val result = try {
            ShellCommand.run(ctx.workspace.root, input.string("command"))
        } catch (e: java.io.IOException) {
            return ToolOutcome.Failure("could not start command: ${e.message}")
        }
        if (result.timedOut) return ToolOutcome.Failure("Timed out after ${ShellCommand.TIMEOUT_SECONDS} seconds.\n${result.output}")
        val text = "exit code ${result.exitCode}\n${result.output}"
        return if (result.exitCode == 0) ToolOutcome.Success(text) else ToolOutcome.Failure(text)
    }
}
