// Places the 48 reference solutions (24 Kotlin + 24 Java, extracted from workshop.html into
// prototype/data/solutions/<part>/<lang>/) into their exercise packages so a compiler can check them.
//
// Every solution file carries its own `package com.jdriven.harness.extensions.<lang>.<area>.exercise`
// line, so the destination is derived from the file, never guessed: the package maps 1:1 to the
// module's source root. Nothing is overwritten -- if a solution would replace a tracked file the run
// aborts, because that would mean the extractor put a solution where hand-written code lives.
//
//   node prototype/scripts/place-solutions.mjs install <repo>   # copy all 48 into place
//   node prototype/scripts/place-solutions.mjs verify  <repo>   # assert all 48 are in place
//   node prototype/scripts/place-solutions.mjs clean   <repo>   # remove them again
//
// Exit codes: 0 = ok, 1 = a solution is missing/misplaced (verify) or a clash was found.
import fs from "node:fs";
import path from "node:path";

const [, , cmd = "verify", repoArg = "."] = process.argv;
const repo = path.resolve(repoArg);
const solutionsRoot = path.join(repo, "prototype/data/solutions");

// Which Gradle module owns each language, and where that module's sources begin.
const MODULES = {
  kotlin: "extensions/kotlin/src/main/kotlin",
  java: "extensions/java/src/main/java",
};

const pkgOf = (src) => {
  const m = /^\s*package\s+([\w.]+)\s*;?/m.exec(src);
  return m ? m[1] : null;
};

/** Every solution file, with the destination its own package line dictates. */
function plan() {
  const out = [];
  for (const part of fs.readdirSync(solutionsRoot).sort()) {
    for (const [lang, srcRoot] of Object.entries(MODULES)) {
      const dir = path.join(solutionsRoot, part, lang);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).sort()) {
        if (!file.endsWith(lang === "kotlin" ? ".kt" : ".java")) continue;
        const from = path.join(dir, file);
        const pkg = pkgOf(fs.readFileSync(from, "utf8"));
        if (!pkg) throw new Error(`${from}: no package line`);
        if (!pkg.includes(`extensions.${lang}`)) throw new Error(`${from}: package ${pkg} is not in the ${lang} module`);
        if (!pkg.split(".").includes("exercise")) throw new Error(`${from}: package ${pkg} is not an exercise package`);
        const to = path.join(repo, srcRoot, ...pkg.split("."), file);
        out.push({ part, lang, file, from, to });
      }
    }
  }
  return out;
}

const items = plan();
const byLang = items.reduce((a, i) => ((a[i.lang] = (a[i.lang] ?? 0) + 1), a), {});
const summary = Object.entries(byLang).map(([k, v]) => `${v} ${k}`).join(", ");
console.log(`${items.length} solutions (${summary})`);

if (cmd === "install") {
  const clashes = items.filter((i) => fs.existsSync(i.to) && fs.readFileSync(i.to, "utf8") !== fs.readFileSync(i.from, "utf8"));
  if (clashes.length) {
    console.error(`refusing to overwrite ${clashes.length} tracked file(s):`);
    for (const c of clashes) console.error(`  ${path.relative(repo, c.to)}`);
    process.exit(1);
  }
  for (const i of items) {
    fs.mkdirSync(path.dirname(i.to), { recursive: true });
    fs.copyFileSync(i.from, i.to);
  }
  console.log(`installed ${items.length} into ${Object.values(MODULES).join(", ")}`);
} else if (cmd === "clean") {
  let n = 0;
  for (const i of items) {
    if (fs.existsSync(i.to)) {
      fs.rmSync(i.to);
      n++;
    }
  }
  // drop any exercise dir this left empty, but only if it holds nothing but .gitkeep
  for (const srcRoot of Object.values(MODULES)) {
    const root = path.join(repo, srcRoot);
    if (!fs.existsSync(root)) continue;
    for (const pkgDir of fs.globSync("**/exercise", { cwd: root })) {
      const abs = path.join(root, pkgDir);
      const left = fs.readdirSync(abs).filter((f) => f !== ".gitkeep");
      if (!left.length) console.log(`  (kept ${path.relative(repo, abs)}; .gitkeep only)`);
    }
  }
  console.log(`removed ${n}`);
} else if (cmd === "verify") {
  const missing = items.filter((i) => !fs.existsSync(i.to));
  const stale = items.filter((i) => fs.existsSync(i.to) && fs.readFileSync(i.to, "utf8") !== fs.readFileSync(i.from, "utf8"));
  if (missing.length) {
    console.error(`${missing.length} solution(s) not in place:`);
    for (const m of missing.slice(0, 10)) console.error(`  ${m.part}/${m.lang}/${m.file}`);
    process.exit(1);
  }
  if (stale.length) {
    console.error(`${stale.length} solution(s) differ from prototype/data/:`);
    for (const s of stale.slice(0, 10)) console.error(`  ${path.relative(repo, s.to)}`);
    process.exit(1);
  }
  console.log(`all ${items.length} solutions are in place and byte-identical to prototype/data/`);
} else {
  console.error(`unknown command ${cmd}; use install | verify | clean`);
  process.exit(2);
}
