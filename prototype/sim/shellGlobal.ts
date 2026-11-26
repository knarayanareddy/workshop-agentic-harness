// MUST be imported before anything that imports "@harness/api": harness.ts reads `globalThis.__harnessShell` at module load
// (it is how the real harness injects the shell name and limits into the embedded engine).
(globalThis as unknown as { __harnessShell: unknown }).__harnessShell = { name: "sh", timeoutSeconds: 120, maxOutput: 20000 };
export {};
