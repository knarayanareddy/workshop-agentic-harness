package com.jdriven.harness.extensions.java.helpers;

import com.jdriven.harness.api.CommandResult;
import com.jdriven.harness.api.ShellCommand;
import com.jdriven.harness.api.Workspace;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Optional;

/**
 * Asks git about the workspace. Runs git directly, not through {@code run_command}, so no guardrail sees it:
 * guardrails check the model's tool calls, not your own code.
 */
public final class Git {
    private Git() {
    }

    /** The root of the git repository the workspace is in; empty when it is in none (or git is not installed). */
    public static Optional<String> repositoryRoot(Workspace workspace) {
        CommandResult result = run(workspace, "git rev-parse --show-toplevel");
        return result.getExitCode() == 0 ? Optional.of(result.getOutput().strip()) : Optional.empty();
    }

    /** The branch checked out in {@code dir} (relative to the workspace); empty for a detached HEAD or no repository. */
    public static Optional<String> branch(Workspace workspace, String dir) {
        CommandResult result = run(workspace, "git -C \"" + dir + "\" branch --show-current");
        String branch = result.getOutput().strip();
        return result.getExitCode() == 0 && !branch.isEmpty() ? Optional.of(branch) : Optional.empty();
    }

    /** Uncommitted changes in {@code dir}, one per file as {@code git status --porcelain} prints them, like {@code " M mods/ra/rules/vehicles.yaml"}. */
    public static List<String> changes(Workspace workspace, String dir) {
        CommandResult result = run(workspace, "git -C \"" + dir + "\" status --porcelain");
        return result.getExitCode() == 0 ? Text.nonBlankLines(result.getOutput()) : List.of();
    }

    private static CommandResult run(Workspace workspace, String command) {
        try {
            return ShellCommand.run(workspace.getRoot(), command);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
