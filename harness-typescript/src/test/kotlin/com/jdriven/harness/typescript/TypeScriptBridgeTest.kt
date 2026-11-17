package com.jdriven.harness.typescript

import com.jdriven.harness.api.*
import com.jdriven.harness.core.Agent
import com.jdriven.harness.core.AgentResult
import com.jdriven.harness.core.LocalWorkspace
import com.jdriven.harness.core.ScriptedModelClient
import com.jdriven.harness.core.ScriptedModelClient.Companion.text
import com.jdriven.harness.core.ScriptedModelClient.Companion.toolUse
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.Path
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText

class TypeScriptBridgeTest {
    @TempDir lateinit var dir: Path

    // Plain JS in the shape esbuild emits for a TS extension: a class with prototype methods,
    // async methods, and an object-literal guardrail with only some hooks.
    private val script = """
        class Shout {
          name = "shout";
          description = "Upper-cases a file's content";
          inputSchema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
          async execute(input, ctx) {
            await Promise.resolve();
            ctx.log("shouting", input.path);
            const text = ctx.workspace.readText(input.path);
            return { kind: "success", content: text.toUpperCase() };
          }
        }
        globalThis.__harnessExtension = { default: () => ({
          systemPrompt: [
            { kind: "static", name: "ts_static", text: "From TypeScript." },
            { kind: "dynamic", name: "ts_dynamic", render: (ctx) => ctx.iteration === 1 ? "first call" : null },
          ],
          tools: [new Shout()],
          guardrails: [{
            name: "no-secrets",
            beforeToolUse(call, ctx) {
              return call.input.path === "secret.txt" ? { kind: "deny", reason: "secret" } : { kind: "allow" };
            },
            async afterToolUse(call, result) {
              return { kind: "replace", outcome: { kind: "success", content: result.content + "!" } };
            },
          }],
          listeners: [(e) => { globalThis.seen = (globalThis.seen ?? 0) + 1; }],
        })};
    """.trimIndent()

    private fun agent(bundle: ExtensionBundle, model: ScriptedModelClient, events: MutableList<AgentEvent>) = Agent(
        model = model,
        systemPrompt = bundle.systemPrompt,
        tools = bundle.tools,
        guardrails = bundle.guardrails,
        approvalHandler = { ApprovalDecision.Approve },
        listeners = bundle.listeners + AgentEventListener { events += it },
        workspace = LocalWorkspace(dir),
    )

    private fun path(p: String) = JsonObject(mapOf("path" to JsonPrimitive(p)))

    @Test
    fun `a TypeScript bundle drives the real loop - async methods, workspace access, guardrails, sections, listeners`() {
        dir.resolve("hello.txt").writeText("hello")
        val events = mutableListOf<AgentEvent>()
        val bundle = TypeScriptExtensions.loadScript(script, LocalWorkspace(dir))
        val model = ScriptedModelClient(listOf(toolUse("shout" to path("hello.txt"), "shout" to path("secret.txt")), text("done")))
        val agent = agent(bundle, model, events)
        val result = agent.run("go")

        assertTrue(result is AgentResult.Completed)
        val results = agent.messages[2].content.map { it as ContentBlock.ToolResult }
        assertEquals("HELLO!", results[0].content)
        assertTrue(results[1].isError && "secret" in results[1].content)
        assertEquals("From TypeScript.", model.requests[0].system)
        assertTrue((model.requests[0].messages[0].content[1] as ContentBlock.Text).text.contains("first call"))
        assertTrue(events.any { it is AgentEvent.Log && "shouting hello.txt" in it.message })
    }

    @Test
    fun `a default export that is a function gets the workspace`() {
        val script = """
            globalThis.__harnessExtension = { default: (ctx) => ({ systemPrompt: [
              { kind: "static", name: "ctx", text: ctx.workspace.root },
            ]})};
        """.trimIndent()
        val ws = LocalWorkspace(dir)
        val bundle = TypeScriptExtensions.loadScript(script, workspace = ws)
        assertEquals(ws.root.toString(), (bundle.systemPrompt.single() as SystemPromptSection.Static).text)

        val plainObject = "globalThis.__harnessExtension = { default: { tools: [] } };"
        val ex = assertThrows<TypeScriptExtensionException> { TypeScriptExtensions.loadScript(plainObject, ws) }
        assertTrue("must be a function" in ex.message!!, ex.message)
    }

    @Test
    fun `a Promise that needs an event loop fails with an explanation instead of hanging`() {
        val bundle = TypeScriptExtensions.loadScript(
            """
            globalThis.__harnessExtension = { default: () => ({ tools: [{
              name: "sleepy", description: "waits", inputSchema: { type: "object" },
              execute: () => new Promise(() => {}),
            }]})};
            """.trimIndent(),
            LocalWorkspace(dir),
        )
        val tool = bundle.tools.single()
        val ex = assertThrows<TypeScriptExtensionException> {
            tool.execute(ToolInput(JsonObject(emptyMap())), toolContext())
        }
        assertTrue("no event loop" in ex.message!!)
    }

    @Test
    fun `malformed decisions name the extension and the expected shape`() {
        val bundle = TypeScriptExtensions.loadScript(
            """
            globalThis.__harnessExtension = { default: () => ({ tools: [{
              name: "bad", description: "returns garbage", inputSchema: { type: "object" },
              execute: () => ({ kind: "sucess", content: "typo" }),
            }]})};
            """.trimIndent(),
            LocalWorkspace(dir),
        )
        val ex = assertThrows<TypeScriptExtensionException> {
            bundle.tools.single().execute(ToolInput(JsonObject(emptyMap())), toolContext())
        }
        assertTrue("unknown kind 'sucess' (expected success | failure)" in ex.message!!, ex.message)
    }

    @Test
    fun `the bundled example extension loads, if it has been built`() {
        val bundleFile = generateSequence(Path("").toAbsolutePath()) { it.parent }
            .map { it.resolve("extensions/typescript/dist/extension.js") }.firstOrNull { it.exists() }
        assumeTrue(bundleFile != null, "run `npm run build` in extensions/typescript first")
        val bundle = TypeScriptExtensions.load(bundleFile!!, LocalWorkspace(dir))
        val ext = bundle
        assertTrue(ext.tools.isNotEmpty() || ext.guardrails.isNotEmpty() || ext.systemPrompt.isNotEmpty(), bundleFile.readText().take(200))
        ext.systemPrompt.filterIsInstance<SystemPromptSection.Static>().forEach { assertTrue(it.text.isNotBlank()) }
    }

    @Test
    fun `the bundled extension builds the role like the Java and Kotlin ones`() {
        val bundleFile = generateSequence(Path("").toAbsolutePath()) { it.parent }
            .map { it.resolve("extensions/typescript/dist/extension.js") }.firstOrNull { it.exists() }
        assumeTrue(bundleFile != null, "run `npm run build` in extensions/typescript first")
        val sections = TypeScriptExtensions.load(bundleFile!!, LocalWorkspace(dir)).systemPrompt
            .filterIsInstance<SystemPromptSection.Static>().associate { it.name to it.text }
        // the workshop replaces it, so check it only while it is still there
        sections["role"]?.let {
            assertEquals("You are a coding agent working in the directory ${dir.fileName}. Use the tools to inspect and change files; do not guess file contents.", it)
        }
    }

    @Test
    fun `the bundled extension is a complete agent and its guardrails and trace work through the bridge`() {
        val bundleFile = generateSequence(Path("").toAbsolutePath()) { it.parent }
            .map { it.resolve("extensions/typescript/dist/extension.js") }.firstOrNull { it.exists() }
        assumeTrue(bundleFile != null, "run `npm run build` in extensions/typescript first")
        val bundle = TypeScriptExtensions.load(bundleFile!!, LocalWorkspace(dir))
        val ext = bundle
        val names = ext.tools.map { it.name }
        assertEquals(names.toSet().size, names.size)
        assertTrue(names.containsAll(listOf("read_file", "write_file", "edit_file", "list_files", "glob", "grep", "run_command", "file_stats")))
        // the workshop adds sections and guardrails and removes default sections, so check what must stay true
        val sections = ext.systemPrompt.map { it.name }
        assertEquals(sections.toSet().size, sections.size, "duplicate section names: $sections")
        val guardrails = ext.guardrails.map { it.name }
        assertTrue(guardrails.containsAll(listOf("protected-paths", "command", "build-file", "result-cap")), guardrails.toString())

        val ws = LocalWorkspace(dir)
        val ctx = TurnContext("run", 1, 25, emptyList(), ws)
        fun call(tool: String, path: String) = ToolCall(
            "1", ext.tools.first { it.name == tool }, ToolInput(JsonObject(mapOf("path" to JsonPrimitive(path)))),
        )
        val protectedPaths = ext.guardrails.first { it.name == "protected-paths" }
        listOf(".env", "a/../.env", ".git/config", "../outside.txt").forEach {
            assertTrue(protectedPaths.beforeToolUse(call("read_file", it), ctx) is ToolDecision.Deny, it)
        }
        assertEquals(ToolDecision.Allow, protectedPaths.beforeToolUse(call("read_file", ".env.example"), ctx))

        val buildFile = ext.guardrails.first { it.name == "build-file" }
        assertTrue(buildFile.beforeToolUse(call("write_file", "pom.xml"), ctx) is ToolDecision.Deny)
        assertTrue(buildFile.beforeToolUse(call("write_file", "notes.md"), ctx) is ToolDecision.Ask)

        val cap = ext.guardrails.first { it.name == "result-cap" }
        val cut = cap.afterToolUse(call("read_file", "x"), ToolOutcome.Success("x".repeat(40_000)), ctx)
        assertTrue(cut is ResultDecision.Replace)

        ws.writeText("a.txt", "one two\nthree\n")
        val stats = ext.tools.first { it.name == "file_stats" }.execute(ToolInput(JsonObject(mapOf("path" to JsonPrimitive("a.txt")))), toolContext())
        assertEquals("a.txt: 3 lines, 3 words, 14 characters", (stats as ToolOutcome.Success).content)

        fun cmd(c: String) = ToolCall(
            "1", ext.tools.first { it.name == "run_command" },
            ToolInput(JsonObject(mapOf("command" to JsonPrimitive(c)))),
        )
        listOf("cat .env", "rm -fr x", "git push").forEach {
            val decisions = ext.guardrails.filter { g -> g.name == "protected-paths" || g.name == "command" }.map { g -> g.beforeToolUse(cmd(it), ctx) }
            assertTrue(decisions.any { d -> d is ToolDecision.Deny }, it)
        }
        val command = ext.guardrails.first { it.name == "command" }
        assertEquals(ToolDecision.Allow, command.beforeToolUse(cmd("ls -la"), ctx))
        listOf("ls; touch x", "cat .en*", "cat '.e'nv", "type %USERPROFILE%\\x", "git diff --output=build.gradle.kts").forEach {
            assertTrue(command.beforeToolUse(cmd(it), ctx) is ToolDecision.Ask, it)
        }
        assertEquals(ToolDecision.Allow, protectedPaths.beforeToolUse(cmd("cat .env.example 2>/dev/null"), ctx))
        // leaving the workspace is not protected-paths' job for run_command
        listOf("cat /etc/passwd", "ls ~", "ls ..", "cd / && ls").forEach {
            assertEquals(ToolDecision.Allow, protectedPaths.beforeToolUse(cmd(it), ctx), it)
        }
        if (ShellCommand.SHELL == "cmd.exe") {
            assertEquals(ToolDecision.Allow, protectedPaths.beforeToolUse(cmd("dir /b"), ctx))
        }

        val run = ext.tools.first { it.name == "run_command" }
        fun runIt(c: String) = run.execute(ToolInput(JsonObject(mapOf("command" to JsonPrimitive(c)))), toolContext())
        val ok = runIt("echo hi")
        assertTrue(ok is ToolOutcome.Success && "hi" in ok.content && "exit code 0" in ok.content)
        assertTrue(runIt("exit 3") is ToolOutcome.Failure)
        assertTrue("${ShellCommand.TIMEOUT_SECONDS} seconds" in run.description, run.description)
        val missing = run.execute(ToolInput(JsonObject(emptyMap())), toolContext())
        assertTrue(missing is ToolOutcome.Failure && "'command' must be a string" in missing.message, missing.toString())

        ext.listeners.first().onEvent(AgentEvent.Log("run", "test", "the trace listener does not throw"))
    }

    @Test
    fun `workspace containment and shell limits reach JS without relying on exception messages`() {
        val bundle = TypeScriptExtensions.loadScript(
            """
            globalThis.__harnessExtension = { default: () => ({ tools: [{
              name: "probe", description: "", inputSchema: { type: "object" },
              execute: (input, ctx) => ({ kind: "success", content: [
                ctx.workspace.contains("a/b"), ctx.workspace.contains("../x"), ctx.workspace.contains("/"),
                __harnessShell.name, __harnessShell.timeoutSeconds, __harnessShell.maxOutput,
              ].join(" ") }),
            }]})};
            """.trimIndent(),
            LocalWorkspace(dir),
        )
        val result = bundle.tools.single().execute(ToolInput(JsonObject(emptyMap())), toolContext())
        val shell = ShellCommand
        assertEquals("true false false ${shell.SHELL} ${shell.TIMEOUT_SECONDS} ${shell.MAX_OUTPUT}", (result as ToolOutcome.Success).content)
    }

    @Test
    fun `the assembly context can run commands, so static sections can look around at start-up`() {
        val bundle = TypeScriptExtensions.loadScript(
            """
            globalThis.__harnessExtension = { default: (ctx) => {
              const ok = ctx.exec("echo assembled");
              const bad = ctx.exec("exit 3");
              return { systemPrompt: [{ kind: "static", name: "probe",
                text: [ok.exitCode, ok.output.trim(), ok.timedOut, bad.exitCode].join(" ") }] };
            }};
            """.trimIndent(),
            LocalWorkspace(dir),
        )
        assertEquals("0 assembled false 3", (bundle.systemPrompt.single() as SystemPromptSection.Static).text)
    }

    @Test
    fun `spawn returns at once and the log ends with the exit code`() {
        val bundle = TypeScriptExtensions.loadScript(
            """
            globalThis.__harnessExtension = { default: () => ({ tools: [{
              name: "slow", description: "", inputSchema: { type: "object" },
              execute: (input, ctx) => { ctx.spawn(input.command, "out/slow.log"); return { kind: "success", content: "started" }; },
            }]})};
            """.trimIndent(),
            LocalWorkspace(dir),
        )
        val log = dir.resolve("out/slow.log")
        log.parent.toFile().mkdirs()
        log.writeText("left over from last time\n")
        val command = if (ShellCommand.SHELL == "cmd.exe") "echo first&& ping -n 3 127.0.0.1 > nul && echo second&& exit 3"
            else "echo first && sleep 2 && echo second && exit 3"

        val started = System.nanoTime()
        val result = bundle.tools.single().execute(ToolInput(JsonObject(mapOf("command" to JsonPrimitive(command)))), toolContext())
        assertEquals(ToolOutcome.Success("started"), result)
        assertTrue(System.nanoTime() - started < 1_500_000_000, "spawn waited for the command")

        val deadline = System.nanoTime() + 20_000_000_000
        while (log.readText().lines().none { it.startsWith("exit code") } && System.nanoTime() < deadline) Thread.sleep(100)
        assertEquals(listOf("first", "second", "exit code 3"), log.readText().lines().filter { it.isNotBlank() })
    }

    private fun toolContext() = ToolContext("run", 1, "toolu_1", LocalWorkspace(dir)) { }
}
