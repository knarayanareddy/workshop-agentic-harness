package com.jdriven.harness.api

import kotlinx.serialization.json.JsonObject

// §1 Core model. Provided by the harness; not an extension point.

enum class Role { User, Assistant }

data class Message(val role: Role, val content: List<ContentBlock>) {

    /** All text blocks concatenated — what a human would call "the message". */
    val text: String get() = content.filterIsInstance<ContentBlock.Text>().joinToString("") { it.text }

    companion object {
        @JvmStatic fun user(text: String) = Message(Role.User, listOf(ContentBlock.Text(text)))
        @JvmStatic fun user(content: List<ContentBlock>) = Message(Role.User, content)
        @JvmStatic fun assistant(content: List<ContentBlock>) = Message(Role.Assistant, content)
    }
}

sealed interface ContentBlock {
    data class Text(val text: String) : ContentBlock

    /**
     * A tool call. When the model sent arguments that are not a JSON object, [invalidInput] holds them
     * verbatim and [input] is empty: the harness answers with an error instead of running the tool.
     */
    data class ToolUse @JvmOverloads constructor(
        val id: String,
        val name: String,
        val input: JsonObject,
        val invalidInput: String? = null,
    ) : ContentBlock

    data class ToolResult @JvmOverloads constructor(
        val toolUseId: String,
        val content: String,
        val isError: Boolean = false,
    ) : ContentBlock

    /**
     * The model's reasoning. **Opaque**: the signature binds it to this exact conversation, so it must
     * be sent back byte-for-byte. Read [thinking] for the trace; never construct or edit one.
     */
    data class Thinking(val thinking: String, val signature: String) : ContentBlock

    /** Reasoning the API returns encrypted. Opaque, like [Thinking]. */
    data class RedactedThinking(val data: String) : ContentBlock
}

enum class StopReason { EndTurn, ToolUse, MaxTokens, Refusal }

/** What a model sees of a tool: the part of [Tool] that goes over the wire. */
data class ToolDefinition(val name: String, val description: String, val inputSchema: JsonSchema)

data class InferenceRequest(
    val system: String,
    val messages: List<Message>,
    val tools: List<ToolDefinition>,
)

data class Usage(
    val inputTokens: Long,
    val outputTokens: Long,
    val cacheReadInputTokens: Long = 0,
    val cacheCreationInputTokens: Long = 0,
)

data class InferenceResponse(
    val content: List<ContentBlock>,
    val stopReason: StopReason,
    val usage: Usage,
)

/** Blocking by design: extensions run synchronously in the loop, so a call waits for the model. */
fun interface ModelClient {
    fun infer(request: InferenceRequest): InferenceResponse
}
