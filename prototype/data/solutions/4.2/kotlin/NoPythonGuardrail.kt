package com.jdriven.harness.extensions.kotlin.guardrails.exercise

import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.TurnContext
import com.jdriven.harness.extensions.kotlin.helpers.Commands

/**
 * Keeps the model from running Python. An interpreter runs whatever it is given, so it walks around every
 * pattern the other guardrails match on. Deny, not Ask: one press of [a] would approve it for good.
 */
class NoPythonGuardrail : Guardrail {
    override val name = "no-python"

    override fun beforeToolUse(call: ToolCall, ctx: TurnContext): ToolDecision {
        val command = Commands.of(call) ?: return ToolDecision.Allow
        if (Commands.names(command).none { PYTHON.matches(it) }) return ToolDecision.Allow
        return ToolDecision.Deny(
            "Running Python is not allowed: a script can do anything, out of sight of the guardrails. " +
                "Use the tools instead, or write the script to a file and ask the user to review and run it.",
        )
    }

    private companion object {
        /** python, python3, python3.12, py, pip, pip3, uv and uvx; the whole word, so `cat script.py` is fine. */
        val PYTHON = Regex("python[0-9.]*|py|pip[0-9.]*|uvx?")
    }
}
