import { shell, type ToolCall, type Workspace } from "@harness/api";

const WORD_BOUNDARY = /[\s;|&<>()"'`=]+/;
const HOME = /\$\{?HOME\b|%USERPROFILE%|\$env:USERPROFILE/i;

/** cmd.exe switches (`dir /b`, `dir /a:d`) look like absolute paths but are not. */
const CMD_SWITCH = /^\/[A-Za-z0-9?-]{1,3}(:[^/\\]*)?$/;

const words = (command: string): string[] => command.split(WORD_BOUNDARY).filter((word) => word !== "");

const names = (command: string): string[] =>
  words(command).map((word) => word.slice(Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\")) + 1).toLowerCase().replace(/\.exe$/, ""));

/**
 * Looks at the command line of a `run_command` call, for guardrails. These read the words as they are typed, they
 * don't run a shell: a command that builds a word at run time (`$VAR`, globs, `$(...)`) gets past them. The default
 * `command` guardrail sends every command like that to a human.
 */
export const commands = {
  /** The command line when `call` is a `run_command` call; `null` for any other tool. */
  of: (call: ToolCall): string | null =>
    call.tool.name === "run_command" && typeof call.input.command === "string" ? call.input.command : null,

  /**
   * The words of `command`, as typed: `git -C OpenRA push "origin"` gives `git`, `-C`, `OpenRA`, `push`, `origin`.
   * Spaces, quotes, `;`, `&`, `|`, `<`, `>`, `(`, `)`, `` ` `` and `=` separate words.
   */
  words,

  /**
   * Every word of `command` the way a program name is compared: lowercase, without its directory and without `.exe`.
   * `C:\Python\python.exe x.py` gives `python`, `x.py`. Every word, not only the first: `sh -c "python x.py"` and
   * `cmd /c python x.py` start Python too.
   */
  names,

  /** Whether all of `wanted` occur in `command`, in any order and ignoring case: `hasWords(command, "git", "push")`. */
  hasWords: (command: string, ...wanted: string[]): boolean => {
    const found = names(command);
    return wanted.every((word) => found.includes(word.toLowerCase()));
  },

  /**
   * Whether `word`, read as a path, points outside `workspace`: `..`, `~`, `$HOME`, or an absolute path elsewhere.
   * Words that are not paths (`-la`, a cmd.exe switch like `/b`) do not.
   */
  isOutsideWorkspace: (word: string, workspace: Workspace): boolean => {
    if (word === "" || word === "/dev/null") return false;
    if (shell.name === "cmd.exe" && CMD_SWITCH.test(word)) return false;
    if (word.startsWith("~") || HOME.test(word)) return true;
    try {
      return !workspace.contains(word);
    } catch {
      return false; // not a path on this platform
    }
  },
};
