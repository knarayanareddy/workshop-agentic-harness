import type { SystemPromptSection, Workspace } from "@harness/api";
import { iterationBudget } from "./iterationBudget";
import { role } from "./role";
import { workingAgreements } from "./workingAgreements";

/** The default system prompt, in order. */
export const defaultSections = (workspace: Workspace): SystemPromptSection[] => [
  role(workspace),
  workingAgreements,
  iterationBudget,
];
