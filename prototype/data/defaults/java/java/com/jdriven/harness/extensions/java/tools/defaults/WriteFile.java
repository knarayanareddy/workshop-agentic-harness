package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;

/**
 * Lets the model create a new file or replace one completely.
 * For small changes it should prefer {@code edit_file}.
 */
public final class WriteFile implements Tool {

    @Override
    public String getName() {
        return "write_file";
    }

    @Override
    public String getDescription() {
        return "Create or overwrite a UTF-8 text file in the workspace with the given content. Parent directories are created.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj()
                .string("path", "Path relative to the workspace root")
                .string("content", "The complete new file content")
                .build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        String path = input.string("path");
        String content = input.string("content");
        ctx.getWorkspace().writeText(path, content);
        return ToolOutcome.success("Wrote " + content.length() + " characters to " + path);
    }
}
