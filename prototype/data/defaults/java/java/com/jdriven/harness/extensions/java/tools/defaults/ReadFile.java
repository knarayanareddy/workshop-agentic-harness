package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;

/**
 * Lets the model inspect a file before changing it.
 * Large files are truncated, not rejected.
 */
public final class ReadFile implements Tool {

    private static final int MAX_CHARS = 50_000;

    @Override
    public String getName() {
        return "read_file";
    }

    @Override
    public String getDescription() {
        return "Read a UTF-8 text file from the workspace. Returns at most " + MAX_CHARS
                + " characters; longer files are truncated with a note.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj().string("path", "Path relative to the workspace root").build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        String text = ctx.getWorkspace().readText(input.string("path"));
        if (text.length() <= MAX_CHARS) return ToolOutcome.success(text);
        return ToolOutcome.success(text.substring(0, MAX_CHARS) + "\n\n[truncated: file has " + text.length()
                + " characters, showing the first " + MAX_CHARS + "]");
    }
}
