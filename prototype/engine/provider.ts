// The simulated model *provider*: billed usage with cache read/write, latency, price tables, and the exact wire JSON
// the real client would send (mirrors OpenAiModelClient.toMessages, prototype/data/repo → harness-core/.../OpenAiModelClient.kt:108-145).
import type { Message } from "@harness/api";
import { estimate, estimateMessage, estimateTool, type InferenceRequest, type InferenceResponse, type Usage } from "./agent";

export interface Prices { input: number; output: number; cacheRead: number; cacheWrite: number } // USD per million tokens
export const PRICE_PRESETS: Record<string, { label: string; prices: Prices }> = {
  workshop: { label: "workshop default (costMeter.ts: 3 / 15 / 0.30 / 3.75)", prices: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  small: { label: "small model (illustrative: 0.25 / 1.25 / 0.03 / 0.30)", prices: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 } },
  large: { label: "large model (illustrative: 15 / 75 / 1.50 / 18.75)", prices: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  nocache: { label: "no prompt cache (3 / 15 / 3 / 3)", prices: { input: 3, output: 15, cacheRead: 3, cacheWrite: 3 } },
};
export const costOf = (u: Usage, p: Prices): number =>
  (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadInputTokens * p.cacheRead + u.cacheCreationInputTokens * p.cacheWrite) / 1_000_000;
export const sumUsage = (us: Usage[]): Usage => us.reduce((a, u) => ({
  inputTokens: a.inputTokens + u.inputTokens, outputTokens: a.outputTokens + u.outputTokens,
  cacheReadInputTokens: a.cacheReadInputTokens + u.cacheReadInputTokens, cacheCreationInputTokens: a.cacheCreationInputTokens + u.cacheCreationInputTokens,
}), { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

/** Deterministic PRNG (mulberry32): a scenario + a seed always yields the same trace. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MIN_CACHEABLE_TOKENS = 1024;
/** Stated tolerance: billed tokens differ from the chars/4 estimate by at most this fraction (real tokenizers are not chars/4). */
export const TOKENIZER_TOLERANCE = 0.08;

const msgKey = (m: Message): string => JSON.stringify(m);

/**
 * Billing model (assumed, not measured): the provider caches the longest common prefix, at message granularity,
 * of the previous request (tools → system → messages, like Anthropic); prompts under 1024 tokens are not cached.
 * Billed tokens = chars/4 estimate × a per-session factor in ±TOKENIZER_TOLERANCE derived from the seed.
 */
export class SimProvider {
  private prev: { sys: string; tools: string; msgs: string[] } | null = null;
  readonly factor: number;
  constructor(seed: number, private readonly cache = true) {
    this.factor = 1 + (rng(seed ^ 0x9e3779b9)() * 2 - 1) * TOKENIZER_TOLERANCE;
  }

  bill(req: InferenceRequest, response: Pick<InferenceResponse, "content">): { usage: Usage; latencyMs: number; prefixTokens: number } {
    const f = this.factor;
    const toolsKey = JSON.stringify(req.tools);
    const msgs = req.messages.map(msgKey);
    const sysT = estimate(req.system);
    const toolT = req.tools.reduce((s, t) => s + estimateTool(t), 0);
    const msgT = req.messages.map(estimateMessage);
    const total = sysT + toolT + msgT.reduce((a, b) => a + b, 0);
    let prefixEst = 0;
    if (this.prev && this.prev.sys === req.system && this.prev.tools === toolsKey) {
      prefixEst = sysT + toolT;
      for (let i = 0; i < Math.min(msgs.length, this.prev.msgs.length) && msgs[i] === this.prev.msgs[i]; i++) prefixEst += msgT[i];
    }
    this.prev = { sys: req.system, tools: toolsKey, msgs };
    const billedTotal = Math.round(total * f);
    const cacheable = this.cache && billedTotal >= MIN_CACHEABLE_TOKENS;
    const read = cacheable && prefixEst * f >= MIN_CACHEABLE_TOKENS ? Math.round(prefixEst * f) : 0;
    const write = cacheable ? billedTotal - read : 0;
    const outEst = response.content.reduce((s, b) => s + (b.kind === "text" ? estimate(b.text) : b.kind === "tool_use" ? estimate(b.name) + estimate(JSON.stringify(b.input)) : b.kind === "thinking" ? estimate(b.thinking) : 0), 0);
    const out = Math.max(1, Math.round(outEst * f));
    return {
      usage: { inputTokens: billedTotal - read - write, outputTokens: out, cacheReadInputTokens: read, cacheCreationInputTokens: write },
      latencyMs: 350 + out * 18,
      prefixTokens: Math.round(prefixEst * f),
    };
  }
}

// ---- wire JSON ---------------------------------------------------------------------------------------------------
const messageTextOf = (m: Message): string => m.content.filter((b) => b.kind === "text").map((b) => (b as { text: string }).text).join("");
export function toWireMessages(m: Message): Record<string, unknown>[] {
  if (m.role === "assistant") {
    const uses = m.content.filter((b) => b.kind === "tool_use") as { id: string; name: string; input: unknown; invalidInput?: string }[];
    const text = messageTextOf(m);
    const o: Record<string, unknown> = { role: "assistant", content: text === "" ? null : text };
    const thinking = m.content.filter((b) => b.kind === "thinking") as { thinking: string; signature: string }[];
    for (const t of thinking) o[t.signature] = ((o[t.signature] as string) ?? "") + t.thinking;
    if (uses.length) o.tool_calls = uses.map((u) => ({ id: u.id, type: "function", function: { name: u.name, arguments: u.invalidInput ?? JSON.stringify(u.input) } }));
    return [o];
  }
  const results = m.content.filter((b) => b.kind === "tool_result") as { toolUseId: string; content: string; isError?: boolean }[];
  const out: Record<string, unknown>[] = results.map((r) => ({ role: "tool", tool_call_id: r.toolUseId, content: r.isError ? `Error: ${r.content}` : r.content }));
  const text = messageTextOf(m);
  if (text !== "") out.push({ role: "user", content: text });
  return out;
}
export function toWireRequest(req: InferenceRequest, model = "workshop-model"): Record<string, unknown> {
  return {
    model,
    messages: [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      ...req.messages.flatMap(toWireMessages),
    ],
    ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
  };
}
