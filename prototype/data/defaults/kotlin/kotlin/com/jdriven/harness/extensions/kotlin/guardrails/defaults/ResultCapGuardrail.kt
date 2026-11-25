package com.jdriven.harness.extensions.kotlin.guardrails.defaults

import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.ResultDecision
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.api.TurnContext

/**
 * Keeps one runaway tool result from filling the model's context.
 * A safety net, not the first line of defence (§5.4): a tool should cap and describe its own
 * output. This only catches the tools that did not. Only `afterToolUse` is implemented.
 *
 * @param maxChars the longest successful result that passes through unchanged (default 30,000)
 */
class ResultCapGuardrail @JvmOverloads constructor(private val maxChars: Int = 30_000) : Guardrail {

    override val name = "result-cap"

    override fun afterToolUse(call: ToolCall, result: ToolOutcome, ctx: TurnContext): ResultDecision {
        if (result !is ToolOutcome.Success || result.content.length <= maxChars) return ResultDecision.Accept
        return ResultDecision.Replace(
            ToolOutcome.Success(
                result.content.take(maxChars) +
                    "\n\n[truncated by result-cap: ${result.content.length} characters, showing the first $maxChars. " +
                    "Ask for less: narrow the path or pattern.]",
            ),
        )
    }
}
