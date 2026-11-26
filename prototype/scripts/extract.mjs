// Extracts the worksheet + defaults from a checkout of workshop-agentic-harness into prototype/data/.
// Usage: node prototype/scripts/extract.mjs <path-to-repo-checkout>
// Re-run whenever workshop.html changes. Output is small and textual.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repo = path.resolve(process.argv[2] ?? "../workshop-agentic-harness");
const out = path.resolve(new URL("../data", import.meta.url).pathname);
const html = fs.readFileSync(path.join(repo, "workshop.html"), "utf8");
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = (s) => unesc(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
const LANGS = ["kotlin", "java", "typescript"];

fs.rmSync(path.join(out, "solutions"), { recursive: true, force: true });
fs.rmSync(path.join(out, "defaults"), { recursive: true, force: true });
fs.rmSync(path.join(out, "ts"), { recursive: true, force: true });
const chapters = html.split(/(?=<section class="chapter")/).slice(1).map((c) => c.split(/<\/section>/)[0]);
const parts = [];
const solutionsIndex = [];
for (const ch of chapters) {
  const open = ch.match(/<section [^>]*>/)[0];
  const part = attr(open, "data-part");
  const id = attr(open, "id");
  const base = {
    id, part: part ?? null, title: attr(open, "data-title"), group: attr(open, "data-group"),
    assignment: attr(open, "data-assignment") ?? null, core: /\bdata-core\b/.test(open), optional: /\bdata-optional\b/.test(open),
  };
  const goal = ch.match(/<div class="goal">([\s\S]*?)<\/div>/);
  const why = ch.match(/<h3>Why are we doing this\?<\/h3>\s*([\s\S]*?)<h3>/);
  const steps = [...(ch.match(/<ol class="steps">([\s\S]*?)<\/ol>/)?.[1] ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
  const hints = [...ch.matchAll(/<details class="hint">\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({ summary: text(m[1]), text: text(m[2]) }));
  const sol = ch.match(/<details class="solution">([\s\S]*)<\/details>/);
  const files = {};
  if (sol) {
    for (const lm of sol[1].matchAll(/<div class="lang" data-lang="(\w+)">([\s\S]*?)(?=<div class="lang" data-lang="|<\/details>|$)/g)) {
      const lang = lm[1];
      const body = lm[2];
      const items = [];
      const re = /(?:<p>([\s\S]*?)<\/p>\s*)?<pre><code>([\s\S]*?)<\/code><\/pre>/g;
      let m;
      while ((m = re.exec(body))) {
        const label = m[1] ? text(m[1]) : "";
        items.push({ label, code: unesc(m[2]).replace(/\n$/, "") });
      }
      const fileItems = items.filter((i) => /^[\w./-]+\.(kt|java|ts)$/.test(i.label));
      const reg = items.filter((i) => !/^[\w./-]+\.(kt|java|ts)$/.test(i.label));
      files[lang] = fileItems.map((i) => i.label);
      for (const f of fileItems) {
        const rel = path.join("solutions", part, lang, path.basename(f.label));
        fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
        fs.writeFileSync(path.join(out, rel), f.code + "\n");
        if (lang === "typescript") {
          // Executable tree: the solution is placed where the worksheet says it lives (src/<kind>/exercise/<file>.ts),
          // so its relative imports (`../../helpers`) resolve against the mirrored defaults. Body is byte-identical.
          const run = path.join(out, "ts", f.label);
          fs.mkdirSync(path.dirname(run), { recursive: true });
          fs.writeFileSync(run, f.code + "\n");
        }
        solutionsIndex.push({ part, lang, file: f.label, stored: rel, sha: sha(f.code), source: `workshop.html#${id} (details.solution > div[data-lang=${lang}])` });
      }
      if (reg.length) {
        const rel = path.join("solutions", part, lang, "_registration.txt");
        fs.writeFileSync(path.join(out, rel), reg.map((r) => `${r.label}\n${r.code}`).join("\n\n") + "\n");
      }
    }
  }
  parts.push({ ...base, goal: goal ? text(goal[1]) : null, why: why ? text(why[1]) : null, steps, hints, files, hasSolution: !!sol });
}
fs.writeFileSync(path.join(out, "assignments.json"), JSON.stringify({ source: "workshop.html", sha: sha(html), parts }, null, 1));
fs.writeFileSync(path.join(out, "solutions", "index.json"), JSON.stringify(solutionsIndex, null, 1));

// ---- defaults mirrored from extensions/ (+ helpers) and the contract -------------------------------
const copyTree = (from, to, filter = () => true) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(f, t, filter);
    else if (filter(f)) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(f, t); }
  }
};
fs.mkdirSync(path.join(out, "ts"), { recursive: true });
copyTree(path.join(repo, "extensions/typescript/src"), path.join(out, "ts/src"), (f) => !f.endsWith(".gitkeep") && !f.endsWith("globals.d.ts"));
// Toolbox manifest: real sha256 of the real toolbox files (v2 provenance, "checksummed toolbox image" input).
const toolboxFiles = ["Dockerfile", "bin/openra-build", "bin/openra-check", "bin/openra-rules", "bin/openra-package"];
fs.writeFileSync(path.join(out, "toolbox-manifest.json"), JSON.stringify(Object.fromEntries(toolboxFiles.map((f) => [`workspace/docker/${f}`, crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, "workspace/docker", f))).digest("hex")])), null, 1));
copyTree(path.join(repo, "extensions/kotlin/src/main"), path.join(out, "defaults/kotlin"), (f) => !f.endsWith(".gitkeep"));
copyTree(path.join(repo, "extensions/java/src/main"), path.join(out, "defaults/java"), (f) => !f.endsWith(".gitkeep"));
const contract = path.resolve(out, "../contract/v1");
// Clear only the generated parts. Wiping the whole directory used to delete package.json, which is
// what makes `@harness/api` resolve as a local file: dependency -- re-running extract then broke
// `npm run dev`/`regress`/`verify` until an npm install re-linked it. The manifest is generated here too.
fs.rmSync(path.join(contract, "kotlin"), { recursive: true, force: true });
fs.mkdirSync(contract, { recursive: true });
copyTree(path.join(repo, "harness-api/src/main/kotlin"), path.join(contract, "kotlin"));
fs.copyFileSync(path.join(repo, "harness-api/typescript/harness.ts"), path.join(contract, "harness.ts"));
fs.writeFileSync(path.join(contract, "package.json"), JSON.stringify({
  name: "@harness/api", version: "0.0.0-mirror", type: "module", main: "harness.ts", types: "harness.ts",
  description: "Verbatim mirror of harness-api/typescript/harness.ts (copied by prototype/scripts/extract.mjs)",
}, null, 0) + "\n");
fs.mkdirSync(path.join(out, "repo"), { recursive: true });
for (const [from, to] of [["harness-core/src/main/kotlin/com/jdriven/harness/core/Agent.kt", "Agent.kt"], ["harness-core/src/main/kotlin/com/jdriven/harness/core/Tokens.kt", "Tokens.kt"],
  ["harness-core/src/testFixtures/kotlin/com/jdriven/harness/core/ScriptedModelClient.kt", "ScriptedModelClient.kt"], ["app/src/main/kotlin/com/jdriven/harness/app/Main.kt", "Main.kt"],
  ["workspace/docker/bin/openra-build", "openra-build"], ["workspace/docker/bin/openra-check", "openra-check"], ["workspace/docker/bin/openra-rules", "openra-rules"],
  ["workspace/docker/bin/openra-package", "openra-package"], ["workspace/docker/Dockerfile", "toolbox.Dockerfile"]]) {
  fs.copyFileSync(path.join(repo, from), path.join(out, "repo", to));
}
console.log(`parts: ${parts.length}, numbered: ${parts.filter((p) => /^\d/.test(p.part ?? "") && p.part !== "Extra").length}, solutions: ${solutionsIndex.length}`);
