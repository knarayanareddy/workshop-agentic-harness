import { accept, replace, success, type Guardrail } from "@harness/api";

/**
 * Keeps one runaway tool result from filling the model's context.
 * A safety net, not the first line of defence (§5.4): a tool should cap and describe its own
 * output. This only catches the tools that did not. Only afterToolUse is implemented.
 *
 * @param maxChars the longest successful result that passes through unchanged (default 30,000)
 */
export const resultCap = (maxChars = 30_000): Guardrail => ({
  name: "result-cap",

  afterToolUse(call, result) {
    if (result.kind !== "success" || result.content.length <= maxChars) return accept();
    return replace(
      success(
        `${result.content.slice(0, maxChars)}\n\n[truncated by result-cap: ${result.content.length} characters, ` +
          `showing the first ${maxChars}. Ask for less: narrow the path or pattern.]`,
      ),
    );
  },
});
