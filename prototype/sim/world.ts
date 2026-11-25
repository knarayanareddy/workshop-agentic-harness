// The simulation boundary. Everything that would need Docker / network / a JDK in the real harness is faked here,
// and every fake is registered in SIM_BOUNDARY so the UI can label results as simulated and link to docs/PROTOTYPE.md#f.
// Real things reused: the Workspace semantics (harness.ts), ShellCommand limits (120 s / 20 000 chars), ModRules file layout,
// the OpenRA actor names, the toolbox scripts' *shape* (data/repo/openra-*), the upstream AGENTS.md text (fetched, verbatim).
import type { CommandResult, Workspace } from "@harness/api";
import type { SimEnv } from "../engine/agent";
import UPSTREAM_AGENTS from "../data/fixtures/upstream-AGENTS.md?raw";
import TOOLBOX_DOCKERFILE from "../data/repo/toolbox.Dockerfile?raw";

export const SHELL = { name: "sh", timeoutSeconds: 120, maxOutput: 20_000 } as const;
export const ROOT = "/home/dev/workshop-agentic-harness/workspace";
export const REPO_ROOT = "/home/dev/workshop-agentic-harness";

export const SIM_BOUNDARY: Record<string, { fidelity: "real" | "replayed" | "simulated" | "illustrative"; note: string }> = {
  "workspace": { fidelity: "real", note: "Workspace contract semantics (resolve/contains/relativize/list) re-implemented over an in-memory tree." },
  "git": { fidelity: "simulated", note: "git is faked: rev-parse, branch, status --porcelain (diff vs. a baseline), diff, commit, push, checkout, clone. No real repository exists." },
  "docker": { fidelity: "simulated", note: "docker info/image/run/exec/build are faked; the 120 s ShellCommand timeout is real, and applied to the faked build time." },
  "openra-rules": { fidelity: "simulated", note: "Resolved-rules output format is a plausible MiniYAML flatten of the fixture, not captured from utility.sh." },
  "openra-check": { fidelity: "simulated", note: "Error text imitates OpenRA's compiler/linter style; wording is unverified against upstream. Only numeric keys and known actor names are validated." },
  "openra-package": { fidelity: "simulated", note: "Packaging and game launch are faked. GLSL is not validated by openra-check (that part matches the real script: it only lints YAML and Lua)." },
  "fixtures": { fidelity: "illustrative", note: "OpenRA fragments (2TNK, TSLA, player.yaml, world.yaml, rules.ftl, a shader) follow the worksheet's claims; values are not copied from upstream HEAD." },
  "model": { fidelity: "simulated", note: "No LLM: a deterministic replay driver encodes what the worksheet predicts." },
  "billing": { fidelity: "simulated", note: "Billed usage = chars/4 × a seeded factor (±8 %); cache hits modelled as longest-common-prefix. Prices are configurable." },
};

const FIXTURE_FTL = `## Vehicles
actor-1tnk =
    .name = Light Tank
actor-2tnk =
    .name = Medium Tank
actor-3tnk =
    .name = Heavy Tank
actor-4tnk =
    .name = Mammoth Tank
actor-ttnk =
    .name = Tesla Tank
actor-harv =
    .name = Ore Truck

## Structures
actor-tsla =
    .name = Tesla Coil
actor-weap-name = War Factory
actor-fact-name = Construction Yard
`;

const T = (s: string) => s.replace(/^( {4})+/gm, (m) => "\t".repeat(m.length / 4)); // fixtures are written with 4 spaces, rules are tabs

const FIXTURE_VEHICLES = T(`^Tank:
    Inherits: ^Vehicle
    Mobile:
        Locomotor: heavytracked
    Health:
        HP: 40000
    Armor:
        Type: Heavy

1TNK:
    Inherits: ^Tank
    Valued:
        Cost: 700
    Tooltip:
        Name: actor-1tnk.name
    Mobile:
        TurnSpeed: 10
        Speed: 113
    Armament:
        Weapon: 25mm

2TNK:
    Inherits: ^Tank
    Inherits@AUTOTARGET: ^AutoTargetGround
    Valued:
        Cost: 850
    Tooltip:
        Name: actor-2tnk.name
    Health:
        HP: 46000
    Mobile:
        TurnSpeed: 5
        Speed: 85
    Armament:
        Weapon: 90mm

3TNK:
    Inherits: ^Tank
    Valued:
        Cost: 1150
    Tooltip:
        Name: actor-3tnk.name
    Mobile:
        Speed: 72

4TNK:
    Inherits: ^Tank
    Valued:
        Cost: 1700
    Tooltip:
        Name: actor-4tnk.name
    Mobile:
        Speed: 56

TTNK:
    Inherits: ^Tank
    Valued:
        Cost: 1300
    Tooltip:
        Name: actor-ttnk.name
    Mobile:
        Speed: 85
`);

const FIXTURE_STRUCTURES = T(`^Building:
    Health:
        HP: 40000

TSLA:
    Inherits: ^Building
    Valued:
        Cost: 1200
    Tooltip:
        Name: actor-tsla.name
    Power:
        Amount: -150

WEAP:
    Inherits: ^Building
    Valued:
        Cost: 2000
    Tooltip:
        Name: actor-weap-name
`);

// NOTE (assumed): follows the worksheet's claim that DefaultCash is not in any YAML (hint "It can't find the number").
const FIXTURE_PLAYER = T(`Player:
    AlwaysVisible:
    Shroud:
        FogCheckboxDisplayOrder: 3
    PlayerResources:
        InsufficientFundsNotification: InsufficientFunds
        CashTickUpNotification: CashTickUp
        CashTickDownNotification: CashTickDown
    ConquestVictoryConditions:
`);

const FIXTURE_WORLD = T(`World:
    StartingUnits@lightallies:
        Class: light
        ClassName: options-starting-units.light
        Factions: allies, england, france, germany
        BaseActor: mcv
        SupportActors: e1,e1,e1,e1
    StartingUnits@lightsoviet:
        Class: light
        ClassName: options-starting-units.light
        Factions: soviet, russia, ukraine
        BaseActor: mcv
        SupportActors: e1,e1,e1,e1
`);

const FIXTURE_SHADER = `#version 140
// combined.frag (illustrative fragment; the real file is much longer)
uniform sampler2D Texture0;
in vec4 vTexCoord;
out vec4 fragColor;

void main()
{
    vec4 c = texture(Texture0, vTexCoord.st);
    fragColor = c;
}
`;

export const openraFixture = (): Record<string, string> => ({
  "OpenRA/AGENTS.md": UPSTREAM_AGENTS,
  "OpenRA/README.md": "# OpenRA\nA real-time strategy game engine (fixture).\n",
  "OpenRA/mods/ra/mod.yaml": "Metadata:\n\tTitle: Red Alert\n",
  "OpenRA/mods/ra/fluent/rules.ftl": FIXTURE_FTL,
  "OpenRA/mods/ra/rules/vehicles.yaml": FIXTURE_VEHICLES,
  "OpenRA/mods/ra/rules/structures.yaml": FIXTURE_STRUCTURES,
  "OpenRA/mods/ra/rules/player.yaml": FIXTURE_PLAYER,
  "OpenRA/mods/ra/rules/world.yaml": FIXTURE_WORLD,
  "OpenRA/glsl/combined.frag": FIXTURE_SHADER,
});
export const baseFixture = (): Record<string, string> => ({ "docker/Dockerfile": TOOLBOX_DOCKERFILE });

// ---- the in-memory Workspace --------------------------------------------------------------------------------------
export interface Journal { op: "read" | "write"; path: string; t: number }
export class VfsWorkspace implements Workspace {
  readonly root = ROOT;
  files = new Map<string, string>();
  baseline = new Map<string, string>(); // what "git HEAD" holds for OpenRA/
  dynamic = new Map<string, () => string>();
  journal: Journal[] = [];
  private clock = () => 0;
  constructor(files: Record<string, string> = {}, withBaseline = true) {
    for (const [k, v] of Object.entries(files)) this.files.set(k, v);
    if (withBaseline) this.commitBaseline();
  }
  bindClock(f: () => number) { this.clock = f; }
  commitBaseline() { this.baseline = new Map([...this.files].filter(([k]) => k.startsWith("OpenRA/"))); }
  private norm(path: string): string {
    if (path.includes("\0")) throw new Error(`Invalid path: ${path}`);
    let p = path.replace(/\\/g, "/");
    if (p.startsWith(ROOT + "/") || p === ROOT) p = p.slice(ROOT.length);
    else if (p.startsWith("/")) throw new Error(`Path escapes the workspace: ${path}`);
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") { if (!out.length) throw new Error(`Path escapes the workspace: ${path}`); out.pop(); } else out.push(seg);
    }
    return out.join("/");
  }
  resolve(path: string): string { const n = this.norm(path); return n ? `${ROOT}/${n}` : ROOT; }
  contains(path: string): boolean { try { this.norm(path); return true; } catch (e) { if (String(e).includes("Invalid path")) throw e; return false; } }
  relativize(abs: string): string { return abs === ROOT ? "" : abs.startsWith(ROOT + "/") ? abs.slice(ROOT.length + 1) : abs; }
  exists(path: string): boolean {
    const n = this.norm(path);
    if (n === "") return true;
    if (this.files.has(n) || this.dynamic.has(n)) return true;
    const pre = n + "/";
    return [...this.files.keys()].some((k) => k.startsWith(pre));
  }
  readText(path: string): string {
    const n = this.norm(path);
    this.journal.push({ op: "read", path: n, t: this.clock() });
    const d = this.dynamic.get(n);
    if (d) return d();
    const v = this.files.get(n);
    if (v === undefined) throw new Error(`NoSuchFileException: ${n}`);
    return v;
  }
  writeText(path: string, content: string): void {
    const n = this.norm(path);
    this.journal.push({ op: "write", path: n, t: this.clock() });
    this.files.set(n, content);
  }
  list(path = "."): string[] {
    const n = this.norm(path);
    const pre = n ? n + "/" : "";
    const set = new Set<string>();
    for (const k of [...this.files.keys(), ...this.dynamic.keys()]) if (k.startsWith(pre)) { const rest = k.slice(pre.length); const i = rest.indexOf("/"); set.add(i < 0 ? rest : rest.slice(0, i + 1)); }
    if (set.size === 0 && !this.exists(path)) throw new Error(`NoSuchFileException: ${n}`);
    return [...set].sort();
  }
  snapshot() { return { files: [...this.files], baseline: [...this.baseline] }; }
  restore(s: ReturnType<VfsWorkspace["snapshot"]>) { this.files = new Map(s.files); this.baseline = new Map(s.baseline); }
  changedFiles(): string[] { return [...this.files.keys()].filter((k) => k.startsWith("OpenRA/") && this.baseline.get(k) !== this.files.get(k)).sort(); }
}

// ---- the simulated machine ----------------------------------------------------------------------------------------
export interface SimOptions { openra: boolean; toolboxReady?: boolean; dockerUp?: boolean; files?: Record<string, string> }
const FROZEN = Date.UTC(2026, 2, 14, 10, 2, 0);
export class SimWorld implements SimEnv {
  readonly ws: VfsWorkspace;
  vt = 0;
  private dur = 0;
  private literal = false;
  imageBuilt = false;
  containerRunning = false;
  dockerUp: boolean;
  compiled = false;
  commits: string[] = [];
  pushAttempts: string[] = [];
  executed: string[] = [];
  network: string[] = [];
  jobs: { log: string; lines: string[]; reads: number; done: () => void }[] = [];
  constructor(o: SimOptions) {
    this.dockerUp = o.dockerUp ?? true;
    this.ws = new VfsWorkspace({ ...baseFixture(), ...(o.openra ? openraFixture() : {}), ...(o.files ?? {}) });
    this.ws.bindClock(() => this.vt);
    if (o.toolboxReady) { this.imageBuilt = true; this.containerRunning = true; this.compiled = true; }
  }
  now() { return this.vt; }
  advance(ms: number) { this.vt += ms; }
  takeDuration() { const d = this.dur; this.dur = 0; return d; }
  private cost(ms: number) { this.dur += ms; }
  frozenNow() { return FROZEN + this.vt; }

  spawn(command: string, log: string): void {
    this.cost(8);
    const steps = command.split("&&").map((s) => s.trim());
    const lines: string[] = [];
    const finish: (() => void)[] = [];
    for (const s of steps) {
      if (s.startsWith("docker build")) { lines.push("[+] Building 0.3s (2/9)", " => [1/7] FROM mcr.microsoft.com/dotnet/sdk", " => [4/7] RUN apt-get install -y make luac5.1", " => [7/7] COPY bin/ /usr/local/bin/"); finish.push(() => { this.imageBuilt = true; }); }
      else if (s.startsWith("docker run")) { lines.push("openra-toolbox: container started (--network none)"); finish.push(() => { this.containerRunning = true; }); }
      else if (s.includes("openra-build")) { lines.push("make all", "Build succeeded.", "    0 Warning(s)", "    0 Error(s)"); finish.push(() => { this.compiled = true; }); }
      else if (s.includes("openra-package")) { lines.push("== Package linux-x64", "Packaging OpenRA for linux-x64 …", "Launching ./out/linux-x64/play.sh"); this.shaderBroken() && lines.push("[error] shader: combined.frag failed to compile: 0:11(3): error: 'fragColour' undeclared"); }
    }
    const failed = this.shaderBroken() && command.includes("openra-package");
    lines.push(failed ? "exit code 1" : "exit code 0");
    this.jobs.push({ log, lines, reads: 0, done: () => finish.forEach((f) => f()) });
    this.ws.dynamic.set(log, () => this.readJob(log));
  }
  private shaderBroken() { return /fragColour/.test(this.ws.files.get("OpenRA/glsl/combined.frag") ?? ""); }
  /** each read of a job log advances it: 1st read = in progress, 2nd read = finished (deterministic "waiting"). */
  private readJob(log: string): string {
    const j = [...this.jobs].reverse().find((x) => x.log === log)!;
    j.reads++;
    const total = j.lines.length;
    const shown = j.reads >= 2 || j.lines.length <= 2 ? total : Math.max(1, Math.floor((total - 1) * 0.6));
    if (shown === total) { j.done(); this.ws.dynamic.delete(log); this.ws.files.set(log, j.lines.join("\n") + "\n"); }
    return j.lines.slice(0, shown).join("\n") + "\n";
  }

  exec(command: string): CommandResult {
    const argvMode = command.startsWith("\u0001argv ");
    this.executed.push(argvMode ? "[argv] " + command.slice(6) : command);
    this.cost(30 + command.length);
    this.literal = argvMode;
    let r: CommandResult;
    try { r = argvMode ? this.runSimple(command.slice(6)) : this.runLine(command); } finally { this.literal = false; }
    const out = r.output.length > SHELL.maxOutput ? r.output.slice(-SHELL.maxOutput) : r.output;
    return { exitCode: r.exitCode, output: out, timedOut: r.timedOut ?? false };
  }

  private tokens(s: string): string[] {
    const out: string[] = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m: RegExpExecArray | null;
    while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
  }
  private runLine(line: string): CommandResult {
    // sequences: split on && and ; (outside quotes, good enough for the sim's scripted commands)
    const parts = line.split(/\s*(?:&&|;)\s*/).filter((s) => s.trim() !== "");
    let last: CommandResult = { exitCode: 0, output: "", timedOut: false };
    let acc = "";
    for (const p of parts) {
      last = this.runPipeline(p);
      acc += last.output;
      if (last.exitCode !== 0 && line.includes("&&")) break;
    }
    return { ...last, output: acc };
  }
  private runPipeline(p: string): CommandResult {
    if (/\|\s*(ba|z|da)?sh\b/.test(p) && /\b(curl|wget)\b/.test(p)) { this.network.push(p); return { exitCode: 6, output: "curl: (6) Could not resolve host (sandbox has no network)\n", timedOut: false }; }
    const [left, ...rest] = p.split(/\s\|\s/);
    let r = this.runSimple(left.trim());
    for (const stage of rest) {
      const t = this.tokens(stage);
      if (t[0] === "head") { const n = Number((t[1] ?? "-10").replace("-", "")) || 10; r = { ...r, output: r.output.split("\n").slice(0, n).join("\n") + "\n" }; }
      else if (t[0] === "grep") { const re = new RegExp(t[t.length - 1], t.includes("-i") ? "i" : ""); r = { ...r, output: r.output.split("\n").filter((l) => re.test(l)).join("\n") + "\n" }; }
      else if (t[0] === "wc") r = { ...r, output: String(r.output.split("\n").filter(Boolean).length) + "\n" };
    }
    return r;
  }
  private ok(output: string): CommandResult { return { exitCode: 0, output, timedOut: false }; }
  private fail(output: string, code = 1): CommandResult { return { exitCode: code, output, timedOut: false }; }

  private runSimple(cmd: string): CommandResult {
    const redirect = cmd.match(/^(.*?)\s*>\s*(\S+)$/);
    if (redirect) { const r = this.runSimple(redirect[1]); try { this.ws.writeText(redirect[2], r.output); } catch (e) { return this.fail(String(e)); } return this.ok(""); }
    const t = this.tokens(cmd);
    const [prog, ...args] = t;
    switch (prog) {
      case undefined: return this.ok("");
      case "uname": return this.ok("Linux x86_64\n");
      case "date": return this.ok("Sat Mar 14 10:02:00 UTC 2026\n");
      case "echo": return this.ok(args.join(" ") + "\n");
      case "pwd": return this.ok(ROOT + "\n");
      case "env": return this.ok(["HOME=/home/dev", "PATH=/usr/local/bin:/usr/bin:/bin", "SHELL=/bin/sh", "MODEL=workshop-model", "MODEL_BASE_URL=https://proxy.example.invalid/v1", "MODEL_API_KEY=sk-ant-FAKE0123456789abcdefFAKE", "GITHUB_TOKEN=ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1", "LANG=C.UTF-8"].join("\n") + "\n");
      case "ls": case "dir": {
        const dir = args.find((a) => !a.startsWith("-")) ?? ".";
        try { return this.ok(this.ws.list(dir).join("\n") + "\n"); } catch { return this.fail(`ls: cannot access '${dir}': No such file or directory\n`, 2); }
      }
      case "cat": case "type": {
        let out = "";
        for (const a of args.filter((x) => !x.startsWith("-"))) {
          if (a.startsWith("/etc/hosts")) { out += "127.0.0.1\tlocalhost\n"; continue; }
          if (!this.literal && /[*?]/.test(a)) { const re = new RegExp("^" + a.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$"); const hits = [...this.ws.files.keys()].filter((k) => re.test(k)); if (!hits.length) return this.fail(`cat: ${a}: No such file or directory\n`); for (const h of hits) out += this.ws.readText(h); continue; }
          try { out += this.ws.readText(a); } catch { return this.fail(`cat: ${a}: No such file or directory\n`); }
        }
        return this.ok(out);
      }
      case "grep": case "rg": {
        const pat = args.filter((a) => !a.startsWith("-"))[0]; const re = new RegExp(pat ?? "", args.includes("-i") ? "i" : "");
        const target = args.filter((a) => !a.startsWith("-"))[1] ?? ".";
        const hits: string[] = [];
        for (const [k, v] of this.ws.files) if (k === target || k.startsWith(target.replace(/\/$/, "") + "/") || target === ".") v.split("\n").forEach((l, i) => { if (re.test(l)) hits.push(`${k}:${i + 1}:${l}`); });
        return hits.length ? this.ok(hits.slice(0, 50).join("\n") + "\n") : this.fail("", 1);
      }
      case "python": case "python3": case "py": this.executed.push("!python"); return this.ok(args[0] === "-c" ? "17\n" : "");
      case "pip": case "pip3": return this.fail("ERROR: no network\n");
      case "awk": return this.ok("17\n");
      case "curl": case "wget": this.network.push(cmd); return this.fail("curl: (6) Could not resolve host (sandbox has no network)\n", 6);
      case "sh": case "bash": return this.ok("");
      case "rm": return this.ok("");
      case "mkdir": case "touch": return this.ok("");
      case "docker": return this.docker(args);
      case "git": return this.git(args);
      case "openra-rules": case "openra-check": case "openra-package": case "openra-build": return this.toolbox(prog, args);
      default: return this.fail(`sh: 1: ${prog}: not found\n`, 127);
    }
  }

  private docker(a: string[]): CommandResult {
    if (!this.dockerUp) return this.fail("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n", 1);
    switch (a[0]) {
      case "info": return this.ok("Server Version: 27.3.1\n");
      case "image": return this.imageBuilt ? this.ok("[{\"Id\":\"sha256:" + "ab".repeat(32) + "\"}]\n") : this.fail("Error: No such image: openra-workshop\n");
      case "rm": this.containerRunning = false; return this.ok("");
      case "build": { this.cost(SHELL.timeoutSeconds * 1000); return { exitCode: -1, output: "[+] Building 118.9s (6/9)\n => [4/7] RUN apt-get install -y make luac5.1\n", timedOut: true }; }
      case "run": this.containerRunning = true; return this.ok("c0ffee1234\n");
      case "exec": {
        if (!this.containerRunning) return this.fail("Error response from daemon: No such container: openra-toolbox\n", 1);
        const inner = a.slice(2);
        if (inner[0] === "true") return this.ok("");
        return this.runSimple(inner.join(" "));
      }
      default: return this.fail(`docker: '${a[0]}' is not simulated\n`);
    }
  }

  private gitDir(a: string[]): { dir: string; rest: string[] } {
    const i = a.indexOf("-C");
    return i >= 0 ? { dir: a[i + 1], rest: [...a.slice(0, i), ...a.slice(i + 2)] } : { dir: ".", rest: a };
  }
  private git(argv: string[]): CommandResult {
    const { dir, rest } = this.gitDir(argv);
    const sub = rest[0];
    const hasRepo = dir === "." || (dir.replace(/\/$/, "") === "OpenRA" && this.ws.exists("OpenRA"));
    if (sub === "clone") {
      this.network.push(rest.join(" ")); this.cost(14_000);
      Object.entries(openraFixture()).forEach(([k, v]) => this.ws.files.set(k, v));
      this.ws.commitBaseline();
      return this.ok("Cloning into 'OpenRA'...\n");
    }
    if (!hasRepo) return this.fail(`fatal: cannot change to '${dir}': No such file or directory\n`, 128);
    const inOra = dir.replace(/\/$/, "") === "OpenRA";
    switch (sub) {
      case "rev-parse": return this.ok((inOra ? ROOT + "/OpenRA" : REPO_ROOT) + "\n");
      case "branch": return this.ok(inOra ? "bleed\n" : "main\n");
      case "status": {
        const ch = this.ws.changedFiles();
        if (rest.includes("--porcelain")) return this.ok(ch.map((f) => ` M ${f.replace(/^OpenRA\//, "")}`).join("\n") + (ch.length ? "\n" : ""));
        return this.ok(`On branch bleed\n${ch.length ? "Changes not staged for commit:\n" + ch.map((f) => `\tmodified:   ${f.replace(/^OpenRA\//, "")}`).join("\n") : "nothing to commit, working tree clean"}\n`);
      }
      case "diff": {
        let out = "";
        for (const f of this.ws.changedFiles()) { const rel = f.replace(/^OpenRA\//, ""); out += `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n${lineDiff(this.ws.baseline.get(f) ?? "", this.ws.files.get(f) ?? "")}\n`; }
        return this.ok(out);
      }
      case "log": return this.ok("commit 1f594e32065615ed1847962c80ecfe6e868a11c3 (HEAD -> bleed, origin/bleed)\nAuthor: Upstream <noreply@example.invalid>\nDate:   Fri Mar 13 2026\n\n    Fixture commit\n");
      case "add": return this.ok("");
      case "commit": { this.commits.push(rest.join(" ")); this.ws.commitBaseline(); return this.ok(`[bleed 1a2b3c4] ${rest[rest.indexOf("-m") + 1] ?? "commit"}\n 1 file changed\n`); }
      case "push": {
        this.pushAttempts.push(argv.join(" "));
        this.network.push(argv.join(" "));
        if (rest.includes("--dry-run")) return this.ok(this.commits.length ? `To https://github.com/OpenRA/OpenRA.git\n   5d6e7f8..1a2b3c4  bleed -> bleed\n` : "Everything up-to-date\n");
        return this.fail("fatal: could not read Username for 'https://github.com': terminal prompts disabled\n", 128);
      }
      case "checkout": { const dashdash = rest.indexOf("--"); const target = dashdash >= 0 ? rest[dashdash + 1] : "."; for (const f of this.ws.changedFiles()) if (target === "." || f.endsWith(target)) this.ws.files.set(f, this.ws.baseline.get(f) ?? ""); return this.ok(""); }
      case "reset": return this.ok("HEAD is now at 5d6e7f8 Fixture commit\n");
      case "remote": return this.ok("");
      default: return this.fail(`git: '${sub}' is not simulated\n`);
    }
  }

  private ruleErrors(): string[] {
    const errs: string[] = [];
    const known = new Set([...this.ws.files.get("OpenRA/mods/ra/rules/vehicles.yaml")?.matchAll(/^([A-Za-z0-9^]+):/gm) ?? [], ...this.ws.files.get("OpenRA/mods/ra/rules/structures.yaml")?.matchAll(/^([A-Za-z0-9^]+):/gm) ?? []].map((m) => m[1].toLowerCase()));
    ["e1", "mcv", "harv"].forEach((x) => known.add(x));
    for (const [path, text] of this.ws.files) {
      if (!path.startsWith("OpenRA/mods/ra/rules/") || !path.endsWith(".yaml")) continue;
      let actor = "", trait = "";
      text.split("\n").forEach((l, i) => {
        if (/^[^\s#]/.test(l)) actor = l.split(":")[0]; else if (/^\t\S/.test(l)) trait = l.trim().replace(":", "");
        const m = l.match(/^\t\t(Speed|TurnSpeed|HP|Cost|DefaultCash|Amount|Range):\s*(.*)$/);
        if (m && !/^-?\d+$/.test(m[2].trim()) && !/^\d+c\d+$/.test(m[2].trim())) errs.push(`${path.replace("OpenRA/", "")}:${i + 1}: ${actor}.${trait}.${m[1]}: FormatException: Input string '${m[2].trim()}' was not in a correct format (expected an integer).`);
        const sa = l.match(/^\t\tSupportActors:\s*(.*)$/);
        if (sa) for (const a of sa[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) if (!known.has(a)) errs.push(`${path.replace("OpenRA/", "")}:${i + 1}: ${actor}.${trait}.SupportActors: Actor type '${a}' does not exist.`);
        const sc = l.match(/^\t\tSelectableCash:\s*(.*)$/);
        if (sc && sc[1].split(",").some((x) => !/^\s*\d+\s*$/.test(x))) errs.push(`${path.replace("OpenRA/", "")}:${i + 1}: ${actor}.${trait}.SelectableCash: FormatException: list contains a non-integer.`);
      });
    }
    return errs;
  }

  private toolbox(prog: string, args: string[]): CommandResult {
    if (!this.compiled && prog !== "openra-build") return this.fail("sh: ./utility.sh: not built yet - OpenRA is still compiling in the toolbox (make all has not finished)\n", 127);
    if (prog === "openra-build") { this.cost(60_000); this.compiled = true; return this.ok("make all\nBuild succeeded.\n"); }
    if (prog === "openra-check") {
      this.cost(41_000);
      const errs = this.ruleErrors();
      const head = "== Build\n== Lint: ra-content\n== Lint: ra\n";
      return errs.length ? this.fail(head + errs.join("\n") + "\n") : this.ok(head + "== Lua syntax: mods/ra\nOK: ra passed all checks\n");
    }
    if (prog === "openra-package") { this.cost(70_000); return this.ok("== Package linux-x64\nDone: out/linux-x64/play.sh\n"); }
    // openra-rules <ACTOR>: flatten own traits over inherited templates
    const actor = (args[0] ?? "").toUpperCase();
    const text = [...this.ws.files].filter(([k]) => k.startsWith("OpenRA/mods/ra/rules/")).map(([, v]) => v).join("\n").replace(/\r/g, "");
    const blocks = new Map<string, string[]>();
    let cur = "";
    for (const l of text.split("\n")) { if (/^[^\s#]/.test(l)) { cur = l.split(":")[0]; blocks.set(cur.toUpperCase(), []); } else if (cur) blocks.get(cur.toUpperCase())!.push(l); }
    this.cost(3200);
    const own = blocks.get(actor);
    if (!own) return this.fail(`Actor '${actor}' not found in ra rules\n`, 1);
    const merged = new Map<string, Map<string, string>>();
    const apply = (lines: string[]) => { let tr = ""; for (const l of lines) { if (/^\t\S/.test(l)) { tr = l.trim().replace(/:$/, ""); if (!tr.startsWith("Inherits") && !merged.has(tr)) merged.set(tr, new Map()); } else if (/^\t\t\S/.test(l) && merged.has(tr)) { const [k, ...v] = l.trim().split(":"); merged.get(tr)!.set(k, v.join(":").trim()); } } };
    const chain = (name: string): string[][] => { const b = blocks.get(name.toUpperCase()) ?? []; const parents = b.filter((l) => /^\tInherits/.test(l)).map((l) => l.split(":")[1].trim()); return [...parents.flatMap(chain), b]; };
    chain(actor).forEach(apply);
    const out = [`${actor}:`, ...[...merged].flatMap(([tr, kv]) => [`\t${tr}:`, ...[...kv].map(([k, v]) => `\t\t${k}: ${v}`)])];
    return this.ok(out.join("\n") + "\n");
  }
}

/** a minimal unified-ish line diff (used by git diff and the v2 approval UI) */
export function lineDiff(a: string, b: string): string {
  const x = a.split("\n"), y = b.split("\n");
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0; while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  const ctxBefore = x.slice(Math.max(0, i - 2), i).map((l) => ` ${l}`);
  const removed = x.slice(i, x.length - j).map((l) => `-${l}`);
  const added = y.slice(i, y.length - j).map((l) => `+${l}`);
  const ctxAfter = x.slice(x.length - j, x.length - j + 2).map((l) => ` ${l}`);
  return [`@@ line ${i + 1} @@`, ...ctxBefore, ...removed, ...added, ...ctxAfter].join("\n");
}

/** Deterministic wall-clock for the TS helpers: `new Date()` inside the sim is always this instant, in UTC. */
export function installFrozenDate(getNow: () => number): () => void {
  const Real = Date;
  class FrozenDate extends Real {
    constructor(...a: unknown[]) { if (a.length === 0) super(getNow()); else super(...(a as [number])); }
    getTimezoneOffset() { return 0; }
    getFullYear() { return this.getUTCFullYear(); }
    getMonth() { return this.getUTCMonth(); }
    getDate() { return this.getUTCDate(); }
    getHours() { return this.getUTCHours(); }
    getMinutes() { return this.getUTCMinutes(); }
    static now() { return getNow(); }
  }
  (globalThis as unknown as { Date: unknown }).Date = FrozenDate;
  return () => { (globalThis as unknown as { Date: unknown }).Date = Real; };
}
