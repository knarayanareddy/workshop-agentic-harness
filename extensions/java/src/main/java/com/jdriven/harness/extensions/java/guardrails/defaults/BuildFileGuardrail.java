package com.jdriven.harness.extensions.java.guardrails.defaults;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.TurnContext;

import java.util.Set;

/**
 * Keeps the model from "fixing" a failing test by editing the build, and from writing all over the
 * project. The worked example from §5.3: one guardrail that uses two of the verbs, PREVENT and GATE.
 * Opt-in per tool: it only understands {@code write_file}. Only {@code beforeToolUse} is implemented.
 */
public final class BuildFileGuardrail implements Guardrail {
    private static final Set<String> BUILD_FILES = Set.of(
            "build.gradle.kts", "settings.gradle.kts", "gradle.properties", "pom.xml", "package.json");

    @Override
    public String getName() {
        return "build-file";
    }

    @Override
    public ToolDecision beforeToolUse(ToolCall call, TurnContext ctx) {
        if (!call.getTool().getName().equals("write_file")) return ToolDecision.allow();

        String relative = ctx.getWorkspace().relativize(ctx.getWorkspace().resolve(call.getInput().string("path")));
        String fileName = relative.substring(relative.lastIndexOf('/') + 1);

        if (BUILD_FILES.contains(fileName)) {
            return ToolDecision.deny(relative + " is build configuration - make the test pass, not the build");
        }
        if (!relative.startsWith("src/")) {
            return ToolDecision.ask("write outside src/: " + relative);
        }
        return ToolDecision.allow();
    }
}
