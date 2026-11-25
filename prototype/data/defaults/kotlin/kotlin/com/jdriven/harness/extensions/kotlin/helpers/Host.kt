package com.jdriven.harness.extensions.kotlin.helpers

import com.jdriven.harness.api.ShellCommand
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/** The machine the harness runs on, in words a model understands. */
object Host {
    private val MINUTES = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm xxx")

    /** Operating system, version and CPU, like `Windows 11 10.0 (amd64)` or `Mac OS X 15.1 (aarch64)`. */
    fun system(): String = "${System.getProperty("os.name")} ${System.getProperty("os.version")} (${System.getProperty("os.arch")})"

    /** The shell `run_command` uses: `cmd.exe` on Windows, `sh` elsewhere. */
    fun shell(): String = ShellCommand.SHELL

    /** The date and time to the minute, with the UTC offset, like `2026-11-20 14:03 +01:00`. */
    fun now(): String = ZonedDateTime.now().format(MINUTES)
}
