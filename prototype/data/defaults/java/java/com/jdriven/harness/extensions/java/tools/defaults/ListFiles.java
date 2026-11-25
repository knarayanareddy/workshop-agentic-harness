package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;

import java.util.List;

/**
 * Lets the model look around one directory to learn the project layout.
 * Not recursive; see {@code glob} for that.
 */
public final class ListFiles implements Tool {

    @Override
    public String getName() {
        return "list_files";
    }

    @Override
    public String getDescription() {
        return "List the entries of a workspace directory (not recursive). Directories end with '/'.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj()
                .string("path", "Directory relative to the workspace root; '.' for the root", false)
                .build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        String dir = input.stringOrNull("path");
        List<String> entries = ctx.getWorkspace().list(dir == null ? "." : dir);
        return ToolOutcome.success(entries.isEmpty() ? "(empty directory)" : String.join("\n", entries));
    }
}
