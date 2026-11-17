package com.jdriven.harness.core

import com.jdriven.harness.api.ContentBlock
import com.jdriven.harness.api.Message
import com.jdriven.harness.api.ToolDefinition

/**
 * A deliberately crude estimate (≈ 4 characters per token) for the per-part breakdown in the trace.
 * Exact counts would need a count_tokens call per part per turn; the billed total arrives anyway in
 * [com.jdriven.harness.api.Usage].
 */
object Tokens {
    fun estimate(text: String): Int = (text.length + 3) / 4

    fun estimate(message: Message): Int = message.content.sumOf { block ->
        when (block) {
            is ContentBlock.Text -> estimate(block.text)
            is ContentBlock.ToolUse -> estimate(block.name) + estimate(block.input.toString())
            is ContentBlock.ToolResult -> estimate(block.content)
            is ContentBlock.Thinking -> estimate(block.thinking)
            is ContentBlock.RedactedThinking -> estimate(block.data) / 4
        }
    }

    fun estimate(tool: ToolDefinition): Int = estimate(tool.name) + estimate(tool.description) + estimate(tool.inputSchema.toString())
}
