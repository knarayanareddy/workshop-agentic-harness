package com.jdriven.harness.core

import com.jdriven.harness.api.*
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/** The wire mapping, offline: a canned API response in, request body out. */
class OpenAiModelClientTest {
    private val client = OpenAiModelClient(model = "gpt-test", apiKey = "test")

    private val response = """
        {
          "id": "chatcmpl-1", "object": "chat.completion", "model": "gpt-test",
          "choices": [{
            "index": 0,
            "message": {
              "role": "assistant", "content": "Reading it.", "refusal": null,
              "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{\"path\":\"a.txt\"}"}}]
            },
            "finish_reason": "tool_calls"
          }],
          "usage": {"prompt_tokens": 120, "completion_tokens": 30, "prompt_tokens_details": {"cached_tokens": 100}}
        }
    """.trimIndent()

    @Test
    fun `maps a response with text, tool calls and cached usage`() {
        val parsed = client.fromResponse(Json.parseToJsonElement(response).jsonObject)

        assertEquals(StopReason.ToolUse, parsed.stopReason)
        assertEquals(
            listOf(
                ContentBlock.Text("Reading it."),
                ContentBlock.ToolUse("call_1", "read_file", JsonObject(mapOf("path" to JsonPrimitive("a.txt")))),
            ),
            parsed.content,
        )
        assertEquals(Usage(inputTokens = 20, outputTokens = 30, cacheReadInputTokens = 100), parsed.usage)
    }

    @Test
    fun `maps a refusal`() {
        val refused = """{"choices":[{"message":{"role":"assistant","content":null,"refusal":"I can't help with that."},"finish_reason":"stop"}]}"""
        val parsed = client.fromResponse(Json.parseToJsonElement(refused).jsonObject)

        assertEquals(StopReason.Refusal, parsed.stopReason)
        assertEquals(listOf(ContentBlock.Text("I can't help with that.")), parsed.content)
    }

    @Test
    fun `maps content sent as an array of parts`() {
        val parts = """{"choices":[{"message":{"role":"assistant","content":[{"type":"text","text":"Only a "},{"type":"image_url","image_url":{"url":"x"}},{"type":"text","text":"README."}]},"finish_reason":"stop"}]}"""
        val parsed = client.fromResponse(Json.parseToJsonElement(parts).jsonObject)

        assertEquals(StopReason.EndTurn, parsed.stopReason)
        assertEquals(listOf(ContentBlock.Text("Only a README.")), parsed.content)
    }

    @Test
    fun `maps reasoning to thinking and sends it back in the field it came from`() {
        val reasoned = """{"choices":[{"message":{"role":"assistant","content":"42","reasoning_content":"6 times 7."},"finish_reason":"stop"}]}"""
        val content = client.fromResponse(Json.parseToJsonElement(reasoned).jsonObject).content
        assertEquals(listOf(ContentBlock.Thinking("6 times 7.", "reasoning_content"), ContentBlock.Text("42")), content)

        assertEquals(
            Json.parseToJsonElement("""{"role":"assistant","content":"42","reasoning_content":"6 times 7."}"""),
            client.toMessages(Message.assistant(content)).single(),
        )
    }

    @Test
    fun `round-trips LiteLLM's signed thinking blocks and reports cache writes`() {
        val litellm = """
            {
              "choices": [{
                "message": {
                  "role": "assistant", "content": null,
                  "reasoning_content": "Need to read the file.",
                  "thinking_blocks": [
                    {"type": "thinking", "thinking": "Need to read the file.", "signature": "sig=="},
                    {"type": "redacted_thinking", "data": "enc=="}
                  ],
                  "tool_calls": [{"id": "toolu_1", "type": "function", "function": {"name": "read_file", "arguments": "{\"path\":\"a.txt\"}"}}]
                },
                "finish_reason": "tool_calls"
              }],
              "usage": {"prompt_tokens": 2006, "completion_tokens": 300, "prompt_tokens_details": {"cached_tokens": 1920}, "cache_creation_input_tokens": 50}
            }
        """.trimIndent()
        val parsed = client.fromResponse(Json.parseToJsonElement(litellm).jsonObject)

        assertEquals(ContentBlock.Thinking("Need to read the file.", "sig=="), parsed.content[0])
        assertEquals(ContentBlock.RedactedThinking("enc=="), parsed.content[1])
        assertEquals(Usage(inputTokens = 36, outputTokens = 300, cacheReadInputTokens = 1920, cacheCreationInputTokens = 50), parsed.usage)

        val wire = client.toMessages(Message.assistant(parsed.content)).single()
        assertEquals(
            Json.parseToJsonElement(litellm).jsonObject.getValue("choices").jsonArray[0].jsonObject.getValue("message").jsonObject.getValue("thinking_blocks"),
            wire.getValue("thinking_blocks"),
        )
        assertEquals(null, wire["reasoning_content"])
    }

    @Test
    fun `keeps arguments that are not a JSON object verbatim`() {
        val malformed = """{"choices":[{"message":{"role":"assistant","content":null,
            "tool_calls":[{"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\"path\": \"a.txt\""}}]},
            "finish_reason":"tool_calls"}]}"""
        val use = client.fromResponse(Json.parseToJsonElement(malformed).jsonObject).content.single() as ContentBlock.ToolUse
        assertEquals(ContentBlock.ToolUse("call_1", "read_file", JsonObject(emptyMap()), invalidInput = """{"path": "a.txt""""), use)

        val wire = client.toMessages(Message.assistant(listOf(use))).single()
        assertEquals(
            Json.parseToJsonElement("""[{"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\"path\": \"a.txt\""}}]"""),
            wire.getValue("tool_calls"),
        )
    }

    private val malformedCall = Json.parseToJsonElement(
        """{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":null},
            "provider_specific_fields":{"native_finish_reason":"MALFORMED_FUNCTION_CALL"}}]}""",
    ).jsonObject

    @Test
    fun `retries a malformed function call with a note to the model`() {
        val sent = mutableListOf<JsonObject>()
        val answers = ArrayDeque(listOf(malformedCall, Json.parseToJsonElement(response).jsonObject))
        val parsed = client.infer(InferenceRequest("", listOf(Message.user("Read a.txt")), emptyList())) { sent += it; answers.removeFirst() }

        assertEquals(StopReason.ToolUse, parsed.stopReason)
        assertEquals(2, sent.size)
        assertEquals(sent[0].getValue("messages").jsonArray.size + 1, sent[1].getValue("messages").jsonArray.size)
        assertEquals(
            buildJsonObject { put("role", "user"); put("content", OpenAiModelClient.MALFORMED_CALL_NOTE) },
            sent[1].getValue("messages").jsonArray.last(),
        )
    }

    @Test
    fun `gives up when the function call stays malformed`() {
        var calls = 0
        assertThrows<IllegalStateException> {
            client.infer(InferenceRequest("", listOf(Message.user("Read a.txt")), emptyList())) { calls++; malformedCall }
        }
        assertEquals(3, calls)
    }

    @Test
    fun `builds a request with system prompt, tools, tool calls and tool results`() {
        val assistant = client.fromResponse(Json.parseToJsonElement(response).jsonObject).content
        val request = InferenceRequest(
            system = "Be brief.",
            messages = listOf(
                Message.user("Read a.txt"),
                Message.assistant(listOf(ContentBlock.Thinking("hmm", "sig==")) + assistant),
                Message.user(listOf(ContentBlock.ToolResult("call_1", "boom", isError = true))),
            ),
            tools = listOf(ToolDefinition("read_file", "Reads a file.", JsonSchema.parse("""{"type":"object","properties":{"path":{"type":"string"}}}"""))),
        )

        assertEquals(
            Json.parseToJsonElement(
                """
                {
                  "model": "gpt-test",
                  "messages": [
                    {"role": "system", "content": "Be brief."},
                    {"role": "user", "content": "Read a.txt"},
                    {"role": "assistant", "content": "Reading it.",
                     "thinking_blocks": [{"type": "thinking", "thinking": "hmm", "signature": "sig=="}],
                     "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{\"path\":\"a.txt\"}"}}]},
                    {"role": "tool", "tool_call_id": "call_1", "content": "Error: boom"}
                  ],
                  "tools": [{"type": "function", "function": {"name": "read_file", "description": "Reads a file.",
                             "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}}}]
                }
                """,
            ),
            client.toRequestBody(request),
        )
    }
}
