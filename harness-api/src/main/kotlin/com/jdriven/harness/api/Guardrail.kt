package com.jdriven.harness.api

// §5 Extension point: Guardrail
//
// Every decision type has static factories (ToolDecision.deny("...")) so Java code does not need
// `ToolDecision.Allow.INSTANCE`. Kotlin code can use either form.

/** Four hooks, all with no-op defaults: implement only what you care about. */
interface Guardrail {
    val name: String

    /**
     * v2 — optional. What an "approve always" should cover for [call], when this guardrail is the one
     * that asked. Returning null means "no opinion"; if nobody has an opinion the loop falls back to
     * [ApprovalScope.WholeTool], which is exactly v1's behaviour. The guardrail chooses, because only it
     * knows why it asked (this subcommand? this directory?).
     */
    fun approvalScope(call: ToolCall, reasons: List<String>): ApprovalScope? = null

    fun beforeInference(ctx: TurnContext): InferenceDecision = InferenceDecision.Proceed
    fun beforeToolUse(call: ToolCall, ctx: TurnContext): ToolDecision = ToolDecision.Allow
    fun afterToolUse(call: ToolCall, result: ToolOutcome, ctx: TurnContext): ResultDecision = ResultDecision.Accept
    fun beforeEndTurn(ctx: TurnContext): TurnDecision = TurnDecision.AllowEnd
}

sealed interface InferenceDecision {
    data object Proceed : InferenceDecision

    /**
     * Context management. Rewriting history costs the prompt cache and the model's earlier reasoning
     * (thinking blocks are bound to the history that produced them); the harness reports both.
     */
    data class ProceedWith(val messages: List<Message>) : InferenceDecision

    data class Abort(val reason: String) : InferenceDecision

    companion object {
        @JvmStatic fun proceed(): InferenceDecision = Proceed
        @JvmStatic fun proceedWith(messages: List<Message>): InferenceDecision = ProceedWith(messages)
        @JvmStatic fun abort(reason: String): InferenceDecision = Abort(reason)
    }
}

sealed interface ToolDecision {
    data object Allow : ToolDecision
    data class Deny(val reason: String) : ToolDecision   // PREVENT
    data class Ask(val reason: String) : ToolDecision    // GATE

    companion object {
        @JvmStatic fun allow(): ToolDecision = Allow
        @JvmStatic fun deny(reason: String): ToolDecision = Deny(reason)
        @JvmStatic fun ask(reason: String): ToolDecision = Ask(reason)
    }
}

sealed interface ResultDecision {
    data object Accept : ResultDecision
    data class Replace(val outcome: ToolOutcome) : ResultDecision
    data class Reject(val feedback: String) : ResultDecision   // ENFORCE

    companion object {
        @JvmStatic fun accept(): ResultDecision = Accept
        @JvmStatic fun replace(outcome: ToolOutcome): ResultDecision = Replace(outcome)
        @JvmStatic fun reject(feedback: String): ResultDecision = Reject(feedback)
    }
}

sealed interface TurnDecision {
    data object AllowEnd : TurnDecision
    data class Continue(val message: String) : TurnDecision   // ENFORCE

    companion object {
        @JvmStatic fun allowEnd(): TurnDecision = AllowEnd
        @JvmStatic fun continueWith(message: String): TurnDecision = Continue(message)
    }
}

// §5.2 The human channel

fun interface ApprovalHandler {
    fun request(req: ApprovalRequest): ApprovalDecision
}

/**
 * v2 — the scope an "approve always" covers. v1 has no scope and remembers the *tool name*, so one `a`
 * on `run_command` approves every later command in the session (REVIEW C2: that is the over-grant).
 * A guardrail that knows better supplies a scope; the loop then remembers the scope, not the tool.
 */
sealed interface ApprovalScope {
    /** Approve this tool, for the session. v1's behaviour, kept as the default when nobody says otherwise. */
    data class WholeTool(val tool: String) : ApprovalScope

    /** Approve only this tool with this argument prefix, e.g. `git status` but not `git push`. */
    data class ArgvPrefix(val tool: String, val prefix: List<String>) : ApprovalScope

    /** Approve only this tool inside this directory (and below). */
    data class Directory(val tool: String, val path: String) : ApprovalScope

    /** Approve this one call only; nothing is remembered. */
    data object Once : ApprovalScope

    /** Stable key used for remembering and for the trace. */
    val key: String
        get() = when (this) {
            is WholeTool -> "tool:$tool"
            is ArgvPrefix -> "argv:$tool:${prefix.joinToString(" ")}"
            is Directory -> "dir:$tool:$path"
            Once -> "once"
        }
}

data class ApprovalRequest(
    val call: ToolCall,
    val reasons: List<String>,
    /** v2 — what an "approve always" would cover. Defaults to the whole tool, i.e. v1's behaviour. */
    val scope: ApprovalScope = ApprovalScope.WholeTool(call.tool.name),
)

sealed interface ApprovalDecision {
    data object Approve : ApprovalDecision
    /**
     * Remembered for the session, under the request's [ApprovalScope] — so in v2 one approval covers the
     * exact subcommand or directory that was shown, not every later call of the tool.
     */
    data object ApproveAlways : ApprovalDecision
    data class Deny(val reason: String) : ApprovalDecision

    companion object {
        @JvmStatic fun approve(): ApprovalDecision = Approve
        @JvmStatic fun approveAlways(): ApprovalDecision = ApproveAlways
        @JvmStatic fun deny(reason: String): ApprovalDecision = Deny(reason)
    }
}
