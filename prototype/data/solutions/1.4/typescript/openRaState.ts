import { staticSection, type AssemblyContext, type SystemPromptSection } from "@harness/api";
import { git } from "../../helpers";

/** OpenRA's branch and uncommitted changes as the session starts, so leftovers from an earlier session are not a surprise. */
export const openRaState = (ctx: AssemblyContext): SystemPromptSection[] => { // the whole ctx: git runs through ctx.exec
  if (!ctx.workspace.exists("OpenRA")) return []; // 1.2 clones it, and a fresh clone has nothing to report
  const branch = git.branch(ctx, "OpenRA") ?? "a detached HEAD";
  const changes = git.changes(ctx, "OpenRA");
  const text = changes.length === 0
    ? `OpenRA is on ${branch} with no uncommitted changes.`
    : `OpenRA is on ${branch} and has ${changes.length} uncommitted changes from before this session:\n` +
      changes.slice(0, 20).join("\n") +
      "\nThe user made these. Mention them before you change those files, and never revert them unless asked.";
  return [staticSection("openra_state", text)];
};
