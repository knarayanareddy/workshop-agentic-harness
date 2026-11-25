import { failure, success, type Tool } from "@harness/api";
import { toolbox } from "../../helpers";

const ACTOR_ID = /^[A-Za-z0-9._-]+$/;

/** An actor's final rules, inheritance resolved by OpenRA itself instead of by the model. */
export const actorRules: Tool = {
  name: "actor_rules",
  description:
    "Show the final rules of one Red Alert actor (a unit, building or other object), with everything it inherits merged in. " +
    "Use this instead of reading the YAML files when you need an actor's actual values. Needs the toolbox (start_toolbox).",
  inputSchema: {
    type: "object",
    properties: { actor: { type: "string", description: "The actor ID, like 2TNK or TSLA" } },
    required: ["actor"],
  },

  execute(input, ctx) {
    const actor = String(input.actor ?? "").trim().toUpperCase();
    if (!ACTOR_ID.test(actor)) return failure(`'${actor}' is not an actor ID. IDs look like 2TNK or TSLA.`);
    const result = toolbox.exec(ctx, `openra-rules ${actor}`);
    if (!result) return failure("The toolbox is not running. Call start_toolbox first.");
    return result.exitCode === 0 ? success(result.output) : failure(`No rules found for ${actor}:\n${result.output.slice(-2000)}`);
  },
};
