// Mounts the real <App/> in jsdom (React 19, effects included), waits for the runs, clicks through tabs/scenarios, reads the DOM.
import { JSDOM } from "jsdom";
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
const g = globalThis as unknown as Record<string, unknown>;
for (const k of ["window", "document", "HTMLElement", "Node", "navigator", "location", "history", "MouseEvent", "Event"]) { try { Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true }); } catch { /* read-only */ } }
g.IS_REACT_ACT_ENVIRONMENT = true;
(dom.window as unknown as { URL: unknown }).URL.constructor; // keep URL.createObjectURL out of the way
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: App } = await import("../app/App");
const root = createRoot(dom.window.document.getElementById("root")!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await act(async () => { root.render(<App />); await sleep(1500); });
const text = () => dom.window.document.body.textContent ?? "";
const click = async (label: string, tag = "button") => { const el = [...dom.window.document.querySelectorAll(tag)].find((b) => (b.textContent ?? "").trim().replace(/^★ /, "").startsWith(label)); if (!el) throw new Error("no " + tag + " " + label); await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await sleep(900); }); };
let bad = 0;
const check = (n: string, ok: boolean, e = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`); if (!ok) bad++; };
check("App mounts and runs the default scenario (4.1) in v1", /4\.1/.test(text()) && /Never push to OpenRA/.test(text()) && /no-push|command\.beforeToolUse/.test(text()), text().slice(0, 60));
await click("Workflow"); check("Workflow tab shows the normative nodes", /beforeToolUse/.test(text()) && /stop_reason\?/.test(text()));
await click("▶|"); await click("▶|"); check("stepping the graph works", /event \d+\/\d+/.test(text()));
await click("Assemble"); check("Assemble tab lists sections → tools → guardrails → listeners", /system prompt sections/.test(text()) && /guardrails \(registration order/.test(text()));
await click("v2 · improved"); await click("Assemble"); check("v2 layer is visible with policy rules and provenance checksums", /P-no-upstream/.test(text()) && /sha256:/.test(text()) && /skills \(progressive disclosure\)/.test(text()));
await click("Cost"); check("Cost tab: attribution + prices", /extension point/.test(text()) && /cache read/.test(text()));
await click("Diff v1"); check("Diff tab explains the divergence", /first behavioural divergence/.test(text()) && /why:/.test(text()));
await click("Audit &");  check("Audit tab: chain verifies", /chain verifies/.test(text()), text().match(/audit log[^]{0,80}/)?.[0] ?? text().slice(-300));
await click("Run"); const pill = [...dom.window.document.querySelectorAll("span")].find((s) => s.textContent === "policy"); if (pill) await act(async () => { pill.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await sleep(300); });
check("clicking a guardrail verdict opens the inspector with hooks and source", /hooks — implemented vs defaulted/.test(text()) || /real implementation/.test(text()), `pill=${!!pill}`);
await click("6.1 Show me the money", "button"); await sleep(800);
check("scenario switch to 6.1 runs", /6\.1/.test(text()) && /set_actor_value/.test(text()));
await click("copy permalink"); check("permalink written to the URL hash", /#s=/.test(dom.window.location.hash || dom.window.location.href), dom.window.location.hash.slice(0, 30));
await click("Regression"); await click("run all scenarios"); await act(async () => { await sleep(6000); });
check("regression view runs scenarios", /pass in both versions/.test(text()), (text().match(/(\d+)\/\d+ · (\d+) pass in both/) ?? [""])[0]);
console.log(bad ? `${bad} DOM check(s) failed` : "all DOM smoke checks passed");
process.exit(bad ? 1 : 0);
