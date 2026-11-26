import { staticSection } from "@harness/api";

/** How to mod OpenRA. Replaces the generic default working agreements. */
export const groundRules = staticSection(
  "ground_rules",
  [
    "# Ground rules",
    "- Mod through data: change the YAML rules and Lua scripts under OpenRA/mods/ra/. Never change the C# engine code.",
    "- Read an actor's rules, including what it inherits, before you change it.",
    "- Make the smallest change that does what the user asked, and nothing else.",
    "- If a request is vague, propose a concrete change and ask before you make it.",
    "- Check every change with openra-check from the toolbox before you report it done. If you could not run it, say so.",
  ].join("\n"),
);
