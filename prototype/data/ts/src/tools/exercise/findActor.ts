import { failure, success, type Tool } from "@harness/api";
import { modRules } from "../../helpers";

/** From the names players use to the IDs the rules use. */
export const findActor: Tool = {
  name: "find_actor",
  description:
    "Find Red Alert actor IDs by their in-game name, like 'medium tank' for 2TNK or 'tesla' for TSLA. " +
    "Use this first whenever the user names a unit or building in their own words. Returns every match with its rules file.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string", description: "All or part of the in-game name, like 'tank'" } },
    required: ["name"],
  },

  execute(input, ctx) {
    const query = String(input.name ?? "").trim().toLowerCase();
    const matches = modRules.actors(ctx.workspace).filter((actor) => actor.name.toLowerCase().includes(query));
    if (matches.length === 0) return failure(`No actor is called anything like '${query}'. Try a shorter or more general word.`);
    return success(matches.map((actor) => `${actor.id}: ${actor.name} (${actor.file})`).join("\n"));
  },
};
