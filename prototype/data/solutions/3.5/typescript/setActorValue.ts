import { failure, success, type Tool } from "@harness/api";
import { modRules } from "../../helpers";

/** Changes one value an actor defines itself. Narrow on purpose: it cannot break the YAML around it. */
export const setActorValue: Tool = {
  name: "set_actor_value",
  description:
    "Change one value in a Red Alert actor's own rules, like actor 2TNK, trait Mobile, key Speed, value 80, and return the old " +
    "and new value. Safer than edit_file for rule values. Only changes a key the actor defines itself; for an inherited value it fails and says what to do.",
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "The actor ID, like 2TNK" },
      trait: { type: "string", description: "The trait as written in the rules, like Mobile or Armament@PRIMARY" },
      key: { type: "string", description: "The key inside the trait, like Speed" },
      value: { type: "string", description: "The new value, like 80" },
    },
    required: ["actor", "trait", "key", "value"],
  },

  execute(input, ctx) {
    const [actor, trait, key, value] = [input.actor, input.trait, input.key, input.value].map((v) => String(v ?? "").trim());
    const result = modRules.setValue(ctx.workspace, actor, trait, key, value);
    switch (result.kind) {
      case "changed":
        return success(`${actor} ${trait}.${key}: ${result.oldValue} -> ${value} in ${result.file}`);
      case "no_such_actor":
        return failure(`There is no actor ${actor} in ${modRules.RULES}. Use find_actor to look up the ID.`);
      case "no_such_trait":
        return failure(`${actor} has no ${trait} of its own in ${result.file}, so it may inherit it. Check with actor_rules, then add an override with edit_file.`);
      case "no_such_key":
        return failure(`${actor}'s ${trait} has no ${key} of its own in ${result.file}, so it may inherit it. Check with actor_rules, then add it with edit_file.`);
    }
  },
};
