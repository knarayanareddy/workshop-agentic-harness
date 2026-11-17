package com.jdriven.harness.core

import com.jdriven.harness.api.ContentBlock
import com.jdriven.harness.api.InferenceRequest
import com.jdriven.harness.api.InferenceResponse
import com.jdriven.harness.api.ModelClient
import com.jdriven.harness.api.StopReason
import com.jdriven.harness.api.Usage
import kotlinx.serialization.json.JsonObject

/**
 * A fake model returning a fixed sequence of responses (§8). Records every request so tests can
 * assert on exactly what the harness sent.
 */
class ScriptedModelClient(responses: List<InferenceResponse>) : ModelClient {
    private val remaining = ArrayDeque(responses)
    val requests = mutableListOf<InferenceRequest>()

    override fun infer(request: InferenceRequest): InferenceResponse {
        requests += request
        return remaining.removeFirstOrNull() ?: error("ScriptedModelClient ran out of responses after ${requests.size - 1} calls")
    }

    companion object {
        private val usage = Usage(inputTokens = 0, outputTokens = 0)

        fun text(text: String) = InferenceResponse(listOf(ContentBlock.Text(text)), StopReason.EndTurn, usage)

        fun toolUse(vararg calls: Pair<String, JsonObject>) = InferenceResponse(
            calls.mapIndexed { i, (name, input) -> ContentBlock.ToolUse("toolu_${name}_$i", name, input) },
            StopReason.ToolUse,
            usage,
        )
    }
}
