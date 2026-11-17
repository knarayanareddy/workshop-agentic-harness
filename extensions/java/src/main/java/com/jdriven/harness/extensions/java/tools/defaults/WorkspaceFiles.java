package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.ToolContext;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/** Shared by glob and grep: the regular files under a directory, minus VCS and build output. */
final class WorkspaceFiles {
    private static final List<String> IGNORED = List.of(".git/", "node_modules/", "build/", "dist/", ".gradle/");

    private WorkspaceFiles() {
    }

    /** Workspace-relative path to absolute path, sorted by relative path. */
    static List<Map.Entry<String, Path>> under(ToolContext ctx, String dir) throws IOException {
        try (Stream<Path> walk = Files.walk(ctx.getWorkspace().resolve(dir))) {
            return walk.filter(Files::isRegularFile)
                    .map(p -> Map.entry(ctx.getWorkspace().relativize(p), p))
                    .filter(e -> IGNORED.stream().noneMatch(i -> ("/" + e.getKey()).contains("/" + i)))
                    .sorted(Map.Entry.comparingByKey())
                    .toList();
        }
    }
}
