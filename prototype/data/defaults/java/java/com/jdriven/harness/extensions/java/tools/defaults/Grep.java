package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Lets the model find where something is used or defined by searching file contents.
 * Saves it from reading every file.
 */
public final class Grep implements Tool {

    private static final int MAX_MATCHES = 100;

    @Override
    public String getName() {
        return "grep";
    }

    @Override
    public String getDescription() {
        return "Search workspace files for lines matching a regular expression. Returns at most " + MAX_MATCHES
                + " matches as path:line: text; .git, build and node_modules are skipped. "
                + "Use 'include' to restrict to a glob such as '**/*.kt'.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj()
                .string("pattern", "Java regular expression")
                .string("path", "Directory to search, relative to the workspace root (default '.')", false)
                .string("include", "Only search files whose path matches this glob", false)
                .build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        Pattern pattern = Pattern.compile(input.string("pattern"));
        String includeGlob = input.stringOrNull("include");
        PathMatcher include = includeGlob == null ? null : FileSystems.getDefault().getPathMatcher("glob:" + includeGlob);
        String dir = input.stringOrNull("path");

        List<String> matches = new ArrayList<>();
        int total = 0;
        try {
            for (Map.Entry<String, Path> file : WorkspaceFiles.under(ctx, dir == null ? "." : dir)) {
                if (include != null && !include.matches(Path.of(file.getKey()))) continue;
                List<String> lines;
                try {
                    lines = Files.readAllLines(file.getValue());
                } catch (IOException | UncheckedIOException binaryOrUnreadable) {
                    continue;
                }
                for (int i = 0; i < lines.size(); i++) {
                    if (!pattern.matcher(lines.get(i)).find()) continue;
                    if (total++ < MAX_MATCHES) {
                        String text = lines.get(i).strip();
                        matches.add(file.getKey() + ":" + (i + 1) + ": " + text.substring(0, Math.min(text.length(), 300)));
                    }
                }
            }
        } catch (IOException e) {
            return ToolOutcome.failure("grep failed: " + e.getMessage());
        }
        if (total == 0) return ToolOutcome.success("No matches.");
        String shown = String.join("\n", matches);
        return ToolOutcome.success(total > MAX_MATCHES
                ? shown + "\n\n[" + total + " matches, showing the first " + MAX_MATCHES + "; narrow the pattern or path]"
                : shown);
    }
}
