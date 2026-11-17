import type { Workspace } from "@harness/api";

const IGNORED = [".git/", "node_modules/", "build/", "dist/", ".gradle/"];

/** Every regular file under `dir`, as workspace-relative paths, sorted; skips VCS and build output. */
export function filesUnder(workspace: Workspace, dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of workspace.list(current)) {
      const path = current === "." ? entry : `${current.replace(/\/$/, "")}/${entry}`;
      if (IGNORED.some((ignored) => `/${path}`.includes(`/${ignored}`))) continue;
      if (entry.endsWith("/")) walk(path);
      else found.push(path);
    }
  };
  walk(dir);
  return found.sort();
}

/** Translates `**`, `*`, `?` and `{a,b}` into a RegExp; there is no java.nio PathMatcher in this runtime. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let inGroup = false;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        // "**/" also matches zero directories, so "**/*.kt" finds a top-level file.
        if (glob[i + 1] === "/") { i++; source += "(?:.*/)?"; } else source += ".*";
      } else source += "[^/]*";
    } else if (c === "?") source += "[^/]";
    else if (c === "{") { inGroup = true; source += "(?:"; }
    else if (c === "}" && inGroup) { inGroup = false; source += ")"; }
    else if (c === "," && inGroup) source += "|";
    else source += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}
