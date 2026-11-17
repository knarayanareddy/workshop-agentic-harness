package com.jdriven.harness.api

import kotlinx.serialization.json.JsonObject
import java.time.Duration

// §6 Observability

fun interface AgentEventListener {
    fun onEvent(event: AgentEvent)
}

fun interface EventSink {
    fun emit(event: AgentEvent)
}

sealed interface AgentEvent {
    val runId: String?

    data class TurnStarted(override val runId: String, val userMessage: String) : AgentEvent

    /** Token counts are estimates (≈ chars / 4), split so attendees can see what each part costs. */
    data class InferenceRequested(
        override val runId: String,
        val iteration: Int,
        val systemTokens: Int,
        val messageTokens: Int,
        val toolTokens: Int,
        val toolNames: List<String>,
    ) : AgentEvent

    /** [usage] is what the API actually billed. */
    data class InferenceCompleted(
        override val runId: String,
        val iteration: Int,
        val stopReason: StopReason,
        val usage: Usage,
        val content: List<ContentBlock>,
    ) : AgentEvent

    data class DynamicSectionEmitted(override val runId: String, val section: String, val text: String) : AgentEvent

    data class ToolCallProposed(override val runId: String, val toolUseId: String, val toolName: String, val input: JsonObject) : AgentEvent

    data class GuardrailDecision(
        override val runId: String,
        val guardrail: String,
        val hook: String,
        val decision: String,
        val isDefault: Boolean,
    ) : AgentEvent

    data class ApprovalRequested(override val runId: String, val toolName: String, val reasons: List<String>, val decision: String) : AgentEvent

    data class ToolCallCompleted(override val runId: String, val toolName: String, val outcome: ToolOutcome, val duration: Duration) : AgentEvent

    data class TurnEnded(override val runId: String, val reason: String) : AgentEvent

    data class Warning(override val runId: String?, val message: String) : AgentEvent

    /** Free-form output from an extension, e.g. [ToolContext.log]. */
    data class Log(override val runId: String, val source: String, val message: String) : AgentEvent
}
