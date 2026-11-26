import { defineExtension } from "@harness/api";
import { defaultGuardrails } from "./guardrails/defaults";
import { consoleTrace } from "./listeners/defaults/consoleTrace";
import { defaultSections } from "./systemprompt/defaults";
import { defaultTools } from "./tools/defaults";

/**
 * Everything this module contributes: a complete agent on its own, so use it instead of the Java or
 * Kotlin bundle, not next to them (the tool names would clash). The app decides where it goes in the
 * assembly. Its system prompt is the whole system prompt, in order.
 */
export default defineExtension((ctx) => {
  return {
    systemPrompt: [...defaultSections(ctx.workspace)], // add your sections after the default ones
    tools: defaultTools,
    guardrails: defaultGuardrails,
    listeners: [consoleTrace()],
  };
});
