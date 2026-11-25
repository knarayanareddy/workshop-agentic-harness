import { failure, success, type Tool } from "@harness/api";
import { toolbox } from "../../helpers";

/** Gets the OpenRA toolbox ready: the image, a long-running container, and a compiled OpenRA in it. */
export const startToolbox: Tool = {
  name: "start_toolbox",
  description:
    "Start the OpenRA toolbox that the other OpenRA tools need: builds the Docker image if it is missing, starts the " +
    "container and compiles OpenRA in it. The first time this takes several minutes, so it runs in the background " +
    "and returns at once; check progress with toolbox_status. Restarts the toolbox if it is running.",
  inputSchema: { type: "object", properties: {} },

  execute(_input, ctx) {
    if (!toolbox.isDockerRunning(ctx)) {
      return failure("Docker is not running. Ask the user to start Docker, then call start_toolbox again.");
    }
    toolbox.start(ctx);
    return success("The toolbox is starting in the background. The first time takes several minutes: tell the user, and check with toolbox_status.");
  },
};
