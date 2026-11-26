package com.jdriven.harness.extensions.kotlin.helpers

import com.jdriven.harness.api.ShellCommand
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.Workspace
import java.nio.file.InvalidPathException

/**
 * Looks at the command line of a `run_command` call, for guardrails. These read the words as they are typed,
 * they don't run a shell: a command that builds a word at run time (`$VAR`, globs, `$(...)`) gets past them.
 * The default `command` guardrail sends every command like that to a human.
 */
object Commands {
    private val WORD_BOUNDARY = Regex("""[\s;|&<>()"'`=]+""")
    private val HOME = Regex("""\$\{?HOME\b|%USERPROFILE%|\${'$'}env:USERPROFILE""", RegexOption.IGNORE_CASE)

    /** cmd.exe switches (`dir /b`, `dir /a:d`) look like absolute paths but are not. */
    private val CMD_SWITCH = Regex("""/[A-Za-z0-9?-]{1,3}(:[^/\\]*)?""")

    /** The command line when [call] is a `run_command` call; `null` for any other tool. */
    fun of(call: ToolCall): String? = if (call.tool.name == "run_command") call.input.stringOrNull("command") else null

    /**
     * The words of [command], as typed: `git -C OpenRA push "origin"` gives `git`, `-C`, `OpenRA`, `push`, `origin`.
     * Spaces, quotes, `;`, `&`, `|`, `<`, `>`, `(`, `)`, `` ` `` and `=` separate words.
     */
    fun words(command: String): List<String> = WORD_BOUNDARY.split(command).filter { it.isNotEmpty() }

    /**
     * Every word of [command] the way a program name is compared: lowercase, without its directory and without `.exe`.
     * `C:\Python\python.exe x.py` gives `python`, `x.py`. Every word, not only the first: `sh -c "python x.py"` and
     * `cmd /c python x.py` start Python too.
     */
    fun names(command: String): List<String> =
        words(command).map { it.substringAfterLast('/').substringAfterLast('\\').lowercase().removeSuffix(".exe") }

    /** Whether all of [words] occur in [command], in any order and ignoring case: `hasWords(command, "git", "push")`. */
    fun hasWords(command: String, vararg words: String): Boolean = names(command).containsAll(words.map { it.lowercase() })

    /**
     * Whether [word], read as a path, points outside [workspace]: `..`, `~`, `$HOME`, or an absolute path elsewhere.
     * Words that are not paths (`-la`, a cmd.exe switch like `/b`) do not.
     */
    fun isOutsideWorkspace(word: String, workspace: Workspace): Boolean {
        if (word.isEmpty() || word == "/dev/null") return false
        if (ShellCommand.SHELL == "cmd.exe" && CMD_SWITCH.matches(word)) return false
        if (word.startsWith("~") || HOME.containsMatchIn(word)) return true
        return try {
            !workspace.contains(word)
        } catch (_: InvalidPathException) {
            false // not a path on this platform
        }
    }
}
