package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.util.List;

/**
 * Lets the model find files by name or path pattern, e.g. all test files.
 * Used when it does not know where something lives.
 */
public final class Glob implements Tool {

    private static final int MAX_RESULTS = 200;

    @Override
    public String getName() {
        return "glob";
    }

    @Override
    public String getDescription() {
        return "Find workspace files whose path matches a glob pattern such as '**/*.kt' or 'src/*/Main.java'. Returns at most "
                + MAX_RESULTS + " paths; .git, build and node_modules are skipped.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj()
                .string("pattern", "Glob pattern, matched against the path relative to the workspace root")
                .string("path", "Directory to search, relative to the workspace root (default '.')", false)
                .build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        PathMatcher matcher = FileSystems.getDefault().getPathMatcher("glob:" + input.string("pattern"));
        String dir = input.stringOrNull("path");
        List<String> hits;
        try {
            hits = WorkspaceFiles.under(ctx, dir == null ? "." : dir).stream()
                    .map(e -> e.getKey())
                    .filter(rel -> matcher.matches(Path.of(rel)))
                    .toList();
        } catch (IOException e) {
            return ToolOutcome.failure("glob failed: " + e.getMessage());
        }
        if (hits.isEmpty()) return ToolOutcome.success("No files match.");
        String shown = String.join("\n", hits.subList(0, Math.min(hits.size(), MAX_RESULTS)));
        return ToolOutcome.success(hits.size() > MAX_RESULTS
                ? shown + "\n\n[" + (hits.size() - MAX_RESULTS) + " more not shown; narrow the pattern]"
                : shown);
    }
}
