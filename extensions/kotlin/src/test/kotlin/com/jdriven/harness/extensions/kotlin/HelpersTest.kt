package com.jdriven.harness.extensions.kotlin

import com.jdriven.harness.api.*
import com.jdriven.harness.core.LocalWorkspace
import com.jdriven.harness.extensions.kotlin.helpers.*
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/** The helpers the assignments build on. The same cases as HelpersTest in Java and helpers.test.ts. */
class HelpersTest {
    @TempDir
    lateinit var dir: Path

    private val workspace by lazy { LocalWorkspace(dir) }
    private fun toolCtx() = ToolContext("r", 1, "id", workspace, EventSink { })

    private fun call(tool: String, command: String) = ToolCall("1", object : Tool {
        override val name = tool
        override val description = ""
        override val inputSchema = JsonSchema.empty()
        override fun execute(input: ToolInput, ctx: ToolContext) = ToolOutcome.Success("")
    }, ToolInput(buildJsonObject { put("command", command) }))

    @Test
    fun `text truncates with a note and splits lines`() {
        assertEquals("short", Text.truncate("short", 10))
        assertEquals("abc\n[cut at 3 characters]", Text.truncate("abcdef", 3))
        assertEquals("abc\nread the rest", Text.truncate("abcdef", 3, "read the rest"))
        assertEquals(listOf("one", "two"), Text.nonBlankLines("one\r\n\r\n  \ntwo\n"))
    }

    @Test
    fun `host time is to the minute with an offset`() {
        assertTrue(Regex("""\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}""").matches(Host.now()), Host.now())
        assertTrue(Host.system().isNotBlank())
    }

    @Test
    fun `commands reads the command line of run_command only`() {
        assertEquals("ls -la", Commands.of(call("run_command", "ls -la")))
        assertNull(Commands.of(call("read_file", "ls -la")))
        assertEquals(listOf("git", "-C", "OpenRA", "push", "origin"), Commands.words("git -C OpenRA push \"origin\""))
        assertEquals(listOf("python", "x.py"), Commands.names("C:\\Python\\python.exe x.py"))
        assertEquals(listOf("sh", "-c", "python3", "x.py"), Commands.names("sh -c \"/usr/bin/python3 x.py\""))
        assertTrue(Commands.hasWords("cd OpenRA && GIT push", "git", "push"))
        assertFalse(Commands.hasWords("git status", "git", "push"))
        assertFalse(Commands.hasWords("git pushy", "git", "push"))
    }

    @Test
    fun `commands knows which words leave the workspace`() {
        listOf("..", "../x", "~/.ssh", "\$HOME/x", "%USERPROFILE%", dir.parent.toString()).forEach {
            assertTrue(Commands.isOutsideWorkspace(it, workspace), it)
        }
        listOf("", "OpenRA", "./out/x", "-la", "/dev/null").forEach { assertFalse(Commands.isOutsideWorkspace(it, workspace), it) }
    }

    @Test
    fun `toolbox status reads the log`() {
        assertEquals(Toolbox.State.NOT_STARTED, Toolbox.status(toolCtx()).state)
        workspace.writeText(Toolbox.START_LOG, "Step 1/9\nStep 2/9\n")
        assertEquals(Toolbox.Status(Toolbox.State.STARTING, "Step 1/9\nStep 2/9"), Toolbox.status(toolCtx()))
        workspace.writeText(Toolbox.START_LOG, "Step 9/9\n\nexit code 0\n")
        assertEquals(Toolbox.State.READY, Toolbox.status(toolCtx()).state)
        workspace.writeText(Toolbox.START_LOG, "error: no space left\n\nexit code 1\n")
        assertEquals(Toolbox.Status(Toolbox.State.FAILED, "error: no space left\nexit code 1"), Toolbox.status(toolCtx()))
    }

    private fun writeMod() {
        workspace.writeText(
            "${ModRules.MOD}/fluent/rules.ftl",
            "actor-2tnk =\n    .name = Medium Tank\n    .description = Tank.\n\nactor-tsla-name = Tesla Coil\nactor-vehicle-name = Vehicle\n",
        )
        workspace.writeText(
            "${ModRules.RULES}/vehicles.yaml",
            "^Vehicle:\n\tTooltip:\n\t\tName: actor-vehicle-name\n\tMobile:\n\t\tSpeed: 50\n\n" +
                "2TNK:\n\tInherits: ^Vehicle\n\tTooltip:\n\t\tName: actor-2tnk.name\n\tMobile:\n\t\tTurnSpeed: 20\n\t\tSpeed: 72\n\tHealth:\n\t\tHP: 400\n",
        )
        workspace.writeText("${ModRules.RULES}/structures.yaml", "# defenses\nTSLA:\n\tTooltip:\n\t\tName: actor-tsla-name\n")
        workspace.writeText("${ModRules.RULES}/README.txt", "not rules")
    }

    @Test
    fun `mod rules lists named actors without templates`() {
        writeMod()
        assertEquals(
            setOf(Actor("2TNK", "Medium Tank", "${ModRules.RULES}/vehicles.yaml"), Actor("TSLA", "Tesla Coil", "${ModRules.RULES}/structures.yaml")),
            ModRules.actors(workspace).toSet(),
        )
    }

    @Test
    fun `mod rules sets only a value the actor defines itself`() {
        writeMod()
        val file = "${ModRules.RULES}/vehicles.yaml"
        assertEquals(SetValueResult.Changed(file, "72"), ModRules.setValue(workspace, "2tnk", "Mobile", "Speed", " 80 "))
        assertTrue("\t\tSpeed: 80\n\tHealth:" in workspace.readText(file))
        assertTrue("\t\tSpeed: 50\n" in workspace.readText(file), "the template is untouched")
        assertEquals(SetValueResult.NoSuchKey(file), ModRules.setValue(workspace, "2TNK", "Health", "Armor", "Heavy"))
        assertEquals(SetValueResult.NoSuchTrait(file), ModRules.setValue(workspace, "2TNK", "Armament", "Weapon", "x"))
        assertEquals(SetValueResult.NoSuchActor, ModRules.setValue(workspace, "4TNK", "Mobile", "Speed", "1"))
        assertThrows<IllegalArgumentException> { ModRules.setValue(workspace, "2TNK", "Mobile", "Speed", "1\n\tHP: 1") }
    }
}
