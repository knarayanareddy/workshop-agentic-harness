package com.jdriven.harness.extensions.java.guardrails.defaults;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.TurnContext;

import java.util.Set;

/**
 * Keeps the model from "fixing" a failing test by editing the build, and from writing all over the
 * project. The worked example from §5.3: one guardrail that uses two of the verbs, PREVENT and GATE.
 * Covers {@code write_file} and {@code edit_file} (REVIEW F-7: {@code edit_file} used to bypass the
 * deny). Only {@code beforeToolUse} is implemented.
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
        String tool = call.getTool().getName();
        if (!tool.equals("write_file") && !tool.equals("edit_file")) return ToolDecision.allow();

        String relative = ctx.getWorkspace().relativize(ctx.getWorkspace().resolve(call.getInput().string("path")));
        String fileName = relative.substring(relative.lastIndexOf('/') + 1);

        if (BUILD_FILES.contains(fileName)) {
            return ToolDecision.deny(relative + " is build configuration - make the test pass, not the build");
        }
        // edit_file keeps its v1 behaviour: only the build-file deny is broadened.
        if (tool.equals("write_file") && !relative.startsWith("src/")) {
            return ToolDecision.ask("write outside src/: " + relative);
        }
        return ToolDecision.allow();
    }
}
