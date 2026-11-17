// Runs before every test file (vitest.config.ts: setupFiles), so before @harness/api is imported.
// In the harness, the JVM puts __harnessShell on the global object; here the tests do it themselves.
(globalThis as Record<string, unknown>).__harnessShell = {
  name: process.platform === "win32" ? "cmd.exe" : "sh",
  timeoutSeconds: 120,
  maxOutput: 30_000,
};
