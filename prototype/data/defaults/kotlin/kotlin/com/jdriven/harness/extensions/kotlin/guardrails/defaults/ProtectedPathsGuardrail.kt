package com.jdriven.harness.extensions.kotlin.guardrails.defaults

import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.ShellCommand
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.TurnContext
import com.jdriven.harness.api.Workspace
import com.jdriven.harness.api.WorkspaceViolation
import java.nio.file.InvalidPathException

/**
 * Keeps the model away from files it has no business reading or changing.
 * The file tools are already contained by the workspace; this guardrail adds which of the workspace's
 * own files are sensitive (secrets, git internals) and looks for them in `run_command` too. It does not
 * keep `run_command` inside the workspace. Only `beforeToolUse` is implemented.
 *
 * For `run_command` this is a check on the words in the command line, not a sandbox: it cannot see
 * through globs, variables, quotes, `$(...)` or an `sh -c` that builds a path at run time. The command
 * guardrail sends every command like that to a human.
 */
class ProtectedPathsGuardrail : Guardrail {

    override val name = "protected-paths"

    override fun beforeToolUse(call: ToolCall, ctx: TurnContext): ToolDecision {
        val tool = call.tool.name
        if (tool == "run_command") return checkCommand(call.input.string("command"), ctx.workspace)
        if (tool !in PATH_TOOLS) return ToolDecision.Allow

        val requested = call.input.stringOrNull("path") ?: return ToolDecision.Allow
        // Resolved and normalised first, so `a/../.env` is caught like `.env`.
        val relative = try {
            ctx.workspace.relativize(ctx.workspace.resolve(requested))
        } catch (outside: WorkspaceViolation) {
            return ToolDecision.Deny("'$requested' is outside the workspace")
        }
        return if (isProtected(relative)) denyProtected(relative) else ToolDecision.Allow
    }

    private fun checkCommand(command: String, workspace: Workspace): ToolDecision {
        val root = workspace.root
        for (word in WORD_BOUNDARY.split(command)) {
            if (word.isEmpty() || word == "/dev/null") continue
            if (ShellCommand.SHELL == "cmd.exe" && CMD_SWITCH.matches(word)) continue
            val resolved = try {
                root.resolve(word).normalize()
            } catch (notAPath: InvalidPathException) {
                continue
            }
            if (!resolved.startsWith(root)) continue
            val relative = workspace.relativize(resolved)
            if (isProtected(relative)) return denyProtected(relative)
        }
        return ToolDecision.Allow
    }

    private fun isProtected(relative: String) = !ALLOWED.containsMatchIn(relative) && PROTECTED.any { it.containsMatchIn(relative) }

    private fun denyProtected(relative: String) = ToolDecision.Deny("'$relative' is protected: it may hold secrets or repository internals")

    private companion object {
        val PATH_TOOLS = setOf("read_file", "write_file", "edit_file", "list_files", "glob", "grep")

        val PROTECTED = listOf(
            Regex("""(^|/)\.env(\..+)?$"""),
            Regex("""(^|/)\.git(/|$)"""),
            Regex("""\.(pem|key|p12|pfx)$"""),
            Regex("""(^|/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$"""),
        )

        val ALLOWED = Regex("""(^|/)\.env\.(example|sample|template)$""")

        /** Splits a command line into the words that may be paths. Quotes, redirects and separators are not part of one. */
        val WORD_BOUNDARY = Regex("""[\s;|&<>()"'`=]+""")

        /** cmd.exe switches (`dir /b`, `findstr /i`, `dir /a:d`) look like absolute paths but are not. */
        val CMD_SWITCH = Regex("""/[A-Za-z0-9?-]{1,3}(:[^/\\]*)?""")
    }
}
