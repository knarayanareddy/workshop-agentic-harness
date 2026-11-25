import { staticSection, type Workspace } from "@harness/api";

/**
 * Tells the model what it is and to use its tools instead of guessing. Static: written once at assembly and
 * frozen for the session (§3).
 */
export const role = (workspace: Workspace) =>
  staticSection(
    "role",
    `You are a coding agent working in the directory ${workspace.root.split(/[\\/]/).filter(Boolean).pop()}. ` +
      "Use the tools to inspect and change files; do not guess file contents.",
  );
