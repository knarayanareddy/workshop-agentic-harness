package com.jdriven.harness.extensions.java.helpers;

import com.jdriven.harness.api.ShellCommand;

import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

/** The machine the harness runs on, in words a model understands. */
public final class Host {
    private static final DateTimeFormatter MINUTES = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm xxx");

    private Host() {
    }

    /** Operating system, version and CPU, like {@code Windows 11 10.0 (amd64)} or {@code Mac OS X 15.1 (aarch64)}. */
    public static String system() {
        return System.getProperty("os.name") + " " + System.getProperty("os.version") + " (" + System.getProperty("os.arch") + ")";
    }

    /** The shell {@code run_command} uses: {@code cmd.exe} on Windows, {@code sh} elsewhere. */
    public static String shell() {
        return ShellCommand.SHELL;
    }

    /** The date and time to the minute, with the UTC offset, like {@code 2026-11-20 14:03 +01:00}. */
    public static String now() {
        return ZonedDateTime.now().format(MINUTES);
    }
}
