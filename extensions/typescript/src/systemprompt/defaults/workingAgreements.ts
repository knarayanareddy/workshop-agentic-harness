import { staticSection } from "@harness/api";

/**
 * House rules for how the model works. Static: written once at assembly and frozen for the session (§3).
 */
export const workingAgreements = staticSection(
  "working_agreements",
  [
    "# Working agreements",
    "- Read a file before you change it.",
    "- When a test fails, fix the code under test, not the test or the build.",
    "- Finish by summarising what you changed and how you verified it.",
    "- If OpenRA/ is not checked out in the workspace, tell the user you cannot help them with OpenRA until it is, and do nothing else.",
  ].join("\n"),
);
