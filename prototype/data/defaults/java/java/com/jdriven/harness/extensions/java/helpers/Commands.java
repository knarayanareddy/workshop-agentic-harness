package com.jdriven.harness.extensions.java.helpers;

import com.jdriven.harness.api.ShellCommand;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.Workspace;

import java.nio.file.InvalidPathException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Looks at the command line of a {@code run_command} call, for guardrails. These read the words as they are typed,
 * they don't run a shell: a command that builds a word at run time ({@code $VAR}, globs, {@code $(...)}) gets past
 * them. The default {@code command} guardrail sends every command like that to a human.
 */
public final class Commands {
    private static final Pattern WORD_BOUNDARY = Pattern.compile("[\\s;|&<>()\"'`=]+");
    private static final Pattern HOME = Pattern.compile("\\$\\{?HOME\\b|%USERPROFILE%|\\$env:USERPROFILE", Pattern.CASE_INSENSITIVE);

    /** cmd.exe switches ({@code dir /b}, {@code dir /a:d}) look like absolute paths but are not. */
    private static final Pattern CMD_SWITCH = Pattern.compile("/[A-Za-z0-9?-]{1,3}(:[^/\\\\]*)?");

    private Commands() {
    }

    /** The command line when {@code call} is a {@code run_command} call; empty for any other tool. */
    public static Optional<String> of(ToolCall call) {
        if (!call.getTool().getName().equals("run_command")) return Optional.empty();
        return Optional.ofNullable(call.getInput().stringOrNull("command"));
    }

    /**
     * The words of {@code command}, as typed: {@code git -C OpenRA push "origin"} gives {@code git}, {@code -C},
     * {@code OpenRA}, {@code push}, {@code origin}. Spaces, quotes, {@code ; & | < > ( ) `} and {@code =} separate words.
     */
    public static List<String> words(String command) {
        return Arrays.stream(WORD_BOUNDARY.split(command)).filter(w -> !w.isEmpty()).toList();
    }

    /**
     * Every word of {@code command} the way a program name is compared: lowercase, without its directory and without
     * {@code .exe}. {@code C:\Python\python.exe x.py} gives {@code python}, {@code x.py}. Every word, not only the first:
     * {@code sh -c "python x.py"} and {@code cmd /c python x.py} start Python too.
     */
    public static List<String> names(String command) {
        return words(command).stream().map(word -> {
            String name = word.substring(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1).toLowerCase();
            return name.endsWith(".exe") ? name.substring(0, name.length() - 4) : name;
        }).toList();
    }

    /** Whether all of {@code words} occur in {@code command}, in any order and ignoring case: {@code hasWords(command, "git", "push")}. */
    public static boolean hasWords(String command, String... words) {
        List<String> names = names(command);
        return Arrays.stream(words).allMatch(word -> names.contains(word.toLowerCase()));
    }

    /**
     * Whether {@code word}, read as a path, points outside {@code workspace}: {@code ..}, {@code ~}, {@code $HOME}, or an
     * absolute path elsewhere. Words that are not paths ({@code -la}, a cmd.exe switch like {@code /b}) do not.
     */
    public static boolean isOutsideWorkspace(String word, Workspace workspace) {
        if (word.isEmpty() || word.equals("/dev/null")) return false;
        if (ShellCommand.SHELL.equals("cmd.exe") && CMD_SWITCH.matcher(word).matches()) return false;
        if (word.startsWith("~") || HOME.matcher(word).find()) return true;
        try {
            return !workspace.contains(word);
        } catch (InvalidPathException notAPath) {
            return false; // not a path on this platform
        }
    }
}
