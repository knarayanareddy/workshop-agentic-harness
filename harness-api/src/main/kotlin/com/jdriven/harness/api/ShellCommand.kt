package com.jdriven.harness.api

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

/**
 * What a shell command printed (stdout and stderr combined, last [ShellCommand.MAX_OUTPUT] characters) and how it ended.
 * [exitCode] is -1 when the command [timedOut] after [ShellCommand.TIMEOUT_SECONDS] and was killed.
 */
data class CommandResult(val exitCode: Int, val output: String, val timedOut: Boolean)

/**
 * Runs shell commands; the one implementation behind every `run_command` tool, whatever language it
 * is written in. It starts the process and nothing more: what is allowed to run is a guardrail's decision.
 */
object ShellCommand {
    const val TIMEOUT_SECONDS = 120L
    const val MAX_OUTPUT = 20_000

    /** How long to keep reading after the shell exits, for output still in the pipe. */
    private const val DRAIN_MILLIS = 2_000L

    private val windows = System.getProperty("os.name").startsWith("Windows")

    /** The shell the model is told about: `cmd.exe` on Windows, `sh` elsewhere. */
    @JvmField val SHELL: String = if (windows) "cmd.exe" else "sh"

    /**
     * Runs [command] in [workingDirectory] and waits up to [TIMEOUT_SECONDS]. Output is read as it
     * arrives, so a command that times out still reports what it printed before it was killed,
     * together with everything it started.
     *
     * A background process (`npm start &`) keeps the output pipe open after the shell exits; it is left
     * running, and the result says its later output is not shown instead of waiting for it.
     *
     * @throws IOException if the shell cannot be started
     */
    @JvmStatic
    @Throws(IOException::class)
    fun run(workingDirectory: Path, command: String): CommandResult {
        val process = shell(command)
            .directory(workingDirectory.toFile())
            .redirectErrorStream(true)
            .start()
        val output = StringBuffer()
        val reader = Thread {
            try {
                process.inputStream.bufferedReader().use { r ->
                    val chunk = CharArray(4096)
                    while (true) {
                        val n = r.read(chunk)
                        if (n < 0) break
                        output.append(chunk, 0, n)
                    }
                }
            } catch (_: IOException) {
                // the process was killed; whatever was read is enough
            }
        }.apply { isDaemon = true; start() } // daemon: a grandchild holding the pipe open must not keep the JVM alive

        if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            kill(process)
            return CommandResult(-1, output.takeLast(MAX_OUTPUT).toString(), timedOut = true)
        }
        reader.join(DRAIN_MILLIS)
        val text = if (reader.isAlive) "$output\n[a background process still holds the output open; its later output is not shown]" else output
        return CommandResult(process.exitValue(), text.takeLast(MAX_OUTPUT).toString(), timedOut = false)
    }

    /**
     * Starts [command] in [workingDirectory] and returns at once, for work that takes minutes: a tool call
     * must not wait for it. Its output (stdout and stderr) replaces what was in [log]. When it ends,
     * `exit code N` is added as the last line, so whoever reads the log can tell running, done and failed apart.
     *
     * There is no timeout, and nothing waits for it: it keeps running when the harness stops, but then the
     * exit code line is never written.
     *
     * @throws IOException if the log cannot be created or the shell cannot be started
     */
    @JvmStatic
    @Throws(IOException::class)
    fun spawn(workingDirectory: Path, command: String, log: Path) {
        log.toAbsolutePath().parent?.let { Files.createDirectories(it) }
        val file = log.toFile()
        val process = shell(command)
            .directory(workingDirectory.toFile())
            .redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.to(file))
            .start()
        process.outputStream.close() // nothing to type: a command that reads input gets end-of-file instead of waiting forever
        process.onExit().thenAccept { file.appendText("\nexit code ${it.exitValue()}\n") }
    }

    private fun shell(command: String) =
        ProcessBuilder(if (windows) listOf("cmd.exe", "/c", command) else listOf("sh", "-c", command))

    /** The shell and everything it started: killing only `cmd.exe` would leave `gradlew test` running. */
    private fun kill(process: Process) {
        process.descendants().forEach { it.destroyForcibly() }
        process.destroyForcibly()
    }
}
