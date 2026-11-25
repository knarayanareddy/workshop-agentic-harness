package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.Tool;

import java.util.List;

/** The tools a coding agent needs at minimum. All paths are contained by the workspace. */
public final class DefaultTools {
    private DefaultTools() {
    }

    /** All default tools, in the order the model sees them. */
    public static List<Tool> all() {
        return List.of(new ReadFile(), new WriteFile(), new EditFile(), new ListFiles(), new Glob(), new Grep(), new RunCommand(), new FileStats());
    }
}
