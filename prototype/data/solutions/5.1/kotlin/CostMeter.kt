package com.jdriven.harness.extensions.kotlin.listeners.exercise

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.AgentEventListener

/** Adds up what each turn and the whole session cost, from what the API billed. */
class CostMeter : AgentEventListener {
    private var input = 0L
    private var output = 0L
    private var cacheRead = 0L
    private var cacheWrite = 0L
    private var session = 0.0

    override fun onEvent(event: AgentEvent) {
        when (event) {
            is AgentEvent.InferenceCompleted -> with(event.usage) {
                input += inputTokens
                output += outputTokens
                cacheRead += cacheReadInputTokens
                cacheWrite += cacheCreationInputTokens
            }
            is AgentEvent.TurnEnded -> {
                val cost = (input * INPUT + output * OUTPUT + cacheRead * CACHE_READ + cacheWrite * CACHE_WRITE) / 1_000_000
                session += cost
                println("[cost   ] this turn: in $input (cache read $cacheRead, write $cacheWrite), out $output = $%.4f; session $%.4f".format(cost, session))
                input = 0
                output = 0
                cacheRead = 0
                cacheWrite = 0
            }
            else -> {}
        }
    }

    private companion object {
        // Dollars per million tokens. Set these to your model's prices.
        const val INPUT = 3.00
        const val OUTPUT = 15.00
        const val CACHE_READ = 0.30
        const val CACHE_WRITE = 3.75
    }
}
