package com.jdriven.harness.extensions.kotlin

import com.jdriven.harness.api.*
import com.jdriven.harness.core.LocalWorkspace
import com.jdriven.harness.extensions.kotlin.guardrails.defaults.BuildFileGuardrail
import com.jdriven.harness.extensions.kotlin.guardrails.defaults.CommandGuardrail
import com.jdriven.harness.extensions.kotlin.guardrails.defaults.ProtectedPathsGuardrail
import com.jdriven.harness.extensions.kotlin.guardrails.defaults.ResultCapGuardrail
import com.jdriven.harness.extensions.kotlin.systemprompt.defaults.IterationBudget
import com.jdriven.harness.extensions.kotlin.systemprompt.defaults.Role
import com.jdriven.harness.extensions.kotlin.systemprompt.defaults.WorkingAgreements
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class DefaultsTest {
    @TempDir
    lateinit var dir: Path

    private val bundle by lazy { KotlinExtensions.bundle(LocalWorkspace(dir)) }
    private fun tool(name: String): Tool = bundle.tools.first { it.name == name }
    private fun input(vararg fields: Pair<String, String>) = ToolInput(buildJsonObject { fields.forEach { (k, v) -> put(k, v) } })
    private fun ctx() = TurnContext("run", 1, 25, emptyList(), LocalWorkspace(dir))
    private fun call(tool: String, vararg fields: Pair<String, String>) = ToolCall("1", tool(tool), input(*fields))

    // The workshop adds to the bundle and removes default sections from it, so these tests check
    // what must stay true of any bundle, and test the defaults directly instead of through the bundle.
    @Test
    fun `bundle has the default tools and guardrails and no duplicate names`() {
        val names = bundle.tools.map { it.name }
        assertEquals(names.toSet().size, names.size, "duplicate tool names: $names")
        assertTrue(names.containsAll(listOf("read_file", "write_file", "edit_file", "list_files", "glob", "grep", "run_command", "file_stats")), names.toString())
        val sections = bundle.systemPrompt.map { it.name }
        assertEquals(sections.toSet().size, sections.size, "duplicate section names: $sections")
        val guardrails = bundle.guardrails.map { it.name }
        assertTrue(guardrails.containsAll(listOf(ProtectedPathsGuardrail(), CommandGuardrail(), BuildFileGuardrail(), ResultCapGuardrail()).map { it.name }), guardrails.toString())
        assertTrue(bundle.listeners.isNotEmpty())
    }

    @Test
    fun `default sections build the role`() {
        assertEquals(
            "You are a coding agent working in the directory ${dir.fileName}. Use the tools to inspect and change files; do not guess file contents.",
            Role.section(LocalWorkspace(dir)).text,
        )
        assertTrue(WorkingAgreements.section().text.isNotBlank())
    }

    @Test
    fun `iteration budget speaks only when tight`() {
        val section = IterationBudget.section()
        assertNull(section.render.render(TurnContext("r", 1, 25, emptyList(), LocalWorkspace(dir))))
        assertTrue(section.render.render(TurnContext("r", 22, 25, emptyList(), LocalWorkspace(dir)))!!.contains("3 inference calls"))
    }

    @Test
    fun `file stats counts through the workspace`() {
        val ws = LocalWorkspace(dir).also { it.writeText("a.txt", "one two\nthree\n") }
        val result = tool("file_stats").execute(input("path" to "a.txt"), ToolContext("r", 1, "id", ws, EventSink { }))
        assertEquals("a.txt: 3 lines, 3 words, 14 characters", (result as ToolOutcome.Success).content)
    }

    @Test
    fun `command guardrail denies destructive and asks for chained commands`() {
        val guard = CommandGuardrail()
        fun decide(c: String) = guard.beforeToolUse(call("run_command", "command" to c), ctx())
        listOf("rm -rf x", "rm -fr x", "rm -r -f x", "git push origin main").forEach { assertInstanceOf(ToolDecision.Deny::class.java, decide(it), it) }
        listOf("ls -la", "git status").forEach { assertEquals(ToolDecision.Allow, decide(it), it) }
        listOf("ls; touch x", "cat a > b", "ls && touch x", "cat \$(touch x)", "ls\ntouch x", "npm install").forEach { assertInstanceOf(ToolDecision.Ask::class.java, decide(it), it) }
        // the shell turns these into other paths than the guardrails see
        listOf("cat .en*", "cat .gi?/config", "cat '.e'nv", "cat .e\\nv", "cat \$OLDPWD/x", "type %USERPROFILE%\\x").forEach { assertInstanceOf(ToolDecision.Ask::class.java, decide(it), it) }
        listOf("git diff --output=build.gradle.kts", "git log --output=src/A.kt").forEach { assertInstanceOf(ToolDecision.Ask::class.java, decide(it), it) }
    }

    @Test
    fun `protected paths are denied for tools and commands`() {
        val guard = ProtectedPathsGuardrail()
        fun file(p: String) = guard.beforeToolUse(call("read_file", "path" to p), ctx())
        fun cmd(c: String) = guard.beforeToolUse(call("run_command", "command" to c), ctx())
        listOf(".env", "app/.env.local", "a/../.env", ".git/config", "certs/server.pem", "id_rsa", "../outside.txt").forEach { assertInstanceOf(ToolDecision.Deny::class.java, file(it), it) }
        assertEquals(ToolDecision.Allow, file(".env.example"))
        assertEquals(ToolDecision.Allow, file("src/Main.kt"))
        listOf("cat .env", "cat \".env\"", "cp x .git/config").forEach { assertInstanceOf(ToolDecision.Deny::class.java, cmd(it), it) }
        // leaving the workspace is not this guardrail's job for run_command
        listOf("cat /etc/passwd", "ls ~", "ls ..", "ls \$HOME", "cd / && ls").forEach { assertEquals(ToolDecision.Allow, cmd(it), it) }
        val inside = LocalWorkspace(dir).root.resolve("src/A.kt").toString()
        listOf("ls -la", "cat .env.example", "./gradlew test", "cat $inside", "ls 2>/dev/null").forEach { assertEquals(ToolDecision.Allow, cmd(it), it) }
        if (ShellCommand.SHELL == "cmd.exe") listOf("dir /b", "findstr /i foo src", "dir /a:d").forEach { assertEquals(ToolDecision.Allow, cmd(it), it) }
    }

    @Test
    fun `build files are denied and writes outside src are gated`() {
        val guard = BuildFileGuardrail()
        fun write(p: String) = guard.beforeToolUse(call("write_file", "path" to p), ctx())
        assertInstanceOf(ToolDecision.Deny::class.java, write("pom.xml"))
        assertInstanceOf(ToolDecision.Deny::class.java, write("src/../pom.xml"))
        assertInstanceOf(ToolDecision.Ask::class.java, write("notes.md"))
        assertEquals(ToolDecision.Allow, write("src/A.kt"))
    }

    @Test
    fun `oversized results are capped`() {
        val c = call("read_file")
        val cap = ResultCapGuardrail(10)
        assertEquals(ResultDecision.Accept, cap.afterToolUse(c, ToolOutcome.Success("short"), ctx()))
        assertEquals(ResultDecision.Accept, cap.afterToolUse(c, ToolOutcome.Failure("x".repeat(50)), ctx()))
        val cut = cap.afterToolUse(c, ToolOutcome.Success("x".repeat(50)), ctx()) as ResultDecision.Replace
        assertTrue((cut.outcome as ToolOutcome.Success).content.startsWith("xxxxxxxxxx\n\n[truncated"))
    }
}
