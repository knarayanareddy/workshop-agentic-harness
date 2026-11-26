package com.jdriven.harness.core

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.AgentRuntime
import com.jdriven.harness.api.ApprovalDecision
import com.jdriven.harness.api.ApprovalHandler
import com.jdriven.harness.api.ContentBlock
import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.ModelClient
import com.jdriven.harness.api.SubAgentOutcome
import com.jdriven.harness.api.SubAgentRunner
import com.jdriven.harness.api.SubAgentSpec
import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.core.ScriptedModelClient.Companion.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/**
 * v2 core seams: delegation (a nested loop), `acceptEdits` (the mode a guardrail may not implement) and
 * the interrupt check. The isolation claims are asserted here, not promised in a comment.
 */
class RuntimeTest {
    @TempDir lateinit var dir: Path

    private val events = mutableListOf<AgentEvent>()
    private val approvals = mutableListOf<List<String>>()

    private fun reader() = object : Tool {
        override val name = "read_file"
        override val description = "Reads a file"
        override val inputSchema = JsonSchema.obj().string("path", "the file to read").build()
        override fun execute(input: ToolInput, ctx: ToolContext) = ToolOutcome.Success("contents of ${input.string("path")}")
    }

    private fun writer() = object : Tool {
        override val name = "write_file"
        override val description = "Writes a file"
        override val inputSchema = JsonSchema.obj().string("path", "the file to write").build()
        override fun execute(input: ToolInput, ctx: ToolContext) = ToolOutcome.Success("wrote ${input.string("path")}")
    }

    private fun asker(reason: String = "confirm this") = object : Guardrail {
        override val name = "asker"
        override fun beforeToolUse(call: com.jdriven.harness.api.ToolCall, ctx: com.jdriven.harness.api.TurnContext) = ToolDecision.Ask(reason)
    }

    private fun denier(reason: String) = object : Guardrail {
        override val name = "denier"
        override fun beforeToolUse(call: com.jdriven.harness.api.ToolCall, ctx: com.jdriven.harness.api.TurnContext) = ToolDecision.Deny(reason)
    }

    private fun agent(
        model: ModelClient,
        tools: List<Tool> = listOf(reader(), writer()),
        guardrails: List<Guardrail> = emptyList(),
        runtime: AgentRuntime = object : AgentRuntime {},
        approval: ApprovalDecision = ApprovalDecision.Approve,
    ) = Agent(
        model = model,
        systemPrompt = listOf(SystemPromptSection.Static("base", "You are a test.")),
        tools = tools,
        guardrails = guardrails,
        approvalHandler = ApprovalHandler { approvals += it.reasons; approval },
        listeners = listOf(com.jdriven.harness.api.AgentEventListener { events += it }),
        workspace = LocalWorkspace(dir),
        config = AgentConfig(maxIterations = 4),
        runtime = runtime,
    )

    private fun path(value: String) = JsonObject(mapOf("path" to JsonPrimitive(value)))

    // ---- delegation: a nested loop -----------------------------------------------------------------

    private val explorer = SubAgentSpec("explorer", "read-only investigator", listOf("read_file"), maxIterations = 3)

    @Test
    fun `a delegated run is a nested loop that returns only the child's final text`() {
        // The parent delegates, then answers. The child reads a file and answers with a summary.
        val parentModel = ScriptedModelClient(
            listOf(
                ScriptedModelClient.toolUse("delegate" to JsonObject(mapOf("task" to JsonPrimitive("how big is it")))),
                text("the parent's own answer"),
            ),
        )
        val childModel = ScriptedModelClient(
            listOf(ScriptedModelClient.toolUse("read_file" to path("big.txt")), text("it is 3 lines")),
        )
        val childTranscripts = mutableListOf<List<com.jdriven.harness.api.Message>>()

        val delegation = object : Tool {
            override val name = "delegate"
            override val description = "Delegate to the explorer"
            override val inputSchema = JsonSchema.obj().string("task", "what to find out").build()
            override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
                val runner = SubAgentLoops.runner(
                    spec = explorer,
                    model = ModelClient { req -> childTranscripts += req.messages; childModel.infer(req) },
                    systemPrompt = listOf(SystemPromptSection.Static("role", "You are the explorer sub-agent.")),
                    tools = listOf(reader(), writer()),
                    guardrails = emptyList(),
                    workspace = LocalWorkspace(dir),
                )
                return when (val out = runner.run(input.string("task"))) {
                    is SubAgentOutcome.Completed -> ToolOutcome.Success(out.text)
                    is SubAgentOutcome.Failed -> ToolOutcome.Failure(out.reason)
                }
            }
        }

        val agent = agent(parentModel, tools = listOf(delegation))
        val result = agent.run("investigate the file")

        assertEquals("the parent's own answer", (result as AgentResult.Completed).text)
        // the summary crossed into the parent's transcript
        val toolResult = agent.messages.flatMap { it.content }.filterIsInstance<ContentBlock.ToolResult>().single()
        assertEquals("it is 3 lines", toolResult.content)
        // the child saw its OWN prompt only, never the parent's conversation. Its first request is the
        // task alone; later requests add the child's own tool results.
        assertTrue(childTranscripts.first().single().text.contains("how big is it"), "the child gets the task, not the transcript")
        assertEquals(2, childTranscripts.size, "the child ran its own loop: read, then answer")
        assertFalse(
            childTranscripts.flatten().any { it.text.contains("investigate the file") },
            "the parent's prompt must not leak into the child",
        )
        // and the child's file read is in the child's transcript only
        assertFalse(agent.messages.any { it.text.contains("contents of big.txt") }, "what the child read stays out of the parent")
    }

    @Test
    fun `a sub-agent only has the tools its spec names`() {
        val childModel = ScriptedModelClient(
            listOf(ScriptedModelClient.toolUse("write_file" to path("x.txt")), text("done")),
        )
        var offered: List<String> = emptyList()

        val runner = SubAgentLoops.runner(
            spec = explorer, // names read_file only
            model = ModelClient { req -> offered = req.tools.map { it.name }; childModel.infer(req) },
            systemPrompt = listOf(SystemPromptSection.Static("role", "explorer")),
            tools = listOf(reader(), writer()),
            guardrails = emptyList(),
            workspace = LocalWorkspace(dir),
        )
        val out = runner.run("write a file") as SubAgentOutcome.Completed

        assertEquals(listOf("read_file"), offered, "write_file must not even be offered to the child")
        assertTrue(out.text.contains("done"))
        assertTrue(out.calls >= 1, "the child made its calls in its own context")
    }

    @Test
    fun `a sub-agent cannot ask the human and its iteration budget is its own`() {
        // The child asks for a tool the guardrail gates, forever: it must stop at its own budget.
        val gate = asker("needs a human")
        val childModel = ScriptedModelClient(List(5) { ScriptedModelClient.toolUse("read_file" to path("a.txt")) })
        val runner = SubAgentLoops.runner(
            spec = explorer.copy(maxIterations = 2),
            model = childModel,
            systemPrompt = listOf(SystemPromptSection.Static("role", "explorer")),
            tools = listOf(reader()),
            guardrails = listOf(gate),
            workspace = LocalWorkspace(dir),
        )
        val out = runner.run("keep reading")

        val failed = assertInstanceOf(SubAgentOutcome.Failed::class.java, out)
        assertTrue(failed.reason.contains("limit"), "expected the child's own limit, got: ${failed.reason}")
        assertEquals(2, childModel.requests.size, "the child stopped at its own budget, not the parent's")
        assertTrue(approvals.isEmpty(), "a sub-agent must never reach the parent's approval handler")
    }

    @Test
    fun `a spec naming an unknown tool fails instead of silently running with fewer tools`() {
        val runner = SubAgentLoops.runner(
            spec = explorer.copy(tools = listOf("read_file", "telepathy")),
            model = ScriptedModelClient(listOf(text("never reached"))),
            systemPrompt = listOf(SystemPromptSection.Static("role", "explorer")),
            tools = listOf(reader()),
            guardrails = emptyList(),
            workspace = LocalWorkspace(dir),
        )
        val failed = assertInstanceOf(SubAgentOutcome.Failed::class.java, runner.run("go"))
        assertTrue(failed.reason.contains("telepathy"), "the typo must be named: ${failed.reason}")
    }

    @Test
    fun `list_agents tells the model what it may delegate to`() {
        val tool = ListAgentsTool(listOf(explorer))
        val out = tool.execute(ToolInput(JsonObject(emptyMap())), ToolContext("r", 1, "id", LocalWorkspace(dir)) { })
        val text = (out as ToolOutcome.Success).content
        assertTrue(text.contains("explorer"), text)
        assertTrue(text.contains("read_file"), "the child's tools are part of what the model needs to know")
    }

    // ---- acceptEdits -------------------------------------------------------------------------------

    private fun askEverything() = asker("confirm the write")

    private val edits = object : AgentRuntime {
        override val mode = "acceptEdits"
        override fun approveEditsFor(tool: Tool, input: ToolInput, workspace: com.jdriven.harness.api.Workspace) = tool.name == "write_file"
    }

    @Test
    fun `acceptEdits approves only the tools the bundle named, and only an ask`() {
        val model = ScriptedModelClient(
            listOf(
                ScriptedModelClient.toolUse("write_file" to path("a.txt")),
                ScriptedModelClient.toolUse("read_file" to path("b.txt")),
                text("done"),
            ),
        )
        val agent = agent(model, guardrails = listOf(askEverything()), runtime = edits)
        agent.run("go")
        // write_file was auto-approved (no prompt), read_file was not covered so the human was asked.
        assertEquals(1, approvals.size, "only the uncovered ask reaches the human")
        assertTrue(
            events.any { it is AgentEvent.ApprovalRequested && it.decision.contains("acceptEdits") },
            "the trace must say it was automatic, not silent",
        )
    }

    @Test
    fun `acceptEdits never overrides a deny`() {
        val model = ScriptedModelClient(listOf(ScriptedModelClient.toolUse("write_file" to path("a.txt")), text("done")))
        val agent = agent(model, guardrails = listOf(denier("the policy forbids this")), runtime = edits)
        agent.run("go")
        assertEquals(0, approvals.size, "a denied call is not offered to acceptEdits")
        val result = agent.messages.flatMap { it.content }.filterIsInstance<ContentBlock.ToolResult>().single()
        assertTrue(result.isError, "it must stay an error")
        assertTrue(result.content.contains("policy forbids"), result.content)
    }

    @Test
    fun `the mode is inert when it is not acceptEdits`() {
        val model = ScriptedModelClient(listOf(ScriptedModelClient.toolUse("write_file" to path("a.txt")), text("done")))
        val runtime = object : AgentRuntime {
            override val mode = "default"
            override fun approveEditsFor(tool: Tool, input: ToolInput, workspace: com.jdriven.harness.api.Workspace) = true
        }
        agent(model, guardrails = listOf(askEverything()), runtime = runtime).run("go")
        assertEquals(1, approvals.size, "approveEditsFor must not be consulted outside acceptEdits mode")
    }

    @Test
    fun `a failing acceptEdits check asks instead of approving`() {
        val model = ScriptedModelClient(listOf(ScriptedModelClient.toolUse("write_file" to path("a.txt")), text("done")))
        val broken = object : AgentRuntime {
            override val mode = "acceptEdits"
            override fun approveEditsFor(tool: Tool, input: ToolInput, workspace: com.jdriven.harness.api.Workspace): Boolean = error("bug in the bundle")
        }
        agent(model, guardrails = listOf(askEverything()), runtime = broken).run("go")
        assertEquals(1, approvals.size, "fail closed: ask, do not approve")
        assertTrue(events.any { it is AgentEvent.Warning && "acceptEdits" in it.message })
    }

    // ---- interrupt ---------------------------------------------------------------------------------

    @Test
    fun `an interrupt stops the loop between iterations and is not a silent limit`() {
        var seen = 0
        val budget = object : AgentRuntime {
            override fun interruptCheck(): String? = if (++seen > 1) "the sub-agent token budget is spent" else null
        }
        val model = ScriptedModelClient(
            listOf(ScriptedModelClient.toolUse("read_file" to path("a")), ScriptedModelClient.toolUse("read_file" to path("b")), text("never")),
        )
        val result = agent(model, runtime = budget).run("go")
        val aborted = assertInstanceOf(AgentResult.Aborted::class.java, result)
        assertTrue(aborted.reason.contains("budget"), aborted.reason)
        assertEquals(1, model.requests.size, "it stopped before the second inference call")
    }

    @Test
    fun `a throwing interrupt check is a warning, not a dead session`() {
        val broken = object : AgentRuntime {
            override fun interruptCheck(): String? = error("budget arithmetic overflowed")
        }
        val result = agent(ScriptedModelClient(listOf(text("still works"))), runtime = broken).run("go")
        assertEquals(AgentResult.Completed("still works"), result)
        assertTrue(events.any { it is AgentEvent.Warning && "interrupt" in it.message })
    }

    @Test
    fun `a sub-agent's runner is not given its own runner, so delegation cannot recurse`() {
        // The child is built with an empty AgentRuntime in SubAgentLoops.runner: asking it for a runner
        // returns null. This is the guard against a sub-agent spawning sub-agents without bound.
        val empty = object : AgentRuntime {}
        assertEquals(null, empty.subAgentRunner(explorer, LocalWorkspace(dir)))
        val delegating = object : AgentRuntime {
            override fun subAgentRunner(spec: SubAgentSpec, workspace: com.jdriven.harness.api.Workspace): SubAgentRunner? =
                SubAgentLoops.runner(spec, ScriptedModelClient(listOf(text("child"))), emptyList(), emptyList(), emptyList(), workspace)
        }
        assertTrue(delegating.subAgentRunner(explorer, LocalWorkspace(dir)) != null, "the parent may delegate")
    }
}
