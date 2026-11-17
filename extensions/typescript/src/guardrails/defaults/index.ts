import type { Guardrail } from "@harness/api";
import { buildFile } from "./buildFile";
import { command } from "./command";
import { protectedPaths } from "./protectedPaths";
import { resultCap } from "./resultCap";

/** The default guardrails, in registration order. */
export const defaultGuardrails: Guardrail[] = [protectedPaths, command, buildFile, resultCap()];
