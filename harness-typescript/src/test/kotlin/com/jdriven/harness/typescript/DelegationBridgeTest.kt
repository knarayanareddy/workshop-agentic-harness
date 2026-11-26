package com.jdriven.harness.typescript

import com.jdriven.harness.api.ApprovalDecision
import com.jdriven.harness.api.ApprovalHandler
import com.jdriven.harness.api.ContentBlock
import com.jdriven.harness.api.SubAgentSpec
import com.jdriven.harness.api.ToolInput
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
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/**
 * The whole delegation chain across the language boundary, without an API key and without the network:
 * a JS bundle declares `runtime.subAgents`, the adapter turns that into an [com.jdriven.harness.api.AgentRuntime],
 * the `delegate` tool calls `ctx.delegate`, and the JVM runs a real nested [Agent] with a scripted model.
 *
 * If this passes, "delegation is implemented" is a fact rather than a claim.
 */
class DelegationBridgeTest {
    @TempDir lateinit var dir: Path

    /** A bundle shaped like the real one: one read-only tool, one delegating tool, one declared agent. */
    private val script = """
        const SUB_AGENTS = [{
          name: "explorer",
          description: "read-only investigator",
          tools: ["peek"],
          maxIterations: 3,
        }];
        class Peek {
          name = "peek"; description = "Reads a path"; inputSchema = { type: "object", properties: {} };
          execute(input, ctx) { return { kind: "success", content: "peeked at " + input.path }; }
        }
        class Delegate {
          name = "delegate"; description = "delegates"; inputSchema = { type: "object", properties: {} };
          execute(input, ctx) {
            if (!ctx.delegate) return { kind: "failure", message: "no runner" };
            const out = ctx.delegate(SUB_AGENTS[0], String(input.task));
            return out.kind === "completed"
              ? { kind: "success", content: out.text + " (calls: " + out.calls + ")" }
              : { kind: "failure", message: String(out.reason) };
          }
        }
        globalThis.__harnessExtension = { default: () => ({
          systemPrompt: [{ kind: "static", name: "role", text: "You are a test." }],
          tools: [new Peek(), new Delegate()],
          guardrails: [],
          listeners: [],
          runtime: { mode: "acceptEdits", subAgents: SUB_AGENTS, approveEdits: (tool) => tool === "peek" },
        })};
    """.trimIndent()

    /**
     * Delegated runs use [model] (scripted) rather than the API client, so these tests need no API key and
     * no network. The runner captures the model while the bundle loads, so a test that wants a specific
     * sequence must set it BEFORE calling [load].
     */
    private var model: ScriptedModelClient = ScriptedModelClient(listOf(text("no model was configured for this test")))

    private fun load(script: String = this.script): com.jdriven.harness.api.ExtensionBundle {
        TypeScriptExtensions.useModel(model)
        return TypeScriptExtensions.loadScript(script, LocalWorkspace(dir))
    }

    private fun path(value: String) = JsonObject(mapOf("path" to JsonPrimitive(value)))

    @Test
    fun `the bundle's runtime declaration arrives in Kotlin`() {
        val runtime = load().runtime
        assertEquals("acceptEdits", runtime.mode)
        val spec = SubAgentSpec("explorer", "", listOf("peek"), 3)
        assertTrue(runtime.subAgentRunner(spec, LocalWorkspace(dir)) != null, "a declared agent must have a runner")
        assertTrue(runtime.subAgentRunner(spec.copy(name = "ghost"), LocalWorkspace(dir)) == null, "an undeclared one must not")
    }

    @Test
    fun `approveEdits crosses the boundary and a dishonest answer is refused`() {
        val runtime = load().runtime
        val peek = load().tools.first { it.name == "peek" }
        assertTrue(runtime.approveEditsFor(peek, ToolInput(JsonObject(emptyMap())), LocalWorkspace(dir)))
        val other = load().tools.first { it.name == "delegate" }
        assertTrue(!runtime.approveEditsFor(other, ToolInput(JsonObject(emptyMap())), LocalWorkspace(dir)))

        val liar = script.replace("approveEdits: (tool) => tool === \"peek\"", "approveEdits: () => \"yes\"")
        val broken = load(liar).runtime
        val failure = assertThrows<TypeScriptExtensionException> {
            broken.approveEditsFor(peek, ToolInput(JsonObject(emptyMap())), LocalWorkspace(dir))
        }
        assertTrue(failure.message!!.contains("boolean"), failure.message)
    }

    @Test
    fun `a bad mode or a malformed spec fails at load, not mid-turn`() {
        val badMode = assertThrows<TypeScriptExtensionException> { load(script.replace("\"acceptEdits\"", "\"yolo\"")) }
        assertTrue(badMode.message!!.contains("yolo"), badMode.message)

        // A spec naming a tool the bundle never registers: the child would silently have fewer tools
        // than its description promises, so this is a load error.
        val unknownTool = assertThrows<TypeScriptExtensionException> { load(script.replace("tools: [\"peek\"],", "tools: [\"nope\"],")) }
        assertTrue(unknownTool.message!!.contains("nope"), unknownTool.message)

        val zeroBudget = assertThrows<TypeScriptExtensionException> { load(script.replace("maxIterations: 3", "maxIterations: 0")) }
        assertTrue(zeroBudget.message!!.contains("maxIterations"), zeroBudget.message)
    }

    @Test
    fun `delegate runs a real nested loop with the sub-agent's own tools and returns only its answer`() {
        // The child runs INSIDE the delegate call, so it speaks between the parent's first and second
        // request: parent asks to delegate, child reads and answers, THEN the parent wraps up.
        val scripted = ScriptedModelClient(
            listOf(
                toolUse("delegate" to JsonObject(mapOf("task" to JsonPrimitive("look at a.txt")))),
                // ---- the child's two calls ----
                toolUse("peek" to path("a.txt")),
                text("a.txt says hello"),
                // ---- back in the parent ----
                text("parent is done"),
            ),
        )
        model = scripted
        try {
            val bundle = load()
            val agent = Agent(
                model = scripted,
                systemPrompt = bundle.systemPrompt,
                tools = bundle.tools,
                guardrails = bundle.guardrails,
                approvalHandler = ApprovalHandler { ApprovalDecision.Deny("this test never asks") },
                listeners = emptyList(),
                workspace = LocalWorkspace(dir),
                runtime = bundle.runtime,
            )
            val result = agent.run("go") as AgentResult.Completed

            assertEquals("parent is done", result.text)
            val toolResult = agent.messages.flatMap { it.content }.filterIsInstance<ContentBlock.ToolResult>().single()
            assertTrue(!toolResult.isError, toolResult.content)
            // Only the child's answer and its cost came back; "peeked at a.txt" stayed in the child.
            assertTrue(toolResult.content.contains("a.txt says hello"), toolResult.content)
            assertTrue(toolResult.content.contains("(calls: 2)"), "the cost of the child is reported: ${toolResult.content}")
            assertTrue(
                agent.messages.none { it.text.contains("peeked at a.txt") },
                "what the sub-agent read must not enter the parent's transcript",
            )
        } finally {
            TypeScriptExtensions.useModel(null)
        }
    }

    @Test
    fun `a sub-agent is judged by the same guardrails as its parent`() {
        // A guardrail that denies `peek` for everyone must also deny it inside the child.
        val denying = script.replace("guardrails: [],", """guardrails: [{
          name: "no-peek",
          beforeToolUse: (call) => call.tool.name === "peek"
            ? { kind: "deny", reason: "peek is forbidden" }
            : { kind: "allow" },
        }],""")
        val scripted = ScriptedModelClient(
            listOf(
                toolUse("delegate" to JsonObject(mapOf("task" to JsonPrimitive("look")))),
                // the child asks for the forbidden tool, three times, until its own budget stops it
                toolUse("peek" to path("a.txt")),
                toolUse("peek" to path("a.txt")),
                toolUse("peek" to path("a.txt")),
                // ---- back in the parent ----
                text("parent is done"),
            ),
        )
        model = scripted
        try {
            val bundle = load(denying)
            val agent = Agent(
                model = scripted,
                systemPrompt = bundle.systemPrompt,
                tools = bundle.tools,
                guardrails = bundle.guardrails,
                approvalHandler = ApprovalHandler { ApprovalDecision.Approve },
                listeners = emptyList(),
                workspace = LocalWorkspace(dir),
                runtime = bundle.runtime,
            )
            val result = agent.run("go") as AgentResult.Completed
            assertEquals("parent is done", result.text)
            val childSaw = agent.messages.flatMap { it.content }.filterIsInstance<ContentBlock.ToolResult>().first()
            // The child could not use peek, so its loop kept asking until its own budget ran out; the
            // parent is told that, rather than being handed content it forbade.
            assertTrue(childSaw.content.contains("forbidden") || childSaw.content.contains("limit"), childSaw.content)
        } finally {
            TypeScriptExtensions.useModel(null)
        }
    }

    @Test
    fun `delegation without a model fails honestly instead of pretending`() {
        TypeScriptExtensions.useModel(null)
        // With no MODEL_API_KEY in the test environment, defaultModel() is null, so there is no runner.
        val env = System.getenv("MODEL_API_KEY")
        if (!env.isNullOrBlank()) return // a developer machine with a key set: nothing to assert here
        val bundle = load()
        val runtime = bundle.runtime
        assertTrue(runtime.subAgentRunner(SubAgentSpec("explorer", "", listOf("peek"), 3), LocalWorkspace(dir)) == null)
    }
}
