package com.jdriven.harness.core

import com.jdriven.harness.api.*
import kotlinx.serialization.json.*
import java.io.PrintStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * [ModelClient] for any OpenAI-compatible Chat Completions endpoint (`POST {baseUrl}/chat/completions`):
 * OpenAI itself, or servers that mimic it (vLLM, Ollama, LM Studio, OpenRouter, ...).
 *
 * - The API key is read from `MODEL_API_KEY` and sent as a bearer token. Local servers that ignore
 *   it still need the variable set (any value will do).
 * - The model and base URL default to `MODEL_NAME` and `MODEL_BASE_URL`, falling back to
 *   [DEFAULT_MODEL] and [DEFAULT_BASE_URL] when unset.
 * - Set `MODEL_LOG_RAW` (any value) to print every raw request and response body to stderr, for debugging
 *   the mapping or replaying a request. The API key is a header, so it is not printed.
 * - Reasoning is not part of the Chat Completions spec, but many compatible servers return it as
 *   `reasoning_content` (DeepSeek, vLLM, Qwen, LiteLLM) or `reasoning` (OpenRouter, Ollama). It becomes
 *   a [ContentBlock.Thinking] whose signature is that field's name, and is sent back in the same field.
 *   OpenAI itself does not return reasoning text from this endpoint.
 * - LiteLLM also returns Anthropic's signed `thinking_blocks`. Those become [ContentBlock.Thinking] /
 *   [ContentBlock.RedactedThinking] with their real signatures, and are sent back as `thinking_blocks`:
 *   Anthropic rejects a tool-calling turn whose thinking is missing.
 * - Tool call arguments are a JSON *string* that the model may get wrong. Arguments that do not parse
 *   to a JSON object end up in [ContentBlock.ToolUse.invalidInput], and the agent reports the error
 *   to the model instead of running the tool. They are sent back verbatim.
 * - There is no `is_error` on tool results, so a failed [ContentBlock.ToolResult] is sent with an
 *   `Error: ` prefix.
 * - Gemini sometimes emits a tool call it cannot parse (`native_finish_reason: MALFORMED_FUNCTION_CALL`), which
 *   arrives as an empty `stop`. The request is retried with a note to the model appended; if that keeps failing,
 *   [infer] throws instead of returning an empty answer.
 */
class OpenAiModelClient(
    val model: String = System.getenv(MODEL_ENV) ?: DEFAULT_MODEL,
    val baseUrl: String = System.getenv(BASE_URL_ENV) ?: DEFAULT_BASE_URL,
    private val apiKey: String = System.getenv(API_KEY_ENV)
        ?: error("Environment variable $API_KEY_ENV is not set"),
) : ModelClient {
    /** Where each raw request and response body is printed; `null` (unless `MODEL_LOG_RAW` is set) prints nothing. */
    private val rawLog: PrintStream? = if (System.getenv(LOG_RAW_ENV) != null) System.err else null
    private val http: HttpClient = HttpClient.newHttpClient()

    override fun infer(request: InferenceRequest): InferenceResponse = infer(request, ::post)

    // A malformed call is retried with a note appended (not stored in the history), so the model does not repeat the same mistake.
    internal fun infer(request: InferenceRequest, post: (JsonObject) -> JsonObject): InferenceResponse {
        val body = toRequestBody(request)
        var json = post(body)
        for (attempt in 1..MALFORMED_CALL_RETRIES) {
            if (!isMalformedCall(json)) break
            rawLog?.println("[retry  ] malformed function call; retry $attempt/$MALFORMED_CALL_RETRIES with a note")
            json = post(withNote(body, MALFORMED_CALL_NOTE))
        }
        check(!isMalformedCall(json)) { "Model kept producing a malformed function call ($MALFORMED_CALL_RETRIES retries)" }
        return fromResponse(json)
    }

    private fun post(body: JsonObject): JsonObject {
        val requestBody = body.toString()
        val httpRequest = HttpRequest.newBuilder(URI.create(baseUrl.trimEnd('/') + "/chat/completions"))
            .header("Authorization", "Bearer $apiKey")
            .header("Content-Type", "application/json")
            .timeout(REQUEST_TIMEOUT)
            .POST(HttpRequest.BodyPublishers.ofString(requestBody))
            .build()
        rawLog?.println("[request] $requestBody")
        val response = http.send(httpRequest, HttpResponse.BodyHandlers.ofString())
        rawLog?.println("[raw    ] ${response.statusCode()} ${response.body()}")
        check(response.statusCode() in 200..299) { "Chat Completions request failed (${response.statusCode()}): ${response.body()}" }
        return Json.parseToJsonElement(response.body()).jsonObject
    }

    // Gemini (via LiteLLM) discards a call it cannot parse and reports a plain `stop` with no content.
    private fun isMalformedCall(json: JsonObject): Boolean {
        val choice = (json["choices"] as? JsonArray)?.firstOrNull() as? JsonObject ?: return false
        val fields = choice["provider_specific_fields"] as? JsonObject ?: return false
        return fields["native_finish_reason"].stringOrNull() == "MALFORMED_FUNCTION_CALL"
    }

    private fun withNote(body: JsonObject, note: String): JsonObject = JsonObject(
        body + ("messages" to JsonArray(body.getValue("messages").jsonArray + buildJsonObject { put("role", "user"); put("content", note) })),
    )

    internal fun toRequestBody(request: InferenceRequest): JsonObject = buildJsonObject {
        put("model", model)
        put("messages", buildJsonArray {
            if (request.system.isNotEmpty()) add(buildJsonObject { put("role", "system"); put("content", request.system) })
            request.messages.forEach { message -> toMessages(message).forEach(::add) }
        })
        if (request.tools.isNotEmpty()) {
            put("tools", buildJsonArray {
                request.tools.forEach { tool ->
                    add(buildJsonObject {
                        put("type", "function")
                        put("function", buildJsonObject {
                            put("name", tool.name)
                            put("description", tool.description)
                            put("parameters", tool.inputSchema.json)
                        })
                    })
                }
            })
        }
    }

    // One harness message can become several wire messages: each tool result is its own `tool` message.
    internal fun toMessages(message: Message): List<JsonObject> = when (message.role) {
        Role.Assistant -> {
            val toolUses = message.content.filterIsInstance<ContentBlock.ToolUse>()
            listOf(buildJsonObject {
                put("role", "assistant")
                put("content", message.text.ifEmpty { null })
                val (reasoning, signed) = message.content
                    .filter { it is ContentBlock.Thinking || it is ContentBlock.RedactedThinking }
                    .partition { it is ContentBlock.Thinking && it.signature in REASONING_FIELDS }
                reasoning.map { it as ContentBlock.Thinking }
                    .groupBy { it.signature }
                    .forEach { (field, blocks) -> put(field, blocks.joinToString("") { it.thinking }) }
                if (signed.isNotEmpty()) put("thinking_blocks", JsonArray(signed.mapNotNull(::toThinkingBlock)))
                if (toolUses.isNotEmpty()) {
                    put("tool_calls", buildJsonArray {
                        toolUses.forEach { use ->
                            add(buildJsonObject {
                                put("id", use.id)
                                put("type", "function")
                                put("function", buildJsonObject { put("name", use.name); put("arguments", use.invalidInput ?: use.input.toString()) })
                            })
                        }
                    })
                }
            })
        }
        // Tool results first: they must directly follow the assistant message that called the tools.
        Role.User -> message.content.filterIsInstance<ContentBlock.ToolResult>().map { result ->
            buildJsonObject {
                put("role", "tool")
                put("tool_call_id", result.toolUseId)
                put("content", if (result.isError) "Error: ${result.content}" else result.content)
            }
        } + listOfNotNull(message.text.ifEmpty { null }?.let { text -> buildJsonObject { put("role", "user"); put("content", text) } })
    }

    internal fun fromResponse(json: JsonObject): InferenceResponse {
        val choice = json.getValue("choices").jsonArray.first().jsonObject
        val message = choice.getValue("message").jsonObject
        val refusal = message["refusal"].stringOrNull()
        val text = contentText(message["content"]) ?: refusal
        // Signed blocks (LiteLLM, Anthropic models) say the same as reasoning_content, and must be replayed.
        val thinking = (message["thinking_blocks"] as? JsonArray)?.mapNotNull { fromThinkingBlock(it.jsonObject) }?.ifEmpty { null }
            ?: listOfNotNull(
                REASONING_FIELDS.firstNotNullOfOrNull { field ->
                    message[field].stringOrNull()?.ifBlank { null }?.let { ContentBlock.Thinking(it, signature = field) }
                },
            )
        val toolCalls = (message["tool_calls"] as? JsonArray).orEmpty().map { call ->
            val function = call.jsonObject.getValue("function").jsonObject
            val arguments = function["arguments"].stringOrNull().orEmpty()
            val input = parseArguments(arguments)
            ContentBlock.ToolUse(
                id = call.jsonObject.getValue("id").jsonPrimitive.content,
                name = function.getValue("name").jsonPrimitive.content,
                input = input ?: JsonObject(emptyMap()),
                invalidInput = arguments.takeIf { input == null },
            )
        }
        val usage = json["usage"] as? JsonObject
        val details = usage?.get("prompt_tokens_details") as? JsonObject
        val promptTokens = usage?.get("prompt_tokens").longOrZero()
        val cachedTokens = details?.get("cached_tokens").longOrNull() ?: usage?.get("cache_read_input_tokens").longOrZero()
        // LiteLLM only, for Anthropic models.
        val cacheWriteTokens = usage?.get("cache_creation_input_tokens").longOrNull() ?: details?.get("cache_creation_tokens").longOrZero()
        return InferenceResponse(
            content = thinking + listOfNotNull(text?.ifEmpty { null }?.let(ContentBlock::Text)) + toolCalls,
            stopReason = when {
                refusal != null -> StopReason.Refusal
                else -> when (choice["finish_reason"].stringOrNull()) {
                    "tool_calls", "function_call" -> StopReason.ToolUse
                    "length" -> StopReason.MaxTokens
                    "content_filter" -> StopReason.Refusal
                    else -> if (toolCalls.isNotEmpty()) StopReason.ToolUse else StopReason.EndTurn
                }
            },
            // prompt_tokens counts all prompt tokens, cached or not; Usage keeps them apart, like the Anthropic API.
            usage = Usage(
                inputTokens = (promptTokens - cachedTokens - cacheWriteTokens).coerceAtLeast(0),
                outputTokens = usage?.get("completion_tokens").longOrZero(),
                cacheReadInputTokens = cachedTokens,
                cacheCreationInputTokens = cacheWriteTokens,
            ),
        )
    }

    // Content is usually a string, but some servers send an array of parts; only the text parts count.
    private fun contentText(content: JsonElement?): String? = when (content) {
        is JsonArray -> content.mapNotNull { part ->
            (part as? JsonObject)?.takeIf { it["type"].stringOrNull() == "text" }?.get("text").stringOrNull()
        }.joinToString("")
        else -> content.stringOrNull()
    }

    // Some servers send "" for a tool without parameters. Null means: not a JSON object.
    private fun parseArguments(arguments: String): JsonObject? =
        if (arguments.isBlank()) JsonObject(emptyMap())
        else runCatching { Json.parseToJsonElement(arguments).jsonObject }.getOrNull()

    private fun fromThinkingBlock(json: JsonObject): ContentBlock? = when (json["type"].stringOrNull()) {
        "thinking" -> ContentBlock.Thinking(json["thinking"].stringOrNull().orEmpty(), json["signature"].stringOrNull().orEmpty())
        "redacted_thinking" -> json["data"].stringOrNull()?.let(ContentBlock::RedactedThinking)
        else -> null
    }

    private fun toThinkingBlock(block: ContentBlock): JsonObject? = when (block) {
        is ContentBlock.Thinking -> buildJsonObject { put("type", "thinking"); put("thinking", block.thinking); put("signature", block.signature) }
        is ContentBlock.RedactedThinking -> buildJsonObject { put("type", "redacted_thinking"); put("data", block.data) }
        else -> null
    }

    private fun JsonElement?.stringOrNull(): String? = (this as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull
    private fun JsonElement?.longOrNull(): Long? = (this as? JsonPrimitive)?.longOrNull
    private fun JsonElement?.longOrZero(): Long = longOrNull() ?: 0L

    companion object {
        const val API_KEY_ENV = "MODEL_API_KEY"
        const val MODEL_ENV = "MODEL_NAME"
        const val BASE_URL_ENV = "MODEL_BASE_URL"
        const val LOG_RAW_ENV = "MODEL_LOG_RAW"
        const val DEFAULT_MODEL = "coding"
        const val DEFAULT_BASE_URL = "https://litellm-1022164891326.europe-west4.run.app/v1"
        private val REQUEST_TIMEOUT = Duration.ofMinutes(10)
        private val REASONING_FIELDS = listOf("reasoning_content", "reasoning")
        private const val MALFORMED_CALL_RETRIES = 2
        internal const val MALFORMED_CALL_NOTE =
            "Your previous reply was discarded because it contained a malformed function call. " +
                "Call only the tools declared in this request, by their exact names, with arguments as one JSON object " +
                "that matches the tool's parameters. Do not write code to call a tool. " +
                "If you do not need a tool, reply to the user in plain text."
    }
}
