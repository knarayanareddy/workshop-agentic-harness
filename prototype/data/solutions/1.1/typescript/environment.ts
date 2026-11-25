import { staticSection, type AssemblyContext } from "@harness/api";
import { git, host } from "../../helpers";

/** What the harness finds out about where it runs, once at start-up. Static: none of it changes during the session. */
export const environment = (ctx: AssemblyContext) => { // the whole ctx, not ctx.workspace: git runs through ctx.exec
  const repository = git.repositoryRoot(ctx);
  return staticSection("environment", [
    "# Environment",
    `- The session started at ${host.now()}.`,
    `- The system is ${host.system()}. Commands run in ${host.shell()}.`,
    repository
      ? `- Git: the workspace is inside the git repository at ${repository}.`
      : "- Git: the workspace is not in a git repository, so git cannot undo changes.",
  ].join("\n"));
};
