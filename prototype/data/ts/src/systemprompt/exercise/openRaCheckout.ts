import { dynamicSection } from "@harness/api";

const CLONE = "git clone --depth 1 --config core.autocrlf=false https://github.com/OpenRA/OpenRA.git OpenRA";

/** Tells the model to clone OpenRA while it is missing from the workspace; emits nothing once it is there. */
export const openRaCheckout = dynamicSection("openra_checkout", (ctx) =>
  ctx.workspace.exists("OpenRA")
    ? null
    : `OpenRA is not checked out in the workspace yet. Before anything else, clone it by running exactly: ${CLONE}`,
);
