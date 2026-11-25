package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;

/**
 * The small example tool: shows how a tool reads through the workspace, which keeps every path inside
 * it, and logs what it is doing so the trace shows it. Lets the model size up a file without reading it.
 */
public final class FileStats implements Tool {

    @Override
    public String getName() {
        return "file_stats";
    }

    @Override
    public String getDescription() {
        return "Count the lines, words and characters of a text file in the workspace.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj().string("path", "Path relative to the workspace root").build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        String path = input.string("path");
        String text = ctx.getWorkspace().readText(path);
        ctx.log("counting " + path);
        long lines = text.isEmpty() ? 0 : text.split("\n", -1).length;
        long words = text.isBlank() ? 0 : text.strip().split("\\s+").length;
        return ToolOutcome.success(path + ": " + lines + " lines, " + words + " words, " + text.length() + " characters");
    }
}
