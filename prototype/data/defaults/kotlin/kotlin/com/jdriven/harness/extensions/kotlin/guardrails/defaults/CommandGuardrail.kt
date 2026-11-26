package com.jdriven.harness.extensions.kotlin.guardrails.defaults

import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.TurnContext

/**
 * Keeps the model from running dangerous shell commands.
 * Never-acceptable commands are denied outright (§5.4: don't Ask when you mean Deny); anything not
 * on the read-only list waits for a human. Only `beforeToolUse` is implemented; the other hooks
 * keep their no-op defaults.
 */
class CommandGuardrail : Guardrail {

    override val name = "command"

    override fun beforeToolUse(call: ToolCall, ctx: TurnContext): ToolDecision {
        if (call.tool.name != "run_command") return ToolDecision.Allow

        val command = call.input.string("command")
        if (NEVER.any { it.containsMatchIn(command) }) return ToolDecision.Deny("'$command' is never allowed in this workshop")

        val readOnly = READ_ONLY.matches(command) && !SHELL_CONTROL.containsMatchIn(command) &&
            !SHELL_EXPANSION.containsMatchIn(command) && !WRITES_FILE.containsMatchIn(command)
        return if (readOnly) ToolDecision.Allow
        else ToolDecision.Ask("runs a command: $command")
    }

    private companion object {
        val NEVER = listOf(
            Regex("""\brm\b(?=[^;&|]*\s-[a-zA-Z]*[rR])(?=[^;&|]*\s-[a-zA-Z]*f)"""),
            Regex("""\bgit\s+push\b"""),
            Regex("""\bgit\s+reset\s+--hard\b"""),
        )

        val READ_ONLY = Regex("""\s*(ls|dir|cat|type|git\s+(status|diff|log)|(\./)?gradlew(\.bat)?\s+test)(\s.*)?""")

        /** Anything that can chain, redirect or substitute makes a "read-only" prefix meaningless: `ls; rm x`. */
        val SHELL_CONTROL = Regex("""[;&|<>`\n\r]|\$\(""")

        /**
         * Globs, variables, quotes and escapes become other words when the shell runs, so protected-paths
         * cannot see where they lead: `cat .en*` reads `.env`.
         */
        val SHELL_EXPANSION = Regex("""[*?\[\]{}$%~"'\\^]""")

        /** `git diff --output=build.gradle.kts` writes a file, read-only list or not. */
        val WRITES_FILE = Regex("""\s--output\b""")
    }
}
