package com.jdriven.harness.extensions.java.listeners.exercise;

import com.jdriven.harness.api.AgentEvent;
import com.jdriven.harness.api.AgentEventListener;
import com.jdriven.harness.api.Usage;

/** Adds up what each turn and the whole session cost, from what the API billed. */
public final class CostMeter implements AgentEventListener {
    // Dollars per million tokens. Set these to your model's prices.
    private static final double INPUT = 3.00;
    private static final double OUTPUT = 15.00;
    private static final double CACHE_READ = 0.30;
    private static final double CACHE_WRITE = 3.75;

    private long input;
    private long output;
    private long cacheRead;
    private long cacheWrite;
    private double session;

    @Override
    public void onEvent(AgentEvent event) {
        if (event instanceof AgentEvent.InferenceCompleted e) {
            Usage u = e.getUsage();
            input += u.getInputTokens();
            output += u.getOutputTokens();
            cacheRead += u.getCacheReadInputTokens();
            cacheWrite += u.getCacheCreationInputTokens();
        } else if (event instanceof AgentEvent.TurnEnded) {
            double cost = (input * INPUT + output * OUTPUT + cacheRead * CACHE_READ + cacheWrite * CACHE_WRITE) / 1_000_000;
            session += cost;
            System.out.printf("[cost   ] this turn: in %d (cache read %d, write %d), out %d = $%.4f; session $%.4f%n",
                    input, cacheRead, cacheWrite, output, cost, session);
            input = output = cacheRead = cacheWrite = 0;
        }
    }
}
