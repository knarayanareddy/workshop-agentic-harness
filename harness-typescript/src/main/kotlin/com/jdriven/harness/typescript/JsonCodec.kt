package com.jdriven.harness.typescript

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.ContentBlock
import com.jdriven.harness.api.InferenceDecision
import com.jdriven.harness.api.Message
import com.jdriven.harness.api.ResultDecision
import com.jdriven.harness.api.Role
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.api.TurnContext
import com.jdriven.harness.api.TurnDecision
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/**
 * The TypeScript shapes from harness-api/typescript/harness.ts, as JSON. Kotlin sealed types become
 * unions discriminated by `kind`; field names follow the TS declarations.
 */
internal object JsonCodec {

    fun messages(messages: List<Message>) = JsonArray(messages.map(::message))

    fun message(m: Message) = buildJsonObject {
        put("role", if (m.role == Role.User) "user" else "assistant")
        put("content", JsonArray(m.content.map(::block)))
    }

    private fun block(b: ContentBlock): JsonObject = when (b) {
        is ContentBlock.Text -> buildJsonObject { put("kind", "text"); put("text", b.text) }
        is ContentBlock.ToolUse -> buildJsonObject {
            put("kind", "tool_use"); put("id", b.id); put("name", b.name); put("input", b.input)
            b.invalidInput?.let { put("invalidInput", it) }
        }
        is ContentBlock.ToolResult -> buildJsonObject {
            put("kind", "tool_result"); put("toolUseId", b.toolUseId); put("content", b.content); put("isError", b.isError)
        }
        is ContentBlock.Thinking -> buildJsonObject { put("kind", "thinking"); put("thinking", b.thinking); put("signature", b.signature) }
        is ContentBlock.RedactedThinking -> buildJsonObject { put("kind", "redacted_thinking"); put("data", b.data) }
    }

    fun turnContext(ctx: TurnContext) = buildJsonObject {
        put("runId", ctx.runId)
        put("iteration", ctx.iteration)
        put("maxIterations", ctx.maxIterations)
        put("iterationsRemaining", ctx.iterationsRemaining)
        put("messages", messages(ctx.messages))
    }

    fun toolCall(call: ToolCall) = buildJsonObject {
        put("id", call.id)
        put("tool", buildJsonObject { put("name", call.tool.name); put("description", call.tool.description) })
        put("input", call.input.json)
    }

    fun outcome(o: ToolOutcome) = when (o) {
        is ToolOutcome.Success -> buildJsonObject { put("kind", "success"); put("content", o.content) }
        is ToolOutcome.Failure -> buildJsonObject { put("kind", "failure"); put("message", o.message) }
    }

    fun event(e: AgentEvent): JsonObject = buildJsonObject {
        put("type", e::class.simpleName!!.replace(Regex("([a-z])([A-Z])"), "$1_$2").lowercase())
        put("runId", e.runId)
        when (e) {
            is AgentEvent.TurnStarted -> put("userMessage", e.userMessage)
            is AgentEvent.InferenceRequested -> {
                put("iteration", e.iteration); put("systemTokens", e.systemTokens); put("messageTokens", e.messageTokens)
                put("toolTokens", e.toolTokens); put("toolNames", JsonArray(e.toolNames.map(::JsonPrimitive)))
            }
            is AgentEvent.InferenceCompleted -> {
                put("iteration", e.iteration); put("stopReason", e.stopReason.name)
                put("usage", buildJsonObject {
                    put("inputTokens", e.usage.inputTokens); put("outputTokens", e.usage.outputTokens)
                    put("cacheReadInputTokens", e.usage.cacheReadInputTokens); put("cacheCreationInputTokens", e.usage.cacheCreationInputTokens)
                })
                put("content", JsonArray(e.content.map(::block)))
            }
            is AgentEvent.DynamicSectionEmitted -> { put("section", e.section); put("text", e.text) }
            is AgentEvent.ToolCallProposed -> { put("toolUseId", e.toolUseId); put("toolName", e.toolName); put("input", e.input) }
            is AgentEvent.GuardrailDecision -> { put("guardrail", e.guardrail); put("hook", e.hook); put("decision", e.decision); put("isDefault", e.isDefault) }
            is AgentEvent.ApprovalRequested -> { put("toolName", e.toolName); put("reasons", JsonArray(e.reasons.map(::JsonPrimitive))); put("decision", e.decision) }
            is AgentEvent.ToolCallCompleted -> { put("toolName", e.toolName); put("outcome", outcome(e.outcome)); put("durationMs", e.duration.toMillis()) }
            is AgentEvent.TurnEnded -> put("reason", e.reason)
            is AgentEvent.Warning -> put("message", e.message)
            is AgentEvent.Log -> { put("source", e.source); put("message", e.message) }
        }
    }

    // ---- decoding what TypeScript returns ----

    fun decodeOutcome(json: JsonElement, what: String): ToolOutcome = json.union(what, "success | failure") { kind ->
        when (kind) {
            "success" -> ToolOutcome.Success(string("content"))
            "failure" -> ToolOutcome.Failure(string("message"))
            else -> null
        }
    }

    fun decodeToolDecision(json: JsonElement, what: String): ToolDecision = json.union(what, "allow | deny | ask") { kind ->
        when (kind) {
            "allow" -> ToolDecision.Allow
            "deny" -> ToolDecision.Deny(string("reason"))
            "ask" -> ToolDecision.Ask(string("reason"))
            else -> null
        }
    }

    fun decodeResultDecision(json: JsonElement, what: String): ResultDecision = json.union(what, "accept | replace | reject") { kind ->
        when (kind) {
            "accept" -> ResultDecision.Accept
            "replace" -> ResultDecision.Replace(decodeOutcome(this["outcome"] ?: JsonNull, "$what.outcome"))
            "reject" -> ResultDecision.Reject(string("feedback"))
            else -> null
        }
    }

    fun decodeTurnDecision(json: JsonElement, what: String): TurnDecision = json.union(what, "allow_end | continue") { kind ->
        when (kind) {
            "allow_end" -> TurnDecision.AllowEnd
            "continue" -> TurnDecision.Continue(string("message"))
            else -> null
        }
    }

    fun decodeInferenceDecision(json: JsonElement, what: String): InferenceDecision = json.union(what, "proceed | proceed_with | abort") { kind ->
        when (kind) {
            "proceed" -> InferenceDecision.Proceed
            "proceed_with" -> InferenceDecision.ProceedWith(
                (this["messages"] as? JsonArray ?: fail(what, "proceed_with needs a messages array")).mapIndexed { i, m -> decodeMessage(m, "$what.messages[$i]") },
            )
            "abort" -> InferenceDecision.Abort(string("reason"))
            else -> null
        }
    }

    private fun decodeMessage(json: JsonElement, what: String): Message {
        val obj = json as? JsonObject ?: fail(what, "expected a message object")
        val role = when (obj.string("role", what)) {
            "user" -> Role.User
            "assistant" -> Role.Assistant
            else -> fail(what, "role must be \"user\" or \"assistant\"")
        }
        val content = obj["content"] as? JsonArray ?: fail(what, "content must be an array")
        return Message(role, content.mapIndexed { i, b -> decodeBlock(b, "$what.content[$i]") })
    }

    private fun decodeBlock(json: JsonElement, what: String): ContentBlock =
        json.union(what, "text | tool_use | tool_result | thinking | redacted_thinking") { kind ->
            when (kind) {
                "text" -> ContentBlock.Text(string("text"))
                "tool_use" -> ContentBlock.ToolUse(
                    string("id"), string("name"), this["input"] as? JsonObject ?: JsonObject(emptyMap()),
                    (this["invalidInput"] as? JsonPrimitive)?.contentOrNull,
                )
                "tool_result" -> ContentBlock.ToolResult(string("toolUseId"), string("content"), (this["isError"] as? JsonPrimitive)?.booleanOrNull ?: false)
                "thinking" -> ContentBlock.Thinking(string("thinking"), string("signature"))
                "redacted_thinking" -> ContentBlock.RedactedThinking(string("data"))
                else -> null
            }
        }

    private class UnionScope(val obj: JsonObject, val what: String) {
        operator fun get(key: String) = obj[key]
        fun string(key: String) = obj.string(key, what)
    }

    private fun <T> JsonElement.union(what: String, expected: String, decode: UnionScope.(String) -> T?): T {
        val obj = this as? JsonObject ?: fail(what, "expected an object { kind: $expected }, got $this")
        val kind = (obj["kind"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: fail(what, "missing 'kind' (expected $expected), got $obj")
        return UnionScope(obj, what).decode(kind) ?: fail(what, "unknown kind '$kind' (expected $expected)")
    }

    private fun JsonObject.string(key: String, what: String): String =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: fail(what, "'$key' must be a string")

    private fun fail(what: String, problem: String): Nothing = throw TypeScriptExtensionException("$what: $problem")

}
