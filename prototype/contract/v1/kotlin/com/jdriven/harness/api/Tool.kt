package com.jdriven.harness.api

// §4 Extension point: Tool

interface Tool {
    /** snake_case, unique across all registered tools. */
    val name: String

    /** The model reads ONLY this — it is the API doc. State limits here, not in a guardrail. */
    val description: String

    val inputSchema: JsonSchema

    /**
     * Runs the tool. A thrown exception is caught by the harness and becomes a [ToolOutcome.Failure],
     * so tools never crash the loop.
     */
    fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome
}

sealed interface ToolOutcome {
    data class Success(val content: String) : ToolOutcome

    /** Not a loop error: a normal turn in which the model reads [message] and reacts. */
    data class Failure(val message: String) : ToolOutcome

    companion object {
        @JvmStatic fun success(content: String): ToolOutcome = Success(content)
        @JvmStatic fun failure(message: String): ToolOutcome = Failure(message)
    }
}
