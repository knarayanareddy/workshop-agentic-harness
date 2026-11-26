package com.jdriven.harness.extensions.java.guardrails.defaults;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ShellCommand;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.TurnContext;
import com.jdriven.harness.api.Workspace;
import com.jdriven.harness.api.WorkspaceViolation;

import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Keeps the model away from files it has no business reading or changing.
 * The file tools are already contained by the workspace; this guardrail adds which of the workspace's
 * own files are sensitive (secrets, git internals) and looks for them in {@code run_command} too. It
 * does not keep {@code run_command} inside the workspace. Only {@code beforeToolUse} is implemented.
 * <p>
 * For {@code run_command} this is a check on the words in the command line, not a sandbox: it cannot
 * see through globs, variables, quotes, {@code $(...)} or an {@code sh -c} that builds a path at run
 * time. The command guardrail sends every command like that to a human.
 */
public final class ProtectedPathsGuardrail implements Guardrail {
    private static final Set<String> PATH_TOOLS = Set.of("read_file", "write_file", "edit_file", "list_files", "glob", "grep");

    private static final List<Pattern> PROTECTED = List.of(
            Pattern.compile("(^|/)\\.env(\\..+)?$"),
            Pattern.compile("(^|/)\\.git(/|$)"),
            Pattern.compile("\\.(pem|key|p12|pfx)$"),
            Pattern.compile("(^|/)id_(rsa|dsa|ecdsa|ed25519)(\\.pub)?$"));

    private static final Pattern ALLOWED = Pattern.compile("(^|/)\\.env\\.(example|sample|template)$");

    /** Splits a command line into the words that may be paths. Quotes, redirects and separators are not part of one. */
    private static final Pattern WORD_BOUNDARY = Pattern.compile("[\\s;|&<>()\"'`=]+");

    /** cmd.exe switches ({@code dir /b}, {@code findstr /i}, {@code dir /a:d}) look like absolute paths but are not. */
    private static final Pattern CMD_SWITCH = Pattern.compile("/[A-Za-z0-9?-]{1,3}(:[^/\\\\]*)?");

    @Override
    public String getName() {
        return "protected-paths";
    }

    @Override
    public ToolDecision beforeToolUse(ToolCall call, TurnContext ctx) {
        String tool = call.getTool().getName();
        if (tool.equals("run_command")) return checkCommand(call.getInput().string("command"), ctx.getWorkspace());
        if (!PATH_TOOLS.contains(tool)) return ToolDecision.allow();

        String requested = call.getInput().stringOrNull("path");
        if (requested == null) return ToolDecision.allow();

        // Resolved and normalised first, so a/../.env is caught like .env.
        String relative;
        try {
            relative = ctx.getWorkspace().relativize(ctx.getWorkspace().resolve(requested));
        } catch (WorkspaceViolation outside) {
            return ToolDecision.deny("'" + requested + "' is outside the workspace");
        }
        return isProtected(relative) ? denyProtected(relative) : ToolDecision.allow();
    }

    private static ToolDecision checkCommand(String command, Workspace workspace) {
        Path root = workspace.getRoot();
        for (String word : WORD_BOUNDARY.split(command)) {
            if (word.isEmpty() || word.equals("/dev/null")) continue;
            if (ShellCommand.SHELL.equals("cmd.exe") && CMD_SWITCH.matcher(word).matches()) continue;
            Path resolved;
            try {
                resolved = root.resolve(word).normalize();
            } catch (InvalidPathException notAPath) {
                continue;
            }
            if (!resolved.startsWith(root)) continue;
            String relative = workspace.relativize(resolved);
            if (isProtected(relative)) return denyProtected(relative);
        }
        return ToolDecision.allow();
    }

    private static boolean isProtected(String relative) {
        if (ALLOWED.matcher(relative).find()) return false;
        for (Pattern pattern : PROTECTED) {
            if (pattern.matcher(relative).find()) return true;
        }
        return false;
    }

    private static ToolDecision denyProtected(String relative) {
        return ToolDecision.deny("'" + relative + "' is protected: it may hold secrets or repository internals");
    }
}
