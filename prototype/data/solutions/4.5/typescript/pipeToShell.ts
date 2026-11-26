import { allow, deny, type Guardrail } from "@harness/api";
import { commands } from "../../helpers";

const DOWNLOADERS = new Set(["curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"]);
const RUNNERS = /^((ba|z|da|k|fi)?sh|python[0-9.]*|perl|ruby|node|php|iex|invoke-expression)$/;

/**
 * Denies running code straight from the internet: nobody has read it, and it runs with the user's permissions.
 * Any command that both downloads and runs is denied, piped or not: downloading and running are two steps.
 */
export const pipeToShell: Guardrail = {
  name: "pipe-to-shell",

  beforeToolUse(call) {
    const command = commands.of(call);
    if (command === null) return allow();
    const names = commands.names(command);
    const downloadsAndRuns = names.some((name) => DOWNLOADERS.has(name)) && names.some((name) => RUNNERS.test(name));
    if (!downloadsAndRuns && !/DownloadString/i.test(command)) return allow();
    return deny("Running a script straight from the internet is never allowed. Download it to a file, show it to the user, and let them decide.");
  },
};
