import { allow, ask, deny, type Guardrail } from "@harness/api";

const BUILD_FILES = new Set(["build.gradle.kts", "settings.gradle.kts", "gradle.properties", "pom.xml", "package.json"]);

/**
 * Keeps the model from "fixing" a failing test by editing the build, and from writing all over the
 * project. The worked example from §5.3: one guardrail that uses two of the verbs, PREVENT and GATE.
 * Opt-in per tool: it only understands write_file. Only beforeToolUse is implemented.
 */
export const buildFile: Guardrail = {
  name: "build-file",

  beforeToolUse(call, ctx) {
    if (call.tool.name !== "write_file") return allow();

    const relative = ctx.workspace.relativize(ctx.workspace.resolve(String(call.input.path)));
    const fileName = relative.slice(relative.lastIndexOf("/") + 1);

    if (BUILD_FILES.has(fileName)) {
      return deny(`${relative} is build configuration - make the test pass, not the build`);
    }
    if (!relative.startsWith("src/")) {
      return ask(`write outside src/: ${relative}`);
    }
    return allow();
  },
};
