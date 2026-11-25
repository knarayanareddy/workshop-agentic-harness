package com.jdriven.harness.extensions.kotlin.guardrails.exercise

import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.ResultDecision
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.api.TurnContext

/**
 * Masks secrets in tool output before the model sees them. Rewriting is honest here: the tool ran as asked,
 * only what it returned is masked. Register it before the result cap, or a cut could leave half a secret.
 */
class SecretScanGuardrail : Guardrail {
    override val name = "secret-scan"

    override fun afterToolUse(call: ToolCall, result: ToolOutcome, ctx: TurnContext): ResultDecision {
        if (result !is ToolOutcome.Success) return ResultDecision.Accept
        val masked = SECRETS.fold(ASSIGNMENT.replace(result.content, "$1=$MASK")) { text, secret -> secret.replace(text, MASK) }
        return if (masked == result.content) ResultDecision.Accept else ResultDecision.Replace(ToolOutcome.Success(masked))
    }

    private companion object {
        const val MASK = "[REDACTED]"

        /** `MODEL_API_KEY=...`: keep the name, mask the value. */
        val ASSIGNMENT = Regex("""\b([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=\S+""")

        val SECRETS = listOf(
            Regex("""sk-ant-[A-Za-z0-9_-]{10,}"""),
            Regex("""AKIA[0-9A-Z]{16}"""),
            Regex("""gh[pousr]_[A-Za-z0-9]{36,}"""),
            Regex("""github_pat_[A-Za-z0-9_]{22,}"""),
            Regex("""xox[baprs]-[A-Za-z0-9-]{10,}"""),
            Regex("""-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"""),
        )
    }
}
