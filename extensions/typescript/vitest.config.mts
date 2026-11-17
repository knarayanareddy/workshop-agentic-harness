import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // the same mapping as "paths" in tsconfig.json
    alias: { "@harness/api": fileURLToPath(new URL("../../harness-api/typescript/harness.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
  },
});
