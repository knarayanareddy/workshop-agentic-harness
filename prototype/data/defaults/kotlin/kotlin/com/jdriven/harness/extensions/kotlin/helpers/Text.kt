package com.jdriven.harness.extensions.kotlin.helpers

/** Small text jobs that come up when you put file contents or command output in front of a model. */
object Text {
    /** [text] itself when it has at most [maxChars] characters; otherwise its first [maxChars], then [note] on a line of its own. */
    fun truncate(text: String, maxChars: Int, note: String = "[cut at $maxChars characters]"): String =
        if (text.length <= maxChars) text else text.take(maxChars) + "\n" + note

    /** The lines of [text] that are not blank, without line endings (`\n` or `\r\n`). */
    fun nonBlankLines(text: String): List<String> = text.lines().map { it.trimEnd('\r') }.filter { it.isNotBlank() }
}
