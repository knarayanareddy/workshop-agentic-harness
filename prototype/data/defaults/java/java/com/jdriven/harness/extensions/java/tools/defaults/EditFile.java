package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;

/**
 * Lets the model make a small, targeted change without resending the whole file.
 * Fails on a missing or ambiguous match, so the model must be precise.
 */
public final class EditFile implements Tool {

    @Override
    public String getName() {
        return "edit_file";
    }

    @Override
    public String getDescription() {
        return "Replace one exact piece of text in a workspace file. 'old_text' must occur exactly once (include surrounding "
                + "lines to make it unique), unless 'replace_all' is true. Prefer this over write_file for changing an existing file.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj()
                .string("path", "Path relative to the workspace root")
                .string("old_text", "The exact text to replace, including whitespace")
                .string("new_text", "The replacement text")
                .bool("replace_all", "Replace every occurrence instead of requiring a single one (default false)", false)
                .build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        String path = input.string("path");
        String oldText = input.string("old_text");
        String newText = input.string("new_text");
        if (oldText.isEmpty()) return ToolOutcome.failure("'old_text' must not be empty; use write_file to create a file.");

        String text = ctx.getWorkspace().readText(path);
        int count = 0;
        for (int i = text.indexOf(oldText); i >= 0; i = text.indexOf(oldText, i + oldText.length())) count++;

        if (count == 0) {
            return ToolOutcome.failure("'old_text' not found in " + path + ". Read the file again and copy the text exactly.");
        }
        if (count > 1 && !input.bool("replace_all", false)) {
            return ToolOutcome.failure("'old_text' occurs " + count + " times in " + path
                    + ". Add surrounding context to make it unique, or set replace_all.");
        }
        ctx.getWorkspace().writeText(path, text.replace(oldText, newText));
        return ToolOutcome.success("Replaced " + count + (count == 1 ? " occurrence" : " occurrences") + " in " + path);
    }
}
