package com.jdriven.harness.core

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.AgentEventListener
import com.jdriven.harness.api.ApprovalDecision
import com.jdriven.harness.api.ApprovalHandler
import com.jdriven.harness.api.ApprovalScope
import com.jdriven.harness.api.ContentBlock
import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.InferenceResponse
import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.ResultDecision
import com.jdriven.harness.api.Role
import com.jdriven.harness.api.SectionRenderer
import com.jdriven.harness.api.StopReason
import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.api.TurnContext
import com.jdriven.harness.api.TurnDecision
import com.jdriven.harness.api.Usage
import com.jdriven.harness.core.ScriptedModelClient.Companion.text
import com.jdriven.harness.core.ScriptedModelClient.Companion.toolUse
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class AgentTest {
    @TempDir lateinit var dir: Path

    private val events = mutableListOf<AgentEvent>()
    private val approvals = mutableListOf<List<String>>()

    private fun echoTool(name: String = "echo") = object : Tool {
        override val name = name
        override val description = "Echoes its input"
        override val inputSchema = JsonSchema.obj().string("value", "what to echo").build()
        override fun execute(input: ToolInput, ctx: ToolContext) = ToolOutcome.Success("echo: ${input.string("value")}")
    }

    private fun agent(
        model: ScriptedModelClient,
        tools: List<Tool> = listOf(echoTool()),
        guardrails: List<Guardrail> = emptyList(),
        sections: List<SystemPromptSection> = listOf(SystemPromptSection.Static("base", "You are a test.")),
        approval: ApprovalDecision = ApprovalDecision.Approve,
    ) = Agent(
        model = model,
        systemPrompt = sections,
        tools = tools,
        guardrails = guardrails,
        approvalHandler = ApprovalHandler { approvals += it.reasons; approval },
        listeners = listOf(AgentEventListener { events += it }),
        workspace = LocalWorkspace(dir),
        config = AgentConfig(maxIterations = 5, maxTurnContinuations = 2),
    )

    private fun input(value: String) = JsonObject(mapOf("value" to JsonPrimitive(value)))

    @Test
    fun `all tool results of one assistant message go into a single user message, in order`() {
        val model = ScriptedModelClient(listOf(toolUse("echo" to input("a"), "echo" to input("b")), text("done")))
        val agent = agent(model)
        val result = agent.run("go")

        assertInstanceOf(AgentResult.Completed::class.java, result)
        val results = agent.messages[2]
        assertEquals(Role.User, results.role)
        assertEquals(listOf("echo: a", "echo: b"), results.content.map { (it as ContentBlock.ToolResult).content })
        assertEquals(4, agent.messages.size)
    }

    @Test
    fun `first Deny wins and suppresses the approval prompt`() {
        val asker = object : Guardrail {
            override val name = "asker"
            override fun beforeToolUse(call: ToolCall, ctx: TurnContext) = ToolDecision.Ask("please check")
        }
        val denier = object : Guardrail {
            override val name = "denier"
            override fun beforeToolUse(call: ToolCall, ctx: TurnContext) = ToolDecision.Deny("never")
        }
        val model = ScriptedModelClient(listOf(toolUse("echo" to input("x")), text("ok")))
        val agent = agent(model, guardrails = listOf(asker, denier))
        agent.run("go")

        val toolResult = agent.messages[2].content.single() as ContentBlock.ToolResult
        assertTrue(toolResult.isError)
        assertTrue("never" in toolResult.content)
        assertTrue(approvals.isEmpty(), "Prevent beats Gate: no human is asked")
    }

    @Test
    fun `Ask reasons are collected and the human is asked once`() {
        val asks = (1..2).map { n ->
            object : Guardrail {
                override val name = "asker$n"
                override fun beforeToolUse(call: ToolCall, ctx: TurnContext) = ToolDecision.Ask("reason $n")
            }
        }
        val model = ScriptedModelClient(listOf(toolUse("echo" to input("x")), text("ok")))
        val agent = agent(model, guardrails = asks, approval = ApprovalDecision.Deny("nope"))
        agent.run("go")

        assertEquals(listOf(listOf("reason 1", "reason 2")), approvals)
        val toolResult = agent.messages[2].content.single() as ContentBlock.ToolResult
        assertTrue(toolResult.isError && "nope" in toolResult.content)
    }

    @Test
    fun `afterToolUse sees rewrites and first Reject wins`() {
        val replacer = object : Guardrail {
            override val name = "replacer"
            override fun afterToolUse(call: ToolCall, result: ToolOutcome, ctx: TurnContext) = ResultDecision.Replace(ToolOutcome.Success("replaced"))
        }
        val rejecter = object : Guardrail {
            override val name = "rejecter"
            override fun afterToolUse(call: ToolCall, result: ToolOutcome, ctx: TurnContext) =
                if ((result as ToolOutcome.Success).content == "replaced") ResultDecision.Reject("bad") else ResultDecision.Accept
        }
        val model = ScriptedModelClient(listOf(toolUse("echo" to input("x")), text("ok")))
        val agent = agent(model, guardrails = listOf(replacer, rejecter))
        agent.run("go")

        val toolResult = agent.messages[2].content.single() as ContentBlock.ToolResult
        assertTrue(toolResult.isError)
        assertEquals("replaced\n\nRejected by guardrail 'rejecter': bad", toolResult.content)
    }

    @Test
    fun `a tool call with invalid input is answered with an error and not executed`() {
        val invalid = InferenceResponse(
            listOf(ContentBlock.ToolUse("call_1", "echo", JsonObject(emptyMap()), invalidInput = """{"value": "x""")),
            StopReason.ToolUse,
            Usage(0, 0),
        )
        val model = ScriptedModelClient(listOf(invalid, text("ok")))
        val agent = agent(model)
        agent.run("go")

        val toolResult = agent.messages[2].content.single() as ContentBlock.ToolResult
        assertTrue(toolResult.isError && """{"value": "x""" in toolResult.content)
        assertTrue(events.none { it is AgentEvent.ToolCallCompleted }, "the tool never ran")
    }

    @Test
    fun `a throwing tool becomes a Failure and does not crash the loop`() {
        val model = ScriptedModelClient(listOf(toolUse("echo" to JsonObject(emptyMap())), text("ok")))
        val agent = agent(model)
        val result = agent.run("go")
        val toolResult = agent.messages[2].content.single() as ContentBlock.ToolResult
        assertTrue(toolResult.isError && "missing required string parameter 'value'" in toolResult.content)
        assertInstanceOf(AgentResult.Completed::class.java, result)
    }

    @Test
    fun `beforeEndTurn Continue is bounded by maxTurnContinuations`() {
        val nag = object : Guardrail {
            override val name = "nag"
            override fun beforeEndTurn(ctx: TurnContext) = TurnDecision.Continue("keep going")
        }
        val model = ScriptedModelClient(List(3) { text("done $it") })
        val agent = agent(model, guardrails = listOf(nag))
        val result = agent.run("go")

        assertInstanceOf(AgentResult.Completed::class.java, result)
        assertEquals(3, model.requests.size)
        assertTrue(events.any { it is AgentEvent.Warning && "maxTurnContinuations" in it.message })
    }

    @Test
    fun `static sections form a frozen system prompt and dynamic sections are appended only when they change`() {
        val sections = listOf(
            SystemPromptSection.Dynamic("constant", SectionRenderer { "always the same" }),
            SystemPromptSection.Static("a", "first"),
            SystemPromptSection.Dynamic("remaining", SectionRenderer { "${it.iterationsRemaining} left" }),
            SystemPromptSection.Static("b", "second"),
        )
        val model = ScriptedModelClient(listOf(toolUse("echo" to input("x")), text("done")))
        agent(model, sections = sections).run("go")

        assertEquals(listOf("first\n\nsecond"), model.requests.map { it.system }.distinct())
        val firstUser = model.requests[0].messages.single().content.map { (it as? ContentBlock.Text)?.text }
        assertEquals(3, firstUser.size)
        assertTrue(firstUser[1]!!.contains("always the same") && firstUser[2]!!.contains("4 left"))

        // Second request: earlier messages untouched (append-only), only the changed section re-emitted.
        val second = model.requests[1].messages
        assertEquals(model.requests[0].messages[0], second[0])
        val lastUser = second.last().content
        assertInstanceOf(ContentBlock.ToolResult::class.java, lastUser[0])
        assertEquals(listOf("<context section=\"remaining\">\n3 left\n</context>"), lastUser.drop(1).map { (it as ContentBlock.Text).text })
    }

    @Test
    fun `a session continues across runs and repairs tool uses left dangling by max_tokens`() {
        val cutOff = toolUse("echo" to input("x")).copy(stopReason = com.jdriven.harness.api.StopReason.MaxTokens)
        val model = ScriptedModelClient(listOf(cutOff, text("second")))
        val agent = agent(model)

        assertInstanceOf(AgentResult.LimitReached::class.java, agent.run("first"))
        val result = agent.run("again")
        val repaired = agent.messages[2].content
        assertTrue((repaired[0] as ContentBlock.ToolResult).isError)
        assertEquals("again", (repaired[1] as ContentBlock.Text).text)
        assertEquals("second", (result as AgentResult.Completed).text)
    }

    // ---- v2: scoped approvals (REVIEW C2) -----------------------------------------------------------

    /** A guardrail that always asks, and states the scope it wants the approval to cover. */
    private fun scopedAsker(scope: (ToolCall) -> ApprovalScope) = object : Guardrail {
        override val name = "scoped-asker"
        override fun beforeToolUse(call: ToolCall, ctx: TurnContext) = ToolDecision.Ask("check this")
        override fun approvalScope(call: ToolCall, reasons: List<String>) = scope(call)
    }

    private fun argvOf(call: ToolCall): List<String> =
        call.input.json["argv"]?.let { (it as kotlinx.serialization.json.JsonArray).map { a -> (a as JsonPrimitive).content } } ?: emptyList()

    private fun argv(vararg a: String) = JsonObject(mapOf("argv" to kotlinx.serialization.json.JsonArray(a.map { JsonPrimitive(it) })))

    @Test
    fun `without a scope, approve-always still covers the whole tool (v1 behaviour is unchanged)`() {
        val model = ScriptedModelClient(
            listOf(toolUse("echo" to input("a")), toolUse("echo" to input("b")), text("done")),
        )
        val asker = object : Guardrail {
            override val name = "asker"
            override fun beforeToolUse(call: ToolCall, ctx: TurnContext) = ToolDecision.Ask("check")
        }
        val agent = agent(model, guardrails = listOf(asker), approval = ApprovalDecision.ApproveAlways)
        agent.run("go")
        assertEquals(1, approvals.size, "v1: one 'always' silences every later call of the tool")
    }

    @Test
    fun `an argv scope grants the same prefix again and asks again for a different subcommand`() {
        val scope = scopedAsker {
            // prefix = the program AND the subcommand, so `git status` is not `git push`
            ApprovalScope.ArgvPrefix("echo", argvOf(it).take(2))
        }
        val model = ScriptedModelClient(
            listOf(
                toolUse("echo" to argv("git", "status")),
                toolUse("echo" to argv("git", "status")),
                toolUse("echo" to argv("git", "push")),
                text("done"),
            ),
        )
        val agent = agent(model, guardrails = listOf(scope), approval = ApprovalDecision.ApproveAlways)
        agent.run("go")
        // first asks; second is covered by the remembered prefix; third is NOT covered
        assertEquals(2, approvals.size, "the scoped grant must not authorise a different subcommand")
    }

    @Test
    fun `a directory scope covers that directory and below, not a sibling`() {
        fun write(path: String) = JsonObject(mapOf("path" to JsonPrimitive(path)))
        val scope = scopedAsker { call ->
            val path = call.input.json["path"]!!.let { (it as JsonPrimitive).content }
            ApprovalScope.Directory(call.tool.name, path.substringBeforeLast('/', "."))
        }
        val model = ScriptedModelClient(
            listOf(
                toolUse("echo" to write("OpenRA/mods/ra/rules/a.yaml")),
                toolUse("echo" to write("OpenRA/mods/ra/rules/deep/b.yaml")),
                toolUse("echo" to write("OpenRA/glsl/c.frag")),
                text("done"),
            ),
        )
        val agent = agent(model, guardrails = listOf(scope), approval = ApprovalDecision.ApproveAlways)
        agent.run("go")
        assertEquals(2, approvals.size, "same directory and below are covered; the sibling is not")
    }

    @Test
    fun `Once never remembers anything`() {
        val scope = scopedAsker { ApprovalScope.Once }
        val model = ScriptedModelClient(
            listOf(toolUse("echo" to input("a")), toolUse("echo" to input("b")), text("done")),
        )
        val agent = agent(model, guardrails = listOf(scope), approval = ApprovalDecision.ApproveAlways)
        agent.run("go")
        assertEquals(2, approvals.size, "approve-always with a Once scope must still ask next time")
    }

    @Test
    fun `a guardrail that throws while stating its scope remembers nothing (fail closed)`() {
        val scope = scopedAsker { throw IllegalStateException("boom") }
        val model = ScriptedModelClient(
            listOf(toolUse("echo" to input("a")), toolUse("echo" to input("b")), text("done")),
        )
        val agent = agent(model, guardrails = listOf(scope), approval = ApprovalDecision.ApproveAlways)
        agent.run("go")
        assertEquals(2, approvals.size, "a broken scope must degrade to once-only, not to a blanket grant")
        assertTrue(events.any { it is AgentEvent.Warning && "approval scope" in it.message })
    }

    @Test
    fun `the approval request carries the scope, so a UI can show what it covers`() {
        val seen = mutableListOf<com.jdriven.harness.api.ApprovalRequest>()
        val scope = scopedAsker { ApprovalScope.ArgvPrefix("echo", listOf("git", "status")) }
        val model = ScriptedModelClient(listOf(toolUse("echo" to argv("git", "status")), text("done")))
        val agent = Agent(
            model = model,
            systemPrompt = listOf(SystemPromptSection.Static("base", "You are a test.")),
            tools = listOf(echoTool()),
            guardrails = listOf(scope),
            approvalHandler = ApprovalHandler { seen += it; ApprovalDecision.Approve },
            listeners = listOf(AgentEventListener { events += it }),
            workspace = LocalWorkspace(dir),
            config = AgentConfig(maxIterations = 5, maxTurnContinuations = 2),
        )
        agent.run("go")
        assertEquals(1, seen.size)
        assertEquals("argv:echo:git status", seen.single().scope.key)
    }
}
