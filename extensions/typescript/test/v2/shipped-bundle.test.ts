// Loads the BUILT artefact (dist/extension-v2.js), the way the JVM loader does: evaluate the IIFE in a
// fresh scope and call its default export with an assembly context. Unit tests prove the source is
// right; this proves the thing that ships is right, including the JSON policy that only exists at
// bundle time.
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { nodeWorkspace } from "../support/host";

const BUNDLE = new URL("../../dist/extension-v2.js", import.meta.url).pathname;
const V2_ENTRY = new URL("../../src/v2/index.ts", import.meta.url).pathname;

/**
 * `npm test` must work from a clean checkout, where dist/ has not been built yet, so build the bundle
 * here if it is missing. CI additionally builds and re-runs this file, so the artefact is checked
 * both ways. Bundling with the same esbuild settings as `npm run bundle:v2` keeps the two honest.
 */
async function ensureBundle(): Promise<void> {
  if (existsSync(BUNDLE)) return;
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [V2_ENTRY],
    bundle: true,
    format: "iife",
    globalName: "__harnessExtension",
    target: "es2022",
    outfile: BUNDLE,
  });
}

interface Shipped {
  systemPrompt: { kind: string; name: string; text?: string }[];
  tools: { name: string; description: string; inputSchema: { required?: string[] }; execute: (i: Record<string, unknown>, c: unknown) => unknown }[];
  guardrails: { name: string; beforeToolUse?: (call: unknown, ctx: unknown) => unknown }[];
  listeners: unknown[];
}

function load(): Shipped {
  const src = readFileSync(BUNDLE, "utf8");
  (globalThis as Record<string, unknown>).__harnessShell = { name: "sh", timeoutSeconds: 120, maxOutput: 20_000 };
  // esbuild emits `var __harnessExtension = ...`; inside a Function that is function-local, so return it.
  const global = new Function(`${src}\n;return __harnessExtension;`)() as { default?: (ctx: unknown) => Shipped } | ((ctx: unknown) => Shipped);
  const fn = (global as { default?: (ctx: unknown) => Shipped }).default ?? (global as (ctx: unknown) => Shipped);
  if (typeof fn !== "function") throw new Error("the bundle's default export is not a function");
  return fn({ workspace: nodeWorkspace(), exec: () => ({ exitCode: 0, output: "", timedOut: false }) });
}

describe("the shipped v2 bundle", () => {
  
  let ext: Shipped;
  let policy: Shipped["guardrails"][number];
  beforeAll(async () => {
    await ensureBundle();
    ext = load();
    policy = ext.guardrails.find((g) => g.name === "policy")!;
  });
  const decide = async (tool: string, input: Record<string, unknown>) =>
    (await (policy.beforeToolUse as (c: unknown, x: unknown) => Promise<{ kind: string }>)({ id: "1", tool: { name: tool, description: "" }, input }, {})) as { kind: string };

  it("is a complete agent: sections, tools, guardrails and listeners", () => {
    expect(ext.systemPrompt.map((s) => s.name)).toEqual(expect.arrayContaining(["role", "working_agreements", "skills_catalog", "provenance"]));
    expect(ext.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file", "run_command", "load_skill"]));
    expect(ext.guardrails.map((g) => g.name)).toEqual(expect.arrayContaining(["policy", "upstream-ack", "protected-paths", "command", "build-file", "result-cap"]));
    expect(ext.listeners.length).toBe(2);
  });

  it("carries the policy JSON into the bundle and decides with it", async () => {
    expect((await decide("run_command", { argv: ["git", "push"] })).kind).toBe("deny");
    expect((await decide("read_file", { path: ".env" })).kind).toBe("deny");
    expect((await decide("edit_file", { path: "pom.xml" })).kind).toBe("deny");
    expect((await decide("read_file", { path: "workshop.html" })).kind).toBe("allow");
    expect((await decide("run_command", { argv: ["git", "status"] })).kind).toBe("allow");
  });

  it("ships the argv runner that the policy depends on", () => {
    const run = ext.tools.find((t) => t.name === "run_command")!;
    expect(run.inputSchema.required).toEqual(["argv"]);
    expect(run.description).toMatch(/no shell/i);
  });

  it("exposes load_skill with the catalog the model reads", () => {
    expect(ext.tools.find((t) => t.name === "load_skill")!.description).toMatch(/Load the full text/);
  });
});
