import { allow, ask, deny, type Guardrail } from "@harness/api";

const BUILD_FILES = new Set(["build.gradle.kts", "settings.gradle.kts", "gradle.properties", "pom.xml", "package.json"]);

/**
 * Keeps the model from "fixing" a failing test by editing the build, and from writing all over the
 * project. The worked example from §5.3: one guardrail that uses two of the verbs, PREVENT and GATE.
 * Covers write_file and edit_file (REVIEW F-7: edit_file used to bypass the deny, so the model
 * could rewrite build.gradle.kts with an "edit" instead of a "write"). Only beforeToolUse is implemented.
 */
export const buildFile: Guardrail = {
  name: "build-file",

  beforeToolUse(call, ctx) {
    if (call.tool.name !== "write_file" && call.tool.name !== "edit_file") return allow();

    const relative = ctx.workspace.relativize(ctx.workspace.resolve(String(call.input.path)));
    const fileName = relative.slice(relative.lastIndexOf("/") + 1);

    if (BUILD_FILES.has(fileName)) {
      return deny(`${relative} is build configuration - make the test pass, not the build`);
    }
    // edit_file keeps its v1 behaviour: a small, reviewable diff outside src/ is not "writing all
    // over the project", so it is not gated here. Only the build-file deny is broadened.
    if (call.tool.name === "write_file" && !relative.startsWith("src/")) {
      return ask(`write outside src/: ${relative}`);
    }
    return allow();
  },
};
