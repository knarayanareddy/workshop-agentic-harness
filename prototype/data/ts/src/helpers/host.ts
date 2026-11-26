import { shell } from "@harness/api";

const pad = (n: number) => String(n).padStart(2, "0");

/** The machine the harness runs on, in words a model understands. */
export const host = {
  /**
   * `Windows` or `macOS or Linux`. The embedded engine has no `process` or `os` module: the shell is all it can see.
   * (Kotlin and Java also give the version and CPU.)
   */
  system: (): string => (shell.name === "cmd.exe" ? "Windows" : "macOS or Linux"),

  /** The shell `run_command` uses: `cmd.exe` on Windows, `sh` elsewhere. */
  shell: (): string => shell.name,

  /** The date and time to the minute, with the UTC offset, like `2026-11-20 14:03 +01:00`. */
  now: (): string => {
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const zone = `${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${zone}`;
  },
};
