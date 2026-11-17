package com.jdriven.harness.extensions.java.helpers;

import java.util.List;

/** Small text jobs that come up when you put file contents or command output in front of a model. */
public final class Text {
    private Text() {
    }

    /** {@code text} itself when it has at most {@code maxChars} characters; otherwise its first {@code maxChars}, then {@code note} on a line of its own. */
    public static String truncate(String text, int maxChars, String note) {
        return text.length() <= maxChars ? text : text.substring(0, maxChars) + "\n" + note;
    }

    /** Like {@link #truncate(String, int, String)}, with the note {@code [cut at N characters]}. */
    public static String truncate(String text, int maxChars) {
        return truncate(text, maxChars, "[cut at " + maxChars + " characters]");
    }

    /** The lines of {@code text} that are not blank, without line endings ({@code \n} or {@code \r\n}). */
    public static List<String> nonBlankLines(String text) {
        return text.lines().filter(line -> !line.isBlank()).toList();
    }
}
