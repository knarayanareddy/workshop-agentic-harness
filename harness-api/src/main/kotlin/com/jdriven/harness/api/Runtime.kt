package com.jdriven.harness.api

// §9 v2 runtime: the things a bundle written in another language (see harness-typescript) cannot do for
// itself, because the loop owns them and the loop can only run one turn at a time.
//
// Everything here defaults to "v1 behaviour", so an implementation that wants none of it is
// `object : AgentRuntime {}`. None of it is a capability handed to a guardrail: a guardrail still only
// decides, and only a [SubAgentRunner] is ever handed tools.

/** A delegated agent: its own context, its own restricted tool list, its own iteration budget. */
data class SubAgentSpec(
    val name: String,
    val description: String,
    /** Tool names the sub-agent may use. Anything else is unknown to it, not merely blocked. */
    val tools: List<String>,
    val maxIterations: Int,
)

/**
 * Runs one delegated agent. It gets a prompt and returns a short answer; it never sees the parent's
 * transcript, which is the whole isolation claim. It cannot ask the human either: the loop gives it a
 * handler that only denies. [SubAgentLoops.runner] is the only way to obtain one.
 */
fun interface SubAgentRunner {
    fun run(prompt: String): SubAgentOutcome
}

sealed interface SubAgentOutcome {
    data class Completed(
        val text: String,
        /** Inference calls the sub-agent made, in its own context: the cost the workshop compares. */
        val calls: Int,
        val iterations: Int,
    ) : SubAgentOutcome

    /** The sub-agent did not finish: a limit, a refusal, or a failure to start. */
    data class Failed(val reason: String) : SubAgentOutcome
}

/**
 * v2 — what a bundle asks of the loop, declared once at assembly and passed to the [Agent] as a value.
 * It is not handed to a guardrail or a tool: an extension asks for these through its own bundle, so it
 * cannot reach into a session it does not own. All of it defaults to v1.
 *
 *  - [subAgentRunner] is delegation: a nested loop, which is why it cannot be an extension.
 *  - [approveEditsFor] is the `acceptEdits` mode. It is deliberately *not* a guardrail, because a
 *    guardrail may only tighten a decision and "skip the prompt" loosens one. The loop consults it only
 *    after every guardrail has decided, so it can turn an ASK into an approval but never override a DENY.
 *  - [interruptCheck] asks the loop to stop between iterations, because a token or wall-clock budget
 *    cannot be checked inside a tool call that is already running.
 *  - [mode] is the permission mode, so a tool's own description can state what it will do.
 */
interface AgentRuntime {
    val mode: String get() = "default"

    fun subAgentRunner(spec: SubAgentSpec, workspace: Workspace): SubAgentRunner? = null

    fun approveEditsFor(tool: Tool, input: ToolInput, workspace: Workspace): Boolean = false

    /** The reason to stop before the next inference call, or null to keep going. */
    fun interruptCheck(): String? = null
}
