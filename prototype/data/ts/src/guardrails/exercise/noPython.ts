import { allow, deny, type Guardrail } from "@harness/api";
import { commands } from "../../helpers";

/** python, python3, python3.12, py, pip, pip3, uv and uvx; the whole word, so `cat script.py` is fine. */
const PYTHON = /^(python[0-9.]*|py|pip[0-9.]*|uvx?)$/;

/**
 * Keeps the model from running Python. An interpreter runs whatever it is given, so it walks around every
 * pattern the other guardrails match on. Deny, not Ask: one press of [a] would approve it for good.
 */
export const noPython: Guardrail = {
  name: "no-python",

  beforeToolUse(call) {
    const command = commands.of(call);
    if (command === null || !commands.names(command).some((name) => PYTHON.test(name))) return allow();
    return deny(
      "Running Python is not allowed: a script can do anything, out of sight of the guardrails. " +
        "Use the tools instead, or write the script to a file and ask the user to review and run it.",
    );
  },
};
