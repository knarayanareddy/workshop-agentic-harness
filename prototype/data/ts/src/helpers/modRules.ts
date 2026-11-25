import type { Workspace } from "@harness/api";

const MOD = "OpenRA/mods/ra";
const RULES = `${MOD}/rules`;
const NAMES_FILE = `${MOD}/fluent/rules.ftl`;

/** `actor-2tnk =` with `.name = Medium Tank` on the next line, or `actor-badr-name = Badger`. */
const NAMES = /^(actor-[a-z0-9-]+) *=\s*\n\s+\.name *= *(.+)$|^(actor-[a-z0-9-]+-name) *= *(.+)$/gm;

/** An actor (unit, building, ...) with its in-game name, and the rules file that defines it. */
export interface Actor {
  id: string;
  name: string;
  file: string;
}

/** What `modRules.setValue` did. Use it in a `switch (result.kind)` with a case for each. */
export type SetValueResult =
  /** Changed in `file`; the value was `oldValue`. */
  | { kind: "changed"; file: string; oldValue: string }
  /** No rules file defines the actor. */
  | { kind: "no_such_actor" }
  /** The actor in `file` has no such trait of its own: it may inherit it. */
  | { kind: "no_such_trait"; file: string }
  /** The actor's trait in `file` has no such key of its own: it may inherit it. */
  | { kind: "no_such_key"; file: string };

const rulesFiles = (workspace: Workspace) =>
  workspace.list(RULES).filter((f) => f.endsWith(".yaml")).map((f) => `${RULES}/${f}`);

/**
 * Reads and changes the Red Alert mod's rules in the workspace's OpenRA checkout.
 *
 * The rules are MiniYAML, indented with tabs: an actor starts at the beginning of a line (`2TNK:`), its traits are
 * one tab in (`\tMobile:`) and their keys two tabs in (`\t\tSpeed: 72`). Names starting with `^` are templates that
 * other actors inherit from. In-game names live in a separate translation file, `fluent/rules.ftl`.
 */
export const modRules = {
  MOD,
  RULES,

  /** Every actor that has an in-game name, like `2TNK` / `Medium Tank` / `OpenRA/mods/ra/rules/vehicles.yaml`. Templates are left out. */
  actors: (workspace: Workspace): Actor[] => {
    const names = new Map<string, string>();
    for (const m of workspace.readText(NAMES_FILE).replace(/\r\n/g, "\n").matchAll(NAMES)) {
      if (m[1]) names.set(`${m[1]}.name`, m[2].trim());
      else names.set(m[3], m[4].trim());
    }
    const actors = new Map<string, Actor>();
    for (const path of rulesFiles(workspace)) {
      let actor = "";
      for (const line of workspace.readText(path).split("\n")) {
        if (/^[^\s#]/.test(line)) actor = line.split(":")[0].trim();
        const trimmed = line.trim();
        if (!trimmed.startsWith("Name:")) continue;
        const name = names.get(trimmed.slice("Name:".length).trim());
        if (name && !actor.startsWith("^")) actors.set(`${actor}\n${name}\n${path}`, { id: actor, name, file: path });
      }
    }
    return [...actors.values()];
  },

  /**
   * Sets `key` of `trait` in `actor`'s own rules to `value`, like `2TNK`, `Mobile`, `Speed`, `80`. Only changes a key
   * the actor defines itself: an inherited value comes back as `no_such_trait` or `no_such_key`. The actor ID is
   * matched ignoring case; the trait as written in the rules, like `Armament@PRIMARY`.
   *
   * Throws when `value` is empty or more than one line.
   */
  setValue: (workspace: Workspace, actor: string, trait: string, key: string, value: string): SetValueResult => {
    if (value.trim() === "" || /[\r\n]/.test(value)) throw new Error("The value must be a single, non-empty line.");
    for (const path of rulesFiles(workspace)) {
      const lines = workspace.readText(path).split("\n");
      const start = lines.findIndex((line) => line.trimEnd().toLowerCase() === `${actor}:`.toLowerCase());
      if (start < 0) continue;
      let end = lines.findIndex((line, i) => i > start && /^\S/.test(line));
      if (end < 0) end = lines.length;
      const traitAt = lines.findIndex((line, i) => i > start && i < end && line.trimEnd() === `\t${trait}:`);
      if (traitAt < 0) return { kind: "no_such_trait", file: path };
      let keyAt = -1;
      for (let i = traitAt + 1; i < end && (lines[i].startsWith("\t\t") || lines[i].trim() === ""); i++) {
        if (lines[i].trim().startsWith(`${key}:`)) {
          keyAt = i;
          break;
        }
      }
      if (keyAt < 0) return { kind: "no_such_key", file: path };
      const oldValue = lines[keyAt].slice(lines[keyAt].indexOf(":") + 1).trim();
      lines[keyAt] = `\t\t${key}: ${value.trim()}`;
      workspace.writeText(path, lines.join("\n"));
      return { kind: "changed", file: path, oldValue };
    }
    return { kind: "no_such_actor" };
  },
};
