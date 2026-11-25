import { allow, deny, type Guardrail } from "@harness/api";
import { commands } from "../../helpers";

/** Why `command` must not run, or `null` when it may. */
const reasonToDeny = (command: string): string | null => {
  const has = (...words: string[]) => commands.hasWords(command, ...words);
  if (has("git", "push")) return "Pushing is not allowed";
  if (has("git", "send-email")) return "Sending patches upstream is not allowed";
  if (has("git", "remote", "add") || has("git", "remote", "set-url")) return "Changing git remotes is not allowed";
  if (has("gh", "pr") || has("hub", "pull-request")) return "Opening pull requests is not allowed";
  if (has("gh", "api") || command.toLowerCase().includes("api.github.com")) return "Calling the GitHub API is not allowed";
  return null;
};

/**
 * Nothing from this workshop may reach GitHub: denies every command that could push or open a pull request.
 * Deny, not Ask (§5.4): a push is never acceptable, so no human should be able to approve one.
 */
export const noPush: Guardrail = {
  name: "no-push",

  beforeToolUse(call) {
    const command = commands.of(call);
    const reason = command === null ? null : reasonToDeny(command);
    if (reason === null) return allow();
    return deny(`${reason}. Work from this workshop stays on this machine: commit locally if you need to, but never push or open a pull request.`);
  },
};
