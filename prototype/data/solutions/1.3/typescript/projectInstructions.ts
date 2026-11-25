import { staticSection, type SystemPromptSection, type Workspace } from "@harness/api";
import { text } from "../../helpers";

const FILE = "AGENTS.md";

/** The project's own instructions for agents, read once at start-up. Nothing at all when the project has none. */
export const projectInstructions = (workspace: Workspace): SystemPromptSection[] => {
  if (!workspace.exists(FILE)) return [];
  const body = text.truncate(workspace.readText(FILE), 4000, `[cut here; read ${FILE} for the rest]`);
  return [staticSection("project_instructions", `# Project instructions, from ${FILE}\n${body}`)];
};
